// Fidelity of the AI Model Preview readers against PyTorch's own numbers (tools/aimodel/truth.json,
// written by tools/make-ai-samples.py): tensor count, unique parameter total, every tensor's shape and
// dtype, graph size. Reads files by range like the File Preview panel does, and reports bytes read.
//
//   node --experimental-transform-types tools/aimodel/fidelity.mjs [--big C:/fpt-ai-lead/big] [--out docs/evidence/aimodel/fidelity.md]
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../../', import.meta.url)
const P = (rel) => new URL(rel, ROOT)
const args = process.argv.slice(2)
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
const R = {
  pytorch: (await import(P('plugin/editor/renderers/aimodel/formats/pytorch.ts'))).read,
  pt2: (await import(P('plugin/editor/renderers/aimodel/formats/pt2.ts'))).read,
  safetensors: (await import(P('plugin/editor/renderers/aimodel/formats/safetensors.ts'))).read
}
const { totals } = await import(P('plugin/editor/renderers/aimodel/tree.ts'))
const DT = { float32: 'f32', float16: 'f16', bfloat16: 'bf16', float64: 'f64', int64: 'i64', int32: 'i32', int8: 'i8', uint8: 'u8', bool: 'bool', qint8: 'qint8' }

function source(path) {
  const fd = openSync(path, 'r')
  const size = fstatSync(fd).size
  const s = { size, reads: 0, bytes: 0, close: () => closeSync(fd) }
  s.read = async (o, n) => {
    const len = Math.max(0, Math.min(n, size - o))
    const b = Buffer.alloc(len)
    readSync(fd, b, 0, len, o)
    s.reads++
    s.bytes += len
    return new Uint8Array(b.buffer, b.byteOffset, len)
  }
  return s
}

const kindOf = (f) => (f.endsWith('.pt2') ? 'pt2' : f.endsWith('.safetensors') ? 'safetensors' : 'pytorch')
const rows = []
async function check(dir, truth) {
  for (const t of truth) {
    const path = join(dir, t.file)
    if (!existsSync(path)) continue
    const src = source(path)
    const t0 = performance.now()
    let ir
    try {
      ir = await R[kindOf(t.file)](src)
    } catch (e) {
      rows.push({ file: t.file, kind: t.kind, ok: false, detail: `error ${e.message}` })
      src.close()
      continue
    }
    const ms = performance.now() - t0
    const tot = totals(ir.tensors)
    const model = ir.tensors.filter((x) => x.kind !== 'optimizer-state' && x.kind !== 'other')
    const problems = []
    // Lightning prefixes keys with "model.": truth lists them that way too.
    if (t.stateTensors !== undefined && model.length !== t.stateTensors) problems.push(`tensors ${model.length} ≠ ${t.stateTensors}`)
    if (t.parameters !== undefined && t.kind !== 'quantized-dynamic' && tot.params !== t.parameters) problems.push(`params ${tot.params} ≠ ${t.parameters}`)
    let shapeOk = 0
    let shapeAll = 0
    for (const [name, info] of Object.entries(t.tensors ?? {})) {
      shapeAll++
      const x = ir.tensors.find((y) => y.name === name)
      if (x && x.shape.join('x') === info.shape.join('x') && x.dtype === (DT[info.dtype] ?? info.dtype)) shapeOk++
      else if (problems.length < 4) problems.push(`${name}: ${x ? `${x.dtype} ${x.shape}` : 'missing'} ≠ ${info.dtype} ${info.shape}`)
    }
    if (t.callFunctions !== undefined && ir.graph && ir.format === 'pt2' && ir.graph.nodes.length !== t.callFunctions) problems.push(`graph ${ir.graph.nodes.length} ≠ ${t.callFunctions}`)
    if (t.epoch !== undefined && ir.checkpoint?.epoch !== t.epoch) problems.push(`epoch ${ir.checkpoint?.epoch}`)
    if (t.global_step !== undefined && ir.checkpoint?.step !== t.global_step) problems.push(`step ${ir.checkpoint?.step}`)
    rows.push({
      file: t.file,
      kind: t.kind,
      label: ir.formatLabel,
      truthParams: t.parameters ?? '',
      params: tot.params,
      tensors: `${model.length}/${t.stateTensors ?? '?'}`,
      shapes: shapeAll ? `${shapeOk}/${shapeAll}` : '—',
      graph: ir.graph ? `${ir.graph.nodes.length}${t.callFunctions !== undefined ? ` (torch.export: ${t.callFunctions})` : ''}` : '—',
      ms: ms.toFixed(1),
      read: `${src.reads} reads, ${(src.bytes / 1024 / 1024).toFixed(2)} MB of ${(src.size / 1024 / 1024).toFixed(1)} MB`,
      ok: problems.length === 0,
      detail: problems.join('; ')
    })
    src.close()
  }
}

const small = JSON.parse(readFileSync(P('tools/aimodel/truth.json'), 'utf8'))
await check(new URL('samples/aimodel/', ROOT).pathname.replace(/^\/(\w:)/, '$1'), small.samples)
const big = opt('--big')
if (big && existsSync(join(big, 'truth.json'))) {
  // The big models are also saved as whole module, TorchScript, torch.export and safetensors: same truth.
  const truth = JSON.parse(readFileSync(join(big, 'truth.json'), 'utf8'))
  const all = truth.flatMap((t) => [t, ...['module.pt', 'torchscript.pt', 'export.pt2', 'safetensors'].map((v) => ({ ...t, file: t.file.replace(/\.pth$/, `.${v}`), kind: v.split('.')[0] }))])
  await check(big, all)
}

const head = '| File | Kind | Reader label | Params (PyTorch) | Params (preview) | Tensors | Shapes+dtypes | Graph ops | Open (ms) | Bytes read | Result |\n|---|---|---|---:|---:|---|---|---|---:|---|---|'
const lines = rows.map((r) => `| ${r.file} | ${r.kind} | ${r.label ?? ''} | ${r.truthParams === '' ? '' : Number(r.truthParams).toLocaleString('en-US')} | ${r.params?.toLocaleString('en-US') ?? ''} | ${r.tensors ?? ''} | ${r.shapes ?? ''} | ${r.graph ?? ''} | ${r.ms ?? ''} | ${r.read ?? ''} | ${r.ok ? '✅' : `❌ ${r.detail}`} |`)
const md = `${head}\n${lines.join('\n')}\n\nPyTorch ${small.torch}; ${rows.filter((r) => r.ok).length}/${rows.length} match.\n`
console.log(md)
const out = opt('--out')
if (out) writeFileSync(P(out), md)
if (rows.some((r) => !r.ok)) process.exit(1)
