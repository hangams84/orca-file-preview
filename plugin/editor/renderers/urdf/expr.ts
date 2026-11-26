/** A safe evaluator for the Python expressions xacro writes inside `${…}`. It parses the
 *  expression into a tree and walks it: no `eval`, no `new Function` (the plugin frame's content
 *  security policy forbids both). Covered: int/float/str/bool/None/list literals, arithmetic with
 *  Python's int/float rules (`/` is true division, `//` floors, `%` takes the divisor's sign, `**`
 *  binds tighter than unary minus), comparisons (chained), `in`, `and`/`or`/`not` returning operands,
 *  `a if c else b`, calls, attribute access (`math.pi`), indexing, and the names xacro exposes:
 *  `pi`, `e`, the math module's functions, `abs min max round int float str bool len range sum
 *  sorted list any all`, and the `math.`, `python.` and `xacro.` namespaces. */

/** Python float; plain JS numbers are Python ints (always integral). */
export class PyFloat {
  constructor(readonly v: number) {}
}
export interface PyFunc {
  kind: 'func'
  name: string
  call(args: Value[]): Value
}
export interface PyNamespace {
  kind: 'ns'
  name: string
  get(key: string): Value | undefined
}
export type Value = number | PyFloat | string | boolean | null | Value[] | PyFunc | PyNamespace | { kind: 'opaque'; what: string }

export class ExprError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExprError'
  }
}

// ---------------------------------------------------------------------------------------------
// Values

export const isFloat = (v: Value): v is PyFloat => v instanceof PyFloat
const isInt = (v: Value): v is number | boolean => typeof v === 'number' || typeof v === 'boolean'
export const isNumber = (v: Value): v is number | boolean | PyFloat => isInt(v) || isFloat(v)
export function toNumber(v: Value): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof PyFloat) return v.v
  throw new ExprError(`expected a number, got ${typeName(v)}`)
}
export function typeName(v: Value): string {
  if (v === null) return 'NoneType'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'number') return 'int'
  if (typeof v === 'string') return 'str'
  if (v instanceof PyFloat) return 'float'
  if (Array.isArray(v)) return 'list'
  if (v.kind === 'func') return 'function'
  if (v.kind === 'ns') return 'namespace'
  return v.what
}
const flt = (x: number) => new PyFloat(x)
/** An int result, or a float when it no longer fits a safe integer. */
const int = (x: number): Value => (Number.isSafeInteger(x) ? x : flt(x))

export function truthy(v: Value): boolean {
  if (v === null || v === false) return false
  if (v === true) return true
  if (typeof v === 'number') return v !== 0
  if (v instanceof PyFloat) return v.v !== 0
  if (typeof v === 'string' || Array.isArray(v)) return v.length > 0
  return true
}

/** Python's repr() of a float: shortest round-trip digits, `.0` on whole numbers, exponent form
 *  below 1e-4 and from 1e16 on. */
export function floatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0'
  const [mant, expS] = x.toExponential().split('e')
  const exp = Number(expS)
  const neg = mant.startsWith('-')
  const digits = mant.replace(/^-/, '').replace('.', '')
  let s: string
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
    s = `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
  } else if (exp < 0) {
    s = `0.${'0'.repeat(-exp - 1)}${digits}`
  } else if (digits.length <= exp + 1) {
    s = `${digits}${'0'.repeat(exp + 1 - digits.length)}.0`
  } else {
    s = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`
  }
  return neg ? `-${s}` : s
}

/** Python's str(). */
export function pyStr(v: Value): string {
  if (typeof v === 'string') return v
  return pyRepr(v)
}
export function pyRepr(v: Value): string {
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
  if (v instanceof PyFloat) return floatRepr(v.v)
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`
  if (v.kind === 'func') return `<function ${v.name}>`
  if (v.kind === 'ns') return `<namespace ${v.name}>`
  return `<${v.what}>`
}

function equal(a: Value, b: Value): boolean {
  if (isNumber(a) && isNumber(b)) return toNumber(a) === toNumber(b)
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => equal(x, b[k]))
  return a === b
}

function compare(op: string, a: Value, b: Value): boolean {
  switch (op) {
    case '==':
      return equal(a, b)
    case '!=':
      return !equal(a, b)
    case 'in':
      return contains(b, a)
    case 'not in':
      return !contains(b, a)
    case 'is':
      return a === b || (a === null && b === null)
    case 'is not':
      return !(a === b || (a === null && b === null))
  }
  let c: number
  if (isNumber(a) && isNumber(b)) {
    const x = toNumber(a)
    const y = toNumber(b)
    c = x < y ? -1 : x > y ? 1 : x === y ? 0 : NaN
  } else if (typeof a === 'string' && typeof b === 'string') c = a < b ? -1 : a > b ? 1 : 0
  else throw new ExprError(`'${op}' not supported between ${typeName(a)} and ${typeName(b)}`)
  if (Number.isNaN(c)) return false
  return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0
}

function contains(container: Value, item: Value): boolean {
  if (typeof container === 'string') {
    if (typeof item !== 'string') throw new ExprError("'in <string>' requires a string")
    return container.includes(item)
  }
  if (Array.isArray(container)) return container.some((x) => equal(x, item))
  throw new ExprError(`argument of type ${typeName(container)} is not iterable`)
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b)
}
function pyMod(a: number, b: number): number {
  const r = a % b
  return r !== 0 && r < 0 !== b < 0 ? r + b : r
}

function binary(op: string, a: Value, b: Value): Value {
  if (op === '+') {
    if (typeof a === 'string' && typeof b === 'string') return a + b
    if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b]
  }
  if (op === '*') {
    if (typeof a === 'string' && isInt(b)) return a.repeat(Math.max(0, toNumber(b)))
    if (isInt(a) && typeof b === 'string') return b.repeat(Math.max(0, toNumber(a)))
    if (Array.isArray(a) && isInt(b)) return Array.from({ length: Math.max(0, toNumber(b)) }, () => a).flat()
  }
  if (op === '%' && typeof a === 'string') return percentFormat(a, b)
  if (!isNumber(a) || !isNumber(b)) throw new ExprError(`unsupported operand types for ${op}: ${typeName(a)} and ${typeName(b)}`)
  const x = toNumber(a)
  const y = toNumber(b)
  const ints = isInt(a) && isInt(b)
  switch (op) {
    case '+':
      return ints ? int(x + y) : flt(x + y)
    case '-':
      return ints ? int(x - y) : flt(x - y)
    case '*':
      return ints ? int(x * y) : flt(x * y)
    case '/':
      if (y === 0) throw new ExprError('division by zero')
      return flt(x / y)
    case '//':
      if (y === 0) throw new ExprError('integer division or modulo by zero')
      return ints ? int(floorDiv(x, y)) : flt(floorDiv(x, y))
    case '%':
      if (y === 0) throw new ExprError('integer division or modulo by zero')
      return ints ? int(pyMod(x, y)) : flt(pyMod(x, y))
    case '**':
      if (ints && y >= 0) return int(Math.pow(x, y))
      if (x === 0 && y < 0) throw new ExprError('0.0 cannot be raised to a negative power')
      return flt(Math.pow(x, y))
    case '&':
    case '|':
    case '^':
      if (!ints) throw new ExprError(`unsupported operand types for ${op}: ${typeName(a)} and ${typeName(b)}`)
      return op === '&' ? x & y : op === '|' ? x | y : x ^ y
  }
  throw new ExprError(`unknown operator ${op}`)
}

/** `'%s_%d' % (a, b)`: the common conversions only. */
function percentFormat(fmt: string, args: Value): string {
  const list = Array.isArray(args) ? args : [args]
  let k = 0
  return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d+))?([sdifgeExr%])/g, (_m, _flags, _w, prec, conv) => {
    if (conv === '%') return '%'
    const v = list[k++]
    if (v === undefined) throw new ExprError('not enough arguments for format string')
    if (conv === 's') return pyStr(v)
    if (conv === 'r') return pyRepr(v)
    const x = toNumber(v)
    if (conv === 'd' || conv === 'i') return String(Math.trunc(x))
    if (conv === 'f') return x.toFixed(prec ? Number(prec) : 6)
    if (conv === 'e' || conv === 'E') return x.toExponential(prec ? Number(prec) : 6).replace(/e([+-])(\d)$/, 'e$10$2')
    return String(prec ? Number(x.toPrecision(Number(prec))) : x)
  })
}

// ---------------------------------------------------------------------------------------------
// Built-in names

const fn = (name: string, call: (args: Value[]) => Value): PyFunc => ({ kind: 'func', name, call })
const arity = (name: string, args: Value[], min: number, max = min) => {
  if (args.length < min || args.length > max) throw new ExprError(`${name}() takes ${min === max ? min : `${min}–${max}`} argument(s), ${args.length} given`)
}
const math1 = (name: string, f: (x: number) => number) =>
  fn(name, (a) => {
    arity(name, a, 1)
    const r = f(toNumber(a[0]))
    if (Number.isNaN(r) && !Number.isNaN(toNumber(a[0]))) throw new ExprError('math domain error')
    return flt(r)
  })
const toInt = (x: number): Value => {
  if (!Number.isFinite(x)) throw new ExprError('cannot convert float infinity or NaN to integer')
  return int(Math.trunc(x))
}

function roundHalfEven(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

function iterate(v: Value): Value[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return [...v]
  throw new ExprError(`'${typeName(v)}' object is not iterable`)
}

function minMax(name: string, pick: (a: Value, b: Value) => boolean) {
  return fn(name, (args) => {
    const items = args.length === 1 ? iterate(args[0]) : args
    if (!items.length) throw new ExprError(`${name}() arg is an empty sequence`)
    let best = items[0]
    for (const x of items.slice(1)) if (pick(x, best)) best = x
    return best
  })
}

const MATH: Record<string, Value> = {
  pi: flt(Math.PI),
  e: flt(Math.E),
  tau: flt(2 * Math.PI),
  inf: flt(Infinity),
  nan: flt(NaN),
  sin: math1('sin', Math.sin),
  cos: math1('cos', Math.cos),
  tan: math1('tan', Math.tan),
  asin: math1('asin', Math.asin),
  acos: math1('acos', Math.acos),
  atan: math1('atan', Math.atan),
  sinh: math1('sinh', Math.sinh),
  cosh: math1('cosh', Math.cosh),
  tanh: math1('tanh', Math.tanh),
  asinh: math1('asinh', Math.asinh),
  acosh: math1('acosh', Math.acosh),
  atanh: math1('atanh', Math.atanh),
  sqrt: math1('sqrt', Math.sqrt),
  exp: math1('exp', Math.exp),
  log10: math1('log10', Math.log10),
  log2: math1('log2', Math.log2),
  fabs: math1('fabs', Math.abs),
  radians: math1('radians', (x) => (x * Math.PI) / 180),
  degrees: math1('degrees', (x) => (x * 180) / Math.PI),
  log: fn('log', (a) => {
    arity('log', a, 1, 2)
    const x = toNumber(a[0])
    if (x <= 0) throw new ExprError('math domain error')
    return flt(a.length === 2 ? Math.log(x) / Math.log(toNumber(a[1])) : Math.log(x))
  }),
  atan2: fn('atan2', (a) => (arity('atan2', a, 2), flt(Math.atan2(toNumber(a[0]), toNumber(a[1]))))),
  pow: fn('pow', (a) => (arity('pow', a, 2), flt(Math.pow(toNumber(a[0]), toNumber(a[1]))))),
  hypot: fn('hypot', (a) => flt(Math.hypot(...a.map(toNumber)))),
  copysign: fn('copysign', (a) => {
    arity('copysign', a, 2)
    const y = toNumber(a[1])
    return flt(Math.abs(toNumber(a[0])) * (y < 0 || Object.is(y, -0) ? -1 : 1))
  }),
  fmod: fn('fmod', (a) => (arity('fmod', a, 2), flt(toNumber(a[0]) % toNumber(a[1])))),
  floor: fn('floor', (a) => (arity('floor', a, 1), toInt(Math.floor(toNumber(a[0]))))),
  ceil: fn('ceil', (a) => (arity('ceil', a, 1), toInt(Math.ceil(toNumber(a[0]))))),
  trunc: fn('trunc', (a) => (arity('trunc', a, 1), toInt(Math.trunc(toNumber(a[0]))))),
  isclose: fn('isclose', (a) => {
    const x = toNumber(a[0])
    const y = toNumber(a[1])
    return Math.abs(x - y) <= Math.max(1e-9 * Math.max(Math.abs(x), Math.abs(y)), 0)
  })
}

const BUILTINS: Record<string, Value> = {
  True: true,
  False: false,
  None: null,
  abs: fn('abs', (a) => {
    arity('abs', a, 1)
    const v = a[0]
    return isFloat(v) ? flt(Math.abs(v.v)) : int(Math.abs(toNumber(v)))
  }),
  min: minMax('min', (a, b) => compare('<', a, b)),
  max: minMax('max', (a, b) => compare('>', a, b)),
  round: fn('round', (a) => {
    arity('round', a, 1, 2)
    const x = toNumber(a[0])
    if (a.length === 1 || a[1] === null) return toInt(roundHalfEven(x))
    const nd = toNumber(a[1])
    const f = Math.pow(10, nd)
    const r = roundHalfEven(x * f) / f
    return isInt(a[0]) ? int(r) : flt(r)
  }),
  int: fn('int', (a) => {
    arity('int', a, 0, 2)
    if (!a.length) return 0
    const v = a[0]
    if (typeof v === 'string') {
      const base = a.length > 1 ? toNumber(a[1]) : 10
      const s = v.trim().replace(/_/g, '')
      const ok = base === 10 ? /^[+-]?\d+$/.test(s) : /^[+-]?[0-9a-z]+$/i.test(s)
      const n = parseInt(s, base)
      if (!ok || Number.isNaN(n)) throw new ExprError(`invalid literal for int() with base ${base}: '${v}'`)
      return int(n)
    }
    return toInt(toNumber(v))
  }),
  float: fn('float', (a) => {
    arity('float', a, 0, 1)
    if (!a.length) return flt(0)
    const v = a[0]
    if (typeof v === 'string') {
      const x = parsePyFloat(v)
      if (x == null) throw new ExprError(`could not convert string to float: '${v}'`)
      return flt(x)
    }
    return flt(toNumber(v))
  }),
  str: fn('str', (a) => (arity('str', a, 0, 1), a.length ? pyStr(a[0]) : '')),
  bool: fn('bool', (a) => (arity('bool', a, 0, 1), a.length ? truthy(a[0]) : false)),
  len: fn('len', (a) => (arity('len', a, 1), iterate(a[0]).length)),
  range: fn('range', (a) => {
    arity('range', a, 1, 3)
    const [start, stop, step] = a.length === 1 ? [0, toNumber(a[0]), 1] : [toNumber(a[0]), toNumber(a[1]), a.length > 2 ? toNumber(a[2]) : 1]
    if (step === 0) throw new ExprError('range() arg 3 must not be zero')
    const out: Value[] = []
    for (let x = start; step > 0 ? x < stop : x > stop; x += step) {
      out.push(x)
      if (out.length > 100_000) throw new ExprError('range() too long')
    }
    return out
  }),
  sum: fn('sum', (a) => iterate(a[0]).reduce<Value>((s, x) => binary('+', s, x), a.length > 1 ? a[1] : 0)),
  sorted: fn('sorted', (a) => [...iterate(a[0])].sort((x, y) => (compare('<', x, y) ? -1 : compare('>', x, y) ? 1 : 0))),
  list: fn('list', (a) => (a.length ? [...iterate(a[0])] : [])),
  tuple: fn('tuple', (a) => (a.length ? [...iterate(a[0])] : [])),
  any: fn('any', (a) => iterate(a[0]).some(truthy)),
  all: fn('all', (a) => iterate(a[0]).every(truthy))
}

/** The builtins xacro exposes without the `python.` prefix. */
const DIRECT_BUILTINS = ['True', 'False', 'None', 'list', 'len', 'str', 'float', 'int', 'bool', 'min', 'max', 'round', 'sorted', 'range']

const nsOf = (name: string, table: Record<string, Value>): PyNamespace => ({ kind: 'ns', name, get: (k) => table[k] })

/** The global names of an expression, below the document's properties. `arg` reads xacro args. */
export function globalNames(arg: (name: string) => string | undefined): Record<string, Value> {
  const xacroNs: Record<string, Value> = {
    arg: fn('arg', (a) => {
      const name = pyStr(a[0])
      const v = arg(name)
      if (v === undefined) throw new ExprError(`undefined substitution argument ${name}`)
      return v
    })
  }
  // As xacro: a few builtins directly, all of them under `python.`, the math module directly and
  // under `math.`.
  const direct = Object.fromEntries(DIRECT_BUILTINS.map((k) => [k, BUILTINS[k]]))
  return { ...MATH, ...direct, math: nsOf('math', MATH), python: nsOf('python', BUILTINS), xacro: nsOf('xacro', xacroNs) }
}

/** float() of a string the way Python reads it, or null. */
export function parsePyFloat(s: string): number | null {
  const t = s.trim().toLowerCase()
  if (/^[+-]?(inf|infinity)$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity
  if (/^[+-]?nan$/.test(t)) return NaN
  if (!/^[+-]?(\d+(_\d+)*\.?(\d+(_\d+)*)?|\.\d+(_\d+)*)(e[+-]?\d+(_\d+)*)?$/.test(t)) return null
  return Number(t.replace(/_/g, ''))
}

// ---------------------------------------------------------------------------------------------
// Tokens and parser

type Tok = { t: 'num'; v: Value } | { t: 'str'; v: string } | { t: 'name'; v: string } | { t: 'op'; v: string } | { t: 'end' }

const OPS = ['**', '//', '==', '!=', '<=', '>=', '<<', '>>', '+', '-', '*', '/', '%', '<', '>', '(', ')', '[', ']', ',', '.', '&', '|', '^', '~', ':']
const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'if', 'else', 'lambda', 'for', 'True', 'False', 'None'])

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    // numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const hex = /^0[xX][0-9a-fA-F_]+/.exec(src.slice(i))
      if (hex) {
        out.push({ t: 'num', v: int(parseInt(hex[0].slice(2).replace(/_/g, ''), 16)) })
        i += hex[0].length
        continue
      }
      const m = /^(\d[\d_]*)?(\.[\d_]*)?([eE][+-]?\d+)?/.exec(src.slice(i))!
      const text = m[0]
      if (!text) throw new ExprError(`invalid syntax at '${src.slice(i)}'`)
      i += text.length
      const clean = text.replace(/_/g, '')
      out.push({ t: 'num', v: m[2] || m[3] ? flt(Number(clean)) : int(Number(clean)) })
      if (/[A-Za-z_]/.test(src[i] ?? '')) throw new ExprError(`invalid syntax at '${text}${src[i]}'`)
      continue
    }
    // strings (with optional r prefix)
    const raw = (c === 'r' || c === 'R') && (src[i + 1] === '"' || src[i + 1] === "'")
    if (c === '"' || c === "'" || raw) {
      if (raw) i++
      const q = src[i]
      const triple = src.startsWith(q.repeat(3), i)
      const close = triple ? q.repeat(3) : q
      i += close.length
      let s = ''
      for (;;) {
        if (i >= n) throw new ExprError('unterminated string')
        if (src.startsWith(close, i)) {
          i += close.length
          break
        }
        const d = src[i]
        if (d === '\\' && !raw) {
          const e = src[i + 1]
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' }
          s += map[e] ?? '\\' + e
          i += 2
          continue
        }
        s += d
        i++
      }
      out.push({ t: 'str', v: s })
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ t: 'name', v: m[0] })
      i += m[0].length
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new ExprError(`invalid character '${c}'`)
    out.push({ t: 'op', v: op })
    i += op.length
  }
  out.push({ t: 'end' })
  return out
}

type Node =
  | { k: 'lit'; v: Value }
  | { k: 'name'; v: string }
  | { k: 'list'; items: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'cmp'; ops: string[]; items: Node[] }
  | { k: 'and' | 'or'; a: Node; b: Node }
  | { k: 'not'; a: Node }
  | { k: 'if'; c: Node; a: Node; b: Node }
  | { k: 'call'; f: Node; args: Node[] }
  | { k: 'attr'; a: Node; name: string }
  | { k: 'index'; a: Node; i: Node | null; j?: Node | null; slice: boolean }

function parse(src: string): Node {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (v: string) => {
    const t = toks[p]
    return t.t === 'op' && t.v === v
  }
  const isKw = (v: string) => {
    const t = toks[p]
    return t.t === 'name' && t.v === v
  }
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected '${v}'`)
    p++
  }

  const test = (): Node => {
    const a = orTest()
    if (isKw('if')) {
      p++
      const c = orTest()
      if (!isKw('else')) throw new ExprError("expected 'else'")
      p++
      const b = test()
      return { k: 'if', c, a, b }
    }
    return a
  }
  const orTest = (): Node => {
    let a = andTest()
    while (isKw('or')) {
      p++
      a = { k: 'or', a, b: andTest() }
    }
    return a
  }
  const andTest = (): Node => {
    let a = notTest()
    while (isKw('and')) {
      p++
      a = { k: 'and', a, b: notTest() }
    }
    return a
  }
  const notTest = (): Node => {
    if (isKw('not')) {
      p++
      return { k: 'not', a: notTest() }
    }
    return comparison()
  }
  const compOp = (): string | null => {
    const t = peek()
    if (t.t === 'op' && ['<', '>', '==', '>=', '<=', '!='].includes(t.v)) {
      p++
      return t.v
    }
    if (isKw('in')) {
      p++
      return 'in'
    }
    if (isKw('not') && toks[p + 1].t === 'name' && (toks[p + 1] as { v: string }).v === 'in') {
      p += 2
      return 'not in'
    }
    if (isKw('is')) {
      p++
      if (isKw('not')) {
        p++
        return 'is not'
      }
      return 'is'
    }
    return null
  }
  const comparison = (): Node => {
    const first = bitOr()
    const ops: string[] = []
    const items = [first]
    for (let op = compOp(); op; op = compOp()) {
      ops.push(op)
      items.push(bitOr())
    }
    return ops.length ? { k: 'cmp', ops, items } : first
  }
  const leftAssoc = (next: () => Node, ops: string[]) => (): Node => {
    let a = next()
    for (;;) {
      const t = peek()
      if (t.t === 'op' && ops.includes(t.v)) {
        p++
        a = { k: 'bin', op: t.v, a, b: next() }
      } else return a
    }
  }
  const factor = (): Node => {
    const t = peek()
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '~')) {
      p++
      return { k: 'un', op: t.v, a: factor() }
    }
    return power()
  }
  const term = leftAssoc(factor, ['*', '/', '//', '%'])
  const arith = leftAssoc(term, ['+', '-'])
  const bitAnd = leftAssoc(arith, ['&'])
  const bitXor = leftAssoc(bitAnd, ['^'])
  const bitOr = leftAssoc(bitXor, ['|'])
  const power = (): Node => {
    const a = trailers(atom())
    if (isOp('**')) {
      p++
      return { k: 'bin', op: '**', a, b: factor() }
    }
    return a
  }
  const trailers = (a: Node): Node => {
    for (;;) {
      if (isOp('(')) {
        p++
        const args: Node[] = []
        while (!isOp(')')) {
          args.push(test())
          if (!isOp(',')) break
          p++
        }
        expectOp(')')
        a = { k: 'call', f: a, args }
      } else if (isOp('.')) {
        p++
        const t = peek()
        if (t.t !== 'name') throw new ExprError('expected a name after "."')
        p++
        a = { k: 'attr', a, name: t.v }
      } else if (isOp('[')) {
        p++
        const i: Node | null = isOp(':') ? null : test()
        if (isOp(':')) {
          p++
          const j = isOp(']') ? null : test()
          expectOp(']')
          a = { k: 'index', a, i, j, slice: true }
        } else {
          expectOp(']')
          a = { k: 'index', a, i, slice: false }
        }
      } else return a
    }
  }
  const atom = (): Node => {
    const t = peek()
    if (t.t === 'num') {
      p++
      return { k: 'lit', v: t.v }
    }
    if (t.t === 'str') {
      p++
      let s = t.v
      // adjacent string literals concatenate
      while (peek().t === 'str') s += (toks[p++] as { v: string }).v
      return { k: 'lit', v: s }
    }
    if (t.t === 'name') {
      if (KEYWORDS.has(t.v) && !['True', 'False', 'None'].includes(t.v)) throw new ExprError(`invalid syntax at '${t.v}'`)
      p++
      return { k: 'name', v: t.v }
    }
    if (isOp('(')) {
      p++
      if (isOp(')')) {
        p++
        return { k: 'list', items: [] }
      }
      const first = test()
      if (isOp(',')) {
        const items = [first]
        while (isOp(',')) {
          p++
          if (isOp(')')) break
          items.push(test())
        }
        expectOp(')')
        return { k: 'list', items }
      }
      expectOp(')')
      return first
    }
    if (isOp('[')) {
      p++
      const items: Node[] = []
      while (!isOp(']')) {
        items.push(test())
        if (!isOp(',')) break
        p++
      }
      expectOp(']')
      return { k: 'list', items }
    }
    if (t.t === 'end') throw new ExprError('unexpected end of expression')
    throw new ExprError(`invalid syntax at '${(t as { v: string }).v}'`)
  }

  const node = test()
  if (peek().t !== 'end') throw new ExprError(`invalid syntax at '${(peek() as { v: string }).v}'`)
  return node
}

// ---------------------------------------------------------------------------------------------
// Evaluation

/** Looks up a name: the document's properties first, then the globals; undefined when unknown. */
export type Lookup = (name: string) => Value | undefined

const cache = new Map<string, Node>()

export function evaluate(src: string, lookup: Lookup): Value {
  const text = src.trim()
  if (!text) throw new ExprError('empty expression')
  let tree = cache.get(text)
  if (!tree) {
    tree = parse(text)
    if (cache.size > 5000) cache.clear()
    cache.set(text, tree)
  }
  return run(tree, lookup)
}

function run(node: Node, lookup: Lookup): Value {
  switch (node.k) {
    case 'lit':
      return node.v
    case 'name': {
      if (node.v.startsWith('__')) throw new ExprError(`use of invalid name: ${node.v}`)
      const v = lookup(node.v)
      if (v === undefined) throw new ExprError(`name '${node.v}' is not defined`)
      return v
    }
    case 'list':
      return node.items.map((x) => run(x, lookup))
    case 'un': {
      const a = run(node.a, lookup)
      if (!isNumber(a)) throw new ExprError(`bad operand type for unary ${node.op}: ${typeName(a)}`)
      if (node.op === '+') return isFloat(a) ? a : toNumber(a)
      if (node.op === '~') {
        if (isFloat(a)) throw new ExprError('bad operand type for unary ~: float')
        return ~toNumber(a)
      }
      return isFloat(a) ? flt(-a.v) : int(-toNumber(a))
    }
    case 'bin':
      return binary(node.op, run(node.a, lookup), run(node.b, lookup))
    case 'cmp': {
      let left = run(node.items[0], lookup)
      for (let k = 0; k < node.ops.length; k++) {
        const right = run(node.items[k + 1], lookup)
        if (!compare(node.ops[k], left, right)) return false
        left = right
      }
      return true
    }
    case 'and': {
      const a = run(node.a, lookup)
      return truthy(a) ? run(node.b, lookup) : a
    }
    case 'or': {
      const a = run(node.a, lookup)
      return truthy(a) ? a : run(node.b, lookup)
    }
    case 'not':
      return !truthy(run(node.a, lookup))
    case 'if':
      return truthy(run(node.c, lookup)) ? run(node.a, lookup) : run(node.b, lookup)
    case 'call': {
      const f = run(node.f, lookup)
      if (f === null || typeof f !== 'object' || Array.isArray(f) || f instanceof PyFloat || f.kind !== 'func') {
        throw new ExprError(`'${typeName(f)}' object is not callable`)
      }
      return f.call(node.args.map((x) => run(x, lookup)))
    }
    case 'attr': {
      const a = run(node.a, lookup)
      if (a !== null && typeof a === 'object' && !Array.isArray(a) && !(a instanceof PyFloat) && a.kind === 'ns') {
        const v = a.get(node.name)
        if (v === undefined) throw new ExprError(`name '${node.name}' is not defined in ${a.name}`)
        return v
      }
      throw new ExprError(`'${typeName(a)}' object has no attribute '${node.name}'`)
    }
    case 'index': {
      const a = run(node.a, lookup)
      if (typeof a !== 'string' && !Array.isArray(a)) throw new ExprError(`'${typeName(a)}' object is not subscriptable`)
      const len = a.length
      const norm = (x: Node | null | undefined, dflt: number) => {
        if (!x) return dflt
        const v = toNumber(run(x, lookup))
        return v < 0 ? Math.max(0, len + v) : Math.min(len, v)
      }
      if (node.slice) {
        const s = norm(node.i, 0)
        const e = norm(node.j, len)
        return a.slice(s, Math.max(s, e))
      }
      let k = toNumber(run(node.i!, lookup))
      if (k < 0) k += len
      if (k < 0 || k >= len) throw new ExprError('index out of range')
      return a[k]
    }
  }
}
