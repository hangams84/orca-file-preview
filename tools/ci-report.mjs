// Turns the orca-compat CI artifacts into a version x OS table.
//   node tools/ci-report.mjs <artifacts-dir> [--readme README.md] [--run-url <url>] [--out ci-results.md]
// Each artifact folder is named result-<os>-<orca version> and holds the results.json written by
// tools/platform-test/run-tests*.{sh,ps1}. With --readme the table replaces the block between
// <!-- ci-matrix:start --> and <!-- ci-matrix:end -->.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const dir = argv[0]
const opt = (n) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
if (!dir || !existsSync(dir)) {
  console.error('usage: node tools/ci-report.mjs <artifacts-dir> [--readme README.md] [--run-url url] [--out file]')
  process.exit(2)
}

const OS = [
  ['linux', 'Ubuntu 24.04 (Docker)'],
  ['macos', 'macOS 15 arm64'],
  ['windows-2022', 'Windows 10 kernel (Server 2022)'],
  ['windows-2025', 'Windows 11 kernel (Server 2025)'],
  ['windows', 'Windows']
]
let guard = null
const cells = new Map() // `${os}|${version}` -> result
const versions = new Set()
const failures = []
const notes = []
for (const name of readdirSync(dir)) {
  if (name === 'result-windows7-guard') {
    const f = join(dir, name, 'results.json')
    guard = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')) : { checks: [] }
    if (!guard.checks?.[0]?.ok) failures.push('- Windows 7 guard: the installer did not refuse clearly')
    continue
  }
  const m = name.match(/^result-(linux|macos|windows(?:-\d{4})?)-(\d+\.\d+\.\d+)$/)
  if (!m) continue
  const [, os, version] = m
  const file = join(dir, name, 'results.json')
  versions.add(version)
  if (!existsSync(file)) {
    cells.set(`${os}|${version}`, { missing: true })
    failures.push(`- ${os} · Orca ${version}: no results.json (job failed before writing results)`)
    continue
  }
  const r = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  const checks = Array.isArray(r.checks) ? r.checks : []
  const passed = checks.filter((c) => c.ok).length
  const incompatible = checks.some((c) => /refused on unsupported/.test(c.name))
  cells.set(`${os}|${version}`, { passed, total: checks.length, incompatible, os: r.os })
  const below = version === '1.4.247' // below engines.orca: reported, never counted as a failure
  for (const c of checks.filter((c) => !c.ok)) (below ? notes : failures).push(`- ${os} · Orca ${version}: ${c.name} — ${String(c.detail ?? '').split('\n')[0].slice(0, 160)}`)
}

const cmp = (a, b) => a.split('.').map(Number).reduce((d, x, i) => d || x - b.split('.').map(Number)[i], 0)
const vs = [...versions].sort(cmp).reverse()
const usedOs = OS.filter(([k]) => vs.some((v) => cells.has(`${k}|${v}`)))
const cell = (os, v) => {
  const c = cells.get(`${os}|${v}`)
  if (!c) return '—'
  if (c.missing) return '❌ no result'
  const ok = c.passed === c.total && c.total > 0
  if (c.incompatible) return ok ? '✅ refused (unsupported)' : '❌ not refused'
  return `${ok ? '✅' : '❌'} ${c.passed}/${c.total}`
}
const allOk = failures.length === 0
const lines = [
  `**Orca compatibility CI** — ${allOk ? '✅ all passing' : `❌ ${failures.length} failing check(s)`} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${opt('run-url') ? ` · [run](${opt('run-url')})` : ''}`,
  '',
  `| Orca | ${usedOs.map(([, label]) => label).join(' | ')} |`,
  `| --- | ${usedOs.map(() => '---').join(' | ')} |`,
  ...vs.map((v) => `| ${v}${v === '1.4.247' ? ' (below min, informational)' : ''} | ${usedOs.map(([k]) => cell(k, v)).join(' | ')} |`),
  '',
  ...(guard ? [`Windows 7: ${guard.checks?.[0]?.ok ? '✅' : '❌'} the installer refuses with a clear message — Orca (Electron 23+) needs Windows 10 or later, and no Windows 7 CI runners exist. Windows 10/11 columns run on GitHub's Windows Server images, which share the Windows 10 (build 20348) and Windows 11 24H2 (build 26100) kernels; Windows 11 Pro 26200 was also tested on a real PC.`, ''] : []),
  'Each cell: a fresh Orca install of that version → plugin install with approval → validate · unit tests · static check → every fixture opened in the plugin editor → finished renders captured → plugin log free of errors (Windows also installs and removes through `installer/windows`). 1.4.247 is below the declared minimum (`engines.orca` >=1.4.248): Orca does not enforce that for folder installs, so its row is informational.'
]
if (failures.length) lines.push('', '<details><summary>Failing checks</summary>', '', ...failures, '', '</details>')
if (notes.length) lines.push('', '<details><summary>Informational (below the declared minimum)</summary>', '', ...notes, '', '</details>')
const md = lines.join('\n') + '\n'
writeFileSync(opt('out') ?? 'ci-results.md', md)
console.log(md)

const readme = opt('readme')
if (readme) {
  const s = readFileSync(readme, 'utf8')
  const start = '<!-- ci-matrix:start -->'
  const end = '<!-- ci-matrix:end -->'
  const i = s.indexOf(start)
  const j = s.indexOf(end)
  if (i < 0 || j < i) {
    console.error(`${readme}: markers ${start} / ${end} not found`)
    process.exit(1)
  }
  writeFileSync(readme, s.slice(0, i + start.length) + '\n' + md + s.slice(j))
  console.log(`updated ${readme}`)
}
process.exitCode = allOk ? 0 : 1
