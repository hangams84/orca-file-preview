/** Zip safety checks before an OOXML/ODF package is inflated. fflate's `filter` callback sees each
 *  entry's declared sizes from the central directory, so returning `false` for every entry reads
 *  the manifest without inflating anything. Packages whose declared content is huge (zip bombs,
 *  or simply too big for a preview) are refused with a friendly error instead of exhausting memory. */
import { unzipSync } from '../../../vendor/zip.js'
import { PreviewError } from '../../core/types.ts'

export interface ZipEntryInfo {
  name: string
  /** Compressed size in bytes. */
  size: number
  /** Declared uncompressed size in bytes. */
  originalSize: number
}

/** Limits: total declared size, one entry, and a compression ratio that only bombs reach. */
/** Spreadsheets parse in a time-limited worker and their sheet XML is legitimately large. */
export const SHEET_ZIP_LIMITS = { totalBytes: 400 * 1024 * 1024, entryBytes: 400 * 1024 * 1024, ratio: 1000, ratioMinBytes: 20 * 1024 * 1024 }
export const ZIP_LIMITS = { totalBytes: 200 * 1024 * 1024, entryBytes: 120 * 1024 * 1024, ratio: 1000, ratioMinBytes: 20 * 1024 * 1024 }

export function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)
}

/** Entries with their declared sizes, without inflating. Throws when the zip cannot be read. */
export function zipManifest(bytes: Uint8Array): ZipEntryInfo[] {
  const out: ZipEntryInfo[] = []
  unzipSync(bytes, {
    filter: (f) => {
      out.push({ name: f.name, size: f.size, originalSize: f.originalSize })
      return false
    }
  })
  return out
}

export type ZipVerdict = { ok: true; entries: ZipEntryInfo[]; total: number } | { ok: false; reason: 'too-large' | 'bomb'; total: number }

/** Checks declared sizes against ZIP_LIMITS. */
export function checkZipManifest(entries: ZipEntryInfo[], limits = ZIP_LIMITS): ZipVerdict {
  let total = 0
  for (const e of entries) {
    total += e.originalSize
    if (e.originalSize >= limits.ratioMinBytes && e.originalSize / Math.max(1, e.size) > limits.ratio) return { ok: false, reason: 'bomb', total }
    if (e.originalSize > limits.entryBytes) return { ok: false, reason: 'too-large', total }
  }
  if (total > limits.totalBytes) return { ok: false, reason: 'too-large', total }
  return { ok: true, entries, total }
}

/** Throws a friendly PreviewError when a zip package declares too much content. Unreadable zips
 *  pass through so the renderer reports them as damaged in its own words. */
export function guardZip(bytes: Uint8Array, tr: (ko: string, en: string) => string, limits = ZIP_LIMITS): void {
  if (!isZip(bytes)) return
  let entries: ZipEntryInfo[]
  try {
    entries = zipManifest(bytes)
  } catch {
    return
  }
  const v = checkZipManifest(entries, limits)
  if (v.ok) return
  const mb = Math.round(v.total / 1048576).toLocaleString()
  throw new PreviewError(
    v.reason === 'bomb' ? 'zip-bomb' : 'zip-too-large',
    v.reason === 'bomb'
      ? tr('압축 해제 크기가 비정상적으로 큰 파일이라 열지 않습니다.', 'This file expands to an abnormal size when unpacked, so it is not opened.')
      : tr(`압축을 풀면 ${mb} MB라 미리보기에 너무 큽니다.`, `This file unpacks to ${mb} MB, which is too large to preview.`)
  )
}
