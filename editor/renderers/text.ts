/** Plain text (.txt, .log): encoding detection with a manual override, line numbers, word wrap. */
import { decodeText, FALLBACK_ENCODINGS, looksBinary } from '../core/encoding.ts'
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, createZoom, h } from '../core/ui.ts'

const STYLE = `
.fp-text { margin: 0; padding: 10px 0; font: 13px/1.55 ui-monospace, "Cascadia Mono", Consolas, "D2Coding", Menlo, monospace;
  counter-reset: ln; tab-size: 4; }
.fp-text .ln { display: block; padding: 0 12px; white-space: pre; min-height: 1.55em; }
.fp-text.wrap .ln { white-space: pre-wrap; overflow-wrap: anywhere; }
.fp-text.numbers .ln { padding-left: 64px; position: relative; }
.fp-text.numbers .ln::before { counter-increment: ln; content: counter(ln); position: absolute; left: 0; width: 52px;
  text-align: right; color: var(--orca-muted-foreground, #888); opacity: .7; user-select: none; }
`

/** Lines rendered per chunk; long files keep appending while the person scrolls. */
const CHUNK = 2000

export async function render(ctx: PreviewContext): Promise<void> {
  const { bytes, root, toolbar, tr, signal } = ctx
  if (looksBinary(bytes)) {
    throw new PreviewError('binary', tr('텍스트가 아닌 바이너리 파일로 보입니다.', 'This looks like a binary file, not text.'))
  }
  const style = h('style', undefined, STYLE)
  const pre = h('div', 'fp-text numbers')
  pre.setAttribute('role', 'document')

  let wrap = ctx.compact
  let numbers = !ctx.compact
  const paint = (encoding?: string) => {
    const { text, encoding: used } = decodeText(bytes, encoding)
    const lines = text.split(/\r\n|\r|\n/)
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
    pre.replaceChildren()
    let shown = 0
    const more = () => {
      const frag = document.createDocumentFragment()
      const end = Math.min(lines.length, shown + CHUNK)
      for (; shown < end; shown++) frag.append(h('span', 'ln', lines[shown]))
      pre.append(frag)
    }
    more()
    root.onscroll = () => {
      if (shown < lines.length && root.scrollTop + root.clientHeight > root.scrollHeight - 600) more()
    }
    toolbar.info(`${used.toUpperCase()} · ${lines.length.toLocaleString()} ${tr('줄', 'lines')} · ${formatBytes(bytes.byteLength)}`)
    return used
  }

  const used = paint()
  const wrapBtn = toolbar.button({
    label: tr('줄바꿈', 'Wrap'),
    title: tr('자동 줄바꿈', 'Word wrap'),
    onClick: () => {
      wrap = !wrap
      sync()
    }
  })
  const numBtn = toolbar.button({
    label: '#',
    title: tr('줄 번호', 'Line numbers'),
    onClick: () => {
      numbers = !numbers
      sync()
    }
  })
  const sync = () => {
    pre.classList.toggle('wrap', wrap)
    pre.classList.toggle('numbers', numbers)
    wrapBtn.setAttribute('aria-pressed', String(wrap))
    numBtn.setAttribute('aria-pressed', String(numbers))
  }
  sync()
  const enc = toolbar.select(
    tr('인코딩', 'Encoding'),
    ['utf-8', 'utf-16le', 'utf-16be', ...FALLBACK_ENCODINGS].map((e) => ({ value: e, label: e.toUpperCase() })),
    (v) => paint(v)
  )
  enc.value = used

  const zoom = createZoom(1, (s) => {
    pre.style.fontSize = `${13 * s}px`
  }, undefined, { min: 0.5, max: 4 })
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)
  root.replaceChildren(style, pre)
}
