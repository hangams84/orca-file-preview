// Diagram fidelity captures.
//
//   node tools/diagram/fidelity.mjs [--only edges] [--out docs/evidence/diagram]
//
// For every file in samples/diagram (and samples/sample.drawio / sample.vsdx) and every page:
//  - ours/<file>.p<N>.png : this plugin's render (browser harness, Orca CSP, light theme, 100 %)
//  - truth/<file>.p<N>.png: draw.io files only, the official draw.io viewer (Apache-2.0,
//    viewer-static.min.js fetched to .orca/drawio/, run WITHOUT the plugin CSP as a reference)
// Also checks whether that official viewer can run under the plugin CSP (csp-check.json).
// Visio references come from LibreOffice (tools/diagram/visio-truth.py).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, parseArgs, ROOT, serve } from '../harness/lib.mjs'

const args = parseArgs()
const OUT = join(ROOT, args.out ?? 'docs/evidence/diagram')
const VIEWER = join(ROOT, '.orca/drawio/viewer-static.min.js')
mkdirSync(join(OUT, 'ours'), { recursive: true })
mkdirSync(join(OUT, 'truth'), { recursive: true })

const files = [
  ...readdirSync(join(ROOT, 'samples/diagram')).filter((f) => /\.(drawio|dio|vs[dts][xm])$/.test(f)).map((f) => `diagram/${f}`),
  'sample.drawio',
  'sample.vsdx'
].filter((f) => existsSync(join(ROOT, 'samples', f)) && (!args.only || String(args.only).split(',').some((o) => f.includes(o))))

const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const ctx = await browser.newContext({ viewport: { width: 1800, height: 1400 }, deviceScaleFactor: 1 })
const results = []

for (const f of files) {
  const page = await ctx.newPage()
  const logs = []
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
  await page.goto(`${base}/harness?file=samples/${encodeURIComponent(f)}&theme=light&locale=en`, { waitUntil: 'load' })
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 60000, polling: 100 })
  const state = await page.evaluate(() => document.body.dataset.state)
  const count = await page.evaluate(() => document.querySelector('select[title="Page"]')?.options.length ?? 1)
  const name = f.replace(/^diagram\//, '')
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      await page.selectOption('select[title="Page"]', String(i))
      await page.waitForTimeout(400)
    }
    await page.click('button[title="Actual size (Ctrl 0)"]').catch(() => {})
    await page.waitForTimeout(400)
    const box = (await page.$('.fp-img-box svg')) ?? (await page.$('.fp-img-box'))
    const shot = join(OUT, 'ours', `${name}.p${i + 1}.png`)
    if (box) await box.screenshot({ path: shot })
    else await page.screenshot({ path: shot })
    const info = await page.evaluate(() => document.querySelector('.fp-info')?.textContent ?? '')
    results.push({ file: f, page: i + 1, state, info, logs: [...logs] })
    console.log(`${f} p${i + 1}: ${state} ${info}`)
  }
  await page.close()
}

// Reference renders with the official viewer (draw.io files only).
if (existsSync(VIEWER)) {
  const viewer = readFileSync(VIEWER, 'utf8')
  for (const f of files.filter((x) => /\.(drawio|dio)$/.test(x))) {
    const xml = readFileSync(join(ROOT, 'samples', f), 'utf8')
    const name = f.replace(/^diagram\//, '')
    const pages = (xml.match(/<diagram\b/g) ?? ['']).length
    for (let i = 0; i < pages; i++) {
      const page = await ctx.newPage()
      await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"><div id="d"></div></body></html>')
      await page.addScriptTag({ content: viewer })
      await page.evaluate(
        ({ xml, i }) => {
          const d = document.getElementById('d')
          d.className = 'mxgraph'
          d.setAttribute('data-mxgraph', JSON.stringify({ xml, page: i, border: 10, resize: false, nav: false, toolbar: '', lightbox: false, highlight: 'none' }))
          // eslint-disable-next-line no-undef
          GraphViewer.processElements()
        },
        { xml, i }
      )
      await page.waitForTimeout(2500)
      const el = await page.$('#d svg')
      if (el) await el.screenshot({ path: join(OUT, 'truth', `${name}.p${i + 1}.png`) })
      await page.close()
    }
    console.log(`truth ${f}: ${pages} page(s)`)
  }

  // Can the official viewer run inside the plugin frame's CSP? Load it from the harness server.
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await page.goto(`${base}/tools/diagram/csp-probe.html`, { waitUntil: 'load' })
  await page.waitForTimeout(4000)
  const drawn = await page.evaluate(() => document.querySelectorAll('#d svg g').length)
  writeFileSync(join(OUT, 'csp-check.json'), JSON.stringify({ viewerBytes: viewer.length, evalSites: (viewer.match(/\beval\(/g) ?? []).length, svgGroupsDrawn: drawn, errors: errors.slice(0, 20) }, null, 2))
  console.log(`CSP probe: ${drawn} svg groups, ${errors.length} errors`)
  await page.close()
}

writeFileSync(join(OUT, 'captures.json'), JSON.stringify(results, null, 2))
await browser.close()
server.close()
