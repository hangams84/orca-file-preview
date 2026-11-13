// Browser test harness for the preview editor, outside Orca.
//
// Serves the repository with `.ts` transpiled per request (as Orca does, no bundling) under an
// Orca-like content security policy (no eval, no network, no framed URLs), opens each fixture in
// samples/ through a mock `orca` host, waits for the preview to settle and saves a screenshot per
// device profile. Writes results.json and results.md next to the screenshots.
//
//   node tools/harness/run.mjs --out docs/evidence/round1 [--only docx,pdf] [--profiles desktop-dark,mobile-light]
//   node tools/harness/run.mjs --serve        # just serve, print the URL, for manual checks
//   node tools/harness/run.mjs --no-raf ...   # stub requestAnimationFrame + IntersectionObserver (hidden window)
//   node tools/harness/run.mjs --old-engine ...  # delete Promise.withResolvers, findLast, structuredClone, ... (also in workers)
//   node tools/harness/run.mjs --dir samples/fuzz --fuzz --no-shots   # damaged inputs: must settle, never hang/crash
//   node tools/harness/run.mjs --engine webkit ...   # Safari engine (npx playwright-core install webkit)
//   node tools/harness/run.mjs --dpr 1.25,1.5,1.75 ...  # run each profile at these device pixel ratios
//   node tools/harness/run.mjs --strip-styles ...      # remove renderer <style> elements after load (as seen in Orca)
//                                                      (Windows display scaling 125 % / 150 % / 175 %)
import { transform } from 'esbuild'
import { createServer } from 'node:http'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
    return acc
  }, [])
)

const CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' blob: data:",
  "img-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'"
].join('; ')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.map': 'application/json'
}

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      let path = decodeURIComponent(url.pathname)
      if (path === '/' || path === '/harness') path = '/tools/harness/index.html'
      const file = normalize(join(ROOT, path))
      if (relative(ROOT, file).startsWith('..')) throw Object.assign(new Error('outside'), { status: 403 })
      let body = readFileSync(file)
      let type = TYPES[extname(file)] ?? 'application/octet-stream'
      if (/\.(ts|tsx|mts)$/.test(file)) {
        const out = await transform(body.toString('utf8'), {
          loader: file.endsWith('x') ? 'tsx' : 'ts',
          format: 'esm',
          target: 'es2022',
          sourcefile: path
        })
        body = Buffer.from(out.code)
        type = TYPES['.js']
      }
      res.writeHead(200, { 'content-type': type, 'content-security-policy': CSP, 'cache-control': 'no-store' })
      res.end(body)
    } catch (e) {
      res.writeHead(e.status ?? (e.code === 'ENOENT' ? 404 : 500))
      res.end(String(e.message ?? e))
    }
  })
  return new Promise((resolve) => server.listen(Number(args.port) || 0, '127.0.0.1', () => resolve(server)))
}

const PROFILES = {
  'desktop-dark': { viewport: { width: 1280, height: 800 }, theme: 'dark', locale: 'ko' },
  'desktop-light': { viewport: { width: 1280, height: 800 }, theme: 'light', locale: 'en' },
  'mobile-light': {
    viewport: { width: 390, height: 844 },
    theme: 'light',
    locale: 'ko',
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
  },
  'tablet-dark': { viewport: { width: 820, height: 1180 }, theme: 'dark', locale: 'ko', isMobile: true, hasTouch: true }
}

/** Per-file checks run in the page after it settles; each returns an error string or null. */
const CHECKS = {
  'sample.html': `(() => {
    const t = document.body.innerText + [...document.querySelectorAll('iframe')].map(f => { try { return f.contentDocument?.body?.innerText ?? '' } catch { return '' } }).join(' ')
    if (t.includes('SCRIPT RAN')) return 'script inside the previewed HTML ran'
    return null })()`,
  'sample.svg': `(() => document.body.innerText.includes('SCRIPT RAN') ? 'script inside the SVG ran' : null)()`
}

/** Every rendered PDF must have painted pixels on its first page canvas (catches blank pages). */
const PDF_PAINTED = `(() => {
  const c = document.querySelector('.fp-pdf-page canvas')
  if (!c) return 'no page canvas was drawn'
  const g = c.getContext('2d')
  const d = g.getImageData(0, 0, c.width, c.height).data
  let ink = 0
  for (let i = 0; i < d.length; i += 4 * 7) if (d[i + 3] > 0 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235)) ink++
  return ink > 20 ? null : 'page canvas is blank'
})()`

/** Security fixtures (samples/xss-*): nothing inside may execute, navigate, load, or cover the
 *  toolbar. Clicks every link/button in same-origin frames first (interaction-triggered vectors),
 *  then looks for the markers the fixtures set when a payload runs, plus dangerous leftovers. */
const XSS_CHECK = `(async () => {
  const problems = []
  const frames = () => {
    const out = []
    const walk = (doc, depth) => {
      if (!doc || depth > 4) return
      out.push(doc)
      for (const f of doc.querySelectorAll('iframe, frame, object, embed')) {
        try { walk(f.contentDocument, depth + 1) } catch { problems.push('cross-origin frame present: ' + f.tagName) }
      }
    }
    walk(document, 0)
    return out
  }
  const start = location.href
  // interaction-triggered vectors
  for (const doc of frames().slice(1)) {
    for (const el of doc.querySelectorAll('a, button, input, details, summary, [onclick], [onfocus]')) {
      try { el.focus?.(); el.click?.(); el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) } catch {}
    }
  }
  await new Promise((r) => setTimeout(r, 500))
  if (location.href !== start) problems.push('top frame navigated to ' + location.href)
  const docs = frames()
  if (document.title === 'XSS') problems.push('top document.title set to XSS')
  for (const doc of docs) {
    const w = doc.defaultView
    const where = doc === document ? 'top' : 'frame ' + (doc.URL || '').slice(0, 30)
    if (doc.body?.dataset?.pwned) problems.push(where + ' marker from:' + doc.body.dataset.pwned)
    if (doc.title === 'XSS' && doc !== document) problems.push(where + ' title set')
    if ((doc.body?.textContent ?? '').includes('PWNED')) problems.push(where + ' contains PWNED text')
    if (doc === document) continue
    // dangerous leftovers in the sanitized preview document
    for (const el of doc.querySelectorAll('*')) {
      for (const a of el.attributes) {
        const n = a.name.toLowerCase()
        const v = a.value.replace(/[\\s\\u0000-\\u001f]/g, '').toLowerCase()
        if (n.startsWith('on')) problems.push(where + ' event handler kept: <' + el.localName + ' ' + n + '>')
        if (/^(javascript|vbscript):/.test(v) || (/^data:text\\/html/.test(v) && n !== 'title')) problems.push(where + ' script URL kept: <' + el.localName + ' ' + n + '>')
      }
      const tag = el.localName
      if (['script', 'iframe', 'frame', 'object', 'embed', 'base', 'link', 'portal'].includes(tag)) problems.push(where + ' element kept: <' + tag + '>')
      if (tag === 'meta' && /refresh/i.test(el.getAttribute('http-equiv') || '')) problems.push(where + ' meta refresh kept')
      if ((tag === 'animate' || tag === 'set') && /href|^on/i.test(el.getAttribute('attributeName') || '')) problems.push(where + ' <' + tag + ' attributeName=' + el.getAttribute('attributeName') + '> kept')
    }
    // fixed elements must stay inside the preview, never over the toolbar
    const barEl = document.querySelector('.fp-toolbar')
    const bar = barEl?.getBoundingClientRect()
    if (bar) {
      for (const x of [bar.left + 4, (bar.left + bar.right) / 2, bar.right - 4]) {
        const hit = document.elementFromPoint(x, (bar.top + bar.bottom) / 2)
        if (hit && !barEl.contains(hit)) problems.push('something covers the toolbar: <' + hit.localName + '>')
      }
    }
    const host = w?.frameElement?.getBoundingClientRect?.()
    if (bar && host) {
      if (host.top < bar.bottom - 1) problems.push('preview frame overlaps the toolbar')
      for (const el of doc.querySelectorAll('*')) {
        if (w.getComputedStyle(el).position !== 'fixed') continue
        const r = el.getBoundingClientRect()
        const top = host.top + Math.max(r.top, 0)
        if (r.height > 0 && top < bar.bottom - 1) problems.push('position:fixed element covers the toolbar')
      }
    }
  }
  return problems.length ? [...new Set(problems)].join('; ').slice(0, 1500) : null
})()`

function checkFor(name) {
  if (name.startsWith('xss-')) return XSS_CHECK
  if (CHECKS[name]) return CHECKS[name]
  if (name.endsWith('.pdf') && !name.startsWith('broken.') && !name.includes('password')) return PDF_PAINTED
  return null
}

/** --no-raf: simulate a hidden/occluded window (Orca's window captures, background splits), where
 *  requestAnimationFrame and IntersectionObserver callbacks never run. */
const NO_RAF_INIT = () => {
  window.requestAnimationFrame = () => 0
  window.cancelAnimationFrame = () => {}
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
}

/** --old-engine: simulate iOS 16-17.3 / Safari 16 / older Android WebViews by deleting newer
 *  built-ins before any page script runs, and inside every Worker (each Worker is wrapped in a blob
 *  that deletes them first, then loads the real script). */
const OLD_ENGINE_INIT = () => {
  const stripFn = () => {
    const del = (o, k) => {
      try {
        if (o && k in o) delete o[k]
      } catch {}
    }
    del(Promise, 'withResolvers')
    del(Map.prototype, 'getOrInsertComputed')
    del(Map.prototype, 'getOrInsert')
    del(Math, 'sumPrecise')
    del(Uint8Array, 'fromBase64')
    del(Uint8Array, 'fromHex')
    del(Uint8Array.prototype, 'toBase64')
    del(Uint8Array.prototype, 'toHex')
    del(Array.prototype, 'findLast')
    del(Array.prototype, 'findLastIndex')
    del(globalThis, 'structuredClone')
  }
  stripFn()
  // No eval (the page CSP forbids it): the same function's source goes into each worker's blob.
  const strip = `(${stripFn.toString()})();`
  const Native = window.Worker
  window.Worker = class extends Native {
    constructor(url, opts = {}) {
      const abs = new URL(String(url), location.href).href
      const pre = URL.createObjectURL(new Blob([strip], { type: 'text/javascript' }))
      const src =
        opts.type === 'module'
          ? `import ${JSON.stringify(pre)}; import ${JSON.stringify(abs)};`
          : `importScripts(${JSON.stringify(pre)}, ${JSON.stringify(abs)});`
      super(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), opts)
    }
  }
}

const MODEL_RE = /\.(stl|obj|ply|glb|gltf|3mf|off|fbx|dae)$/i

/** Where the drawn model sits in the visible pane, from a real screenshot (what the person sees, so
 *  a drawing buffer that is larger than its CSS box shows up as an off-centre model): the bounding
 *  box of pixels that differ from the background, as fractions of the pane. */
async function modelCentre(page) {
  await page.evaluate(() => document.querySelectorAll('.fp-3d-note').forEach((n) => (n.style.display = 'none')))
  const png = await page.locator('.fp-content').screenshot()
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas') // not OffscreenCanvas: Playwright's WebKit lacks it
    c.width = bmp.width
    c.height = bmp.height
    const g = c.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data
    // a 3-px margin is skipped: a pane at a fractional offset catches a sliver of the toolbar border
    const m = 3
    const bi = (m * bmp.width + m) * 4
    const bg = [d[bi], d[bi + 1], d[bi + 2]]
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
    for (let y = m; y < bmp.height - m; y++) {
      for (let x = m; x < bmp.width - m; x++) {
        const i = (y * bmp.width + x) * 4
        if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    if (x1 < 0) return null
    return { cx: (x0 + x1 + 1) / 2 / bmp.width, cy: (y0 + y1 + 1) / 2 / bmp.height, w: (x1 - x0 + 1) / bmp.width, h: (y1 - y0 + 1) / bmp.height }
  }, png.toString('base64'))
}

async function modelCentreCheck(page, profile) {
  const fmt = (m) => `centre ${(m.cx * 100).toFixed(1)}%/${(m.cy * 100).toFixed(1)}%, size ${(m.w * 100).toFixed(0)}%×${(m.h * 100).toFixed(0)}%`
  const off = (m) => !m || Math.abs(m.cx - 0.5) > 0.03 || Math.abs(m.cy - 0.5) > 0.03 || m.w > 0.995 || m.h > 0.995
  const a = await modelCentre(page)
  if (off(a)) return a ? `model off-centre at load: ${fmt(a)}` : 'model not visible'
  // a pane resize after load (Orca splits, window resize): narrower and shorter
  const vp = page.viewportSize()
  await page.setViewportSize({ width: Math.round(vp.width * 0.7), height: Math.round(vp.height * 0.8) })
  await page.waitForTimeout(500)
  const b = await modelCentre(page)
  await page.setViewportSize(vp)
  await page.waitForTimeout(300)
  if (off(b)) return b ? `model off-centre after resize: ${fmt(b)}` : 'model not visible after resize'
  void profile
  return null
}

const IMAGE_RE = /.(gif|bmp|svg)$/i

/** Raster/SVG previews: the image must be centred in the pane and fitted (never larger than the pane;
 *  an image larger than the pane fills it along one side), at load and after the pane resizes. */
async function imageCentreCheck(page) {
  const fmt = (m) => `centre ${(m.cx * 100).toFixed(1)}%/${(m.cy * 100).toFixed(1)}%, size ${(m.w * 100).toFixed(0)}%×${(m.h * 100).toFixed(0)}%`
  const check = async (when) => {
    const big = await page.evaluate(() => {
      const img = document.querySelector('.fp-content img')
      const root = document.querySelector('.fp-content')
      return !!img && !!root && (img.naturalWidth > root.clientWidth - 24 || img.naturalHeight > root.clientHeight - 24)
    })
    const m = await modelCentre(page)
    if (!m) return `image not visible ${when}`
    if (Math.abs(m.cx - 0.5) > 0.03 || Math.abs(m.cy - 0.5) > 0.03) return `image off-centre ${when}: ${fmt(m)}`
    if (m.w > 0.995 || m.h > 0.995) return `image not fitted ${when}: ${fmt(m)}`
    if (big && Math.max(m.w, m.h) < 0.85) return `large image not fitted to the pane ${when}: ${fmt(m)}`
    return null
  }
  const a = await check('at load')
  if (a) return a
  const vp = page.viewportSize()
  await page.setViewportSize({ width: Math.round(vp.width * 0.7), height: Math.round(vp.height * 0.8) })
  await page.waitForTimeout(500)
  const b = await check('after resize')
  await page.setViewportSize(vp)
  await page.waitForTimeout(300)
  return b
}

/** --strip-styles: what Orca's frame did to renderer stylesheets (they did not take effect): after the
 *  preview settles, remove every renderer-added <style> (in-body ones and media/styles.ts head
 *  sheets), keeping only the shell's own stylesheet from core/ui.ts installStyles, then resize. */
async function stripRendererStyles(page) {
  const removed = await page.evaluate(() => {
    const keep = document.head.querySelector('style:not([data-fp-renderer])')
    let n = 0
    for (const st of document.querySelectorAll('style')) {
      if (st === keep) continue
      st.remove()
      n++
    }
    window.dispatchEvent(new Event('resize'))
    return n
  })
  await page.waitForTimeout(400)
  return removed
}

function expectedState(name) {
  if (args.fuzz) return 'ready|error' // fuzzed input: any settled state, never a hang or a crash
  return name.startsWith('broken.') ? 'error' : 'ready'
}
const SAMPLE_DIR = typeof args.dir === 'string' ? args.dir.replace(/\\/g, '/').replace(/\/$/, '') : 'samples'

async function run() {
  const server = await serve()
  const base = `http://127.0.0.1:${server.address().port}`
  if (args.serve) {
    console.log(`serving ${ROOT} at ${base}/harness?file=samples/sample.docx&theme=dark&locale=ko`)
    return
  }
  const { chromium, webkit } = await import('playwright-core')
  const executablePath =
    args.chrome ??
    [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium'
    ].find((p) => {
      try {
        return statSync(p).isFile()
      } catch {
        return false
      }
    })
  // --engine webkit: Safari's engine (Playwright's bundled WebKit), the closest stand-in for iOS.
  const browser =
    args.engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath, headless: true })
  const out = join(ROOT, args.out ?? '.orca/harness-shots')
  mkdirSync(out, { recursive: true })
  const only = typeof args.only === 'string' ? args.only.split(',') : null
  const files = readdirSync(join(ROOT, SAMPLE_DIR))
    .filter((f) => !f.startsWith('.') && statSync(join(ROOT, SAMPLE_DIR, f)).isFile())
    .filter((f) => !only || only.some((o) => f.includes(o)))
    .sort()
  let profiles = (typeof args.profiles === 'string' ? args.profiles.split(',') : ['desktop-dark', 'mobile-light']).map(
    (p) => [p, PROFILES[p]]
  )
  if (typeof args.dpr === 'string' || typeof args.dpr === 'number') {
    const ratios = String(args.dpr).split(',').map(Number).filter((x) => x > 0)
    profiles = profiles.flatMap(([p, prof]) => ratios.map((r) => [`${p}@${r}x`, { ...prof, deviceScaleFactor: r }]))
  }

  const results = []
  for (const [pname, profile] of profiles) {
    const newContext = async () => {
      const c = await browser.newContext({ ...profile, theme: undefined, locale: undefined })
      if (args['no-raf']) await c.addInitScript(NO_RAF_INIT)
      if (args['old-engine']) await c.addInitScript(OLD_ENGINE_INIT)
      return c
    }
    let context = await newContext()
    for (const f of files) {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`)
      })
      const started = Date.now()
      const url = `${base}/harness?file=${SAMPLE_DIR}/${encodeURIComponent(f)}&theme=${profile.theme}&locale=${profile.locale}`
      let state = 'timeout'
      const limit = Number(args.timeout) || 30000
      let timer
      try {
        // Playwright's own polling runs inside the page, so a frozen page never times out:
        // enforce the limit from Node as well.
        await Promise.race([
          (async () => {
            await page.goto(url, { waitUntil: 'load', timeout: limit })
            await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, {
              timeout: limit,
              polling: 100 // not 'raf': frames may be stubbed out (--no-raf)
            })
            state = await page.evaluate(() => document.body.dataset.state)
            await page.waitForTimeout(600)
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`did not settle within ${limit} ms`)), limit + 5000)
          })
        ])
      } catch (e) {
        if (state !== 'ready' && state !== 'error') state = 'timeout'
        errors.push(`harness: ${e.message.split('\n')[0]}`)
      } finally {
        clearTimeout(timer)
      }
      const ms = Date.now() - started
      if (state === 'timeout') {
        // The page may be frozen (a renderer stuck in a loop): nothing more can run in it, and
        // same-origin pages share its process, so start the next file in a fresh context.
        const expected = expectedState(f)
        results.push({ file: f, profile: pname, state, expected, ms, pass: false, checkError: 'did not settle (frozen or too slow)', overflowX: false, errors, shot: null })
        console.log(`FAIL ${pname.padEnd(13)} ${f.padEnd(24)} timeout ${String(ms).padStart(6)}ms did not settle`)
        await Promise.race([context.close(), new Promise((r) => setTimeout(r, 5000))])
        context = await newContext()
        continue
      }
      let checkError = null
      // Per-file checks assert a finished render (scripts did not run, pages painted): they do not apply
      // to damaged inputs or to previews that correctly ended in an error.
      if (checkFor(f) && !(args.fuzz && state === 'error') && !(args.fuzz && /\.pdf$/i.test(f))) checkError = await page.evaluate(checkFor(f)).catch((e) => `check failed: ${e.message}`)
      // "ready" must also mean something is on screen inside the content area's first viewport.
      if (!checkError && state === 'ready' && !args.fuzz) {
        checkError = await page
          .evaluate(() => {
            const root = document.querySelector('.fp-content')
            if (!root) return 'no content area'
            const view = root.getBoundingClientRect()
            const inView = (el) => {
              const r = el.getBoundingClientRect()
              return r.width > 4 && r.height > 4 && r.bottom > view.top && r.top < view.bottom
            }
            const walk = (node) => {
              for (const el of node.querySelectorAll('img, canvas, svg, iframe, video')) if (inView(el)) return true
              const tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
              for (let t = tw.nextNode(); t; t = tw.nextNode()) {
                if (!t.nodeValue.trim() || !t.parentElement) continue
                if (t.parentElement.closest('style, script')) continue
                if (inView(t.parentElement)) return true
              }
              for (const el of node.querySelectorAll('*')) if (el.shadowRoot && walk(el.shadowRoot)) return true
              return false
            }
            return walk(root) ? null : 'ready but nothing visible in the content area'
          })
          .catch((e) => `content check failed: ${e.message}`)
      }
      if (args['strip-styles'] && state === 'ready' && !args.fuzz) {
        const n = await stripRendererStyles(page).catch(() => 0)
        if (n) errors.push(`info: removed ${n} renderer <style> element(s)`)
      }
      // Images: centred and fitted in the pane, also after it resizes.
      if (!checkError && state === 'ready' && !args.fuzz && IMAGE_RE.test(f)) {
        checkError = await imageCentreCheck(page).catch((e) => `image centre check failed: ${e.message}`)
      }
      // 3D models: the fitted model must sit in the middle of the pane, also after the pane resizes.
      if (!checkError && state === 'ready' && !args.fuzz && MODEL_RE.test(f)) {
        checkError = await modelCentreCheck(page, profile).catch((e) => `centre check failed: ${e.message}`)
      }
      const overflowX = await page
        .evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
        .catch(() => false)
      const shot = `${f.replace(/[^\w.-]/g, '_')}.${pname}.png`
      if (!args['no-shots']) await page.screenshot({ path: join(out, shot) }).catch((e) => errors.push(`screenshot: ${e.message}`))
      const expected = expectedState(f)
      const pass = expected.split('|').includes(state) && !checkError && !overflowX && !errors.some((e) => e.startsWith('pageerror'))
      results.push({ file: f, profile: pname, state, expected, ms, pass, checkError, overflowX, errors, shot })
      console.log(`${pass ? 'PASS' : 'FAIL'} ${pname.padEnd(13)} ${f.padEnd(24)} ${state.padEnd(7)} ${String(ms).padStart(6)}ms${checkError ? ' ' + checkError : ''}${overflowX ? ' horizontal-overflow' : ''}${errors.length ? ' errors=' + errors.length : ''}`)
      await page.close()
    }
    await context.close()
  }
  await browser.close()
  server.close()

  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2))
  const passed = results.filter((r) => r.pass).length
  const md = [
    `# Harness results`,
    '',
    `${passed} / ${results.length} passed · ${new Date().toISOString()}`,
    '',
    '| Result | Profile | File | State | Time (ms) | Notes |',
    '| --- | --- | --- | --- | ---: | --- |',
    ...results.map(
      (r) =>
        `| ${r.pass ? '✅' : '❌'} | ${r.profile} | \`${r.file}\` | ${r.state} (expect ${r.expected}) | ${r.ms} | ${[
          r.checkError,
          r.overflowX ? 'horizontal overflow' : '',
          ...r.errors.map((e) => e.replace(/\|/g, '\\|').slice(0, 160))
        ]
          .filter(Boolean)
          .join('<br>')} |`
    )
  ].join('\n')
  writeFileSync(join(out, 'results.md'), md + '\n')
  console.log(`\n${passed}/${results.length} passed → ${relative(ROOT, out)}`)
  process.exitCode = passed === results.length ? 0 : 1
}

await run()
