// Interaction and corpus checks for the separate File Preview DWG plugin (dwg-plugin/), beyond run.mjs:
//  - model space, zoom (wheel at the cursor), pan (drag), fit, layer toggles, background, line weights,
//    paper-space layout with a viewport, theme switch, phone width, Korean/English UI
//  - --corpus <dir>: every .dwg/.dwt in a folder (e.g. LibreDWG's test-data in .orca/): settled state,
//    DWG version, primitives drawn, entity types not drawn, time; a screenshot per file
// Screenshots and results.json go to --out (default .orca/dwg-interact).
//
//   node tools/harness/dwg-interact.mjs [--out docs/evidence/dwg] [--corpus .orca/libredwg-src/test/test-data]
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { launch, parseArgs, ROOT, serve } from './lib.mjs'

const args = parseArgs()
const OUT = join(ROOT, typeof args.out === 'string' ? args.out : '.orca/dwg-interact')
mkdirSync(OUT, { recursive: true })
const server = await serve({ plugin: 'dwg-plugin' })
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function open(context, file, theme = 'dark', locale = 'ko') {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.location()?.url ?? '')) errors.push(`${m.text()} ${m.location()?.url ?? ''}`)
  })
  const started = Date.now()
  await page.goto(`${base}/harness?file=${file.split('/').map(encodeURIComponent).join('/')}&theme=${theme}&locale=${locale}`)
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 120000, polling: 100 })
  const ms = Date.now() - started
  await page.waitForTimeout(250)
  return { page, errors, ms }
}
const shot = async (page, name) => {
  const buf = await page.screenshot()
  writeFileSync(join(OUT, `${name}.png`), buf)
  return buf
}
const differs = (a, b) => Buffer.compare(a, b) !== 0
const click = (page, title) => page.locator(`.fp-toolbar button[title^="${title}"]`).click()
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

if (!args.corpus || args.all) {
  // ---------------------------------------------------------------- desktop, Korean UI
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const { page, errors } = await open(ctx, 'samples/dwg/drawing-r2018.dwg')
  const fit = await shot(page, '01-model-dark')
  const info = await page.locator('.fp-info').textContent()
  record('info bar: version, units, extents', /AutoCAD 2018/.test(info) && /mm/.test(info) && /297/.test(info), info)

  // wheel zoom at a point, then pan by dragging
  const canvas = page.locator('.dwg-stage canvas')
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.55)
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240)
  await settle(page)
  const zoomed = await shot(page, '02-model-zoomed')
  const z = await page.locator('.fp-zoom-label').textContent()
  record('wheel zooms about the cursor', differs(fit, zoomed) && parseInt(z) > 150, `zoom ${z}`)
  await page.mouse.move(box.x + 600, box.y + 400)
  await page.mouse.down()
  await page.mouse.move(box.x + 450, box.y + 300, { steps: 5 })
  await page.mouse.up()
  await settle(page)
  const panned = await shot(page, '03-model-panned')
  record('drag pans', differs(zoomed, panned))
  await page.locator('.fp-toolbar button[title="Fit width"]').click()
  await settle(page)
  const refit = await page.screenshot()
  record('fit button restores the whole drawing', !differs(refit, fit) || (await page.locator('.fp-zoom-label').textContent()) === '100%')

  // layers: panel, toggle one layer off
  await click(page, '레이어 표시')
  await settle(page)
  const names = await page.locator('.dwg-layers .nm').allTextContents()
  record('layer panel lists the layers', names.includes('치수') && names.includes('외곽선'), names.join(', '))
  const hiddenOff = await page.locator('.dwg-layers li', { hasText: '숨김' }).locator('input').isChecked()
  record('layer that is off in the file starts hidden', hiddenOff === false)
  await shot(page, '04-layers-panel')
  await page.locator('.dwg-layers li', { hasText: '치수' }).locator('input').uncheck()
  await page.locator('.dwg-layers li', { hasText: '해치' }).locator('input').uncheck()
  await settle(page)
  const noDims = await shot(page, '05-layers-dims-hatch-off')
  await page.locator('.dwg-layers header button', { hasText: '모두 켜기' }).click()
  await page.locator('.dwg-layers header button[title="닫기"]').click()
  await settle(page)
  const allOn = await page.screenshot()
  record('toggling layers changes the picture', differs(noDims, allOn))

  // background and line weights
  await click(page, '배경')
  await settle(page)
  const light = await shot(page, '06-model-light-background')
  record('background toggle repaints', differs(light, allOn))
  await click(page, '선 두께')
  await settle(page)
  const thin = await page.screenshot()
  record('line weight toggle changes the picture', differs(thin, light))
  await click(page, '선 두께')
  await click(page, '배경')

  // paper-space layout with a viewport
  await page.locator('select.dwg-space').selectOption({ label: '배치1' })
  await settle(page)
  const layout = await shot(page, '07-layout-viewport')
  const layoutInfo = await page.locator('.fp-info').textContent()
  record('layout shows the sheet with its viewport', differs(layout, allOn) && /용지/.test(layoutInfo), layoutInfo)

  // theme switch follows Orca (no manual background override in this page)
  const p2 = await open(ctx, 'samples/dwg/drawing-r2000.dwg', 'dark', 'en')
  const before = await p2.page.screenshot()
  await p2.page.evaluate(() => window.__setTheme('light'))
  await settle(p2.page)
  const after = await shot(p2.page, '08-theme-switched-light-en')
  record('Orca theme switch repaints the drawing', differs(before, after))
  record('no page errors (desktop)', errors.length + p2.errors.length === 0, [...errors, ...p2.errors].join(' | '))
  await ctx.close()

  // ---------------------------------------------------------------- phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const m = await open(phone, 'samples/dwg/drawing-r2013.dwg', 'light', 'ko')
  await shot(m.page, '09-phone-light')
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  record('phone width: no horizontal overflow', !overflow)
  const t = await open(phone, 'samples/dwg/template-r2000.dwt', 'dark', 'ko')
  await shot(t.page, '10-phone-dwt-dark')
  record('.dwt opens like .dwg', (await t.page.evaluate(() => document.body.dataset.state)) === 'ready')
  await phone.close()

  // ---------------------------------------------------------------- fallbacks
  const fb = await browser.newContext({ viewport: { width: 1000, height: 640 } })
  const pv = await open(fb, 'samples/dwg/preview-only.dwg', 'dark', 'ko')
  await shot(pv.page, '11-preview-image-fallback')
  record('unreadable drawing shows the stored preview image', (await pv.page.locator('.dwg-thumb img').count()) === 1)
  const br = await open(fb, 'samples/dwg/broken.dwg', 'light', 'en')
  await shot(br.page, '12-broken-friendly-error')
  record('damaged file ends in a friendly error', (await br.page.evaluate(() => document.body.dataset.state)) === 'error')
  await fb.close()
}

// ---------------------------------------------------------------- corpus
if (args.corpus) {
  const dir = String(args.corpus)
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  const list = []
  const walk = (d) => {
    for (const f of readdirSync(join(ROOT, d))) {
      const p = `${d}/${f}`
      if (statSync(join(ROOT, p)).isDirectory()) {
        if (args.recursive) walk(p)
      } else if (/\.dw[gt]$/i.test(f)) list.push(p)
    }
  }
  walk(dir.replace(/\\/g, '/').replace(/\/$/, ''))
  const rows = []
  for (const f of list.sort()) {
    const { page, errors, ms } = await open(ctx, f, 'dark', 'en').catch((e) => ({ page: null, errors: [e.message], ms: 0 }))
    if (!page) {
      rows.push({ file: f, state: 'timeout', ms, errors })
      continue
    }
    const r = await page.evaluate(() => {
      const v = window.__dwgView
      const info = document.querySelector('.fp-info')?.textContent ?? ''
      const note = document.querySelector('.dwg-note')?.textContent ?? ''
      return {
        state: document.body.dataset.state,
        info,
        note,
        prims: v ? v.scene.stats.prims : 0,
        entities: v ? v.scene.stats.entities : 0,
        spaces: v ? v.scene.spaces.length : 0,
        thumb: !!document.querySelector('.dwg-thumb img'),
        message: document.querySelector('.fp-state h2')?.textContent ?? ''
      }
    })
    const name = relative(dir, f).replace(/[\\/]/g, '_')
    if (!args['no-shots']) await shot(page, `corpus-${name}`)
    rows.push({ file: relative(dir, f).replace(/\\/g, '/'), ms, ...r, errors })
    console.log(`${r.state.padEnd(6)} ${String(ms).padStart(6)}ms ${relative(dir, f).padEnd(40)} ${r.info.split(' · ')[0]} prims=${r.prims}${r.thumb ? ' (preview image)' : ''}${errors.length ? ' errors=' + errors.length : ''}`)
    await page.close()
  }
  writeFileSync(join(OUT, 'corpus.json'), JSON.stringify(rows, null, 2))
  await ctx.close()
}

await browser.close()
server.close()
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed → ${relative(ROOT, OUT)}`)
process.exitCode = failed ? 1 : 0
