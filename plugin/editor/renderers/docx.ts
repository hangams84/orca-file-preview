/** Word (.docx) via docx-preview (Apache-2.0). The document renders inside a shadow root so the
 *  library's injected styles stay scoped and never reach the toolbar. Two layouts: "page" (white
 *  paper at its real width, CSS zoom with fit-to-width) and "reading" (the paper's fixed width and
 *  margins dropped so text wraps at the viewport width at 100 %; the default on phones). */
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, cssZoom, h } from '../core/ui.ts'
import { renderAsync } from '../../vendor/docx.js'
import { applyTableLook, listIndentCss, padTableCells, wrapTables } from './office/docx-fixes.ts'
import { installOfficeFonts, OFFICE_SANS, patchCssFonts, withFallback } from './office/fonts.ts'

const SHADOW_STYLE = `
:host { display: block; }
.fp-docx-zoom { width: max-content; min-width: 100%; }
.fp-docx-body { display: block; font-family: ${OFFICE_SANS}; }
.fp-docx-body .docx-wrapper { background: transparent !important; padding: 16px 12px 24px !important;
  display: flex; flex-flow: column; align-items: center; }
.fp-docx-body .docx-wrapper > section.docx { background: #fff; color: #000; margin: 0 0 16px !important;
  box-shadow: 0 1px 4px rgba(0,0,0,.3); box-sizing: border-box; }
.fp-docx-body .docx-wrapper > section.docx > article { overflow-wrap: break-word; }
/* Reading layout: no fixed page width, margins or page height; text wraps at the viewport. */
.fp-docx-zoom.reading { width: auto; min-width: 0; }
.reading .docx-wrapper { padding: 0 !important; align-items: stretch; }
.reading .docx-wrapper > section.docx { width: auto !important; max-width: 100% !important; min-height: 0 !important;
  padding: 16px !important; margin: 0 0 2px !important; box-shadow: none; }
.reading .docx-wrapper > section.docx > header, .reading .docx-wrapper > section.docx > footer { display: none; }
.reading img, .reading svg, .reading canvas { max-width: 100% !important; height: auto !important; }
.reading .fp-docx-tscroll { overflow-x: auto; max-width: 100%; -webkit-overflow-scrolling: touch; }
.reading p, .reading span { overflow-wrap: anywhere; }
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
  const libCss: string[] = []
  for (const st of libStyle.querySelectorAll('style')) {
    st.textContent = patchCssFonts(st.textContent ?? '')
    libCss.push(st.textContent)
  }
  // List markers aligned at the hanging indent, table-style bands, cell padding, scrollable tables.
  libStyle.append(h('style', undefined, listIndentCss(libCss.join('\n'))))
  applyTableLook(body)
  wrapTables(body)
  padTableCells(body)
  for (const el of body.querySelectorAll<HTMLElement>('[style*="font-family"]')) {
    el.style.fontFamily = withFallback(el.style.fontFamily)
  }
  host.style.cssText = ''
  root.replaceChildren(host)

  const pages = body.querySelectorAll('section.docx')
  const count = pages.length
  toolbar.info(count ? `${count.toLocaleString()} ${tr('쪽', count === 1 ? 'page' : 'pages')}` : '')

  let reading = ctx.compact
  const naturalWidth = () => {
    if (reading) return root.clientWidth - 24 // fit = 100 %: text already wraps at the viewport
    let w = 0
    for (const p of pages) w = Math.max(w, (p as HTMLElement).offsetWidth)
    return w + 24
  }
  const modeBtn = toolbar.button({
    label: tr('읽기', 'Reading'),
    title: tr('읽기 모드 (화면 폭에 맞춰 줄바꿈) / 페이지 모드', 'Reading layout (wrap to the screen) / page layout'),
    onClick: () => setMode(!reading)
  })
  const zoom = cssZoom(zoomBox, root, naturalWidth)
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)
  const setMode = (next: boolean) => {
    reading = next
    zoomBox.classList.toggle('reading', reading)
    modeBtn.setAttribute('aria-pressed', String(reading))
    if (reading) zoom.set(1)
    else if (ctx.compact || naturalWidth() > root.clientWidth) zoom.fit?.()
    else zoom.set(1)
    root.scrollTo(0, 0)
  }
  // Phones read reflowed text; wider screens get pages, fitted when the paper is wider than the view.
  setMode(reading)
}
