// Drives the CAD Drawing Preview like a person: opens the layer list and turns a layer off, zooms
// with the wheel at a point, pans by dragging, switches to a layout, flips the background, and on a
// phone profile pinches. Asserts what changed and saves a screenshot per step.
//
//   node tools/cad2d/interact.mjs --out docs/evidence/cad2d/interact
import { spawn } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const oi = process.argv.indexOf('--out')
const out = join(ROOT, oi > 0 ? process.argv[oi + 1] : '.orca/cad2d-interact')
mkdirSync(out, { recursive: true })
const server = spawn(process.execPath, [join(ROOT, 'tools/harness/run.mjs'), '--serve', '--port', '0'], { cwd: ROOT })
const base = await new Promise((resolve) => server.stdout.on('data', (d) => /(http:\/\/127\.0\.0\.1:\d+)/.test(String(d)) && resolve(/(http:\/\/127\.0\.0\.1:\d+)/.exec(String(d))[1])))
const { chromium } = await import('playwright-core')
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
})
const browser = await chromium.launch({ executablePath: exe, headless: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
const ink = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('.cad-stage canvas')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const bg = [d[0], d[1], d[2]]
    let n = 0
    for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) n++
    return n
  })

// ---- desktop --------------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/harness?file=samples/sample.dxf&theme=dark&locale=en`)
  await page.waitForFunction(() => document.body.dataset.state === 'ready')
  await page.waitForTimeout(300)
  const before = await ink(page)
  await page.getByRole('button', { name: /Layer list/ }).click()
  await page.waitForTimeout(200)
  const rows = await page.locator('.cad-layers li').count()
  check('layer list opens with every layer', rows === 13, `${rows} rows`)
  await page.locator('.cad-layers li', { hasText: 'HATCH' }).locator('input').uncheck()
  await page.waitForTimeout(300)
  const afterHatch = await ink(page)
  check('turning layer HATCH off removes its ink', afterHatch < before * 0.9, `${before} → ${afterHatch} sampled ink pixels`)
  await page.screenshot({ path: join(out, '1-layers-hatch-off.png') })
  await page.locator('.cad-layers li', { hasText: 'HATCH' }).locator('input').check()
  await page.getByRole('button', { name: /Layer list/ }).click()
  await page.waitForTimeout(300) // the stage widens again
  // wheel zoom at the circle (cursor-anchored)
  const stage = page.locator('.cad-stage')
  const box = await stage.boundingBox()
  const px = box.x + box.width * 0.42
  const py = box.y + box.height * 0.12
  const w0 = await page.evaluate(([x, y]) => window.__cad2d.world(x * devicePixelRatio, y * devicePixelRatio), [px - box.x, py - box.y])
  await page.mouse.move(px, py)
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240)
  await page.waitForTimeout(400)
  const z = await page.evaluate(() => window.__cad2d.zoom.get())
  const w1 = await page.evaluate(([x, y]) => window.__cad2d.world(x * devicePixelRatio, y * devicePixelRatio), [px - box.x, py - box.y])
  check('wheel zooms in around the pointer', z > 2 && Math.hypot(w0[0] - w1[0], w0[1] - w1[1]) < 0.5, `zoom ${(z * 100).toFixed(0)} %, point under cursor moved ${Math.hypot(w0[0] - w1[0], w0[1] - w1[1]).toFixed(3)} units`)
  await page.screenshot({ path: join(out, '2-wheel-zoom.png') })
  // drag to pan
  await page.mouse.move(px, py)
  await page.mouse.down()
  await page.mouse.move(px - 200, py + 100, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const w2 = await page.evaluate(([x, y]) => window.__cad2d.world(x * devicePixelRatio, y * devicePixelRatio), [px - 200 - box.x, py + 100 - box.y])
  check('dragging pans: the grabbed point follows the pointer', Math.hypot(w2[0] - w1[0], w2[1] - w1[1]) < 0.5, `moved ${Math.hypot(w2[0] - w1[0], w2[1] - w1[1]).toFixed(3)} units`)
  await page.getByRole('button', { name: 'Fit width' }).click()
  await page.waitForTimeout(200)
  check('fit returns to 100 %', Math.abs((await page.evaluate(() => window.__cad2d.zoom.get())) - 1) < 1e-6)
  // layouts
  await page.locator('select.cad-view-select').selectOption({ index: 2 })
  await page.waitForTimeout(300)
  const name = await page.evaluate(() => document.querySelector('.cad-stage').getAttribute('aria-label'))
  check('layout selector switches to the paper-space layout', /도면-A3/.test(name ?? ''), name ?? '')
  await page.screenshot({ path: join(out, '3-layout.png') })
  // background
  await page.getByRole('button', { name: 'Light / dark background' }).click()
  await page.waitForTimeout(300)
  const bg = await page.evaluate(() => Array.from(document.querySelector('.cad-stage canvas').getContext('2d').getImageData(2, 2, 1, 1).data.slice(0, 3)))
  check('background toggle switches to light', bg[0] > 180, `corner pixel ${bg}`)
  await page.screenshot({ path: join(out, '4-light-background.png') })
  check('no page errors (desktop)', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// ---- phone: pinch ---------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(`${base}/harness?file=samples/sample.dwf&theme=light&locale=ko`)
  await page.waitForFunction(() => document.body.dataset.state === 'ready')
  await page.waitForTimeout(300)
  const z0 = await page.evaluate(() => window.__cad2d.zoom.get())
  const cdp = await ctx.newCDPSession(page)
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
  await touch('touchStart', [[150, 400], [240, 400]])
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[150 - i * 12, 400], [240 + i * 12, 400]])
  await touch('touchEnd', [])
  await page.waitForTimeout(400)
  const z1 = await page.evaluate(() => window.__cad2d.zoom.get())
  check('two-finger pinch zooms in on a phone', z1 > z0 * 1.5, `${(z0 * 100).toFixed(0)} % → ${(z1 * 100).toFixed(0)} %`)
  await page.screenshot({ path: join(out, '5-phone-pinch.png') })
  await page.getByRole('button', { name: /레이어 목록/ }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(out, '6-phone-layers.png') })
  const panel = await page.locator('.cad-layers').boundingBox()
  check('phone layer list is an overlay inside the screen', panel && panel.x >= 0 && panel.x + panel.width <= 391, JSON.stringify(panel))
  await ctx.close()
}
await browser.close()
server.kill()
writeFileSync(join(out, 'interact.json'), JSON.stringify(results, null, 2))
const failed = results.filter((r) => !r.ok).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
