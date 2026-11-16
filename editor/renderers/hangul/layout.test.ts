import { assert, test } from 'orca/testing'
import { boundaries, columnBoxes, layoutDoc, numberParas, objPosition, tableGeom } from './layout.ts'
import { A4, DEFAULT_CHAR, DEFAULT_PARA, DEFAULT_POS, type HangulDoc, type LineSeg, type Para, type ParaShape, type Table } from './model.ts'
import { fontStack } from './fonts.ts'

const line = (y: number, start = 0, h = 1000): LineSeg => ({ start, y, height: h, textHeight: h, baseline: 850, spacing: 600, x: 0, width: 42520, flags: 0x60000 })
const para = (text: string, lines: LineSeg[], ps = 0): Para => ({ ps, style: 0, text, runs: [{ start: 0, cs: 0 }], lines, ctrls: [], pageBreak: false, columnBreak: false })
const doc = (paras: Para[], paraShapes: ParaShape[] = [DEFAULT_PARA]): HangulDoc => ({
  format: 'HWP',
  version: '5.0.3.4',
  charShapes: [DEFAULT_CHAR],
  paraShapes,
  borderFills: [],
  numberings: [{ start: 1, levels: [{ format: '^1.', style: 0, start: 1 }, { format: '^2)', style: 8, start: 1 }] }],
  bullets: [{ char: '●' }],
  bin: () => null,
  sections: [{ page: { ...A4 }, paras }],
  notes: []
})

test('layout: boundaries from spans, merged cells and gaps', () => {
  assert.deepEqual(boundaries(3, [{ a: 0, n: 1, size: 10 }, { a: 1, n: 1, size: 20 }, { a: 2, n: 1, size: 30 }], 60), [0, 10, 30, 60])
  // only a merged first row and the last column are known
  assert.deepEqual(boundaries(3, [{ a: 0, n: 3, size: 60 }, { a: 2, n: 1, size: 20 }], 60), [0, 20, 40, 60])
})

test('layout: table rows grow to the saved height of their cell text', () => {
  const cellPara = (n: number) => Array.from({ length: n }, (_, i) => para('x', [line(i * 1600)]))
  const t: Table = {
    kind: 'table',
    pos: { ...DEFAULT_POS, width: 20000, height: 0 },
    rows: 2,
    cols: 2,
    cellSpacing: 0,
    borderFillId: 0,
    cells: [
      { col: 0, row: 0, colSpan: 1, rowSpan: 1, width: 10000, height: 282, margin: [510, 510, 141, 141], borderFillId: 0, vAlign: 'center', paras: cellPara(2) },
      { col: 1, row: 0, colSpan: 1, rowSpan: 2, width: 10000, height: 282, margin: [510, 510, 141, 141], borderFillId: 0, vAlign: 'center', paras: cellPara(5) },
      { col: 0, row: 1, colSpan: 1, rowSpan: 1, width: 10000, height: 282, margin: [510, 510, 141, 141], borderFillId: 0, vAlign: 'center', paras: cellPara(1) }
    ]
  }
  const g = tableGeom(t)
  assert.deepEqual(g.colX, [0, 10000, 20000])
  assert.equal(g.rowY[1], 2600 + 282, 'two lines (1600 + 1000) plus margins')
  assert.equal(g.rowY[2], 7400 + 282, 'the row-spanning cell stretches the last row it covers')
})

test('layout: columns with relative widths', () => {
  const cols = columnBoxes({ kind: 'columns', count: 3, gap: 0, widths: [6552, 12234, 12236], gaps: [873, 873, 0] }, 42520)
  assert.deepEqual(cols.map((c) => Math.round(c.w)), [8502, 15875, 15878])
  assert.equal(Math.round(cols[1].x), 8502 + 1133)
  const same = columnBoxes({ kind: 'columns', count: 2, gap: 1000, widths: [] }, 42520)
  assert.deepEqual(same, [{ x: 0, w: 20760 }, { x: 21760, w: 20760 }])
})

test('layout: a line placed higher than the previous one starts the next page', () => {
  const d = doc([para('a', [line(0)]), para('b', [line(60000)]), para('c', [line(0)]), para('d', [line(1600)])])
  const { pages } = layoutDoc(d)
  assert.equal(pages.length, 2)
  assert.deepEqual(pages.map((p) => p.lines.length), [2, 2])
  const body = pages[0].body
  assert.equal(body.y, A4.top + A4.header)
  assert.equal(body.x, A4.left)
  assert.equal(pages[1].lines[1].y, body.y + 1600)
  assert.equal(pages[1].number, 2)
})

test('layout: multi-column sections fill columns before pages', () => {
  const p0 = para('￼1', [line(0)])
  p0.ctrls = [{ kind: 'columns', count: 2, gap: 1000, widths: [] }]
  const d = doc([p0, para('2', [line(1600)]), para('3', [line(0)]), para('4', [line(1600)]), para('5', [line(0)])])
  const { pages } = layoutDoc(d)
  assert.equal(pages.length, 2)
  assert.equal(pages[0].lines[2].x, A4.left + 21760, 'third line in the second column')
  assert.equal(pages[1].lines[0].x, A4.left)
})

test('layout: sections without saved lines become a flowing page', () => {
  const { pages } = layoutDoc(doc([para('a', []), para('b', [])]))
  assert.equal(pages.length, 1)
  assert.ok(pages[0].flow)
})

test('layout: floating object positions', () => {
  const ref = { paper: { x: 0, y: 0, w: 59528, h: 84188 }, page: { x: 8504, y: 9920, w: 42520, h: 66016 }, column: { x: 8504, y: 9920, w: 42520, h: 66016 }, para: { x: 8504, y: 12000, w: 42520, h: 66016 } }
  const paper = objPosition({ ...DEFAULT_POS, inline: false, vertRel: 'paper', horzRel: 'paper', x: 100, y: 200, wrap: 'front' }, 1000, 1000, ref)
  assert.deepEqual(paper, { x: 100, y: 200 })
  const centred = objPosition({ ...DEFAULT_POS, inline: false, vertRel: 'page', horzRel: 'page', horzAlign: 'center', vertAlign: 'bottom', wrap: 'front' }, 2520, 1000, ref)
  assert.deepEqual(centred, { x: 8504 + 20000, y: 9920 + 66016 - 1000 })
  const para = objPosition({ ...DEFAULT_POS, inline: false, vertRel: 'para', horzRel: 'column', y: 0, wrap: 'topbottom', margin: [283, 283, 283, 283] }, 1000, 1000, ref)
  assert.deepEqual(para, { x: 8504 + 283, y: 12000 + 283 }, 'outer margins push text-flow objects')
})

test('layout: paragraph numbering and bullets', () => {
  const ps: ParaShape[] = [
    DEFAULT_PARA,
    { ...DEFAULT_PARA, heading: 'number', headingId: 1, level: 0 },
    { ...DEFAULT_PARA, heading: 'number', headingId: 1, level: 1 },
    { ...DEFAULT_PARA, heading: 'bullet', headingId: 1 }
  ]
  const ps1 = [para('a', [], 1), para('b', [], 2), para('c', [], 2), para('d', [], 1), para('e', [], 2), para('f', [], 3)]
  const pre = numberParas(doc(ps1, ps))
  assert.deepEqual(ps1.map((p) => pre.get(p)), ['1.', '가)', '나)', '2.', '가)', '●'])
})

test('fonts: Hangul faces map to serif or sans Korean stacks', () => {
  assert.ok(fontStack('함초롬바탕', '함초롬바탕').includes('Noto Serif KR'))
  assert.ok(fontStack('Times New Roman', '휴먼명조').startsWith('"Times New Roman", "휴먼명조", "함초롬바탕"'))
  assert.ok(fontStack('맑은 고딕', '맑은 고딕').includes('Noto Sans KR'))
  assert.ok(fontStack('함초롬돋움', '함초롬돋움').endsWith('sans-serif'))
  assert.ok(!fontStack('a"b;c', '').includes(';'), 'names are sanitised')
})
