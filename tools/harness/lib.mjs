// Shared helpers for the extra harness scripts (theme-switch.mjs, a11y.mjs): the same Orca-like
// static server as run.mjs (a copy, so run.mjs stays untouched), browser launch and fixture listing.
import { transform } from 'esbuild'
import { createServer } from 'node:http'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.reduce((acc, a, i, all) => {
      if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
      return acc
    }, [])
  )
}

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
  '.wasm': 'application/wasm'
}

export function serve() {
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
        const out = await transform(body.toString('utf8'), { loader: 'ts', format: 'esm', target: 'es2022', sourcefile: path })
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

export async function launch(args) {
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
  return chromium.launch({ executablePath, headless: true })
}

export function fixtures(args, dir = 'samples') {
  const only = typeof args.only === 'string' ? args.only.split(',') : null
  return readdirSync(join(ROOT, dir))
    .filter((f) => !f.startsWith('.') && statSync(join(ROOT, dir, f)).isFile())
    .filter((f) => !only || only.some((o) => f.includes(o)))
    .sort()
}

/** Opens a fixture through the mock host and waits until the preview settles (no rAF polling). */
export async function openFixture(page, base, file, { theme = 'dark', locale = 'en', timeout = 30000 } = {}) {
  await page.goto(`${base}/harness?file=samples/${encodeURIComponent(file)}&theme=${theme}&locale=${locale}`, { waitUntil: 'load' })
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout, polling: 100 })
  return page.evaluate(() => document.body.dataset.state)
}
