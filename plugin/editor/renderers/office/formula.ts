/** A small, safe spreadsheet formula evaluator for cells saved with a formula but no cached result
 *  (openpyxl, scripts and some exporters write those). It is a hand-written tokenizer + recursive
 *  descent parser + interpreter: no eval, no Function. Anything it does not understand makes the
 *  whole formula "unsupported" so the caller keeps showing the formula text.
 *
 *  Supported: numbers, strings, TRUE/FALSE, cell refs (A1, $A$1, Sheet!A1, 'Sheet name'!A1),
 *  ranges (A1:B3), + - * / ^ & unary - and postfix %, = <> < > <= >=, parentheses, and SUM,
 *  AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ROUND, ABS, AND, OR, NOT, CONCAT, CONCATENATE, LEN,
 *  UPPER, LOWER. Referenced formula cells are evaluated recursively with a cycle guard. */

/** An Excel error value such as `#DIV/0!`. */
export class FormulaError {
  constructor(readonly code: string) {}
  toString(): string {
    return this.code
  }
}

export type Scalar = number | string | boolean | null | FormulaError

/** What the evaluator needs to know about a cell. `null`/`undefined` = blank. */
export interface CellInput {
  /** Cached value (absent for formula-only cells). */
  v?: unknown
  /** Formula without the leading `=`. */
  f?: string
  /** SheetJS type: `z` marks a stub with no value. */
  t?: string
}

export interface Workbook {
  /** Canonical sheet name for a reference (case-insensitive match), or null when it does not exist. */
  sheet(name: string): string | null
  cell(sheet: string, row: number, col: number): CellInput | null | undefined
}

export type EvalResult = { ok: true; value: Scalar } | { ok: false; reason: string }

class Unsupported extends Error {}

const MAX_DEPTH = 64
const MAX_RANGE_CELLS = 200_000

/** Shared per-workbook state: memoized results and the cells being evaluated (cycle guard). */
export class FormulaEngine {
  private memo = new Map<string, Scalar | Unsupported>()
  private active = new Set<string>()

  constructor(private wb: Workbook) {}

  /** Evaluates the formula of the cell at (sheet, row, col). */
  evaluateCell(sheet: string, row: number, col: number, formula: string): EvalResult {
    try {
      return { ok: true, value: this.cellFormula(sheet, row, col, formula, 0) }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Evaluates a formula in the context of a sheet (for tests and one-off use). */
  evaluate(formula: string, sheet: string): EvalResult {
    try {
      return { ok: true, value: toScalar(this.run(formula, sheet, 0)) }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  }

  private cellFormula(sheet: string, row: number, col: number, formula: string, depth: number): Scalar {
    const key = `${sheet}\u0000${row}\u0000${col}`
    const hit = this.memo.get(key)
    if (hit instanceof Unsupported) throw hit
    if (hit !== undefined) return hit
    if (this.active.has(key)) throw new Unsupported('circular reference')
    if (depth > MAX_DEPTH) throw new Unsupported('too deep')
    this.active.add(key)
    try {
      const v = toScalar(this.run(formula, sheet, depth))
      this.memo.set(key, v)
      return v
    } catch (e) {
      const err = e instanceof Unsupported ? e : new Unsupported(String((e as Error)?.message ?? e))
      // Cycles and depth limits depend on the entry point; do not memoize them.
      if (err.message !== 'circular reference' && err.message !== 'too deep') this.memo.set(key, err)
      throw err
    } finally {
      this.active.delete(key)
    }
  }

  private run(formula: string, sheet: string, depth: number): Value {
    const src = formula.startsWith('=') ? formula.slice(1) : formula
    const ast = new Parser(tokenize(src)).parseFormula()
    return this.eval(ast, sheet, depth)
  }

  /** Value of one referenced cell. */
  private ref(sheet: string, row: number, col: number, depth: number): Scalar {
    const c = this.wb.cell(sheet, row, col)
    if (!c) return null
    const hasValue = c.v !== undefined && c.t !== 'z'
    if (hasValue) return fromRaw(c.v, c.t)
    if (c.f) return this.cellFormula(sheet, row, col, c.f, depth + 1)
    return null
  }

  private eval(n: Node, sheet: string, depth: number): Value {
    switch (n.k) {
      case 'num':
        return n.v
      case 'str':
        return n.v
      case 'bool':
        return n.v
      case 'ref': {
        const sh = this.sheetOf(n.sheet, sheet)
        return this.ref(sh, n.r, n.c, depth)
      }
      case 'range': {
        const sh = this.sheetOf(n.sheet, sheet)
        const r0 = Math.min(n.r1, n.r2)
        const r1 = Math.max(n.r1, n.r2)
        const c0 = Math.min(n.c1, n.c2)
        const c1 = Math.max(n.c1, n.c2)
        if ((r1 - r0 + 1) * (c1 - c0 + 1) > MAX_RANGE_CELLS) throw new Unsupported('range too large')
        const cells: Scalar[] = []
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push(this.ref(sh, r, c, depth))
        return { range: cells }
      }
      case 'neg': {
        const v = num(this.scalar(n.a, sheet, depth))
        return v instanceof FormulaError ? v : -v
      }
      case 'pct': {
        const v = num(this.scalar(n.a, sheet, depth))
        return v instanceof FormulaError ? v : v / 100
      }
      case 'bin':
        return this.binary(n.op, this.scalar(n.a, sheet, depth), this.scalar(n.b, sheet, depth))
      case 'call':
        return this.call(n.name, n.args, sheet, depth)
    }
  }

  private sheetOf(name: string | null, current: string): string {
    if (name == null) return current
    const s = this.wb.sheet(name)
    if (s == null) throw new Unsupported(`unknown sheet ${name}`)
    return s
  }

  /** A node that must be a single value (a one-cell range collapses to its cell). */
  private scalar(n: Node, sheet: string, depth: number): Scalar {
    const v = this.eval(n, sheet, depth)
    if (isRange(v)) {
      if (v.range.length === 1) return v.range[0]
      throw new Unsupported('range used as a value')
    }
    return v
  }

  private binary(op: string, a: Scalar, b: Scalar): Scalar {
    if (a instanceof FormulaError) return a
    if (b instanceof FormulaError) return b
    if (op === '&') return text(a) + text(b)
    if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
      const c = compare(a, b)
      switch (op) {
        case '=':
          return c === 0
        case '<>':
          return c !== 0
        case '<':
          return c < 0
        case '>':
          return c > 0
        case '<=':
          return c <= 0
        default:
          return c >= 0
      }
    }
    const x = num(a)
    const y = num(b)
    if (x instanceof FormulaError) return x
    if (y instanceof FormulaError) return y
    switch (op) {
      case '+':
        return x + y
      case '-':
        return x - y
      case '*':
        return x * y
      case '/':
        return y === 0 ? new FormulaError('#DIV/0!') : x / y
      case '^': {
        const r = Math.pow(x, y)
        return Number.isFinite(r) ? r : new FormulaError('#NUM!')
      }
    }
    throw new Unsupported(`operator ${op}`)
  }

  private call(name: string, args: Node[], sheet: string, depth: number): Value {
    const all = () => args.map((a) => this.eval(a, sheet, depth))
    const one = (i: number) => this.scalar(args[i], sheet, depth)
    const arity = (min: number, max = min) => {
      if (args.length < min || args.length > max) throw new Unsupported(`${name} arguments`)
    }
    switch (name) {
      case 'SUM':
      case 'AVERAGE':
      case 'MIN':
      case 'MAX':
      case 'COUNT': {
        const nums: number[] = []
        for (const v of all()) {
          if (isRange(v)) {
            for (const c of v.range) {
              if (c instanceof FormulaError) {
                if (name !== 'COUNT') return c
              } else if (typeof c === 'number') nums.push(c)
            }
          } else {
            if (v instanceof FormulaError) {
              if (name !== 'COUNT') return v
              continue
            }
            if (name === 'COUNT') {
              if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && isNumeric(v))) nums.push(0)
              continue
            }
            if (v === null) continue
            const n = num(v)
            if (n instanceof FormulaError) return n
            nums.push(n)
          }
        }
        if (name === 'COUNT') return nums.length
        if (name === 'SUM') return nums.reduce((s, x) => s + x, 0)
        if (name === 'AVERAGE') return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : new FormulaError('#DIV/0!')
        if (!nums.length) return 0
        return name === 'MIN' ? Math.min(...nums) : Math.max(...nums)
      }
      case 'COUNTA': {
        let n = 0
        for (const v of all()) {
          if (isRange(v)) n += v.range.filter((c) => c !== null && c !== '').length
          else n++
        }
        return n
      }
      case 'IF': {
        arity(1, 3)
        const cond = bool(one(0))
        if (cond instanceof FormulaError) return cond
        if (cond) return args.length > 1 ? one(1) : true
        return args.length > 2 ? one(2) : false
      }
      case 'ROUND': {
        arity(2)
        const x = num(one(0))
        const d = num(one(1))
        if (x instanceof FormulaError) return x
        if (d instanceof FormulaError) return d
        const p = Math.pow(10, Math.trunc(d))
        // Excel rounds half away from zero; nudge for binary representation (2.675 → 2.68).
        return (Math.sign(x) * Math.round(Math.abs(x) * p * (1 + Number.EPSILON))) / p
      }
      case 'ABS': {
        arity(1)
        const x = num(one(0))
        return x instanceof FormulaError ? x : Math.abs(x)
      }
      case 'AND':
      case 'OR': {
        const vals: boolean[] = []
        for (const v of all()) {
          const list = isRange(v) ? v.range.filter((c) => typeof c === 'boolean' || typeof c === 'number') : [v]
          for (const c of list) {
            if (c === null) continue
            const b = bool(c)
            if (b instanceof FormulaError) return b
            vals.push(b)
          }
        }
        if (!vals.length) return new FormulaError('#VALUE!')
        return name === 'AND' ? vals.every(Boolean) : vals.some(Boolean)
      }
      case 'NOT': {
        arity(1)
        const b = bool(one(0))
        return b instanceof FormulaError ? b : !b
      }
      case 'CONCAT':
      case 'CONCATENATE': {
        let s = ''
        for (const v of all()) {
          if (isRange(v)) {
            if (name === 'CONCATENATE' && v.range.length !== 1) throw new Unsupported('CONCATENATE range')
            for (const c of v.range) {
              if (c instanceof FormulaError) return c
              s += text(c)
            }
          } else {
            if (v instanceof FormulaError) return v
            s += text(v)
          }
        }
        return s
      }
      case 'LEN':
      case 'UPPER':
      case 'LOWER': {
        arity(1)
        const v = one(0)
        if (v instanceof FormulaError) return v
        const s = text(v)
        return name === 'LEN' ? s.length : name === 'UPPER' ? s.toUpperCase() : s.toLowerCase()
      }
    }
    throw new Unsupported(`function ${name}`)
  }
}

// ---------------------------------------------------------------- values

interface RangeValue {
  range: Scalar[]
}
type Value = Scalar | RangeValue

function isRange(v: Value): v is RangeValue {
  return typeof v === 'object' && v !== null && !(v instanceof FormulaError)
}

function toScalar(v: Value): Scalar {
  if (isRange(v)) {
    if (v.range.length === 1) return v.range[0]
    throw new Unsupported('array result')
  }
  return v
}

function fromRaw(v: unknown, t?: string): Scalar {
  if (t === 'e') return new FormulaError(typeof v === 'string' ? v : '#VALUE!')
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  if (v instanceof Date) return dateSerial(v)
  return null
}

/** Excel serial date (1900 system) for a JS Date. */
function dateSerial(d: Date): number {
  return (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000 - d.getTimezoneOffset() / 1440
}

function isNumeric(s: string): boolean {
  return s.trim() !== '' && Number.isFinite(Number(s))
}

function num(v: Scalar): number | FormulaError {
  if (v instanceof FormulaError) return v
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (isNumeric(v)) return Number(v)
  return new FormulaError('#VALUE!')
}

function bool(v: Scalar): boolean | FormulaError {
  if (v instanceof FormulaError) return v
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const u = v.toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  return new FormulaError('#VALUE!')
}

/** Text form used by `&` and text functions (Excel general format, roughly). */
export function text(v: Scalar): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return formatGeneral(v)
  return String(v)
}

/** Number in Excel's "General" style: up to 10 significant digits, no trailing zeros. */
export function formatGeneral(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) return n.toExponential(5).replace(/\.?0+e/, 'E').replace('e', 'E')
  return String(Number(n.toPrecision(10)))
}

/** Excel ordering: numbers < text < booleans; text compares case-insensitively; blank acts as 0 / "". */
function compare(a: Scalar, b: Scalar): number {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0
  const rank = (v: Scalar) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase()
    const y = b.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  const x = Number(a)
  const y = Number(b)
  return x < y ? -1 : x > y ? 1 : 0
}

// ---------------------------------------------------------------- tokens

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; sheet: string | null; r: number; c: number; r2?: number; c2?: number }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'end' }

const CELL = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})/

function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Splits a formula into tokens. Throws Unsupported on anything unexpected. */
export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const rest = () => src.slice(i)
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      i++
      continue
    }
    if (ch === '"') {
      let s = ''
      i++
      for (;;) {
        if (i >= src.length) throw new Unsupported('unterminated string')
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"'
            i += 2
            continue
          }
          i++
          break
        }
        s += src[i++]
      }
      out.push({ t: 'str', v: s })
      continue
    }
    // Sheet-qualified reference: 'Sheet name'!A1 or Sheet1!A1
    let sheet: string | null = null
    if (ch === "'") {
      let s = ''
      let j = i + 1
      for (;;) {
        if (j >= src.length) throw new Unsupported('unterminated sheet name')
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'"
            j += 2
            continue
          }
          j++
          break
        }
        s += src[j++]
      }
      if (src[j] !== '!') throw new Unsupported('quoted name')
      sheet = s
      i = j + 1
    } else {
      const m = /^([A-Za-z_À-￿][\w.À-￿]*)!/.exec(rest())
      if (m) {
        sheet = m[1]
        i += m[0].length
      }
    }
    if (sheet != null) {
      const ref = readRef(rest())
      if (!ref) throw new Unsupported('reference after sheet name')
      i += ref.len
      out.push({ t: 'ref', sheet, ...ref.tok })
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest())
      if (!m) throw new Unsupported('number')
      out.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_$]/.test(ch)) {
      // A function name (followed by "(") wins over a cell-looking name such as LOG10(.
      const fn = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(rest())
      if (fn) {
        out.push({ t: 'name', v: fn[1].toUpperCase() })
        i += fn[1].length
        continue
      }
      const ref = readRef(rest())
      if (ref) {
        i += ref.len
        out.push({ t: 'ref', sheet: null, ...ref.tok })
        continue
      }
      const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest())
      if (word) {
        const u = word[0].toUpperCase()
        if (u === 'TRUE' || u === 'FALSE') out.push({ t: 'name', v: u })
        else throw new Unsupported(`name ${word[0]}`)
        i += word[0].length
        continue
      }
      throw new Unsupported(`character ${ch}`)
    }
    const two = src.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/^&=<>(),%'.includes(ch)) {
      out.push({ t: 'op', v: ch })
      i++
      continue
    }
    throw new Unsupported(`character ${ch}`)
  }
  out.push({ t: 'end' })
  return out
}

function readRef(s: string): { len: number; tok: { r: number; c: number; r2?: number; c2?: number } } | null {
  const a = CELL.exec(s)
  if (!a) return null
  // Not a reference when letters/digits continue (e.g. a defined name like ABC1X).
  const after = s[a[0].length]
  if (after && /[A-Za-z0-9_]/.test(after)) return null
  const tok: { r: number; c: number; r2?: number; c2?: number } = { c: colIndex(a[1]), r: Number(a[2]) - 1 }
  let len = a[0].length
  if (s[len] === ':') {
    const b = CELL.exec(s.slice(len + 1))
    if (!b) throw new Unsupported('range form')
    tok.c2 = colIndex(b[1])
    tok.r2 = Number(b[2]) - 1
    len += 1 + b[0].length
  }
  if (tok.c > 16383 || (tok.c2 ?? 0) > 16383) return null
  return { len, tok }
}

// ---------------------------------------------------------------- parser

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'ref'; sheet: string | null; r: number; c: number }
  | { k: 'range'; sheet: string | null; r1: number; c1: number; r2: number; c2: number }
  | { k: 'neg'; a: Node }
  | { k: 'pct'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] }

class Parser {
  private i = 0
  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i]
  }
  private isOp(v: string): boolean {
    const t = this.peek()
    return t.t === 'op' && t.v === v
  }
  private expectOp(v: string): void {
    if (!this.isOp(v)) throw new Unsupported(`expected ${v}`)
    this.i++
  }

  parseFormula(): Node {
    const n = this.comparison()
    if (this.peek().t !== 'end') throw new Unsupported('trailing input')
    return n
  }

  private comparison(): Node {
    let a = this.concat()
    for (;;) {
      const t = this.peek()
      if (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
        this.i++
        a = { k: 'bin', op: t.v, a, b: this.concat() }
      } else return a
    }
  }
  private concat(): Node {
    let a = this.additive()
    while (this.isOp('&')) {
      this.i++
      a = { k: 'bin', op: '&', a, b: this.additive() }
    }
    return a
  }
  private additive(): Node {
    let a = this.multiplicative()
    for (;;) {
      if (this.isOp('+') || this.isOp('-')) {
        const op = (this.toks[this.i++] as { v: string }).v
        a = { k: 'bin', op, a, b: this.multiplicative() }
      } else return a
    }
  }
  private multiplicative(): Node {
    let a = this.power()
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = (this.toks[this.i++] as { v: string }).v
        a = { k: 'bin', op, a, b: this.power() }
      } else return a
    }
  }
  private power(): Node {
    let a = this.unary()
    while (this.isOp('^')) {
      this.i++
      a = { k: 'bin', op: '^', a, b: this.unary() }
    }
    return a
  }
  /** Excel binds negation tighter than ^ (-2^2 = 4). */
  private unary(): Node {
    if (this.isOp('-')) {
      this.i++
      return { k: 'neg', a: this.unary() }
    }
    if (this.isOp('+')) {
      this.i++
      return this.unary()
    }
    return this.postfix()
  }
  private postfix(): Node {
    let a = this.primary()
    while (this.isOp('%')) {
      this.i++
      a = { k: 'pct', a }
    }
    return a
  }
  private primary(): Node {
    const t = this.peek()
    this.i++
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v }
      case 'str':
        return { k: 'str', v: t.v }
      case 'ref':
        return t.r2 != null && t.c2 != null
          ? { k: 'range', sheet: t.sheet, r1: t.r, c1: t.c, r2: t.r2, c2: t.c2 }
          : { k: 'ref', sheet: t.sheet, r: t.r, c: t.c }
      case 'name': {
        if ((t.v === 'TRUE' || t.v === 'FALSE') && !this.isOp('(')) return { k: 'bool', v: t.v === 'TRUE' }
        this.expectOp('(')
        const args: Node[] = []
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.comparison())
            if (this.isOp(',')) {
              this.i++
              continue
            }
            break
          }
        }
        this.expectOp(')')
        return { k: 'call', name: t.v.replace(/^_XLFN\./, ''), args }
      }
      case 'op':
        if (t.v === '(') {
          const n = this.comparison()
          this.expectOp(')')
          return n
        }
    }
    throw new Unsupported('unexpected token')
  }
}
