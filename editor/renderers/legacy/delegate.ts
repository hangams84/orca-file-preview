/** Hands a file whose bytes belong to another format to that format's renderer in this plugin. */
import { PreviewError, type PreviewContext } from '../../core/types.ts'

/** Hands the bytes to another renderer of this plugin; if it fails, runs `fallback`. */
export async function delegate(
  ctx: PreviewContext,
  load: () => Promise<{ render: (c: PreviewContext) => Promise<void | (() => void)> }>,
  fallback: () => Promise<void | (() => void)>
): Promise<void | (() => void)> {
  try {
    const mod = await load()
    return await mod.render(ctx)
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
