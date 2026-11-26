// Interaction checks for the Robot Preview (editor/renderers/urdf.ts), beyond run.mjs:
//  - idle: no animation frames while nothing changes (render on demand)
//  - joint sliders move the robot; mimic joints follow their master; reset pose restores the picture
//  - toggles (collision, frames, joint axes, visual) change the picture
//  - clicking a link in 3D selects it (tree row highlighted); clicking a tree row selects it
//  - large robot (samples/sample-large.urdf, 141 links): time to ready, slider drag frame time
//  - mesh placeholders are listed under "Not loaded (external file)"
// Screenshots go to --out (default .orca/urdf-interact); results.json beside them.
//
//   node tools/harness/urdf-interact.mjs [--out docs/evidence/urdf/interact]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, parseArgs, ROOT, serve } from './lib.mjs'

const args = parseArgs()
const OUT = join(ROOT, typeof args.out === 'string' ? args.out : '.orca/urdf-interact')
mkdirSync(OUT, { recursive: true })
const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
const PROBE = () => {
  const raf = window.requestAnimationFrame.bind(window)
  window.__raf = 0
  window.requestAnimationFrame = (cb) => {
    window.__raf++
    return raf(cb)
  }
}
async function open(context, file, theme = 'dark') {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()))
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`))
  const t0 = Date.now()
  await page.goto(`${base}/harness?file=samples/${file}&theme=${theme}&locale=en`)
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 60000, polling: 50 })
  const ms = Date.now() - t0
  await page.waitForTimeout(300)
  return { page, errors, ms }
}
const shot = async (page, name) => {
  const buf = await page.locator('.fp-urdf-stage').screenshot()
  writeFileSync(join(OUT, `${name}.png`), buf)
  return buf
}
const differs = (a, b) => Buffer.compare(a, b) !== 0
const click = (page, title) => page.locator(`.fp-toolbar button[title^="${title}"]`).click()
const setSlider = (page, name, value) =>
  page.evaluate(
    ([n, v]) => {
      const el = document.querySelector(`.fp-urdf-joint input[aria-label="${n}"]`)
      el.value = String(v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [name, value]
  )

const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.addInitScript(PROBE)

// Arm: sliders, reset, toggles, idle
{
  const { page, errors } = await open(context, 'sample-arm.urdf')
  const before = await page.evaluate(() => window.__raf)
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => window.__raf)
  record('arm: idle draws nothing', after - before <= 1, `${after - before} animation frames in 0.8 s`)
  const home = await shot(page, 'arm-home')
  await setSlider(page, 'joint_2', 0.9)
  await setSlider(page, 'joint_3', -1.2)
  await page.waitForTimeout(250)
  const posed = await shot(page, 'arm-posed')
  record('arm: sliders move the robot', differs(home, posed))
  const label = await page.locator('.fp-urdf-joint:has(input[aria-label="joint_2"]) .v').textContent()
  record('arm: slider value shown in degrees', /51\.6°/.test(label ?? ''), label)
  await click(page, 'Reset pose')
  await page.waitForTimeout(250)
  const reset = await shot(page, 'arm-reset')
  record('arm: reset pose restores the picture', !differs(home, reset))
  for (const [title, name] of [
    ['Show collision', 'collision'],
    ['Link frames', 'frames'],
    ['Joint axes', 'axes']
  ]) {
    await click(page, title)
    await page.waitForTimeout(200)
    const s = await shot(page, `arm-${name}`)
    record(`arm: ${name} toggle changes the picture`, differs(home, s))
    await click(page, title)
  }
  await click(page, 'Show visual')
  await page.waitForTimeout(200)
  record('arm: visual toggle hides the robot', differs(home, await shot(page, 'arm-novisual')))
  await click(page, 'Show visual')
  // Click on the robot near the middle of the stage until something is selected.
  const box = await page.locator('.fp-urdf-stage canvas').boundingBox()
  let picked = null
  for (const [fx, fy] of [[0.35, 0.75], [0.3, 0.5], [0.4, 0.4], [0.5, 0.3], [0.45, 0.6]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    await page.waitForTimeout(150)
    picked = await page.evaluate(() => document.querySelector('.fp-urdf-tree li.sel')?.textContent ?? null)
    if (picked) break
  }
  record('arm: clicking a link in 3D selects it in the tree', !!picked, picked ?? 'nothing selected')
  await shot(page, 'arm-picked')
  await page.locator('.fp-urdf-tree li', { hasText: 'forearm_link' }).first().click()
  await page.waitForTimeout(200)
  const detail = await page.locator('.fp-urdf-detail').nth(1).textContent()
  record('arm: clicking a tree row selects the link and shows its joint', /forearm_link/.test(detail) && /joint_3/.test(detail), detail?.slice(0, 120))
  await shot(page, 'arm-selected-forearm')
  record('arm: no page errors', errors.length === 0, errors.join(' | '))
  await page.close()
}

// Gripper: mimic + placeholders
{
  const { page, errors } = await open(context, 'sample-gripper.urdf')
  const home = await shot(page, 'gripper-home')
  await setSlider(page, 'finger_joint', 0.7)
  await page.waitForTimeout(250)
  const closed = await shot(page, 'gripper-closed')
  const mimic = await page.locator('.fp-urdf-joint:has(input[aria-label="right_finger_joint"]) .v').textContent()
  const knuckle = await page.locator('.fp-urdf-joint:has(input[aria-label="right_knuckle_joint"]) .v').textContent()
  record('gripper: driving finger_joint moves the mimic joints', differs(home, closed) && mimic === '40.1°' && knuckle === '-40.1°', `right_knuckle ${knuckle}, right_finger ${mimic}`)
  const listed = await page.evaluate(() => [...document.querySelectorAll('.fp-urdf-panel h3')].map((x) => x.textContent).find((t) => /Not loaded/.test(t)))
  record('gripper: meshes listed as not loaded', /Not loaded \(external file\) 4/.test(listed ?? ''), listed)
  const labels = await page.locator('.fp-urdf-label:visible').count()
  record('gripper: placeholders are labelled with file names', labels === 4, `${labels} labels`)
  record('gripper: no page errors', errors.length === 0, errors.join(' | '))
  await page.close()
}

// Large robot
{
  const { page, errors, ms } = await open(context, 'sample-large.urdf')
  const n = await page.locator('.fp-urdf-joint input').count()
  record('large: 141 links ready', ms < 5000, `${ms} ms to ready, ${n} sliders`)
  const t = await page.evaluate(async () => {
    const el = document.querySelector('.fp-urdf-joint input[aria-label="tail_000_joint"]')
    const times = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      el.value = String(-0.4 + i * 0.04)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    return times[Math.floor(times.length / 2)]
  })
  record('large: slider drag stays responsive', t < 100, `median ${t.toFixed(1)} ms per slider step (two frames)`)
  await shot(page, 'large')
  record('large: no page errors', errors.length === 0, errors.join(' | '))
  await page.close()
}

// Phone: panel hidden by default, toggled
{
  const phone = await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await phone.newPage()
  await page.goto(`${base}/harness?file=samples/sample-robot.urdf.xacro&theme=light&locale=ko`)
  await page.waitForFunction(() => document.body.dataset.state === 'ready', null, { timeout: 60000 })
  await page.waitForTimeout(300)
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('.fp-urdf-panel')).display === 'none')
  await page.screenshot({ path: join(OUT, 'phone-closed.png') })
  await page.locator('.fp-toolbar button[aria-controls="fp-urdf-panel"]').click()
  await page.waitForTimeout(200)
  const shown = await page.evaluate(() => getComputedStyle(document.querySelector('.fp-urdf-panel')).display !== 'none')
  await page.screenshot({ path: join(OUT, 'phone-panel.png') })
  record('phone: panel hidden by default and opens from the toolbar', hidden && shown)
  await phone.close()
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2) + '\n')
await browser.close()
server.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed → ${OUT}`)
process.exitCode = failed ? 1 : 0
