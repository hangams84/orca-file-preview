/** Read-only source text with line numbers (SVG and HTML "Source" views), appended in chunks as
 *  the person scrolls so large files stay responsive. Mirrors the look of renderers/text.ts. */
import type { PreviewContext, ZoomController } from '../../core/types.ts'
import { createZoom, h } from '../../core/ui.ts'

const STYLE = `
.fp-src { margin: 0; padding: 10px 0; font: 13px/1.55 ui-monospace, "Cascadia Mono", Consolas, "D2Coding", Menlo, monospace;
  counter-reset: ln; tab-size: 4; }
.fp-src .ln { display: block; padding: 0 12px 0 64px; position: relative; white-space: pre; min-height: 1.55em; }
.fp-src.wrap .ln { white-space: pre-wrap; overflow-wrap: anywhere; }
.fp-src .ln::before { counter-increment: ln; content: counter(ln); position: absolute; left: 0; width: 52px;
  text-align: right; color: var(--orca-muted-foreground, #888); opacity: .7; user-select: none; }
@media (max-width: 600px) {
  .fp-src .ln { padding-left: 44px; }
  .fp-src .ln::before { width: 36px; }
}
`

const CHUNK = 2000

export interface SourceView {
  zoom: ZoomController
  show(): void
}

export function createSourceView(ctx: PreviewContext, text: string): SourceView {
  const { root } = ctx
  const style = h('style', undefined, STYLE)
  const pre = h('div', ctx.compact ? 'fp-src wrap' : 'fp-src')
  pre.setAttribute('role', 'document')
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  let shown = 0
  const more = () => {
    const frag = document.createDocumentFragment()
    const end = Math.min(lines.length, shown + CHUNK)
    for (; shown < end; shown++) frag.append(h('span', 'ln', lines[shown]))
    pre.append(frag)
  }
  const zoom = createZoom(1, (s) => {
    pre.style.fontSize = `${13 * s}px`
  }, undefined, { min: 0.5, max: 4 })
  return {
    zoom,
    show() {
      if (shown === 0) more()
      root.replaceChildren(style, pre)
      root.scrollTo(0, 0)
      root.onscroll = () => {
        if (shown < lines.length && root.scrollTop + root.clientHeight > root.scrollHeight - 600) more()
      }
    }
  }
}

/** A zoom controller that forwards to whichever view is active, so gestures bind once. */
export function switchableZoom(initial: ZoomController): { ctl: ZoomController; use(z: ZoomController): void } {
  let active = initial
  return {
    ctl: {
      get: () => active.get(),
      set: (s) => active.set(s),
      onChange: () => {}
    },
    use(z) {
      active = z
    }
  }
}
