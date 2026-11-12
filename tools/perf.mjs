// Performance probe for the preview renderers: opens each file in samples/perf/ through the
// harness page, records time to first content ('ready'), long tasks (PerformanceObserver
// 'longtask'), JS heap, and the cost of interactions (scroll to the end, switch sheet/zoom).
//
//   node tools/perf.mjs [--dir samples/perf] [--only perf-100k] [--profiles desktop-dark,mobile-light]
//                      [--out docs/evidence/office/perf] [--label after]
// Writes <out>/perf-<label>.json and prints a table.
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
    return acc
  }, [])
)
const dir = args.dir ?? 'samples/perf'
const out = args.out ?? 'docs/evidence/office/perf'
const label = args.label ?? 'run'
const only = typeof args.only === 'string' ? args.only.split(',') : null
const PROFILES = {
  'desktop-dark': { viewport: { width: 1280, height: 800 }, theme: 'dark' },
  'mobile-light': { viewport: { width: 390, height: 844 }, theme: 'light', isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
}
const profiles = (typeof args.profiles === 'string' ? args.profiles : 'desktop-dark,mobile-light').split(',')
const port = 7400 + Math.floor(Math.random() * 500)

const INIT = `(() => {
  window.__perf = { longtasks: [], readyAt: null, state: null }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longtasks.push({ start: e.startTime, dur: e.duration }) })
      .observe({ type: 'longtask', buffered: true })
  } catch {}
  const watch = () => {
    const s = document.body?.dataset.state
    if ((s === 'ready' || s === 'error') && window.__perf.readyAt == null) { window.__perf.readyAt = performance.now(); window.__perf.state = s }
  }
  new MutationObserver(watch).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] })
})()`

const srv = spawn(process.execPath, ['tools/harness/run.mjs', '--serve', '--port', String(port)], { stdio: 'pipe' })
await new Promise((r) => setTimeout(r, 1500))
const browser = await chromium.launch({
  executablePath: args.chrome ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--enable-precise-memory-info']
})
const files = readdirSync(dir).filter((f) => !only || only.some((o) => f.includes(o))).sort()
const results = []
mkdirSync(out, { recursive: true })
const idle = (p, ms = 300) => p.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), ms)

for (const pname of profiles) {
  const prof = PROFILES[pname]
  for (const f of files) {
    const ctx = await browser.newContext({ ...prof, theme: undefined })
    await ctx.addInitScript(INIT)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    const r = { file: f, profile: pname, label }
    try {
      await page.goto(`http://127.0.0.1:${port}/harness?file=${encodeURIComponent(`${dir}/${f}`)}&theme=${prof.theme}&locale=ko`)
      await page.waitForFunction(() => window.__perf.readyAt != null, null, { timeout: 90000, polling: 100 })
      await idle(page, 500)
      Object.assign(r, await page.evaluate(() => ({ readyMs: Math.round(window.__perf.readyAt), state: window.__perf.state })))
      // Interactions, each timed in the page; long tasks counted after first content.
      r.scrollMs = await page.evaluate(async () => {
        const root = document.querySelector('.fp-content')
        const t0 = performance.now()
        for (let i = 0; i < 30; i++) {
          root.scrollTop = root.scrollHeight
          await new Promise((res) => setTimeout(res, 50))
        }
        return Math.round(performance.now() - t0)
      })
      await idle(page)
      if (args.shots) await page.screenshot({ path: join(out, `${f}.${pname}.end.png`) })
      const sel = await page.$('.fp-toolbar select')
      if (sel && f.endsWith('.xlsx')) {
        const t0 = Date.now()
        await sel.selectOption({ index: 1 })
        await idle(page, 100)
        if (args.shots) await page.screenshot({ path: join(out, `${f}.${pname}.sheet2.png`) })
        await sel.selectOption({ index: 0 })
        await idle(page, 100)
        r.switchMs = Date.now() - t0 - 200
      }
      const plus = page.locator('.fp-toolbar button', { hasText: '+' })
      if (await plus.count()) {
        const t0 = Date.now()
        await plus.click()
        await plus.click()
        await idle(page, 100)
        r.zoomMs = Date.now() - t0 - 100
      }
      await idle(page, 500)
      Object.assign(
        r,
        await page.evaluate(() => {
          const lt = window.__perf.longtasks
          const after = lt.filter((t) => t.start >= window.__perf.readyAt - 1)
          const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
          return {
            longBefore: Math.round(Math.max(0, ...lt.filter((t) => t.start < window.__perf.readyAt).map((t) => t.dur))),
            longAfter: Math.round(Math.max(0, ...after.map((t) => t.dur))),
            longAfterCount: after.filter((t) => t.dur > 200).length,
            heapMB: mem,
            domNodes: document.getElementsByTagName('*').length + [...document.querySelectorAll('*')].reduce((n, e) => n + (e.shadowRoot ? e.shadowRoot.querySelectorAll('*').length : 0), 0)
          }
        })
      )
    } catch (e) {
      r.error = e.message.split('\n')[0]
    }
    r.pageErrors = errors.length
    results.push(r)
    console.log(
      `${pname.padEnd(13)} ${f.padEnd(22)} ready ${String(r.readyMs ?? '-').padStart(6)}ms  longAfter ${String(r.longAfter ?? '-').padStart(5)}ms  scroll ${String(r.scrollMs ?? '-').padStart(5)}ms  switch ${String(r.switchMs ?? '-').padStart(5)}  zoom ${String(r.zoomMs ?? '-').padStart(5)}  heap ${r.heapMB ?? '-'}MB  dom ${r.domNodes ?? '-'}${r.error ? '  ERROR ' + r.error : ''}`
    )
    await ctx.close()
  }
}
await browser.close()
srv.kill()
mkdirSync(out, { recursive: true })
writeFileSync(join(out, `perf-${label}.json`), JSON.stringify(results, null, 2))
