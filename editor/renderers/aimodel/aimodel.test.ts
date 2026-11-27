import { assert, test } from 'orca/testing'
import { sniff } from '../aimodel.ts'
import { bytesSource } from './bytes.ts'
import { decode, elementBytes, f16ToNumber, histogram, stats } from './dtype.ts'
import { read as readPytorch } from './formats/pytorch.ts'
import { read as readPt2 } from './formats/pt2.ts'
import { read as readSafetensors } from './formats/safetensors.ts'
import type { TensorInfo } from './ir.ts'
import { layout } from './layout.ts'
import { describe, isDict, isObject, unpickle } from './pickle.ts'
import { heatmapGrid, sampleValues } from './sample.ts'
import { B64, bytesOf, TINY_KEYS, TINY_PARAMS, TINY_TENSORS } from './testdata.ts'
import { parseClasses } from './torchscript.ts'
import { inferTree, moduleStats, totals } from './tree.ts'
import { squarify } from './views/map.ts'
import { openZip } from './zip.ts'

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((x) => parseInt(x, 16)))
const src = (name: string) => bytesSource(bytesOf(name))

// {'a': 1, 'b': [1.0, True, None, 256, -5, 2**70], 'c': ('x', b'\x00\x01'), 'd': OrderedDict(k={1, 2}), 'e': 'é한'}
const PICKLES: Record<string, string> = {
  p0: '286470300a56610a70310a49310a7356620a70320a286c70330a46312e300a614930310a614e61493235360a61492d350a614c313138303539313632303731373431313330333432344c0a617356630a70340a2856780a70350a635f636f646563730a656e636f64650a70360a28565c7530303030010a70370a566c6174696e310a70380a7470390a527031300a747031310a7356640a7031320a63636f6c6c656374696f6e730a4f726465726564446963740a7031330a2874527031340a566b0a7031350a635f5f6275696c74696e5f5f0a7365740a7031360a28286c7031370a49310a6149320a61747031380a527031390a737356650a7032300a56e95c75643535630a7032310a732e',
  p2: '80027d71002858010000006171014b0158010000006271025d710328473ff0000000000000884e4d00014afbffffff8a090000000000000000406558010000006371045801000000787105635f636f646563730a656e636f64650a710658020000000001710758060000006c6174696e31710886710952710a86710b580100000064710c63636f6c6c656374696f6e730a4f726465726564446963740a710d2952710e58010000006b710f635f5f6275696c74696e5f5f0a7365740a71105d7111284b014b02658571125271137358010000006571145805000000c3a9ed959c7115752e',
  p4: '8004957e000000000000007d94288c0161944b018c0162945d9428473ff0000000000000884e4d00014afbffffff8a09000000000000000040658c0163948c017894430200019486948c0164948c0b636f6c6c656374696f6e73948c0b4f726465726564446963749493942952948c016b948f94284b014b0290738c0165948c05c3a9ed959c94752e'
}

test('pickle VM: protocols 0, 2 and 4 decode the same value without calling anything', () => {
  for (const [name, h] of Object.entries(PICKLES)) {
    const { value, callables } = unpickle(hex(h))
    assert.ok(isDict(value), name)
    const d = value as Map<unknown, unknown>
    assert.equal(d.get('a'), 1, name)
    const b = d.get('b') as unknown[]
    assert.deepEqual(b.slice(0, 5), [1, true, null, 256, -5], name)
    assert.equal(b[5], 2n ** 70n, name)
    const c = d.get('c') as unknown[]
    assert.equal(c[0], 'x', name)
    assert.deepEqual(Array.from(c[1] as Uint8Array), [0, 1], name)
    const od = d.get('d') as Map<unknown, unknown>
    assert.deepEqual(od.get('k'), [1, 2], name)
    assert.equal(d.get('e'), 'é한', name)
    assert.deepEqual(callables, [], name)
  }
})

test('pickle VM: a REDUCE of os.system stays an inert record and is reported', () => {
  for (const name of ['malicious', 'malicious0']) {
    const { value, callables } = unpickle(bytesOf(name))
    assert.ok(isObject(value), name)
    const o = value as { class: string; args: unknown[] }
    assert.match(o.class, /^(nt|posix)\.system$/)
    assert.equal(o.args[0], 'echo fp-test-pickle-must-not-run')
    assert.equal(callables.length, 1)
    assert.match(describe(value as never), /system\("echo/)
  }
})

test('pickle VM: truncated and garbage input fail cleanly', () => {
  assert.throws(() => unpickle(hex(PICKLES.p2).subarray(0, 40)), /truncated/)
  assert.throws(() => unpickle(hex('80027d00ff')))
  assert.throws(() => unpickle(hex('30')))
})

test('zip: the central directory and stored entries of a torch.save archive', async () => {
  const zip = await openZip(src('stateDict'))
  const names = zip.entries.map((e) => e.name)
  assert.ok(names.some((n) => n.endsWith('/data.pkl')))
  assert.ok(names.some((n) => /\/data\/0$/.test(n)))
  const pkl = zip.entries.find((e) => e.name.endsWith('/data.pkl'))!
  const bytes = await zip.read(pkl)
  assert.equal(bytes[0], 0x80)
  const s = await zip.source(pkl)
  assert.equal(s.size, pkl.size)
  await assert.rejects(openZip(bytesSource(bytesOf('stateDict').subarray(0, 300))))
})

test('dtype: f16, bf16, f8, ints, big-endian and stats', () => {
  assert.equal(f16ToNumber(0x3c00), 1)
  assert.equal(f16ToNumber(0xc000), -2)
  assert.equal(f16ToNumber(0x7c00), Infinity)
  assert.ok(Number.isNaN(f16ToNumber(0x7e00)))
  assert.deepEqual(Array.from(decode(hex('803f0040'), 'bf16')), [1, 2])
  assert.deepEqual(Array.from(decode(hex('3840'), 'f8e4m3')), [1, 2])
  assert.deepEqual(Array.from(decode(hex('ff7f'), 'i8')), [-1, 127])
  assert.deepEqual(Array.from(decode(hex('feffffffffffffff'), 'i64')), [-2])
  assert.deepEqual(Array.from(decode(hex('3f800000'), 'f32', 'big')), [1])
  assert.deepEqual(Array.from(decode(hex('0100'), 'bool')), [1, 0])
  assert.equal(elementBytes('bf16'), 2)
  assert.equal(elementBytes('Q4_K'), 0)
  const st = stats([0, 1, 2, 3, NaN, Infinity])
  assert.equal(st.min, 0)
  assert.equal(st.max, 3)
  assert.equal(st.mean, 1.5)
  assert.equal(st.nan, 1)
  assert.equal(st.inf, 1)
  assert.equal(st.zeros, 1)
  assert.deepEqual(histogram([0, 0.5, 1], 2, 0, 1), [1, 2])
})

const params = (ts: TensorInfo[]) => totals(ts).params

test('pytorch: state_dict, legacy pickle and whole module agree with PyTorch', async () => {
  for (const name of ['stateDict', 'legacy', 'module']) {
    const ir = await readPytorch(src(name))
    assert.equal(ir.tensors.length, TINY_TENSORS, name)
    assert.deepEqual(ir.tensors.map((t) => t.name).sort(), [...TINY_KEYS].sort(), name)
    assert.equal(params(ir.tensors), TINY_PARAMS, name)
    const w = ir.tensors.find((t) => t.name === 'fc.weight')!
    assert.deepEqual(w.shape, [3, 8])
    assert.equal(w.dtype, 'f32')
    const v = decode(await w.read!(), w.dtype)
    assert.equal(v.length, 24)
    assert.ok(Math.abs(v[23] - 2.3) < 1e-6, `${name}: ${v[23]}`)
    // Ranged read of the last 4 values.
    const tail = decode(await w.read!({ offset: 80, length: 16 }), 'f32')
    assert.ok(Math.abs(tail[0] - 2.0) < 1e-6)
  }
  const mod = await readPytorch(src('module'))
  assert.equal(mod.modules?.type, 'fp_demo.Tiny')
  assert.deepEqual(mod.modules?.children.map((c) => c.type), ['torch.nn.modules.conv.Conv2d', 'torch.nn.modules.batchnorm.BatchNorm2d', 'torch.nn.modules.linear.Linear'])
  assert.equal(mod.modules?.children[0].attrs?.['in_channels'], 1)
  assert.ok(mod.notes.some((n) => /forward code/.test(n.en)))
})

test('pytorch: TorchScript gives the module tree and a call graph', async () => {
  const ir = await readPytorch(src('torchscript'))
  assert.equal(ir.format, 'torchscript')
  assert.equal(params(ir.tensors), TINY_PARAMS)
  const ops = ir.graph!.nodes.map((n) => n.op)
  assert.deepEqual(ops.filter((o) => /Conv2d|BatchNorm2d|relu|flatten|Linear/.test(o)), ['Conv2d', 'BatchNorm2d', 'relu', 'flatten', 'Linear'])
  const conv = ir.graph!.nodes.find((n) => n.op === 'Conv2d')!
  assert.equal(conv.module, 'conv')
  assert.ok(conv.inputs.includes('conv.weight'))
  assert.deepEqual(conv.attrs?.['kernel_size'], [3, 3])
})

test('pytorch: Lightning checkpoint info (epoch, step, optimizer guessed from state)', async () => {
  const ir = await readPytorch(src('lightning'))
  assert.equal(ir.formatLabel, 'PyTorch Lightning checkpoint')
  assert.equal(ir.checkpoint?.epoch, 3)
  assert.equal(ir.checkpoint?.step, 42)
  assert.equal(ir.checkpoint?.optimizers?.[0].type, 'SGD')
  assert.equal(ir.checkpoint?.optimizers?.[0].groups[0]['lr'], 0.1)
  assert.equal(ir.checkpoint?.versions?.['pytorch-lightning_version'], '2.4.0')
  assert.equal(ir.checkpoint?.hyperParameters?.['lr'], 0.1)
  assert.equal(params(ir.tensors), TINY_PARAMS)
  assert.ok(ir.tensors.some((t) => t.kind === 'optimizer-state'))
})

test('pytorch: a malicious pickle opens inertly with a warning', async () => {
  const ir = await readPytorch(src('malicious'))
  assert.equal(ir.notes[0].level, 'warn')
  assert.match(ir.notes[0].en, /system/)
})

test('safetensors and pt2', async () => {
  const st = await readSafetensors(src('safetensors'))
  assert.equal(st.tensors.length, TINY_TENSORS)
  assert.equal(st.metadata['note'], 'tiny')
  const w = st.tensors.find((t) => t.name === 'fc.weight')!
  assert.ok(Math.abs(decode(await w.read!(), 'f32')[1] - 0.1) < 1e-6)
  await assert.rejects(readSafetensors(bytesSource(bytesOf('safetensors').subarray(0, 20))))
  const ep = await readPt2(src('pt2'))
  assert.equal(params(ep.tensors), TINY_PARAMS)
  assert.deepEqual(ep.graph!.nodes.map((n) => n.op).filter((o) => o !== 'flatten'), ['conv2d', 'batch_norm', 'relu', 'linear'])
  assert.equal(ep.graph!.nodes[0].module, 'conv')
  assert.equal(ep.modules?.children.find((c) => c.name === 'fc')?.type, 'torch.nn.modules.linear.Linear')
})

test('sniff: content decides the reader', async () => {
  assert.equal(await sniff(src('stateDict'), 'bin'), 'pytorch')
  assert.equal(await sniff(src('pt2'), 'pt'), 'pt2')
  assert.equal(await sniff(src('safetensors'), 'bin'), 'safetensors')
  assert.equal(await sniff(src('legacy'), 'pkl'), 'pytorch')
  assert.equal(await sniff(bytesSource(new TextEncoder().encode('GGUF\u0003\u0000\u0000\u0000xxxxxxxx')), 'bin'), 'gguf')
  await assert.rejects(sniff(bytesSource(new TextEncoder().encode('hello world, not a model')), 'bin'))
})

test('tree: inferred from dotted names, typed from shapes, tied weights counted once', () => {
  const t = (name: string, shape: number[], storage?: string): TensorInfo => ({ name, shape, dtype: 'f32', byteLength: shape.reduce((a, b) => a * b, 1) * 4, storage })
  const ts = [
    t('wte.weight', [100, 8], 's0'),
    t('h.0.ln_1.weight', [8]),
    t('h.0.ln_1.bias', [8]),
    t('h.0.attn.c_attn.weight', [24, 8]),
    t('h.0.conv.weight', [4, 2, 3, 3]),
    t('h.0.bn.running_mean', [4]),
    t('h.0.bn.weight', [4]),
    t('h.1.ln_1.weight', [8]),
    t('lm_head.weight', [100, 8], 's0')
  ]
  const root = inferTree(ts)
  const h = root.children.find((c) => c.name === 'h')!
  assert.equal(h.type, 'ModuleList')
  const b0 = h.children[0]
  assert.equal(b0.children.find((c) => c.name === 'ln_1')?.type, 'LayerNorm')
  assert.equal(b0.children.find((c) => c.name === 'conv')?.type, 'Conv2d')
  assert.equal(b0.children.find((c) => c.name === 'bn')?.type, 'BatchNorm')
  assert.equal(root.children.find((c) => c.name === 'wte')?.type, 'Embedding')
  const st = moduleStats(root, ts)
  // lm_head shares wte's storage: counted once; running_mean is a buffer.
  assert.equal(st.get('')!.params, 800 + 8 + 8 + 192 + 72 + 4 + 8)
  assert.equal(st.get('')!.buffers, 4)
  assert.equal(st.get('lm_head')!.params, 0)
})

test('layout: ranks follow edges, no overlaps in a rank, LR transposes', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, width: 80, height: 30 }))
  const edges = [
    { from: 'a', to: 'b' },
    { from: 'a', to: 'c' },
    { from: 'b', to: 'd' },
    { from: 'c', to: 'd' },
    { from: 'a', to: 'd' },
    { from: 'd', to: 'a' }, // a cycle must not hang or throw
    { from: 'e', to: 'd' }
  ]
  const r = layout(nodes, edges)
  const p = (id: string) => r.nodes.get(id)!
  assert.ok(p('a').y < p('b').y && p('b').y < p('d').y)
  assert.equal(p('b').y, p('c').y)
  assert.ok(Math.abs(p('b').x - p('c').x) >= 80)
  // e has no inputs: it sits one rank above its consumer d.
  assert.equal(p('e').rank, p('d').rank - 1)
  assert.equal(r.edges.length, edges.length)
  const lr = layout(nodes, edges, { direction: 'LR' })
  assert.ok(lr.nodes.get('a')!.x < lr.nodes.get('d')!.x)
  // 10k-node chain with skips lays out without recursion limits.
  const big = Array.from({ length: 10000 }, (_, i) => ({ id: `n${i}`, width: 100, height: 30 }))
  const bigE = big.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id }))
  const rb = layout(big, bigE)
  assert.equal(rb.nodes.get('n9999')!.rank, 9999)
})

test('torchscript: classes, constants and forward bodies are parsed', () => {
  const code = new Map([
    ['__torch__/m.py', 'class M(Module):\n  __parameters__ = []\n  fc : __torch__.torch.nn.modules.linear.Linear\n  k : Final[Tuple[int, int]] = (3, 3)\n  def forward(self: __torch__.m.M,\n    x: Tensor) -> Tensor:\n    fc = self.fc\n    return (fc).forward(x, )\n']
  ])
  const cls = parseClasses(code).get('__torch__.m.M')!
  assert.equal(cls.attrs.get('fc'), '__torch__.torch.nn.modules.linear.Linear')
  assert.equal(cls.consts.get('k'), '(3, 3)')
  assert.deepEqual(cls.methods.get('forward')!.params, ['self', 'x'])
  assert.equal(cls.methods.get('forward')!.body.length, 2)
})

test('treemap: squarified rectangles fill the area in proportion', () => {
  const rs = squarify([6, 6, 4, 3, 2, 2, 1, 0], { x: 0, y: 0, w: 6, h: 4 })
  const area = rs.reduce((s, r) => s + r.w * r.h, 0)
  assert.ok(Math.abs(area - 24) < 1e-9)
  assert.ok(Math.abs(rs[0].w * rs[0].h - 6) < 1e-9)
  assert.equal(rs[7].w * rs[7].h, 0)
})

test('sampling: whole small tensors, chunk samples and heatmap grids of large ones', async () => {
  const n = 1000
  const buf = new Float32Array(n).map((_, i) => i)
  const bytes = new Uint8Array(buf.buffer)
  const t: TensorInfo = { name: 'w', shape: [20, 50], dtype: 'f32', byteLength: bytes.byteLength, read: async (r) => (r ? bytes.subarray(r.offset, r.offset + r.length) : bytes) }
  const all = await sampleValues(t)
  assert.equal(all.sampled, false)
  assert.equal(all.values.length, n)
  const part = await sampleValues(t, 400, 4)
  assert.equal(part.sampled, true)
  assert.equal(part.values[0], 0)
  assert.equal(part.values[part.values.length - 1], 999)
  const g = await heatmapGrid(t, 10, 25, 100)
  assert.equal(g!.rows, 10)
  assert.equal(g!.cols, 25)
  assert.equal(g!.values[0], 0)
  assert.equal(g!.values[25], 100) // row 2 of the source
  assert.ok(Object.keys(B64).length >= 8)
})
