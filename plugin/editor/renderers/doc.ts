/** Word 97-2003 (.doc): an OLE compound file read without any library (legacy/cfb.ts, legacy/word.ts)
 *  and drawn as paper pages. A ".doc" that is really RTF, HTML, DOCX or plain text is detected from
 *  its bytes and shown sensibly with a note. */
import { decodeText, looksBinary } from '../core/encoding.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { isCfb, readCfb, type Cfb } from './legacy/cfb.ts'
import { renderPaper } from './legacy/paper.ts'
import { isRtf, readRtf } from './legacy/rtf.ts'
import { looksLikeHtml, looksLikeMime, readDocxText, readHtmlText, readPlainText } from './legacy/sniff.ts'
import { readWord, WordError } from './legacy/word.ts'
import { isZip } from './legacy/zip.ts'
import { delegate } from './legacy/delegate.ts'

export async function render(ctx: PreviewContext): Promise<void | (() => void)> {
  const { bytes, tr } = ctx

  if (isCfb(bytes)) {
    let cfb: Cfb
    try {
      cfb = readCfb(bytes)
    } catch {
      throw new PreviewError('cfb', tr('OLE 복합 문서 구조가 손상되었습니다.', 'The OLE compound file structure is damaged.'))
    }
    oleGuards(cfb, ctx)
    try {
      const model = readWord(cfb)
      const note = model.warnings.includes('old')
        ? tr('Word 6/95 형식: 서식 없이 텍스트만 표시합니다.', 'Word 6/95 format: showing text without formatting.')
        : undefined
      return renderPaper(ctx, model, { note })
    } catch (e) {
      if (e instanceof WordError && e.code === 'encrypted') throw encrypted(ctx)
      if (e instanceof PreviewError) throw e
      console.error(e)
      throw new PreviewError('word', tr('Word 문서 구조를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.', 'Could not read the Word document structure; the file may be damaged.'))
    }
  }

  if (isZip(bytes)) {
    const note = tr('이 .doc 파일은 실제로 DOCX(Word 2007+) 형식입니다.', 'This .doc file is actually a DOCX (Word 2007+) document.')
    return delegate(ctx, () => import('./docx.ts'), async () => {
        const model = await readDocxText(bytes)
        if (ctx.signal.aborted) return
        return renderPaper(ctx, model, { note: note + ' ' + tr('텍스트만 표시합니다.', 'Showing text only.') })
      },
      note
    )
  }
  if (isRtf(bytes)) {
    return renderPaper(ctx, readRtf(bytes), { note: tr('이 .doc 파일은 실제로 RTF 형식입니다.', 'This .doc file is actually in Rich Text Format (RTF).') })
  }
  if (looksLikeMime(bytes)) {
    throw new PreviewError(
      'mht',
      tr('이 .doc 파일은 웹 보관 파일(MHTML) 형식입니다. 원래 형식으로 다시 저장해 주세요.', 'This .doc file is a web archive (MHTML). Save it again as a Word document to preview it.')
    )
  }
  if (looksLikeHtml(bytes)) {
    const note = tr('이 .doc 파일은 실제로 HTML(웹 페이지) 형식입니다.', 'This .doc file is actually an HTML (web page) document.')
    return renderPaper(ctx, readHtmlText(bytes, (b) => decodeText(b).text), { note })
  }
  if (!looksBinary(bytes)) {
    const { text, encoding } = decodeText(bytes)
    return renderPaper(ctx, readPlainText(text, encoding.toUpperCase()), {
      note: tr('이 .doc 파일은 일반 텍스트입니다.', 'This .doc file is plain text.')
    })
  }
  throw new PreviewError('format', tr('Word 문서 형식이 아닙니다.', 'This is not a Word document.'))
}

function encrypted(ctx: PreviewContext): PreviewError {
  return new PreviewError(
    'encrypted',
    ctx.tr('암호로 보호된 문서입니다. 미리보기를 지원하지 않습니다.', 'This document is password-protected and cannot be previewed.')
  )
}

/** OLE files that are not Word documents get a helpful message instead of a parse failure. */
function oleGuards(cfb: Cfb, ctx: PreviewContext): void {
  const names = cfb.rootNames().map((n) => n.toLowerCase())
  const { tr } = ctx
  if (names.includes('encryptedpackage') || names.includes('encryptioninfo')) throw encrypted(ctx)
  if (names.includes('worddocument')) return
  if (names.includes('workbook') || names.includes('book'))
    throw new PreviewError('notword', tr('Word 문서가 아니라 Excel 통합 문서입니다. 확장자를 .xls로 바꿔 열어 보세요.', 'This is an Excel workbook, not a Word document. Rename it to .xls to preview it.'))
  if (names.includes('powerpoint document'))
    throw new PreviewError('notword', tr('Word 문서가 아니라 PowerPoint 프레젠테이션입니다. 확장자를 .ppt로 바꿔 열어 보세요.', 'This is a PowerPoint presentation, not a Word document. Rename it to .ppt to preview it.'))
  throw new PreviewError(
    'notword',
    tr('Word 문서가 아닌 OLE 복합 파일입니다.', 'This is an OLE compound file but not a Word document.'))
}
