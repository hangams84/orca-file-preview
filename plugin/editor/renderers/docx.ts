/** Word (.docx) via docx-preview (Apache-2.0). The document renders inside a shadow root so the
 *  library's injected styles stay scoped and never reach the toolbar. Pages are white paper on the
 *  Orca background; zoom is CSS zoom with fit-to-width (the default on phones). */
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, cssZoom, h } from '../core/ui.ts'
import { renderAsync } from '../../vendor/docx.js'
import { installOfficeFonts, OFFICE_SANS, patchCssFonts, withFallback } from './office/fonts.ts'

const SHADOW_STYLE = `
:host { display: block; }
.fp-docx-zoom { width: max-content; min-width: 100%; }
.fp-docx-body { display: block; font-family: ${OFFICE_SANS}; }
.fp-docx-body .docx-wrapper { background: transparent !important; padding: 16px 12px 24px !important;
  display: flex; flex-flow: column; align-items: center; }
.fp-docx-body .docx-wrapper > section.docx { background: #fff; color: #000; margin: 0 0 16px !important;
  box-shadow: 0 1px 4px rgba(0,0,0,.3); box-sizing: border-box; }
`

function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)
}

export async function render(ctx: PreviewContext): Promise<void> {
  const { bytes, root, toolbar, tr, signal } = ctx
  if (!isZip(bytes)) {
    throw new PreviewError(
      'not-zip',
      tr('올바른 Word(.docx) 파일이 아닙니다. 파일이 손상되었을 수 있습니다.', 'This is not a valid Word (.docx) file. It may be damaged.')
    )
  }

  installOfficeFonts()
  const host = h('div', 'fp-docx-host')
  const shadow = host.attachShadow({ mode: 'open' })
  const ownStyle = h('style', undefined, SHADOW_STYLE)
  const libStyle = h('div')
  const zoomBox = h('div', 'fp-docx-zoom')
  const body = h('div', 'fp-docx-body')
  zoomBox.append(body)
  shadow.append(ownStyle, libStyle, zoomBox)

  // Render off-screen first (attached so docx-preview can measure), then swap in.
  host.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:100%'
  root.append(host)
  try {
    await renderAsync(bytes, body, libStyle, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      experimental: true,
      useBase64URL: false,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderChanges: false,
      renderComments: false
    })
  } catch (err) {
    host.remove()
    console.error(err)
    throw new PreviewError(
      'docx',
      tr('Word 문서를 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 변형일 수 있습니다.', 'Cannot read this Word document. It may be damaged or use an unsupported variant.')
    )
  }
  if (signal.aborted) return

  // docx-preview's font blobs are object URLs it never revokes; it also adds <style> nodes only
  // into libStyle, which lives in the shadow root.
  // Office fonts missing on this device: give every font-family a sans/serif fallback chain so the
  // browser never drops to its default serif (aliases for known names come from installOfficeFonts).
  for (const st of libStyle.querySelectorAll('style')) st.textContent = patchCssFonts(st.textContent ?? '')
  for (const el of body.querySelectorAll<HTMLElement>('[style*="font-family"]')) {
    el.style.fontFamily = withFallback(el.style.fontFamily)
  }
  host.style.cssText = ''
  root.replaceChildren(host)

  const pages = body.querySelectorAll('section.docx')
  const count = pages.length
  toolbar.info(count ? `${count.toLocaleString()} ${tr('쪽', count === 1 ? 'page' : 'pages')}` : '')

  const naturalWidth = () => {
    let w = 0
    for (const p of pages) w = Math.max(w, (p as HTMLElement).offsetWidth)
    return w + 24
  }
  const zoom = cssZoom(zoomBox, root, naturalWidth)
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)
  // Phones (and any viewport narrower than the paper) start fitted to the width.
  if (ctx.compact || naturalWidth() > root.clientWidth) zoom.fit?.()
}
