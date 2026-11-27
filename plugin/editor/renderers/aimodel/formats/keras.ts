/** Keras models: `.keras` (Keras 3 zip: config.json, metadata.json, model.weights.h5) and legacy
 *  `.h5`/`.hdf5` (model_config / training_config attributes, model_weights/ and optimizer_weights/
 *  groups). Any other HDF5 file is shown as plain datasets with its group tree. The graph comes from
 *  the model config (Sequential chains, Functional inbound_nodes in the Keras 2 and Keras 3 forms,
 *  nested models as subgraphs); weight shapes come from the weights file, read lazily. */
import { openZip } from '../zip.ts'
import type { ByteSource, CheckpointInfo, Graph, GraphNode, GraphValue, ModelIR, ModuleNode, Note, TensorInfo, Value } from '../ir.ts'
import { bad, dv, guarded, MAX_DEPTH, moduleTree, note, product, Src, text, warn } from './common.ts'
import { H5, isHdf5, type H5Object } from './hdf5.ts'

export function detect(head: Uint8Array): boolean {
  if (isHdf5(head)) return true
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4 && head.length >= 30) {
    const n = dv(head).getUint16(26, true)
    const name = text(head.subarray(30, Math.min(head.length, 30 + n)))
    return name === 'metadata.json' || name === 'config.json' || name === 'model.weights.h5'
  }
  return false
}

type Json = Value | undefined
type Obj = { [k: string]: Value }
const isObj = (v: Json): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

function parseJson(s: string | undefined, what: string, notes: Note[]): Obj | undefined {
  if (!s) return undefined
  try {
    const v = JSON.parse(s.replace(/\bNaN\b/g, 'null').replace(/-?\bInfinity\b/g, 'null'))
    return isObj(v) ? v : undefined
  } catch {
    notes.push(warn(`${what} is not valid JSON; the graph is not shown.`, `${what}가 올바른 JSON이 아니어서 그래프를 표시하지 않습니다.`))
    return undefined
  }
}

// ---- HDF5 datasets → tensors ----

function tensorsOf(h5: H5, objects: H5Object[], kindOf: (path: string) => TensorInfo['kind']): TensorInfo[] {
  const out: TensorInfo[] = []
  for (const o of objects) {
    const d = o.dataset
    if (!d) continue
    const shape = d.space.scalar || d.space.null ? [] : d.space.shape
    const attrs: Record<string, Value> = { hdf5Path: `/${o.path}`, layout: d.layout.kind }
    if (d.layout.chunk) attrs.chunks = d.layout.chunk
    if (d.filters.length) attrs.filters = d.filters.map((f) => f.name || ({ 1: 'deflate', 2: 'shuffle', 3: 'fletcher32', 32000: 'lzf', 32001: 'blosc', 4: 'szip' } as Record<number, string>)[f.id] || String(f.id))
    if (d.space.maxShape?.some((m, i) => m !== d.space.shape[i])) attrs.maxShape = d.space.maxShape.map((m) => (m < 0 ? 'unlimited' : m))
    for (const [k, v] of Object.entries(o.attrs)) attrs[`@${k}`] = v
    const t: TensorInfo = { name: o.path.replace(/\//g, '.'), shape, dtype: d.type.dtype, byteLength: h5.byteLength(d), kind: kindOf(o.path), attrs }
    if (d.type.big && d.type.size > 1) t.byteOrder = 'big'
    const why = h5.readable(d)
    if (why) {
      if (why !== 'empty') attrs.note = `values not read: ${why}`
    } else {
      const span = h5.contiguous(d)
      if (span) t.read = h5.src.reader(span[0], span[1], o.path)
      else {
        t.read = async (range) => {
          const b = await h5.readData(d)
          if (!range) return b
          const s = Math.max(0, range.offset)
          return b.subarray(s, s + Math.max(0, range.length))
        }
      }
    }
    out.push(t)
  }
  return out
}

// ---- model config → graph and modules ----

/** Plain, short attribute values from a layer config (initializers etc. collapse to their class). */
function simplify(v: Json, depth = 0): Value {
  if (v === undefined) return null
  if (Array.isArray(v)) return v.length > 64 ? [...v.slice(0, 64).map((x) => simplify(x, depth + 1)), `… (${v.length})`] : v.map((x) => simplify(x, depth + 1))
  if (isObj(v)) {
    if (typeof v.class_name === 'string') {
      const cfg = isObj(v.config) ? v.config : undefined
      if (v.class_name === 'DTypePolicy' || v.class_name === 'Policy') return (cfg?.name as string) ?? v.class_name
      if (v.class_name === '__tuple__' && Array.isArray(v.config)) return simplify(v.config, depth + 1)
      return v.class_name
    }
    if (depth > 3) return '{…}'
    const o: Obj = {}
    for (const [k, x] of Object.entries(v)) o[k] = simplify(x, depth + 1)
    return o
  }
  return v
}

function layerAttrs(cfg: Obj): Record<string, Value> {
  const out: Record<string, Value> = {}
  for (const [k, v] of Object.entries(cfg)) {
    if (k === 'name' || k === 'layers' || k === 'input_layers' || k === 'output_layers') continue
    out[k] = simplify(v)
  }
  return out
}

/** keras_history references [layer, node, tensor] found anywhere in a Keras 3 call-args tree. */
function histories(v: Json, out: [string, number, number][] = [], depth = 0): [string, number, number][] {
  if (depth > 16 || v === undefined || v === null) return out
  if (Array.isArray(v)) v.forEach((x) => histories(x, out, depth + 1))
  else if (isObj(v)) {
    if (v.class_name === '__keras_tensor__' && isObj(v.config) && Array.isArray(v.config.keras_history)) {
      const [l, n, t] = v.config.keras_history
      out.push([String(l), Number(n) || 0, Number(t) || 0])
    } else Object.values(v).forEach((x) => histories(x, out, depth + 1))
  }
  return out
}

/** Keras-tensor shapes in call args, keyed by value id. */
function tensorShapes(v: Json, into: Map<string, GraphValue>, id: (l: string, n: number, t: number) => string, depth = 0): void {
  if (depth > 16 || v === undefined || v === null) return
  if (Array.isArray(v)) v.forEach((x) => tensorShapes(x, into, id, depth + 1))
  else if (isObj(v)) {
    if (v.class_name === '__keras_tensor__' && isObj(v.config)) {
      const c = v.config
      const h = Array.isArray(c.keras_history) ? c.keras_history : []
      const key = id(String(h[0]), Number(h[1]) || 0, Number(h[2]) || 0)
      const shape = Array.isArray(c.shape) ? c.shape.map((d) => (typeof d === 'number' ? d : '?')) : undefined
      into.set(key, { id: key, shape, dtype: typeof c.dtype === 'string' ? kerasDtype(c.dtype) : undefined })
    } else Object.values(v).forEach((x) => tensorShapes(x, into, id, depth + 1))
  }
}

function kerasDtype(s: string): string {
  return ({ float32: 'f32', float16: 'f16', bfloat16: 'bf16', float64: 'f64', int32: 'i32', int64: 'i64', int8: 'i8', uint8: 'u8', bool: 'bool', string: 'str' } as Record<string, string>)[s] ?? s
}

function refs(v: Json): [string, number, number][] {
  // input_layers / output_layers: [name, node, tensor] or a list of those
  if (!Array.isArray(v)) return []
  if (v.length === 3 && typeof v[0] === 'string') return [[v[0], Number(v[1]) || 0, Number(v[2]) || 0]]
  return v.flatMap((x) => refs(x))
}

interface Built {
  graph: Graph
  module: ModuleNode
}

function buildModel(model: Obj, pathPrefix: string, depth: number): Built {
  if (depth > 8) throw bad('keras-too-deep', 'The Keras model nests models too deeply.')
  const cls = String(model.class_name ?? 'Model')
  const cfg: Obj = isObj(model.config) ? model.config : Array.isArray(model.config) ? { layers: model.config } : {}
  const name = String(cfg.name ?? model.name ?? cls)
  const layers = (Array.isArray(cfg.layers) ? cfg.layers : []).filter(isObj)
  const graph: Graph = { name, nodes: [], values: [], inputs: [], outputs: [], subgraphs: [] }
  const module: ModuleNode = { path: pathPrefix, name, type: cls, children: [], tensors: [], attrs: {} }
  const known = new Map<string, GraphValue>()
  const isSequential = cls === 'Sequential' || !layers.some((l) => Array.isArray(l.inbound_nodes) && l.inbound_nodes.length)
  const id = (l: string, n: number, t: number) => (n === 0 && t === 0 ? l : `${l}:${n}:${t}`)

  const addLayer = (l: Obj, inputs: string[], outputs: string[], callIdx: number) => {
    const lcfg: Obj = isObj(l.config) ? l.config : {}
    const lname = String(l.name ?? lcfg.name ?? `layer_${graph.nodes.length}`)
    const lcls = String(l.class_name ?? 'Layer')
    const path = pathPrefix ? `${pathPrefix}.${lname}` : lname
    const node: GraphNode = { id: callIdx ? `${lname}#${callIdx}` : lname, op: lcls, name: lname, inputs, outputs, module: path }
    const attrs = layerAttrs(lcfg)
    if (Object.keys(attrs).length) node.attrs = attrs
    let child = module.children.find((c) => c.name === lname)
    if (!child) {
      if (Array.isArray(lcfg.layers)) {
        const inner = buildModel(l, path, depth + 1)
        child = inner.module
        const gi = graph.subgraphs!.push(inner.graph) - 1
        node.subgraphs = [gi]
      } else child = { path, name: lname, type: lcls, children: [], tensors: [], attrs }
      module.children.push(child)
    } else if (Array.isArray(lcfg.layers)) {
      const gi = graph.subgraphs!.findIndex((g) => g.name === lname)
      if (gi >= 0) node.subgraphs = [gi]
    }
    graph.nodes.push(node)
  }

  if (isSequential) {
    let prev = ''
    const first = layers[0]
    if (!first || first.class_name !== 'InputLayer') {
      const bs = (isObj(model.build_config) && model.build_config.input_shape) || cfg.build_input_shape
      prev = `${name}_input`
      graph.inputs.push(prev)
      known.set(prev, { id: prev, shape: Array.isArray(bs) ? bs.map((d) => (typeof d === 'number' ? d : '?')) : undefined })
    }
    for (const l of layers) {
      const lname = String(l.name ?? (isObj(l.config) ? l.config.name : '') ?? '')
      if (l.class_name === 'InputLayer') {
        const c = isObj(l.config) ? l.config : {}
        const shape = (c.batch_shape ?? c.batch_input_shape) as Json
        known.set(lname, { id: lname, shape: Array.isArray(shape) ? shape.map((d) => (typeof d === 'number' ? d : '?')) : undefined, dtype: typeof c.dtype === 'string' ? kerasDtype(c.dtype) : undefined })
        graph.inputs.push(lname)
        addLayer(l, [], [lname], 0)
      } else addLayer(l, prev ? [prev] : [], [lname], 0)
      prev = lname
    }
    if (prev) graph.outputs.push(prev)
  } else {
    // outputs referenced per (layer, call): how many tensors each call produces
    const maxOut = new Map<string, number>()
    const note = (l: string, n: number, t: number) => maxOut.set(`${l}:${n}`, Math.max(maxOut.get(`${l}:${n}`) ?? 0, t))
    for (const l of layers) {
      for (const call of Array.isArray(l.inbound_nodes) ? l.inbound_nodes : []) {
        const hs = isObj(call) ? histories(call.args) : Array.isArray(call) ? (call as Value[]).filter(Array.isArray).map((x) => [String((x as Value[])[0]), Number((x as Value[])[1]) || 0, Number((x as Value[])[2]) || 0] as [string, number, number]) : []
        hs.forEach(([a, b, c]) => note(a, b, c))
      }
    }
    refs(cfg.output_layers).forEach(([a, b, c]) => note(a, b, c))
    for (const l of layers) {
      const lname = String(l.name ?? (isObj(l.config) ? l.config.name : ''))
      const calls = Array.isArray(l.inbound_nodes) ? l.inbound_nodes : []
      const outsOf = (k: number) => Array.from({ length: (maxOut.get(`${lname}:${k}`) ?? 0) + 1 }, (_, t) => id(lname, k, t))
      if (!calls.length) {
        if (l.class_name === 'InputLayer') {
          const c = isObj(l.config) ? l.config : {}
          const shape = (c.batch_shape ?? c.batch_input_shape) as Json
          known.set(lname, { id: lname, shape: Array.isArray(shape) ? shape.map((d) => (typeof d === 'number' ? d : '?')) : undefined, dtype: typeof c.dtype === 'string' ? kerasDtype(c.dtype) : undefined })
        }
        addLayer(l, [], outsOf(0), 0)
        continue
      }
      calls.forEach((call, k) => {
        let ins: string[]
        if (isObj(call)) {
          ins = histories(call.args).map(([a, b, c]) => id(a, b, c))
          tensorShapes(call.args, known, id)
          const kw = isObj(call.kwargs) ? call.kwargs : {}
          const extra = histories(kw).map(([a, b, c]) => id(a, b, c))
          ins.push(...extra)
        } else ins = (Array.isArray(call) ? call : []).filter(Array.isArray).map((x) => id(String((x as Value[])[0]), Number((x as Value[])[1]) || 0, Number((x as Value[])[2]) || 0))
        addLayer(l, ins, outsOf(k), k)
      })
    }
    graph.inputs = refs(cfg.input_layers).map(([a, b, c]) => id(a, b, c))
    graph.outputs = refs(cfg.output_layers).map(([a, b, c]) => id(a, b, c))
  }
  const seen = new Map<string, GraphValue>()
  const add = (v: string) => v && !seen.has(v) && seen.set(v, known.get(v) ?? { id: v })
  graph.inputs.forEach(add)
  graph.nodes.forEach((n) => (n.inputs.forEach(add), n.outputs.forEach(add)))
  graph.values = [...seen.values()]
  if (!graph.subgraphs!.length) delete graph.subgraphs
  return { graph, module }
}

function findModule(root: ModuleNode, name: string): ModuleNode | undefined {
  const stack = [root]
  while (stack.length) {
    const m = stack.shift()!
    if (m.name === name && m !== root) return m
    stack.push(...m.children)
  }
  return undefined
}

/** Keras 3 variable names for common layers (the weights file only stores vars/0, vars/1, …). */
function varNames(type: string | undefined, attrs: Record<string, Value> | undefined, n: number): string[] | null {
  const a = attrs ?? {}
  const bias = a.use_bias !== false
  const table: Record<string, string[]> = {
    Dense: bias ? ['kernel', 'bias'] : ['kernel'],
    EinsumDense: a.bias_axes ? ['kernel', 'bias'] : ['kernel'],
    Conv1D: bias ? ['kernel', 'bias'] : ['kernel'],
    Conv2D: bias ? ['kernel', 'bias'] : ['kernel'],
    Conv3D: bias ? ['kernel', 'bias'] : ['kernel'],
    Conv2DTranspose: bias ? ['kernel', 'bias'] : ['kernel'],
    DepthwiseConv2D: bias ? ['kernel', 'bias'] : ['kernel'],
    SeparableConv2D: bias ? ['depthwise_kernel', 'pointwise_kernel', 'bias'] : ['depthwise_kernel', 'pointwise_kernel'],
    Embedding: ['embeddings'],
    BatchNormalization: [...(a.scale !== false ? ['gamma'] : []), ...(a.center !== false ? ['beta'] : []), 'moving_mean', 'moving_variance'],
    LayerNormalization: [...(a.scale !== false ? ['gamma'] : []), ...(a.center !== false ? ['beta'] : [])],
    LSTM: ['kernel', 'recurrent_kernel', 'bias'],
    GRU: ['kernel', 'recurrent_kernel', 'bias'],
    SimpleRNN: ['kernel', 'recurrent_kernel', 'bias']
  }
  const names = type ? table[type] : undefined
  return names && names.length === n ? names : null
}

// ---- readers ----

interface Ctx {
  notes: Note[]
  metadata: Record<string, Value>
  checkpoint?: CheckpointInfo
}

function checkpointOf(compile: Obj | undefined, optimizerTensors: TensorInfo[]): CheckpointInfo | undefined {
  if (!compile && !optimizerTensors.length) return undefined
  const cp: CheckpointInfo = {}
  if (compile) {
    const hp: Record<string, Value> = {}
    for (const [k, v] of Object.entries(compile)) if (k !== 'optimizer' && k !== 'optimizer_config') hp[k] = simplify(v)
    cp.hyperParameters = hp
    const opt = (compile.optimizer ?? compile.optimizer_config) as Json
    if (isObj(opt)) {
      const ocfg = isObj(opt.config) ? opt.config : {}
      const groups: Record<string, Value>[] = [Object.fromEntries(Object.entries(ocfg).map(([k, v]) => [k, simplify(v)]))]
      cp.optimizers = [{ type: String(opt.class_name ?? ocfg.name ?? 'optimizer'), groups, stateTensors: optimizerTensors.length, stateBytes: optimizerTensors.reduce((s, t) => s + t.byteLength, 0) }]
    } else if (typeof opt === 'string') cp.optimizers = [{ type: opt, groups: [], stateTensors: optimizerTensors.length }]
  }
  if (!cp.optimizers && optimizerTensors.length) cp.optimizers = [{ groups: [], stateTensors: optimizerTensors.length, stateBytes: optimizerTensors.reduce((s, t) => s + t.byteLength, 0) }]
  return cp
}

/** Weights in the Keras 3 layout: layers/<key>/vars/<i> with a `name` attribute on each vars group. */
function attachKeras3(objects: H5Object[], tensors: TensorInfo[], root: ModuleNode): void {
  const byPath = new Map(tensors.map((t) => [t.attrs!.hdf5Path as string, t]))
  for (const o of objects) {
    if (o.kind !== 'group' || !/(^|\/)vars$/.test(o.path)) continue
    const owner = typeof o.attrs.name === 'string' ? o.attrs.name : undefined
    const isOpt = o.path.startsWith('optimizer')
    let m: ModuleNode | undefined
    if (isOpt) {
      m = root.children.find((c) => c.path === 'optimizer')
      if (!m) root.children.push((m = { path: 'optimizer', name: 'optimizer', type: owner, children: [], tensors: [], inferred: true }))
    } else if (o.path === 'vars') m = root
    else m = (owner && findModule(root, owner)) || undefined
    const vars = objects.filter((x) => x.dataset && x.path.startsWith(`${o.path}/`) && !x.path.slice(o.path.length + 1).includes('/'))
    vars.sort((a, b) => Number(a.path.split('/').pop()) - Number(b.path.split('/').pop()))
    const names = m && !isOpt ? varNames(m.type, m.attrs, vars.length) : null
    vars.forEach((v, i) => {
      const t = byPath.get(`/${v.path}`)
      if (!t) return
      if (owner) t.attrs!.layer = owner
      if (names) t.attrs!.variable = names[i]
      if (m) m.tensors.push(t.name)
      else {
        // no layer of that name: hang it on a module named after the h5 group
        const key = o.path.replace(/\/vars$/, '').split('/').pop() ?? o.path
        let g = root.children.find((c) => c.path === key)
        if (!g) root.children.push((g = { path: key, name: owner ?? key, children: [], tensors: [], inferred: true }))
        g.tensors.push(t.name)
      }
    })
  }
}

/** Weights in the legacy layout: model_weights/<layer>/<weight_names…>. */
function attachLegacy(objects: H5Object[], tensors: TensorInfo[], root: ModuleNode, weightsRoot: string): void {
  const byPath = new Map(tensors.map((t) => [t.attrs!.hdf5Path as string, t]))
  for (const o of objects) {
    if (o.kind !== 'group') continue
    const wn = o.attrs.weight_names
    if (!Array.isArray(wn)) continue
    const isOpt = o.path === 'optimizer_weights'
    const layer = o.path.split('/').pop() ?? ''
    let m = isOpt ? undefined : findModule(root, layer)
    if (!m) {
      const key = isOpt ? 'optimizer' : layer
      m = root.children.find((c) => c.path === key)
      if (!m) root.children.push((m = { path: key, name: key, children: [], tensors: [], inferred: true }))
    }
    for (const w of wn) {
      const t = byPath.get(`/${o.path}/${String(w)}`)
      if (!t) continue
      t.attrs!.variable = String(w).split('/').pop()!.replace(/:0$/, '')
      if (!isOpt) t.attrs!.layer = layer
      m.tensors.push(t.name)
    }
  }
  void weightsRoot
}

async function fromH5(source: ByteSource, config: Obj | undefined, ctx: Ctx, opts: { keras3Weights: boolean; label: string; format: string; compile?: Obj }): Promise<ModelIR> {
  const h5 = await H5.open(source, opts.format === 'keras' ? 'keras' : 'hdf5')
  const objects = await h5.walk()
  const root = objects[0]
  const rootAttrs = root?.attrs ?? {}
  let modelConfig = config
  let training: Obj | undefined = opts.compile
  if (!modelConfig && typeof rootAttrs.model_config === 'string') modelConfig = parseJson(rootAttrs.model_config, 'model_config', ctx.notes)
  if (!training && typeof rootAttrs.training_config === 'string') training = parseJson(rootAttrs.training_config, 'training_config', ctx.notes)
  for (const [k, v] of Object.entries(rootAttrs)) if (k !== 'model_config' && k !== 'training_config') ctx.metadata[k] = v
  const mw = objects.find((o) => o.path === 'model_weights')
  if (mw) for (const [k, v] of Object.entries(mw.attrs)) ctx.metadata[`model_weights.${k}`] = v

  const isKeras3 = opts.keras3Weights || objects.some((o) => o.kind === 'group' && /(^|\/)vars$/.test(o.path) && typeof o.attrs.name === 'string')
  const isLegacy = !!mw || objects.some((o) => Array.isArray(o.attrs.weight_names))
  const keras = !!modelConfig || isKeras3 || isLegacy
  const tensors = tensorsOf(h5, objects, (p) => (!keras ? 'array' : p.startsWith('optimizer') ? 'optimizer-state' : 'parameter'))

  let graph: Graph | undefined
  let modules: ModuleNode | undefined
  if (modelConfig) {
    try {
      const built = buildModel(modelConfig, '', 0)
      graph = built.graph
      modules = built.module
    } catch (e) {
      ctx.notes.push(warn(`The model config could not be turned into a graph (${(e as Error).message}).`))
    }
  }
  if (keras) {
    modules ??= { path: '', name: String(rootAttrs.name ?? 'model'), children: [], tensors: [], inferred: true }
    if (isKeras3) attachKeras3(objects, tensors, modules)
    if (isLegacy) attachLegacy(objects, tensors, modules, mw ? 'model_weights' : '')
    const owned = new Set<string>()
    const collect = (m: ModuleNode) => (m.tensors.forEach((t) => owned.add(t)), m.children.forEach(collect))
    collect(modules)
    const loose = tensors.filter((t) => !owned.has(t.name))
    if (loose.length) {
      const extra = moduleTree(loose, { rootName: 'other' })
      modules.children.push({ ...extra, path: 'other', name: 'other', inferred: true, children: extra.children.map(function prefix(c: ModuleNode): ModuleNode { return { ...c, path: `other.${c.path}`, children: c.children.map(prefix) } }) })
    }
  } else {
    modules = moduleTree(tensors, { rootName: 'file', inferred: false })
    // group attributes on the tree nodes
    const byPath = new Map<string, ModuleNode>()
    const walk = (m: ModuleNode) => (byPath.set(m.path, m), m.children.forEach(walk))
    walk(modules)
    for (const o of objects) {
      if (o.kind !== 'group' || !Object.keys(o.attrs).length) continue
      const m = byPath.get(o.path.replace(/\//g, '.'))
      if (m) m.attrs = o.attrs
    }
    if (Object.keys(rootAttrs).length) modules.attrs = rootAttrs
  }
  const opt = tensors.filter((t) => t.kind === 'optimizer-state')
  const cp = keras ? checkpointOf(training, opt) : undefined
  if (cp) {
    const v: Record<string, string> = {}
    for (const k of ['keras_version', 'backend']) if (typeof ctx.metadata[k] === 'string') v[k] = ctx.metadata[k] as string
    if (Object.keys(v).length) cp.versions = v
  }
  for (const i of h5.issues.slice(0, 20)) ctx.notes.push(warn(i))
  if (h5.issues.length > 20) ctx.notes.push(warn(`… and ${h5.issues.length - 20} more HDF5 issues.`))
  const unread = tensors.filter((t) => typeof t.attrs?.note === 'string').length
  if (unread) ctx.notes.push(note(`${unread} dataset(s) are listed without values (see each tensor's note).`))
  ctx.metadata.hdf5_superblock = h5.version
  const params = tensors.filter((t) => t.kind === 'parameter').reduce((s, t) => s + product(t.shape), 0)
  if (keras) ctx.metadata.parameters = params
  const keras_version = ctx.metadata.keras_version
  return {
    format: opts.format === 'keras' ? 'keras' : 'hdf5',
    formatLabel: keras ? `${opts.label}${typeof keras_version === 'string' ? ` · Keras ${keras_version}` : ''}` : `HDF5 · superblock v${h5.version}`,
    framework: keras ? 'keras' : undefined,
    producer: typeof keras_version === 'string' ? `keras ${keras_version}${typeof ctx.metadata.backend === 'string' ? ` (${ctx.metadata.backend})` : ''}` : undefined,
    metadata: ctx.metadata,
    tensors,
    modules,
    graph,
    checkpoint: cp,
    notes: ctx.notes
  }
}

async function readKerasZip(source: ByteSource): Promise<ModelIR> {
  let zip
  try {
    zip = await openZip(source)
  } catch (e) {
    throw bad('keras-damaged', `The .keras archive is damaged (${(e as Error).message}).`)
  }
  const ctx: Ctx = { notes: [], metadata: {} }
  const textOf = async (n: string) => (zip.get(n) ? text(await zip.read(n)) : undefined)
  let config: Obj | undefined
  try {
    config = parseJson(await textOf('config.json'), 'config.json', ctx.notes)
    const meta = parseJson(await textOf('metadata.json'), 'metadata.json', ctx.notes)
    if (meta) Object.assign(ctx.metadata, meta)
  } catch (e) {
    throw bad('keras-damaged', `The .keras archive could not be read (${(e as Error).message}).`)
  }
  ctx.metadata.archive = zip.entries.map((e) => `${e.name} (${e.size} bytes${e.method ? ', deflated' : ''})`)
  if (!config) throw bad('keras-no-config', 'This .keras archive has no config.json.')
  const compile = isObj(config.compile_config) ? config.compile_config : undefined
  const weights = zip.get('model.weights.h5')
  if (!weights) {
    ctx.notes.push(warn('No model.weights.h5 in the archive: the graph is shown without weights.'))
    const built = buildModel(config, '', 0)
    return { format: 'keras', formatLabel: 'Keras v3 (.keras)', framework: 'keras', metadata: ctx.metadata, tensors: [], modules: built.module, graph: built.graph, checkpoint: checkpointOf(compile, []), notes: ctx.notes }
  }
  const wsrc = await zip.source(weights)
  if (weights.method !== 0) ctx.notes.push(note('model.weights.h5 is compressed in the archive: it was inflated in memory.'))
  return fromH5(wsrc, config, ctx, { keras3Weights: true, label: 'Keras v3 (.keras)', format: 'keras', compile })
}

export function read(source: ByteSource): Promise<ModelIR> {
  return guarded('keras', () => readModel(source))
}

async function readModel(source: ByteSource): Promise<ModelIR> {
  const src = new Src(source, 'keras')
  const head = await src.upTo(0, 8)
  if (head[0] === 0x50 && head[1] === 0x4b) return readKerasZip(source)
  return fromH5(source, undefined, { notes: [], metadata: {} }, { keras3Weights: false, label: 'Keras HDF5 (.h5)', format: 'h5' })
}


