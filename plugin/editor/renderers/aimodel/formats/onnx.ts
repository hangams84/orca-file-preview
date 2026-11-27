/** ONNX ModelProto, read with the hand-written protobuf reader (no codegen, nothing evaluated):
 *  graph nodes with every attribute type, initializers (raw_data and the typed fields, external data
 *  references), sparse initializers, value_info shapes, opset imports, metadata_props, If/Loop/Scan
 *  subgraphs (any depth) and local functions. Initializer values are never loaded up front: each
 *  TensorInfo.read reads its own byte range of the file. */
import type { ByteSource, DType, Graph, GraphNode, GraphValue, ModelIR, Note, TensorInfo, Value } from '../ir.ts'
import { bad, byteLen, DTYPE_SIZE, graphValues, MAX_DEPTH, note, product, Src, warn, yieldEvery } from './common.ts'
import { I32, I64, LEN, Pb, VARINT } from './protobuf.ts'

/** TensorProto.DataType → canonical dtype. */
export const ONNX_DTYPES: Record<number, DType> = {
  1: 'f32', 2: 'u8', 3: 'i8', 4: 'u16', 5: 'i16', 6: 'i32', 7: 'i64', 8: 'str', 9: 'bool', 10: 'f16', 11: 'f64',
  12: 'u32', 13: 'u64', 14: 'c64', 15: 'c128', 16: 'bf16', 17: 'f8e4m3', 18: 'f8e4m3fnuz', 19: 'f8e5m2', 20: 'f8e5m2fnuz',
  21: 'u4', 22: 'i4', 23: 'f4e2m1', 24: 'f8e8m0', 25: 'u2', 26: 'i2'
}
const SUB_BYTE: Record<string, number> = { u4: 0.5, i4: 0.5, f4e2m1: 0.5, u2: 0.25, i2: 0.25, f8e4m3fnuz: 1, f8e5m2fnuz: 1, f8e8m0: 1 }

const ATTR_TYPES = ['UNDEFINED', 'FLOAT', 'INT', 'STRING', 'TENSOR', 'GRAPH', 'FLOATS', 'INTS', 'STRINGS', 'TENSORS', 'GRAPHS', 'SPARSE_TENSOR', 'SPARSE_TENSORS', 'TYPE_PROTO', 'TYPE_PROTOS']

export function detect(head: Uint8Array): boolean {
  // Serializers write fields in number order: ir_version (field 1, varint) comes first.
  if (head.length < 4 || head[0] !== 0x08 || head[1] < 1 || head[1] > 20) return false
  return [0x12, 0x1a, 0x22, 0x28, 0x32, 0x3a, 0x42, 0x72, 0xca].includes(head[2])
}

// ---- intermediate structures ----

interface Region {
  start: number
  end: number
}

interface RawTensor {
  name: string
  dims: number[]
  dataType: number
  docString?: string
  raw?: Region
  /** Packed or repeated typed fields: field number → regions (packed) or values (unpacked). */
  typed: Map<number, { regions: Region[]; values: (number | bigint)[] }>
  strings: string[]
  external: Record<string, string>
  location: number
}

interface Ctx {
  pb: Pb
  src: Src
  tensors: TensorInfo[]
  names: Set<string>
  notes: Note[]
  nodes: number
}

function region(map: RawTensor['typed'], field: number) {
  let e = map.get(field)
  if (!e) map.set(field, (e = { regions: [], values: [] }))
  return e
}

async function readTensor(c: Ctx, end: number): Promise<RawTensor> {
  const { pb } = c
  const t: RawTensor = { name: '', dims: [], dataType: 0, typed: new Map(), strings: [], external: {}, location: 0 }
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    switch (f) {
      case 1:
        for (const d of await pb.packed(w, end, (e) => pb.int64(e))) t.dims.push(Number(d))
        break
      case 2:
        t.dataType = await pb.int32(end)
        break
      case 8:
        t.name = await pb.string(end)
        break
      case 12:
        t.docString = await pb.string(end)
        break
      case 9: {
        const [s, e] = await pb.len(end)
        t.raw = { start: s, end: e }
        pb.seek(e)
        break
      }
      case 4:
      case 5:
      case 7:
      case 10:
      case 11: {
        const r = region(t.typed, f)
        if (w === LEN) {
          const [s, e] = await pb.len(end)
          r.regions.push({ start: s, end: e })
          pb.seek(e)
        } else if (w === I32) r.values.push(await pb.f32())
        else if (w === I64) r.values.push(await pb.f64())
        else r.values.push(await pb.int64(end))
        break
      }
      case 6:
        if (t.strings.length < 64) t.strings.push(await pb.string(end))
        else await pb.skip(w, end)
        break
      case 13: {
        const [, e] = await pb.len(end)
        let k = ''
        let v = ''
        while (pb.pos < e) {
          const [ff, ww] = await pb.tag(e)
          if (ff === 1 && ww === LEN) k = await pb.string(e)
          else if (ff === 2 && ww === LEN) v = await pb.string(e)
          else await pb.skip(ww, e)
        }
        t.external[k] = v
        break
      }
      case 14:
        t.location = await pb.int32(end)
        break
      default:
        await pb.skip(w, end)
    }
  }
  return t
}

/** Varint decoder over loaded bytes (typed int fields). */
function varints(b: Uint8Array): bigint[] {
  const out: bigint[] = []
  let v = 0n
  let shift = 0n
  for (const x of b) {
    v |= BigInt(x & 0x7f) << shift
    if (x & 0x80) shift += 7n
    else {
      out.push(v)
      v = 0n
      shift = 0n
    }
  }
  return out
}

/** Encodes integer values as little-endian elements of `dtype`. */
function encodeInts(vals: (number | bigint)[], dtype: string): Uint8Array {
  const size = DTYPE_SIZE[dtype] ?? 1
  const out = new Uint8Array(vals.length * size)
  const v = new DataView(out.buffer)
  vals.forEach((x, i) => {
    const b = BigInt.asUintN(64, BigInt(x))
    if (size === 8) v.setBigUint64(i * 8, b, true)
    else if (size === 4) v.setUint32(i * 4, Number(b & 0xffffffffn), true)
    else if (size === 2) v.setUint16(i * 2, Number(b & 0xffffn), true)
    else out[i] = Number(b & 0xffn)
  })
  return out
}

/** Turns a parsed TensorProto into a TensorInfo whose read() serves little-endian elements. */
function tensorInfo(c: Ctx, t: RawTensor, kind: TensorInfo['kind'], fallbackName: string): TensorInfo {
  const dtype = ONNX_DTYPES[t.dataType] ?? `onnx-type-${t.dataType}`
  let name = t.name || fallbackName
  if (c.names.has(name)) {
    let k = 2
    while (c.names.has(`${name}#${k}`)) k++
    name = `${name}#${k}`
  }
  c.names.add(name)
  const n = product(t.dims)
  const plain = byteLen(t.dims, dtype) || Math.ceil(n * (SUB_BYTE[dtype] ?? 0))
  const info: TensorInfo = { name, shape: t.dims, dtype, byteLength: 0, kind }
  const attrs: Record<string, Value> = {}
  if (t.docString) attrs.doc = t.docString
  if (t.location === 1 || Object.keys(t.external).length) {
    const off = Number(t.external.offset ?? 0)
    const len = t.external.length !== undefined ? Number(t.external.length) : plain
    attrs.external = { location: t.external.location ?? '', offset: off, length: len }
    info.byteLength = len
    info.attrs = attrs
    c.tensors.push(info)
    return info
  }
  if (t.raw) {
    info.byteLength = t.raw.end - t.raw.start
    info.read = c.src.reader(t.raw.start, info.byteLength, name)
  } else if (dtype === 'str') {
    attrs.values = t.strings.slice(0, 16)
    info.byteLength = 0
  } else {
    // Typed fields: float_data(4) int32_data(5) int64_data(7) double_data(10) uint64_data(11).
    const field = [4, 5, 7, 10, 11].find((f) => t.typed.has(f))
    if (field !== undefined) {
      const { regions, values } = t.typed.get(field)!
      const fixed = field === 4 || field === 10 // packed fixed-width floats are already the LE element bytes
      info.byteLength = plain
      const src = c.src
      for (const r of regions) src.check(r.start, r.end - r.start, name)
      info.read = async (range) => {
        let bytes: Uint8Array
        if (fixed) {
          const parts = await Promise.all(regions.map((r) => src.raw(r.start, r.end - r.start)))
          const extra = values.length ? new Uint8Array(new (field === 4 ? Float32Array : Float64Array)(values.map(Number)).buffer) : new Uint8Array(0)
          bytes = new Uint8Array(parts.reduce((s, p) => s + p.length, 0) + extra.length)
          let p = 0
          for (const x of [...parts, extra]) bytes.set(x, p), (p += x.length)
        } else {
          const all: (number | bigint)[] = [...values]
          for (const r of regions) all.push(...varints(await src.raw(r.start, r.end - r.start)))
          const target = SUB_BYTE[dtype] ? 'u8' : dtype
          bytes = encodeInts(all, target)
        }
        if (!range) return bytes
        const s = Math.max(0, range.offset)
        return bytes.subarray(s, s + Math.max(0, range.length))
      }
    } else if (n > 0) {
      attrs.note = 'no data stored'
    }
  }
  if (Object.keys(attrs).length) info.attrs = attrs
  c.tensors.push(info)
  return info
}

/** Short JSON form of a tensor for attribute displays. */
async function tensorValue(c: Ctx, info: TensorInfo): Promise<Value> {
  const v: Record<string, Value> = { tensor: info.name, dtype: info.dtype, shape: info.shape }
  const n = product(info.shape)
  const size = DTYPE_SIZE[info.dtype]
  if (info.read && size && n <= 16 && info.byteLength <= 256) {
    const b = await info.read()
    v.values = decodeSmall(b, info.dtype)
  } else if (info.attrs?.values) v.values = info.attrs.values
  return v
}

function decodeSmall(b: Uint8Array, dtype: string): Value[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const size = DTYPE_SIZE[dtype]
  const out: Value[] = []
  for (let o = 0; o + size <= b.length; o += size) {
    switch (dtype) {
      case 'f32': out.push(d.getFloat32(o, true)); break
      case 'f64': out.push(d.getFloat64(o, true)); break
      case 'i64': { const x = d.getBigInt64(o, true); out.push(x >= -(2n ** 53n) && x <= 2n ** 53n ? Number(x) : x); break }
      case 'u64': out.push(d.getBigUint64(o, true)); break
      case 'i32': out.push(d.getInt32(o, true)); break
      case 'u32': out.push(d.getUint32(o, true)); break
      case 'i16': out.push(d.getInt16(o, true)); break
      case 'u16': out.push(d.getUint16(o, true)); break
      case 'i8': out.push(d.getInt8(o)); break
      case 'bool': out.push(d.getUint8(o) !== 0); break
      case 'f16': {
        const h = d.getUint16(o, true)
        const e = (h >> 10) & 31
        const m = h & 1023
        const s = h & 0x8000 ? -1 : 1
        out.push(e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15))
        break
      }
      default: out.push(d.getUint8(o))
    }
  }
  return out
}

// ---- TypeProto ----

async function readType(c: Ctx, end: number, depth: number): Promise<{ dtype?: DType; shape?: (number | string)[]; text: string }> {
  if (depth > MAX_DEPTH) throw bad('onnx-too-deep', 'The ONNX type nesting is too deep.')
  const { pb } = c
  let out: { dtype?: DType; shape?: (number | string)[]; text: string } = { text: '?' }
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    if (w !== LEN && f !== 6) {
      await pb.skip(w, end)
      continue
    }
    if (f === 1 || f === 8) {
      // tensor_type / sparse_tensor_type: elem_type(1), shape(2)
      const [, e] = await pb.len(end)
      let elem = 0
      let shape: (number | string)[] | undefined
      while (pb.pos < e) {
        const [ff, ww] = await pb.tag(e)
        if (ff === 1 && ww === VARINT) elem = await pb.int32(e)
        else if (ff === 2 && ww === LEN) {
          shape = []
          const [, se] = await pb.len(e)
          while (pb.pos < se) {
            const [df, dw] = await pb.tag(se)
            if (df !== 1 || dw !== LEN) {
              await pb.skip(dw, se)
              continue
            }
            const [, de] = await pb.len(se)
            let dim: number | string = '?'
            while (pb.pos < de) {
              const [xf, xw] = await pb.tag(de)
              if (xf === 1 && xw === VARINT) dim = Number(await pb.int64(de))
              else if (xf === 2 && xw === LEN) dim = await pb.string(de)
              else await pb.skip(xw, de)
            }
            shape.push(dim)
          }
        } else await pb.skip(ww, e)
      }
      const dtype = ONNX_DTYPES[elem] ?? (elem ? `onnx-type-${elem}` : undefined)
      const kind = f === 8 ? 'sparse_tensor' : 'tensor'
      out = { dtype, shape, text: `${kind}(${dtype ?? '?'}${shape ? `, [${shape.join(', ')}]` : ''})` }
    } else if (f === 4 || f === 9) {
      // sequence_type / optional_type: elem_type(1)
      const [, e] = await pb.len(end)
      let inner = '?'
      while (pb.pos < e) {
        const [ff, ww] = await pb.tag(e)
        if (ff === 1 && ww === LEN) {
          const [, ie] = await pb.len(e)
          inner = (await readType(c, ie, depth + 1)).text
        } else await pb.skip(ww, e)
      }
      out = { text: `${f === 4 ? 'sequence' : 'optional'}(${inner})` }
    } else if (f === 5) {
      const [, e] = await pb.len(end)
      let key = 0
      let val = '?'
      while (pb.pos < e) {
        const [ff, ww] = await pb.tag(e)
        if (ff === 1 && ww === VARINT) key = await pb.int32(e)
        else if (ff === 2 && ww === LEN) {
          const [, ie] = await pb.len(e)
          val = (await readType(c, ie, depth + 1)).text
        } else await pb.skip(ww, e)
      }
      out = { text: `map(${ONNX_DTYPES[key] ?? key}, ${val})` }
    } else await pb.skip(w, end)
  }
  return out
}

async function readValueInfo(c: Ctx, end: number): Promise<GraphValue & { typeText?: string }> {
  const { pb } = c
  const v: GraphValue & { typeText?: string } = { id: '' }
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    if (f === 1 && w === LEN) v.id = await pb.string(end)
    else if (f === 2 && w === LEN) {
      const [, e] = await pb.len(end)
      const t = await readType(c, e, 0)
      if (t.dtype) v.dtype = t.dtype
      if (t.shape) v.shape = t.shape
      v.typeText = t.text
    } else await pb.skip(w, end)
  }
  return v
}

// ---- attributes, nodes, graphs ----

interface Owner {
  subgraphs: Graph[]
}

async function readAttr(c: Ctx, end: number, owner: Owner, own: number[], depth: number, nodeName: string): Promise<[string, Value]> {
  const { pb } = c
  let name = ''
  let type = 0
  let ref = ''
  const vals: Partial<Record<string, Value>> = {}
  const list: Record<string, Value[]> = { floats: [], ints: [], strings: [], tensors: [], graphs: [], sparse: [], types: [] }
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    switch (f) {
      case 1:
        name = await pb.string(end)
        break
      case 20:
        type = await pb.int32(end)
        break
      case 21:
        ref = await pb.string(end)
        break
      case 2:
        vals.f = w === I32 ? await pb.f32() : (await pb.skip(w, end), null)
        break
      case 3:
        vals.i = await pb.int64(end)
        break
      case 4:
        vals.s = await pb.string(end)
        break
      case 5:
      case 10:
      case 22:
      case 23: {
        const [, e] = await pb.len(end)
        let info: TensorInfo
        let value: Value
        if (f === 22 || f === 23) value = await readSparse(c, e, `${nodeName}.${name || 'sparse'}`)
        else {
          info = tensorInfo(c, await readTensor(c, e), 'constant', `${nodeName}.${name || 'value'}`)
          value = await tensorValue(c, info)
        }
        if (f === 5) vals.t = value
        else if (f === 22) vals.sparse = value
        else (f === 10 ? list.tensors : list.sparse).push(value)
        break
      }
      case 6:
      case 11: {
        const [, e] = await pb.len(end)
        const g = await readGraph(c, e, depth + 1, `${nodeName}.${name}`)
        const idx = owner.subgraphs.push(g) - 1
        own.push(idx)
        if (f === 6) vals.g = { graph: idx, name: g.name ?? '' }
        else list.graphs.push({ graph: idx, name: g.name ?? '' })
        break
      }
      case 14:
      case 15: {
        const [, e] = await pb.len(end)
        const t = (await readType(c, e, 0)).text
        if (f === 14) vals.tp = t
        else list.types.push(t)
        break
      }
      case 7:
        list.floats.push(...(await pb.packed(w, end, async () => (w === I32 || w === LEN ? pb.f32() : 0))))
        break
      case 8:
        list.ints.push(...(await pb.packed(w, end, (e) => pb.int64(e))))
        break
      case 9:
        list.strings.push(await pb.string(end))
        break
      default:
        await pb.skip(w, end)
    }
  }
  if (ref) return [name, { ref }]
  const kind = ATTR_TYPES[type] ?? ''
  const pick: Record<string, Value | undefined> = {
    FLOAT: vals.f, INT: vals.i, STRING: vals.s, TENSOR: vals.t, GRAPH: vals.g, SPARSE_TENSOR: vals.sparse, TYPE_PROTO: vals.tp,
    FLOATS: list.floats, INTS: list.ints, STRINGS: list.strings, TENSORS: list.tensors, GRAPHS: list.graphs, SPARSE_TENSORS: list.sparse, TYPE_PROTOS: list.types
  }
  let v = pick[kind]
  if (v === undefined) {
    // IR < 3 files may omit `type`: take whichever field is present.
    v = vals.f ?? vals.i ?? vals.s ?? vals.t ?? vals.g ?? vals.sparse ?? vals.tp ?? Object.values(list).find((x) => x.length) ?? null
  }
  if (Array.isArray(v) && v.length > 64) v = [...v.slice(0, 64), `… (${v.length} items)`]
  return [name, v as Value]
}

async function readSparse(c: Ctx, end: number, fallback: string): Promise<Value> {
  const { pb } = c
  const out: Record<string, Value> = { sparse: true }
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    if ((f === 1 || f === 2) && w === LEN) {
      const [, e] = await pb.len(end)
      const info = tensorInfo(c, await readTensor(c, e), 'constant', `${fallback}.${f === 1 ? 'values' : 'indices'}`)
      out[f === 1 ? 'values' : 'indices'] = await tensorValue(c, info)
    } else if (f === 3) out.dims = (await pb.packed(w, end, (e) => pb.int64(e))).map(Number)
    else await pb.skip(w, end)
  }
  return out
}

async function readNode(c: Ctx, end: number, owner: Owner, depth: number, index: number): Promise<GraphNode> {
  const { pb } = c
  const node: GraphNode = { id: '', op: '', inputs: [], outputs: [] }
  const attrs: Record<string, Value> = {}
  const attrRanges: [number, number][] = []
  const own: number[] = []
  let doc = ''
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    switch (f) {
      case 1:
        node.inputs.push(await pb.string(end))
        break
      case 2:
        node.outputs.push(await pb.string(end))
        break
      case 3:
        node.name = await pb.string(end)
        break
      case 4:
        node.op = await pb.string(end)
        break
      case 7:
        node.domain = await pb.string(end)
        break
      case 6:
        doc = await pb.string(end)
        break
      case 5: {
        // attributes come after the name in practice, but not necessarily: read them last
        const [s, e] = await pb.len(end)
        attrRanges.push([s, e])
        pb.seek(e)
        break
      }
      default:
        await pb.skip(w, end)
    }
  }
  const after = pb.pos
  const label = node.name || `${node.op}_${index}`
  for (const [s, e] of attrRanges) {
    pb.seek(s)
    const [k, v] = await readAttr(c, e, owner, own, depth, label)
    attrs[k] = v
  }
  pb.seek(after)
  if (doc) attrs.doc_string = doc
  if (Object.keys(attrs).length) node.attrs = attrs
  if (own.length) node.subgraphs = own
  if (!node.domain) delete node.domain
  // torch.onnx names nodes /layer1/layer1.0/conv1/Conv: the module path is the middle part.
  if (node.name?.startsWith('/')) {
    const parts = node.name.split('/').filter(Boolean)
    if (parts.length > 1) node.module = parts[parts.length - 2]
  }
  c.nodes++
  return node
}

async function readGraph(c: Ctx, end: number, depth: number, fallbackName: string): Promise<Graph> {
  if (depth > MAX_DEPTH) throw bad('onnx-too-deep', 'The ONNX subgraphs are nested too deeply.')
  const { pb } = c
  const g: Graph = { name: '', nodes: [], values: [], inputs: [], outputs: [], subgraphs: [] }
  const known = new Map<string, GraphValue>()
  const nodeRanges: [number, number][] = []
  const valueInfo: GraphValue[] = []
  const inits: TensorInfo[] = []
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    switch (f) {
      case 1: {
        const [s, e] = await pb.len(end)
        nodeRanges.push([s, e])
        pb.seek(e)
        break
      }
      case 2:
        g.name = await pb.string(end)
        break
      case 5: {
        const [, e] = await pb.len(end)
        inits.push(tensorInfo(c, await readTensor(c, e), 'initializer', `${fallbackName}.initializer${inits.length}`))
        await yieldEvery(inits.length, 500)
        break
      }
      case 15: {
        const [, e] = await pb.len(end)
        const v = await readSparse(c, e, `${fallbackName}.sparse${inits.length}`)
        c.notes.push(note(`Sparse initializer ${JSON.stringify((v as Record<string, Value>).values ?? '')}`.slice(0, 160)))
        break
      }
      case 11:
      case 12:
      case 13: {
        const [, e] = await pb.len(end)
        const v = await readValueInfo(c, e)
        const { typeText, ...gv } = v
        known.set(gv.id, { ...known.get(gv.id), ...gv })
        if (f === 11) g.inputs.push(gv.id)
        else if (f === 12) g.outputs.push(gv.id)
        else valueInfo.push(gv)
        void typeText
        break
      }
      default:
        await pb.skip(w, end)
    }
  }
  const after = pb.pos
  for (const [s, e] of nodeRanges) {
    await yieldEvery(c.nodes, 1000)
    pb.seek(s)
    g.nodes.push(await readNode(c, e, g as Owner, depth, g.nodes.length))
  }
  pb.seek(after)
  // ids: unique per graph
  const ids = new Set<string>()
  g.nodes.forEach((n, i) => {
    let id = n.name || `${n.op}_${i}`
    while (ids.has(id)) id = `${id}_${i}`
    ids.add(id)
    n.id = id
  })
  for (const t of inits) {
    const id = t.name.replace(/#\d+$/, '')
    known.set(id, { ...known.get(id), id, shape: t.shape, dtype: t.dtype, tensor: t.name })
  }
  // Constant nodes: their output is the stored tensor.
  for (const n of g.nodes) {
    const v = n.op === 'Constant' && n.attrs?.value
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.tensor === 'string' && n.outputs[0]) {
      known.set(n.outputs[0], { ...known.get(n.outputs[0]), id: n.outputs[0], tensor: v.tensor, dtype: v.dtype as string, shape: v.shape as number[] })
    }
  }
  // Inputs that are initializers (IR < 4) are weights, not model inputs.
  const initIds = new Set(inits.map((t) => t.name.replace(/#\d+$/, '')))
  g.inputs = g.inputs.filter((i) => !initIds.has(i))
  g.values = graphValues(g.nodes, g.inputs, g.outputs, known)
  for (const v of valueInfo) if (!g.values.some((x) => x.id === v.id)) g.values.push(v)
  if (!g.subgraphs!.length) delete g.subgraphs
  if (!g.name) g.name = fallbackName
  return g
}

async function readFunction(c: Ctx, end: number): Promise<{ graph: Graph; domain: string; name: string }> {
  const { pb } = c
  const g: Graph = { name: '', nodes: [], values: [], inputs: [], outputs: [], subgraphs: [] }
  let domain = ''
  const nodeRanges: [number, number][] = []
  const attrs: string[] = []
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    if (f === 1 && w === LEN) g.name = await pb.string(end)
    else if (f === 4 && w === LEN) g.inputs.push(await pb.string(end))
    else if (f === 5 && w === LEN) g.outputs.push(await pb.string(end))
    else if (f === 6 && w === LEN) attrs.push(await pb.string(end))
    else if (f === 10 && w === LEN) domain = await pb.string(end)
    else if (f === 7 && w === LEN) {
      const [s, e] = await pb.len(end)
      nodeRanges.push([s, e])
      pb.seek(e)
    } else await pb.skip(w, end)
  }
  const after = pb.pos
  for (const [s, e] of nodeRanges) {
    pb.seek(s)
    g.nodes.push(await readNode(c, e, g as Owner, 1, g.nodes.length))
  }
  pb.seek(after)
  g.nodes.forEach((n, i) => (n.id = n.name || `${n.op}_${i}`))
  g.values = graphValues(g.nodes, g.inputs, g.outputs, new Map())
  if (!g.subgraphs!.length) delete g.subgraphs
  const name = g.name ?? ''
  g.name = `function ${domain ? `${domain}::` : ''}${name}${attrs.length ? ` (attrs: ${attrs.join(', ')})` : ''}`
  return { graph: g, domain, name }
}

export async function read(source: ByteSource): Promise<ModelIR> {
  const src = new Src(source, 'onnx')
  if (src.size < 2) throw bad('onnx-damaged', 'The ONNX file is empty or truncated.')
  const pb = new Pb(src, 0)
  const c: Ctx = { pb, src, tensors: [], names: new Set(), notes: [], nodes: 0 }
  const end = src.size
  const meta: Record<string, Value> = {}
  const props: Record<string, Value> = {}
  const opsets: Record<string, number> = {}
  let graphRange: [number, number] | null = null
  const fnRanges: [number, number][] = []
  let training = 0
  let ir = 0
  let producer = ''
  let producerVersion = ''
  while (pb.pos < end) {
    const [f, w] = await pb.tag(end)
    switch (f) {
      case 1:
        ir = Number(await pb.int64(end))
        break
      case 2:
        producer = await pb.string(end)
        break
      case 3:
        producerVersion = await pb.string(end)
        break
      case 4:
        meta.domain = await pb.string(end)
        break
      case 5:
        meta.model_version = await pb.int64(end)
        break
      case 6:
        meta.doc_string = await pb.string(end)
        break
      case 7: {
        graphRange = await pb.len(end)
        pb.seek(graphRange[1])
        break
      }
      case 8:
      case 14: {
        const [, e] = await pb.len(end)
        let k = ''
        let v: string | number = ''
        while (pb.pos < e) {
          const [ff, ww] = await pb.tag(e)
          if (ff === 1 && ww === LEN) k = await pb.string(e)
          else if (ff === 2 && ww === LEN) v = await pb.string(e)
          else if (ff === 2 && ww === VARINT) v = Number(await pb.int64(e))
          else await pb.skip(ww, e)
        }
        if (f === 8) opsets[k || 'ai.onnx'] = Number(v)
        else props[k] = v
        break
      }
      case 20:
        training++
        await pb.skip(w, end)
        break
      case 25: {
        const r = await pb.len(end)
        fnRanges.push(r)
        pb.seek(r[1])
        break
      }
      default:
        await pb.skip(w, end)
    }
  }
  if (!graphRange) throw bad('onnx-no-graph', 'This file has no ONNX graph (not an ONNX model?).')
  pb.seek(graphRange[0])
  const graph = await readGraph(c, graphRange[1], 0, 'main')
  // Local functions: extra subgraphs; nodes that call them point at them.
  if (fnRanges.length) {
    graph.subgraphs ??= []
    const fnIndex = new Map<string, number>()
    for (const [s, e] of fnRanges) {
      pb.seek(s)
      const fn = await readFunction(c, e)
      fnIndex.set(`${fn.domain}::${fn.name}`, graph.subgraphs.push(fn.graph) - 1)
    }
    for (const n of graph.nodes) {
      const i = fnIndex.get(`${n.domain ?? ''}::${n.op}`)
      if (i !== undefined) n.subgraphs = [...(n.subgraphs ?? []), i]
    }
  }
  if (training) c.notes.push(note(`${training} training_info block(s) are not shown.`))
  const external = c.tensors.filter((t) => t.attrs?.external)
  if (external.length) {
    const files = [...new Set(external.map((t) => (t.attrs!.external as Record<string, Value>).location))]
    c.notes.push(warn(`${external.length} initializer(s) keep their values in external file(s): ${files.join(', ')}. Shapes are shown; values are not read.`, `초기값 ${external.length}개의 값은 외부 파일(${files.join(', ')})에 있어 읽지 않습니다.`))
  }
  const opset = opsets['ai.onnx'] ?? opsets['']
  const metadata: Record<string, Value> = { ir_version: ir, opset_import: opsets, ...meta, ...props }
  if (Object.keys(props).length) metadata.metadata_props = props
  return {
    format: 'onnx',
    formatLabel: `ONNX${opset !== undefined ? ` · opset ${opset}` : ''} · IR ${ir}`,
    framework: 'onnx',
    producer: producer ? `${producer}${producerVersion ? ` ${producerVersion}` : ''}` : undefined,
    metadata,
    tensors: c.tensors,
    graph,
    notes: c.notes
  }
}

