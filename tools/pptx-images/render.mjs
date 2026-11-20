// Renders the PPTX picture corpus through the harness page and saves one PNG per slide frame, for
// tools/pptx-images/compare.py. Also audits the same pictures in .docx/.doc/.ppt (images that failed
// to decode, by alt/label) for the cross-format table.
//   node tools/pptx-images/render.mjs --label before|after [--engine chromium|webkit]
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, webkit } from 'playwright-core'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
    return acc
  }, [])
)
const label = args.label ?? 'run'
const DIR = 'samples/pptx-images'
const OUT = join(DIR, 'render', label)
const decks = [
  ...readdirSync(DIR).filter((f) => /^pptx-img-.*\.pptx$/.test(f)).map((f) => join(DIR, f)),
  ...(existsSync('samples/perf/pptx-img-large.pptx') ? ['samples/perf/pptx-img-large.pptx'] : [])
]
const port = 7600 + Math.floor(Math.random() * 300)
const srv = spawn(process.execPath, ['tools/harness/run.mjs', '--serve', '--port', String(port)], { stdio: 'pipe' })
await new Promise((r) => setTimeout(r, 1500))
const engine = args.engine === 'webkit' ? webkit : chromium
const browser = await engine.launch(
  args.engine === 'webkit' ? {} : { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' }
)
const url = (f) => `http://127.0.0.1:${port}/harness?file=${encodeURIComponent(f.replace(/\\/g, '/'))}&theme=light&locale=en`
const summary = { label, decks: {}, others: {} }

for (const deck of decks) {
  const name = deck.replace(/\\/g, '/').split('/').pop().replace(/\.pptx$/, '')
  const page = await browser.newPage({ viewport: { width: 1304, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url(deck))
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 60000 })
  const n = await page.locator('.fp-slide-frame').count()
  mkdirSync(join(OUT, name), { recursive: true })
  for (let i = 0; i < n; i++) {
    const frame = page.locator('.fp-slide-frame').nth(i)
    await frame.scrollIntoViewIfNeeded()
    // Wait for this slide's pictures (img elements and CSS backgrounds are both blob/data URLs).
    await page
      .waitForFunction(
        (idx) => {
          const f = document.querySelectorAll('.fp-slide-frame')[idx]
          if (!f || !f.firstElementChild) return false
          return [...f.querySelectorAll('img')].every((im) => im.complete) && !f.querySelector('[data-pending]')
        },
        i,
        { timeout: 20000, polling: 100 }
      )
      .catch(() => errors.push(`slide ${i + 1}: pictures still loading after 20 s`))
    await page.waitForTimeout(250)
    await frame.screenshot({ path: join(OUT, name, `s${i + 1}.png`) })
  }
  summary.decks[name] = { slides: n, errors }
  console.log(`${name}: ${n} slides${errors.length ? ' errors: ' + errors.join(' | ') : ''}`)
  await page.close()
}

// Same pictures in Word and legacy PowerPoint files: which ones failed to show?
for (const f of ['docx-img-formats.docx', 'docx-img-formats.doc', 'pptx-img-formats.ppt']) {
  const p = join(DIR, f)
  if (!existsSync(p)) continue
  const page = await browser.newPage({ viewport: { width: 1304, height: 900 } })
  await page.goto(url(p))
  await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 60000 })
  // Scroll everything into view so lazy content is built, then let pictures decode.
  await page.evaluate(async () => {
    const r = document.querySelector('.fp-content')
    for (let y = 0; y < r.scrollHeight; y += 400) {
      r.scrollTop = y
      await new Promise((res) => setTimeout(res, 60))
    }
  })
  await page.waitForTimeout(1500)
  const res = await page.evaluate(() => {
    const roots = [document, ...[...document.querySelectorAll('*')].filter((e) => e.shadowRoot).map((e) => e.shadowRoot)]
    const imgs = roots.flatMap((r) => [...r.querySelectorAll('img')])
    const placeholders = roots.flatMap((r) => [...r.querySelectorAll('.fp-missing, [data-fp-missing]')]).length
    return {
      state: document.body.dataset.state,
      images: imgs.length,
      broken: imgs.filter((im) => im.complete && im.naturalWidth === 0).map((im) => im.alt || im.getAttribute('src')?.slice(0, 30)),
      placeholders
    }
  })
  await page.screenshot({ path: join(OUT, `${f}.png`), fullPage: false })
  summary.others[f] = res
  console.log(f, JSON.stringify(res))
  await page.close()
}
await browser.close()
srv.kill()
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
