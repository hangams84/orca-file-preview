import { assert, test } from 'orca/testing'
import {
  applyChp,
  applyPap,
  applySep,
  bulletChar,
  defaultChp,
  defaultPap,
  defaultSep,
  formatNumber,
  readStyleSheet,
  sprms
} from './wordfmt.ts'

/** A Word 97 grpprl from [opcode, operand bytes] pairs. */
const g97 = (...items: [number, number[]][]) => Uint8Array.from(items.flatMap(([op, b]) => [op & 0xff, op >> 8, ...b]))
const le16 = (v: number) => [v & 0xff, (v >> 8) & 0xff]

test('wordfmt: Word 97 paragraph sprms (spacing, line rules, indents, alignment, keep)', () => {
  const pap = defaultPap()
  applyPap(
    pap,
    g97(
      [0xa413, le16(240)], // before 12 pt
      [0xa414, le16(120)], // after 6 pt
      [0x6412, [...le16(-360), ...le16(0)]], // exactly 18 pt
      [0x845e, le16(720)], // left 36 pt
      [0x8460, le16(-360)], // hanging 18 pt
      [0x2461, [3]], // justify
      [0x2406, [1]] // keep with next
    ),
    false
  )
  assert.equal(pap.before, 240)
  assert.equal(pap.after, 120)
  assert.deepEqual(pap.line, { dyaLine: -360, mult: false })
  assert.equal(pap.left, 720)
  assert.equal(pap.first, -360)
  assert.equal(pap.jc, 3)
  assert.equal(pap.keepNext, true)
  applyPap(pap, g97([0x6412, [...le16(360), ...le16(1)]]), false) // 1.5 lines
  assert.deepEqual(pap.line, { dyaLine: 360, mult: true })
})

test('wordfmt: section sprms give page size, orientation and margins', () => {
  const sep = defaultSep()
  assert.equal(sep.pageW, 12240, 'Letter by default')
  applySep(sep, g97([0xb01f, le16(16838)], [0xb020, le16(11906)], [0x301d, [2]], [0xb021, le16(1417)], [0x9023, le16(1134)], [0x3009, [0]]), false)
  assert.equal(sep.pageW, 16838)
  assert.equal(sep.pageH, 11906)
  assert.equal(sep.landscape, true)
  assert.equal(sep.left, 1417)
  assert.equal(sep.top, 1134)
  assert.equal(sep.bkc, 0, 'continuous section break')
})

test('wordfmt: character sprms and toggles relative to the style', () => {
  const style = { ...defaultChp(), b: true }
  const chp = { ...style }
  applyChp(chp, g97([0x0835, [0x81]], [0x0836, [1]], [0x4a43, le16(28)], [0x6870, [192, 38, 38, 0]], [0x4a4f, le16(3)], [0x4a50, le16(5)]), style, false)
  assert.equal(chp.b, false, '0x81 negates the style value')
  assert.equal(chp.i, true)
  assert.equal(chp.hps, 28)
  assert.equal(chp.color, '#c02626')
  assert.equal(chp.ftcAscii, 3)
  assert.equal(chp.ftcFE, 5)
})

test('wordfmt: Word 6/95 one-byte sprms map to the same properties', () => {
  // sprmPJc (5) = center, sprmPDyaBefore (21) = 240, sprmCFBold (85) = 1, sprmCHps (99) = 24
  const pap = defaultPap()
  applyPap(pap, Uint8Array.from([5, 1, 21, ...le16(240)]), true)
  assert.equal(pap.jc, 1)
  assert.equal(pap.before, 240)
  const chp = defaultChp()
  applyChp(chp, Uint8Array.from([85, 1, 99, ...le16(24)]), defaultChp(), true)
  assert.equal(chp.b, true)
  assert.equal(chp.hps, 24)
  // a variable-length sprm (pChgTabs, 23) is skipped by its length byte
  assert.deepEqual([...sprms(Uint8Array.from([23, 2, 0, 0, 5, 2]), true)].map((x) => x[0]), [0xc615, 0x2403])
})

test('wordfmt: tab stops from sprmPChgTabsPapx, table rows from sprmTDefTable', () => {
  const pap = defaultPap()
  // cb, delete 0, add 2 stops: 2880 (center), 5760 (right)
  applyPap(pap, g97([0xc60d, [8, 0, 2, ...le16(2880), ...le16(5760), 1, 2]]), false)
  assert.deepEqual(pap.tabs, [{ pos: 2880, jc: 1 }, { pos: 5760, jc: 2 }])
  // sprmTDefTable: cb (u16) then itcMac = 2, centers -108, 2000, 4000, then two TC80s
  const tc = new Array(20).fill(0)
  const operand = [2, ...le16(-108), ...le16(2000), ...le16(4000), ...tc, ...tc]
  applyPap(pap, g97([0xd608, [...le16(operand.length + 1), ...operand]], [0x9602, le16(108)]), false)
  assert.deepEqual(pap.tap?.centers, [-108, 2000, 4000])
  assert.equal(pap.tap?.gapHalf, 108)
  assert.equal(pap.tap?.cells.length, 2)
})

test('wordfmt: style sheet based-on chains resolve paragraph and character properties', () => {
  // STSH: cbStshi 18, Stshi (cstd 2, cbSTDBaseInFile 10, ...), then two STDs
  const stshi = [...le16(2), ...le16(10), ...new Array(14).fill(0)]
  const std = (sti: number, base: number, name: string, papx: number[], chpx: number[]) => {
    const nameBytes = [...le16(name.length), ...[...name].flatMap((c) => le16(c.charCodeAt(0))), 0, 0]
    const body = [...le16(sti), ...le16(1 | (base << 4)), ...le16(2), ...le16(0), ...le16(0), ...nameBytes]
    if (body.length & 1) body.push(0)
    const upx1 = [...le16(papx.length + 2), ...le16(0), ...papx]
    if (upx1.length & 1) upx1.push(0)
    const upx2 = [...le16(chpx.length), ...chpx]
    const all = [...body, ...upx1, ...upx2]
    return [...le16(all.length), ...all]
  }
  const normal = std(0, 0xfff, 'Normal', [...g97([0xa414, le16(200)])], [...g97([0x4a43, le16(22)])])
  const heading = std(1, 0, 'heading 1', [...g97([0xa413, le16(480)])], [...g97([0x0835, [1]])])
  const table = Uint8Array.from([...le16(18), ...stshi, ...normal, ...heading])
  const { styles } = readStyleSheet(table, 0, table.length, false)
  assert.equal(styles[1].name, 'heading 1')
  assert.equal(styles[1].pap.after, 200, 'inherits space after from Normal')
  assert.equal(styles[1].pap.before, 480)
  assert.equal(styles[1].chp.hps, 22, 'inherits the size from Normal')
  assert.equal(styles[1].chp.b, true)
})

test('wordfmt: list numbers and bullets', () => {
  assert.equal(formatNumber(4, 0), '4')
  assert.equal(formatNumber(4, 1), 'IV')
  assert.equal(formatNumber(14, 2), 'xiv')
  assert.equal(formatNumber(28, 3), 'BB')
  assert.equal(formatNumber(3, 24), '다')
  assert.equal(formatNumber(2, 5), '2nd')
  assert.equal(bulletChar(''), '•')
  assert.equal(bulletChar(''), '▪')
})
