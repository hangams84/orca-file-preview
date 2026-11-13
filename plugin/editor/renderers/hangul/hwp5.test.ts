import { assert, test } from 'orca/testing'
import { buildCfb } from '../legacy/testkit.ts'
import { HangulError, isHwp3, readBorderFill, readCharShape, readDocInfo, readFileHeader, readHwp, readParaShape, readSection } from './hwp5.ts'
import { buildTree, readRecords, TAG } from './records.ts'
import { cat, ctrl8, rec, wchars } from './testkit.ts'

function fileHeader(flags: number, version = 0x05000304): Uint8Array {
  const out = new Uint8Array(256)
  const sig = 'HWP Document File'
  for (let i = 0; i < sig.length; i++) out[i] = sig.charCodeAt(i)
  const dv = new DataView(out.buffer)
  dv.setUint32(32, version, true)
  dv.setUint32(36, flags, true)
  return out
}

function le(...parts: [number, 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32'][]): Uint8Array {
  const size = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4 }
  const out = new Uint8Array(parts.reduce((n, [, t]) => n + size[t], 0))
  const dv = new DataView(out.buffer)
  let o = 0
  for (const [v, t] of parts) {
    if (t === 'u8' || t === 'i8') dv.setUint8(o, v & 0xff)
    else if (t === 'u16' || t === 'i16') dv.setUint16(o, v & 0xffff, true)
    else dv.setUint32(o, v >>> 0, true)
    o += size[t]
  }
  return out
}

test('hwp5: FileHeader version and flags', () => {
  const fh = readFileHeader(fileHeader(0b101, 0x05010001))
  assert.equal(fh.version, '5.1.0.1')
  assert.equal(fh.compressed, true)
  assert.equal(fh.password, false)
  assert.equal(fh.distribution, true)
  assert.throws(() => readFileHeader(new Uint8Array(256)), (e) => e instanceof HangulError && e.code === 'not-hwp')
})

test('hwp5: distribution, password and HWP 3 files are refused with a reason', () => {
  const code = (bytes: Uint8Array) => {
    try {
      readHwp(bytes)
      return 'ok'
    } catch (e) {
      return e instanceof HangulError ? e.code : String(e)
    }
  }
  assert.equal(code(buildCfb([{ name: 'FileHeader', data: fileHeader(0b101) }]).bytes), 'distribution')
  assert.equal(code(buildCfb([{ name: 'FileHeader', data: fileHeader(0b011) }]).bytes), 'password')
  const v3 = new TextEncoder().encode('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05'.padEnd(600, '\0'))
  assert.equal(isHwp3(v3), true)
  assert.equal(code(v3), 'hwp3')
  assert.equal(code(new Uint8Array(600)), 'not-hwp')
  assert.equal(code(buildCfb([{ name: 'Other', data: new Uint8Array(10) }]).bytes), 'not-hwp')
})

test('hwp5: PARA_SHAPE margins are stored doubled; alignment, heading and line spacing', () => {
  const props1 = (3 << 2) | (2 << 23) | (1 << 25) // centre, numbering, level 1
  const d = cat(
    le([props1, 'u32'], [4000, 'i32'], [200, 'i32'], [-2620, 'i32'], [1000, 'i32'], [600, 'i32'], [130, 'i32']),
    le([0, 'u16'], [2, 'u16'], [3, 'u16'], [0, 'i16'], [0, 'i16'], [0, 'i16'], [0, 'i16']),
    le([0, 'u32'], [1, 'u32'], [1800, 'u32']) // props2, props3 (fixed), spacing
  )
  const ps = readParaShape(d, 0x05000300)
  assert.equal(ps.align, 'center')
  assert.equal(ps.left, 2000)
  assert.equal(ps.right, 100)
  assert.equal(ps.indent, -1310)
  assert.equal(ps.before, 500)
  assert.equal(ps.after, 300)
  assert.equal(ps.heading, 'number')
  assert.equal(ps.headingId, 2)
  assert.equal(ps.level, 1)
  assert.equal(ps.lineSpacingType, 'fixed')
  assert.equal(ps.lineSpacing, 1800)
  const old = readParaShape(d, 0x05000200)
  assert.equal(old.lineSpacingType, 'percent', 'before 5.0.2.5 the old field applies')
  assert.equal(old.lineSpacing, 130)
})

test('hwp5: CHAR_SHAPE faces, size and attributes', () => {
  const faces = [['함초롬돋움', '함초롬바탕'], ['HCR Dotum', 'Arial'], [], [], [], [], []]
  const d = cat(
    le([1, 'u16'], [1, 'u16'], [0, 'u16'], [0, 'u16'], [0, 'u16'], [0, 'u16'], [0, 'u16']),
    new Uint8Array([90, 100, 100, 100, 100, 100, 100]), // ratio
    new Uint8Array([0xfb, 0, 0, 0, 0, 0, 0]), // spacing -5
    new Uint8Array([110, 100, 100, 100, 100, 100, 100]), // relative size
    new Uint8Array(7), // offsets
    le([1200, 'i32'], [0b11 | (1 << 2) | (1 << 18), 'u32']),
    new Uint8Array(2),
    le([0x000000ff, 'u32'], [0, 'u32'], [0xffffffff, 'u32'], [0xb2b2b2, 'u32'])
  )
  const cs = readCharShape(d, faces)
  assert.equal(cs.hangulFace, '함초롬바탕')
  assert.equal(cs.latinFace, 'Arial')
  assert.equal(cs.height, 1200)
  assert.equal(cs.relSize, 110)
  assert.equal(cs.spacing, -5)
  assert.equal(cs.ratio, 90)
  assert.equal(cs.italic, true)
  assert.equal(cs.bold, true)
  assert.equal(cs.underline, 'below')
  assert.equal(cs.strike, true)
  assert.equal(cs.color, '#ff0000')
  assert.equal(cs.shade, null)
})

test('hwp5: BORDER_FILL borders are (type, width, colour) per side, then the fill', () => {
  const side = (t: number, w: number, c: number) => cat(new Uint8Array([t, w]), le([c, 'u32']))
  const d = cat(le([0, 'u16']), side(1, 1, 0), side(0, 0, 0), side(2, 7, 0x0000ff), side(1, 10, 0xff0000), side(0, 0, 0), le([1, 'u32'], [0x00ccffee, 'u32'], [0, 'u32'], [0, 'i32']))
  const bf = readBorderFill(d)
  assert.deepEqual(bf.left, { style: 'solid', width: 0.12, color: '#000000' })
  assert.equal(bf.right.style, 'none')
  assert.deepEqual(bf.top, { style: 'dashed', width: 0.5, color: '#ff0000' })
  assert.deepEqual(bf.bottom, { style: 'solid', width: 1, color: '#0000ff' })
  assert.equal(bf.fill, '#eeffcc')
})

test('hwp5: DocInfo faces are grouped by language from ID_MAPPINGS', () => {
  const face = (name: string) => cat(new Uint8Array([0]), le([name.length, 'u16']), wchars(name))
  const ids = le([0, 'i32'], [2, 'i32'], [1, 'i32'], [0, 'i32'], [0, 'i32'], [0, 'i32'], [0, 'i32'], [0, 'i32'])
  const info = readDocInfo(readRecords(cat(rec(TAG.ID_MAPPINGS, 0, ids), rec(TAG.FACE_NAME, 1, face('바탕')), rec(TAG.FACE_NAME, 1, face('돋움')), rec(TAG.FACE_NAME, 1, face('Arial')))))
  assert.deepEqual(info.faces[0], ['바탕', '돋움'])
  assert.deepEqual(info.faces[1], ['Arial'])
})

function paraHeader(nChars: number, ps: number, brk = 0): Uint8Array {
  return cat(le([nChars, 'u32'], [0, 'u32'], [ps, 'u16']), new Uint8Array([0, brk]), le([1, 'u16'], [0, 'u16'], [1, 'u16'], [0, 'u32'], [0, 'u16']))
}
function lineSeg(start: number, y: number, h = 1000, x = 0, w = 42520): Uint8Array {
  return le([start, 'u32'], [y, 'i32'], [h, 'i32'], [h, 'i32'], [850, 'i32'], [600, 'i32'], [x, 'i32'], [w, 'i32'], [0x60000, 'u32'])
}

test('hwp5: a section: page definition, text, char shapes, line segments and a table', () => {
  const pageDef = le([59528, 'u32'], [84188, 'u32'], [8504, 'u32'], [8504, 'u32'], [5668, 'u32'], [4252, 'u32'], [4252, 'u32'], [4252, 'u32'], [0, 'u32'], [0, 'u32'])
  const text = wchars(...ctrl8(2, 'secd'), '가나', ...ctrl8(11, 'tbl '), '다', 13)
  // table: common object props (inline), TABLE record, one cell with one paragraph
  const objProps = cat(le([0x73656364 & 0, 'u32']), le([1, 'u32'], [0, 'i32'], [0, 'i32'], [20000, 'u32'], [1282, 'u32'], [0, 'i32']), le([0, 'i16'], [0, 'i16'], [0, 'i16'], [0, 'i16']))
  objProps.set(le([0x74626c20, 'u32']), 0) // 'tbl '
  const table = le([0, 'u32'], [1, 'u16'], [1, 'u16'], [0, 'u16'], [510, 'i16'], [510, 'i16'], [141, 'i16'], [141, 'i16'], [282, 'u16'], [3, 'u16'])
  const cell = le([1, 'i32'], [0x20, 'u32'], [0, 'u16'], [0, 'u16'], [1, 'u16'], [1, 'u16'], [20000, 'u32'], [282, 'u32'], [510, 'u16'], [510, 'u16'], [141, 'u16'], [141, 'u16'], [3, 'u16'])
  const stream = cat(
    rec(TAG.PARA_HEADER, 0, paraHeader(20, 1)),
    rec(TAG.PARA_TEXT, 1, text),
    rec(TAG.PARA_CHAR_SHAPE, 1, le([0, 'u32'], [0, 'u32'], [9, 'u32'], [2, 'u32'])),
    rec(TAG.PARA_LINE_SEG, 1, cat(lineSeg(0, 0), lineSeg(18, 1600))),
    rec(TAG.CTRL_HEADER, 1, le([0x73656364, 'u32'])),
    rec(TAG.PAGE_DEF, 2, pageDef),
    rec(TAG.CTRL_HEADER, 1, objProps),
    rec(TAG.TABLE, 2, table),
    rec(TAG.LIST_HEADER, 2, cell),
    rec(TAG.PARA_HEADER, 2, paraHeader(3, 0)),
    rec(TAG.PARA_TEXT, 3, wchars('셀', 'A', 13)),
    rec(TAG.PARA_LINE_SEG, 3, lineSeg(0, 0, 1000, 0, 18980)),
    rec(TAG.PARA_HEADER, 0, paraHeader(1, 0, 0x04))
  )
  const secs = readSection(buildTree(readRecords(stream)), { info: readDocInfo([]), notes: new Set(), ver: 0x05000304 })
  assert.equal(secs.length, 1)
  const s = secs[0]
  assert.equal(s.page.width, 59528)
  assert.equal(s.page.top, 5668)
  assert.equal(s.paras.length, 2)
  const p = s.paras[0]
  assert.equal(p.text, '￼가나￼다')
  assert.deepEqual(p.runs, [{ start: 0, cs: 0 }, { start: 2, cs: 2 }], 'WCHAR 9 is the second character after the 8-WCHAR control')
  assert.equal(p.lines.length, 2)
  assert.equal(p.lines[1].start, 4, 'WCHAR 18 = 다, after the 8-WCHAR table control')
  assert.equal(p.lines[1].y, 1600)
  assert.equal(p.ctrls[0]?.kind, 'section')
  const t = p.ctrls[1]
  assert.ok(t && t.kind === 'table')
  assert.equal(t.pos.inline, true)
  assert.equal(t.rows, 1)
  assert.equal(t.cells.length, 1)
  assert.equal(t.cells[0].vAlign, 'center')
  assert.equal(t.cells[0].paras[0].text, '셀A')
  assert.equal(t.cells[0].borderFillId, 3)
  assert.equal(s.paras[1].pageBreak, true)
})
