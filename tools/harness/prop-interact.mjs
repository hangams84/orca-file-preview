// Walks every tab of the SolidWorks / EPLAN / inspector pages (editor/renderers/solidworks.ts,
// eplan.ts, prop/*), opens the 3D display mesh, embedded pictures and PDF documents, and records
// page errors, warnings shown to the reader and what each file shows. Screenshots and results.json
// go to --out (default .orca/prop-interact).
//
//   node tools/harness/prop-interact.mjs [--out dir] [--files a,b,...] [--locale en|ko] [--no-shots]
// Default files: the prop samples in samples/ plus anything under .orca/corpus/{sw,eplan} (local,
// git-ignored downloads; see docs/evidence/prop/README.md).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { launch, parseArgs, ROOT, serve } from './lib.mjs'

const args = parseArgs()
const OUT = join(ROOT, typeof args.out === 'string' ? args.out : '.orca/prop-interact')
mkdirSync(OUT, { recursive: true })
const EXT = /\.(sldprt|sldasm|slddrw|slddrt|prtdot|asmdot|drwdot|elk|ell|elr|els|elp|elx|ela|zw1|zx1|edz)$/i
const MAX_BYTES = 120 * 1024 * 1024

function defaultFiles() {
  const out = readdirSync(join(ROOT, 'samples'))
    .filter((f) => EXT.test(f))
    .map((f) => `samples/${f}`)
  for (const dir of ['.orca/corpus/sw', '.orca/corpus/eplan', '.orca/corpus/eplan/ia/artifacts/graphical_edit']) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs)) if (EXT.test(f) && statSync(join(abs, f)).isFile() && statSync(join(abs, f)).size <= MAX_BYTES) out.push(`${dir}/${f}`)
  }
  return out
}

const files = typeof args.files === 'string' ? args.files.split(',') : defaultFiles()
const locale = typeof args.locale === 'string' ? args.locale : 'en'
const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
const results = []
const safe = (s) => s.replace(/[^\w.-]+/g, '_').slice(-80)

async function shot(page, name) {
  if (args['no-shots']) return null
  const file = `${name}.png`
  await page.locator('body').screenshot({ path: join(OUT, file) })
  return file
}

for (const file of files) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  const t0 = Date.now()
  const r = { file, state: '', ms: 0, info: '', tabs: [], warnings: [], errors, shots: [] }
  try {
    await page.goto(`${base}/harness?file=${encodeURIComponent(file)}&theme=light&locale=${locale}`)
    await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 180000, polling: 100 })
    r.ms = Date.now() - t0
    r.state = await page.evaluate(() => document.body.dataset.state)
    r.info = await page.locator('.fp-toolbar .fp-info').textContent().catch(() => '')
    const name = safe(file.split('/').pop())
    r.shots.push(await shot(page, `${name}.0-first`))
    const tabs = await page.locator('.fp-prop-tabs button').allTextContents()
    for (let i = 0; i < tabs.length; i++) {
      const tab = { label: tabs[i], text: '', ok: true, detail: '' }
      await page.locator('.fp-prop-tabs button').nth(i).click()
      await page.waitForTimeout(400)
      const panel = page.locator('.fp-prop-panel:not([hidden])')
      if (/3D/.test(tabs[i])) {
        // The display mesh viewer: a canvas inside the panel.
        const canvas = panel.locator('canvas')
        try {
          await canvas.waitFor({ timeout: 20000 })
          await page.waitForTimeout(800)
          tab.detail = (await panel.locator('.fp-prop-embed-bar .info').textContent()) ?? ''
        } catch {
          tab.ok = false
          tab.detail = (await panel.textContent())?.slice(0, 200) ?? 'no canvas'
        }
      }
      tab.text = ((await panel.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 400)
      r.shots.push(await shot(page, `${name}.${i + 1}-${safe(tabs[i])}`))
      // Open the first document (PDF) and the first picture of an EDZ part.
      const open = panel.locator('ul.fp-prop-list button.fp-prop-btn').first()
      if (await open.count()) {
        await open.click()
        await page.waitForTimeout(2500)
        const overlay = page.locator('.fp-prop-embed')
        tab.detail += ` · opened document: ${(await overlay.locator('.fp-prop-embed-bar .info').textContent().catch(() => '')) ?? ''}`
        const failed = await overlay.locator('.fp-state[role="alert"]').count()
        if (failed) {
          tab.ok = false
          tab.detail += ' (failed)'
        }
        r.shots.push(await shot(page, `${name}.${i + 1}b-document`))
        await overlay.locator('.fp-prop-embed-bar button').first().click()
      }
      tab.warnings = await panel.locator('.fp-prop-note.warn').allTextContents()
      r.tabs.push(tab)
    }
    r.warnings = [...new Set(r.tabs.flatMap((t) => t.warnings))]
  } catch (e) {
    r.state = r.state || 'timeout'
    errors.push(`harness: ${e.message}`)
  }
  r.pass = r.state === 'ready' && !errors.length && r.tabs.every((t) => t.ok)
  results.push(r)
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${file} ${r.state} ${r.ms}ms tabs=${r.tabs.map((t) => t.label + (t.ok ? '' : '!')).join('|')} ${errors.join('; ')}`)
  await page.close()
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
await browser.close()
server.close()
const failed = results.filter((r) => !r.pass).length
console.log(`${results.length - failed}/${results.length} passed → ${relative(ROOT, OUT)}`)
process.exit(failed ? 1 : 0)
