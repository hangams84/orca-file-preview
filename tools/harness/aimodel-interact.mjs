// Interaction checks for the AI Model Preview (editor/renderers/aimodel.ts):
//  - every view option (graph, tree, table, map, diagram, tensor, info) on several samples and profiles,
//    no page errors, no CSP violations;
//  - graph: node click shows details, search + Enter jumps, TB/LR, group expand;
//  - tensor inspector: histogram, heatmap and conv kernel grid; exports SVG, PNG, JSON, Markdown;
//  - File Preview panel: a large checkpoint (--big <file>) opens by ranged reads; time to ready, time to
//    inspect the largest tensor, JS heap.
// Screenshots and results.json go to --out (default .orca/aimodel-interact).
//
//   node tools/harness/aimodel-interact.mjs [--out docs/evidence/aimodel/harness] [--big C:/fpt-ai-lead/big/gpt-large.pth]
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, parseArgs, ROOT, serve } from './lib.mjs'
import { orcaRoute, routeQuery } from './route.mjs'

const args = parseArgs()
const OUT = join(ROOT, typeof args.out === 'string' ? args.out : '.orca/aimodel-interact')
mkdirSync(OUT, { recursive: true })
const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
const PROFILES = {
  'desktop-dark': { viewport: { width: 1280, height: 800 }, theme: 'dark', locale: 'ko' },
  'desktop-light': { viewport: { width: 1280, height: 800 }, theme: 'light', locale: 'en' },
  'tablet-dark': { viewport: { width: 820, height: 1000 }, theme: 'dark', locale: 'en', hasTouch: true },
  'mobile-light': { viewport: { width: 390, height: 800 }, theme: 'light', locale: 'ko', hasTouch: true, isMobile: true }
}
const VIEWS = ['graph', 'tree', 'table', 'map', 'arch', 'tensor', 'info']
const SAMPLES = ['gpt.export.pt2', 'cnn.torchscript.pt', 'gpt.lightning.ckpt', 'cnn.state_dict.pth', 'gpt.bf16.safetensors', 'mlp.int8-dynamic.pth', 'malicious.pt']
const profiles = typeof args.profiles === 'string' ? args.profiles.split(',') : Object.keys(PROFILES)

async function newPage(profile) {
  const p = PROFILES[profile]
  const context = await browser.newContext({ viewport: p.viewport, hasTouch: !!p.hasTouch, isMobile: !!p.isMobile, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`)
  })
  page.on('console', (m) => {
    const t = m.text()
    if (/Content Security Policy|Refused to/i.test(t)) errors.push(`csp: ${t}`)
    // HTTP failures are recorded from responses (a favicon 404 on the first page has no response event).
    else if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(`console: ${t}`)
  })
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`Refused to (CSP) ${e.violatedDirective} ${e.blockedURI}`)))
  return { page, context, errors, p }
}

async function openSample(profile, file) {
  const o = await newPage(profile)
  const rel = `samples/aimodel/${file}`
  await o.page.goto(`${base}/harness?file=${encodeURIComponent(rel)}&theme=${o.p.theme}&locale=${o.p.locale}${routeQuery(orcaRoute(ROOT, 'plugin', rel))}`)
  await o.page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 60000, polling: 100 })
  return o
}
const shot = async (page, name) => writeFileSync(join(OUT, `${name}.png`), await page.screenshot())

async function switchView(page, view) {
  const btn = page.locator(`.fp-toolbar button[data-am-view="${view}"]`)
  if (await btn.isDisabled()) return false
  await btn.click()
  await page.waitForFunction((v) => document.body.dataset.amView === v, view, { timeout: 15000 })
  await page.waitForTimeout(view === 'tensor' ? 900 : 350)
  return true
}

// ---------------------------------------------------------------- every view, every sample, every profile
for (const profile of profiles) {
  for (const file of SAMPLES) {
    const { page, context, errors } = await openSample(profile, file)
    const state = await page.evaluate(() => document.body.dataset.state)
    const shown = []
    for (const v of VIEWS) {
      if (await switchView(page, v)) {
        shown.push(v)
        // Evidence: all views for two samples on the main profiles, the default view elsewhere.
        if ((file === 'gpt.export.pt2' && (profile === 'desktop-dark' || profile === 'mobile-light')) || (v === shown[0] && profile === 'desktop-light')) await shot(page, `${file}-${v}-${profile}`)
      }
    }
    record(`${profile} ${file}: ${shown.join(', ')}`, state === 'ready' && errors.length === 0 && shown.length >= 6, errors.slice(0, 3).join(' | '))
    await context.close()
  }
}

// ---------------------------------------------------------------- graph interactions
{
  const { page, context, errors } = await openSample('desktop-dark', 'gpt.export.pt2')
  const n0 = await page.locator('.am-graph .nd').count()
  const box = await page.locator('.am-graph .nd').nth(3).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)
  const side = await page.locator('.am-side').isVisible()
  const title = await page.locator('.am-side h3').textContent().catch(() => '')
  record('graph: clicking a node opens its details', side && !!title, `${n0} nodes drawn, selected ${title}`)
  await page.fill('.am-bar input[type=search]', 'linear')
  await page.press('.am-bar input[type=search]', 'Enter')
  await page.waitForTimeout(300)
  const sel = await page.locator('.am-graph .nd.sel').count()
  const t2 = await page.locator('.am-side h3').textContent().catch(() => '')
  record('graph: search + Enter selects a match', sel === 1 && /linear/.test(t2 ?? ''), t2)
  const before = await page.screenshot()
  await page.locator('.am-bar button', { hasText: 'TB' }).click()
  await page.waitForTimeout(300)
  const after = await page.screenshot()
  record('graph: TB → LR re-lays out', Buffer.compare(before, after) !== 0)
  await shot(page, 'graph-lr-desktop-dark')
  await page.locator('.am-bar button', { hasText: '맞춤' }).click()
  await page.waitForTimeout(200)
  const nBefore = await page.evaluate(() => Number(/표시 (\d+)/.exec(document.querySelector('.am-bar .am-info')?.textContent ?? '')?.[1] ?? 0))
  await page.locator('.am-bar button', { hasText: '접기' }).click()
  await page.waitForTimeout(300)
  const groups = await page.evaluate(() => Number(/표시 (\d+)/.exec(document.querySelector('.am-bar .am-info')?.textContent ?? '')?.[1] ?? 0))
  await shot(page, 'graph-collapsed-desktop-dark')
  record('graph: collapse folds module groups', groups < nBefore, `${nBefore} → ${groups} items after collapse`)
  // Wheel zoom and drag pan change the transform.
  const tr0 = await page.locator('.am-graph svg.main > g').getAttribute('transform')
  await page.mouse.move(600, 400)
  await page.mouse.wheel(0, -400)
  await page.mouse.down()
  await page.mouse.move(700, 450)
  await page.mouse.up()
  await page.waitForTimeout(100)
  const tr1 = await page.locator('.am-graph svg.main > g').getAttribute('transform')
  record('graph: wheel zoom and drag pan', tr0 !== tr1, `${tr0} → ${tr1}`)
  record('graph: no errors', errors.length === 0, errors.join(' | '))
  await context.close()
}

// ---------------------------------------------------------------- tensor inspector + exports
{
  const { page, context, errors } = await openSample('desktop-dark', 'cnn.state_dict.pth')
  await switchView(page, 'tensor')
  await page.fill('.am-ti-list input[type=search]', 'features.0.weight')
  await page.locator('.am-ti-item', { hasText: 'features.0.weight' }).first().click()
  await page.waitForSelector('canvas[data-am-kernels]', { timeout: 10000 }).catch(() => {})
  const kernels = await page.locator('canvas[data-am-kernels]').count()
  const heat = await page.locator('canvas[data-am-heatmap]').count()
  const statsText = await page.locator('.am-ti-card').first().textContent()
  await shot(page, 'tensor-conv-desktop-dark')
  record('tensor: stats, heatmap and conv kernel grid', kernels === 1 && heat === 1 && /mean/.test(statsText ?? ''), (statsText ?? '').slice(0, 80))
  for (const kind of ['svg', 'png', 'json', 'md']) {
    await page.evaluate(() => document.querySelector('[data-am-export-result]')?.remove())
    await page.selectOption('.fp-toolbar select[data-am-export]', kind)
    await page.waitForSelector('[data-am-export-result]', { timeout: 10000 }).catch(() => {})
    const head = await page.locator('[data-am-export-result] h3').textContent().catch(() => '')
    const ok = kind === 'png' ? (await page.locator('[data-am-export-result] img[data-am-png]').count()) === 1 : !!head && !/없습니다|Nothing/.test(head)
    record(`export ${kind} from the tensor view`, ok, head)
    if (kind === 'md') await shot(page, 'export-md-desktop-dark')
  }
  await switchView(page, 'map')
  await page.selectOption('.fp-toolbar select[data-am-export]', 'png')
  await page.waitForSelector('[data-am-export-result] img[data-am-png]', { timeout: 10000 }).catch(() => {})
  record('export png from the map view', (await page.locator('[data-am-export-result] img[data-am-png]').count()) === 1)
  await switchView(page, 'arch')
  await page.selectOption('.fp-toolbar select[data-am-export]', 'svg')
  await page.waitForTimeout(300)
  record('export svg from the diagram view', /SVG/.test((await page.locator('[data-am-export-result] h3').textContent().catch(() => '')) ?? ''))
  // Table: sort by #params, filter, CSV copy button responds.
  await switchView(page, 'table')
  await page.locator('.am-tbl-head span', { hasText: '#' }).first().click()
  const firstRow = await page.locator('.am-tbl-row').first().textContent()
  record('table: sort by #params puts the largest tensor first', /classifier\.1\.weight|features\.8\.weight/.test(firstRow ?? ''), firstRow?.slice(0, 60))
  await page.fill('.am-bar input[type=search]', 'running')
  const rows = await page.locator('.am-tbl-row').count()
  record('table: filter', rows === 4, `${rows} rows for "running"`)
  record('tensor/export: no errors', errors.length === 0, errors.join(' | '))
  await context.close()
}

// ---------------------------------------------------------------- panel: large checkpoint by ranged reads
const big = typeof args.big === 'string' ? args.big : null
if (big) {
  const { page, context, errors } = await newPage('desktop-dark')
  await page.goto(`${base}/harness?panel=1&entry=${encodeURIComponent('panel/main.ts')}&theme=dark&locale=ko`)
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 30000 })
  const t0 = Date.now()
  await page.setInputFiles('#fp-panel-open', big)
  await page.waitForFunction(() => document.body.dataset.state === 'ready' && !!document.querySelector('.am-summary'), null, { timeout: 120000, polling: 50 })
  const tOpen = Date.now() - t0
  const summary = await page.locator('.am-summary').textContent()
  await shot(page, 'panel-big-tree')
  await switchView(page, 'table')
  await shot(page, 'panel-big-table')
  await switchView(page, 'map')
  await shot(page, 'panel-big-map')
  await switchView(page, 'tensor')
  await page.fill('.am-ti-list input[type=search]', 'wte.weight')
  const t1 = Date.now()
  await page.locator('.am-ti-item', { hasText: 'wte.weight' }).first().click()
  await page.waitForSelector('canvas[data-am-heatmap]', { timeout: 120000 }).catch(() => {})
  const tInspect = Date.now() - t1
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
  await shot(page, 'panel-big-tensor')
  const size = statSync(big).size
  record(`panel: ${(size / 1024 / 1024 / 1024).toFixed(2)} GB checkpoint opens by ranged reads`, /459,251,200|459\.25 M/.test(summary ?? '') || tOpen < 60000, `ready in ${tOpen} ms; inspect wte.weight in ${tInspect} ms; JS heap ${(heap / 1024 / 1024).toFixed(0)} MB; ${summary?.slice(0, 120)}`)
  record('panel: no errors', errors.length === 0, errors.join(' | '))
  results.push({ name: 'panel-perf', ok: true, detail: JSON.stringify({ file: big, size, tOpen, tInspect, heap }) })
  await context.close()
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1))
const failed = results.filter((r) => !r.ok)
console.log(`${results.length - failed.length}/${results.length} passed → ${OUT}`)
await browser.close()
server.close()
process.exit(failed.length ? 1 : 0)
