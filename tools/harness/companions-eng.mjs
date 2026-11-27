// Companion files for the engineering viewers (KiCad hierarchy, SolidWorks assemblies and drawings, EPLAN link
// files and macros), in the browser harness: the 📁 button's folder picker is answered with Playwright's file
// chooser (`setFiles` with a directory, like webkitdirectory), and drops are synthetic DataTransfer drops.
// Each case checks what the viewer shows and records page/console errors; screenshots go to --out.
//
//   node tools/harness/companions-eng.mjs [--out dir] [--only kicad,sw,eplan] [--locale en|ko] [--local]
// --local adds cases on public files downloaded to .orca/ (git-ignored; see docs/evidence/companions-eng/README.md).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { launch, parseArgs, ROOT, serve } from './lib.mjs'
import { orcaRoute, routeQuery } from './route.mjs'

const args = parseArgs()
const OUT = join(ROOT, typeof args.out === 'string' ? args.out : '.orca/companions-eng')
mkdirSync(OUT, { recursive: true })
const locale = typeof args.locale === 'string' ? args.locale : 'en'
const only = typeof args.only === 'string' ? args.only.split(',') : null

const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })

async function open(page, file, theme = 'light') {
  await page.goto(`${base}/harness?file=${encodeURIComponent(file)}&theme=${theme}&locale=${locale}${routeQuery(orcaRoute(ROOT, 'plugin', file))}`, { waitUntil: 'load' })
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 60000, polling: 100 })
  return page.evaluate(() => document.body.dataset.state)
}

const info = (page) => page.locator('.fp-toolbar .fp-info').first().textContent()
const folderButton = (page, scope = page.locator('.fp-toolbar')) => scope.locator('button', { hasText: '📁' }).first()

/** Clicks 📁 and answers the folder picker with `dir` (relative to the repo). */
async function pickFolder(page, dir, scope) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), folderButton(page, scope).click()])
  await chooser.setFiles(join(ROOT, dir))
}

/** Drops `files` (repo-relative) on `selector` as a synthetic drag-and-drop. */
async function dropFiles(page, files, selector = '.fp-content') {
  await page.evaluate(
    async ({ files, selector }) => {
      const dt = new DataTransfer()
      for (const f of files) {
        const r = await fetch(`/${f}`)
        dt.items.add(new File([await r.arrayBuffer()], f.split('/').pop()))
      }
      const target = document.querySelector(selector) ?? document.body
      // The drop target is the preview root; dispatch on the deepest root-like element.
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { files, selector }
  )
}

const CASES = []
const add = (group, name, file, run, local = false) => CASES.push({ group, name, file, run, local })

// --- KiCad -------------------------------------------------------------------------------------------------
add('kicad', 'hierarchy-folder', 'samples/kicad-project/demo.kicad_sch', async (page, r) => {
  r.before = await info(page)
  await pickFolder(page, 'samples/kicad-project')
  await page.waitForFunction(() => document.querySelectorAll('.fp-toolbar select option').length >= 5, null, { timeout: 15000 })
  r.options = await page.locator('.fp-toolbar select').first().locator('option').allTextContents()
  await r.shot('root')
  const sel = page.locator('.fp-toolbar select').first()
  await sel.selectOption({ index: 2 })
  await page.waitForTimeout(400)
  r.channelB = await info(page)
  await r.shot('channel-b')
  await sel.selectOption({ index: 4 })
  await page.waitForTimeout(400)
  r.regulator = await info(page)
  await r.shot('regulator')
  await page.locator('.fp-toolbar button', { hasText: '↑' }).click()
  await page.waitForTimeout(300)
  r.up = await info(page)
  r.check(/Channel B/.test(r.channelB) && /page 3/.test(r.channelB), 'Channel B with page 3')
  r.check(/Regulator/.test(r.regulator) && /page 5/.test(r.regulator), 'Regulator with page 5')
  r.check(/Power/.test(r.up) && !/Regulator/.test(r.up), 'Up goes to Power')
  r.check(r.options.length === 5, '5 sheets listed')
})
add('kicad', 'hierarchy-drop-missing', 'samples/kicad-project/demo.kicad_sch', async (page, r) => {
  await dropFiles(page, ['samples/kicad-project/channel.kicad_sch'])
  await page.waitForFunction(() => /not available/.test(document.querySelector('.kc-note')?.textContent ?? ''), null, { timeout: 15000 })
  r.notice = (await page.locator('.kc-note').textContent()).replace(/\s+/g, ' ')
  await r.shot('missing')
  r.check(/power\.kicad_sch: not among the given files/.test(r.notice), 'missing power sheet listed')
  r.check(/Hint:/.test(r.notice), 'hint shown')
})
add('kicad', 'project-open-schematic', 'samples/kicad-project/demo.kicad_pro', async (page, r) => {
  await pickFolder(page, 'samples/kicad-project')
  const btn = page.locator('.kp-files button', { hasText: 'Root schematic' })
  await btn.waitFor({ timeout: 10000 })
  r.check(await btn.isEnabled(), 'root schematic button enabled')
  r.check(await page.locator('.kp-files button', { hasText: 'Board' }).isDisabled(), 'board button disabled (no board in the sample)')
  await r.shot('project')
  await btn.click()
  await page.locator('.fp-prop-embed svg').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
  r.embedded = await page.locator('.fp-prop-embed-bar .info').textContent()
  await r.shot('root-schematic')
  r.check(/demo\.kicad_sch/.test(r.embedded), 'root schematic opened')
})

// --- run --------------------------------------------------------------------------------------------------
const results = []
for (const c of CASES) {
  if (only && !only.includes(c.group)) continue
  if (c.local && !args.local) continue
  if (!existsSync(join(ROOT, c.file))) {
    console.log(`SKIP ${c.group}/${c.name}: ${c.file} not found`)
    continue
  }
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  const r = { group: c.group, name: c.name, file: c.file, checks: [], errors, shots: [] }
  r.check = (ok, what) => r.checks.push({ ok: !!ok, what })
  r.shot = async (label) => {
    const f = `${c.group}-${c.name}-${label}.png`
    await page.screenshot({ path: join(OUT, f) })
    r.shots.push(f)
  }
  const t0 = Date.now()
  try {
    r.state = await open(page, c.file)
    r.check(r.state === 'ready', 'opened')
    r.check(await folderButton(page).count(), '📁 button present')
    await c.run(page, r)
  } catch (e) {
    errors.push(`harness: ${e.message.split('\n')[0]}`)
    await r.shot('failure').catch(() => {})
  }
  r.ms = Date.now() - t0
  r.pass = !errors.length && r.checks.every((x) => x.ok)
  delete r.check
  delete r.shot
  results.push(r)
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${c.group}/${c.name} ${r.ms}ms ${r.checks.filter((x) => !x.ok).map((x) => '✗ ' + x.what).join('; ')} ${errors.join('; ')}`)
  await page.close()
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
await browser.close()
server.close()
const failed = results.filter((r) => !r.pass).length
console.log(`${results.length - failed}/${results.length} passed → ${relative(ROOT, OUT)}`)
process.exit(failed ? 1 : 0)
