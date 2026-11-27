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
const add = (group, name, file, run, local = false, opts = {}) => CASES.push({ group, name, file, run, local, ...opts })

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

// --- SolidWorks ------------------------------------------------------------------------------------------
const panel = (page) => page.locator('.fp-prop-panel:not([hidden])')
async function tab(page, label) {
  await page.locator('.fp-prop-tabs button', { hasText: label }).click()
  await page.waitForTimeout(300)
}
async function canvasNote(page) {
  await panel(page).locator('canvas').waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  return ((await panel(page).locator('.fp-prop-note').allTextContents()) ?? []).join(' | ')
}
add('sw', 'assembly-stored-then-folder', 'samples/sw-assembly/Orca-Frame.SLDASM', async (page, r) => {
  await tab(page, '3D assembly')
  r.before = await canvasNote(page)
  await r.shot('stored-only')
  await pickFolder(page, 'samples/sw-assembly')
  await page.waitForFunction(() => /\(2 from the display meshes stored in the assembly, 1 from given/.test(document.querySelector('.fp-prop-panel:not([hidden])')?.textContent ?? ''), null, { timeout: 30000 })
  r.after = await canvasNote(page)
  await r.shot('with-parts')
  r.check(/^2 of 5 components placed/.test(r.before), 'stored meshes place 2 of 5')
  r.check(/3 of 5 components placed .*1 from given part files/.test(r.after), 'the given rail fills the third')
  r.check(/Hidden or suppressed components \(2/.test(await panel(page).textContent()), 'hidden + suppressed listed')
  await tab(page, 'References')
  r.placement = (await panel(page).textContent()).replace(/\s+/g, ' ')
  r.check(/Orca-Bracket-2.*\(300, 0, 40\)/.test(r.placement), 'placement table: Bracket-2 at (300, 0, 40) mm')
})
add('sw', 'assembly-2014-drop', 'samples/sw-assembly/Orca-Frame-2014.SLDASM', async (page, r) => {
  await tab(page, '3D assembly')
  await page.waitForTimeout(500)
  r.before = (await panel(page).textContent()).replace(/\s+/g, ' ')
  await dropFiles(page, ['samples/sw-assembly/Orca-Bracket.SLDPRT', 'samples/sw-assembly/Orca-Rail.SLDPRT'])
  r.after = await canvasNote(page)
  await r.shot('dropped-parts')
  r.check(/0 of 5 components placed|Nothing to draw/.test(r.before), 'no stored meshes in the OLE file')
  r.check(/3 of 5 components placed .*\(0 from the display meshes stored in the assembly, 3 from given/.test(r.after), 'all three visible parts from the dropped files')
})
add('sw', 'drawing-model-links', 'samples/sw-assembly/Orca-Frame.SLDDRW', async (page, r) => {
  await pickFolder(page, 'samples/sw-assembly')
  await tab(page, 'References')
  const open = panel(page).locator('button', { hasText: 'Open' })
  await open.first().waitFor({ timeout: 10000 })
  r.openButtons = await open.count()
  r.text = (await panel(page).textContent()).replace(/\s+/g, ' ')
  await r.shot('references')
  r.check(r.openButtons === 2, 'two models given → two Open buttons')
  r.check(/Missing-Plate\.SLDPRT.*not given/.test(r.text), 'missing model marked')
  await open.first().click()
  await page.locator('.fp-prop-embed .fp-prop-embed-bar .info').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(800)
  r.opened = await page.locator('.fp-prop-embed .fp-prop-embed-bar .info').first().textContent()
  await r.shot('opened-part')
  r.check(/Orca-Bracket\.SLDPRT/.test(r.opened), 'part opened in the overlay')
})
add(
  'sw',
  'jaw-real-stored',
  '.orca/sw/jaw/jaw.SLDASM',
  async (page, r) => {
    await tab(page, '3D assembly')
    r.note = await canvasNote(page)
    await r.shot('3d')
    r.check(/^12 of 12 components placed .*\(12 from the display meshes/.test(r.note), 'all 12 from stored meshes')
  },
  true
)

// --- EPLAN ------------------------------------------------------------------------------------------------
add('eplan', 'link-folder', 'samples/eplan-project/Plant.elk', async (page, r) => {
  r.before = (await panel(page).textContent()).replace(/\s+/g, ' ')
  r.check(/Pick the project folder \(\.edb/.test(r.before), 'hint to pick the .edb folder')
  await pickFolder(page, 'samples/eplan-project')
  await page.locator('.fp-prop-tabs button', { hasText: 'Parts' }).waitFor({ timeout: 15000 })
  r.tabs = await page.locator('.fp-prop-tabs button').allTextContents()
  r.overview = (await panel(page).textContent()).replace(/\s+/g, ' ')
  await r.shot('overview')
  await tab(page, 'Pages')
  await page.waitForTimeout(300)
  r.pages = (await panel(page).textContent()).replace(/\s+/g, ' ')
  await tab(page, 'Parts')
  await panel(page).locator('li').first().waitFor({ timeout: 10000 })
  r.parts = await panel(page).locator('li').allTextContents()
  await r.shot('parts')
  r.check(/Filling plant/.test(r.overview) && /folder "[^"]*Plant\.edb"/.test(r.overview), 'project properties from the folder')
  r.check(/Pump motor/.test(r.pages) && /PLC inputs/.test(r.pages), 'page descriptions')
  r.check(r.parts.length === 5 && r.parts.some((p) => /ORCA\.PUMP-2K2.*Pump motor/.test(p)), '5 parts incl. a zlib-compressed record')
})
add('eplan', 'macro-ema', 'samples/sample-terminal.ema', async (page, r) => {
  r.info = await info(page)
  await page.locator('.fp-content svg path.px').first().waitFor({ timeout: 10000 })
  r.paths = await page.locator('.fp-content svg path').count()
  r.texts = await page.locator('.fp-content svg text').allTextContents()
  await r.shot('variant-1')
  await page.locator('.fp-toolbar select').first().selectOption({ index: 1 })
  await page.waitForTimeout(300)
  r.info2 = await info(page)
  await r.shot('variant-2')
  r.check(/Orca-Terminal/.test(r.info) && /Representation 1/.test(r.info), 'macro and variant named')
  r.check(r.texts.includes('-X1') && r.texts.includes('Jumper'), 'texts drawn')
  r.check(/Representation 4/.test(r.info2), 'second variant')
}, false, { noFolder: true })
add('eplan', 'edz-macro-draw', 'samples/sample.edz', async (page, r) => {
  await tab(page, 'Parts')
  await panel(page).locator('button', { hasText: 'Draw' }).first().waitFor({ timeout: 15000 })
  await panel(page).locator('button', { hasText: 'Draw' }).first().click()
  await page.locator('.fp-prop-embed svg path.px').first().waitFor({ timeout: 10000 })
  r.embedded = await page.locator('.fp-prop-embed-bar .info').first().textContent()
  await r.shot('macro')
  r.check(/TB-100\.ema/.test(r.embedded), 'macro opened from the part package')
}, false, { noFolder: true })
add(
  'eplan',
  'macro-real',
  '.orca/bach/AI204_1.ema',
  async (page, r) => {
    await page.locator('.fp-content svg path.px').first().waitFor({ timeout: 20000 })
    await page.waitForTimeout(500)
    r.info = await info(page)
    await r.shot('variant-1')
    r.check(/AI204_1/.test(r.info), 'real macro drawn')
  },
  true,
  { noFolder: true }
)
add(
  'eplan',
  'link-folder-real',
  '.orca/eplan/graphical_edit/cdp_place_only.elk',
  async (page, r) => {
    await pickFolder(page, '.orca/eplan/graphical_edit')
    await page.locator('.fp-prop-tabs button', { hasText: 'Parts' }).waitFor({ timeout: 30000 })
    r.overview = (await panel(page).textContent()).replace(/\s+/g, ' ')
    await r.shot('overview')
    await tab(page, 'Pages')
    await page.waitForTimeout(800)
    r.pageCount = await panel(page).locator('li').count()
    await r.shot('pages')
    await tab(page, 'Parts')
    await panel(page).locator('li').first().waitFor({ timeout: 20000 })
    r.partCount = await panel(page).locator('li').count()
    await r.shot('parts')
    r.check(/cdp_place_only\.edb/.test(r.overview), 'folder used although the link names another .edb')
    r.check(r.pageCount > 10 && r.partCount > 50, `pages ${r.pageCount}, parts ${r.partCount}`)
  },
  true
)

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
    if (!c.noFolder) r.check(await folderButton(page).count(), '📁 button present')
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
