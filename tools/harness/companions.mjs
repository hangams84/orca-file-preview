// Companion files in the browser harness (Orca's frame CSP: no network, no blob: scripts): files the
// user hands to the preview with the 📁 folder picker (Playwright file chooser on the webkitdirectory
// input) or by dropping them (a synthetic drop with a DataTransfer), for samples/companions/…:
//  - robot.urdf.xacro: includes ($(find), relative, nested) resolve, then every mesh placeholder becomes a
//    mesh (STL binary/ASCII, DAE with a texture, OBJ with .mtl and a texture)
//  - robot.urdf: dropped meshes replace the placeholders live and the joint pose stays
//  - OBJ + MTL + texture, glTF + external .bin + image, DAE + texture, DXF with xrefs and an IMAGE
//  - the File Preview panel: "Open folder…" (setInputFiles), a drop, and a 150 MB STL through "Open file…"
// Screenshots and results.json go to --out (default docs/evidence/companions/harness).
//
//   node tools/harness/companions.mjs [--out dir] [--no-large]
import { mkdirSync, openSync, statSync, writeFileSync, writeSync, closeSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launch, parseArgs, ROOT, serve } from './lib.mjs'
import { orcaRoute, routeQuery } from './route.mjs'

const args = parseArgs()
const OUT = join(ROOT, typeof args.out === 'string' ? args.out : 'docs/evidence/companions/harness')
mkdirSync(OUT, { recursive: true })
const SAMPLES = 'samples/companions'
const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

async function newPage() {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(t)
    if (/Content Security Policy|Refused to/i.test(t)) errors.push(`CSP: ${t}`)
  })
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`))
  await page.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
  return { page, errors }
}
const settled = (page, timeout = 60000) =>
  page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout, polling: 100 })
async function openEditor(rel) {
  const { page, errors } = await newPage()
  const file = `${SAMPLES}/${rel}`
  await page.goto(`${base}/harness?file=${encodeURIComponent(file)}&theme=dark&locale=en${routeQuery(orcaRoute(ROOT, 'plugin', file))}`)
  await settled(page)
  await page.waitForTimeout(300)
  return { page, errors }
}
const shot = async (page, name, selector = 'body') => {
  const buf = await page.locator(selector).first().screenshot()
  writeFileSync(join(OUT, `${name}.png`), buf)
  return buf
}
const differs = (a, b) => Buffer.compare(a, b) !== 0
/** Clicks the 📁 toolbar button and picks a folder (or files) in the file chooser. */
async function pickFolder(page, paths) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.fp-toolbar button', { hasText: '📁' }).click()])
  await chooser.setFiles(paths)
}
/** A synthetic drop of files (fetched from the harness server) onto `selector`. */
async function dropFiles(page, rels, selector = '.fp-content') {
  await page.evaluate(
    async ([list, sel]) => {
      const dt = new DataTransfer()
      for (const rel of list) {
        const r = await fetch('/' + rel)
        const b = await r.blob()
        dt.items.add(new File([b], rel.split('/').pop()))
      }
      const target = document.querySelector(sel)
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    [rels, selector]
  )
}
const cspOf = (page) => page.evaluate(() => window.__csp)
const finish = async (name, page, errors) => {
  const csp = await cspOf(page)
  record(`${name}: no errors, no CSP violations`, errors.length === 0 && csp.length === 0, [...errors, ...csp].slice(0, 3).join(' | '))
  await page.close()
}
const meshes = (page) => page.evaluate(() => document.querySelector('.fp-urdf-stage')?.dataset.meshes ?? '')
const waitMeshes = (page, want, timeout = 30000) =>
  page.waitForFunction((w) => document.querySelector('.fp-urdf-stage')?.dataset.meshes === w, want, { timeout, polling: 100 }).then(
    () => true,
    () => false
  )
const text = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent).join(' | '), sel)

// ---- xacro: folder picker → includes, then meshes ----------------------------------------------------
{
  const name = 'xacro-folder'
  const { page, errors } = await openEditor('ros_pkg/demo_bot/urdf/robot.urdf.xacro')
  const before = await shot(page, `${name}-before`)
  const links0 = await text(page, '.fp-toolbar .fp-info')
  const missing0 = await text(page, '.fp-urdf-files h3')
  record(`${name}: without files the includes are listed`, /Includes not loaded 2/.test(missing0), missing0)
  await pickFolder(page, join(ROOT, SAMPLES, 'ros_pkg'))
  const ok = await waitMeshes(page, '5/5')
  await page.waitForTimeout(600)
  const after = await shot(page, `${name}-after`)
  const links1 = await text(page, '.fp-toolbar .fp-info')
  const files1 = await text(page, '.fp-urdf-files h3')
  record(`${name}: includes resolve, 5 placeholders become meshes`, ok, `${links0} → ${links1}; meshes ${await meshes(page)}`)
  record(`${name}: missing lists are gone`, !/not loaded|Includes not loaded/i.test(files1), files1)
  record(`${name}: picture changes`, differs(before, after))
  await finish(name, page, errors)
}

// ---- plain URDF: drop meshes live, the pose stays -------------------------------------------------
{
  const name = 'urdf-drop'
  const { page, errors } = await openEditor('ros_pkg/demo_bot/urdf/robot.urdf')
  await page.evaluate(() => {
    const el = document.querySelector('.fp-urdf-joint input[aria-label="arm_joint"]')
    el.value = '0.8'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(200)
  const before = await shot(page, `${name}-before`, '.fp-urdf-stage')
  const m0 = await meshes(page)
  const P = `${SAMPLES}/ros_pkg/demo_bot`
  await dropFiles(page, [`${P}/meshes/base.stl`, `${P}/meshes/arm.dae`, `${P}/textures/stripes.png`, `${P}/meshes/gripper.obj`, `${P}/meshes/gripper.mtl`, `${P}/textures/checker.png`])
  const ok = await waitMeshes(page, '3/4')
  await page.waitForTimeout(600)
  const after = await shot(page, `${name}-after`, '.fp-urdf-stage')
  const pose = await page.evaluate(() => document.querySelector('.fp-urdf-joint input[aria-label="arm_joint"]').value)
  const files = await text(page, '.fp-urdf-files li')
  record(`${name}: dropped meshes replace placeholders (lidar stays missing)`, ok && /lidar\.stl/.test(files), `${m0} → ${await meshes(page)}`)
  record(`${name}: joint pose kept`, Math.abs(Number(pose) - 0.8) < 0.01, `arm_joint = ${pose}`)
  record(`${name}: picture changes`, differs(before, after))
  await finish(name, page, errors)
}

// ---- OBJ + MTL + texture ------------------------------------------------------------------------
{
  const name = 'obj-mtl'
  const { page, errors } = await openEditor('obj/model.obj')
  const note0 = await text(page, '.fp-3d-note')
  const before = await shot(page, `${name}-before`)
  await pickFolder(page, join(ROOT, SAMPLES, 'obj'))
  await settled(page)
  await page.waitForTimeout(800)
  const after = await shot(page, `${name}-after`)
  const note1 = await text(page, '.fp-3d-note')
  record(`${name}: .mtl missing is noted, then loaded`, /model\.mtl/.test(note0) && !note1, `${note0} → "${note1}"`)
  record(`${name}: texture changes the picture`, differs(before, after))
  await finish(name, page, errors)
}

// ---- glTF + external .bin + image -----------------------------------------------------------------
{
  const name = 'gltf-bin'
  const { page, errors } = await openEditor('gltf/model.gltf')
  const state0 = await page.evaluate(() => document.body.dataset.state)
  const msg0 = await text(page, '.fp-state')
  await shot(page, `${name}-before`)
  // A refusal is logged as a warning by design; it is not an error.
  await pickFolder(page, join(ROOT, SAMPLES, 'gltf'))
  await page.waitForFunction(() => document.querySelector('.fp-3d-stage canvas'), null, { timeout: 30000 }).catch(() => {})
  await settled(page)
  await page.waitForTimeout(800)
  await shot(page, `${name}-after`)
  const state1 = await page.evaluate(() => document.body.dataset.state)
  const note1 = await text(page, '.fp-3d-note')
  record(`${name}: without the .bin a friendly refusal`, state0 === 'error' && /model\.bin/.test(msg0), msg0.slice(0, 120))
  record(`${name}: with the folder the model renders (blob: buffer and image)`, state1 === 'ready' && !note1, `state ${state1} note "${note1}"`)
  await finish(name, page, errors)
}

// ---- DAE + texture (drop) ---------------------------------------------------------------------------
{
  const name = 'dae-texture'
  const { page, errors } = await openEditor('dae/textured.dae')
  const note0 = await text(page, '.fp-3d-note')
  const before = await shot(page, `${name}-before`)
  await dropFiles(page, [`${SAMPLES}/dae/checker.png`])
  await page.waitForFunction(() => !document.querySelector('.fp-3d-note') && document.body.dataset.state === 'ready', null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800)
  const after = await shot(page, `${name}-after`)
  record(`${name}: missing texture noted, then drawn`, /checker\.png/.test(note0) && !(await text(page, '.fp-3d-note')), note0)
  record(`${name}: picture changes`, differs(before, after))
  await finish(name, page, errors)
}

// ---- DXF: xref + IMAGE ----------------------------------------------------------------------------
{
  const name = 'dxf-xref'
  const { page, errors } = await openEditor('dxf/main.dxf')
  const n0 = await text(page, '.cad-notice')
  const before = await shot(page, `${name}-before`)
  await pickFolder(page, join(ROOT, SAMPLES, 'dxf'))
  await settled(page)
  await page.waitForTimeout(600)
  const after = await shot(page, `${name}-after`)
  const n1 = await text(page, '.cad-notice')
  record(`${name}: xrefs and the image are listed when missing`, /bolt\.dxf/.test(n0) && /title\.dxf/.test(n0) && /logo\.png/.test(n0), n0)
  record(`${name}: bolt.dxf inserted and logo drawn; only title.dxf left`, !/bolt\.dxf|logo\.png/.test(n1) && /title\.dxf/.test(n1), n1)
  record(`${name}: picture changes`, differs(before, after))
  await page.locator('.fp-toolbar button', { hasText: 'Layers' }).click()
  await page.waitForTimeout(200)
  const layers = await text(page, '.cad-layers')
  record(`${name}: xref layers listed as BOLT|layer`, /BOLT\|BOLT/.test(layers), layers.slice(0, 120))
  await finish(name, page, errors)
}

// ---- panel ----------------------------------------------------------------------------------------
async function openPanel(width = 420) {
  const { page, errors } = await newPage()
  await page.setViewportSize({ width, height: 800 })
  await page.goto(`${base}/harness?panel=1&entry=${encodeURIComponent('panel/main.ts')}&theme=dark&locale=en`)
  await settled(page)
  return { page, errors }
}
{
  const name = 'panel-folder'
  const { page, errors } = await openPanel()
  await shot(page, `${name}-empty`)
  await page.setInputFiles('#fp-panel-folder', join(ROOT, SAMPLES, 'ros_pkg'))
  await page.waitForSelector('.fp-panel-list button')
  const listed = await text(page, '.fp-panel-list .p')
  await shot(page, `${name}-list`)
  await page.locator('.fp-panel-list button', { hasText: 'robot.urdf.xacro' }).click()
  await settled(page)
  const ok = await waitMeshes(page, '5/5')
  await page.waitForTimeout(600)
  await shot(page, `${name}-xacro`)
  record(`${name}: folder lists the previewable files`, /robot\.urdf\.xacro/.test(listed) && /base\.stl/.test(listed), listed.slice(0, 140))
  record(`${name}: xacro with includes and meshes from the same folder`, ok, `meshes ${await meshes(page)}`)
  await finish(name, page, errors)
}
{
  const name = 'panel-drop'
  const { page, errors } = await openPanel()
  await dropFiles(page, [`${SAMPLES}/dxf/main.dxf`], 'body')
  await settled(page)
  await page.waitForSelector('.cad-notice')
  const n0 = await text(page, '.cad-notice')
  // A second drop onto the drawing gives it the xref and the image.
  await dropFiles(page, [`${SAMPLES}/dxf/parts/bolt.dxf`, `${SAMPLES}/dxf/images/logo.png`])
  await page.waitForFunction(() => !/bolt\.dxf/.test(document.querySelector('.cad-notice')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {})
  await settled(page)
  await page.waitForTimeout(500)
  await shot(page, `${name}-dxf`)
  const n1 = await text(page, '.cad-notice')
  const name1 = await text(page, '.fp-panel-name')
  record(`${name}: a dropped file opens; a drop on the drawing adds its references`, /main\.dxf/.test(name1) && /bolt\.dxf/.test(n0) && !/bolt\.dxf/.test(n1), `${n0} → ${n1}`)
  await finish(name, page, errors)
}
if (!args['no-large']) {
  // 150 MB binary STL (3,000,000 triangles: a grid of boxes), generated outside the repo.
  const big = join(ROOT, '.orca', 'large', 'large-150mb.stl')
  const tris = 3_000_000
  if (!existsSync(big) || statSync(big).size !== 84 + tris * 50) {
    mkdirSync(join(ROOT, '.orca', 'large'), { recursive: true })
    const fd = openSync(big, 'w')
    const head = Buffer.alloc(84)
    head.write('File Preview harness: 150 MB STL', 0, 'latin1')
    head.writeUInt32LE(tris, 80)
    writeSync(fd, head)
    const per = 12 // triangles per box
    const boxes = tris / per
    const side = Math.ceil(Math.sqrt(boxes))
    const chunk = Buffer.alloc(per * 50 * 1000)
    let off = 0
    const quad = [[0, 1, 2], [0, 2, 3]]
    const faces = [
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]],
      [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
      [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]
    ]
    for (let b = 0; b < boxes; b++) {
      const x = (b % side) * 1.5
      const y = Math.floor(b / side) * 1.5
      const hgt = 0.3 + 0.7 * Math.abs(Math.sin(b * 0.01))
      for (const f of faces)
        for (const q of quad) {
          off += 12
          for (const v of q) {
            const p = f[v]
            chunk.writeFloatLE(x + p[0], off)
            chunk.writeFloatLE(y + p[1], off + 4)
            chunk.writeFloatLE(p[2] * hgt, off + 8)
            off += 12
          }
          off += 2
        }
      if (off === chunk.length) {
        writeSync(fd, chunk)
        off = 0
      }
    }
    if (off) writeSync(fd, chunk, 0, off)
    closeSync(fd)
  }
  const name = 'panel-large'
  const { page, errors } = await openPanel(900)
  const t0 = Date.now()
  await page.setInputFiles('#fp-panel-open', big)
  await page.waitForFunction(() => document.body.dataset.state === 'loading', null, { timeout: 30000 }).catch(() => {})
  await settled(page, 300000)
  const ms = Date.now() - t0
  await page.waitForTimeout(800)
  await shot(page, `${name}`)
  const state = await page.evaluate(() => document.body.dataset.state)
  const info = await text(page, '.fp-toolbar .fp-info')
  const mb = (statSync(big).size / 1048576).toFixed(1)
  record(`${name}: ${mb} MiB STL renders through "Open file…" (over Orca's 50 MB editor limit)`, state === 'ready' && /3,000,000|3\.0M|3 000 000/.test(info), `${ms} ms · ${info}`)
  await finish(name, page, errors)
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2))
await browser.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
