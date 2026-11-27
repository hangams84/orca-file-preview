/** A xacro processor following ROS 2 xacro's in-order semantics (xacro 2.x): properties (lazy,
 *  literal typing, `default`, `remove`, `scope`, block properties), args with defaults, macros with
 *  defaults (`:=`, `^`, `^|`), `*block`/`**block` parameters and `xacro:insert_block`, recursive and
 *  dynamic calls (`xacro:call`), `xacro:if`/`xacro:unless`, `xacro:element`/`xacro:attribute`, and
 *  `$(arg)`, `$(find)`, `$(optenv)`, `$(env)`, `$(eval)` substitutions. Expressions go through the
 *  safe evaluator in expr.ts.
 *
 *  The preview only receives the opened file. `xacro:include` is read through `opts.include` (files
 *  the user handed to the preview, core/companions.ts); an include it cannot supply is recorded and
 *  skipped, and calls to macros that were probably defined there become notes instead of errors. Where xacro itself would stop at an error, this processor records a note and carries
 *  on, so a preview still shows the rest of the robot. */
import { evaluate, ExprError, globalNames, parsePyFloat, pyStr, PyFloat, truthy, type Value } from './expr.ts'
import { attr, cloneNode, elements, parseXml, removeAttr, setAttr, XmlError, type XElement, type XNode } from './xml.ts'

export interface Note {
  level: 'error' | 'warning' | 'info'
  message: string
  line?: number
}

export interface XacroResult {
  root: XElement
  notes: Note[]
  /** `xacro:include` file names (evaluated) that could not be read. */
  includes: { filename: string; line: number; optional: boolean }[]
  /** Includes that were read and expanded in place (`path`: the file that supplied them). */
  included: { filename: string; path: string; line: number }[]
  /** Macro names called but never defined in this file. */
  unresolvedMacros: string[]
  /** Args after defaults. */
  args: Record<string, string>
  /** Macros defined in this file (name and parameter list as written). */
  macros: { name: string; params: string; line: number }[]
}

/** A refusal that stops processing (runaway recursion or output). */
export class XacroFatal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly line?: number
  ) {
    super(message)
    this.name = 'XacroFatal'
  }
}

export interface XacroOptions {
  /** Values for `xacro:arg` that override defaults (as `name:=value` on xacro's command line). */
  args?: Record<string, string>
  /** Nesting limit for macro calls (xacro has none; a runaway recursion would never end here). */
  maxDepth?: number
  /** Limit on elements produced (expansion bombs). */
  maxElements?: number
  /** Supplies the text of an included file: `filename` as evaluated (`package://pkg/…` for
   *  `$(find pkg)/…`, relative or absolute paths), `from` the path of the including file (undefined
   *  for the opened file). Returns null when the file is not available. */
  include?: (filename: string, from: string | undefined) => { text: string; path: string } | null
}

/** Nesting limit for includes (a file that includes itself through others). */
const MAX_INCLUDE_DEPTH = 32

const XACRO_NS = /^https?:\/\/(www\.)?ros\.org\/wiki\/xacro\/?$/

/** True when a document uses xacro (namespace declared or xacro: elements). */
export function usesXacro(root: XElement): boolean {
  if (root.attrs.some(([k, v]) => k.startsWith('xmlns:') && XACRO_NS.test(v))) return true
  const walk = (el: XElement): boolean => el.name.startsWith('xacro:') || elements(el).some(walk)
  return walk(root)
}

// ---------------------------------------------------------------------------------------------
// Symbol tables (xacro's Table: chained scopes with lazily evaluated properties)

interface Block {
  block: XElement
}
type Stored = Value | Block | RawText
/** An unevaluated property value (evaluated at first use). */
class RawText {
  constructor(readonly text: string) {}
}
const isBlock = (v: Stored | undefined): v is Block => v != null && typeof v === 'object' && 'block' in (v as object)

class Table {
  private readonly vals = new Map<string, Stored>()
  private readonly resolving: string[] = []
  constructor(
    readonly parent: Table | null,
    private readonly proc: Processor | null
  ) {}

  hasOwn(key: string): boolean {
    return this.vals.has(key)
  }
  has(key: string): boolean {
    return this.vals.has(key) || (this.parent?.has(key) ?? false)
  }
  /** The value, evaluating a lazy property on first use; undefined when not defined. */
  get(key: string): Value | Block | undefined {
    if (this.vals.has(key)) {
      const v = this.vals.get(key)!
      if (v instanceof RawText) {
        if (this.resolving.includes(key)) {
          throw new ExprError(`circular variable definition: ${[...this.resolving, key].join(' -> ')}`)
        }
        this.resolving.push(key)
        try {
          const out = evalLiteral(this.proc!.evalText(v.text, this))
          this.vals.set(key, out)
          return out
        } finally {
          this.resolving.pop()
        }
      }
      return v
    }
    return this.parent?.get(key)
  }
  set(key: string, value: Value | Block, lazy: boolean): void {
    const v = isBlock(value) ? value : evalLiteral(value)
    this.vals.set(key, lazy && typeof v === 'string' ? new RawText(v) : v)
  }
  /** Removes the name from this table and every parent below the globals. */
  delete(key: string): void {
    for (let t: Table | null = this; t && t.parent; t = t.parent) t.vals.delete(key)
  }
  /** The outermost table below the globals (the document's scope). */
  top(): Table {
    let t: Table = this
    while (t.parent && t.parent.parent) t = t.parent
    return t
  }
}

/** xacro's literal typing of property values: quoted strings, ints, floats, booleans. */
export function evalLiteral(value: Value): Value {
  if (typeof value !== 'string') return value
  if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") return value.slice(1, -1)
  if (value.includes('_')) return value
  const t = value.trim()
  if (/^[+-]?\d+$/.test(t)) {
    const n = Number(t)
    return Number.isSafeInteger(n) ? n : new PyFloat(n)
  }
  const f = parsePyFloat(value)
  if (f != null) return new PyFloat(f)
  if (value === 'true' || value === 'True') return true
  if (value === 'false' || value === 'False') return false
  return value
}

/** xacro's get_boolean_value. */
function booleanValue(v: Value, cond: string): boolean {
  if (typeof v === 'string') {
    if (v === 'true' || v === 'True') return true
    if (v === 'false' || v === 'False') return false
    if (/^\s*[+-]?\d+\s*$/.test(v)) return Number(v) !== 0
    throw new ExprError(`xacro conditional "${cond}" evaluated to "${v}", which is not a boolean expression`)
  }
  return truthy(v)
}

interface Macro {
  name: string
  body: XElement
  params: string[]
  defaults: Map<string, { forward: string | null; dflt: string | null }>
}

class MacroTable {
  private readonly vals = new Map<string, Macro>()
  constructor(readonly parent: MacroTable | null) {}
  get(name: string): Macro | undefined {
    return this.vals.get(name) ?? this.parent?.get(name)
  }
  set(name: string, m: Macro): void {
    this.vals.set(name, m)
  }
}

// ---------------------------------------------------------------------------------------------
// Macro parameter lists

const DEFAULT_VALUE = String.raw`\$\{.*?\}|\$\(.*?\)|(?:'.*?'|".*?"|[^\s'"]+)+|`
const RE_MACRO_ARG = new RegExp(String.raw`^\s*([^\s:=]+?)\s*:?=\s*(\^\|?)?(` + DEFAULT_VALUE + String.raw`)(?:\s+|$)(.*)`)

/** Parses `a b:=1 c:=^|2 *blk **more` into names and defaults (xacro's parse_macro_arg). */
export function parseParams(spec: string): { params: string[]; defaults: Macro['defaults'] } {
  const params: string[] = []
  const defaults: Macro['defaults'] = new Map()
  let rest = spec
  let guard = 0
  while (rest.trim() && guard++ < 10_000) {
    const m = RE_MACRO_ARG.exec(rest)
    if (m) {
      const [, param, forward, dflt, tail] = m
      params.push(param)
      defaults.set(param, { forward: forward ? param : null, dflt: dflt ? dflt : null })
      rest = tail
    } else {
      const parts = rest.trimStart().split(/\s+/)
      params.push(parts[0])
      rest = parts.slice(1).join(' ')
    }
  }
  return { params, defaults }
}

// ---------------------------------------------------------------------------------------------
// Processor

const LEX = {
  dollarDollar: /^\$\$+(\{|\()/,
  expr: /^\$\{[^}]*\}/,
  ext: /^\$\([^)]*\)/,
  text: /^(?:[^$]+|\$[^{($]+|\$$)/
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const PY_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' ')
)

class Processor {
  notes: Note[] = []
  includes: XacroResult['includes'] = []
  included: XacroResult['included'] = []
  /** Paths of the files being expanded (the opened file is ''). */
  private readonly fileStack: string[] = ['']
  private readonly include: XacroOptions['include']
  unresolved = new Set<string>()
  defined = new Map<string, { name: string; params: string; line: number }>()
  args: Record<string, string>
  private readonly noteKeys = new Set<string>()
  private depth = 0
  private produced = 0
  private readonly maxDepth: number
  private readonly maxElements: number
  readonly globals: Table
  /** Line of the element being processed, for notes. */
  line = 0

  constructor(opts: XacroOptions) {
    this.args = { ...(opts.args ?? {}) }
    this.maxDepth = opts.maxDepth ?? 100
    this.maxElements = opts.maxElements ?? 200_000
    this.include = opts.include
    this.globals = new Table(null, this)
    const names = globalNames((n) => this.args[n])
    for (const [k, v] of Object.entries(names)) this.globals.set(k, v, false)
  }

  note(level: Note['level'], message: string, line = this.line): void {
    const key = `${level}|${message}`
    if (this.noteKeys.has(key) || this.notes.length >= 300) return
    this.noteKeys.add(key)
    this.notes.push({ level, message, line: line || undefined })
  }

  // eval_text: substitutes ${…} and $(…) and returns a typed value when the text is one item.
  evalText(text: string, symbols: Table): Value {
    const results: Value[] = []
    let s = text
    while (s) {
      let m: RegExpExecArray | null
      if ((m = LEX.dollarDollar.exec(s))) {
        results.push(m[0].slice(1))
      } else if ((m = LEX.expr.exec(s))) {
        results.push(this.handleExpr(m[0].slice(2, -1), symbols))
      } else if ((m = LEX.ext.exec(s))) {
        results.push(this.handleExtension(pyStr(this.evalText(m[0].slice(2, -1), symbols))))
      } else if ((m = LEX.text.exec(s))) {
        results.push(m[0])
      } else {
        throw new ExprError(`invalid expression: ${s}`)
      }
      s = s.slice(m[0].length)
    }
    if (results.length === 1) return results[0]
    return results.map(pyStr).join('')
  }

  private handleExpr(src: string, symbols: Table): Value {
    const inner = pyStr(this.evalText(src, symbols))
    try {
      return evaluate(inner, (name) => {
        const v = symbols.get(name)
        if (v === undefined || isBlock(v)) return undefined
        return v
      })
    } catch (e) {
      if (e instanceof ExprError) throw new ExprError(`${e.message} when evaluating expression '${src}'`)
      throw e
    }
  }

  private handleExtension(s: string): string {
    const m = /^\s*(\S+)\s*(.*?)\s*$/.exec(s)
    if (!m) throw new ExprError(`invalid substitution $(${s})`)
    const [, cmd, rest] = m
    switch (cmd) {
      case 'arg': {
        const v = this.args[rest]
        if (v === undefined) throw new ExprError(`undefined substitution argument ${rest}`)
        return v
      }
      case 'find':
        // No ROS package index here: keep the package as a package:// URL, which is how the
        // resulting paths are shown (and how mesh references look in URDF anyway).
        return `package://${rest}`
      case 'optenv': {
        const [, ...dflt] = rest.split(/\s+/)
        return dflt.join(' ')
      }
      case 'env':
        this.note('warning', `$(env ${rest}): environment variables are not available in the preview; used an empty value`)
        return ''
      case 'dirname': {
        // The directory of the file being expanded, as far as it is known (a companion path).
        const cur = this.fileStack[this.fileStack.length - 1]
        const cut = cur.lastIndexOf('/')
        return cut > 0 ? cur.slice(0, cut) : '.'
      }
      case 'cwd':
        return '.'
      case 'anon':
        return `${rest}_anon`
      case 'eval': {
        if (rest.includes('__')) throw new ExprError('$(eval ...) may not contain double underscore expressions')
        const globals = globalNames((n) => this.args[n])
        const v = evaluate(rest, (name) => (name in this.args ? evalLiteral(this.args[name]) : name === 'arg' ? (globals.xacro as { get(k: string): Value }).get('arg') : globals[name]))
        return pyStr(v)
      }
    }
    throw new ExprError(`unknown substitution $(${s})`)
  }

  /** Evaluates text for an attribute or text node; on error records a note and keeps the text. */
  private safeText(text: string, symbols: Table, where: string): string {
    if (!text.includes('$')) return text
    try {
      return pyStr(this.evalText(text, symbols))
    } catch (e) {
      if (!(e instanceof ExprError)) throw e
      // With includes missing, an unknown name most likely comes from one of them.
      if (this.includes.length && /is not defined/.test(e.message)) this.note('warning', `${where}: ${e.message} (probably defined in an included file that could not be read)`)
      else this.note('error', `${where}: ${e.message}`)
      return text
    }
  }

  private countElement(): void {
    if (++this.produced > this.maxElements) {
      throw new XacroFatal('xacro-too-large', `the expanded description has more than ${this.maxElements.toLocaleString('en')} elements`, this.line)
    }
  }

  /** xacro's eval_all: evaluates attributes, then walks the children in order. */
  evalAll(node: XElement, macros: MacroTable, symbols: Table): void {
    this.countElement()
    for (let k = node.attrs.length - 1; k >= 0; k--) {
      const [name, value] = node.attrs[k]
      if (name.startsWith('xacro:')) node.attrs.splice(k, 1)
    }
    for (const a of node.attrs) a[1] = this.safeText(a[1], symbols, `<${node.name} ${a[0]}="${a[1]}">`)
    removeAttr(node, 'xmlns:xacro')

    const kids = node.children
    let i = 0
    while (i < kids.length) {
      const c = kids[i]
      if (c.type === 'text') {
        c.text = this.safeText(c.text, symbols, `text in <${node.name}>`)
        i++
        continue
      }
      if (c.type === 'comment') {
        i++
        continue
      }
      this.line = c.line
      const replaced = this.evalElement(c, node, macros, symbols)
      if (replaced === 'again') continue
      if (replaced === null) {
        i++
        continue
      }
      kids.splice(i, 1, ...replaced)
      i += replaced.length
    }
  }

  /** Handles one child element. Returns null when it stays, the nodes that replace it, or 'again'
   *  when it was renamed and must be looked at once more. */
  private evalElement(el: XElement, parent: XElement, macros: MacroTable, symbols: Table): XNode[] | null | 'again' {
    const tag = el.name
    if (!tag.startsWith('xacro:')) {
      this.evalAll(el, macros, symbols)
      return null
    }
    try {
      switch (tag) {
        case 'xacro:insert_block': {
          const name = attr(el, 'name') ?? ''
          const multi = symbols.get('**' + name)
          const single = multi === undefined ? symbols.get('*' + name) : undefined
          const found = multi ?? single
          if (!isBlock(found)) {
            this.note('error', `undefined block "${name}"`)
            return []
          }
          const block = cloneNode(found.block)
          this.evalAll(block, macros, symbols)
          return multi !== undefined ? block.children : [block]
        }
        case 'xacro:include': {
          const spec = attr(el, 'filename') ?? ''
          const filename = this.safeText(spec, symbols, 'xacro:include filename')
          const optional = /^(true|1)$/i.test(attr(el, 'optional') ?? '')
          const from = this.fileStack[this.fileStack.length - 1] || undefined
          const got = filename ? this.include?.(filename, from) : null
          if (!got) {
            this.includes.push({ filename, line: el.line, optional })
            return []
          }
          if (this.fileStack.includes(got.path) || this.fileStack.length > MAX_INCLUDE_DEPTH) {
            this.note('error', `xacro:include ${filename}: ${got.path} includes itself; skipped`)
            return []
          }
          let inc: XElement
          try {
            inc = parseXml(got.text)
          } catch (e) {
            if (!(e instanceof XmlError)) throw e
            this.note('error', `xacro:include ${got.path}: the XML is not well-formed: ${e.message}`)
            this.includes.push({ filename, line: el.line, optional })
            return []
          }
          if (attr(el, 'ns')) this.note('warning', `xacro:include ns="${attr(el, 'ns')}": namespaced includes are expanded without the namespace`)
          this.included.push({ filename, path: got.path, line: el.line })
          // xacro's process_include: the included document is evaluated in the current scope and its
          // root's children replace the include element.
          this.fileStack.push(got.path)
          const line = this.line
          try {
            this.evalAll(inc, macros, symbols)
          } finally {
            this.fileStack.pop()
            this.line = line
          }
          return inc.children
        }
        case 'xacro:property':
          this.grabProperty(el, symbols)
          return []
        case 'xacro:macro':
          this.grabMacro(el, macros)
          return []
        case 'xacro:arg': {
          const name = attr(el, 'name')
          if (!name) {
            this.note('error', 'xacro:arg without a name')
            return []
          }
          if (!(name in this.args)) this.args[name] = this.safeText(attr(el, 'default') ?? '', symbols, `xacro:arg ${name}`)
          return []
        }
        case 'xacro:element': {
          const raw = attr(el, 'xacro:name')
          const name = raw == null ? '' : pyStr(this.evalText(raw, symbols))
          if (!name) {
            this.note('error', 'xacro:element: empty name')
            return []
          }
          removeAttr(el, 'xacro:name')
          el.name = name
          return 'again'
        }
        case 'xacro:attribute': {
          const name = pyStr(this.evalText(attr(el, 'name') ?? '', symbols))
          if (!name) {
            this.note('error', 'xacro:attribute: empty name')
            return []
          }
          setAttr(parent, name, pyStr(this.evalText(attr(el, 'value') ?? '', symbols)))
          return []
        }
        case 'xacro:if':
        case 'xacro:unless': {
          const cond = attr(el, 'value') ?? ''
          let keep = booleanValue(this.evalText(cond, symbols), cond)
          if (tag === 'xacro:unless') keep = !keep
          if (!keep) return []
          this.evalAll(el, macros, symbols)
          return el.children
        }
        case 'xacro:call': {
          const name = pyStr(this.evalText(attr(el, 'macro') ?? '', symbols))
          if (!name) {
            this.note('error', "xacro:call is missing the 'macro' attribute")
            return []
          }
          removeAttr(el, 'macro')
          el.name = 'xacro:' + name
          return this.macroCall(el, macros, symbols)
        }
      }
      return this.macroCall(el, macros, symbols)
    } catch (e) {
      if (!(e instanceof ExprError)) throw e
      this.note('error', `<${tag}>: ${e.message}`, el.line)
      return []
    }
  }

  private grabProperty(el: XElement, table: Table): void {
    const name = pyStr(this.evalText(attr(el, 'name') ?? '', table))
    if (!IDENT.test(name) || PY_KEYWORDS.has(name)) {
      this.note('error', `property names must be valid Python identifiers: "${name}"`)
      return
    }
    const value = attr(el, 'value')
    const dflt = attr(el, 'default')
    const remove = booleanValue(this.evalText(attr(el, 'remove') ?? 'false', table), 'remove')
    if (remove) {
      if (table.has(name)) table.delete(name)
      return
    }
    let v: Value | Block | undefined = value
    if (dflt != null) {
      if (table.has(name)) return
      v = dflt
    }
    let key = name
    if (v === undefined) {
      key = '**' + name
      v = { block: el }
    }
    let lazy = booleanValue(this.evalText(attr(el, 'lazy_eval') ?? 'true', table), 'lazy_eval')
    const scope = attr(el, 'scope')
    let target = table
    if (scope === 'global') {
      target = table.top()
      lazy = false
    } else if (scope === 'parent') {
      if (table.parent && table.parent.parent) {
        target = table.parent
        lazy = false
      } else {
        this.note('warning', `${name}: no parent scope at global scope`)
        return
      }
    }
    if (!lazy && typeof v === 'string') v = this.evalText(v, table)
    target.set(key, v, lazy)
  }

  private grabMacro(el: XElement, macros: MacroTable): void {
    let name = attr(el, 'name') ?? ''
    if (!name || name === 'call' || name.includes('.')) {
      this.note('error', `invalid macro name "${name}"`)
      return
    }
    if (name.startsWith('xacro:')) name = name.slice(6)
    const spec = attr(el, 'params') ?? ''
    const { params, defaults } = parseParams(spec)
    macros.set(name, { name, body: el, params, defaults })
    if (!this.defined.has(name)) this.defined.set(name, { name, params: spec.trim().replace(/\s+/g, ' '), line: el.line })
  }

  private macroCall(node: XElement, macros: MacroTable, symbols: Table): XNode[] {
    const name = node.name.slice(6)
    const m = macros.get(name)
    if (!m) {
      this.unresolved.add(name)
      if (this.includes.length) this.note('warning', `unresolved macro xacro:${name} (probably defined in a file that is included and could not be read)`, node.line)
      else this.note('error', `unknown macro name: xacro:${name}`, node.line)
      return []
    }
    if (this.depth >= this.maxDepth) {
      throw new XacroFatal('xacro-recursion', `macro calls nest deeper than ${this.maxDepth} levels (xacro:${name} calls itself without end?)`, node.line)
    }
    const body = cloneNode(m.body)
    const scoped = new Table(symbols, this)
    const scopedMacros = new MacroTable(macros)
    const params = [...m.params]
    for (const [k, v] of node.attrs) {
      const at = params.indexOf(k)
      if (at < 0) {
        this.note('error', `xacro:${name}: invalid parameter "${k}"`, node.line)
        continue
      }
      params.splice(at, 1)
      scoped.set(k, this.evalText(v, symbols), false)
    }
    node.attrs = []
    // Block parameters are evaluated in the caller's scope, then bound in order.
    this.evalAll(node, macros, symbols)
    const blocks = elements(node)
    let b = 0
    for (const p of [...params]) {
      if (p[0] !== '*') continue
      if (b >= blocks.length) {
        this.note('error', `xacro:${name}: not enough blocks (missing ${p})`, node.line)
        return []
      }
      params.splice(params.indexOf(p), 1)
      scoped.set(p, { block: blocks[b++] }, true)
    }
    if (b < blocks.length) this.note('error', `xacro:${name}: unused block <${blocks[b].name}>`, node.line)
    for (const p of [...params]) {
      if (p[0] === '*') continue
      const d = m.defaults.get(p)
      if (!d) continue
      let v: Value | undefined
      if (d.forward != null) {
        const fwd = symbols.get(d.forward)
        if (fwd !== undefined && !isBlock(fwd)) v = fwd
        else if (d.dflt != null) v = this.evalText(d.dflt, symbols)
        else throw new ExprError(`undefined property to forward: ${d.forward}`)
      } else {
        v = this.evalText(d.dflt ?? '', symbols)
      }
      scoped.set(p, v, false)
      params.splice(params.indexOf(p), 1)
    }
    if (params.length) {
      this.note('error', `xacro:${name}: undefined parameters [${params.join(',')}]`, node.line)
      return []
    }
    this.depth++
    try {
      this.evalAll(body, scopedMacros, scoped)
    } finally {
      this.depth--
    }
    return body.children
  }
}

/** Expands a xacro document in place and returns the resulting URDF tree with notes. */
export function processXacro(root: XElement, opts: XacroOptions = {}): XacroResult {
  const proc = new Processor(opts)
  const doc = new Table(proc.globals, proc)
  const target = attr(root, 'xacro:targetNamespace')
  if (target) {
    removeAttr(root, 'xacro:targetNamespace')
    setAttr(root, 'xmlns', target)
  }
  proc.evalAll(root, new MacroTable(null), doc)
  return { root, notes: proc.notes, includes: proc.includes, included: proc.included, unresolvedMacros: [...proc.unresolved], args: proc.args, macros: [...proc.defined.values()] }
}
