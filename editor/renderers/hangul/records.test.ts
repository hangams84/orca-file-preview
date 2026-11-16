import { assert, test } from 'orca/testing'
import {
  buildTree,
  colorRef,
  controlKind,
  ctrlId,
  ctrlName,
  decodeParaText,
  hwpToMm,
  hwpToPt,
  hwpToPx,
  mmToHwp,
  readRecords,
  Reader,
  textIndex
} from './records.ts'
import { cat, ctrl8, rec, wchars } from './testkit.ts'

test('records: tag, level and size from the 32-bit header', () => {
  const data = cat(rec(0x42, 0, new Uint8Array([1, 2, 3])), rec(0x43, 1, new Uint8Array(0)), rec(0x47, 2, new Uint8Array([9])))
  const rs = readRecords(data)
  assert.equal(rs.length, 3)
  assert.deepEqual(rs.map((r) => [r.tag, r.level, r.data.length]), [[0x42, 0, 3], [0x43, 1, 0], [0x47, 2, 1]])
  assert.deepEqual([...rs[0].data], [1, 2, 3])
})

test('records: size 0xFFF means a 32-bit size follows', () => {
  const big = new Uint8Array(5000).map((_, i) => i & 0xff)
  const small = new Uint8Array([7, 7])
  const rs = readRecords(cat(rec(0x43, 1, big), rec(0x44, 1, small, true)))
  assert.equal(rs.length, 2)
  assert.equal(rs[0].data.length, 5000)
  assert.equal(rs[0].data[4999], 4999 & 0xff)
  assert.deepEqual([...rs[1].data], [7, 7], 'a short record may use the long form too')
})

test('records: a truncated last record keeps the bytes that exist', () => {
  const full = rec(0x43, 0, new Uint8Array(40))
  const rs = readRecords(full.subarray(0, 20))
  assert.equal(rs.length, 1)
  assert.equal(rs[0].data.length, 16)
  assert.equal(readRecords(new Uint8Array(3)).length, 0, 'less than a header')
})

test('records: tree by level', () => {
  const rs = readRecords(
    cat(
      rec(0x42, 0, new Uint8Array(0)),
      rec(0x43, 1, new Uint8Array(0)),
      rec(0x47, 1, new Uint8Array(0)),
      rec(0x4d, 2, new Uint8Array(0)),
      rec(0x48, 2, new Uint8Array(0)),
      rec(0x42, 2, new Uint8Array(0)),
      rec(0x42, 0, new Uint8Array(0))
    )
  )
  const roots = buildTree(rs)
  assert.equal(roots.length, 2)
  assert.deepEqual(roots[0].children.map((c) => c.tag), [0x43, 0x47])
  assert.deepEqual(roots[0].children[1].children.map((c) => c.tag), [0x4d, 0x48, 0x42])
})

test('control characters: char, inline and extended widths', () => {
  assert.equal(controlKind(13), 'char')
  assert.equal(controlKind(10), 'char')
  assert.equal(controlKind(9), 'inline')
  assert.equal(controlKind(4), 'inline')
  assert.equal(controlKind(11), 'extended')
  assert.equal(controlKind(2), 'extended')
  assert.equal(controlKind(17), 'extended')
})

test('control characters: PARA_TEXT decoding and WCHAR positions', () => {
  // [secd 8][cold 8] "가A" [tab 8] "B" [table 8] [line break 1] "C" [para end 1]
  const data = wchars(...ctrl8(2, 'secd'), ...ctrl8(2, 'cold'), '가A', ...ctrl8(9), 'B', ...ctrl8(11, 'tbl '), 10, 'C', 13)
  const d = decodeParaText(data)
  assert.equal(d.text, '￼￼가A\tB￼\nC')
  assert.deepEqual(d.ctrls, [2, 2, 11])
  // WCHAR offsets used by char shapes / line segments map to text indexes.
  assert.equal(textIndex(d, 0), 0)
  assert.equal(textIndex(d, 8), 1)
  assert.equal(textIndex(d, 16), 2, '가')
  assert.equal(textIndex(d, 17), 3, 'A')
  assert.equal(textIndex(d, 18), 4, 'tab')
  assert.equal(textIndex(d, 26), 5, 'B')
  assert.equal(textIndex(d, 27), 6, 'table')
  assert.equal(textIndex(d, 35), 7, 'line break')
  assert.equal(textIndex(d, 36), 8, 'C')
  assert.equal(textIndex(d, 1000), d.text.length, 'clamped')
})

test('control characters: special spaces, hyphen and dropped field ends', () => {
  const d = decodeParaText(wchars('a', 30, 'b', 31, 'c', 24, ...ctrl8(4), 'd', 13))
  assert.equal(d.text, 'a b c-d')
  assert.equal(d.ctrls.length, 0, 'inline field end is not an extended control')
})

test('control characters: a cut-off control at the end does not overrun', () => {
  const d = decodeParaText(wchars('x', 11, 0x6274))
  assert.equal(d.text, 'x￼')
  assert.equal(d.pos.length, 4)
})

test('control ids: four characters as a big-endian spelling', () => {
  assert.equal(ctrlId('secd'), 0x73656364)
  assert.equal(ctrlName(ctrlId('tbl ')), 'tbl ')
  const bytes = new Uint8Array([0x64, 0x63, 0x65, 0x73]) // as stored: "dces"
  assert.equal(ctrlName(new Reader(bytes).u32()), 'secd')
})

test('units: HWPUNIT to pt, px and mm', () => {
  assert.equal(hwpToPt(1000), 10)
  assert.equal(hwpToPx(7200), 96)
  assert.equal(hwpToPx(75), 1)
  assert.ok(Math.abs(hwpToMm(59528) - 210) < 0.01, 'A4 width')
  assert.equal(mmToHwp(297), 84189)
})

test('units: COLORREF is 0x00BBGGRR', () => {
  assert.equal(colorRef(0x000000ff), '#ff0000')
  assert.equal(colorRef(0x00ff0000), '#0000ff')
  assert.equal(colorRef(0x00b2b2b2), '#b2b2b2')
  assert.equal(colorRef(0xffffffff), null, 'no colour')
})

test('reader: reads past the end give defaults instead of throwing', () => {
  const r = new Reader(new Uint8Array([1, 0, 3]))
  assert.equal(r.u16(), 1)
  assert.equal(r.u32(), 0)
  assert.equal(r.hstr(), '')
  const s = new Reader(wchars(3, 'abc', 'zz'))
  assert.equal(s.hstr(), 'abc')
})
