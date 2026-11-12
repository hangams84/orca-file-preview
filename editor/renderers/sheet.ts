/** TODO(sheet): implemented by a worker. */
import { PreviewError, type PreviewContext } from '../core/types.ts'

export async function render(ctx: PreviewContext): Promise<void> {
  throw new PreviewError('todo', ctx.tr('아직 구현되지 않았습니다 (sheet).', 'Not implemented yet (sheet).'))
}
