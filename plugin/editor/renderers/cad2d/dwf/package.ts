/** DWF reader: DWF 6.x packages ("(DWF V06.00)" + ZIP with manifest.xml, per-section
 *  descriptor.xml, .w2d streams, thumbnails and images) and legacy single-stream DWF (the whole
 *  file is a W2D stream). Each 2D sheet becomes a scene view in paper units; a sheet whose stream
 *  cannot be drawn shows the package's thumbnail with a notice saying so. */
import { unzipSync } from '../../../../vendor/zip.js'
import { bump, emptyScene, mergePaths, type ImageItem, type Item, type Mat, type Scene, type SceneView } from '../scene.ts'
import { readW2d, W2dError, type W2dImage, type W2dResult } from './w2d.ts'

type Tr = (ko: string, en: string) => string

export interface XmlTag {
  name: string
  attrs: Record<string, string>
}

/** Start tags with their attributes (namespace prefixes dropped). Enough for DWF manifests. */
export function xmlTags(xml: string): XmlTag[] {
  const out: XmlTag[] = []
  const re = /<([A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs: Record<string, string> = {}
    const ar = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    let a: RegExpExecArray | null
    while ((a = ar.exec(m[3]))) attrs[a[1].replace(/^[\w.-]+:/, '')] = decodeEntities(a[2] ?? a[3] ?? '')
    out.push({ name: m[2], attrs })
  }
  return out
}

function decodeEntities(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e: string) => {
    const k = e.toLowerCase()
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    if (k === 'amp') return '&'
    if (k === 'quot') return '"'
    if (k === 'apos') return "'"
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    return Number.isFinite(n) ? String.fromCodePoint(n) : all
  })
}

const utf8 = (b: Uint8Array) => new TextDecoder('utf-8').decode(b)

class FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatError'
  }
}

export function openZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const attempts = [bytes, bytes.subarray(12)]
  let last: unknown
  for (const b of attempts) {
    try {
      const files = unzipSync(b)
      if (Object.keys(files).length) return files
    } catch (e) {
      last = e
    }
  }
  throw new FormatError(`damaged package (${(last as Error)?.message ?? 'no files'})`)
}

/** 4×4 row-major matrix text "a b c d e f g h i j k l m n o p" → 2D affine (row-vector form). */
export function matrix4(text: string | undefined): Mat | null {
  if (!text) return null
  const v = text.trim().split(/[\s,]+/).map(Number)
  if (v.length !== 16 || v.some((x) => !Number.isFinite(x))) return null
  return [v[0], v[1], v[4], v[5], v[12], v[13]]
}

export async function readDwf(bytes: Uint8Array, tr: Tr): Promise<Scene> {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 12))
  const m = /^\(DWF V(\d\d)\.(\d\d)\)/.exec(head)
  if (!m) {
    if (/^\(W2D V/.test(head)) return single(bytes, tr, 'W2D')
    throw new FormatError('not a DWF file (missing "(DWF V…)" header)')
  }
  const major = Number(m[1])
  if (major < 6) return single(bytes, tr, `DWF V${m[1]}.${m[2]}`)
  const files = openZip(bytes)
  const scene = emptyScene('DWF')
  scene.version = `DWF ${m[1]}.${m[2]} package`
  const layers = layerTable(scene)
  const names = Object.keys(files)
  const find = (href: string) => files[href] ?? files[href.replace(/^\//, '')] ?? files[names.find((n) => n.toLowerCase() === href.toLowerCase().replace(/^\//, '')) ?? '']

  type Sec = { type: string; title: string; descriptor?: string; prefix: string }
  const sections: Sec[] = []
  const manifest = files['manifest.xml']
  if (manifest) {
    let cur: Sec | null = null
    for (const t of xmlTags(utf8(manifest))) {
      if (t.name === 'Section') {
        cur = { type: t.attrs.type ?? '', title: t.attrs.title ?? t.attrs.name ?? '', prefix: (t.attrs.name ?? '') + '/' }
        sections.push(cur)
      } else if (t.name === 'Resource' && cur && /descriptor/i.test(t.attrs.role ?? '')) cur.descriptor = t.attrs.href
    }
  }
  if (!sections.length) {
    // No manifest: every W2D stream is a sheet.
    for (const n of names.filter((n) => /\.w2d$/i.test(n)).sort()) sections.push({ type: 'com.autodesk.dwf.ePlot', title: n.replace(/^.*\//, '').replace(/\.w2d$/i, ''), prefix: n })
  }
  for (const sec of sections) {
    const view: SceneView = { name: sec.title || `Sheet ${scene.views.length + 1}`, kind: 'sheet', items: [], background: 'light' }
    const desc = sec.descriptor ? find(sec.descriptor) : undefined
    const graphics: { href: string; transform: Mat | null }[] = []
    const thumbs: { href: string; size: number; role: string }[] = []
    let paper: { w: number; h: number; units: string } | null = null
    if (desc) {
      for (const t of xmlTags(utf8(desc))) {
        if ((t.name === 'Page' || t.name === 'Plot') && t.attrs.name && !sec.title) view.name = t.attrs.name
        if (t.name === 'Paper') {
          const w = Number(t.attrs.width)
          const h = Number(t.attrs.height)
          if (w > 0 && h > 0) paper = { w, h, units: t.attrs.units ?? '' }
        }
        const role = (t.attrs.role ?? '').toLowerCase()
        const href = t.attrs.href
        if (!href) continue
        if (/x-w2d/i.test(t.attrs.mime ?? '') || /\.w2d$/i.test(href)) {
          if (/2d streaming graphics|2d vector overlay|2d vector markup|graphics/.test(role) || !role) graphics.push({ href, transform: matrix4(t.attrs.transform) })
        } else if (/^image\//i.test(t.attrs.mime ?? '') && /thumbnail|preview/.test(role)) {
          const ext = (t.attrs.extents ?? '').split(/\s+/).map(Number)
          thumbs.push({ href, size: ext.length === 4 ? Math.abs((ext[2] - ext[0]) * (ext[3] - ext[1])) : 0, role })
        }
      }
    } else if (/\.w2d$/i.test(sec.prefix)) graphics.push({ href: sec.prefix, transform: null })
    // Unknown descriptor: look in the section's folder.
    if (!graphics.length && !/eModel|3d/i.test(sec.type)) for (const n of names) if (n.startsWith(sec.prefix) && /\.w2d$/i.test(n)) graphics.push({ href: n, transform: null })
    if (!thumbs.length) for (const n of names) if (n.startsWith(sec.prefix) && /\.(png|jpe?g)$/i.test(n) && /thumb|preview/i.test(n)) thumbs.push({ href: n, size: 0, role: 'thumbnail' })
    thumbs.sort((a, b) => b.size - a.size)

    let stopped = ''
    let drawn = 0
    for (const g of graphics) {
      const data = find(g.href)
      if (!data) continue
      const res = readW2d(data, layers)
      if (res.stopped) stopped = res.stopped
      for (const [k, n] of res.ignored) bump(scene.skipped, k, n)
      drawn += res.items.length
      await decodeImages(res.images)
      const items = mergePaths(res.items)
      // Logical coordinates → paper units (descriptor transform) or drawing units.
      const t = g.transform ?? res.toUnits ?? null
      if (t) {
        const key = `${sec.prefix}${g.href}`
        scene.blocks.set(key, { name: key, items })
        view.items.push({ k: 'ref', layer: -1, color: -1, lw: 0, block: key, m: t })
      } else view.items.push(...items)
      if (res.units && !scene.units) scene.units = res.units
      countItems(scene, res.items)
    }
    if (paper) {
      view.paper = { x0: 0, y0: 0, x1: paper.w, y1: paper.h }
      if (!scene.units && paper.units) scene.units = paper.units
    }
    const thumb = thumbs.length ? find(thumbs[0].href) : undefined
    if (/eModel|3d/i.test(sec.type) && !graphics.length) {
      view.notice = tr('3D 모델 섹션은 지원하지 않습니다. 내장 미리보기 이미지만 표시합니다.', '3D model sections are not supported: showing the embedded thumbnail only.')
      if (thumb) await thumbnailView(view, thumb, paper)
      scene.views.push(view)
      continue
    }
    if (stopped && thumb) {
      view.items = []
      await thumbnailView(view, thumb, paper)
      view.notice = tr(
        `이 시트는 미리보기가 그릴 수 없는 W2D 기능을 사용합니다 (${stopped}). 패키지에 들어 있는 썸네일 이미지만 표시합니다.`,
        `This sheet uses W2D features the preview cannot draw (${stopped}). Showing the package's embedded thumbnail image only.`
      )
      view.info = [tr('썸네일만 표시', 'thumbnail only')]
    } else if (stopped) {
      view.notice = tr(`일부만 표시합니다: ${stopped}`, `Partly drawn: ${stopped}`)
    } else if (!drawn && thumb) {
      await thumbnailView(view, thumb, paper)
      view.notice = tr('그릴 벡터 내용이 없어 썸네일 이미지를 표시합니다.', 'No vector content: showing the embedded thumbnail image.')
    }
    scene.views.push(view)
  }
  if (!scene.views.length) throw new FormatError('no sheets in the package')
  scene.info.push(`${scene.views.length} ${scene.views.length === 1 ? 'sheet' : 'sheets'}`)
  return scene
}

async function single(bytes: Uint8Array, tr: Tr, label: string): Promise<Scene> {
  const scene = emptyScene('DWF')
  scene.version = label
  const res: W2dResult = readW2d(bytes, layerTable(scene))
  for (const [k, n] of res.ignored) bump(scene.skipped, k, n)
  await decodeImages(res.images)
  const view: SceneView = { name: 'Sheet', kind: 'sheet', items: mergePaths(res.items), background: 'light' }
  if (res.toUnits) {
    scene.blocks.set('stream', { name: 'stream', items: view.items })
    view.items = [{ k: 'ref', layer: -1, color: -1, lw: 0, block: 'stream', m: res.toUnits }]
  }
  scene.units = res.units
  if (res.stopped) {
    if (!res.items.length) throw new W2dError(res.stopped)
    view.notice = tr(`일부만 표시합니다: ${res.stopped}`, `Partly drawn: ${res.stopped}`)
  }
  countItems(scene, res.items)
  scene.views.push(view)
  return scene
}

const KIND_NAMES: Record<string, string> = { path: 'geometry', text: 'text', image: 'image', point: 'marker', hatch: 'fill', ref: 'group', viewport: 'viewport' }

function countItems(scene: Scene, items: Item[]): void {
  for (const it of items) bump(scene.counts, KIND_NAMES[it.k] ?? it.k)
}

/** Scene layers shared by all sheets, matched by name. */
function layerTable(scene: Scene): (num: number, name?: string) => number {
  const byName = new Map<string, number>()
  const byNum = new Map<number, number>()
  return (num: number, name?: string) => {
    if (name === undefined) {
      const known = byNum.get(num)
      if (known !== undefined) return known
      name = `Layer ${num}`
    }
    let idx = byName.get(name)
    if (idx === undefined) {
      idx = scene.layers.length
      scene.layers.push({ name, color: -1, visible: true, count: 0 })
      byName.set(name, idx)
    }
    byNum.set(num, idx)
    scene.layers[idx].count++
    return idx
  }
}

async function decodeImages(list: W2dImage[]): Promise<void> {
  for (const im of list) {
    try {
      if (im.data && im.mime) im.item.src = await createImageBitmap(new Blob([im.data as BlobPart], { type: im.mime }))
      else if (im.rgba && im.width > 0 && im.height > 0) im.item.src = await createImageBitmap(new ImageData(im.rgba as Uint8ClampedArray<ArrayBuffer>, im.width, im.height))
    } catch {
      im.item.src = null // frame only
    }
  }
}

async function thumbnailView(view: SceneView, data: Uint8Array, paper: { w: number; h: number } | null): Promise<void> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(new Blob([data as BlobPart]))
  } catch {
    return
  }
  // Fit the thumbnail on the sheet (or show it at pixel size).
  const W = paper?.w ?? bmp.width
  const H = paper?.h ?? bmp.height
  const s = Math.min(W / bmp.width, H / bmp.height)
  const w = bmp.width * s
  const h = bmp.height * s
  const item: ImageItem = { k: 'image', layer: -1, color: -1, lw: 0, src: bmp, m: [w, 0, 0, h, (W - w) / 2, (H - h) / 2], pw: bmp.width, ph: bmp.height }
  view.items = [item as Item]
  view.paper = { x0: 0, y0: 0, x1: W, y1: H }
}
