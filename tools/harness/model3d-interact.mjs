// Interaction checks for the 3D preview (editor/renderers/model3d.ts), beyond what run.mjs covers:
//  - idle: no animation frames are requested while nothing changes (render on demand)
//  - toolbar: wireframe, flat/smooth, grid+axes, Z-up, background, fit change the picture
//  - mouse drag / wheel and touch (one-finger orbit, two-finger pinch) change the view
//  - theme switch repaints the background
//  - large mesh (samples/perf/*.stl): main-thread stalls while it loads (heartbeat gaps)
// Screenshots go to --out (default .orca/model3d-interact); results.json beside them.
//
//   node tools/harness/model3d-interact.mjs [--out docs/evidence/3d/interact] [--perf samples/perf/large-2M.stl]
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, parseArgs, ROOT, serve } from './lib.mjs'

const args = parseArgs()
const OUT = join(ROOT, typeof args.out === 'string' ? args.out : '.orca/model3d-interact')
mkdirSync(OUT, { recursive: true })
const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

/** Counts requestAnimationFrame calls and main-thread stalls (gaps between 20 ms heartbeats). */
const PROBE = () => {
  const raf = window.requestAnimationFrame.bind(window)
  window.__raf = 0
  window.requestAnimationFrame = (cb) => {
    window.__raf++
    return raf(cb)
  }
  window.__maxGap = 0
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    window.__maxGap = Math.max(window.__maxGap, now - last)
    last = now
  }, 20)
}

async function open(context, file, theme = 'dark', locale = 'en') {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/harness?file=${file}&theme=${theme}&locale=${locale}`)
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 120000, polling: 100 })
  await page.waitForTimeout(300)
  return { page, errors }
}
const shot = async (page, name) => {
  const buf = await page.locator('.fp-content').screenshot()
  writeFileSync(join(OUT, `${name}.png`), buf)
  return buf
}
const differs = (a, b) => Buffer.compare(a, b) !== 0
const click = (page, title) => page.locator(`.fp-toolbar button[title^="${title}"]`).click()

// ---------------------------------------------------------------- desktop
{
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } })
  await context.addInitScript(PROBE)
  const { page, errors } = await open(context, 'samples/sample.stl')
  const s0 = await shot(page, 'stl-initial')
  const r0 = await page.evaluate(() => window.__raf)
  await page.waitForTimeout(1500)
  const r1 = await page.evaluate(() => window.__raf)
  record('idle: no animation frames while nothing changes', r1 === r0, `${r1 - r0} rAF calls in 1.5 s`)

  await click(page, 'Wireframe')
  const sw = await shot(page, 'stl-wireframe')
  record('wireframe toggle changes the picture', differs(s0, sw))
  await click(page, 'Wireframe')
  await click(page, 'Flat shading')
  const ss = await shot(page, 'stl-smooth')
  record('flat → smooth shading (welded normals) changes the picture', differs(s0, ss))
  await click(page, 'Flat shading')
  await click(page, 'Grid and axes')
  const sg = await shot(page, 'stl-grid')
  record('grid + axes toggle', differs(s0, sg))
  await click(page, 'Grid and axes')
  await click(page, 'Z axis up')
  const sz = await shot(page, 'stl-yup')
  record('Z-up toggle turns the model', differs(s0, sz))
  await click(page, 'Z axis up')
  await page.locator('.fp-toolbar select').selectOption('light')
  const sl = await shot(page, 'stl-bg-light')
  record('background: light', differs(s0, sl))
  await page.locator('.fp-toolbar select').selectOption('theme')

  const box = await page.locator('.fp-3d-stage canvas').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 160, cy + 40, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const sd = await shot(page, 'stl-orbit-mouse')
  record('mouse drag orbits', differs(s0, sd))
  await page.mouse.wheel(0, -400)
  await page.waitForTimeout(300)
  const swh = await shot(page, 'stl-wheel-zoom')
  record('wheel zooms', differs(sd, swh))
  await click(page, 'Fit to view')
  const sf = await shot(page, 'stl-fit')
  record('fit restores the initial view', !differs(s0, sf), differs(s0, sf) ? 'differs from the first frame' : 'identical to the first frame')

  await click(page, 'Auto-rotate')
  await page.waitForTimeout(500)
  const ra = await page.evaluate(() => window.__raf)
  await page.waitForTimeout(500)
  const rb = await page.evaluate(() => window.__raf)
  await click(page, 'Auto-rotate')
  await page.waitForTimeout(300)
  const rc = await page.evaluate(() => window.__raf)
  await page.waitForTimeout(800)
  const rd = await page.evaluate(() => window.__raf)
  record('auto-rotate animates, and stops again', rb > ra + 5 && rd - rc <= 1, `${rb - ra} frames in 0.5 s while on, ${rd - rc} after off`)

  await page.evaluate(() => window.__setTheme('light'))
  await page.waitForTimeout(300)
  const st = await shot(page, 'stl-theme-light')
  record('theme switch repaints the background', differs(sf, st))
  record('desktop: no page errors', errors.length === 0, errors.join(' | '))
  await context.close()
}

// ---------------------------------------------------------------- touch (phone)
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  })
  const { page, errors } = await open(context, 'samples/sample.glb', 'light', 'ko')
  const cdp = await context.newCDPSession(page)
  const box = await page.locator('.fp-3d-stage canvas').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
  const s0 = await shot(page, 'glb-touch-initial')
  await touch('touchStart', [[cx, cy]])
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx + i * 15, cy + i * 4]])
  await touch('touchEnd', [])
  await page.waitForTimeout(300)
  const s1 = await shot(page, 'glb-touch-orbit')
  record('touch: one-finger drag orbits', differs(s0, s1))
  await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]])
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 30 - i * 12, cy], [cx + 30 + i * 12, cy]])
  await touch('touchEnd', [])
  await page.waitForTimeout(300)
  const s2 = await shot(page, 'glb-touch-pinch')
  record('touch: two-finger pinch zooms', differs(s1, s2))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  record('phone: no horizontal overflow', !overflow)
  record('phone: no page errors', errors.length === 0, errors.join(' | '))
  await context.close()
}

// ---------------------------------------------------------------- fractional DPR, host stylesheet loses
// Orca at 125 % display scaling showed the model cropped towards the bottom-right: the canvas was
// displayed at its drawing-buffer size. Reproduce the worst case: DPR 1.25 and the renderer's own
// <style> removed (a host where our stylesheet does not apply), then a pane resize.
{
  const context = await browser.newContext({ viewport: { width: 1348, height: 760 }, deviceScaleFactor: 1.25 })
  await context.addInitScript(() => {
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) for (const s of n.querySelectorAll?.('style') ?? []) s.remove()
    }).observe(document, { childList: true, subtree: true })
  })
  for (const file of ['sample.glb', 'sample.stl']) {
    const { page, errors } = await open(context, `samples/${file}`)
    const sizes = () =>
      page.evaluate(() => {
        const c = document.querySelector('.fp-3d-stage canvas')
        const r = c.getBoundingClientRect()
        const p = document.querySelector('.fp-content').getBoundingClientRect()
        return { css: [Math.round(r.width), Math.round(r.height)], pane: [Math.round(p.width), Math.round(p.height)], buffer: [c.width, c.height] }
      })
    const centre = async () => {
      const png = await page.locator('.fp-content').screenshot()
      return page.evaluate(async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const cv = document.createElement('canvas')
        cv.width = bmp.width
        cv.height = bmp.height
        const g = cv.getContext('2d')
        g.drawImage(bmp, 0, 0)
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data
        const m = 3, bi = (m * bmp.width + m) * 4
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
        for (let y = m; y < bmp.height - m; y++)
          for (let x = m; x < bmp.width - m; x++) {
            const i = (y * bmp.width + x) * 4
            if (Math.abs(d[i] - d[bi]) + Math.abs(d[i + 1] - d[bi + 1]) + Math.abs(d[i + 2] - d[bi + 2]) > 30) {
              x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
            }
          }
        return { cx: (x0 + x1 + 1) / 2 / bmp.width, cy: (y0 + y1 + 1) / 2 / bmp.height }
      }, png.toString('base64'))
    }
    const ok = (c) => Math.abs(c.cx - 0.5) <= 0.03 && Math.abs(c.cy - 0.5) <= 0.03
    const pct = (c) => `${(c.cx * 100).toFixed(1)}%/${(c.cy * 100).toFixed(1)}%`
    const a = await centre()
    const sa = await sizes()
    await shot(page, `dpr1.25-nostyle-${file}`)
    await page.setViewportSize({ width: 900, height: 620 })
    await page.waitForTimeout(500)
    const b = await centre()
    const sb = await sizes()
    await shot(page, `dpr1.25-nostyle-resized-${file}`)
    await page.setViewportSize({ width: 1348, height: 760 })
    record(
      `DPR 1.25 without our stylesheet, ${file}: centred, canvas box = pane, also after a resize`,
      ok(a) && ok(b) && sa.css.join() === sa.pane.join() && sb.css.join() === sb.pane.join() && errors.length === 0,
      `centre ${pct(a)} → after resize ${pct(b)}; canvas ${sa.css.join('×')} in pane ${sa.pane.join('×')} (buffer ${sa.buffer.join('×')}) → ${sb.css.join('×')} in ${sb.pane.join('×')} (buffer ${sb.buffer.join('×')})`
    )
    await page.close()
  }
  await context.close()
}

// ---------------------------------------------------------------- no WebGL (GPU disabled, old engine)
{
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } })
  await context.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/i.test(String(type)) ? null : get.call(this, type, ...rest)
    }
  })
  const { page, errors } = await open(context, 'samples/sample.stl')
  const state = await page.evaluate(() => document.body.dataset.state)
  const text = await page.evaluate(() => document.querySelector('.fp-content')?.textContent ?? '')
  await shot(page, 'no-webgl')
  record("no WebGL: friendly 'webgl' message", state === 'error' && /WebGL/.test(text) && /code: webgl/.test(text) && errors.length === 0, text.replace(/\s+/g, ' ').slice(0, 160))
  await context.close()
}

// ---------------------------------------------------------------- large mesh
{
  const perfDir = join(ROOT, 'samples', 'perf')
  let files = []
  try {
    files = readdirSync(perfDir).filter((f) => /\.(stl|ply|obj|off)$/i.test(f))
  } catch {
    // no perf fixtures generated
  }
  if (typeof args.perf === 'string') files = [args.perf.replace(/^samples\/perf\//, '')]
  for (const f of files) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await context.addInitScript(PROBE)
    const t0 = Date.now()
    const { page, errors } = await open(context, `samples/perf/${f}`)
    const ms = Date.now() - t0
    const state = await page.evaluate(() => document.body.dataset.state)
    const gap = await page.evaluate(() => Math.round(window.__maxGap))
    const info = await page.evaluate(() => document.querySelector('.fp-info')?.textContent ?? '')
    await shot(page, `perf-${f}`)
    // interaction on the large mesh: one orbit step should draw within a few frames
    const box = await page.locator('.fp-3d-stage canvas').boundingBox().catch(() => null)
    let orbitMs = -1
    if (box) {
      const t1 = Date.now()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 })
      await page.mouse.up()
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      orbitMs = Date.now() - t1
    }
    record(
      `large mesh ${f}: loads, main thread never blocked > 1 s`,
      state === 'ready' && gap < 1000 && errors.length === 0,
      `state=${state}, ${ms} ms to ready, longest main-thread stall ${gap} ms, orbit step ${orbitMs} ms · ${info}`
    )
    await context.close()
  }
}

await browser.close()
server.close()
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed → ${OUT}`)
process.exitCode = failed ? 1 : 0
