/** Diagrams: draw.io (.drawio, .dio) and Visio (.vsdx, .vsdm, .vstx, .vssx) drawn as SVG on a
 *  paper canvas with page picker, pan/zoom/fit, a light/dark canvas switch and guarded links. */
import { decodeText } from '../core/encoding.ts'
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, h } from '../core/ui.ts'
import { PAGE_LINK_ATTR, type DiagramDoc } from './diagram/types.ts'
import { createImageView } from './media/image-view.ts'
import { bindZoomKeys } from './media/keys.ts'
import { guardLinks } from './office/links.ts'

const VISIO = new Set(['vsdx', 'vsdm', 'vstx', 'vstm', 'vssx', 'vssm'])
const CANVAS_KEY = 'file-preview.diagram.canvas'
/** Dark canvas: the drawing is inverted (hue kept), pictures are inverted back. */
const DARK_FILTER = 'invert(0.88) hue-rotate(180deg)'
const PICTURE_UNFILTER = 'hue-rotate(180deg) invert(1)'

function storedCanvas(): 'light' | 'dark' | null {
  try {
    const v = localStorage.getItem(CANVAS_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}
function storeCanvas(v: 'light' | 'dark'): void {
  try {
    localStorage.setItem(CANVAS_KEY, v)
  } catch {
    // storage unavailable: the choice lasts for this view only
  }
}

async function readDoc(ctx: PreviewContext): Promise<DiagramDoc> {
  const { bytes, fileType, tr } = ctx
  if (VISIO.has(fileType)) {
    const { readVisio } = await import('./diagram/visio.ts')
    return readVisio(bytes, ctx)
  }
  const { readDrawio } = await import('./diagram/drawio.ts')
  const { text } = decodeText(bytes)
  if (!/<mxfile[\s>]|<mxGraphModel[\s>]/.test(text.slice(0, 4096)) && !/<mxfile[\s>]|<mxGraphModel[\s>]/.test(text)) {
    throw new PreviewError('drawio', tr('draw.io 다이어그램(mxfile)을 찾을 수 없습니다.', 'No draw.io diagram (mxfile) was found in the file.'))
  }
  return readDrawio(text, tr)
}

export async function render(ctx: PreviewContext): Promise<void> {
  const { toolbar, tr, signal, root, bytes } = ctx
  const doc = await readDoc(ctx)
  if (signal.aborted) return
  const pages = [...doc.pages.filter((p) => !p.background), ...doc.pages.filter((p) => p.background)]
  if (!pages.length) throw new PreviewError('diagram-empty', tr('다이어그램에 페이지가 없습니다.', 'The diagram has no pages.'))

  let canvas: 'light' | 'dark' = storedCanvas() ?? 'light'
  let index = 0
  let pageAbort: AbortController | null = null
  let current: { layer: HTMLElement; box: HTMLElement } | null = null

  const paint = () => {
    if (!current) return
    const dark = canvas === 'dark'
    current.box.style.background = '#ffffff'
    current.layer.style.filter = dark ? DARK_FILTER : ''
    for (const img of current.layer.querySelectorAll<SVGElement | HTMLElement>('image, img')) img.style.filter = dark ? PICTURE_UNFILTER : ''
  }

  let select: HTMLSelectElement | null = null
  if (pages.length > 1) {
    select = toolbar.select(
      tr('페이지', 'Page'),
      pages.map((p, i) => ({ value: String(i), label: p.background ? `${p.name} ${tr('(배경)', '(background)')}` : p.name })),
      (v) => void show(Number(v))
    )
  }
  const canvasBtn = toolbar.button({
    label: '◐',
    title: tr('어두운 캔버스', 'Dark canvas'),
    onClick: () => {
      canvas = canvas === 'dark' ? 'light' : 'dark'
      storeCanvas(canvas)
      canvasBtn.setAttribute('aria-pressed', String(canvas === 'dark'))
      paint()
    }
  })
  canvasBtn.setAttribute('aria-pressed', String(canvas === 'dark'))

  const show = async (i: number): Promise<void> => {
    index = i
    if (select) select.value = String(i)
    pageAbort?.abort()
    const ac = new AbortController()
    pageAbort = ac
    const stop = () => ac.abort()
    signal.addEventListener('abort', stop, { once: true })
    ac.signal.addEventListener('abort', () => signal.removeEventListener('abort', stop), { once: true })
    const page = pages[i]
    const built = await page.build()
    if (ac.signal.aborted || signal.aborted) return
    const svg = built.svg
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', page.name)
    svg.style.cssText = 'display:block;width:100%;height:100%;overflow:hidden'
    const layer = h('div')
    layer.append(svg)
    const pageCtx = { ...ctx, signal: ac.signal }
    const view = createImageView(pageCtx, layer, { width: built.width, height: built.height }, { pixelate: false, upscale: false, backdropKey: 'diagram', backdropPicker: false })
    layer.style.lineHeight = 'normal'
    layer.style.background = '#ffffff'
    current = { layer, box: view.box }
    paint()
    const box = view.box
    // Page links switch pages here; web links go through the shared confirm bar.
    box.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.(`a[${PAGE_LINK_ATTR}]`)
        if (!a) return
        e.preventDefault()
        e.stopImmediatePropagation()
        const id = a.getAttribute(PAGE_LINK_ATTR)
        const to = pages.findIndex((p) => p.id === id)
        if (to >= 0) void show(to)
      },
      { capture: true, signal: ac.signal }
    )
    guardLinks({ target: box, root, tr, signal: ac.signal })
    toolbar.zoom(view.zoom)
    bindZoomGestures(root, view.zoom, ac.signal)
    bindZoomKeys(root, view.zoom, ac.signal)
    const s = built.stats
    const parts = [
      doc.format,
      pages.length > 1 ? `${tr('페이지', 'page')} ${i + 1}/${pages.length}` : '',
      `${Math.round(built.width)} × ${Math.round(built.height)}`,
      tr(`도형 ${s.shapes}개`, `${s.shapes} shape${s.shapes === 1 ? '' : 's'}`),
      s.links ? tr(`링크 ${s.links}개`, `${s.links} link${s.links === 1 ? '' : 's'}`) : '',
      s.fallbacks ? tr(`대체 표시 ${s.fallbacks}개`, `${s.fallbacks} shown as boxes`) : '',
      formatBytes(bytes.byteLength)
    ]
    toolbar.info(parts.filter(Boolean).join(' · '))
  }

  // Arrow keys / PageUp/PageDown move between pages.
  root.addEventListener(
    'keydown',
    (e) => {
      if (pages.length < 2 || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      if (e.key === 'PageDown') void show(Math.min(pages.length - 1, index + 1))
      else if (e.key === 'PageUp') void show(Math.max(0, index - 1))
      else return
      e.preventDefault()
    },
    { signal }
  )
  await show(0)
}
