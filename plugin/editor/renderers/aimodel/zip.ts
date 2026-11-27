/** A ZIP reader over a ByteSource that reads only what it is asked for: the central directory up
 *  front, then single entries. ZIP64 (PyTorch checkpoints over 4 GB) is supported. Stored entries are
 *  exposed as sub-sources (ranged reads into the archive, used for tensor storages); deflated entries
 *  are inflated whole (fflate). */
import { inflateSync } from '../../../vendor/zip.js'
import { PreviewError } from '../../core/types.ts'
import { subSource } from './bytes.ts'
import type { ByteSource } from './ir.ts'

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  /** Offset of the local file header. */
  headerOffset: number
}

export interface ZipArchive {
  entries: ZipEntry[]
  get(name: string): ZipEntry | undefined
  /** Whole (decompressed) bytes of an entry. */
  read(entry: ZipEntry | string): Promise<Uint8Array>
  /** A ranged source over a stored (uncompressed) entry; for deflated entries the entry is inflated
   *  first and served from memory. */
  source(entry: ZipEntry | string): Promise<ByteSource>
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

/** True when the source starts like a ZIP archive. */
export async function isZip(src: ByteSource): Promise<boolean> {
  const h = await src.read(0, 4)
  return h.length === 4 && h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5) && (h[3] === 4 || h[3] === 6)
}

export async function openZip(src: ByteSource): Promise<ZipArchive> {
  const tailLen = Math.min(src.size, 65557 + 20)
  const tail = await src.read(src.size - tailLen, tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new PreviewError('zip-no-directory', 'The ZIP directory is missing: the file may be truncated.')
  const t = dv(tail)
  let count = t.getUint16(eocd + 10, true)
  let cdSize = t.getUint32(eocd + 12, true)
  let cdOffset = t.getUint32(eocd + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // ZIP64 end-of-central-directory locator sits right before the EOCD.
    const loc = eocd - 20
    if (loc >= 0 && t.getUint32(loc, true) === 0x07064b50) {
      const recOff = Number(t.getBigUint64(loc + 8, true))
      const rec = await src.read(recOff, 56)
      const r = dv(rec)
      if (r.getUint32(0, true) !== 0x06064b50) throw new PreviewError('zip64-bad', 'The ZIP64 directory is damaged.')
      count = Number(r.getBigUint64(32, true))
      cdSize = Number(r.getBigUint64(40, true))
      cdOffset = Number(r.getBigUint64(48, true))
    }
  }
  if (cdOffset + cdSize > src.size) throw new PreviewError('zip-truncated', 'The ZIP archive is truncated.')
  const cd = await src.read(cdOffset, cdSize)
  const c = dv(cd)
  const entries: ZipEntry[] = []
  const dec = new TextDecoder()
  let p = 0
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (c.getUint32(p, true) !== 0x02014b50) break
    const method = c.getUint16(p + 10, true)
    let compressedSize = c.getUint32(p + 20, true)
    let size = c.getUint32(p + 24, true)
    const nameLen = c.getUint16(p + 28, true)
    const extraLen = c.getUint16(p + 30, true)
    const commentLen = c.getUint16(p + 32, true)
    let headerOffset = c.getUint32(p + 42, true)
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen))
    // ZIP64 extra field (0x0001): the 64-bit values for fields that were 0xFFFFFFFF, in this order.
    let e = p + 46 + nameLen
    const eEnd = e + extraLen
    while (e + 4 <= eEnd) {
      const id = c.getUint16(e, true)
      const len = c.getUint16(e + 2, true)
      if (id === 1) {
        let q = e + 4
        if (size === 0xffffffff) (size = Number(c.getBigUint64(q, true))), (q += 8)
        if (compressedSize === 0xffffffff) (compressedSize = Number(c.getBigUint64(q, true))), (q += 8)
        if (headerOffset === 0xffffffff) headerOffset = Number(c.getBigUint64(q, true))
      }
      e += 4 + len
    }
    entries.push({ name, method, compressedSize, size, headerOffset })
    p = eEnd + commentLen
  }
  const byName = new Map(entries.map((x) => [x.name, x]))
  const resolve = (x: ZipEntry | string): ZipEntry => {
    const en = typeof x === 'string' ? byName.get(x) : x
    if (!en) throw new PreviewError('zip-entry-missing', `Missing archive entry ${String(x)}`)
    return en
  }
  async function dataOffset(en: ZipEntry): Promise<number> {
    const lh = await src.read(en.headerOffset, 30)
    const l = dv(lh)
    if (lh.length < 30 || l.getUint32(0, true) !== 0x04034b50) throw new PreviewError('zip-bad-entry', `Damaged archive entry ${en.name}`)
    return en.headerOffset + 30 + l.getUint16(26, true) + l.getUint16(28, true)
  }
  async function read(x: ZipEntry | string): Promise<Uint8Array> {
    const en = resolve(x)
    const off = await dataOffset(en)
    const raw = await src.read(off, en.compressedSize)
    if (en.method === 0) return raw
    if (en.method === 8) return inflateSync(raw, { out: new Uint8Array(en.size) })
    throw new PreviewError('zip-method', `Unsupported ZIP compression method ${en.method}`)
  }
  async function source(x: ZipEntry | string): Promise<ByteSource> {
    const en = resolve(x)
    if (en.method === 0) return subSource(src, await dataOffset(en), en.size)
    const bytes = await read(en)
    return { size: bytes.byteLength, read: async (o, n) => bytes.subarray(o, Math.min(bytes.byteLength, o + n)) }
  }
  return { entries, get: (n) => byName.get(n), read, source }
}
