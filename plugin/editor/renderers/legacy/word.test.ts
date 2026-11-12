import { assert, test } from 'orca/testing'
import type { Block, Paragraph, Table } from './model.ts'
import { fakeCfb } from './testkit.ts'
import { readWord, WordError } from './word.ts'

interface Piece {
  text: string
  /** Store as cp1252 bytes (compressed) or UTF-16LE. */
  compressed: boolean
}

/** A minimal Word 97 WordDocument + 1Table pair: FIB, text pieces at 0x400, a CLX piece table. */
function wordFile(pieces: Piece[], opts: { encrypted?: boolean; prc?: Uint8Array } = {}) {
  const wd = new Uint8Array(0x600 + pieces.reduce((n, p) => n + p.text.length * 2, 0))
  const dv = new DataView(wd.buffer)
  dv.setUint16(0, 0xa5ec, true)
  dv.setUint16(2, 0xc1, true)
  dv.setUint16(0x0a, 0x0200 | (opts.encrypted ? 0x0100 : 0), true) // fWhichTblStm = 1Table
  dv.setUint16(0x20, 14, true) // csw
  dv.setUint16(0x3e, 22, true) // cslw
  const cpTotal = pieces.reduce((n, p) => n + p.text.length, 0)
  dv.setUint32(0x40 + 3 * 4, cpTotal, true) // ccpText
  dv.setUint16(0x98, 93, true) // cbRgFcLcb
  // text and PCDs
  let fcPos = 0x400
  const cps = [0]
  const pcds: [number, boolean][] = []
  for (const p of pieces) {
    if (p.compressed) {
      for (let i = 0; i < p.text.length; i++) wd[fcPos + i] = p.text.charCodeAt(i) & 0xff
      pcds.push([fcPos, true])
      fcPos += p.text.length
    } else {
      for (let i = 0; i < p.text.length; i++) dv.setUint16(fcPos + i * 2, p.text.charCodeAt(i), true)
      pcds.push([fcPos, false])
      fcPos += p.text.length * 2
    }
    cps.push(cps[cps.length - 1] + p.text.length)
  }
  const plcLen = cps.length * 4 + pcds.length * 8
  const prc = opts.prc ?? new Uint8Array(0)
  const table = new Uint8Array(64 + prc.length + plcLen)
  const tv = new DataView(table.buffer)
  table.set(prc, 16)
  const clx = 16 + prc.length
  table[clx] = 0x02
  tv.setUint32(clx + 1, plcLen, true)
  cps.forEach((cp, i) => tv.setUint32(clx + 5 + i * 4, cp, true))
  pcds.forEach(([fc, compressed], i) => {
    const o = clx + 5 + cps.length * 4 + i * 8
    tv.setUint32(o + 2, compressed ? (fc * 2) | 0x40000000 : fc, true)
  })
  dv.setUint32(0x9a + 33 * 8, 16, true) // fcClx (Prc records first, then the Pcdt)
  dv.setUint32(0x9a + 33 * 8 + 4, prc.length + 5 + plcLen, true) // lcbClx
  return fakeCfb({ WordDocument: wd, '1Table': table })
}

const paras = (blocks: Block[]) => blocks.filter((b): b is Paragraph => b.kind === 'p').map((p) => p.runs.map((r) => r.text).join(''))

test('word: compressed (cp1252) and UTF-16 pieces join into one story', () => {
  const m = readWord(wordFile([{ text: 'Caf\xe9 \x93q\x94 ', compressed: true }, { text: '한글 텍스트\r', compressed: false }]))
  assert.deepEqual(paras(m.blocks), ['Café “q” 한글 텍스트'])
  assert.equal(m.variant, 'Word 97-2003')
})

test('word: paragraph marks, line breaks and page breaks', () => {
  const m = readWord(wordFile([{ text: 'one\rtwo\x0bmore\r\x0cthree\r', compressed: true }]))
  assert.deepEqual(paras(m.blocks), ['one', 'two\nmore', 'three'])
  assert.deepEqual(
    m.blocks.map((b) => b.kind),
    ['p', 'p', 'break', 'p']
  )
})

test('word: cell and row marks become a table', () => {
  const m = readWord(wordFile([{ text: 'before\ra\x07b\x07\x07c\x07d\x07\x07after\r', compressed: true }]))
  const table = m.blocks.find((b): b is Table => b.kind === 'table')!
  assert.ok(table, 'a table block')
  const cells = table.rows.map((r) => r.map((c) => paras(c).join('/')))
  assert.deepEqual(cells, [['a', 'b'], ['c', 'd']])
  assert.deepEqual(paras(m.blocks), ['before', 'after'])
})

test('word: fields show only their result, nested fields too', () => {
  const m = readWord(wordFile([{ text: 'see \x13HYPERLINK "http://x"\x14the link\x15 and \x13 PAGE \x14\x13 X \x147\x15\x15!\r', compressed: true }]))
  assert.deepEqual(paras(m.blocks), ['see the link and 7!'])
})

test('word: object anchors, footnote refs and optional hyphens are dropped or placeheld', () => {
  const m = readWord(wordFile([{ text: 'a\x08b\x02c\x1fd\x1ee\r', compressed: true }]))
  assert.deepEqual(paras(m.blocks), ['abcd-e'])
  const pic = readWord(wordFile([{ text: 'x\x01y\r', compressed: true }]))
  const p = pic.blocks[0] as Paragraph
  assert.ok(p.runs.some((r) => r.object === 'picture'), 'a \\x01 without picture data becomes a placeholder')
})

test('word: encrypted flag raises an "encrypted" WordError', () => {
  assert.throws(
    () => readWord(wordFile([{ text: 'secret\r', compressed: true }], { encrypted: true })),
    (e) => e instanceof WordError && e.code === 'encrypted'
  )
})

test('word: missing or bad FIB and missing table stream are "corrupt"', () => {
  assert.throws(() => readWord(fakeCfb({})), (e) => e instanceof WordError && e.code === 'corrupt')
  assert.throws(() => readWord(fakeCfb({ WordDocument: new Uint8Array(0x400) })), (e) => e instanceof WordError && e.code === 'corrupt')
  const noTable = wordFile([{ text: 'x\r', compressed: true }])
  assert.throws(() => readWord(fakeCfb({ WordDocument: noTable.stream('WordDocument')! })), (e) => e instanceof WordError)
})

test('word: a piece pointing past the stream end does not throw', () => {
  const cfb = wordFile([{ text: 'abc\r', compressed: true }])
  const wd = cfb.stream('WordDocument')!
  new DataView(wd.buffer).setUint32(0x40 + 3 * 4, 100000, true) // ccpText far beyond the pieces
  const m = readWord(cfb)
  assert.deepEqual(paras(m.blocks), ['abc'])
})

test('word: Prc records before the Pcdt are skipped; a negative or huge cbGrpprl cannot loop', () => {
  // a valid Prc (0x01, cbGrpprl = 2, two bytes of grpprl) then the piece table
  const ok = readWord(wordFile([{ text: 'after prc\r', compressed: true }], { prc: Uint8Array.of(0x01, 2, 0, 0xaa, 0xbb) }))
  assert.deepEqual(paras(ok.blocks), ['after prc'])
  // cbGrpprl = 0xfffd (-3 as int16) used to make the offset stand still forever
  const t = Date.now()
  assert.throws(
    () => readWord(wordFile([{ text: 'x\r', compressed: true }], { prc: Uint8Array.of(0x01, 0xfd, 0xff) })),
    (e) => e instanceof WordError && e.code === 'corrupt'
  )
  // other negative values used to walk backwards into earlier records
  assert.throws(
    () => readWord(wordFile([{ text: 'x\r', compressed: true }], { prc: Uint8Array.of(0x01, 0x00, 0x80) })),
    (e) => e instanceof WordError
  )
  assert.ok(Date.now() - t < 1000, 'crafted CLX returns at once')
})

test('word: thousands of field begin/separator pairs stay linear', () => {
  const text = '\x13 F \x14'.repeat(20000) + 'end' + '\x15'.repeat(20000) + '\r'
  const t = Date.now()
  const m = readWord(wordFile([{ text, compressed: true }]))
  assert.deepEqual(paras(m.blocks), ['end'])
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`)
})
