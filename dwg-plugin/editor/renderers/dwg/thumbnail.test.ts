import { assert, test } from 'orca/testing'
import { dibToBmp, dwgVersion, extractThumbnail } from './thumbnail.ts'

const SENTINEL = [0x1f, 0x25, 0x6d, 0x07, 0xd4, 0x36, 0x28, 0x28, 0x9d, 0x57, 0xca, 0x3f, 0x9d, 0x44, 0x10, 0x2b]

/** AC1015 header with an image section holding `entries` ([code, bytes]). */
function fakeDwg(entries: [number, Uint8Array][]): Uint8Array {
  const seeker = 0x40
  const table = 16 + 4 + 1 + 9 * entries.length
  const total = seeker + table + entries.reduce((a, [, b]) => a + b.length, 0)
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  out.set(new TextEncoder().encode('AC1015'))
  dv.setUint32(0x0d, seeker, true)
  out.set(SENTINEL, seeker)
  out[seeker + 20] = entries.length
  let p = seeker + 21
  let data = seeker + table
  for (const [code, bytes] of entries) {
    out[p] = code
    dv.setUint32(p + 1, data, true)
    dv.setUint32(p + 5, bytes.length, true)
    out.set(bytes, data)
    p += 9
    data += bytes.length
  }
  return out
}

function dib(w: number, h: number): Uint8Array {
  const rowBytes = Math.ceil((w * 24) / 32) * 4
  const b = new Uint8Array(40 + rowBytes * h)
  const dv = new DataView(b.buffer)
  dv.setUint32(0, 40, true)
  dv.setInt32(4, w, true)
  dv.setInt32(8, h, true)
  dv.setUint16(12, 1, true)
  dv.setUint16(14, 24, true)
  return b
}

test('version from the file header', () => {
  assert.deepEqual(dwgVersion(new TextEncoder().encode('AC1032xxxx')), { code: 'AC1032', label: 'AutoCAD 2018' })
  assert.equal(dwgVersion(new TextEncoder().encode('AC1014'))?.label, 'R14')
  assert.equal(dwgVersion(new TextEncoder().encode('PK\u0003\u0004')), null)
})

test('PNG preview is preferred and returned as is', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const t = extractThumbnail(fakeDwg([[1, new Uint8Array(4)], [2, dib(2, 2)], [6, png]]))
  assert.equal(t?.mime, 'image/png')
  assert.deepEqual(Array.from(t!.bytes), Array.from(png))
})

test('BMP preview gets a file header with the right pixel offset', () => {
  const t = extractThumbnail(fakeDwg([[2, dib(4, 3)]]))
  assert.equal(t?.mime, 'image/bmp')
  const b = t!.bytes
  assert.equal(String.fromCharCode(b[0], b[1]), 'BM')
  const dv = new DataView(b.buffer, b.byteOffset)
  assert.equal(dv.getUint32(2, true), b.length)
  assert.equal(dv.getUint32(10, true), 14 + 40) // 24-bit: no palette
})

test('8-bit DIB: palette counted in the pixel offset', () => {
  const d = dib(4, 4)
  new DataView(d.buffer).setUint16(14, 8, true)
  const t = dibToBmp(d)
  assert.equal(new DataView(t!.bytes.buffer).getUint32(10, true), 14 + 40 + 256 * 4)
})

test('no preview: bad seeker, wrong sentinel, empty section', () => {
  assert.equal(extractThumbnail(new Uint8Array(64)), null)
  const f = fakeDwg([[2, dib(2, 2)]])
  f[0x40] ^= 0xff
  assert.equal(extractThumbnail(f), null)
  assert.equal(extractThumbnail(fakeDwg([])), null)
})
