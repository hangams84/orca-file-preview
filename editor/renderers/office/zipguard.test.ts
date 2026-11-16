import { assert, test } from 'orca/testing'
import { checkZipManifest, isZip, zipManifest } from './zipguard.ts'
import { linkKind } from './links.ts'

/** A minimal stored (uncompressed) zip; `declared` overrides the central directory's size field. */
function zip(entries: { name: string; data: Uint8Array; declared?: number }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const name = enc.encode(e.name)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint32(18, e.data.length, true)
    lv.setUint32(22, e.data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const cd = new Uint8Array(46 + name.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint32(20, e.data.length, true)
    cv.setUint32(24, e.declared ?? e.data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    cd.set(name, 46)
    parts.push(local, e.data)
    central.push(cd)
    offset += local.length + e.data.length
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0))
  let p = 0
  for (const a of all) {
    out.set(a, p)
    p += a.length
  }
  return out
}

const MB = 1024 * 1024

test('reads declared sizes without inflating', () => {
  const z = zip([{ name: 'a.xml', data: new TextEncoder().encode('<a/>') }, { name: 'b.bin', data: new Uint8Array(10), declared: 300 * MB }])
  assert.ok(isZip(z))
  const m = zipManifest(z)
  assert.deepEqual(
    m.map((e) => [e.name, e.originalSize]),
    [['a.xml', 4], ['b.bin', 300 * MB]]
  )
})

test('flags bombs, oversized entries and oversized totals', () => {
  assert.equal(checkZipManifest([{ name: 'x', size: 1000, originalSize: 1000 }]).ok, true)
  const bomb = checkZipManifest([{ name: 'x', size: 10_000, originalSize: 300 * MB }])
  assert.ok(!bomb.ok && bomb.reason === 'bomb')
  const big = checkZipManifest([{ name: 'x', size: 60 * MB, originalSize: 130 * MB }])
  assert.ok(!big.ok && big.reason === 'too-large')
  const total = checkZipManifest(Array.from({ length: 3 }, (_, i) => ({ name: `p${i}`, size: 30 * MB, originalSize: 70 * MB })))
  assert.ok(!total.ok && total.reason === 'too-large')
  // A real 28 MB spreadsheet (66 MB sheet XML, ratio 2.4) is fine.
  assert.equal(checkZipManifest([{ name: 'sheet1.xml', size: 28 * MB, originalSize: 66 * MB }]).ok, true)
})

test('classifies document links', () => {
  assert.equal(linkKind('https://example.com'), 'external')
  assert.equal(linkKind(' http://x'), 'external')
  assert.equal(linkKind('mailto:a@b.c'), 'external')
  assert.equal(linkKind('#Bookmark1'), 'internal')
  for (const bad of ['javascript:alert(1)', ' JavaScript:x', 'data:text/html,x', 'vbscript:x', 'file:///c:/x', 'blob:x', '', '#', null, 'relative/path.docx', 'ftp://x'])
    assert.equal(linkKind(bad), 'blocked', String(bad))
})
