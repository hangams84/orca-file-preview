import { assert, test } from 'orca/testing'
import { FormulaEngine, FormulaError, formatGeneral, type CellInput, type Workbook } from './formula.ts'

/** A tiny workbook from `{ Sheet: { A1: value | '=formula' } }`. */
function book(sheets: Record<string, Record<string, unknown>>): Workbook {
  const data = new Map<string, CellInput>()
  for (const [name, cells] of Object.entries(sheets)) {
    for (const [addr, v] of Object.entries(cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(addr)!
      let c = 0
      for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64
      const cell: CellInput = typeof v === 'string' && v.startsWith('=') ? { f: v.slice(1), t: 'z' } : { v }
      data.set(`${name}!${Number(m[2]) - 1},${c - 1}`, cell)
    }
  }
  const names = Object.keys(sheets)
  return {
    sheet: (n) => names.find((s) => s.toLowerCase() === n.toLowerCase()) ?? null,
    cell: (s, r, c) => data.get(`${s}!${r},${c}`)
  }
}

const value = (wb: Workbook, f: string, sheet = 'S') => {
  const r = new FormulaEngine(wb).evaluate(f, sheet)
  return r.ok ? r.value : `unsupported: ${r.reason}`
}

test('arithmetic, precedence, unary minus and percent', () => {
  const wb = book({ S: {} })
  assert.equal(value(wb, '1+2*3'), 7)
  assert.equal(value(wb, '(1+2)*3'), 9)
  assert.equal(value(wb, '2^3^2'), 64)
  assert.equal(value(wb, '-2^2'), 4)
  assert.equal(value(wb, '10/4'), 2.5)
  assert.equal(value(wb, '50%*8'), 4)
  assert.equal(value(wb, '1.5e2+.5'), 150.5)
})

test('strings, concatenation, comparisons and booleans', () => {
  const wb = book({ S: { A1: 'abc', A2: 3 } })
  assert.equal(value(wb, '"a""b"&"c"'), 'a"bc')
  assert.equal(value(wb, 'A1&A2'), 'abc3')
  assert.equal(value(wb, 'A2>=3'), true)
  assert.equal(value(wb, 'A1="ABC"'), true)
  assert.equal(value(wb, '1<>1'), false)
  assert.equal(value(wb, '"b">"a"'), true)
  assert.equal(value(wb, 'TRUE'), true)
  assert.equal(value(wb, 'NOT(FALSE)'), true)
})

test('cell references: relative, absolute, sheet-qualified and quoted', () => {
  const wb = book({ S: { A1: 2, B2: 5 }, 'My Sheet': { C3: 10 }, 매출: { A1: 7 }, Other: { A1: 1 } })
  assert.equal(value(wb, 'A1*B2'), 10)
  assert.equal(value(wb, '$A$1+$B2+B$2'), 12)
  assert.equal(value(wb, "'My Sheet'!C3+1"), 11)
  assert.equal(value(wb, 'Other!A1+other!A1'), 2)
  assert.equal(value(wb, '매출!A1*2'), 14)
  assert.equal(value(wb, 'Z99+1'), 1, 'blank cells count as 0')
})

test('functions over ranges', () => {
  const wb = book({ S: { A1: 1, A2: 2, A3: 3, A4: 'x', A5: true, B1: -4.5 } })
  assert.equal(value(wb, 'SUM(A1:A5)'), 6, 'text and booleans in ranges are ignored')
  assert.equal(value(wb, 'SUM(A1:A3,10,B1)'), 11.5)
  assert.equal(value(wb, 'AVERAGE(A1:A3)'), 2)
  assert.equal(value(wb, 'MIN(A1:B3)'), -4.5)
  assert.equal(value(wb, 'MAX(A1:A5)'), 3)
  assert.equal(value(wb, 'COUNT(A1:A6)'), 3)
  assert.equal(value(wb, 'COUNTA(A1:A6)'), 5)
  assert.equal(value(wb, 'ROUND(2.675,2)'), 2.68)
  assert.equal(value(wb, 'ROUND(-1.5,0)'), -2)
  assert.equal(value(wb, 'ABS(B1)'), 4.5)
  assert.equal(value(wb, 'IF(A1>0,"pos","neg")'), 'pos')
  assert.equal(value(wb, 'IF(A1>5,"big")'), false)
  assert.equal(value(wb, 'AND(A1>0,A2>0)'), true)
  assert.equal(value(wb, 'OR(A1>5,A2>5)'), false)
  assert.equal(value(wb, 'CONCATENATE("a",A1,"-",TRUE)'), 'a1-TRUE')
  assert.equal(value(wb, '_xlfn.CONCAT(A1:A3)'), '123')
  assert.equal(value(wb, 'LEN("한글abc")'), 5)
  assert.equal(value(wb, 'UPPER("abc")&LOWER("DEF")'), 'ABCdef')
})

test('recurses into formula cells (the openpyxl case) and memoizes', () => {
  const wb = book({
    S: { C2: 10, D2: 1500, E2: '=C2*D2', C3: 4, D3: 3000, E3: '=C3*D3', C6: '=SUM(C2:C5)', E6: '=SUM(E2:E5)' }
  })
  const eng = new FormulaEngine(wb)
  const e6 = eng.evaluateCell('S', 5, 4, 'SUM(E2:E5)')
  assert.ok(e6.ok)
  if (e6.ok) assert.equal(e6.value, 27000)
  const c6 = eng.evaluateCell('S', 5, 2, '=SUM(C2:C5)')
  if (c6.ok) assert.equal(c6.value, 14)
  else assert.fail('C6 should evaluate')
})

test('errors are values: division by zero and bad arithmetic', () => {
  const wb = book({ S: { A1: 'text' } })
  const d = value(wb, '1/0')
  assert.ok(d instanceof FormulaError)
  assert.equal(String(d), '#DIV/0!')
  assert.equal(String(value(wb, 'A1+1')), '#VALUE!')
  assert.equal(String(value(wb, 'SUM(1,1/0)')), '#DIV/0!')
})

test('cycles, unknown functions and unsupported syntax are reported, not thrown', () => {
  const wb = book({ S: { A1: '=B1+1', B1: '=A1+1', C1: '=C1' } })
  const eng = new FormulaEngine(wb)
  assert.equal(eng.evaluateCell('S', 0, 0, 'B1+1').ok, false)
  assert.equal(eng.evaluateCell('S', 0, 2, 'C1').ok, false)
  for (const f of ['VLOOKUP(1,A1:B2,2,FALSE)', 'A:A', 'SUM(', '1+', 'Missing!A1', 'MyName*2', '{1,2}', 'IF(1,,2)']) {
    const r = eng.evaluate(f, 'S')
    assert.equal(r.ok, false, f)
  }
})

test('deep reference chains stop at the depth limit', () => {
  const cells: Record<string, unknown> = { A1: 1 }
  for (let i = 2; i <= 200; i++) cells[`A${i}`] = `=A${i - 1}+1`
  const eng = new FormulaEngine(book({ S: cells }))
  assert.equal(eng.evaluateCell('S', 199, 0, 'A199+1').ok, false)
  const near = eng.evaluateCell('S', 9, 0, 'A9+1')
  assert.ok(near.ok && near.value === 10)
})

test('general number format', () => {
  assert.equal(formatGeneral(15000), '15000')
  assert.equal(formatGeneral(0.1 + 0.2), '0.3')
  assert.equal(formatGeneral(1 / 3), '0.3333333333')
})

test('cells outside the loaded window make the formula unsupported, not zero', () => {
  const base = book({ S: { A1: 1, A2: 2 } })
  const wb = { ...base, known: (_s: string, r: number) => r < 2 }
  const eng = new FormulaEngine(wb)
  assert.equal(eng.evaluate('A1+A2', 'S').ok, true)
  assert.equal(eng.evaluate('A1+A3', 'S').ok, false)
  assert.equal(eng.evaluate('SUM(A1:A9)', 'S').ok, false)
})
