/** TorchScript `code/` → operator graph (best effort, nothing is executed).
 *
 *  TorchScript archives store each module class as generated Python-like source
 *  (`code/__torch__/<module path>.py`). The root class's `forward` is read statement by statement;
 *  calls of user and container modules (`(self.fc1).forward(x)`, `getattr(self.h, "0")`) are inlined
 *  with their module path, built-in leaf modules (`torch.nn.*`: Linear, Conv2d, LayerNorm,
 *  MultiheadAttention …) become one node holding their weights, and `torch.*`/functional calls become
 *  operator nodes. Shape/bookkeeping calls (size, dim, device, annotate …) do not make nodes. Both
 *  branches of an `if` are read in order, loop bodies once: the graph is the data flow, not a trace. */
import type { Graph, GraphNode, GraphValue, ModelIR, ModuleNode, Value } from './ir.ts'

interface ClassDef {
  name: string
  attrs: Map<string, string>
  /** `name : Final[T] = value` constants (kernel_size, stride, in_features …). */
  consts: Map<string, string>
  methods: Map<string, { params: string[]; body: Line[] }>
}

interface Line {
  indent: number
  text: string
}

const MAX_NODES = 20000
const MAX_DEPTH = 40

/** Builds the graph; returns null when the root class's forward is not found. */
export function scriptGraph(code: Map<string, string>, rootClass: string, ir: ModelIR): Graph | null {
  const classes = parseClasses(code)
  const root = classes.get(rootClass)
  if (!root || !root.methods.has('forward')) return null
  const modules = new Map<string, ModuleNode>()
  if (ir.modules) {
    const visit = (n: ModuleNode) => {
      modules.set(n.path, n)
      n.children.forEach(visit)
    }
    visit(ir.modules)
  }
  const tensorShape = new Map(ir.tensors.map((t) => [t.name, t]))
  const b = new Builder(classes, modules, tensorShape)
  const fwd = root.methods.get('forward')!
  const inputs: V[] = fwd.params.slice(1).map((p) => b.input(p))
  const out = b.inline(rootClass, 'forward', '', inputs, 0)
  const outputs = b.flat(out).filter((v): v is { t: 'val'; id: string } => v.t === 'val').map((v) => v.id)
  return { name: cleanName(rootClass), nodes: b.nodes, values: [...b.values.values()], inputs: inputs.map((v) => (v as { id: string }).id), outputs }
}

function cleanName(c: string): string {
  return c.replace(/^__torch__\./, '').replace(/\.___torch_mangle_\d+/g, '')
}

/** `__torch__/torch/nn/modules/linear/___torch_mangle_0.py` → classes keyed by qualified name. */
export function parseClasses(code: Map<string, string>): Map<string, ClassDef> {
  const out = new Map<string, ClassDef>()
  for (const [file, src] of code) {
    const mod = file.replace(/\.py$/, '').split('/').join('.')
    const lines = src.split(/\r?\n/)
    let cls: ClassDef | null = null
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      if (!raw.trim()) continue
      const indent = raw.length - raw.trimStart().length
      const text = raw.trim()
      if (indent === 0) {
        const m = /^class\s+(\w+)/.exec(text)
        cls = m ? { name: m[1], attrs: new Map(), consts: new Map(), methods: new Map() } : null
        if (cls) out.set(`${mod}.${cls.name}`, cls)
        continue
      }
      if (!cls) continue
      if (indent === 2) {
        const a = /^(\w+)\s*:\s*([^=]+?)(\s*=.*)?$/.exec(text)
        if (a && !text.startsWith('def ')) {
          cls.attrs.set(a[1], a[2].trim())
          if (a[3]) cls.consts.set(a[1], a[3].replace(/^\s*=\s*/, '').trim())
          continue
        }
        const ann = /^__annotations__\["([^"]+)"\]\s*=\s*(\S+)/.exec(text)
        if (ann) {
          cls.attrs.set(ann[1], ann[2])
          continue
        }
        if (text.startsWith('def ')) {
          // Signature may span lines until the closing "):" / "-> T:".
          let sig = text
          while (!/\)\s*(->\s*.+)?:\s*$/.test(sig) && i + 1 < lines.length) sig += ' ' + lines[++i].trim()
          const m = /^def\s+(\w+)\s*\((.*)\)\s*(->.*)?:\s*$/.exec(sig)
          if (!m) continue
          const params = splitTop(m[2]).map((p) => p.split(':')[0].split('=')[0].trim()).filter(Boolean)
          const body: Line[] = []
          while (i + 1 < lines.length) {
            const nx = lines[i + 1]
            if (nx.trim() && nx.length - nx.trimStart().length <= 2) break
            i++
            if (nx.trim()) body.push({ indent: nx.length - nx.trimStart().length, text: nx.trim() })
          }
          cls.methods.set(m[1], { params, body })
        }
      }
    }
  }
  return out
}

/** Splits on top-level commas (outside brackets and strings). */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  let q = ''
  for (const ch of s) {
    if (q) {
      cur += ch
      if (ch === q) q = ''
      continue
    }
    if (ch === '"' || ch === "'") q = ch
    if ('([{'.includes(ch)) depth++
    if (')]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

// ---------------------------------------------------------------------------------------------
// expressions

type Tok = { k: 'name' | 'num' | 'str' | 'op'; v: string }

function tokenize(s: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < s.length && /\w/.test(s[j])) j++
      out.push({ k: 'name', v: s.slice(i, j) })
      i = j
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*(e[-+]?\d+)?|\.\d+(e[-+]?\d+)?)j?/i.exec(s.slice(i))!
      out.push({ k: 'num', v: m[0] })
      i += m[0].length
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1
      out.push({ k: 'str', v: s.slice(i + 1, j) })
      i = j + 1
      continue
    }
    const two = s.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '//', '**', '->'].includes(two)) {
      out.push({ k: 'op', v: two })
      i += 2
      continue
    }
    out.push({ k: 'op', v: c })
    i++
  }
  return out
}

type E =
  | { e: 'name'; v: string }
  | { e: 'lit'; v: Value }
  | { e: 'attr'; obj: E; name: string }
  | { e: 'call'; fn: E; args: E[]; kw: [string, E][] }
  | { e: 'sub'; obj: E; idx: E }
  | { e: 'tuple'; items: E[] }
  | { e: 'bin'; op: string; a: E; b: E }
  | { e: 'un'; op: string; a: E }
  | { e: 'if'; a: E; c: E; b: E }

class Parser {
  i = 0
  constructor(readonly t: Tok[]) {}
  peek(v?: string): Tok | undefined {
    const x = this.t[this.i]
    return v === undefined || x?.v === v ? x : undefined
  }
  eat(v: string): boolean {
    if (this.t[this.i]?.v === v) {
      this.i++
      return true
    }
    return false
  }
  expr(): E {
    const a = this.or()
    if (this.peek('if')) {
      this.i++
      const c = this.or()
      this.eat('else')
      return { e: 'if', a, c, b: this.expr() }
    }
    return a
  }
  or(): E {
    let a = this.and()
    while (this.peek('or')) {
      this.i++
      a = { e: 'bin', op: 'or', a, b: this.and() }
    }
    return a
  }
  and(): E {
    let a = this.not()
    while (this.peek('and')) {
      this.i++
      a = { e: 'bin', op: 'and', a, b: this.not() }
    }
    return a
  }
  not(): E {
    if (this.peek('not')) {
      this.i++
      return { e: 'un', op: 'not', a: this.not() }
    }
    return this.cmp()
  }
  cmp(): E {
    let a = this.add()
    for (;;) {
      const v = this.t[this.i]?.v
      if (v && ['==', '!=', '<', '>', '<=', '>=', 'is', 'in'].includes(v)) {
        this.i++
        if (v === 'is' && this.peek('not')) this.i++
        a = { e: 'bin', op: v, a, b: this.add() }
      } else return a
    }
  }
  add(): E {
    let a = this.mul()
    for (;;) {
      const v = this.t[this.i]?.v
      if (v === '+' || v === '-') {
        this.i++
        a = { e: 'bin', op: v, a, b: this.mul() }
      } else return a
    }
  }
  mul(): E {
    let a = this.unary()
    for (;;) {
      const v = this.t[this.i]?.v
      if (v === '*' || v === '/' || v === '//' || v === '%' || v === '@') {
        this.i++
        a = { e: 'bin', op: v, a, b: this.unary() }
      } else return a
    }
  }
  unary(): E {
    if (this.peek('-')) {
      this.i++
      const a = this.unary()
      if (a.e === 'lit' && typeof a.v === 'number') return { e: 'lit', v: -a.v }
      return { e: 'un', op: '-', a }
    }
    const a = this.postfix()
    if (this.peek('**')) {
      this.i++
      return { e: 'bin', op: '**', a, b: this.unary() }
    }
    return a
  }
  postfix(): E {
    let a = this.atom()
    for (;;) {
      if (this.eat('.')) {
        const n = this.t[this.i++]
        a = { e: 'attr', obj: a, name: n?.v ?? '' }
      } else if (this.eat('(')) {
        const args: E[] = []
        const kw: [string, E][] = []
        while (!this.eat(')')) {
          if (this.i >= this.t.length) throw new Error('unclosed call')
          if (this.t[this.i]?.k === 'name' && this.t[this.i + 1]?.v === '=' && this.t[this.i + 2]?.v !== '=') {
            const k = this.t[this.i].v
            this.i += 2
            kw.push([k, this.expr()])
          } else args.push(this.expr())
          this.eat(',')
        }
        a = { e: 'call', fn: a, args, kw }
      } else if (this.eat('[')) {
        const items: E[] = []
        while (!this.eat(']')) {
          if (this.i >= this.t.length) throw new Error('unclosed subscript')
          items.push(this.expr())
          if (!this.eat(',')) this.eat(':')
        }
        a = { e: 'sub', obj: a, idx: items.length === 1 ? items[0] : { e: 'tuple', items } }
      } else return a
    }
  }
  atom(): E {
    const t = this.t[this.i++]
    if (!t) throw new Error('unexpected end')
    if (t.k === 'num') return { e: 'lit', v: /^\d+$/.test(t.v) ? parseInt(t.v, 10) : parseFloat(t.v) }
    if (t.k === 'str') return { e: 'lit', v: t.v }
    if (t.k === 'name') {
      if (t.v === 'None') return { e: 'lit', v: null }
      if (t.v === 'True') return { e: 'lit', v: true }
      if (t.v === 'False') return { e: 'lit', v: false }
      return { e: 'name', v: t.v }
    }
    if (t.v === '(' || t.v === '[') {
      const close = t.v === '(' ? ')' : ']'
      const items: E[] = []
      let comma = t.v === '['
      while (!this.eat(close)) {
        if (this.i >= this.t.length) throw new Error('unclosed')
        items.push(this.expr())
        if (this.eat(',')) comma = true
      }
      return items.length === 1 && !comma ? items[0] : { e: 'tuple', items }
    }
    throw new Error(`unexpected ${t.v}`)
  }
}

// ---------------------------------------------------------------------------------------------
// evaluation into a graph

type V =
  | { t: 'val'; id: string }
  | { t: 'mod'; path: string; cls: string }
  | { t: 'func'; name: string }
  | { t: 'lit'; v: Value }
  | { t: 'tuple'; items: V[] }

/** Calls that only read shapes/metadata or pass a value through: no node. */
const PASS = new Set(['annotate', 'unchecked_cast', 'NumToTensor', 'unchecked_unwrap_optional', '_unwrap_optional', 'data', 'contiguous', 'detach'])
const META = new Set(['size', 'dim', 'len', 'device', 'dtype', 'numel', '__is__', '__isnot__', 'isinstance', 'format', 'warn', 'RaiseException', 'list', 'tuple', 'int', 'float', 'str', 'bool', 'range', 'uninitialized', 'is_scripting', 'is_grad_enabled', '__contains__', 'append', 'item', '_assert', 'ne', 'eq', 'lt', 'gt', 'le', 'ge', '__not__', 'floordiv', 'is_floating_point', 'is_nested', '_get_tracing_state', 'has_torch_function', 'type', 'layout'])
const BIN: Record<string, string> = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '//': 'floordiv', '%': 'remainder', '@': 'matmul', '**': 'pow' }

class Builder {
  nodes: GraphNode[] = []
  values = new Map<string, GraphValue>()
  private n = 0
  /** Module path whose method is being inlined (owner of plain operator nodes). */
  private cur = ''
  private weightValues = new Map<string, string>()
  constructor(
    readonly classes: Map<string, ClassDef>,
    readonly modules: Map<string, ModuleNode>,
    readonly tensors: Map<string, { shape: number[]; dtype: string }>
  ) {}

  input(name: string): V {
    const id = `%${name}`
    this.values.set(id, { id })
    return { t: 'val', id }
  }

  weight(name: string): V {
    let id = this.weightValues.get(name)
    if (!id) {
      id = name
      const t = this.tensors.get(name)
      this.values.set(id, { id, tensor: name, shape: t?.shape, dtype: t?.dtype })
      this.weightValues.set(name, id)
    }
    return { t: 'val', id }
  }

  flat(v: V): V[] {
    return v.t === 'tuple' ? v.items.flatMap((x) => this.flat(x)) : [v]
  }

  node(op: string, module: string, inputs: V[], attrs: Record<string, Value>, nOut = 1, domain?: string): V {
    if (this.nodes.length >= MAX_NODES) throw new Error(`more than ${MAX_NODES} operators`)
    const id = `n${this.n++}`
    const outs: string[] = []
    for (let i = 0; i < nOut; i++) {
      const vid = `${id}:${i}`
      this.values.set(vid, { id: vid })
      outs.push(vid)
    }
    const ins = inputs.flatMap((x) => this.flat(x)).filter((x): x is { t: 'val'; id: string } => x.t === 'val').map((x) => x.id)
    this.nodes.push({ id, op, name: module ? `${module}/${op}` : op, domain, attrs: Object.keys(attrs).length ? attrs : undefined, inputs: ins, outputs: outs, module: module || undefined })
    return nOut === 1 ? { t: 'val', id: outs[0] } : { t: 'tuple', items: outs.map((o) => ({ t: 'val', id: o }) as V) }
  }

  /** Inlines `cls.method` called on the module at `path` with `args`. */
  inline(cls: string, method: string, path: string, args: V[], depth: number): V {
    const def = this.classes.get(cls)
    const m = def?.methods.get(method)
    if (!def || !m || depth > MAX_DEPTH) return this.leaf(cls, path, args)
    const env = new Map<string, V>()
    const saved = this.cur
    this.cur = path
    env.set(m.params[0] ?? 'self', { t: 'mod', path, cls })
    m.params.slice(1).forEach((p, i) => env.set(p, args[i] ?? { t: 'lit', v: null }))
    let ret: V = { t: 'lit', v: null }
    for (const line of m.body) {
      const r = this.statement(line.text, env, depth)
      if (r) ret = r
    }
    this.cur = saved
    return ret
  }

  /** A built-in module call as one node with its weights and attributes. */
  leaf(cls: string, path: string, args: V[]): V {
    const mod = this.modules.get(path)
    const weights = (mod?.tensors ?? []).map((t) => this.weight(t))
    const attrs: Record<string, Value> = {}
    for (const [k, v] of Object.entries(mod?.attrs ?? {})) if (k !== 'training' && k !== '_version' && k !== '__parameters__' && k !== '__buffers__') attrs[k] = v
    for (const [k, v] of this.classes.get(cls)?.consts ?? []) if (!(k in attrs)) attrs[k] = constValue(v)
    const op = cleanName(cls).split('.').pop() ?? 'Module'
    return this.node(op, path, [...args, ...weights], attrs, 1, 'module')
  }

  statement(text: string, env: Map<string, V>, depth: number): V | null {
    if (/^(if|elif|while)\b/.test(text) || text === 'else:' || text === 'pass' || text.startsWith('for ')) {
      const m = /^for\s+(\w+)\s+in\s+(.+):$/.exec(text)
      if (m) env.set(m[1], { t: 'lit', v: 0 })
      return null
    }
    if (text.startsWith('return')) {
      const rest = text.slice(6).trim()
      return rest ? this.evalStr(rest, env, depth) : { t: 'lit', v: null }
    }
    // Assignment: targets = expr (also tuple unpacking "a, b, = expr"); the first top-level "=".
    const eq = findAssign(text)
    if (eq > 0) {
      const lhs = text.slice(0, eq).trim().replace(/:\s*[^=]+$/, '')
      const v = this.evalStr(text.slice(eq + 1).trim(), env, depth)
      const targets = lhs.split(',').map((s) => s.trim()).filter(Boolean)
      if (targets.length === 1) env.set(targets[0], v)
      else {
        const items = v.t === 'tuple' ? v.items : targets.map((_, i) => (v.t === 'val' ? this.node('getitem', this.cur, [v], { index: i }) : v))
        targets.forEach((t, i) => env.set(t, items[i] ?? { t: 'lit', v: null }))
      }
      return null
    }
    this.evalStr(text, env, depth)
    return null
  }

  evalStr(s: string, env: Map<string, V>, depth: number): V {
    try {
      const p = new Parser(tokenize(s))
      return this.eval(p.expr(), env, depth)
    } catch (e) {
      if ((e as Error).message.startsWith('more than')) throw e
      return { t: 'lit', v: null }
    }
  }

  dotted(e: E): string | null {
    if (e.e === 'name') return e.v
    if (e.e === 'attr') {
      const o = this.dotted(e.obj)
      return o ? `${o}.${e.name}` : null
    }
    return null
  }

  eval(e: E, env: Map<string, V>, depth: number): V {
    switch (e.e) {
      case 'lit':
        return { t: 'lit', v: e.v }
      case 'name':
        return env.get(e.v) ?? { t: 'func', name: e.v }
      case 'tuple':
        return { t: 'tuple', items: e.items.map((x) => this.eval(x, env, depth)) }
      case 'attr': {
        const o = this.eval(e.obj, env, depth)
        if (o.t === 'mod') return this.member(o, e.name)
        if (o.t === 'func') return { t: 'func', name: `${o.name}.${e.name}` }
        return { t: 'lit', v: null }
      }
      case 'sub': {
        const o = this.eval(e.obj, env, depth)
        const i = this.eval(e.idx, env, depth)
        if (o.t === 'tuple' && i.t === 'lit' && typeof i.v === 'number') return o.items[i.v] ?? { t: 'lit', v: null }
        if (o.t === 'val') return this.node('getitem', this.cur, [o, i], i.t === 'lit' ? { index: i.v } : {})
        return { t: 'lit', v: null }
      }
      case 'bin': {
        const a = this.eval(e.a, env, depth)
        const b = this.eval(e.b, env, depth)
        const op = BIN[e.op]
        if (!op || (a.t !== 'val' && b.t !== 'val')) return { t: 'lit', v: null }
        return this.node(op, this.cur, [a, b], {}, 1, 'aten')
      }
      case 'un': {
        const a = this.eval(e.a, env, depth)
        return a.t === 'val' && e.op === '-' ? this.node('neg', this.cur, [a], {}, 1, 'aten') : { t: 'lit', v: null }
      }
      case 'if': {
        const a = this.eval(e.a, env, depth)
        return a.t !== 'lit' ? a : this.eval(e.b, env, depth)
      }
      case 'call':
        return this.call(e, env, depth)
    }
  }

  member(o: { path: string; cls: string }, name: string): V {
    const path = o.path ? `${o.path}.${name}` : name
    const def = this.classes.get(o.cls)
    const type = def?.attrs.get(name)
    if (type && type.startsWith('__torch__.')) return { t: 'mod', path, cls: type }
    if (this.tensors.has(path)) return this.weight(path)
    if (this.modules.has(path)) return { t: 'mod', path, cls: this.modules.get(path)!.type ?? '' }
    if (def?.methods.has(name)) return { t: 'func', name: `${o.cls}::${o.path}::${name}` }
    const attr = this.modules.get(o.path)?.attrs?.[name]
    return { t: 'lit', v: attr ?? null }
  }

  call(e: Extract<E, { e: 'call' }>, env: Map<string, V>, depth: number): V {
    // getattr(self.h, "0") → child module
    if (e.fn.e === 'name' && e.fn.v === 'getattr' && e.args.length >= 2) {
      const o = this.eval(e.args[0], env, depth)
      const k = e.args[1].e === 'lit' ? String(e.args[1].v) : ''
      if (o.t === 'mod') {
        const path = o.path ? `${o.path}.${k}` : k
        const def = this.classes.get(o.cls)
        const type = def?.attrs.get(k) ?? this.modules.get(path)?.type ?? ''
        return { t: 'mod', path, cls: type.startsWith('__torch__.') ? type : this.findClass(path, type) }
      }
      return { t: 'lit', v: null }
    }
    // (m).forward(x) / m.forward(x) / self.method(x)
    if (e.fn.e === 'attr') {
      const obj = this.eval(e.fn.obj, env, depth)
      if (obj.t === 'mod') {
        const args = e.args.map((a) => this.eval(a, env, depth))
        const cls = obj.cls
        const clean = cleanName(cls)
        if (clean.startsWith('torch.nn.') && !/\.(container)\./.test(clean)) return this.leaf(cls, obj.path, args)
        return this.inline(cls, e.fn.name, obj.path, args, depth + 1)
      }
    }
    const fn = this.eval(e.fn, env, depth)
    const args = e.args.map((a) => this.eval(a, env, depth))
    if (fn.t === 'func' && fn.name.includes('::')) {
      const [cls, path, method] = fn.name.split('::')
      return this.inline(cls, method, path, args, depth + 1)
    }
    const name = fn.t === 'func' ? fn.name : (this.dotted(e.fn) ?? 'call')
    const short = name.split('.').pop() ?? name
    if (PASS.has(short)) return args.find((a) => a.t === 'val') ?? args[args.length - 1] ?? { t: 'lit', v: null }
    if (META.has(short)) return { t: 'lit', v: null }
    const attrs: Record<string, Value> = {}
    e.args.forEach((a, i) => {
      const v = args[i]
      if (v.t === 'lit' && v.v !== null) attrs[`arg${i}`] = v.v
      else if (v.t === 'tuple' && v.items.every((x) => x.t === 'lit')) attrs[`arg${i}`] = v.items.map((x) => (x as { v: Value }).v)
    })
    for (const [k, x] of e.kw) {
      const v = this.eval(x, env, depth)
      if (v.t === 'lit' && v.v !== null) attrs[k] = v.v
    }
    const domain = /^(torch|ops\.aten)\./.test(name) ? 'aten' : /functional\./.test(name) ? 'functional' : /^ops\.prim\./.test(name) ? 'prim' : undefined
    const inputs = args.filter((a) => a.t === 'val' || a.t === 'tuple')
    // Calls on plain values only (constants, shapes) do not add nodes.
    if (!inputs.length && !/^(arange|zeros|ones|full|empty|randn|rand|tensor|eye|linspace)/.test(short)) return { t: 'lit', v: null }
    return this.node(short, this.cur, inputs, attrs, 1, domain)
  }

  private findClass(path: string, type: string): string {
    // Data.pkl types are cleaned; recover the code class by matching the cleaned name.
    for (const k of this.classes.keys()) if (cleanName(k) === type) return k
    return type
  }
}

/** A class constant's source text as a value (`(3, 3)` → [3, 3], `2.` → 2, `"zeros"` → zeros). */
function constValue(src: string): Value {
  try {
    const e = new Parser(tokenize(src)).expr()
    const lit = (x: E): Value => (x.e === 'lit' ? x.v : x.e === 'tuple' ? x.items.map(lit) : src)
    return lit(e)
  } catch {
    return src
  }
}

/** Index of the assignment "=" in a statement, or -1. */
function findAssign(s: string): number {
  let depth = 0
  let q = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === q) q = ''
      continue
    }
    if (c === '"' || c === "'") q = c
    else if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === '=' && depth === 0 && s[i + 1] !== '=' && !'=!<>'.includes(s[i - 1] ?? '')) return i
  }
  return -1
}
