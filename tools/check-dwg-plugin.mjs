// Checks the separate GPL-3.0 plugin folder dwg-plugin/ before it is committed or published on its own:
//  - Orca's limits: folder size (50 MiB) and file count (2000); the generated .orca/ typings are left out
//    because they are git-ignored and never shipped
//  - licence files: LICENSE (GPL-3.0 text), README.md, THIRD_PARTY_NOTICES.md, vendor/libredwg/README.md,
//    manifest id/name/licence
//  - self-contained: no import, new URL(...) or fetch path that leaves the folder (in particular nothing
//    from plugin/, which installs separately)
//  - CSP: no eval / new Function in shipped scripts, no blob: script loading
//  - every extension in the manifest has a renderer in editor/main.ts
//
//   node tools/check-dwg-plugin.mjs [--dir dwg-plugin] [--json]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const dirArg = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : 'dwg-plugin'
const DIR = resolve(ROOT, dirArg)
const MAX_BYTES = 50 * 1024 * 1024
const MAX_FILES = 2000

const problems = []
const info = {}
const fail = (msg) => problems.push(msg)

// ---- files and size ----
const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    const rel = relative(DIR, p).split(sep).join('/')
    if (rel === '.orca' || rel.startsWith('.orca/') || rel === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p)
    else files.push({ rel, size: statSync(p).size })
  }
}
walk(DIR)
const total = files.reduce((a, f) => a + f.size, 0)
info.files = files.length
info.bytes = total
info.largest = [...files].sort((a, b) => b.size - a.size).slice(0, 5).map((f) => `${f.rel} ${(f.size / 1024 / 1024).toFixed(2)} MB`)
if (total > MAX_BYTES) fail(`folder is ${(total / 1024 / 1024).toFixed(1)} MB, over Orca's 50 MiB limit`)
if (files.length > MAX_FILES) fail(`${files.length} files, over Orca's 2000-file limit`)

// ---- licence files and manifest ----
const has = (rel) => files.some((f) => f.rel === rel)
for (const rel of ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'orca-plugin.json', 'vendor/libredwg/README.md']) if (!has(rel)) fail(`missing ${rel}`)
if (has('LICENSE')) {
  const lic = readFileSync(join(DIR, 'LICENSE'), 'utf8')
  if (!/GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/.test(lic) || lic.split('\n').length < 600) fail('LICENSE is not the full GPL-3.0 text')
}
let manifest = null
try {
  manifest = JSON.parse(readFileSync(join(DIR, 'orca-plugin.json'), 'utf8'))
} catch (e) {
  fail(`orca-plugin.json: ${e.message}`)
}
if (manifest) {
  if (manifest.id !== 'file-preview-dwg') fail(`manifest id is ${manifest.id}, expected file-preview-dwg`)
  if (manifest.name !== 'File Preview DWG') fail(`manifest name is ${manifest.name}`)
  if (manifest.license !== 'GPL-3.0-or-later') fail(`manifest license is ${manifest.license}, expected GPL-3.0-or-later`)
  info.extensions = manifest.contributes?.customEditors?.flatMap((e) => e.extensions) ?? []
}
if (has('THIRD_PARTY_NOTICES.md')) {
  const n = readFileSync(join(DIR, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  for (const word of ['LibreDWG', 'libredwg-web', 'GPL-3.0']) if (!n.includes(word)) fail(`THIRD_PARTY_NOTICES.md does not mention ${word}`)
}

// ---- self-contained: every relative reference stays inside the folder ----
const code = files.filter((f) => /\.(ts|js|mjs)$/.test(f.rel) && !f.rel.endsWith('.d.ts'))
const refRe = /(?:\bimport\s*(?:[^'"`;]*?\bfrom\s*)?|\bimport\s*\(\s*|\bexport\s+[^'"`;]*?\bfrom\s*|new URL\(\s*)(['"`])([^'"`]+)\1/g
let refs = 0
for (const f of code) {
  const text = readFileSync(join(DIR, f.rel), 'utf8')
  // comments may quote code; the bundled engine is one minified line, left as is
  const scan = f.rel.startsWith('vendor/') ? text : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
  // the bundled engine's own Node-only import (node:module) is behind a Node check and never runs in Orca
  for (const m of scan.matchAll(refRe)) {
    const spec = m[2]
    if (spec.startsWith('node:') || spec === 'orca/testing') continue
    refs++
    if (/^(https?:|blob:|data:)/.test(spec)) {
      fail(`${f.rel}: loads ${spec}`)
      continue
    }
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      // bare names other than the engine's own exports are not resolvable in Orca
      if (!/^[\w.-]+\.(wasm|js)$/.test(spec)) fail(`${f.rel}: bare import "${spec}"`)
      continue
    }
    const target = normalize(join(DIR, dirname(f.rel), spec))
    if (relative(DIR, target).startsWith('..') || spec.startsWith('/')) fail(`${f.rel}: "${spec}" points outside ${dirArg}/`)
    else if (!/\$\{/.test(spec)) {
      try {
        statSync(target)
      } catch {
        fail(`${f.rel}: "${spec}" does not exist`)
      }
    }
  }
  if (/plugin\/editor|plugin\/vendor/.test(text.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))) fail(`${f.rel}: refers to plugin/ files`)
  // CSP: no string evaluation, no blob: scripts. libredwg-patches.mjs is never loaded by the plugin: it
  // ships as the record of the modification and quotes the replaced `new Function` text as data.
  if (f.rel === 'vendor/libredwg/libredwg-patches.mjs') continue
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '')
  if (/\bnew Function\s*\(|(?<![\w$.])eval\s*\(/.test(stripped)) fail(`${f.rel}: uses eval / new Function (refused by Orca's CSP)`)
  if (/importScripts\s*\(\s*(URL\.createObjectURL|['"`]blob:)/.test(stripped)) fail(`${f.rel}: loads a blob: script`)
}
info.references = refs

// ---- every extension has a renderer ----
if (manifest && has('editor/main.ts')) {
  const main = readFileSync(join(DIR, 'editor/main.ts'), 'utf8')
  for (const ext of info.extensions ?? []) {
    const key = ext.replace(/^\./, '')
    if (!new RegExp(`\\b${key}:\\s*\\(\\)\\s*=>\\s*import\\(`).test(main)) fail(`${ext} is in the manifest but not in RENDERERS (editor/main.ts)`)
  }
}

if (argv.includes('--json')) console.log(JSON.stringify({ ok: problems.length === 0, problems, ...info }, null, 2))
else {
  console.log(`${dirArg}/: ${info.files} files, ${(info.bytes / 1024 / 1024).toFixed(2)} MB (limits ${MAX_FILES} files, 50 MiB); ${info.references} relative references checked`)
  for (const l of info.largest) console.log(`  ${l}`)
  for (const p of problems) console.log(`FAIL ${p}`)
  console.log(problems.length ? `\n${problems.length} problem(s)` : '\nOK')
}
process.exitCode = problems.length ? 1 : 0
