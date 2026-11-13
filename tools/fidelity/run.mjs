// Layout fidelity report: renders every corpus file in the preview (browser harness, desktop, page
// view at 100%), measures its pages and text lines, and compares them with the ground truth from
// tools/fidelity/truth.py (Word's PDF for .doc, Hangul's saved line layout for .hwp/.hwpx).
//   node tools/fidelity/run.mjs [--only doc,hwp] [--out docs/evidence/fidelity]
// Writes report.md, report.json, index.html and per-file images: <name>.ours.png (first page as the
// plugin draws it, truth line boxes overlaid in red) and, for .doc, <name>.truth.png (Word's page).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { launch, parseArgs, ROOT, serve } from '../harness/lib.mjs'

const args = parseArgs()
const OUT = join(ROOT, typeof args.out === 'string' ? args.out : 'docs/evidence/fidelity')
const FID = join(ROOT, 'samples', 'fidelity')
const TRUTH = join(FID, 'truth')
mkdirSync(OUT, { recursive: true })
const only = typeof args.only === 'string' ? args.only.split(',') : null

// Thresholds a file must meet to pass (points unless noted).
const LIMITS = { pageSize: 0.015, recall: 0.9, size: 0.6, top: 4, left: 4 }

const files = []
for (const fmt of ['doc', 'hwp', 'hwpx']) {
  const dir = join(FID, fmt)
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).sort()) {
    if (extname(f).slice(1) !== fmt) continue
    if (only && !only.some((o) => f.includes(o) || fmt === o)) continue
    files.push({ fmt, file: `samples/fidelity/${fmt}/${f}`, name: basename(f, extname(f)) })
  }
}
// The project's own .doc fixtures have Word truth too.
for (const f of readdirSync(join(ROOT, 'samples')).filter((f) => /^sample.*\.doc$/.test(f))) {
  const name = basename(f, '.doc')
  if (existsSync(join(TRUTH, `${name}.json`)) && (!only || only.some((o) => f.includes(o) || o === 'doc')))
    files.push({ fmt: 'doc', file: `samples/${f}`, name })
}

const norm = (s) => s.replace(/[\s ​]+/g, '').toLowerCase()
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10)

// In the page: find page boxes (light DOM and shadow roots) and every text line inside the first pages.
const MEASURE = `(() => {
  const roots = [document]
  const pages = []
  const sel = '[data-fp-page], .fp-page, section.docx'
  const visit = (root) => {
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { roots.push(el.shadowRoot); visit(el.shadowRoot) }
  }
  visit(document)
  for (const r of roots) for (const el of r.querySelectorAll(sel)) if (!pages.includes(el) && el.getBoundingClientRect().width > 50) pages.push(el)
  const PT = 0.75 // CSS px -> pt at 100%
  const out = []
  for (const [pi, pg] of pages.slice(0, 3).entries()) {
    const box = pg.getBoundingClientRect()
    const lines = []
    const walker = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let cur = null
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.nodeValue
      if (!t || !t.trim() || n.parentElement.closest('style,script')) continue
      const cs = getComputedStyle(n.parentElement)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      const size = parseFloat(cs.fontSize) * PT
      for (let i = 0; i < t.length; i++) {
        range.setStart(n, i); range.setEnd(n, i + 1)
        const rc = range.getClientRects()[0]
        if (!rc || rc.width === 0 && !t[i].trim()) continue
        const top = (rc.top - box.top) * PT, left = (rc.left - box.left) * PT, bottom = (rc.bottom - box.top) * PT
        if (cur && Math.abs(bottom - cur.bottom) < 2.5 && left >= cur.right - 6) {
          cur.text += t[i]; cur.right = (rc.right - box.left) * PT; cur.size = Math.max(cur.size, size); cur.y = Math.min(cur.y, top)
        } else {
          if (cur) lines.push(cur)
          cur = { text: t[i], x: left, y: top, bottom, right: (rc.right - box.left) * PT, size }
        }
      }
    }
    if (cur) lines.push(cur)
    out.push({ w: box.width * PT, h: box.height * PT, x: box.left, y: box.top, lines: lines.filter((l) => l.text.trim()) })
  }
  return out
})()`

function compare(truth, ours) {
  const res = { pages: [], matched: 0, total: 0, dSize: [], dTop: [], dLeft: [] }
  const tp = truth.pages ?? []
  for (let i = 0; i < Math.min(3, tp.length); i++) {
    const t = tp[i]
    const o = ours[i]
    const page = { truth: { w: t.w, h: t.h }, ours: o ? { w: r1(o.w), h: r1(o.h) } : null }
    if (o) page.err = { w: Math.abs(o.w - t.w) / t.w, h: Math.abs(o.h - t.h) / t.h }
    res.pages.push(page)
    const pool = o ? o.lines.map((l) => ({ ...l, key: norm(l.text) })) : []
    for (const tl of t.lines) {
      const key = norm(tl.text)
      if (key.length < 2) continue
      res.total++
      const head = key.slice(0, Math.min(10, key.length))
      let best = null
      for (const ol of pool) {
        if (ol.used) continue
        if (!(ol.key.startsWith(head) || head.startsWith(ol.key.slice(0, Math.min(10, ol.key.length))) && ol.key.length >= 3)) continue
        const d = Math.abs(ol.y - tl.y)
        if (!best || d < best.d) best = { ol, d }
      }
      if (!best) continue
      best.ol.used = true
      res.matched++
      res.dTop.push(best.ol.y - tl.y)
      res.dLeft.push(best.ol.x - tl.x)
      res.dSize.push(best.ol.size - tl.size)
    }
  }
  const abs = (a) => a.map(Math.abs)
  res.metrics = {
    pageSizeErr: res.pages[0]?.err ? Math.max(res.pages[0].err.w, res.pages[0].err.h) : null,
    recall: res.total ? res.matched / res.total : null,
    sizeErr: median(abs(res.dSize)),
    topErr: median(abs(res.dTop)),
    leftErr: median(abs(res.dLeft))
  }
  const m = res.metrics
  const fails = []
  if (m.pageSizeErr == null) fails.push('no page box')
  else if (m.pageSizeErr > LIMITS.pageSize) fails.push(`page size ${(m.pageSizeErr * 100).toFixed(1)}%`)
  if (m.recall != null && m.recall < LIMITS.recall) fails.push(`text recall ${(m.recall * 100).toFixed(0)}%`)
  if (m.sizeErr != null && m.sizeErr > LIMITS.size) fails.push(`font size ±${m.sizeErr.toFixed(1)}pt`)
  if (m.topErr != null && m.topErr > LIMITS.top) fails.push(`line top ±${m.topErr.toFixed(1)}pt`)
  if (m.leftErr != null && m.leftErr > LIMITS.left) fails.push(`left ±${m.leftErr.toFixed(1)}pt`)
  res.pass = fails.length === 0
  res.fails = fails
  return res
}

const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await launch(args)
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1300 } })
const report = []
for (const f of files) {
  const truthFile = join(TRUTH, `${f.name}.json`)
  const truth = existsSync(truthFile) ? JSON.parse(readFileSync(truthFile, 'utf8')) : null
  const page = await ctx.newPage()
  const row = { ...f, truthSource: truth?.source ?? null }
  try {
    await page.goto(`${base}/harness?file=${encodeURIComponent(f.file).replace(/%2F/g, '/')}&theme=light&locale=en`)
    await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state ?? ''), null, { timeout: 30000, polling: 100 })
    row.state = await page.evaluate(() => document.body.dataset.state)
    // Page view at 100%: leave a reading layout and reset zoom.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.fp-toolbar button')].find((x) => /^(페이지|Page)$/.test(x.textContent.trim()))
      if (b) b.click()
    })
    await page.keyboard.press('Control+0')
    await page.waitForTimeout(1200)
    if (truth?.refuse) {
      row.expectRefuse = truth.refuse
      row.pass = row.state === 'error'
      row.fails = row.pass ? [] : [`expected a friendly refusal (${truth.refuse}) but got ${row.state}`]
    } else if (row.state !== 'ready') {
      row.pass = false
      row.fails = [`preview state ${row.state}`]
    } else {
      const ours = await page.evaluate(MEASURE)
      row.ourPages = ours.length
      if (truth) Object.assign(row, compare(truth, ours))
      else row.fails = ['no truth']
      // Overlay truth line boxes (red) on the first page, then capture it.
      if (ours[0]) {
        const boxes = (truth?.pages?.[0]?.lines ?? []).map((l) => ({ x: l.x / 0.75, y: l.y / 0.75, w: Math.max(4, (l.width ?? l.text.length * l.size * 0.5) / 0.75), h: l.size / 0.75 }))
        await page.evaluate(
          ({ p, boxes }) => {
            const ov = document.createElement('div')
            ov.style.cssText = `position:fixed;left:${p.x}px;top:${p.y}px;width:${p.w / 0.75}px;height:${p.h / 0.75}px;pointer-events:none;z-index:99999`
            for (const b of boxes) {
              const d = document.createElement('div')
              d.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:1px solid rgba(220,38,38,.75);box-sizing:border-box`
              ov.append(d)
            }
            document.body.append(ov)
          },
          { p: ours[0], boxes }
        )
        await page.screenshot({ path: join(OUT, `${f.name}.ours.png`), clip: { x: Math.max(0, ours[0].x), y: Math.max(0, ours[0].y), width: Math.min(1700, ours[0].w / 0.75), height: Math.min(1300 - Math.max(0, ours[0].y), ours[0].h / 0.75) } })
        row.oursImg = `${f.name}.ours.png`
      }
      if (existsSync(join(TRUTH, `${f.name}.p1.png`))) {
        copyFileSync(join(TRUTH, `${f.name}.p1.png`), join(OUT, `${f.name}.truth.png`))
        row.truthImg = `${f.name}.truth.png`
      }
    }
  } catch (e) {
    row.pass = false
    row.fails = [`harness: ${e.message.split('\n')[0]}`]
  }
  await page.close()
  const m = row.metrics ?? {}
  console.log(
    `${row.pass ? 'PASS' : 'FAIL'} ${f.fmt.padEnd(4)} ${f.name.padEnd(28)} page ${m.pageSizeErr == null ? '  -  ' : (m.pageSizeErr * 100).toFixed(1).padStart(4) + '%'} recall ${m.recall == null ? ' - ' : (m.recall * 100).toFixed(0).padStart(3) + '%'} size ${m.sizeErr == null ? ' - ' : m.sizeErr.toFixed(1)} top ${m.topErr == null ? ' - ' : m.topErr.toFixed(1)} left ${m.leftErr == null ? ' - ' : m.leftErr.toFixed(1)} ${row.fails?.join('; ') ?? ''}`
  )
  report.push(row)
}
await browser.close()
server.close()

const slim = report.map(({ dSize, dTop, dLeft, pages, ...r }) => ({ ...r, pages }))
writeFileSync(join(OUT, 'report.json'), JSON.stringify(slim, null, 1))
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`)
const pt = (x) => (x == null ? '—' : x.toFixed(1))
const passed = report.filter((r) => r.pass).length
const md = [
  '# Layout fidelity report',
  '',
  `${passed} / ${report.length} files within limits · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  `Limits: page size ≤ ${LIMITS.pageSize * 100}% · text recall ≥ ${LIMITS.recall * 100}% · median font size error ≤ ${LIMITS.size} pt · median line top error ≤ ${LIMITS.top} pt · median left edge error ≤ ${LIMITS.left} pt (first 3 pages).`,
  'Truth: Word 2021 PDF export for .doc (LibreOffice where Word blocks the format), Hangul\'s own saved line layout for .hwp/.hwpx.',
  '',
  '| | Format | File | Page size | Recall | Font size | Line top | Left edge | Notes |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
  ...report.map((r) => {
    const m = r.metrics ?? {}
    return `| ${r.pass ? '✅' : '❌'} | ${r.fmt} | \`${basename(r.file)}\` | ${pct(m.pageSizeErr)} | ${pct(m.recall)} | ${pt(m.sizeErr)} | ${pt(m.topErr)} | ${pt(m.leftErr)} | ${(r.fails ?? []).join('; ')}${r.expectRefuse ? ` (refusal: ${r.expectRefuse})` : ''} |`
  }),
  ''
].join('\n')
writeFileSync(join(OUT, 'report.md'), md)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fidelity Report</title>
<style>:root{--bg:#fff;--fg:#111;--mut:#666;--bd:#ddd}@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0b0f17;--fg:#e5e7eb;--mut:#9ca3af;--bd:#1f2937}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,"Malgun Gothic",sans-serif}main{max-width:1200px;margin:0 auto;padding:20px 16px}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}td,th{border:1px solid var(--bd);padding:4px 8px;text-align:left}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0 28px}.pair img{width:100%;border:1px solid var(--bd);background:#fff}.mut{color:var(--mut)}</style></head><body><main>
<h1>Layout fidelity report</h1><p class="mut">${passed} / ${report.length} files within limits. Red boxes: where the truth (Word / Hangul) puts each line.</p>
${md.split('\n').filter((l) => l.startsWith('|')).length ? `<table>${report
    .map((r) => {
      const m = r.metrics ?? {}
      return `<tr><td>${r.pass ? '✅' : '❌'}</td><td>${r.fmt}</td><td><a href="#${esc(r.name)}">${esc(basename(r.file))}</a></td><td>${pct(m.pageSizeErr)}</td><td>${pct(m.recall)}</td><td>${pt(m.sizeErr)}</td><td>${pt(m.topErr)}</td><td>${pt(m.leftErr)}</td><td>${esc((r.fails ?? []).join('; '))}</td></tr>`
    })
    .join('')}</table>` : ''}
${report
  .filter((r) => r.oursImg)
  .map((r) => `<h3 id="${esc(r.name)}">${r.pass ? '✅' : '❌'} ${esc(basename(r.file))} <span class="mut">· ${esc(r.truthSource ?? '')}</span></h3><div class="pair">${r.truthImg ? `<figure><img loading="lazy" src="${esc(r.truthImg)}"><figcaption class="mut">Truth (first page)</figcaption></figure>` : '<div class="mut">No rendered truth page (Hangul layout data only).</div>'}<figure><img loading="lazy" src="${esc(r.oursImg)}"><figcaption class="mut">Preview (red: truth line boxes)</figcaption></figure></div>`)
  .join('\n')}
</main></body></html>`
)
console.log(`\n${passed}/${report.length} within limits → ${relative(ROOT, OUT)}`)
process.exitCode = passed === report.length ? 0 : 1
