/** TensorFlow Lite (.tflite): a FlatBuffer read with hand-written vtable access (no flatc runtime).
 *  Subgraphs, operators (complete builtin-code table and every builtin-options table, generated from
 *  TensorFlow's schema into tflite-schema.ts), tensors with shape, type and quantization, buffers
 *  (lazy: inline vectors or the offset/size form of >2 GB models), signature defs and metadata.
 *  Every offset is checked against the file size; vector lengths are bounded by the bytes left. */
import type { ByteSource, DType, Graph, GraphNode, GraphValue, ModelIR, Note, TensorInfo, Value } from '../ir.ts'
import { bad, clip, dv, graphValues, moduleTree, note, Src, text, warn, yieldEvery } from './common.ts'
import { ACTIVATIONS, BUILTIN_OPS, BUILTIN_OPTIONS, BUILTIN_OPTIONS_2, PADDINGS, TENSOR_TYPES, type OptionField } from './tflite-schema.ts'

export function detect(head: Uint8Array): boolean {
  return head.length >= 8 && head[4] === 0x54 && head[5] === 0x46 && head[6] === 0x4c && head[7] === 0x33 // TFL3
}

const DTYPES: Record<string, DType> = {
  FLOAT32: 'f32', FLOAT16: 'f16', INT32: 'i32', UINT8: 'u8', INT64: 'i64', STRING: 'str', BOOL: 'bool', INT16: 'i16',
  COMPLEX64: 'c64', INT8: 'i8', FLOAT64: 'f64', COMPLEX128: 'c128', UINT64: 'u64', RESOURCE: 'resource', VARIANT: 'variant',
  UINT32: 'u32', UINT16: 'u16', INT4: 'i4', BFLOAT16: 'bf16', INT2: 'i2', UINT4: 'u4'
}

const SCALAR_SIZE: Record<string, number> = { bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, i64: 8, u64: 8, f64: 8 }

// ---- FlatBuffers ----

interface Table {
  pos: number
  /** vtable field offsets (0 = absent) */
  vt: number[]
}

class FB {
  constructor(readonly src: Src) {}

  async num(pos: number, kind: string): Promise<number> {
    const size = SCALAR_SIZE[kind]
    const v = dv(await this.src.bytes(pos, size, 'flatbuffer scalar'))
    switch (kind) {
      case 'bool': return v.getUint8(0)
      case 'i8': return v.getInt8(0)
      case 'u8': return v.getUint8(0)
      case 'i16': return v.getInt16(0, true)
      case 'u16': return v.getUint16(0, true)
      case 'i32': return v.getInt32(0, true)
      case 'u32': return v.getUint32(0, true)
      case 'f32': return v.getFloat32(0, true)
      case 'f64': return v.getFloat64(0, true)
      case 'i64': return Number(v.getBigInt64(0, true))
      default: return Number(v.getBigUint64(0, true))
    }
  }

  async table(pos: number): Promise<Table> {
    const soff = await this.num(pos, 'i32')
    const vtPos = pos - soff
    const vtSize = await this.num(vtPos, 'u16')
    if (vtSize < 4 || vtSize & 1 || vtSize > 4 + 2 * 256) throw this.src.fail(`bad vtable at ${vtPos}`)
    const raw = dv(await this.src.bytes(vtPos, vtSize, 'vtable'))
    const tableSize = raw.getUint16(2, true)
    const vt: number[] = []
    for (let o = 4; o < vtSize; o += 2) {
      const off = raw.getUint16(o, true)
      if (off >= tableSize && off !== 0) throw this.src.fail(`field offset ${off} outside its table at ${pos}`)
      vt.push(off)
    }
    this.src.check(pos, tableSize, 'table')
    return { pos, vt }
  }

  has(t: Table, slot: number): boolean {
    return !!t.vt[slot]
  }

  async scalar(t: Table, slot: number, kind: string, def = 0): Promise<number> {
    const off = t.vt[slot]
    return off ? this.num(t.pos + off, kind) : def
  }

  /** Follows the uoffset stored in a field. */
  async ref(t: Table, slot: number): Promise<number> {
    const off = t.vt[slot]
    if (!off) return 0
    const at = t.pos + off
    const target = at + (await this.num(at, 'u32'))
    this.src.check(target, 4, 'flatbuffer reference')
    return target
  }

  async sub(t: Table, slot: number): Promise<Table | null> {
    const p = await this.ref(t, slot)
    return p ? this.table(p) : null
  }

  async string(t: Table, slot: number): Promise<string | undefined> {
    const p = await this.ref(t, slot)
    if (!p) return undefined
    const n = await this.num(p, 'u32')
    return text(await this.src.bytes(p + 4, n, 'string'))
  }

  /** [start, count] of a vector of `elem`-byte items. */
  async vector(t: Table, slot: number, elem: number): Promise<[number, number]> {
    const p = await this.ref(t, slot)
    if (!p) return [0, 0]
    const n = await this.num(p, 'u32')
    this.src.check(p + 4, n * elem, 'vector')
    return [p + 4, n]
  }

  async numbers(t: Table, slot: number, kind: string, limit = Infinity): Promise<number[]> {
    const size = SCALAR_SIZE[kind]
    const [s, n] = await this.vector(t, slot, size)
    const m = Math.min(n, limit)
    if (!m) return []
    const v = dv(await this.src.bytes(s, m * size))
    const out: number[] = []
    for (let i = 0; i < m; i++) {
      const o = i * size
      out.push(
        kind === 'i32' ? v.getInt32(o, true)
        : kind === 'u32' ? v.getUint32(o, true)
        : kind === 'f32' ? v.getFloat32(o, true)
        : kind === 'i64' ? Number(v.getBigInt64(o, true))
        : kind === 'u64' ? Number(v.getBigUint64(o, true))
        : kind === 'f64' ? v.getFloat64(o, true)
        : kind === 'i16' ? v.getInt16(o, true)
        : kind === 'u16' ? v.getUint16(o, true)
        : kind === 'i8' ? v.getInt8(o)
        : v.getUint8(o)
      )
    }
    return out
  }

  async tables(t: Table, slot: number): Promise<number[]> {
    const [s, n] = await this.vector(t, slot, 4)
    if (!n) return []
    const v = dv(await this.src.bytes(s, n * 4))
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const at = s + i * 4
      const target = at + v.getUint32(i * 4, true)
      this.src.check(target, 4, 'table reference')
      out.push(target)
    }
    return out
  }
}

// ---- options ----

async function options(fb: FB, t: Table | null, fields: OptionField[]): Promise<Record<string, Value>> {
  const out: Record<string, Value> = {}
  if (!t) return out
  for (const [name, slot, kind, def] of fields) {
    if (!fb.has(t, slot)) {
      if (def !== null && def !== 0 && def !== false) out[name] = def
      continue
    }
    let v: Value
    if (kind === 'str') v = (await fb.string(t, slot)) ?? ''
    else if (kind.startsWith('[')) v = clip(await fb.numbers(t, slot, kind.slice(1, -1), 65))
    else v = await fb.scalar(t, slot, kind)
    if (kind === 'bool') v = !!v
    if (name === 'fused_activation_function' && typeof v === 'number') v = ACTIVATIONS[v] ?? v
    else if (name === 'padding' && typeof v === 'number') v = PADDINGS[v] ?? v
    out[name] = v
  }
  return out
}

// ---- reader ----

interface Sub {
  name: string
  tensors: { name: string; shape: number[]; dtype: DType; buffer: number; info?: TensorInfo; signature?: number[] }[]
  graph: Graph
  subRefs: Map<number, number[]>
}

export async function read(source: ByteSource): Promise<ModelIR> {
  const src = new Src(source, 'tflite')
  if (src.size < 8) throw bad('tflite-damaged', 'The TFLite file is empty or truncated.')
  const head = await src.bytes(0, 8)
  if (!detect(head)) throw bad('tflite-not-tflite', 'This is not a TensorFlow Lite model (no TFL3 identifier).')
  const fb = new FB(src)
  const model = await fb.table(await fb.num(0, 'u32'))
  const version = await fb.scalar(model, 0, 'u32')
  const description = await fb.string(model, 3)
  const notes: Note[] = []

  // operator codes
  const codes: { op: string; version: number; custom?: string }[] = []
  for (const p of await fb.tables(model, 1)) {
    const t = await fb.table(p)
    const deprecated = await fb.scalar(t, 0, 'i8')
    const builtin = await fb.scalar(t, 3, 'i32')
    const code = Math.max(deprecated, builtin)
    const custom = await fb.string(t, 1)
    const name = BUILTIN_OPS[code] || `BUILTIN_${code}`
    codes.push({ op: name === 'CUSTOM' && custom ? custom : name, version: await fb.scalar(t, 2, 'i32', 1), custom: name === 'CUSTOM' ? custom ?? '' : undefined })
  }

  // buffers: [offset, length] of the data, lazily read
  const buffers: { off: number; len: number }[] = []
  for (const p of await fb.tables(model, 4)) {
    const t = await fb.table(p)
    if (fb.has(t, 1) && fb.has(t, 2)) {
      const off = await fb.scalar(t, 1, 'u64')
      const len = await fb.scalar(t, 2, 'u64')
      buffers.push(off > 1 && off + len <= src.size ? { off, len } : { off: 0, len: 0 })
      if (off > 1 && off + len > src.size) notes.push(warn(`A buffer lies past the end of the file (${off}+${len}).`))
    } else {
      const [s, n] = await fb.vector(t, 0, 1)
      buffers.push({ off: s, len: n })
    }
  }

  // metadata
  const metadata: Record<string, Value> = { schema_version: version }
  if (description) metadata.description = description
  const metaEntries: Record<string, Value> = {}
  for (const p of await fb.tables(model, 6)) {
    const t = await fb.table(p)
    const name = (await fb.string(t, 0)) ?? ''
    const b = buffers[await fb.scalar(t, 1, 'u32')]
    let v: Value = b ? `${b.len} bytes` : 'missing buffer'
    if (b && b.len && b.len <= 256) {
      const bytes = await src.bytes(b.off, b.len)
      const s = text(bytes).replace(/\0+$/, '')
      if (/^[\x20-\x7e]*$/.test(s) && s.length) v = s
    }
    metaEntries[name] = v
  }
  if (Object.keys(metaEntries).length) metadata.metadata = metaEntries

  // subgraphs
  const subs: Sub[] = []
  const tensors: TensorInfo[] = []
  const names = new Set<string>()
  let sparse = 0
  const sgPtrs = await fb.tables(model, 2)
  if (!sgPtrs.length) throw bad('tflite-no-subgraph', 'The TFLite model has no subgraphs.')
  for (let si = 0; si < sgPtrs.length; si++) {
    const sg = await fb.table(sgPtrs[si])
    const sgName = (await fb.string(sg, 4)) || (si ? `subgraph_${si}` : 'main')
    const sub: Sub = { name: sgName, tensors: [], graph: { name: sgName, nodes: [], values: [], inputs: [], outputs: [] }, subRefs: new Map() }
    const tPtrs = await fb.tables(sg, 0)
    for (let ti = 0; ti < tPtrs.length; ti++) {
      await yieldEvery(ti, 1000)
      const t = await fb.table(tPtrs[ti])
      const shape = await fb.numbers(t, 0, 'i32', 64)
      const typeName = TENSOR_TYPES[await fb.scalar(t, 1, 'i8')] ?? 'UNKNOWN'
      const dtype = DTYPES[typeName] ?? typeName.toLowerCase()
      const buffer = await fb.scalar(t, 2, 'u32')
      const name = (await fb.string(t, 3)) ?? `tensor_${ti}`
      const signature = fb.has(t, 7) ? await fb.numbers(t, 7, 'i32', 64) : undefined
      const entry: Sub['tensors'][number] = { name, shape, dtype, buffer, signature }
      const b = buffers[buffer]
      if (buffer > 0 && b && b.len > 0) {
        let unique = name
        if (names.has(unique)) unique = `${sgName}/${name}`
        let k = 2
        while (names.has(unique)) unique = `${sgName}/${name}#${k++}`
        names.add(unique)
        const attrs: Record<string, Value> = { tensorIndex: ti, buffer, type: typeName }
        if (si) attrs.subgraph = sgName
        const info: TensorInfo = { name: unique, shape: shape.map((d) => Math.max(0, d)), dtype, byteLength: b.len, kind: 'constant', attrs, read: src.reader(b.off, b.len, name) }
        if (await fb.scalar(t, 5, 'bool')) attrs.variable = true
        const q = await fb.sub(t, 4)
        if (q) {
          const scale = await fb.numbers(q, 2, 'f32', 65)
          const zp = await fb.numbers(q, 3, 'i64', 65)
          const [, count] = await fb.vector(q, 2, 4)
          const min = await fb.numbers(q, 0, 'f32', 8)
          const max = await fb.numbers(q, 1, 'f32', 8)
          if (scale.length || zp.length) {
            info.quant = { scheme: 'affine', scale: scale.slice(0, 64), zeroPoint: zp.slice(0, 64), count }
            if (count > 1) info.quant.axis = await fb.scalar(q, 6, 'i32')
          }
          if (min.length) attrs.min = min
          if (max.length) attrs.max = max
          if (fb.has(q, 4)) attrs.quantDetails = await fb.scalar(q, 4, 'u8')
        }
        if (fb.has(t, 6)) {
          attrs.sparse = true
          sparse++
        }
        entry.info = info
        tensors.push(info)
      } else if (await fb.sub(t, 4)) {
        // activations carry quantization too: keep it on the graph value
        const q = (await fb.sub(t, 4))!
        const scale = await fb.numbers(q, 2, 'f32', 4)
        if (scale.length) (entry as { qscale?: number[] }).qscale = scale
      }
      sub.tensors.push(entry)
    }
    // value ids: tensor names, made unique per subgraph
    const ids: string[] = []
    const seen = new Set<string>()
    for (const [i, t] of sub.tensors.entries()) {
      let id = t.name
      if (seen.has(id)) id = `${t.name}#${i}`
      seen.add(id)
      ids.push(id)
    }
    const idOf = (i: number) => (i < 0 ? '' : ids[i] ?? `tensor_${i}`)
    const known = new Map<string, GraphValue>()
    sub.tensors.forEach((t, i) => {
      const v: GraphValue = { id: ids[i], dtype: t.dtype, shape: t.signature?.some((d) => d < 0) ? t.signature.map((d) => (d < 0 ? '?' : d)) : t.shape }
      if (t.info) v.tensor = t.info.name
      known.set(ids[i], v)
    })
    sub.graph.inputs = (await fb.numbers(sg, 1, 'i32')).map(idOf)
    sub.graph.outputs = (await fb.numbers(sg, 2, 'i32')).map(idOf)
    const opPtrs = await fb.tables(sg, 3)
    for (let oi = 0; oi < opPtrs.length; oi++) {
      await yieldEvery(oi, 1000)
      const o = await fb.table(opPtrs[oi])
      const ci = await fb.scalar(o, 0, 'u32')
      const code = codes[ci]
      if (!code) throw src.fail(`operator code index ${ci}`)
      const node: GraphNode = {
        id: `${code.op}_${oi}`,
        op: code.op,
        inputs: (await fb.numbers(o, 1, 'i32')).map(idOf),
        outputs: (await fb.numbers(o, 2, 'i32')).map(idOf)
      }
      const attrs: Record<string, Value> = {}
      if (code.version > 1) attrs.version = code.version
      const ut = await fb.scalar(o, 3, 'u8')
      const def = BUILTIN_OPTIONS[ut]
      if (def) Object.assign(attrs, await options(fb, await fb.sub(o, 4), def[1]))
      const ut2 = await fb.scalar(o, 11, 'u8')
      const def2 = BUILTIN_OPTIONS_2[ut2]
      if (def2) Object.assign(attrs, await options(fb, await fb.sub(o, 12), def2[1]))
      if (code.custom !== undefined) {
        const [, n] = await fb.vector(o, 5, 1)
        const large = await fb.scalar(o, 10, 'u64')
        attrs.custom_options = `${n || large} bytes`
      }
      const refs = Object.entries(attrs)
        .filter(([k, v]) => /subgraph_index$|_subgraph_indices$|^body_subgraph|^cond_subgraph/.test(k) && (typeof v === 'number' || Array.isArray(v)))
        .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
        .filter((v): v is number => typeof v === 'number')
      if (refs.length) sub.subRefs.set(sub.graph.nodes.length, refs)
      if (Object.keys(attrs).length) node.attrs = attrs
      const first = node.outputs[0]?.split(';')[0]
      if (first?.includes('/')) node.module = first.split('/').slice(0, -1).join('.')
      node.name = node.outputs[0] || undefined
      sub.graph.nodes.push(node)
    }
    sub.graph.values = graphValues(sub.graph.nodes, sub.graph.inputs, sub.graph.outputs, known)
    subs.push(sub)
  }

  // the main graph owns the others; control-flow nodes point at them
  const main = subs[0].graph
  if (subs.length > 1) {
    main.subgraphs = subs.slice(1).map((s) => s.graph)
    for (const [ni, refs] of subs[0].subRefs) main.nodes[ni].subgraphs = refs.filter((r) => r >= 1 && r < subs.length).map((r) => r - 1)
    for (const s of subs.slice(1))
      for (const [ni, refs] of s.subRefs) {
        const n = s.graph.nodes[ni]
        n.attrs = { ...n.attrs, subgraphs: refs.map((r) => subs[r]?.name ?? String(r)) }
      }
  }

  // signature defs
  const sigs: Value[] = []
  for (const p of await fb.tables(model, 7)) {
    const t = await fb.table(p)
    const si = await fb.scalar(t, 4, 'u32')
    const maps = async (slot: number) => {
      const out: Record<string, Value> = {}
      for (const mp of await fb.tables(t, slot)) {
        const m = await fb.table(mp)
        const ti = await fb.scalar(m, 1, 'u32')
        out[(await fb.string(m, 0)) ?? ''] = subs[si]?.tensors[ti]?.name ?? ti
      }
      return out
    }
    sigs.push({ key: (await fb.string(t, 2)) ?? '', subgraph: subs[si]?.name ?? si, inputs: await maps(0), outputs: await maps(1) })
  }
  if (sigs.length) metadata.signatures = sigs
  metadata.subgraphs = subs.map((s) => `${s.name}: ${s.graph.nodes.length} ops, ${s.tensors.length} tensors`)
  metadata.operator_codes = codes.map((c) => (c.version > 1 ? `${c.op} v${c.version}` : c.op))

  const quantized = tensors.filter((t) => t.quant).length
  const int8 = tensors.some((t) => t.dtype === 'i8' && t.quant)
  if (sparse) notes.push(note(`${sparse} sparse tensor(s): values are stored in a compressed sparse layout and shown as stored.`))
  if (quantized) notes.push(note(`${quantized} quantized constant tensor(s); values are the stored integers (real = (q − zero_point) × scale).`, `양자화된 상수 텐서 ${quantized}개: 저장된 정수값이며 실수 = (q − zero_point) × scale 입니다.`))
  const modules = moduleTree(tensors.map((t) => ({ name: t.name.split(';')[0] })), { sep: '/', rootName: subs[0].name })
  return {
    format: 'tflite',
    formatLabel: `TensorFlow Lite · schema v${version}${int8 ? ' · int8' : ''}${subs.length > 1 ? ` · ${subs.length} subgraphs` : ''}`,
    framework: 'tensorflow',
    producer: typeof metaEntries.min_runtime_version === 'string' ? `min runtime ${metaEntries.min_runtime_version}` : undefined,
    metadata,
    tensors,
    modules: modules.children.length || modules.tensors.length ? fixTree(modules, tensors) : undefined,
    graph: main,
    notes
  }
}

/** moduleTree was built from the part of each name before ';': point the leaves at the real names. */
function fixTree(root: ReturnType<typeof moduleTree>, tensors: TensorInfo[]): ReturnType<typeof moduleTree> {
  const byShort = new Map<string, string[]>()
  for (const t of tensors) {
    const k = t.name.split(';')[0]
    byShort.set(k, [...(byShort.get(k) ?? []), t.name])
  }
  const walk = (n: ReturnType<typeof moduleTree>) => {
    n.tensors = n.tensors.flatMap((short) => {
      const hit = byShort.get(short) ?? []
      byShort.delete(short)
      return hit
    })
    n.children.forEach(walk)
  }
  walk(root)
  return root
}
