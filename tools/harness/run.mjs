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
//   node tools/harness/run.mjs --dir samples/fuzz --fuzz --no-shots   # damaged inputs: must settle, never hang/crash
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

function checkFor(name) {
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
  const { chromium } = await import('playwright-core')
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
  const browser = await chromium.launch({ executablePath, headless: true })
  const out = join(ROOT, args.out ?? '.orca/harness-shots')
  mkdirSync(out, { recursive: true })
  const only = typeof args.only === 'string' ? args.only.split(',') : null
  const files = readdirSync(join(ROOT, SAMPLE_DIR))
    .filter((f) => !f.startsWith('.') && statSync(join(ROOT, SAMPLE_DIR, f)).isFile())
    .filter((f) => !only || only.some((o) => f.includes(o)))
    .sort()
  const profiles = (typeof args.profiles === 'string' ? args.profiles.split(',') : ['desktop-dark', 'mobile-light']).map(
    (p) => [p, PROFILES[p]]
  )

  const results = []
  for (const [pname, profile] of profiles) {
    const newContext = async () => {
      const c = await browser.newContext({ ...profile, theme: undefined, locale: undefined })
      if (args['no-raf']) await c.addInitScript(NO_RAF_INIT)
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
      try {
        await page.goto(url, { waitUntil: 'load' })
        await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, {
          timeout: Number(args.timeout) || 30000,
          polling: 100 // not 'raf': frames may be stubbed out (--no-raf)
        })
        state = await page.evaluate(() => document.body.dataset.state)
        await page.waitForTimeout(600)
      } catch (e) {
        errors.push(`harness: ${e.message.split('\n')[0]}`)
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
      if (checkFor(f)) checkError = await page.evaluate(checkFor(f)).catch((e) => `check failed: ${e.message}`)
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
