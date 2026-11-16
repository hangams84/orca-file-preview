import { assert, test } from 'orca/testing'
import { decodeText } from '../../core/encoding.ts'
import { detectDelimiter, guessHeader, isNumeric, parseChunk, toNumber } from './csvparse.ts'

const parse = (text: string, delim = ',') => parseChunk(text, delim, 0, Number.MAX_SAFE_INTEGER).rows

test('csv: plain fields, LF and CRLF line ends give the same rows', () => {
  const lf = parse('a,b,c\n1,2,3\n')
  const crlf = parse('a,b,c\r\n1,2,3\r\n')
  const cr = parse('a,b,c\r1,2,3\r')
  assert.deepEqual(lf, [['a', 'b', 'c'], ['1', '2', '3']])
  assert.deepEqual(crlf, lf)
  assert.deepEqual(cr, lf)
})

test('csv: trailing newline does not add a row; missing one keeps the last row', () => {
  assert.equal(parse('x\ny\n').length, 2)
  assert.deepEqual(parse('x\ny'), [['x'], ['y']])
})

test('csv: quoted fields with delimiters, escaped quotes and embedded CR/LF', () => {
  const rows = parse('"a,b","say ""hi""","line1\nline2","cr\r\nlf"\n2,3,4,5\n')
  assert.deepEqual(rows[0], ['a,b', 'say "hi"', 'line1\nline2', 'cr\r\nlf'])
  assert.deepEqual(rows[1], ['2', '3', '4', '5'])
  assert.equal(rows.length, 2)
})

test('csv: empty fields, empty quoted field and trailing delimiter', () => {
  assert.deepEqual(parse(',,\n'), [['', '', '']])
  assert.deepEqual(parse('"",x\n'), [['', 'x']])
  assert.deepEqual(parse('a,b,'), [['a', 'b', '']])
})

test('csv: ragged rows keep their own lengths', () => {
  const rows = parse('a,b,c\n1\n1,2,3,4\n')
  assert.deepEqual(
    rows.map((r) => r.length),
    [3, 1, 4]
  )
})

test('csv: unterminated quote and stray text after a quote are tolerated', () => {
  assert.deepEqual(parse('"open,never closed'), [['open,never closed']])
  assert.deepEqual(parse('"ab"cd,e\n'), [['abcd', 'e']])
})

test('csv: parseChunk stops at the limit and resumes at `next`', () => {
  const text = 'r1\nr2\nr3\n'
  const a = parseChunk(text, ',', 0, 2)
  assert.deepEqual(a.rows, [['r1'], ['r2']])
  const b = parseChunk(text, ',', a.next, 10)
  assert.deepEqual(b.rows, [['r3']])
})

test('csv: delimiter auto-detect for comma, semicolon, tab and pipe', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n4,5,6\n', ','), ',')
  assert.equal(detectDelimiter('a;b;c\n1;2,5;3\n4;5;6\n', ','), ';')
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3\n', ','), '\t')
  assert.equal(detectDelimiter('a|b|c\n1|2|3\n', ','), '|')
  // a single column falls back to the preferred delimiter
  assert.equal(detectDelimiter('one\ntwo\n', '\t'), '\t')
})

test('csv: UTF-8 BOM is removed before parsing', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('이름,점수\n김,1\n')])
  const rows = parse(decodeText(bytes).text)
  assert.equal(rows[0][0], '이름')
})

test('csv: header guess and numeric detection', () => {
  assert.equal(guessHeader([['name', 'score'], ['a', '1'], ['b', '2']]), true)
  assert.equal(guessHeader([['1', '2'], ['3', '4']]), false)
  assert.equal(isNumeric('1,234.50'), true)
  assert.equal(isNumeric('-3e2'), true)
  assert.equal(isNumeric('2026-01-02'), false)
  assert.equal(isNumeric(''), false)
  assert.equal(toNumber('₩1,234'), 1234)
})

test('csv: 50,000 rows parse within the time bound', () => {
  const lines = ['id,name,city,score']
  for (let i = 0; i < 50000; i++) lines.push(`${i},"name ${i}",서울,${i % 100}`)
  const text = lines.join('\r\n') + '\r\n'
  const t = Date.now()
  const rows = parse(text)
  const ms = Date.now() - t
  assert.equal(rows.length, 50001)
  assert.deepEqual(rows[50000], ['49999', 'name 49999', '서울', '99'])
  assert.ok(ms < 2000, `parse took ${ms} ms`)
})

test('csv: a very long whitespace cell does not make number detection backtrack', () => {
  const evil = '1' + ' '.repeat(50000) + 'x'
  const t = Date.now()
  assert.equal(isNumeric(evil), false)
  assert.equal(isNumeric(' 42 '), true)
  assert.equal(isNumeric('9'.repeat(65)), false, 'cells over 64 characters are not numbers')
  assert.equal(guessHeader([['name', 'v'], [evil, '1'], [evil, '2']]), true)
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`)
})
