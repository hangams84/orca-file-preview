import { assert, test } from 'orca/testing'
import { PptError, readPpt } from './pptbin.ts'
import { concat, fakeCfb, i16le, latin1, record, u32le, utf16le } from './testkit.ts'

const T = {
  Document: 0x03e8,
  DocumentAtom: 0x03e9,
  Slide: 0x03ee,
  PPDrawing: 0x040c,
  Dg: 0xf002,
  Spgr: 0xf003,
  Sp: 0xf004,
  ClientAnchor: 0xf010,
  ClientTextbox: 0xf00d,
  TextHeader: 0x0f9f,
  TextChars: 0x0fa0,
  TextBytes: 0x0fa8
}

/** top, left, right, bottom in master units (SmallRectStruct). */
const anchor = (t: number, l: number, r: number, b: number) => record(T.ClientAnchor, i16le(t, l, r, b))
const textShape = (type: number, text: Uint8Array, atom: number, rect = anchor(100, 100, 1000, 400)) =>
  record(T.Sp, [rect, record(T.ClientTextbox, [record(T.TextHeader, u32le(type)), record(atom, text)])])

function deck(slides: Uint8Array[][], size: [number, number] = [5760, 4320]): Uint8Array {
  const doc = record(T.Document, [record(T.DocumentAtom, concat(u32le(size[0], size[1]), new Uint8Array(32)), 0, 1)])
  return concat(doc, ...slides.map((shapes) => record(T.Slide, [record(T.PPDrawing, [record(T.Dg, [record(T.Spgr, shapes)])])])))
}

const pptOf = (stream: Uint8Array) => readPpt(fakeCfb({ 'PowerPoint Document': stream }))
const text = (p: { runs: { text: string }[] }[] | undefined) => (p ?? []).map((x) => x.runs.map((r) => r.text).join(''))

test('ppt: TextCharsAtom is UTF-16LE, TextBytesAtom is single-byte; \\r splits paragraphs', () => {
  const d = pptOf(
    deck([[textShape(0, utf16le('제목 Title'), T.TextChars), textShape(1, latin1('caf\xe9\rsecond'), T.TextBytes, anchor(500, 100, 1000, 900))]])
  )
  assert.equal(d.slides.length, 1)
  const [title, body] = d.slides[0].shapes
  assert.deepEqual(text(title.paras), ['제목 Title'])
  assert.equal(title.textType, 0)
  assert.deepEqual(text(body.paras), ['café', 'second'])
  assert.equal(body.paras![0].bullet, '•', 'body placeholders get bullets by default')
})

test('ppt: DocumentAtom slide size and ClientAnchor rectangle', () => {
  const d = pptOf(deck([[textShape(4, utf16le('x'), T.TextChars, anchor(10, 20, 220, 110))]], [7680, 4320]))
  assert.equal(d.width, 7680)
  assert.equal(d.height, 4320)
  const s = d.slides[0].shapes[0]
  assert.deepEqual([s.x, s.y, s.w, s.h], [20, 10, 200, 100])
})

test('ppt: slides keep their order and vertical tab becomes a line break', () => {
  const d = pptOf(deck([[textShape(0, utf16le('one'), T.TextChars)], [textShape(0, utf16le('two\x0bline'), T.TextChars)]]))
  assert.deepEqual(
    d.slides.map((s) => text(s.shapes[0].paras)[0]),
    ['one', 'two\nline']
  )
})

test('ppt: a record whose recLen runs past its parent stops the walk without throwing', () => {
  const good = textShape(0, utf16le('kept'), T.TextChars)
  const bad = record(T.Sp, [anchor(1, 1, 2, 2)])
  new DataView(bad.buffer).setUint32(4, 0x7fffffff, true) // absurd recLen
  const d = pptOf(deck([[good, bad]]))
  assert.deepEqual(text(d.slides[0].shapes[0].paras), ['kept'])
  assert.equal(d.slides[0].shapes.length, 1)
})

test('ppt: truncated top-level slide record is ignored', () => {
  const full = deck([[textShape(0, utf16le('a'), T.TextChars)], [textShape(0, utf16le('b'), T.TextChars)]])
  const d = pptOf(full.subarray(0, full.length - 5))
  assert.equal(d.slides.length, 1)
})

test('ppt: no DocumentContainer or no stream is a "corrupt" PptError', () => {
  assert.throws(() => readPpt(fakeCfb({})), (e) => e instanceof PptError && e.code === 'corrupt')
  assert.throws(() => pptOf(record(T.Slide, [record(0x03ef, new Uint8Array(24), 0, 2)])), (e) => e instanceof PptError && e.code === 'corrupt')
})

test('ppt: encrypted Current User token raises "encrypted"', () => {
  const cu = concat(record(0x0ff6, concat(u32le(20, 0xf3d1c4df, 0), new Uint8Array(8))))
  assert.throws(
    () => readPpt(fakeCfb({ 'PowerPoint Document': deck([[]]), 'Current User': cu })),
    (e) => e instanceof PptError && e.code === 'encrypted'
  )
})
