/** The preview image AutoCAD stores in a DWG file (R13 and later), read straight from the bytes so it
 *  can be shown when LibreDWG cannot read the drawing itself. Pure (thumbnail.test.ts). */

const SENTINEL = [0x1f, 0x25, 0x6d, 0x07, 0xd4, 0x36, 0x28, 0x28, 0x9d, 0x57, 0xca, 0x3f, 0x9d, 0x44, 0x10, 0x2b]

export interface Thumbnail {
  mime: 'image/bmp' | 'image/png'
  bytes: Uint8Array
}

/** `AC1032` → version label, or null when the bytes do not start like a DWG file. */
export function dwgVersion(bytes: Uint8Array): { code: string; label: string } | null {
  if (bytes.length < 6) return null
  const code = String.fromCharCode(...bytes.subarray(0, 6))
  if (!/^AC\d{4}$|^MC0\.0$|^AC1\.\d{2}$|^AC2\.\d{2}$/.test(code)) return null
  return { code, label: VERSION_LABELS[code] ?? code }
}

export const VERSION_LABELS: Record<string, string> = {
  'MC0.0': 'R1.0',
  AC1001: 'R2.2',
  AC1002: 'R2.5',
  AC1003: 'R2.6',
  AC1004: 'R9',
  AC1006: 'R10',
  AC1009: 'R11/R12',
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018'
}

export function extractThumbnail(bytes: Uint8Array): Thumbnail | null {
  if (bytes.length < 0x20) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const seeker = dv.getUint32(0x0d, true)
  if (seeker < 0x14 || seeker + 16 + 5 > bytes.length) return null
  for (let i = 0; i < 16; i++) if (bytes[seeker + i] !== SENTINEL[i]) return null
  let p = seeker + 16 + 4 // sentinel, overall size
  const count = bytes[p++]
  let bmp: Thumbnail | null = null
  for (let i = 0; i < count && p + 9 <= bytes.length; i++) {
    const code = bytes[p]
    const start = dv.getUint32(p + 1, true)
    const size = dv.getUint32(p + 5, true)
    p += 9
    if (!size || start + size > bytes.length) continue
    const data = bytes.subarray(start, start + size)
    if (code === 6 && data[0] === 0x89 && data[1] === 0x50) return { mime: 'image/png', bytes: data.slice() }
    if (code === 2 && !bmp) bmp = dibToBmp(data)
  }
  return bmp
}

/** A DIB (BITMAPINFOHEADER + palette + pixels) as a .bmp file the browser can decode. */
export function dibToBmp(dib: Uint8Array): Thumbnail | null {
  if (dib.length < 40) return null
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength)
  const headerSize = dv.getUint32(0, true)
  if (headerSize < 12 || headerSize > 124) return null
  const width = dv.getInt32(4, true)
  const height = dv.getInt32(8, true)
  const bits = dv.getUint16(14, true)
  if (width <= 0 || width > 4096 || height === 0 || Math.abs(height) > 4096 || ![1, 4, 8, 16, 24, 32].includes(bits)) return null
  let colours = dv.getUint32(32, true)
  if (!colours && bits <= 8) colours = 1 << bits
  const offset = 14 + headerSize + colours * 4
  const out = new Uint8Array(14 + dib.length)
  const o = new DataView(out.buffer)
  out[0] = 0x42 // B
  out[1] = 0x4d // M
  o.setUint32(2, out.length, true)
  o.setUint32(10, offset, true)
  out.set(dib, 14)
  return { mime: 'image/bmp', bytes: out }
}
