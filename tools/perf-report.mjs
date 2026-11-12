// Builds docs/evidence/office/perf.md and perf/chart.svg from two tools/perf.mjs runs.
//   node tools/perf-report.mjs [--dir docs/evidence/office/perf] [--before before] [--after after]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
    return acc
  }, [])
)
const dir = args.dir ?? 'docs/evidence/office/perf'
const before = JSON.parse(readFileSync(join(dir, `perf-${args.before ?? 'before'}.json`), 'utf8'))
const after = JSON.parse(readFileSync(join(dir, `perf-${args.after ?? 'after'}.json`), 'utf8'))
const key = (r) => `${r.profile} ${r.file}`
const b = new Map(before.map((r) => [key(r), r]))
const rows = after.map((a) => ({ a, b: b.get(key(a)) ?? {} }))

// ---- chart: time to first content, before vs after, with the 3 s budget
const W = 760
const rowH = 34
const left = 250
const right = 70
const top = 40
const H = top + rows.length * rowH + 40
const max = Math.max(3500, ...rows.flatMap(({ a, b }) => [a.readyMs ?? 0, b.readyMs ?? 0]))
const x = (ms) => left + ((W - left - right) * ms) / max
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`,
  `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  `<text x="16" y="22" font-size="14" font-weight="600" fill="#1f2937">Time to first content (ms) — before vs after round 3</text>`,
  `<line x1="${x(3000)}" y1="${top - 6}" x2="${x(3000)}" y2="${H - 30}" stroke="#dc2626" stroke-dasharray="4 3"/>`,
  `<text x="${x(3000) + 4}" y="${top - 8}" fill="#dc2626">3 s budget</text>`
]
rows.forEach(({ a, b }, i) => {
  const y = top + i * rowH
  parts.push(`<text x="${left - 8}" y="${y + 18}" text-anchor="end" fill="#374151">${esc(a.file)} · ${esc(a.profile.replace('-', ' '))}</text>`)
  const bar = (ms, dy, color) => {
    if (ms == null) return
    parts.push(`<rect x="${left}" y="${y + dy}" width="${Math.max(1, x(ms) - left)}" height="11" rx="2" fill="${color}"/>`)
    parts.push(`<text x="${x(ms) + 4}" y="${y + dy + 10}" fill="#4b5563" font-size="11">${ms}</text>`)
  }
  bar(b.readyMs, 4, '#9ca3af')
  bar(a.readyMs, 17, '#2563eb')
})
const ly = H - 16
parts.push(`<rect x="${left}" y="${ly - 9}" width="11" height="11" fill="#9ca3af"/><text x="${left + 16}" y="${ly}" fill="#374151">before</text>`)
parts.push(`<rect x="${left + 80}" y="${ly - 9}" width="11" height="11" fill="#2563eb"/><text x="${left + 96}" y="${ly}" fill="#374151">after</text>`)
parts.push('</svg>')
writeFileSync(join(dir, 'chart.svg'), parts.join('\n') + '\n')

// ---- table
const v = (n, unit = '') => (n == null ? '–' : `${n}${unit}`)
const cmp = (bv, av) => `${v(bv)} → **${v(av)}**`
const ok = (r) => (r.readyMs ?? 1e9) < 3000 && (r.longAfter ?? 1e9) <= 1000 && !r.error && !r.pageErrors
const md = [
  '| File | Profile | First content (ms) | Longest task after content (ms) | Scroll to end (ms) | Sheet switch (ms) | Zoom ×2 (ms) | JS heap (MB) | DOM nodes | Budget |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |',
  ...rows.map(({ a, b }) =>
    `| \`${a.file}\` | ${a.profile} | ${cmp(b.readyMs, a.readyMs)} | ${cmp(b.longAfter, a.longAfter)} | ${cmp(b.scrollMs, a.scrollMs)} | ${cmp(b.switchMs, a.switchMs)} | ${cmp(b.zoomMs, a.zoomMs)} | ${cmp(b.heapMB, a.heapMB)} | ${cmp(b.domNodes, a.domNodes)} | ${ok(b) ? '✅' : '❌'} → ${ok(a) ? '✅' : '❌'} |`
  )
].join('\n')
writeFileSync(join(dir, 'table.md'), md + '\n')
console.log(md)
