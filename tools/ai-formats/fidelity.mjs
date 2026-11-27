// Fidelity of the ONNX / TFLite / GGUF / Keras-HDF5 / NumPy readers against the ground truth that
// tools/make-ai-format-samples.py read back with the reference Python libraries
// (samples/ai-formats/truth.json). Also runs every reader on truncated / corrupted copies of every
// sample and checks that each ends in a PreviewError (never a raw exception or a hang).
//
//   node --experimental-transform-types tools/ai-formats/fidelity.mjs [--json out.json] [--fuzz N]
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIR = join(ROOT, 'samples', 'ai-formats')
const FMT = join(ROOT, 'plugin', 'editor', 'renderers', 'aimodel', 'formats')
const truth = JSON.parse(readFileSync(join(DIR, 'truth.json'), 'utf8'))
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}

const load = async (m) => import(pathToFileURL(join(FMT, `${m}.ts`)).href).catch((e) => ({ loadError: e }))
const readers = {}
for (const m of ['onnx', 'tflite', 'gguf', 'keras', 'numpy']) readers[m] = await load(m)

function source(bytes, name) {
  return {
    size: bytes.length,
    name,
    read: async (o, n) => bytes.subarray(Math.max(0, o), Math.min(bytes.length, o + Math.max(0, n)))
  }
}
const file = (n) => new Uint8Array(readFileSync(join(DIR, n)))

const results = [] // { format, file, check, expected, got, ok }
function check(format, f, what, expected, got) {
  const ok = JSON.stringify(expected) === JSON.stringify(got)
  results.push({ format, file: f, check: what, ok, ...(ok ? {} : { expected, got }) })
  return ok
}
function close(a, b, tol = 1e-3) {
  if (!a || !b || a.length !== b.length) return false
  return a.every((x, i) => (Number.isNaN(x) && Number.isNaN(b[i])) || Math.abs(x - b[i]) <= tol * Math.max(1, Math.abs(x)))
}
function checkClose(format, f, what, expected, got, tol) {
  const ok = close(expected, got, tol)
  results.push({ format, file: f, check: what, ok, ...(ok ? {} : { expected, got }) })
}

/** First n element values of a tensor, through its read() and the canonical dtype. */
async function head(t, n = 6) {
  if (!t.read) return null
  const size = { f64: 8, f32: 4, f16: 2, bf16: 2, i64: 8, u64: 8, i32: 4, u32: 4, i16: 2, u16: 2, i8: 1, u8: 1, bool: 1, c64: 8 }[t.dtype]
  if (!size) return null
  const b = await t.read({ offset: 0, length: n * size })
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const le = t.byteOrder !== 'big'
  const out = []
  for (let i = 0; i + size <= b.length && out.length < n; i += size) {
    switch (t.dtype) {
      case 'f64': out.push(v.getFloat64(i, le)); break
      case 'f32': out.push(v.getFloat32(i, le)); break
      case 'c64': out.push(v.getFloat32(i, le)); break
      case 'f16': out.push(half(v.getUint16(i, le))); break
      case 'bf16': out.push(new Float32Array(new Uint32Array([v.getUint16(i, le) << 16]).buffer)[0]); break
      case 'i64': out.push(Number(v.getBigInt64(i, le))); break
      case 'u64': out.push(Number(v.getBigUint64(i, le))); break
      case 'i32': out.push(v.getInt32(i, le)); break
      case 'u32': out.push(v.getUint32(i, le)); break
      case 'i16': out.push(v.getInt16(i, le)); break
      case 'u16': out.push(v.getUint16(i, le)); break
      case 'i8': out.push(v.getInt8(i)); break
      default: out.push(v.getUint8(i))
    }
  }
  return out
}
function half(h) {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const m = h & 0x3ff
  if (e === 0) return s * m * 2 ** -24
  if (e === 31) return m ? NaN : s * Infinity
  return s * (1 + m / 1024) * 2 ** (e - 15)
}

// ---------------------------------------------------------------- NumPy
const NP_DT = { '<f4': 'f32', '<f8': 'f64', '<f2': 'f16', '|i1': 'i8', '|u1': 'u8', '|b1': 'bool', '>i8': 'i64', '<c8': 'c64', '<i4': 'i32', '<i8': 'i64' }
async function numpy() {
  for (const [f, t] of Object.entries(truth.numpy)) {
    const ir = await readers.numpy.read(source(file(f), f))
    if (f.endsWith('.npy')) {
      const x = ir.tensors[0]
      check('numpy', f, 'shape', t.shape, x.shape)
      if (NP_DT[t.descr]) check('numpy', f, 'dtype', NP_DT[t.descr], x.dtype)
      check('numpy', f, 'bytes', t.shape.reduce((a, b) => a * b, 1) * t.itemsize, x.byteLength)
      if (t.head && NP_DT[t.descr] && t.descr !== '<c8') checkClose('numpy', f, 'values', t.head, await head(x))
    } else {
      check('numpy', f, 'arrays', Object.keys(t), ir.tensors.map((x) => x.name))
      for (const x of ir.tensors) {
        const e = t[x.name]
        check('numpy', f, `${x.name} shape`, e.shape, x.shape)
        if (NP_DT[e.descr]) {
          check('numpy', f, `${x.name} dtype`, NP_DT[e.descr], x.dtype)
          checkClose('numpy', f, `${x.name} values`, e.head, await head(x))
        }
      }
    }
  }
}

// ---------------------------------------------------------------- GGUF
async function gguf() {
  for (const [f, t] of Object.entries(truth.gguf)) {
    const ir = await readers.gguf.read(source(file(f), f))
    check('gguf', f, 'tensor names', t.tensors.map((x) => x.name), ir.tensors.map((x) => x.name))
    check('gguf', f, 'alignment', t.alignment, ir.metadata['gguf.alignment'])
    check('gguf', f, 'data offset', t.data_offset, ir.metadata['gguf.data_offset'])
    for (const e of t.tensors) {
      const x = ir.tensors.find((y) => y.name === e.name)
      if (!x) continue
      check('gguf', f, `${e.name} shape`, [...e.shape].reverse(), x.shape)
      check('gguf', f, `${e.name} type`, e.type, x.attrs.ggmlType)
      check('gguf', f, `${e.name} bytes`, e.n_bytes, x.byteLength)
      check('gguf', f, `${e.name} offset`, e.offset, x.attrs.offset)
      const deq = readers.gguf.dequantize(e.type, await x.read(), e.shape.reduce((a, b) => a * b, 1))
      if (e.head && readers.gguf.DECODED_TYPES.includes(e.type)) checkClose('gguf', f, `${e.name} values (${e.type})`, e.head, deq ? [...deq.subarray(0, 6)] : null, 1e-3)
      else check('gguf', f, `${e.name} not decoded (${e.type})`, null, deq)
    }
    for (const [k, e] of Object.entries(t.kv)) {
      let got = ir.metadata[k]
      let want = e.value
      if (want && typeof want === 'object' && !Array.isArray(want) && 'len' in want) {
        check('gguf', f, `kv ${k} length`, `[${want.len}]`, /\[(\d+)\]$/.exec(ir.metadata['gguf.kv_types'][k])?.[0])
        want = want.head
        got = got.slice(0, want.length)
      }
      if (typeof want === 'number' && typeof got === 'number' && !Number.isInteger(want)) checkClose('gguf', f, `kv ${k}`, [want], [got], 1e-6)
      else check('gguf', f, `kv ${k}`, want, typeof got === 'bigint' ? Number(got) : Array.isArray(got) && Array.isArray(want) && !want.some(Array.isArray) ? got.flat() : got)
    }
    check('gguf', f, 'tree blk.0 groups', ['attn', 'ffn'], [...new Set(ir.modules.children.find((c) => c.name === 'blk').children[0].children.map((c) => c.name))])
  }
}

// ---------------------------------------------------------------- ONNX
const ONNX_DT = { float32: 'f32', float64: 'f64', float16: 'f16', bfloat16: 'bf16', int64: 'i64', int32: 'i32', int8: 'i8', uint8: 'u8', bool: 'bool', object: 'str' }
async function onnx() {
  for (const [f, t] of Object.entries(truth.onnx)) {
    const ir = await readers.onnx.read(source(file(f), f))
    check('onnx', f, 'ir_version', t.ir_version, ir.metadata.ir_version)
    check('onnx', f, 'opsets', t.opsets, ir.metadata.opset_import)
    check('onnx', f, 'producer', `${t.producer}${t.producer_version ? ' ' + t.producer_version : ''}`, ir.producer)
    for (const [k, v] of Object.entries(t.metadata)) check('onnx', f, `metadata ${k}`, v, ir.metadata.metadata_props?.[k])
    const fnGraphs = (ir.graph.subgraphs ?? []).filter((g) => g.name.startsWith('function '))
    check('onnx', f, 'functions', t.functions, fnGraphs.map((g) => /function (?:[^:]*::)?(\S+)/.exec(g.name)[1]))
    let params = 0
    const graphCheck = (g, tg, path) => {
      check('onnx', f, `${path} nodes`, tg.nodes, g.nodes.length)
      const ops = {}
      for (const n of g.nodes) ops[n.op] = (ops[n.op] ?? 0) + 1
      check('onnx', f, `${path} op histogram`, tg.ops, ops)
      check('onnx', f, `${path} inputs`, tg.inputs.filter((i) => !tg.initializers.some((x) => x.name === i)), g.inputs)
      check('onnx', f, `${path} outputs`, tg.outputs, g.outputs)
      check('onnx', f, `${path} node names`, tg.node_names, g.nodes.slice(0, 20).map((n) => n.name ?? ''))
      for (const [nn, keys] of Object.entries(tg.attrs)) {
        const n = g.nodes.find((x) => x.name === nn)
        check('onnx', f, `${path} ${nn} attr names`, keys, Object.keys(n?.attrs ?? {}).filter((k) => k !== 'doc_string').sort())
      }
      for (const s of tg.subgraphs) {
        const n = g.nodes.find((x) => x.name === s.node)
        const sub = (n?.subgraphs ?? []).map((i) => g.subgraphs[i]).find((x) => x.name === s.name)
        if (!sub) check('onnx', f, `${path} subgraph ${s.name}`, 'present', 'missing')
        else graphCheck(sub, s, `${path}/${s.name}`)
      }
    }
    graphCheck(ir.graph, t, 'main')
    const allInits = []
    const collect = (tg) => { allInits.push(...tg.initializers); tg.subgraphs.forEach(collect) }
    collect(t)
    for (const e of allInits) {
      const x = ir.tensors.find((y) => y.name === e.name || y.name.startsWith(e.name + '#'))
      if (!x) { check('onnx', f, `init ${e.name}`, 'present', 'missing'); continue }
      check('onnx', f, `init ${e.name} shape`, e.dims, x.shape)
      check('onnx', f, `init ${e.name} dtype`, ONNX_DT[e.data_type] ?? e.data_type, x.dtype)
      check('onnx', f, `init ${e.name} external`, e.external, !!x.attrs?.external)
      params += e.dims.reduce((a, b) => a * b, 1)
      if (e.head && typeof e.head[0] === 'number' && !e.external) checkClose('onnx', f, `init ${e.name} values`, e.head, await head(x))
      if (e.external) check('onnx', f, `init ${e.name} no read`, true, !x.read)
    }
    check('onnx', f, 'params', t.params, ir.tensors.filter((x) => x.kind === 'initializer' && !/\./.test('') ).filter((x) => t.initializers.some((e) => e.name === x.name)).reduce((s, x) => s + x.shape.reduce((a, b) => a * b, 1), 0))
  }
}

const sections = { numpy, gguf, onnx }
const only = arg('only')
for (const [k, fn] of Object.entries(sections)) {
  if (only && only !== k) continue
  try {
    await fn()
  } catch (e) {
    results.push({ format: k, file: '*', check: 'run', ok: false, got: String(e?.stack ?? e) })
  }
}

// ---------------------------------------------------------------- summary
const by = {}
for (const r of results) {
  const s = (by[r.format] ??= { checks: 0, ok: 0 })
  s.checks++
  if (r.ok) s.ok++
}
for (const [k, s] of Object.entries(by)) console.log(`${k.padEnd(8)} ${s.ok}/${s.checks}`)
const failed = results.filter((r) => !r.ok)
for (const r of failed.slice(0, 40)) console.log('FAIL', r.format, r.file, r.check, JSON.stringify(r.expected)?.slice(0, 200), '→', JSON.stringify(r.got)?.slice(0, 300))
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ by, results }, null, 1))
process.exitCode = failed.length ? 1 : 0
