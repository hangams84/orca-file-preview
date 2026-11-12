/** SVG: drawn as <img src=blob:image/svg+xml>, so scripts and external loads inside the file never
 *  run (image documents are inert). Same fit/zoom stage as raster images plus a Source toggle. */
import { decodeText } from '../core/encoding.ts'
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, h, objectUrl } from '../core/ui.ts'
import { createImageView, loadImage } from './media/image-view.ts'
import { createSourceView, switchableZoom } from './media/source-view.ts'

/** Intrinsic size from width/height or the viewBox, parsed as inert XML. */
function svgSize(text: string): { width: number; height: number } | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null
  const num = (v: string | null) => {
    if (!v || /%$/.test(v.trim())) return NaN
    return parseFloat(v)
  }
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const vbW = vb.length === 4 ? vb[2] : NaN
  const vbH = vb.length === 4 ? vb[3] : NaN
  let w = num(svg.getAttribute('width'))
  let hh = num(svg.getAttribute('height'))
  if (!(w > 0) && !(hh > 0) && vbW > 0 && vbH > 0) {
    w = vbW
    hh = vbH
  } else if (!(w > 0) && hh > 0 && vbW > 0 && vbH > 0) w = (hh * vbW) / vbH
  else if (!(hh > 0) && w > 0 && vbW > 0 && vbH > 0) hh = (w * vbH) / vbW
  return w > 0 && hh > 0 ? { width: w, height: hh } : null
}

export async function render(ctx: PreviewContext): Promise<void> {
  const { bytes, toolbar, tr, signal, root } = ctx
  const { text, encoding } = decodeText(bytes)
  if (!/<svg[\s>]/i.test(text)) {
    throw new PreviewError(
      'svg',
      tr('파일에서 <svg> 요소를 찾을 수 없습니다.', 'No <svg> element was found in the file.')
    )
  }
  const source = createSourceView(ctx, text)
  // Re-encode as UTF-8 only when the file was not UTF-8, so the image decoder reads it right.
  const blobBytes = encoding === 'utf-8' ? bytes : new TextEncoder().encode(text.replace(/encoding\s*=\s*["'][^"']*["']/, 'encoding="UTF-8"'))
  const url = objectUrl(blobBytes, 'image/svg+xml', signal)
  let img: HTMLImageElement | null = null
  try {
    img = await loadImage(url)
  } catch {
    img = null
  }
  if (signal.aborted) return
  const parsed = svgSize(text)
  const info = (dims: string) =>
    toolbar.info([dims, formatBytes(bytes.byteLength), `SVG · ${encoding.toUpperCase()}`].filter(Boolean).join(' · '))

  if (!img) {
    // Malformed XML: show the source with a note instead of a dead end.
    const sw = switchableZoom(source.zoom)
    source.show()
    const note = h('div', 'fp-state')
    note.style.minHeight = '0'
    note.append(
      h('h2', undefined, tr('SVG 이미지를 그릴 수 없습니다', 'Cannot draw this SVG')),
      h('div', undefined, tr('XML 오류가 있을 수 있습니다. 원본을 표시합니다.', 'The XML may be malformed. Showing the source instead.'))
    )
    root.prepend(note)
    info('')
    toolbar.zoom(source.zoom)
    bindZoomGestures(root, sw.ctl, signal)
    return
  }

  const natural = parsed ?? { width: img.naturalWidth || 300, height: img.naturalHeight || 150 }
  const view = createImageView(ctx, img, natural, { pixelate: false, upscale: true, backdropKey: 'svg', defaultBackdrop: 'checker-light' })
  const sw = switchableZoom(view.zoom)
  let showingSource = false
  const btn = toolbar.button({
    label: tr('원본', 'Source'),
    title: tr('SVG 원본 보기', 'Show SVG source'),
    onClick: () => {
      showingSource = !showingSource
      btn.setAttribute('aria-pressed', String(showingSource))
      if (showingSource) {
        source.show()
        sw.use(source.zoom)
        toolbar.zoom(source.zoom)
      } else {
        view.show()
        sw.use(view.zoom)
        toolbar.zoom(view.zoom)
      }
    }
  })
  btn.setAttribute('aria-pressed', 'false')
  info(`${Math.round(natural.width)} × ${Math.round(natural.height)}`)
  toolbar.zoom(view.zoom)
  bindZoomGestures(root, sw.ctl, signal)
}
