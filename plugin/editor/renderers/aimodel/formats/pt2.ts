/** torch.export `.pt2` reader (ExportedProgram). The archive holds the serialized ATen graph as JSON
 *  (`models/<name>.json` since torch 2.6, `serialized_exported_program.json` before), weights as raw
 *  files with `model_weights_config.json` (2.6+) or a pickled `serialized_state_dict.pt` (older). */
import { PreviewError } from '../../../core/types.ts'
import { bytesSource, utf8Of } from '../bytes.ts'
import { elementBytes, numel } from '../dtype.ts'
import type { ByteSource, Graph, GraphNode, GraphValue, ModelIR, ModuleNode, TensorInfo, Value } from '../ir.ts'
import { inferTree, walk } from '../tree.ts'
import { openZip, type ZipArchive } from '../zip.ts'

/** torch/_export/serde/schema.py ScalarType. */
const SCALAR: Record<number, string> = { 1: 'u8', 2: 'i8', 3: 'i16', 4: 'i32', 5: 'i64', 6: 'f16', 7: 'f32', 8: 'f64', 9: 'c32', 10: 'c64', 11: 'c128', 12: 'bool', 13: 'bf16', 28: 'u16', 29: 'f8e4m3', 30: 'f8e5m2' }

type J = any // eslint-disable-line @typescript-eslint/no-explicit-any

export async function read(src: ByteSource): Promise<ModelIR> {
  return readZip(await openZip(src), src)
}

export async function readZip(zip: ZipArchive, _src: ByteSource): Promise<ModelIR> {
  const modelEntry = zip.entries.find((e) => /(^|\/)models\/model\.json$/.test(e.name)) ?? zip.entries.find((e) => /(^|\/)models\/[^/]+\.json$/.test(e.name)) ?? zip.entries.find((e) => /serialized_exported_program\.json$/.test(e.name))
  if (!modelEntry) throw new PreviewError('pt2-no-program', 'This .pt2 archive has no serialized ExportedProgram (models/*.json).')
  const prefix = modelEntry.name.replace(/(models\/[^/]+|serialized_exported_program)\.json$/, '')
  let ep: J
  try {
    ep = JSON.parse(utf8Of(await zip.read(modelEntry)))
  } catch (e) {
    throw new PreviewError('pt2-bad-json', 'The ExportedProgram JSON could not be read: the archive may be truncated.')
  }
  const gm = ep.graph_module ?? ep
  const g = gm.graph
  if (!g || !Array.isArray(g.nodes)) throw new PreviewError('pt2-no-graph', 'The ExportedProgram has no graph.')
  const notes: ModelIR['notes'] = []
  const tensorValues: Record<string, J> = g.tensor_values ?? {}
  const shapeOf = (meta: J): (number | string)[] | undefined => (Array.isArray(meta?.sizes) ? meta.sizes.map((s: J) => (s.as_int !== undefined ? s.as_int : (s.as_expr?.expr_str ?? s.as_sym ?? '?'))) : undefined)

  // Signature: graph input names → parameter/buffer/constant names.
  const sig = gm.signature ?? {}
  const argToTensor = new Map<string, { name: string; kind: TensorInfo['kind'] }>()
  const userInputs: string[] = []
  for (const s of sig.input_specs ?? []) {
    const [kind, v] = Object.entries(s)[0] as [string, J]
    const argName = v?.arg?.name ?? v?.arg?.as_tensor?.name
    if (kind === 'parameter') argToTensor.set(argName, { name: v.parameter_name, kind: 'parameter' })
    else if (kind === 'buffer') argToTensor.set(argName, { name: v.buffer_name, kind: 'buffer' })
    else if (kind === 'tensor_constant') argToTensor.set(argName, { name: v.tensor_constant_name, kind: 'constant' })
    else if (kind === 'user_input' && argName) userInputs.push(argName)
  }

  // Weights.
  const tensors: TensorInfo[] = []
  const cfgEntry = zip.get(`${prefix}data/weights/model_weights_config.json`)
  if (cfgEntry) {
    const cfg = JSON.parse(utf8Of(await zip.read(cfgEntry))).config ?? {}
    for (const [name, c] of Object.entries(cfg) as [string, J][]) {
      const meta = c.tensor_meta ?? {}
      const shape = (shapeOf(meta) ?? []).map((d) => (typeof d === 'number' ? d : 0))
      const dtype = SCALAR[meta.dtype] ?? `scalar${meta.dtype}`
      const entry = zip.get(`${prefix}data/weights/${c.path_name}`)
      const es = elementBytes(dtype)
      const off = (meta.storage_offset?.as_int ?? 0) * es
      const t: TensorInfo = { name, shape, dtype, byteLength: es * numel(shape), kind: c.is_param ? 'parameter' : 'buffer', storage: c.path_name, attrs: { file: String(c.path_name), requires_grad: !!meta.requires_grad } }
      if (entry && !c.use_pickle) {
        t.read = async (r) => {
          const s = await zip.source(entry)
          return s.read(off + (r?.offset ?? 0), Math.min(r?.length ?? t.byteLength, t.byteLength - (r?.offset ?? 0)))
        }
      }
      tensors.push(t)
    }
  } else {
    const sd = zip.entries.find((e) => e.name === `${prefix}serialized_state_dict.pt` || e.name.endsWith('/serialized_state_dict.pt'))
    if (sd) {
      try {
        const { read } = await import('./pytorch.ts')
        const inner = await read(await zip.source(sd))
        tensors.push(...inner.tensors)
      } catch (e) {
        notes.push({ level: 'warn', en: `Weights could not be read: ${(e as Error).message}`, ko: `가중치를 읽지 못했습니다: ${(e as Error).message}` })
      }
    }
  }
  // Tensors named only in the signature (no stored data): metadata from tensor_values.
  const have = new Set(tensors.map((t) => t.name))
  for (const [arg, { name, kind }] of argToTensor) {
    if (have.has(name)) continue
    const meta = tensorValues[arg]
    const shape = (shapeOf(meta) ?? []).map((d) => (typeof d === 'number' ? d : 0))
    const dtype = SCALAR[meta?.dtype] ?? '?'
    tensors.push({ name, shape, dtype, byteLength: 0, kind, attrs: { stored: 'no' } })
  }

  // Graph.
  const values = new Map<string, GraphValue>()
  const valueOf = (name: string): string => {
    if (!values.has(name)) {
      const w = argToTensor.get(name)
      const meta = tensorValues[name]
      values.set(name, { id: name, shape: shapeOf(meta), dtype: SCALAR[meta?.dtype], tensor: w?.name })
    }
    return name
  }
  const nodes: GraphNode[] = []
  const moduleTypes = new Map<string, string>()
  g.nodes.forEach((n: J, i: number) => {
    const ins: string[] = []
    const attrs: Record<string, Value> = {}
    for (const inp of n.inputs ?? []) {
      const arg = inp.arg ?? {}
      const [k, v] = (Object.entries(arg)[0] ?? ['as_none', null]) as [string, J]
      if (k === 'as_tensor') ins.push(valueOf(v.name))
      else if (k === 'as_tensors') for (const t of v) ins.push(valueOf(t.name))
      else if (k === 'as_optional_tensors') for (const t of v) t?.as_tensor && ins.push(valueOf(t.as_tensor.name))
      else if (k === 'as_optional_tensor') v?.as_tensor && ins.push(valueOf(v.as_tensor.name))
      else if (k === 'as_none') continue
      else if (k === 'as_sym_int' || k === 'as_sym_float' || k === 'as_sym_bool') attrs[inp.name] = v?.as_name ?? v?.as_int ?? JSON.stringify(v)
      else if (k === 'as_scalar_type') attrs[inp.name] = SCALAR[v] ?? v
      else if (k === 'as_device') attrs[inp.name] = `${v.type}${v.index !== null && v.index !== undefined ? ':' + v.index : ''}`
      else if (k === 'as_graph') attrs[inp.name] = `graph ${v?.name ?? ''}`
      else attrs[inp.name] = v as Value
    }
    const outs: string[] = []
    for (const o of n.outputs ?? []) {
      if (o.as_tensor) outs.push(valueOf(o.as_tensor.name))
      else if (o.as_tensors) for (const t of o.as_tensors) outs.push(valueOf(t.name))
      else if (o.as_sym_int?.as_name) outs.push(valueOf(o.as_sym_int.as_name))
    }
    const meta = n.metadata ?? {}
    let module: string | undefined
    if (typeof meta.nn_module_stack === 'string' && meta.nn_module_stack) {
      // "key,path,type;key,path,type" — the innermost entry is the owning module.
      for (const part of meta.nn_module_stack.split(';')) {
        const fields = part.split(',')
        const type = fields.pop() ?? ''
        const path = fields.slice(1).join(',')
        if (path) {
          moduleTypes.set(path, type)
          module = path
        }
      }
    }
    const target = String(n.target ?? 'op')
    // torch.ops.aten.add.Tensor → op "add", overload "Tensor".
    const parts = target.replace(/^torch\.ops\./, '').split('.')
    const ns = parts.length > 2 ? parts.shift()! : 'aten'
    const overload = parts.length > 1 ? parts.pop()! : ''
    const op = parts.join('.')
    if (overload && overload !== 'default') attrs['overload'] = overload
    void ns
    nodes.push({ id: `n${i}`, op, name: n.name ?? outs[0], domain: target.startsWith('torch.ops.aten') ? 'aten' : target.split('.').slice(0, 3).join('.'), attrs: Object.keys(attrs).length ? attrs : undefined, inputs: ins, outputs: outs, module })
  })
  const graphInputs = (g.inputs ?? []).map((x: J) => x.as_tensor?.name ?? x.as_sym_int?.as_name).filter(Boolean).filter((n: string) => !argToTensor.has(n) || true).map(valueOf)
  const graphOutputs = (g.outputs ?? []).map((x: J) => x.as_tensor?.name).filter(Boolean).map(valueOf)
  const graph: Graph = { name: 'forward', nodes, values: [...values.values()], inputs: graphInputs.filter((n: string) => !argToTensor.has(n)), outputs: graphOutputs }

  // Module tree from the tensor names, typed from nn_module_stack.
  const modules: ModuleNode = inferTree(tensors)
  const byPath = new Map<string, ModuleNode>()
  walk(modules, (m) => byPath.set(m.path, m))
  for (const [path, type] of moduleTypes) {
    let m = byPath.get(path)
    if (!m) {
      // Modules without weights (ReLU, Dropout): add them under their parent.
      const parent = byPath.get(path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : '') ?? modules
      m = { path, name: path.split('.').pop() ?? path, children: [], tensors: [] }
      parent.children.push(m)
      byPath.set(path, m)
    }
    m.type = type
    m.inferred = false
  }
  const rootType = (g.nodes[0]?.metadata?.nn_module_stack ?? '').split(';')[0]?.split(',').pop()
  if (rootType) modules.type = rootType

  const metadata: Record<string, Value> = { archive: prefix.replace(/\/$/, '') }
  if (ep.torch_version) metadata['torch'] = ep.torch_version
  if (ep.schema_version) metadata['schema'] = `${ep.schema_version.major}.${ep.schema_version.minor}`
  if (ep.opset_version) metadata['opsets'] = ep.opset_version
  metadata['user inputs'] = userInputs.map((n) => `${n}: ${(shapeOf(tensorValues[n]) ?? []).join('×')}`)
  return {
    format: 'pt2',
    formatLabel: `torch.export ExportedProgram${ep.torch_version ? ` (torch ${String(ep.torch_version).replace(/\+.*/, '')})` : ''}`,
    framework: 'pytorch',
    producer: ep.torch_version ? `torch ${ep.torch_version}` : undefined,
    metadata,
    tensors,
    modules,
    graph,
    notes
  }
}

export { bytesSource }
