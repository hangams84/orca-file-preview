import { assert, test } from 'orca/testing'
import type { ByteSource, Graph, ModelIR, TensorInfo } from '../ir.ts'
import { f16 } from './common.ts'
import { fixtures } from './fixtures.ts'
import * as gguf from './gguf.ts'
import { lzf, unshuffle } from './hdf5.ts'
import * as keras from './keras.ts'
import * as numpy from './numpy.ts'
import * as onnx from './onnx.ts'
import * as tflite from './tflite.ts'

const src = (b: Uint8Array, name?: string): ByteSource => ({ size: b.length, name, read: async (o, n) => b.subarray(o, o + n) })
const F = fixtures()
const open = (reader: { read(s: ByteSource): Promise<ModelIR> }, name: string) => reader.read(src(F.file(name), name))
const prod = (s: number[]) => s.reduce((a, b) => a * b, 1)
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-3) =>
  a.length === b.length && Array.from(a).every((x, i) => Math.abs(x - b[i]) <= tol * Math.max(1, Math.abs(x)))

/** First values of a plain tensor, decoded little/big-endian per the dtype. */
async function head(t: TensorInfo, n = 6): Promise<number[]> {
  const size = ({ f64: 8, f32: 4, f16: 2, i64: 8, i32: 4, i16: 2, i8: 1, u8: 1 } as Record<string, number>)[t.dtype]
  const b = await t.read!({ offset: 0, length: n * size })
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const le = t.byteOrder !== 'big'
  const out: number[] = []
  for (let o = 0; o + size <= b.length; o += size)
    out.push(
      t.dtype === 'f64' ? v.getFloat64(o, le)
      : t.dtype === 'f32' ? v.getFloat32(o, le)
      : t.dtype === 'f16' ? f16(v.getUint16(o, le))
      : t.dtype === 'i64' ? Number(v.getBigInt64(o, le))
      : t.dtype === 'i32' ? v.getInt32(o, le)
      : t.dtype === 'i16' ? v.getInt16(o, le)
      : t.dtype === 'i8' ? v.getInt8(o)
      : v.getUint8(o)
    )
  return out
}

// ---- detection ----

test('formats: each detector recognises its own samples only', () => {
  const owner: Record<string, string> = { npy: 'numpy', npz: 'numpy', onnx: 'onnx', tflite: 'tflite', gguf: 'gguf', h5: 'keras', keras: 'keras' }
  const detectors = { numpy, onnx, tflite, gguf, keras } as Record<string, { detect(h: Uint8Array): boolean }>
  for (const name of F.names) {
    const h = F.file(name).subarray(0, 64)
    const hits = Object.entries(detectors).filter(([, d]) => d.detect(h)).map(([k]) => k)
    assert.deepEqual(hits, [owner[name.split('.').pop()!]], name)
  }
})

// ---- NumPy ----

test('numpy: npy headers, dtypes and values (big-endian, Fortran order, f16, structured)', async () => {
  for (const name of ['np-i64be.npy', 'np-fortran.npy', 'np-f16.npy', 'np-unicode.npy', 'np-struct.npy']) {
    const e = F.expect[name]
    const ir = await open(numpy, name)
    const t = ir.tensors[0]
    assert.deepEqual(t.shape, e.shape, name)
    assert.equal(t.byteLength, prod(e.shape) * e.itemsize, name)
    if (e.head && typeof e.head[0] === 'number') assert.ok(near(await head(t), e.head), name)
  }
  const be = (await open(numpy, 'np-i64be.npy')).tensors[0]
  assert.equal(be.byteOrder, 'big')
  const st = (await open(numpy, 'np-struct.npy')).tensors[0]
  assert.equal(st.dtype, 'struct{x:f32, y:i32, z:i16[2]}')
  assert.equal((await open(numpy, 'np-unicode.npy')).tensors[0].dtype, 'U5')
})

test('numpy: npz stored and compressed members', async () => {
  for (const name of ['np-stored.npz', 'np-compressed.npz']) {
    const e = F.expect[name]
    const ir = await open(numpy, name)
    assert.deepEqual(ir.tensors.map((t) => t.name), Object.keys(e), name)
    for (const t of ir.tensors) {
      assert.deepEqual(t.shape, e[t.name].shape)
      if (typeof e[t.name].head[0] === 'number') assert.ok(near(await head(t), e[t.name].head), `${name} ${t.name}`)
    }
  }
})

test('numpy: Python header literals, Fortran reordering', () => {
  assert.deepEqual(numpy.pyLiteral("{'descr': '<f4', 'fortran_order': False, 'shape': (3,), }"), { descr: '<f4', fortran_order: false, shape: [3] })
  assert.deepEqual(numpy.pyLiteral("[('a', '<i4', (2, 2)), ('b', '|S3')]"), [['a', '<i4', [2, 2]], ['b', '|S3']])
  assert.throws(() => numpy.pyLiteral("{'a': __import__('os')}"))
  assert.throws(() => numpy.pyLiteral('['.repeat(100)))
  // [[1,2,3],[4,5,6]] stored column-major is 1 4 2 5 3 6
  assert.deepEqual([...numpy.fortranToC(new Uint8Array([1, 4, 2, 5, 3, 6]), [2, 3], 1)], [1, 2, 3, 4, 5, 6])
})

// ---- ONNX ----

function allGraphs(g: Graph): Graph[] {
  return [g, ...(g.subgraphs ?? []).flatMap(allGraphs)]
}

test('onnx: control flow, every attribute type, typed initializers and functions', async () => {
  const e = F.expect['onnx-control-flow.onnx']
  const ir = await open(onnx, 'onnx-control-flow.onnx')
  assert.equal(ir.metadata.ir_version, e.ir_version)
  assert.deepEqual(ir.metadata.opset_import, e.opsets)
  assert.equal(ir.graph!.nodes.length, e.nodes)
  assert.deepEqual(ir.graph!.inputs, e.inputs)
  assert.deepEqual(ir.graph!.outputs, e.outputs)
  const names = allGraphs(ir.graph!).map((g) => g.name)
  for (const s of ['then_branch', 'else_branch', 'loop_body', 'scan_body']) assert.ok(names.includes(s), s)
  assert.ok(names.some((n) => n?.startsWith('function local.fn::MyScale')))
  const loop = ir.graph!.nodes.find((n) => n.op === 'Loop')!
  assert.equal(ir.graph!.subgraphs![loop.subgraphs![0]].name, 'loop_body')
  const all = ir.graph!.nodes.find((n) => n.name === 'all_attrs')!
  assert.deepEqual(Object.keys(all.attrs!).sort(), e.attrs.all_attrs)
  assert.equal(all.attrs!.i, 3)
  assert.equal(all.attrs!.s, 'text')
  assert.deepEqual(all.attrs!.ints, [1, 2, 3])
  assert.deepEqual(all.attrs!.tp, 'tensor(f32, [1, D])')
  for (const init of e.initializers) {
    const t = ir.tensors.find((x) => x.name === init.name)!
    assert.deepEqual(t.shape, init.dims, init.name)
    if (init.head && typeof init.head[0] === 'number' && t.dtype !== 'bf16') assert.ok(near(await head(t), init.head), init.name)
  }
  assert.equal(ir.metadata.author, 'fp-ai-formats')
})

test('onnx: torch export, symbolic dims and module paths', async () => {
  const e = F.expect['onnx-mlp.onnx']
  const ir = await open(onnx, 'onnx-mlp.onnx')
  const ops: Record<string, number> = {}
  for (const n of ir.graph!.nodes) ops[n.op] = (ops[n.op] ?? 0) + 1
  assert.deepEqual(ops, e.ops)
  assert.equal(ir.tensors.reduce((s, t) => s + prod(t.shape), 0), e.params)
  assert.deepEqual(ir.graph!.values.find((v) => v.id === 'x')!.shape, ['batch', 16])
  assert.equal(ir.graph!.nodes[0].module, 'fc1')
})

// ---- TFLite ----

test('tflite: int8 model: ops, quantization, signatures', async () => {
  const e = F.expect['tflite-int8.tflite']
  const ir = await open(tflite, 'tflite-int8.tflite')
  assert.deepEqual(ir.graph!.nodes.map((n) => n.op), e.subgraphs[0].ops)
  for (const te of e.subgraphs[0].tensors) {
    const v = ir.graph!.values.find((x) => x.id === te.name)
    if (!v) continue
    if (v.tensor && te.scale) {
      const t = ir.tensors.find((x) => x.name === v.tensor)!
      assert.ok(near(t.quant!.scale!.slice(0, 4), te.scale, 1e-6), te.name)
      assert.deepEqual(t.quant!.zeroPoint!.slice(0, 4), te.zero_point)
    }
  }
  const conv = ir.graph!.nodes.find((n) => n.op === 'CONV_2D')!
  assert.equal(conv.attrs!.padding, 'VALID')
  assert.equal((ir.metadata.signatures as { key: string }[])[0].key, 'serving_default')
})

test('tflite: WHILE / IF subgraphs are linked from their nodes', async () => {
  const e = F.expect['tflite-control-flow.tflite']
  const ir = await open(tflite, 'tflite-control-flow.tflite')
  const graphs = [ir.graph!, ...ir.graph!.subgraphs!]
  assert.deepEqual(graphs.map((g) => g.name), e.subgraphs.map((s: { name: string }) => s.name))
  const w = ir.graph!.nodes.find((n) => n.op === 'WHILE')!
  assert.deepEqual(w.subgraphs!.map((i) => ir.graph!.subgraphs![i].name).sort(), ['while_body', 'while_cond'])
})

// ---- GGUF ----

test('gguf: key-values, tensor infos, block layout and dequantization', async () => {
  const e = F.expect['gguf-unit.gguf']
  const ir = await open(gguf, 'gguf-unit.gguf')
  assert.equal(ir.metadata['general.architecture'], 'gpt2')
  assert.deepEqual(ir.metadata['test.arr_str'], ['a', 'bb', 'ccc'])
  assert.equal(ir.metadata['test.u64'], 2n ** 60n)
  for (const te of e.tensors) {
    const t = ir.tensors.find((x) => x.name === te.name)!
    assert.deepEqual(t.shape, [...te.shape].reverse(), te.name)
    assert.equal(t.byteLength, te.n_bytes, te.name)
    const deq = gguf.dequantize(te.type, await t.read!(), prod(te.shape))
    if (gguf.DECODED_TYPES.includes(te.type)) assert.ok(deq && near(deq.subarray(0, 6), te.head), te.name)
    else assert.equal(deq, null, te.name)
  }
  const blk = ir.modules!.children.find((c) => c.name === 'blk')!.children[0]
  assert.deepEqual(blk.children.map((c) => c.name).sort(), ['attn', 'ffn'])
  assert.ok(ir.notes.some((n) => n.en.includes('IQ2_XXS')))
})

test('gguf: Q8_0 block decodes by hand', () => {
  const b = new Uint8Array(34)
  b[0] = 0x00
  b[1] = 0x3c // f16 1.0
  for (let i = 0; i < 32; i++) b[2 + i] = (i - 16) & 0xff
  const y = gguf.dequantize('Q8_0', b, 32)!
  assert.equal(y[0], -16)
  assert.equal(y[31], 15)
})

// ---- HDF5 / Keras ----

test('hdf5: superblock v3, dense groups, chunk indexes and filters', async () => {
  const e = F.expect['hdf5-v3.h5']
  const ir = await open(keras, 'hdf5-v3.h5')
  assert.equal(ir.format, 'hdf5')
  assert.equal(ir.metadata.hdf5_superblock, 3)
  const byPath = new Map(ir.tensors.map((t) => [String(t.attrs!.hdf5Path).slice(1), t]))
  assert.deepEqual([...byPath.keys()].sort(), Object.keys(e.datasets).sort())
  for (const [p, d] of Object.entries(e.datasets) as [string, { shape: number[]; head?: unknown[] }][]) {
    const t = byPath.get(p)!
    assert.deepEqual(t.shape, d.shape, p)
    if (d.head && typeof d.head[0] === 'number' && t.read) assert.ok(near(await head(t), d.head as number[]), p)
  }
  assert.equal(ir.metadata.title, 'hdf5 features')
  assert.equal(ir.metadata.utf8, 'χαίρετε')
  assert.deepEqual(ir.metadata.tags, ['a', 'bc'])
})

test('keras: .keras functional model: graph, layers and weights', async () => {
  const e = F.expect['keras-functional.keras']
  const ir = await open(keras, 'keras-functional.keras')
  assert.equal(ir.format, 'keras')
  assert.equal(ir.metadata.parameters, e.params)
  assert.deepEqual(ir.graph!.nodes.map((n) => n.op), e.layers.map((l: { class: string }) => l.class))
  assert.deepEqual(ir.graph!.nodes.find((n) => n.name === 'concat')!.inputs, ['gap', 'gmp'])
  for (const l of e.layers as { name: string; weights: [string, number[]][] }[]) {
    const m = ir.modules!.children.find((c) => c.name === l.name)!
    assert.deepEqual(m.tensors.map((n) => ir.tensors.find((t) => t.name === n)!.shape), l.weights.map((w) => w[1]), l.name)
    assert.deepEqual(m.tensors.map((n) => ir.tensors.find((t) => t.name === n)!.attrs!.variable), l.weights.map((w) => w[0].split('/').pop()), l.name)
  }
  assert.equal(ir.checkpoint!.optimizers![0].type, 'Adam')
})

test('hdf5: shuffle and LZF filters', () => {
  assert.deepEqual([...unshuffle(new Uint8Array([1, 3, 2, 4]), 2)], [1, 2, 3, 4])
  // literal run "abc", then a back reference of 3 bytes at distance 3 → "abcabc"
  const enc = new Uint8Array([2, 97, 98, 99, 0x20, 2])
  assert.equal(new TextDecoder().decode(lzf(enc, 6)), 'abcabc')
  assert.throws(() => lzf(new Uint8Array([0x20, 50]), 10))
})

// ---- robustness ----

test('formats: truncated and damaged files end in a PreviewError', async () => {
  const readers: Record<string, { read(s: ByteSource): Promise<ModelIR> }> = { npy: numpy, npz: numpy, onnx, tflite, gguf, h5: keras, keras }
  let seed = 7
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n)
  for (const name of F.names) {
    const reader = readers[name.split('.').pop()!]
    const full = F.file(name)
    const variants: Uint8Array[] = [0, 3, 9, 17, 40, 100].filter((c) => c < full.length).map((c) => full.subarray(0, c))
    for (let k = 1; k < 6; k++) variants.push(full.subarray(0, Math.floor((full.length * k) / 6)))
    for (let k = 0; k < 12; k++) {
      const b = full.slice()
      for (let j = 0; j < 4; j++) b[rnd(b.length)] = rnd(256)
      variants.push(b)
    }
    for (const v of variants) {
      try {
        const ir = await reader.read(src(v))
        for (const t of ir.tensors.slice(0, 20)) await t.read?.({ offset: 0, length: 16 }).catch((e) => assert.equal((e as Error).name, 'PreviewError', `${name} read`))
      } catch (e) {
        assert.equal((e as Error).name, 'PreviewError', `${name} (${v.length} bytes): ${(e as Error).message}`)
      }
    }
  }
})
