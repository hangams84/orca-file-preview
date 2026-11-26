import { assert, test } from 'orca/testing'
import { EDZ, ZW1 } from './fixtures.ts'
import { decodeLzma2, LzmaError, parseLzmaPropsByte } from './lzma.ts'
import { is7z, readSevenZip, SevenZipError } from './sevenzip.ts'

const text = (b: Uint8Array) => new TextDecoder().decode(b)

test('lzma: property byte', () => {
  assert.deepEqual(parseLzmaPropsByte(93), { lc: 3, lp: 0, pb: 2 })
  assert.throws(() => parseLzmaPropsByte(225), (e) => e instanceof LzmaError)
})

test('lzma2: stored chunks and errors', () => {
  // 0x01 = stored chunk with dictionary reset, size 5 (stored as size-1), then end.
  const src = Uint8Array.from([0x01, 0x00, 0x04, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00])
  assert.equal(text(decodeLzma2(src, 5)), 'hello')
  assert.throws(() => decodeLzma2(src, 6), (e) => e instanceof LzmaError)
  assert.throws(() => decodeLzma2(Uint8Array.from([0x02, 0, 0, 0x41, 0]), 1), (e) => e instanceof LzmaError)
  assert.throws(() => decodeLzma2(src.subarray(0, 4), 5), (e) => e instanceof LzmaError)
})

test('7z: solid LZMA2 block behind an LZMA-encoded header (sample.zw1)', () => {
  assert.ok(is7z(ZW1))
  const z = readSevenZip(ZW1)
  assert.ok(z.solid)
  assert.ok(z.methods.includes('LZMA2'))
  const names = z.entries.map((e) => e.path)
  assert.ok(names.includes('ProjectInfo.xml'))
  assert.ok(names.includes('Images/orca-logo.png'))
  const dir = z.entries.find((e) => e.path === 'Images')!
  assert.ok(dir.dir)
  const info = z.entries.find((e) => e.path === 'ProjectInfo.xml')!
  assert.match(text(z.read(info)), /<Property name="Project number" id="10013"[^>]*>FP-0001</)
  const png = z.read(z.entries.find((e) => e.path === 'Images/orca-logo.png')!)
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  // Every file decodes to its declared size.
  for (const e of z.entries) if (!e.dir) assert.equal(z.read(e).length, e.size, e.path)
})

test('7z: one LZMA block per file (sample.edz)', () => {
  const z = readSevenZip(EDZ)
  assert.equal(z.solid, false)
  assert.deepEqual(z.methods, ['LZMA'])
  const manifest = z.entries.find((e) => e.path === 'manifest.xml')!
  assert.match(text(z.read(manifest)), /<manifest version="2.0">/)
  const pdf = z.read(z.entries.find((e) => e.path.endsWith('.pdf'))!)
  assert.equal(text(pdf.subarray(0, 5)), '%PDF-')
})

test('7z: damaged archives fail with SevenZipError', () => {
  assert.throws(() => readSevenZip(new Uint8Array(40)), (e) => e instanceof SevenZipError && e.code === 'not-7z')
  assert.throws(() => readSevenZip(EDZ.subarray(0, 400)), (e) => e instanceof SevenZipError)
  // A flipped byte inside a packed stream: decoding must fail or differ, never hang.
  const bad = EDZ.slice()
  bad[200] ^= 0xff
  try {
    const z = readSevenZip(bad)
    for (const e of z.entries) if (!e.dir) z.read(e)
  } catch (e) {
    assert.ok(e instanceof Error)
  }
})
