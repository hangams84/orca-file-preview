// Captures the CAD Drawing Preview's canvas for 2D CAD files, one PNG per view (model space,
// each layout or sheet), through the browser harness (same CSP as Orca's frame).
//
//   node tools/cad2d/shoot.mjs --out docs/evidence/cad2d/views samples/sample.dxf samples/sample.dwf
//   node tools/cad2d/shoot.mjs --theme light --size 1000x700 --stage-only --out .orca/fid samples/cad2d/*.dxf
import { spawn } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return def
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return false
  argv.splice(i, 1)
  return true
}
const out = join(ROOT, opt('out', '.orca/cad2d-shots'))
const theme = opt('theme', 'dark')
const locale = opt('locale', 'ko')
const [vw, vh] = opt('size', '1280x800').split('x').map(Number)
const stageOnly = flag('stage-only')
const allViews = !flag('first-view')
const files = argv
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, [join(ROOT, 'tools/harness/run.mjs'), '--serve', '--port', '0'], { cwd: ROOT })
const base = await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => {
    const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(String(d))
    if (m) resolve(m[1])
  })
  server.on('exit', () => reject(new Error('harness server exited')))
})

const { chromium } = await import('playwright-core')
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
})
const browser = await chromium.launch({ executablePath: exe, headless: true })
const ctx = await browser.newContext({ viewport: { width: vw, height: vh } })
const report = []
for (const f of files) {
  const rel = relative(ROOT, join(process.cwd(), f)).replace(/\\/g, '/')
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const t0 = Date.now()
  await page.goto(`${base}/harness?file=${encodeURI(rel)}&theme=${theme}&locale=${locale}`)
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 60000 })
  const ms = Date.now() - t0
  const state = await page.evaluate(() => document.body.dataset.state)
  const views = state === 'ready' ? await page.evaluate(() => window.__cad2d?.scene.views.map((v) => v.name) ?? []) : []
  if (stageOnly) await page.addStyleTag({ content: '.cad-notice{display:none!important}' })
  const n = allViews ? Math.max(1, views.length) : 1
  for (let i = 0; i < n; i++) {
    if (views.length) {
      await page.evaluate((i) => window.__cad2d.setView(i), i)
      await page.waitForTimeout(250)
    }
    const name = `${basename(f)}${n > 1 ? `.${i}` : ''}.png`
    const target = stageOnly ? page.locator('.cad-stage canvas') : page
    await target.screenshot({ path: join(out, name) })
    const paint = await page.evaluate(() => Number(document.body.dataset.cadPaintMs ?? -1))
    report.push({ file: rel, view: views[i] ?? null, state, loadMs: ms, paintMs: paint, shot: name, errors: [...errors] })
    console.log(`${state.padEnd(6)} ${rel} ${views[i] ?? ''} load ${ms} ms, paint ${paint} ms${errors.length ? ' errors: ' + errors.join(' | ') : ''}`)
  }
  await page.close()
}
writeFileSync(join(out, 'shots.json'), JSON.stringify(report, null, 2))
await browser.close()
server.kill()
