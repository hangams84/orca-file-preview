// Accessibility smoke test (axe-like, no dependency): for every fixture, each button, select,
// input, link and [role=button] in the preview (outside iframes) must have an accessible name
// (aria-label, aria-labelledby, title, text, an associated <label>, or placeholder for inputs),
// and the content area must be keyboard-focusable. With --keys it also drives the PDF/image/SVG/HTML
// keyboard shortcuts (End/Home/PageDown/Space, +/-/0) on the media fixtures.
//
//   node tools/harness/a11y.mjs [--only pdf,svg] [--keys] [--out docs/evidence/media/a11y]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fixtures, launch, openFixture, parseArgs, ROOT, serve } from './lib.mjs'

const args = parseArgs()
const out = join(ROOT, typeof args.out === 'string' ? args.out : 'docs/evidence/media/a11y')
mkdirSync(out, { recursive: true })

const AUDIT = () => {
  const name = (el) => {
    const label = el.getAttribute('aria-label')
    if (label && label.trim()) return label.trim()
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      if (t) return t
    }
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map((l) => l.textContent).join(' ').trim()
      if (t) return t
    }
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.textContent.trim()) return el.textContent.trim()
    if (el.title && el.title.trim()) return el.title.trim()
    if (el.tagName === 'INPUT' && el.placeholder) return el.placeholder
    return ''
  }
  const controls = [...document.querySelectorAll('button, select, input:not([type=hidden]), textarea, a[href], [role=button]')].filter(
    (el) => el.getClientRects().length > 0
  )
  const missing = controls.filter((el) => !name(el)).map((el) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} in ${el.closest('.fp-toolbar') ? 'toolbar' : 'content'}`)
  const content = document.querySelector('.fp-content')
  return { controls: controls.length, missing, focusable: !!content && content.tabIndex >= 0 }
}

const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const results = []
for (const f of fixtures(args)) {
  const page = await context.newPage()
  const problems = []
  let state = 'timeout'
  let audit = null
  const keys = []
  try {
    state = await openFixture(page, base, f, { theme: 'dark' })
    await page.waitForTimeout(300)
    audit = await page.evaluate(AUDIT)
    if (audit.missing.length) problems.push(`no accessible name: ${audit.missing.join(', ')}`)
    if (!audit.focusable) problems.push('content area is not focusable')
    if (args.keys && state === 'ready' && /\.(pdf|gif|bmp|svg|html?)$/.test(f) && !f.includes('password')) {
      await page.focus('.fp-content')
      const label = () => page.textContent('.fp-zoom-label')
      const z0 = await label()
      await page.keyboard.press('+')
      const z1 = await label()
      await page.keyboard.press('-')
      await page.keyboard.press('0')
      const z2 = await label()
      keys.push(`zoom ${z0} → + ${z1} → 0 ${z2}`)
      if (!(parseFloat(z1) > parseFloat(z0))) problems.push(`+ did not zoom in (${z0} → ${z1})`)
      if (z2 !== '100%') problems.push('0 did not reset zoom')
      if (f.endsWith('.pdf')) {
        const pageNo = () => page.inputValue('.fp-pdf-nav-input')
        const total = (await page.textContent('.fp-pdf-total')).replace(/\D/g, '')
        await page.keyboard.press('End')
        await page.waitForTimeout(150)
        const end = await pageNo()
        await page.keyboard.press('Home')
        await page.waitForTimeout(150)
        const home = await pageNo()
        const st0 = await page.evaluate(() => document.querySelector('.fp-content').scrollTop)
        await page.keyboard.press('PageDown')
        const st1 = await page.evaluate(() => document.querySelector('.fp-content').scrollTop)
        await page.keyboard.press('Space')
        const st2 = await page.evaluate(() => document.querySelector('.fp-content').scrollTop)
        await page.keyboard.press('PageUp')
        const st3 = await page.evaluate(() => document.querySelector('.fp-content').scrollTop)
        keys.push(`End → ${end}/${total}, Home → ${home}, scrollTop PageDown ${st0}→${st1}, Space →${st2}, PageUp →${st3}`)
        const scrollable = await page.evaluate(() => { const r = document.querySelector('.fp-content'); return r.scrollHeight > r.clientHeight + 2 })
        if (end !== total) problems.push(`End went to ${end}, not ${total}`)
        if (home !== '1') problems.push(`Home went to ${home}`)
        if (scrollable && !(st1 > st0 && st2 > st1 && st3 < st2)) problems.push('PageDown/Space/PageUp did not scroll')
      }
    }
  } catch (e) {
    problems.push(`harness: ${e.message.split('\n')[0]}`)
  }
  const pass = problems.length === 0
  results.push({ file: f, state, pass, controls: audit?.controls ?? 0, problems, keys })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${f.padEnd(26)} ${state.padEnd(7)} controls=${audit?.controls ?? 0} ${problems.join('; ')} ${keys.join(' | ')}`)
  await page.close()
}
await browser.close()
server.close()
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2))
const passed = results.filter((r) => r.pass).length
writeFileSync(
  join(out, 'results.md'),
  [
    '# Accessibility and keyboard smoke test',
    '',
    `${passed} / ${results.length} passed · ${new Date().toISOString()}${args.keys ? ' · with --keys' : ''}`,
    '',
    '| Result | File | State | Controls | Problems | Keys |',
    '| --- | --- | --- | ---: | --- | --- |',
    ...results.map((r) => `| ${r.pass ? '✅' : '❌'} | \`${r.file}\` | ${r.state} | ${r.controls} | ${r.problems.join('<br>').replace(/\|/g, '\|')} | ${r.keys.join('<br>').replace(/\|/g, '\|')} |`)
  ].join('\n') + '\n'
)
console.log(`\n${passed}/${results.length} passed → ${relative(ROOT, out)}`)
process.exitCode = passed === results.length ? 0 : 1
