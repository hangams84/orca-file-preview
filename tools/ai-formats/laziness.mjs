// How much of a model file each reader touches to open it (and to sample one tensor), measured with
// a counting ByteSource. Usage: node --experimental-transform-types tools/ai-formats/laziness.mjs <files…>
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const FMT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin', 'editor', 'renderers', 'aimodel', 'formats')
const EXT = { onnx: 'onnx', tflite: 'tflite', gguf: 'gguf', h5: 'keras', keras: 'keras', npy: 'numpy', npz: 'numpy' }
console.log('| file | size | read to open | % | reads | open ms | 64-byte sample of last tensor |')
console.log('|---|---:|---:|---:|---:|---:|---:|')
for (const f of process.argv.slice(2)) {
  const b = new Uint8Array(readFileSync(f))
  let bytes = 0, reads = 0
  const src = { size: b.length, read: async (o, n) => { reads++; const x = b.subarray(o, o + n); bytes += x.length; return x } }
  const m = await import(pathToFileURL(join(FMT, EXT[f.split('.').pop()] + '.ts')).href)
  const t0 = performance.now()
  const ir = await m.read(src)
  const ms = performance.now() - t0
  const open = bytes
  const last = ir.tensors.filter((t) => t.read).pop()
  bytes = 0
  await last?.read({ offset: 0, length: 64 })
  const mb = (x) => (x / 1048576).toFixed(2) + ' MB'
  console.log(`| ${f.split(/[\/]/).pop()} | ${mb(b.length)} | ${mb(open)} | ${((100 * open) / b.length).toFixed(2)}% | ${reads} | ${ms.toFixed(0)} | ${bytes} B |`)
}
