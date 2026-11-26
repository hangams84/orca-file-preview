/** DWFx reader: an OPC (ZIP) package whose sheets are XPS FixedPages. Renders Path elements
 *  (abbreviated geometry syntax and PathGeometry/PathFigure markup, solid and image fills, strokes
 *  with dashes), Glyphs (UnicodeString with Indices advances, embedded fonts including obfuscated
 *  .odttf, bold/italic simulations), Canvas transforms and opacity, and static resources. Page
 *  coordinates (1/96 inch, y down) become millimetres with y up. */
import { openZip, xmlTags } from './dwf/package.ts'
import { PathB } from './path.ts'
import { bump, emptyScene, mergePaths, mul, P, type ImageItem, type Item, type Mat, type Scene, type SceneView } from './scene.ts'

type Tr = (ko: string, en: string) => string
const MM = 25.4 / 96

class FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatError'
  }
}

// ---- small parsers (exported for tests) ---------------------------------------------------

/** XPS colour: #RGB? no — #RRGGBB, #AARRGGBB, sc#a,r,g,b / sc#r,g,b (scRGB, linear). */
export function parseColor(s: string | null | undefined): { rgb: number; a: number } | null {
  if (!s) return null
  s = s.trim()
  let m = /^#([0-9a-f]{8})$/i.exec(s)
  if (m) {
    const v = parseInt(m[1], 16)
    return { rgb: v & 0xffffff, a: ((v >>> 24) & 255) / 255 }
  }
  m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return { rgb: parseInt(m[1], 16), a: 1 }
  m = /^sc#\s*([^,]+),\s*([^,]+),\s*([^,]+)(?:,\s*([^,]+))?$/i.exec(s)
  if (m) {
    const v = m.slice(1).filter((x) => x !== undefined).map(Number)
    const [a, r, g, b] = v.length === 4 ? v : [1, ...v]
    const lin = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)))
    return { rgb: (lin(r) << 16) | (lin(g) << 8) | lin(b), a: Math.min(1, Math.max(0, a)) }
  }
  return null
}

export function parseMatrix(s: string | null | undefined): Mat | null {
  if (!s) return null
  const v = s.trim().split(/[\s,]+/).map(Number)
  return v.length === 6 && v.every(Number.isFinite) ? (v as Mat) : null
}

/** XPS abbreviated geometry ("F1 M 0,0 L 10,0 ... Z") → path commands through `m`. */
export function parsePathData(src: string, m?: Mat): { d: number[]; evenOdd: boolean } {
  const pb = new PathB(m)
  const tok = src.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let cx2 = 0 // last control point for S/T
  let cy2 = 0
  let evenOdd = true
  const num = () => Number(tok[i++])
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) cmd = tok[i++]
    else if (!cmd) break
    const rel = cmd === cmd.toLowerCase() && cmd !== 'F'
    switch (cmd.toUpperCase()) {
      case 'F':
        evenOdd = num() === 0
        cmd = ''
        break
      case 'M':
        x = num() + (rel ? x : 0)
        y = num() + (rel ? y : 0)
        pb.M(x, y)
        sx = x
        sy = y
        cx2 = x
        cy2 = y
        cmd = rel ? 'l' : 'L' // further pairs are lines
        break
      case 'L':
        x = num() + (rel ? x : 0)
        y = num() + (rel ? y : 0)
        pb.L(x, y)
        cx2 = x
        cy2 = y
        break
      case 'H':
        x = num() + (rel ? x : 0)
        pb.L(x, y)
        cx2 = x
        cy2 = y
        break
      case 'V':
        y = num() + (rel ? y : 0)
        pb.L(x, y)
        cx2 = x
        cy2 = y
        break
      case 'C': {
        const x1 = num() + (rel ? x : 0)
        const y1 = num() + (rel ? y : 0)
        const x2 = num() + (rel ? x : 0)
        const y2 = num() + (rel ? y : 0)
        const nx = num() + (rel ? x : 0)
        const ny = num() + (rel ? y : 0)
        cubic(pb, m, x1, y1, x2, y2, nx, ny)
        cx2 = x2
        cy2 = y2
        x = nx
        y = ny
        break
      }
      case 'S': {
        const x1 = 2 * x - cx2
        const y1 = 2 * y - cy2
        const x2 = num() + (rel ? x : 0)
        const y2 = num() + (rel ? y : 0)
        const nx = num() + (rel ? x : 0)
        const ny = num() + (rel ? y : 0)
        cubic(pb, m, x1, y1, x2, y2, nx, ny)
        cx2 = x2
        cy2 = y2
        x = nx
        y = ny
        break
      }
      case 'Q': {
        const x1 = num() + (rel ? x : 0)
        const y1 = num() + (rel ? y : 0)
        const nx = num() + (rel ? x : 0)
        const ny = num() + (rel ? y : 0)
        cubic(pb, m, x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), nx + (2 / 3) * (x1 - nx), ny + (2 / 3) * (y1 - ny), nx, ny)
        cx2 = x1
        cy2 = y1
        x = nx
        y = ny
        break
      }
      case 'A': {
        const rx = Math.abs(num())
        const ry = Math.abs(num())
        const rot = (num() * Math.PI) / 180
        const large = num() !== 0
        const sweep = num() !== 0
        const nx = num() + (rel ? x : 0)
        const ny = num() + (rel ? y : 0)
        arcTo(pb, x, y, rx, ry, rot, large, sweep, nx, ny)
        x = nx
        y = ny
        cx2 = x
        cy2 = y
        break
      }
      case 'Z':
        pb.Z()
        x = sx
        y = sy
        cmd = ''
        break
      default:
        i++ // unknown command letter: skip its operand
    }
  }
  return { d: pb.d, evenOdd }
}

function cubic(pb: PathB, m: Mat | undefined, x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
  // PathB has no curve command: add it directly (mapped).
  const map = (a: number, b: number): [number, number] => (m ? [m[0] * a + m[2] * b + m[4], m[1] * a + m[3] * b + m[5]] : [a, b])
  pb.d.push(P.C, ...map(x1, y1), ...map(x2, y2), ...map(x, y))
}

/** SVG/XPS endpoint arc → centre form. */
function arcTo(pb: PathB, x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number): void {
  if (!(rx > 0) || !(ry > 0) || (x1 === x2 && y1 === y2)) {
    pb.L(x2, y2)
    return
  }
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const xp = c * dx + s * dy
  const yp = -s * dx + c * dy
  const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry)
  if (lam > 1) {
    rx *= Math.sqrt(lam)
    ry *= Math.sqrt(lam)
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
  const den = rx * rx * yp * yp + ry * ry * xp * xp
  let k = Math.sqrt(Math.max(0, num / den))
  if (large === sweep) k = -k
  const cxp = (k * rx * yp) / ry
  const cyp = (-k * ry * xp) / rx
  const cx = c * cxp - s * cyp + (x1 + x2) / 2
  const cy = s * cxp + c * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
  if (!sweep && dt > 0) dt -= Math.PI * 2
  else if (sweep && dt < 0) dt += Math.PI * 2
  pb.E(cx, cy, rx, ry, phi, t1, t1 + dt, dt > 0)
}

/** Deobfuscates an XPS .odttf font: XOR of the first 32 bytes with the GUID in the part name. */
export function deobfuscateFont(data: Uint8Array, partName: string): Uint8Array | null {
  const g = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/i.exec(partName)
  if (!g || data.length < 32) return null
  const hex = g.slice(1).join('')
  const key: number[] = []
  for (let i = 0; i < 16; i++) key.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16))
  const out = data.slice()
  for (let i = 0; i < 32; i++) out[i] ^= key[15 - (i % 16)]
  return out
}

/** Glyph advances (em units, cumulative positions) from an Indices attribute, when every glyph has one. */
export function advancesFrom(indices: string | null, len: number): number[] | undefined {
  if (!indices) return undefined
  const parts = indices.split(';')
  const pos: number[] = []
  let x = 0
  for (let i = 0; i < len; i++) {
    const p = (parts[i] ?? '').replace(/^\(\d+(?::\d+)?\)/, '')
    const f = p.split(',')
    pos.push(x)
    const adv = f[1] !== undefined && f[1] !== '' ? Number(f[1]) : NaN
    if (!Number.isFinite(adv)) return undefined
    x += adv / 100
  }
  return pos
}

// ---- package ------------------------------------------------------------------------------

function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : ''
  const parts = (dir + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  }
  return out.join('/')
}

export async function readDwfx(bytes: Uint8Array, tr: Tr): Promise<Scene> {
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new FormatError('not a DWFx (ZIP) package')
  const files = openZip(bytes)
  const names = Object.keys(files)
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]))
  const get = (p: string) => files[p] ?? files[lower.get(p.toLowerCase()) ?? '']
  const text = (p: string) => {
    const b = get(p)
    return b ? new TextDecoder('utf-8').decode(b) : ''
  }
  // Pages in document order: root rels → FixedDocumentSequence → FixedDocument → PageContent.
  const pages: string[] = []
  let seq = ''
  for (const t of xmlTags(text('_rels/.rels'))) if (t.name === 'Relationship' && /fixedrepresentation$/i.test(t.attrs.Type ?? '')) seq = resolve('', t.attrs.Target ?? '')
  if (!seq) seq = names.find((n) => /\.fdseq$/i.test(n)) ?? ''
  if (seq)
    for (const t of xmlTags(text(seq)))
      if (t.name === 'DocumentReference' && t.attrs.Source) {
        const doc = resolve(seq, t.attrs.Source)
        for (const p of xmlTags(text(doc))) if (p.name === 'PageContent' && p.attrs.Source) pages.push(resolve(doc, p.attrs.Source))
      }
  if (!pages.length) pages.push(...names.filter((n) => /\.fpage$/i.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
  if (!pages.length) throw new FormatError('no FixedPage sheets in the package')

  const scene = emptyScene('DWFx')
  scene.version = 'DWFx (XPS)'
  scene.units = 'mm'
  const fonts = new Map<string, string | null>()
  let fontSeq = 0
  const loadFont = async (uri: string, from: string): Promise<string | undefined> => {
    const path = resolve(from, uri.replace(/#.*$/, ''))
    if (fonts.has(path)) return fonts.get(path) ?? undefined
    let fam: string | null = null
    const data = get(path)
    if (data && typeof FontFace !== 'undefined') {
      const bytesFont = /\.odttf$/i.test(path) ? deobfuscateFont(data, path.replace(/^.*\//, '')) : data
      if (bytesFont) {
        try {
          const name = `dwfx-font-${++fontSeq}`
          const face = new FontFace(name, bytesFont.slice().buffer as ArrayBuffer)
          await face.load()
          ;(document.fonts as unknown as { add(f: FontFace): void }).add(face)
          fam = name
        } catch {
          fam = null
          bump(scene.skipped, 'embedded font (unreadable)')
        }
      }
    }
    fonts.set(path, fam)
    return fam ?? undefined
  }

  for (let pi = 0; pi < pages.length; pi++) {
    const path = pages[pi]
    const xml = text(path)
    if (!xml) continue
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const root = doc.documentElement
    if (!root || root.localName !== 'FixedPage' || doc.getElementsByTagName('parsererror').length) {
      bump(scene.skipped, 'damaged page')
      continue
    }
    const W = Number(root.getAttribute('Width')) || 816
    const H = Number(root.getAttribute('Height')) || 1056
    const view: SceneView = { name: `${tr('시트', 'Sheet')} ${pi + 1}`, kind: 'sheet', items: [], background: 'light', paper: { x0: 0, y0: 0, x1: W * MM, y1: H * MM } }
    const page = new PageReader(scene, path, get, loadFont, view)
    await page.walk(root, [MM, 0, 0, -MM, 0, H * MM], 1)
    await Promise.all(page.decoding)
    view.items = mergePaths(view.items)
    scene.views.push(view)
  }
  if (!scene.views.length) throw new FormatError('no readable pages')
  scene.info.push(`${scene.views.length} ${scene.views.length === 1 ? 'sheet' : 'sheets'}`)
  return scene
}

class PageReader {
  private res = new Map<string, Element>()
  /** Image decodes started while reading; awaited before the page is shown. */
  decoding: Promise<void>[] = []
  constructor(
    private scene: Scene,
    private path: string,
    private get: (p: string) => Uint8Array | undefined,
    private loadFont: (uri: string, from: string) => Promise<string | undefined>,
    private view: SceneView
  ) {}

  private attrOrChild(el: Element, name: string): string | Element | null {
    const a = el.getAttribute(name)
    if (a !== null) {
      const m = /^\{StaticResource\s+([^}]+)\}$/.exec(a.trim())
      return m ? (this.res.get(m[1].trim()) ?? null) : a
    }
    for (const c of Array.from(el.children)) if (c.localName === `${el.localName}.${name}`) return c.firstElementChild
    return null
  }

  private resources(el: Element): void {
    for (const c of Array.from(el.children)) {
      if (!c.localName.endsWith('.Resources')) continue
      for (const dict of Array.from(c.children)) {
        if (dict.localName !== 'ResourceDictionary') continue
        const src = dict.getAttribute('Source')
        if (src) {
          const data = this.get(resolve(this.path, src))
          if (data) {
            const d = new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml')
            this.addDict(d.documentElement)
          }
        }
        this.addDict(dict)
      }
    }
  }

  private addDict(dict: Element | null): void {
    if (!dict) return
    for (const r of Array.from(dict.children)) {
      const key = r.getAttribute('x:Key') ?? r.getAttributeNS('http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key', 'Key') ?? r.getAttribute('Key')
      if (key) this.res.set(key, r)
    }
  }

  private transform(el: Element): Mat | null {
    const v = this.attrOrChild(el, 'RenderTransform')
    if (typeof v === 'string') return parseMatrix(v)
    if (v && v.localName === 'MatrixTransform') return parseMatrix(v.getAttribute('Matrix'))
    return null
  }

  async walk(el: Element, m: Mat, opacity: number): Promise<void> {
    this.resources(el)
    for (const c of Array.from(el.children)) {
      if (c.localName.includes('.')) continue // property elements
      const t = this.transform(c)
      const mm = t ? mul(m, t) : m
      const op = opacity * (Number(c.getAttribute('Opacity') ?? '1') || 0)
      if (op <= 0) continue
      if (c.localName === 'Canvas') {
        if (c.getAttribute('Clip') || Array.from(c.children).some((k) => k.localName === 'Canvas.Clip')) bump(this.scene.skipped, 'clipping (ignored)')
        await this.walk(c, mm, op)
      } else if (c.localName === 'Path') this.pathEl(c, mm, op)
      else if (c.localName === 'Glyphs') await this.glyphs(c, mm, op)
    }
  }

  private brush(v: string | Element | null): { rgb: number; a: number } | { image: Element } | null {
    if (v === null) return null
    if (typeof v === 'string') return parseColor(v)
    switch (v.localName) {
      case 'SolidColorBrush': {
        const c = parseColor(v.getAttribute('Color'))
        if (c) c.a *= Number(v.getAttribute('Opacity') ?? '1')
        return c
      }
      case 'ImageBrush':
        return { image: v }
      case 'LinearGradientBrush':
      case 'RadialGradientBrush': {
        bump(this.scene.skipped, 'gradient (first colour)')
        const stop = v.getElementsByTagName('GradientStop')[0]
        return stop ? parseColor(stop.getAttribute('Color')) : null
      }
      default:
        bump(this.scene.skipped, `${v.localName} brush`)
        return null
    }
  }

  private geometry(el: Element, m: Mat): { d: number[]; evenOdd: boolean } | null {
    const v = this.attrOrChild(el, 'Data')
    if (typeof v === 'string') return parsePathData(v, m)
    if (!v || v.localName !== 'PathGeometry') return null
    const gm = parseMatrix(v.getAttribute('Transform'))
    const mm = gm ? mul(m, gm) : m
    const evenOdd = (v.getAttribute('FillRule') ?? 'EvenOdd') !== 'NonZero'
    const fig = v.getAttribute('Figures')
    if (fig) return { d: parsePathData(fig, mm).d, evenOdd }
    const out: number[] = []
    for (const f of Array.from(v.children)) {
      if (f.localName !== 'PathFigure') continue
      let s = `M ${f.getAttribute('StartPoint') ?? '0,0'}`
      for (const seg of Array.from(f.children)) {
        const pts = seg.getAttribute('Points') ?? seg.getAttribute('Point') ?? ''
        switch (seg.localName) {
          case 'PolyLineSegment':
            s += ` L ${pts}`
            break
          case 'PolyBezierSegment':
            s += ` C ${pts}`
            break
          case 'PolyQuadraticBezierSegment':
            s += ` Q ${pts}`
            break
          case 'ArcSegment': {
            const [rx, ry] = (seg.getAttribute('Size') ?? '0,0').split(/[\s,]+/)
            s += ` A ${rx},${ry} ${seg.getAttribute('RotationAngle') ?? 0} ${seg.getAttribute('IsLargeArc') === 'true' ? 1 : 0} ${seg.getAttribute('SweepDirection') === 'Clockwise' ? 1 : 0} ${pts}`
            break
          }
        }
      }
      if (f.getAttribute('IsClosed') === 'true') s += ' Z'
      out.push(...parsePathData(s, mm).d)
    }
    return { d: out, evenOdd }
  }

  private pathEl(el: Element, m: Mat, opacity: number): void {
    const g = this.geometry(el, m)
    if (!g || !g.d.length) return
    const fill = this.brush(this.attrOrChild(el, 'Fill'))
    const stroke = this.brush(this.attrOrChild(el, 'Stroke'))
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
    if (fill && 'image' in fill) this.imageFill(fill.image, el, m, opacity)
    else if (fill && fill.a > 0)
      this.view.items.push({ k: 'path', layer: -1, color: fill.rgb, lw: 0, alpha: fill.a * opacity < 1 ? fill.a * opacity : undefined, d: g.d, stroke: false, fill: true, evenOdd: g.evenOdd })
    if (stroke && !('image' in stroke) && stroke.a > 0) {
      const th = Number(el.getAttribute('StrokeThickness') ?? '1')
      const dash = (el.getAttribute('StrokeDashArray') ?? '').trim()
      const join = (el.getAttribute('StrokeLineJoin') ?? 'Miter').toLowerCase() as CanvasLineJoin
      const cap = (el.getAttribute('StrokeStartLineCap') ?? 'Flat').toLowerCase()
      this.view.items.push({
        k: 'path',
        layer: -1,
        color: stroke.rgb,
        lw: 0,
        alpha: stroke.a * opacity < 1 ? stroke.a * opacity : undefined,
        d: g.d,
        stroke: true,
        fill: false,
        width: th > 0 ? th * scale : undefined,
        dash: dash ? dash.split(/[\s,]+/).map((v) => Number(v) * th * scale).filter(Number.isFinite) : undefined,
        join: join === 'round' || join === 'bevel' ? join : 'miter',
        cap: cap === 'round' ? 'round' : cap === 'square' ? 'square' : 'butt'
      })
    }
  }

  private imageFill(brush: Element, el: Element, m: Mat, opacity: number): void {
    const src = brush.getAttribute('ImageSource') ?? ''
    const vp = (brush.getAttribute('Viewport') ?? '').split(/[\s,]+/).map(Number)
    const item: ImageItem = { k: 'image', layer: -1, color: -1, lw: 0, src: null, m: [1, 0, 0, 1, 0, 0], alpha: opacity < 1 ? opacity : undefined }
    if (vp.length === 4 && vp.every(Number.isFinite)) item.m = mul(m, [vp[2], 0, 0, -vp[3], vp[0], vp[1] + vp[3]])
    else {
      const g = this.geometry(el, [1, 0, 0, 1, 0, 0])
      if (!g) return
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (let i = 0; i < g.d.length; i++) {
        if (g.d[i] === P.M || g.d[i] === P.L) {
          x0 = Math.min(x0, g.d[i + 1])
          x1 = Math.max(x1, g.d[i + 1])
          y0 = Math.min(y0, g.d[i + 2])
          y1 = Math.max(y1, g.d[i + 2])
        }
      }
      if (!(x1 > x0 && y1 > y0)) return
      item.m = mul(m, [x1 - x0, 0, 0, -(y1 - y0), x0, y1])
    }
    const data = this.get(resolve(this.path, src.replace(/^\{ColorConvertedBitmap\s+([^\s}]+).*$/, '$1')))
    this.view.items.push(item as Item)
    if (data) {
      const mime = data[0] === 0x89 ? 'image/png' : data[0] === 0xff ? 'image/jpeg' : ''
      if (mime)
        this.decoding.push(
          createImageBitmap(new Blob([data as BlobPart], { type: mime }))
            .then((b) => {
              item.src = b
            })
            .catch(() => bump(this.scene.skipped, 'image (undecodable)'))
        )
      else bump(this.scene.skipped, 'image (TIFF/WDP: frame only)')
    }
  }

  private async glyphs(el: Element, m: Mat, opacity: number): Promise<void> {
    let s = el.getAttribute('UnicodeString') ?? ''
    if (s.startsWith('{}')) s = s.slice(2)
    if (!s) {
      bump(this.scene.skipped, 'glyph-index-only text')
      return
    }
    const fill = this.brush(this.attrOrChild(el, 'Fill'))
    if (!fill || 'image' in fill) return
    const em = Number(el.getAttribute('FontRenderingEmSize') ?? '0')
    if (!(em > 0)) return
    const ox = Number(el.getAttribute('OriginX') ?? '0')
    const oy = Number(el.getAttribute('OriginY') ?? '0')
    const uri = el.getAttribute('FontUri')
    const family = uri ? await this.loadFont(uri, this.path) : undefined
    const sim = el.getAttribute('StyleSimulations') ?? ''
    // Glyph frame: x along the baseline, y up (glyphs are y-down in XPS): F = m · diag(1, -1).
    const a = m[0]
    const b = m[1]
    const c = -m[2]
    const d = -m[3]
    const sx = Math.hypot(a, b)
    const rot = Math.atan2(b, a)
    // Second column in the rotated frame.
    const cr = Math.cos(-rot)
    const sr = Math.sin(-rot)
    const c2 = cr * c - sr * d
    const d2 = sr * c + cr * d
    const s2 = Math.abs(d2) || sx
    const x = m[0] * ox + m[2] * oy + m[4]
    const y = m[1] * ox + m[3] * oy + m[5]
    const chars = Array.from(s)
    this.view.items.push({
      k: 'text',
      layer: -1,
      color: fill.rgb,
      lw: 0,
      alpha: fill.a * opacity < 1 ? fill.a * opacity : undefined,
      x,
      y,
      h: em * s2,
      emScale: 1,
      rot,
      wf: Math.abs(sx / s2 - 1) > 1e-6 ? sx / s2 : undefined,
      my: d2 < 0 || undefined,
      obl: Math.abs(c2) > 1e-9 ? Math.atan(c2 / s2) : undefined,
      family,
      bold: /Bold/.test(sim) || undefined,
      italic: /Italic/.test(sim) || undefined,
      text: s,
      advances: advancesFrom(el.getAttribute('Indices'), chars.length)
    })
  }
}
