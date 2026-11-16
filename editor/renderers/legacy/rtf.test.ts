import { assert, test } from 'orca/testing'
import type { Paragraph, Table } from './model.ts'
import { isRtf, readRtf } from './rtf.ts'

const rtf = (s: string) => readRtf(new TextEncoder().encode(s))
const texts = (s: string) =>
  rtf(s)
    .blocks.filter((b): b is Paragraph => b.kind === 'p')
    .map((p) => p.runs.map((r) => r.text).join(''))

test('rtf: signature sniffing', () => {
  assert.equal(isRtf(new TextEncoder().encode('{\\rtf1\\ansi x}')), true)
  assert.equal(isRtf(new TextEncoder().encode('<html>')), false)
})

test('rtf: groups scope bold/italic and restore on close', () => {
  const m = rtf('{\\rtf1 a {\\b bold {\\i both}} plain\\par}')
  const runs = (m.blocks[0] as Paragraph).runs
  assert.deepEqual(
    runs.map((r) => [r.text, !!r.b, !!r.i]),
    [
      ['a ', false, false],
      ['bold ', true, false],
      ['both', true, true],
      [' plain', false, false]
    ]
  )
})

test('rtf: \\uN with \\ucN skips the fallback characters', () => {
  assert.deepEqual(texts('{\\rtf1 \\u54620?\\u44544?\\par}'), ['한글'])
  assert.deepEqual(texts('{\\rtf1 {\\uc2 \\u54620\\\'c7\\\'d1x}\\par}'), ['한x'])
  // negative values are UTF-16 code units above 0x7fff
  assert.deepEqual(texts('{\\rtf1 \\u-10179?\\par}'), [String.fromCharCode(65536 - 10179)])
})

test("rtf: \\'hh bytes decode with \\ansicpg949 (Korean)", () => {
  assert.deepEqual(texts("{\\rtf1\\ansi\\ansicpg949 \\'c7\\'d1\\'b1\\'db\\par}"), ['한글'])
  assert.deepEqual(texts("{\\rtf1\\ansi \\'e9t\\'e9\\par}"), ['été'])
})

test('rtf: colour table, \\cf, \\highlight and \\fs per run', () => {
  const m = rtf('{\\rtf1{\\colortbl ;\\red192\\green38\\blue38;\\red255\\green255\\blue0;}plain {\\cf1\\fs28 red}{\\highlight2 mark} back\\par}')
  const runs = (m.blocks[0] as Paragraph).runs
  const red = runs.find((r) => r.text === 'red')!
  assert.equal(red.color, 'rgb(192,38,38)')
  assert.equal(red.pt, 14)
  assert.equal(runs.find((r) => r.text === 'mark')!.bg, 'rgb(255,255,0)')
  const back = runs.find((r) => r.text.includes('back'))!
  assert.equal(back.color, undefined)
  assert.equal(back.pt, undefined)
})

test('rtf: destinations (fonttbl, \\*) are skipped; escapes and specials map', () => {
  assert.deepEqual(texts('{\\rtf1{\\fonttbl{\\f0 Arial;}}{\\*\\generator x;}a\\{b\\}c\\\\d\\tab e\\emdash f\\par}'), ['a{b}c\\d\te—f'])
})

test('rtf: tables from \\cell / \\row and page breaks', () => {
  const m = rtf('{\\rtf1 \\trowd\\pard\\intbl A\\cell B\\cell\\row\\trowd\\pard\\intbl C\\cell D\\cell\\row\\pard after\\par\\page next\\par}')
  const t = m.blocks.find((b): b is Table => b.kind === 'table')!
  assert.deepEqual(
    t.rows.map((r) => r.map((c) => (c[0] as Paragraph).runs.map((x) => x.text).join(''))),
    [
      ['A', 'B'],
      ['C', 'D']
    ]
  )
  assert.ok(m.blocks.some((b) => b.kind === 'break'))
})

test('rtf: unbalanced braces and garbage do not throw', () => {
  assert.ok(Array.isArray(rtf('{\\rtf1 {{{ unclosed \\b').blocks))
  assert.ok(Array.isArray(rtf('{\\rtf1 }}}} extra \\par}').blocks))
})
