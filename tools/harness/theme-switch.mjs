// Live theme switching check. Opens every fixture in the dark theme, flips Orca's theme to light
// with window.__setTheme (no reload), waits 300 ms and screenshots both states. Fails when the
// toolbar or page background colour did not change, when toolbar text contrast is below 4.5:1 in
// either theme, or when "ResizeObserver loop" errors are logged. Text in the content area outside
// document "paper" (.fp-page, iframes, canvases) with contrast below 4.5:1 is listed as a warning
// (that is where renderers keep stale theme colours).
//
//   node tools/harness/theme-switch.mjs [--out docs/evidence/media/theme] [--only pdf,svg] [--no-shots]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fixtures, launch, openFixture, parseArgs, ROOT, serve } from './lib.mjs'

const args = parseArgs()
const out = join(ROOT, typeof args.out === 'string' ? args.out : 'docs/evidence/media/theme')
mkdirSync(out, { recursive: true })

/** Runs in the page: colours of the chrome and contrast problems. */
const INSPECT = () => {
  const parse = (c) => {
    let m = /^rgba?\(([^)]+)\)/.exec(c)
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }
    }
    m = /^color\(srgb ([^)]+)\)/.exec(c)
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number)
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] ?? 1 }
    }
    return null
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.backgroundImage !== 'none' && e !== el) return null // checkerboards, gradients: unknown
      const c = parse(cs.backgroundColor)
      if (c && c.a >= 0.5) return c
    }
    return parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5
  }
  const ownText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || /^(BUTTON|SELECT|INPUT)$/.test(el.tagName)
  const check = (els) => {
    const bad = []
    for (const el of els) {
      if (el.disabled || el.closest('[disabled]') || !visible(el) || !ownText(el)) continue
      const fg = parse(getComputedStyle(el).color)
      const bg = bgOf(el)
      if (!fg || fg.a < 0.5 || !bg) continue
      const r = ratio(fg, bg)
      if (r < 4.5) bad.push(`${el.tagName.toLowerCase()}.${el.className || ''} "${(el.textContent || el.value || '').trim().slice(0, 24)}" ${r.toFixed(2)}:1`)
      if (bad.length > 8) break
    }
    return bad
  }
  const bar = document.querySelector('.fp-toolbar')
  const content = document.querySelector('.fp-content')
  const contentEls = content
    ? [...content.querySelectorAll('*')]
        .filter((e) => !e.closest('.fp-page, iframe, svg, canvas, .textLayer, .fp-pdf-page, pre.fp-raw-keep'))
        .slice(0, 1500)
    : []
  return {
    body: getComputedStyle(document.body).backgroundColor,
    toolbar: bar ? getComputedStyle(bar).backgroundColor : '',
    toolbarIssues: bar ? check([bar, ...bar.querySelectorAll('*')]) : [],
    contentIssues: check(contentEls)
  }
}

const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
// "ResizeObserver loop completed with undelivered notifications" is an ErrorEvent on window that
// neither pageerror nor the console reports; Orca's frame logs it, so surface it the same way.
await context.addInitScript(() =>
  addEventListener('error', (e) => {
    if (/ResizeObserver/.test(e.message ?? '')) console.error(e.message)
  })
)
const results = []
for (const f of fixtures(args)) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && /ResizeObserver/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  let state = 'timeout'
  let dark = null
  let light = null
  try {
    state = await openFixture(page, base, f, { theme: 'dark' })
    await page.waitForTimeout(500)
    dark = await page.evaluate(INSPECT)
    if (!args['no-shots']) await page.screenshot({ path: join(out, `${f}.1-dark.png`) })
    await page.evaluate(() => window.__setTheme('light'))
    await page.waitForTimeout(300)
    light = await page.evaluate(INSPECT)
    // Resize back and forth: layout work inside ResizeObserver callbacks must not loop.
    await page.setViewportSize({ width: 700, height: 640 })
    await page.waitForTimeout(250)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForTimeout(250)
    if (!args['no-shots']) await page.screenshot({ path: join(out, `${f}.2-light.png`) })
  } catch (e) {
    errors.push(`harness: ${e.message.split('\n')[0]}`)
  }
  const problems = []
  if (dark && light) {
    if (dark.toolbar === light.toolbar) problems.push(`toolbar background unchanged (${light.toolbar})`)
    if (dark.body === light.body) problems.push(`page background unchanged (${light.body})`)
    for (const i of dark.toolbarIssues) problems.push(`dark toolbar contrast: ${i}`)
    for (const i of light.toolbarIssues) problems.push(`light toolbar contrast: ${i}`)
  } else problems.push('not inspected')
  problems.push(...errors.filter((e) => /ResizeObserver|pageerror|harness/.test(e)))
  const warnings = [...(dark?.contentIssues ?? []).map((i) => `dark: ${i}`), ...(light?.contentIssues ?? []).map((i) => `light: ${i}`)]
  const pass = problems.length === 0
  results.push({ file: f, state, pass, problems, warnings, dark, light })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${f.padEnd(26)} ${state.padEnd(7)} ${problems.join('; ')}${warnings.length ? `  [${warnings.length} content warning(s)]` : ''}`)
  await page.close()
}
await browser.close()
server.close()

writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2))
const passed = results.filter((r) => r.pass).length
writeFileSync(
  join(out, 'results.md'),
  [
    '# Theme switch (dark → light without reload)',
    '',
    `${passed} / ${results.length} passed · ${new Date().toISOString()}`,
    '',
    '| Result | File | State | Problems | Content warnings |',
    '| --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.pass ? '✅' : '❌'} | \`${r.file}\` | ${r.state} | ${r.problems.join('<br>').replace(/\|/g, '\|')} | ${r.warnings.slice(0, 6).join('<br>').replace(/\|/g, '\|')} |`
    )
  ].join('\n') + '\n'
)
console.log(`\n${passed}/${results.length} passed → ${relative(ROOT, out)}`)
process.exitCode = passed === results.length ? 0 : 1
