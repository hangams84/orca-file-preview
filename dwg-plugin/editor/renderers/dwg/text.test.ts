import { assert, test } from 'orca/testing'
import { decodeControlCodes, parseMText, wrapLine } from './text.ts'

test('TEXT control codes', () => {
  assert.equal(decodeControlCodes('30%%d %%p0.1 %%c12 100%%%'), '30° ±0.1 ⌀12 100%')
  assert.equal(decodeControlCodes('%%uunder%%u'), 'under')
  assert.equal(decodeControlCodes('\\U+D55C\\U+AE00'), '한글')
  assert.equal(decodeControlCodes('%%065'), 'A')
})

test('MTEXT paragraphs, fonts and stacked fractions', () => {
  const lines = parseMText('{\\fArial|b1;MTEXT 여러 줄}\\P두 번째 줄\\P세 번째 \\S1/2; 분수')
  assert.deepEqual(
    lines.map((l) => l.text),
    ['MTEXT 여러 줄', '두 번째 줄', '세 번째 1/2 분수']
  )
})

test('MTEXT formatting codes are dropped, escapes kept', () => {
  const [l] = parseMText('\\A1;\\C1;red \\Lunder\\l \\Q15;x\\~y \\{brace\\} a\\\\b')
  assert.equal(l.text, 'red under x\u00a0y {brace} a\\b')
})

test('MTEXT height changes are reported per line', () => {
  const lines = parseMText('\\H2x;Big\\Psmall')
  assert.equal(lines[0].height, 2)
  assert.equal(lines[1].height, 1)
})

test('MTEXT stacked tolerances with ^ and #', () => {
  assert.equal(parseMText('\\S+0.1^-0.2;')[0].text, '+0.1/-0.2')
  assert.equal(parseMText('\\S3#4;')[0].text, '3/4')
})

test('word wrap: spaces for Latin text, between characters for Korean', () => {
  const m = (s: string) => s.length
  assert.deepEqual(wrapLine('aaa bbb ccc', 7, m), ['aaa bbb', 'ccc'])
  assert.deepEqual(wrapLine('가나다라마바', 4, m), ['가나다라', '마바'])
  assert.deepEqual(wrapLine('short', 0, m), ['short'])
})
