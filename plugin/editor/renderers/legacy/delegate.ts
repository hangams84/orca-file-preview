/** Hands a file whose bytes belong to another format to that format's renderer in this plugin. */
import { PreviewError, type PreviewContext } from '../../core/types.ts'

/** Hands the bytes to another renderer of this plugin; if it fails, runs `fallback`. When the other
 *  renderer succeeds, `note` (e.g. "this .doc is really DOCX") is shown as a slim banner on top. */
export async function delegate(
  ctx: PreviewContext,
  load: () => Promise<{ render: (c: PreviewContext) => Promise<void | (() => void)> }>,
  fallback: () => Promise<void | (() => void)>,
  note?: string
): Promise<void | (() => void)> {
  try {
    const mod = await load()
    const cleanup = await mod.render(ctx)
    if (note && !ctx.signal.aborted) ctx.root.prepend(banner(note))
    return cleanup
  } catch (e) {
    if (ctx.signal.aborted) throw e
    console.warn('delegate renderer failed, using text fallback', e)
    ctx.root.replaceChildren()
    try {
      return await fallback()
    } catch (e2) {
      console.warn(e2)
      throw new PreviewError('ooxml', ctx.tr('문서 내용을 읽을 수 없습니다.', 'Could not read the document content.'))
    }
  }
}

function banner(text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'fp-format-note'
  el.setAttribute('role', 'note')
  el.textContent = text
  const s = el.style
  s.margin = '8px 12px 0'
  s.padding = '6px 10px'
  s.borderRadius = 'var(--orca-radius, 6px)'
  s.background = 'var(--orca-muted, #f4f4f5)'
  s.color = 'var(--orca-muted-foreground, #555)'
  s.fontSize = '12px'
  s.lineHeight = '1.4'
  return el
}
