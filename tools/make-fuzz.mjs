// Writes damaged variants of every fixture to samples/fuzz/ (git-ignored) for robustness tests:
// truncated at several points, bit-flipped, zero-filled ranges, random bytes and empty files,
// each keeping its original suffix so the same renderer receives it. Deterministic (seeded).
//   node tools/make-fuzz.mjs [--per 6] [--seed 1]
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'samples')
const OUT = join(SRC, 'fuzz')
const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? Number(argv[i + 1]) : def
}
let seed = opt('seed', 1) >>> 0
const rand = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const MAX_SRC = 2 * 1024 * 1024 // skip the large fixtures: they only slow the run down

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const seen = new Set()
let n = 0
for (const f of readdirSync(SRC).sort()) {
  const p = join(SRC, f)
  if (!statSync(p).isFile() || statSync(p).size > MAX_SRC) continue
  const ext = extname(f).toLowerCase()
  const base = f.slice(0, -ext.length)
  const src = new Uint8Array(readFileSync(p))
  const variants = []
  for (const frac of [0.1, 0.5, 0.9]) variants.push([`trunc${Math.round(frac * 100)}`, src.slice(0, Math.max(1, Math.floor(src.length * frac)))])
  {
    const b = src.slice()
    const flips = Math.max(4, Math.floor(b.length / 500))
    for (let i = 0; i < flips; i++) b[Math.floor(rand() * b.length)] ^= 1 << Math.floor(rand() * 8)
    variants.push(['flip', b])
  }
  {
    const b = src.slice()
    const start = Math.floor(rand() * b.length * 0.8)
    b.fill(0, start, Math.min(b.length, start + Math.max(64, Math.floor(b.length * 0.05))))
    variants.push(['zero', b])
  }
  if (!seen.has(ext)) {
    seen.add(ext)
    const r = new Uint8Array(4096)
    for (let i = 0; i < r.length; i++) r[i] = Math.floor(rand() * 256)
    variants.push(['random', r])
    variants.push(['empty', new Uint8Array(0)])
    variants.push(['one-byte', new Uint8Array([0x41])])
  }
  for (const [tag, bytes] of variants) {
    writeFileSync(join(OUT, `${base}.${tag}${ext}`), bytes)
    n++
  }
}
console.log(`${n} fuzz files → samples/fuzz/`)
