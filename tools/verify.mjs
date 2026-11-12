// One verification round: type check, manifest validation, unit tests, browser harness on every
// fixture and profile, and real Orca screenshots of the plugin's editors. Writes everything to
// docs/evidence/round-<n>/ with summary.json, then `node tools/build-docs.mjs` turns the rounds
// into docs/README.md and docs/index.html.
//
//   node tools/verify.mjs --round 1 [--skip-orca] [--skip-harness]
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_DIR = existsSync(join(ROOT, 'plugin', 'orca-plugin.json')) ? join(ROOT, 'plugin') : ROOT
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
    return acc
  }, [])
)
const round = String(args.round ?? '0')
const OUT = join(ROOT, 'docs', 'evidence', `round-${round}`)
mkdirSync(OUT, { recursive: true })
const ORCA = process.env.ORCA_CLI_COMMAND || 'orca'
const isWin = process.platform === 'win32'

function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', shell: isWin, maxBuffer: 64 * 1024 * 1024, ...opts })
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
function json(text) {
  const start = text.indexOf('{')
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}

const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, 'orca-plugin.json'), 'utf8'))
const pluginKey = `local.${manifest.id}`
const checks = []
const started = Date.now()

// 1. Type check
{
  const r = sh('npx', ['tsc', '-p', relative(ROOT, PLUGIN_DIR) || '.', '--noEmit'])
  checks.push({ name: 'TypeScript (tsc --noEmit)', ok: r.code === 0, detail: r.out.trim().split('\n').slice(0, 20).join('\n') })
}
// 2. Manifest / plugin validation
{
  const r = sh(ORCA, ['plugin', 'validate', relative(ROOT, PLUGIN_DIR) || '.', '--json'])
  const j = json(r.out)
  checks.push({
    name: 'orca plugin validate',
    ok: r.code === 0 && j?.result?.valid !== false,
    detail: j?.error?.message ?? (j?.result?.errors ?? []).join('\n')
  })
}
// 3. Unit tests (orca plugin test runs *.test.ts in Node)
{
  // Orca's test loader on Windows refuses its own runtime import when the plugin lives on another
  // drive than Orca (e.g. D: vs C:), so run the tests from a copy in the system temp folder.
  let testDir = PLUGIN_DIR
  if (isWin && PLUGIN_DIR.slice(0, 2).toLowerCase() !== (process.env.SystemDrive ?? 'C:').toLowerCase()) {
    testDir = join(tmpdir(), `file-preview-test-${process.pid}`)
    rmSync(testDir, { recursive: true, force: true })
    cpSync(PLUGIN_DIR, testDir, { recursive: true, filter: (src) => !src.includes(`${join('plugin', '.orca')}`) })
  }
  const r = sh(ORCA, ['plugin', 'test', testDir, '--json'])
  if (testDir !== PLUGIN_DIR) rmSync(testDir, { recursive: true, force: true })
  const pass = r.out.match(/ℹ pass (\d+)/)?.[1]
  const fail = r.out.match(/ℹ fail (\d+)/)?.[1]
  checks.push({
    name: 'orca plugin test (unit)',
    ok: r.code === 0,
    detail: pass != null ? `passed ${pass} · failed ${fail}` : r.out.trim().slice(-800)
  })
}
// 4. Static check of every editor entry (syntax, imports, missing files)
{
  const r = sh(ORCA, ['plugin', 'check', relative(ROOT, PLUGIN_DIR) || '.', '--json'])
  const j = json(r.out)
  checks.push({
    name: 'orca plugin check (static)',
    ok: r.code === 0,
    detail: j?.error?.message ?? JSON.stringify(j?.result?.issues ?? j?.result?.warnings ?? '').slice(0, 800)
  })
}

// 5. Browser harness on every fixture and profile
let harness = []
if (!args['skip-harness']) {
  const r = sh('node', [
    'tools/harness/run.mjs',
    '--out',
    relative(ROOT, join(OUT, 'harness')),
    '--profiles',
    'desktop-dark,desktop-light,mobile-light,tablet-dark'
  ])
  try {
    harness = JSON.parse(readFileSync(join(OUT, 'harness', 'results.json'), 'utf8'))
  } catch {
    harness = []
  }
  const passed = harness.filter((h) => h.pass).length
  checks.push({ name: 'Browser harness (4 profiles)', ok: r.code === 0 && harness.length > 0, detail: `${passed} / ${harness.length} passed` })
  // Hidden/occluded window: no requestAnimationFrame, no IntersectionObserver callbacks.
  const nr = sh('node', ['tools/harness/run.mjs', '--no-raf', '--out', relative(ROOT, join(OUT, 'harness-no-raf')), '--profiles', 'desktop-dark'])
  let noRaf = []
  try {
    noRaf = JSON.parse(readFileSync(join(OUT, 'harness-no-raf', 'results.json'), 'utf8'))
  } catch {
    noRaf = []
  }
  // Older engines (iOS 16 / Safari 16 / older Android WebView): newer built-ins removed in the page
  // and in workers.
  {
    const oe = sh('node', ['tools/harness/run.mjs', '--old-engine', '--no-shots', '--out', relative(ROOT, join(OUT, 'harness-old-engine')), '--profiles', 'mobile-light'])
    let old = []
    try {
      old = JSON.parse(readFileSync(join(OUT, 'harness-old-engine', 'results.json'), 'utf8'))
    } catch {
      old = []
    }
    checks.push({
      name: 'Harness on an older engine (no Promise.withResolvers etc.)',
      ok: oe.code === 0 && old.length > 0,
      detail: `${old.filter((h) => h.pass).length} / ${old.length} passed${old.filter((h) => !h.pass).map((h) => `\n✗ ${h.file}: ${h.state} ${h.checkError ?? ''}`).join('')}`
    })
  }
  // Safari's engine (iOS stand-in), when Playwright's WebKit is installed.
  if (!args['skip-webkit']) {
    const wk = sh('node', ['tools/harness/run.mjs', '--engine', 'webkit', '--out', relative(ROOT, join(OUT, 'harness-webkit')), '--profiles', 'mobile-light,desktop-dark'])
    let wkr = []
    try {
      wkr = JSON.parse(readFileSync(join(OUT, 'harness-webkit', 'results.json'), 'utf8'))
    } catch {
      wkr = []
    }
    checks.push({
      name: 'Harness on WebKit (Safari engine, phone + desktop)',
      ok: wk.code === 0 && wkr.length > 0,
      detail: `${wkr.filter((h) => h.pass).length} / ${wkr.length} passed${wkr.filter((h) => !h.pass).map((h) => `\n✗ ${h.profile} ${h.file}: ${h.state} ${h.checkError ?? ''} ${(h.errors ?? []).join('; ').slice(0, 160)}`).join('')}`
    })
  }
  // Damaged inputs: every fuzzed file must settle (ready or a friendly error) without page errors.
  if (!args['skip-fuzz']) {
    sh('node', ['tools/make-fuzz.mjs'])
    const fz = sh('node', ['tools/harness/run.mjs', '--dir', 'samples/fuzz', '--fuzz', '--no-shots', '--profiles', 'desktop-dark', '--timeout', '15000', '--out', relative(ROOT, join(OUT, 'fuzz'))])
    let fuzz = []
    try {
      fuzz = JSON.parse(readFileSync(join(OUT, 'fuzz', 'results.json'), 'utf8'))
    } catch {
      fuzz = []
    }
    const bad = fuzz.filter((h) => !h.pass)
    checks.push({
      name: 'Fuzz: damaged inputs settle without page errors',
      ok: fz.code === 0 && fuzz.length > 0,
      detail: `${fuzz.length - bad.length} / ${fuzz.length} settled (${fuzz.filter((h) => h.state === 'error').length} as friendly errors)${bad.map((h) => `\n✗ ${h.file}: ${h.state} ${h.checkError ?? ''} ${(h.errors ?? []).join('; ').slice(0, 160)}`).join('')}`
    })
  }
  checks.push({
    name: 'Harness without rAF/IntersectionObserver (hidden window)',
    ok: nr.code === 0 && noRaf.length > 0,
    detail: `${noRaf.filter((h) => h.pass).length} / ${noRaf.length} passed${noRaf.filter((h) => !h.pass).map((h) => `\n✗ ${h.file}: ${h.state} ${h.checkError ?? ''}`).join('')}`
  })
}

// 6. Real Orca: screenshots of each fixture in the plugin's own editor
const orca = []
if (!args['skip-orca']) {
  mkdirSync(join(OUT, 'orca'), { recursive: true })
  const files = readdirSync(join(ROOT, 'samples')).filter((f) => statSync(join(ROOT, 'samples', f)).isFile()).sort()
  const sizes = [
    ['desktop', []],
    ['narrow', ['--width', '390', '--height', '844']]
  ]
  for (const f of files) {
    for (const [label, extra] of sizes) {
      const shot = `${f}.${label}.png`
      // `plugin shot` mounts a fresh editor frame and captures at its first paint, so slower
      // renderers (PDF, DOCX) may still show the loading state: this pass proves the editor mounts
      // in Orca without errors. Finished renders are captured below from real, open tabs.
      const r = sh(ORCA, ['plugin', 'shot', pluginKey, '--editor', `samples/${f}`, '--out', relative(ROOT, join(OUT, 'orca', shot)), '--json', ...extra])
      const j = json(r.out)
      const native = /not on screen/i.test(j?.error?.message ?? '')
      const expectError = f.startsWith('broken.')
      const errors = j?.result?.errors ?? (j?.error ? [j.error.message] : [])
      orca.push({
        file: f,
        size: label,
        editorId: j?.result?.editorId ?? null,
        ok: native ? null : r.code === 0 || (expectError && existsSync(join(OUT, 'orca', shot))),
        nativeToggle: native,
        shot: native ? null : shot,
        errors: expectError ? [] : errors
      })
      console.log(`${native ? 'TOGGLE' : r.code === 0 ? 'OK    ' : expectError ? 'ERR-OK' : 'FAIL  '} orca ${label.padEnd(7)} ${f}`)
    }
  }
  const real = orca.filter((o) => o.ok !== null)
  checks.push({
    name: 'Orca app: editor mounts without errors (plugin shot)',
    ok: real.every((o) => o.ok),
    detail: `${real.filter((o) => o.ok).length} / ${real.length} mounted in Orca; ${orca.filter((o) => o.nativeToggle).length} open in Orca's own view first (preview via the view toggle)`
  })

  // Finished renders from real tabs: open, wait, capture the window, crop to the editor area
  // (the crop box assumes the left/right sidebars at their default widths; --crop x0,y0,x1,y1).
  // Curated so only a few tabs stay open in the person's Orca.
  const curated = (typeof args.window === 'string' ? args.window.split(',') : ['sample.docx', 'sample.pptx', 'sample.xlsx', 'sample.pdf', 'sample.doc', 'sample.ppt'])
  const crop = typeof args.crop === 'string' ? args.crop.split(',').map(Number) : [280, 0, 1965, 1005]
  const py = process.env.FP_PYTHON
  for (const f of curated) {
    const raw = join(OUT, 'orca', `${f}.window-raw.png`)
    const shot = `${f}.window.png`
    sh(ORCA, ['plugin', 'open', pluginKey, '--editor', `samples/${f}`, '--json'])
    await new Promise((res) => setTimeout(res, Number(args['orca-wait']) || 5000))
    const r = sh(ORCA, ['plugin', 'shot', pluginKey, '--window', '--out', relative(ROOT, raw), '--json'])
    let cropped = false
    if (r.code === 0 && py) {
      const c = sh(py, [join(ROOT, 'tools', 'crop.py'), raw, join(OUT, 'orca', shot), ...crop.map(String)], { shell: false })
      cropped = c.code === 0
      if (cropped) rmSync(raw, { force: true })
    }
    orca.push({ file: f, size: 'window', editorId: null, ok: r.code === 0, nativeToggle: false, shot: cropped ? shot : null, errors: [] })
    console.log(`${r.code === 0 ? 'OK    ' : 'FAIL  '} orca window  ${f}${cropped ? '' : ' (not cropped: set FP_PYTHON to a Python with Pillow)'}`)
  }
}

let commit = ''
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
} catch {
  // not a git checkout
}
const summary = {
  round: Number(round),
  date: new Date().toISOString(),
  commit,
  orcaVersion: sh(ORCA, ['--version']).out.trim().split('\n').pop(),
  platform: `${process.platform} ${process.arch}`,
  durationMs: Date.now() - started,
  checks,
  harness,
  orca
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail.split('\n')[0]}`)
console.log(`\nround ${round} → ${relative(ROOT, OUT)}`)
process.exitCode = checks.every((c) => c.ok) ? 0 : 1
