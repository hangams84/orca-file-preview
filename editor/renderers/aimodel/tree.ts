/** Module trees: inferred from dotted tensor names when the file has no module objects, and
 *  per-module totals (parameters, bytes, dtypes) for the views. */
import { numel } from './dtype.ts'
import type { ModelIR, ModuleNode, TensorInfo } from './ir.ts'

const BUFFER_NAME = /(^|\.)(running_mean|running_var|num_batches_tracked|position_ids|attn\.bias|attn\.masked_bias|inv_freq|_float_tensor|scale|zero_point)$/

/** True when the tensor is a buffer/state rather than a trainable parameter. */
export function isBuffer(t: TensorInfo): boolean {
  if (t.kind) return t.kind === 'buffer' || t.kind === 'optimizer-state' || t.kind === 'other'
  return BUFFER_NAME.test(t.name)
}

/** Key identifying the memory a tensor occupies (tied weights share it). */
export function memoryKey(t: TensorInfo): string {
  return t.storage ? `${t.storage}@${String(t.attrs?.storage_offset ?? 0)}:${t.shape.join('x')}:${t.dtype}` : `#${t.name}`
}

/** Splits a tensor name into module path segments and the leaf name. Handles `.` and `/` (TF/Keras). */
export function splitName(name: string): { module: string[]; leaf: string } {
  const parts = name.split(/[./]/).filter(Boolean)
  const leaf = parts.pop() ?? name
  return { module: parts, leaf }
}

/** Guesses a layer type from the leaf tensors a module owns. */
export function guessType(path: string, leaves: Map<string, TensorInfo>): string | undefined {
  const w = leaves.get('weight') ?? leaves.get('kernel')
  const last = path.split('.').pop() ?? ''
  if (leaves.has('in_proj_weight')) return 'MultiheadAttention'
  if (leaves.has('running_mean')) return w && w.shape.length === 1 ? 'BatchNorm' : 'BatchNorm'
  if (leaves.has('_packed_params') || /_packed_params/.test([...leaves.keys()].join())) return 'QuantizedLinear'
  if (!w) {
    if (leaves.has('gamma') || leaves.has('beta')) return 'Norm'
    return undefined
  }
  const r = w.shape.length
  if (r === 4) return 'Conv2d'
  if (r === 3) return 'Conv1d'
  if (r === 5) return 'Conv3d'
  if (r === 2) return /emb|wte|wpe|tok|token|word|position/i.test(last) ? 'Embedding' : 'Linear'
  if (r === 1) return /ln|norm|layernorm|rms/i.test(last) ? (leaves.has('bias') ? 'LayerNorm' : 'RMSNorm') : 'Norm'
  return undefined
}

/** Builds a module tree from dotted tensor names. */
export function inferTree(tensors: readonly TensorInfo[], rootName = 'model'): ModuleNode {
  const root: ModuleNode = { path: '', name: rootName, children: [], tensors: [], inferred: true }
  const byPath = new Map<string, ModuleNode>([['', root]])
  const leaves = new Map<string, Map<string, TensorInfo>>()
  for (const t of tensors) {
    const { module, leaf } = splitName(t.name)
    let node = root
    let path = ''
    for (const seg of module) {
      path = path ? `${path}.${seg}` : seg
      let child = byPath.get(path)
      if (!child) {
        child = { path, name: seg, children: [], tensors: [], inferred: true }
        byPath.set(path, child)
        node.children.push(child)
      }
      node = child
    }
    node.tensors.push(t.name)
    let m = leaves.get(node.path)
    if (!m) leaves.set(node.path, (m = new Map()))
    m.set(leaf, t)
  }
  for (const [path, m] of leaves) {
    const node = byPath.get(path)!
    if (!node.type) node.type = guessType(path, m)
  }
  // Containers of numbered children (`layers.0`, `layers.1`) read as ModuleList.
  for (const node of byPath.values()) {
    if (!node.type && node.children.length && node.children.every((c) => /^\d+$/.test(c.name))) node.type = 'ModuleList'
  }
  return root
}

/** The model's module tree: the file's own, else inferred from names. Tensors the file's tree does
 *  not mention are attached by name under it so totals add up. */
export function moduleTree(ir: ModelIR): ModuleNode {
  if (!ir.modules) return inferTree(ir.tensors.filter((t) => t.kind !== 'optimizer-state' && t.kind !== 'other'), ir.metadata['name'] ? String(ir.metadata['name']) : 'model')
  const known = new Set<string>()
  walk(ir.modules, (n) => n.tensors.forEach((t) => known.add(t)))
  const rest = ir.tensors.filter((t) => !known.has(t.name) && t.kind !== 'optimizer-state' && t.kind !== 'other')
  if (!rest.length) return ir.modules
  const extra = inferTree(rest, 'other')
  // Merge inferred nodes into the file's tree by path.
  const byPath = new Map<string, ModuleNode>()
  walk(ir.modules, (n) => byPath.set(n.path, n))
  walk(extra, (n) => {
    if (n === extra) {
      ir.modules!.tensors.push(...n.tensors)
      return
    }
    if (byPath.has(n.path)) {
      byPath.get(n.path)!.tensors.push(...n.tensors)
      return
    }
    const parentPath = n.path.includes('.') ? n.path.slice(0, n.path.lastIndexOf('.')) : ''
    const parent = byPath.get(parentPath)
    if (parent) {
      const copy = { ...n, children: [] }
      parent.children.push(copy)
      byPath.set(n.path, copy)
    }
  })
  return ir.modules
}

export function walk(node: ModuleNode, fn: (n: ModuleNode, depth: number) => void, depth = 0): void {
  fn(node, depth)
  for (const c of node.children) walk(c, fn, depth + 1)
}

export interface ModuleStat {
  /** Trainable parameter elements (buffers excluded), tied memory counted once. */
  params: number
  /** Elements of buffers. */
  buffers: number
  bytes: number
  tensors: number
  dtypes: Map<string, number>
}

/** Totals per module path (including descendants). Shared memory counted once (first owner). */
export function moduleStats(root: ModuleNode, tensors: readonly TensorInfo[]): Map<string, ModuleStat> {
  const byName = new Map(tensors.map((t) => [t.name, t]))
  const seen = new Set<string>()
  const out = new Map<string, ModuleStat>()
  const visit = (n: ModuleNode): ModuleStat => {
    const s: ModuleStat = { params: 0, buffers: 0, bytes: 0, tensors: 0, dtypes: new Map() }
    for (const name of n.tensors) {
      const t = byName.get(name)
      if (!t) continue
      s.tensors++
      const k = memoryKey(t)
      if (seen.has(k)) continue
      seen.add(k)
      const e = numel(t.shape)
      if (isBuffer(t)) s.buffers += e
      else s.params += e
      s.bytes += t.byteLength
      s.dtypes.set(t.dtype, (s.dtypes.get(t.dtype) ?? 0) + t.byteLength)
    }
    for (const c of n.children) {
      const cs = visit(c)
      s.params += cs.params
      s.buffers += cs.buffers
      s.bytes += cs.bytes
      s.tensors += cs.tensors
      for (const [d, b] of cs.dtypes) s.dtypes.set(d, (s.dtypes.get(d) ?? 0) + b)
    }
    out.set(n.path, s)
    return s
  }
  visit(root)
  return out
}

/** Model totals over all non-optimizer tensors, shared memory counted once. */
export function totals(tensors: readonly TensorInfo[]): ModuleStat {
  const seen = new Set<string>()
  const s: ModuleStat = { params: 0, buffers: 0, bytes: 0, tensors: 0, dtypes: new Map() }
  for (const t of tensors) {
    if (t.kind === 'optimizer-state' || t.kind === 'other') continue
    s.tensors++
    const k = memoryKey(t)
    if (seen.has(k)) continue
    seen.add(k)
    const e = numel(t.shape)
    if (isBuffer(t)) s.buffers += e
    else s.params += e
    s.bytes += t.byteLength
    s.dtypes.set(t.dtype, (s.dtypes.get(t.dtype) ?? 0) + t.byteLength)
  }
  return s
}
