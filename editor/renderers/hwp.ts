/** Hangul word processor files: .hwp (HWP 5.x, an OLE compound file of compressed record streams)
 *  and .hwpx (OWPML, a zip of XML parts). Both are read into one document model (hangul/model.ts)
 *  and drawn as Hangul lays them out, from the line positions Hangul saved in the file. */
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { guardZip } from './office/zipguard.ts'
import { HangulError, isHwp3, readHwp } from './hangul/hwp5.ts'
import { isZip, readHwpx } from './hangul/hwpx.ts'
import type { HangulDoc } from './hangul/model.ts'
import { renderHangul } from './hangul/view.ts'
import { isCfb } from './legacy/cfb.ts'

export async function render(ctx: PreviewContext): Promise<void | (() => void)> {
  const { bytes, tr, fileType } = ctx
  let doc: HangulDoc
  let note: string | undefined
  try {
    if (isZip(bytes)) {
      guardZip(bytes, tr)
      doc = readHwpx(bytes)
      if (fileType === 'hwp') note = tr('이 .hwp 파일은 실제로 HWPX 형식입니다.', 'This .hwp file is actually an HWPX document.')
    } else if (isCfb(bytes) || isHwp3(bytes)) {
      doc = readHwp(bytes)
      if (fileType === 'hwpx') note = tr('이 .hwpx 파일은 실제로 HWP 5 형식입니다.', 'This .hwpx file is actually an HWP 5 document.')
    } else {
      throw new HangulError('not-hwp')
    }
  } catch (e) {
    throw refusal(e, ctx)
  }
  if (ctx.signal.aborted) return
  return renderHangul(ctx, doc, { note })
}

function refusal(e: unknown, ctx: PreviewContext): Error {
  const { tr } = ctx
  if (e instanceof PreviewError) return e
  if (e instanceof HangulError) {
    switch (e.code) {
      case 'hwp3':
        return new PreviewError('hwp3', tr('구 버전 HWP 3.x 문서는 지원하지 않습니다. 한글에서 HWP 5 이상 형식으로 다시 저장해 주세요.', 'Old HWP 3.x documents are not supported. Save it again in Hangul as HWP 5 or later.'))
      case 'password':
        return new PreviewError('encrypted', tr('암호로 보호된 한글 문서입니다. 미리보기를 지원하지 않습니다.', 'This Hangul document is password-protected and cannot be previewed.'))
      case 'distribution':
        return new PreviewError('distribution', tr('배포용 한글 문서입니다. 배포용 문서는 내용이 암호화되어 있어 미리보기를 지원하지 않습니다.', 'This is a Hangul distribution document. Its content is encrypted, so it cannot be previewed.'))
      case 'drm':
        return new PreviewError('drm', tr('DRM으로 보호된 한글 문서입니다. 미리보기를 지원하지 않습니다.', 'This Hangul document is DRM-protected and cannot be previewed.'))
      case 'not-hwp':
        return new PreviewError('not-hwp', tr('한글(HWP/HWPX) 문서가 아닙니다.', 'This is not a Hangul (HWP/HWPX) document.'))
      default:
        console.warn('hwp: unreadable structure:', e.message)
        return new PreviewError('hwp', tr('한글 문서 구조를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.', 'Could not read the Hangul document structure; the file may be damaged.'))
    }
  }
  console.warn('hwp: unreadable structure:', e instanceof Error ? e.message : e)
  return new PreviewError('hwp', tr('한글 문서 구조를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.', 'Could not read the Hangul document structure; the file may be damaged.'))
}
