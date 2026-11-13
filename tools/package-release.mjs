// Builds the distributable package: dist/orca-file-preview-<version>.zip with
//   File Preview/plugin/      the Orca plugin
//   File Preview/installer/   install / uninstall scripts for Windows, macOS and Linux
//   File Preview/README.md    how to install (from installer/README.md)
// Unix permissions are stored so macOS/Linux keep the .command/.sh files executable after unzipping.
//   node tools/package-release.mjs
import { zipSync } from 'fflate'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'plugin', 'orca-plugin.json'), 'utf8'))
const TOP = 'File Preview'
const SKIP = /(^|\/)(\.orca|node_modules)(\/|$)|\.test\.ts$|(^|\/)\.DS_Store$/
const EXEC = /\.(command|sh)$/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = {}
let count = 0
const add = (abs, rel) => {
  if (SKIP.test(rel.replace(/\\/g, '/'))) return
  const mode = EXEC.test(rel) ? 0o755 : 0o644
  // os 3 = Unix: the high 16 bits of the external attributes hold the file mode.
  files[`${TOP}/${rel.replace(/\\/g, '/')}`] = [readFileSync(abs), { os: 3, attrs: ((0o100000 | mode) << 16) >>> 0, level: 9 }]
  count++
}
for (const f of walk(join(ROOT, 'plugin'))) add(f, join('plugin', relative(join(ROOT, 'plugin'), f)))
for (const f of walk(join(ROOT, 'installer'))) {
  const rel = relative(join(ROOT, 'installer'), f)
  if (rel === 'README.md') continue
  add(f, join('installer', rel))
}
add(join(ROOT, 'installer', 'README.md'), 'README.md')
add(join(ROOT, 'LICENSE'), 'LICENSE')

const zip = zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') })
const outDir = join(ROOT, 'dist')
mkdirSync(outDir, { recursive: true })
const name = `orca-file-preview-${manifest.version}.zip`
writeFileSync(join(outDir, name), zip)
const sha = createHash('sha256').update(zip).digest('hex')
writeFileSync(join(outDir, `${name}.sha256`), `${sha}  ${name}\n`)
console.log(`${name}: ${count} files, ${(zip.length / 1024 / 1024).toFixed(1)} MB, sha256 ${sha}`)
