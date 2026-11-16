/** Just enough ZIP to read a few XML parts from an OOXML file that carries a legacy suffix
 *  (a .doc that is really .docx). Inflates with the browser's DecompressionStream, or with fflate
 *  where 'deflate-raw' is not supported (Safari before 16.4). */
import { inflateSync } from '../../../vendor/zip.js'

export interface ZipEntry {
  name: string
  method: number
  compSize: number
  localOffset: number
}

export function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

export function listZip(b: Uint8Array): ZipEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip: no end of central directory')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out: ZipEntry[] = []
  const dec = new TextDecoder()
  for (let k = 0; k < count && p + 46 <= b.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    out.push({ name: dec.decode(b.subarray(p + 46, p + 46 + nameLen)), method, compSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export async function readZipEntry(b: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const p = e.localOffset
  if (dv.getUint32(p, true) !== 0x04034b50) throw new Error('zip: bad local header')
  const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true)
  const raw = b.subarray(start, start + e.compSize)
  if (e.method === 0) return raw
  if (e.method !== 8) throw new Error(`zip: method ${e.method}`)
  if (hasDeflateRaw()) {
    const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  return inflateSync(raw)
}

export async function readZipText(b: Uint8Array, entries: ZipEntry[], name: string): Promise<string | null> {
  const e = entries.find((x) => x.name === name)
  return e ? new TextDecoder().decode(await readZipEntry(b, e)) : null
}

let deflateRaw: boolean | null = null
/** DecompressionStream exists and accepts 'deflate-raw' (it throws on unknown formats). */
export function hasDeflateRaw(): boolean {
  if (deflateRaw != null) return deflateRaw
  try {
    new DecompressionStream('deflate-raw')
    deflateRaw = true
  } catch {
    deflateRaw = false
  }
  return deflateRaw
}
