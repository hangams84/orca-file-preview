/** OfficeArt BLIP records (pictures stored in .doc Data and .ppt Pictures streams). */
import type { Picture } from './model.ts'
import { inflateSync, unzlibSync } from '../../../vendor/zip.js'

const BLIP_TYPES: Record<number, string> = {
  0xf01a: 'emf',
  0xf01b: 'wmf',
  0xf01c: 'pict',
  0xf01d: 'image/jpeg',
  0xf01e: 'image/png',
  0xf01f: 'dib',
  0xf029: 'image/tiff',
  0xf02a: 'image/jpeg'
}

export function isBlipType(t: number): boolean {
  return t in BLIP_TYPES
}

/** Parses one blip record at `off` (its 8-byte header included). Metafiles are inflated and TIFF is
 *  kept as is (both converted later by office/images.ts); PICT returns null. */
export function readBlip(b: Uint8Array, off: number): { picture: Picture | null; end: number } | null {
  if (off + 8 > b.length) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const verInst = dv.getUint16(off, true)
  const type = dv.getUint16(off + 2, true)
  const len = dv.getUint32(off + 4, true)
  const kind = BLIP_TYPES[type]
  if (!kind || off + 8 + len > b.length) return null
  const end = off + 8 + len
  const inst = verInst >> 4
  const uids = 1 + (inst & 1)
  if (kind === 'pict') return { picture: null, end }
  if (kind === 'emf' || kind === 'wmf') {
    // OfficeArtMetafileHeader (34 bytes) after the UIDs: cbSize, rcBounds, ptSize, cbSave,
    // compression (0 = deflate, 0xFE = none), filter. The renderer turns these into PNG/SVG
    // (office/images.ts normalizePictures).
    const h = off + 8 + 16 * uids
    if (h + 34 > end) return { picture: null, end }
    const cbSave = dv.getUint32(h + 28, true)
    const compressed = b[h + 32] === 0
    const data = b.subarray(h + 34, Math.min(end, h + 34 + cbSave))
    let bytes: Uint8Array | null = data
    if (compressed) {
      try {
        bytes = unzlibSync(data)
      } catch {
        try {
          bytes = inflateSync(data)
        } catch {
          bytes = null
        }
      }
    }
    return { picture: bytes ? { bytes, mime: kind === 'emf' ? 'image/x-emf' : 'image/x-wmf' } : null, end }
  }
  const dataStart = off + 8 + 16 * uids + 1
  if (dataStart >= end) return { picture: null, end }
  const data = b.subarray(dataStart, end)
  if (kind === 'dib') return { picture: dibToBmp(data), end }
  return { picture: { bytes: data, mime: kind }, end }
}

/** A DIB (BITMAPINFOHEADER + pixels) becomes a BMP file by prefixing a BITMAPFILEHEADER. */
export function dibToBmp(dib: Uint8Array): Picture | null {
  if (dib.length < 40) return null
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength)
  const hdr = dv.getUint32(0, true)
  const bpp = dv.getUint16(14, true)
  const clrUsed = hdr >= 40 ? dv.getUint32(32, true) : 0
  const compression = hdr >= 40 ? dv.getUint32(16, true) : 0
  const palette = bpp <= 8 ? (clrUsed || 1 << bpp) * 4 : compression === 3 ? 12 : 0
  const out = new Uint8Array(14 + dib.length)
  const o = new DataView(out.buffer)
  out[0] = 0x42
  out[1] = 0x4d
  o.setUint32(2, out.length, true)
  o.setUint32(10, 14 + hdr + palette, true)
  out.set(dib, 14)
  return { bytes: out, mime: 'image/bmp' }
}

/** Finds pictures in a byte range by looking for blip records, then raw PNG / JPEG signatures. */
export function findPictures(b: Uint8Array, start: number, end: number): Picture[] {
  const out: Picture[] = []
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  end = Math.min(end, b.length)
  for (let i = start; i + 8 <= end; i++) {
    const t = dv.getUint16(i + 2, true)
    if ((dv.getUint16(i, true) & 0x0f) !== 0 || !isBlipType(t)) continue
    const r = readBlip(b, i)
    if (!r || r.end > end) continue
    if (r.picture) out.push(r.picture)
    i = r.end - 1
  }
  if (out.length) return out
  for (let i = start; i + 8 <= end; i++) {
    if (b[i] === 0x89 && b[i + 1] === 0x50 && b[i + 2] === 0x4e && b[i + 3] === 0x47) {
      out.push({ bytes: b.subarray(i, end), mime: 'image/png' })
      break
    }
    if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) {
      out.push({ bytes: b.subarray(i, end), mime: 'image/jpeg' })
      break
    }
  }
  return out
}
