// Large spreadsheets for performance checks (outputs are git-ignored under samples/perf/).
//   perf-100k.xlsx  sheet 1: 100,000 rows × 20 columns; sheet 2: 2,000 merged ranges
//   perf-8mb.xlsx   text-heavy workbook of about 8 MB
// Usage: node tools/make-perf-sheets.mjs
import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const XLSX = createRequire(import.meta.url)('xlsx')
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'perf')
mkdirSync(out, { recursive: true })
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const words = 'alpha beta gamma delta 한글 미리보기 성능 시험 데이터 가나다 epsilon zeta theta'.split(' ')
const word = () => words[Math.floor(rnd() * words.length)]

{
  const rows = [['ID', 'Name', ...Array.from({ length: 18 }, (_, i) => `C${i + 3}`)]]
  for (let r = 1; r <= 100000; r++) {
    const row = [r, `${word()} ${r}`]
    for (let c = 0; c < 18; c++) row.push(c % 3 === 0 ? Math.round(rnd() * 1e6) / 100 : c % 3 === 1 ? Math.floor(rnd() * 1000) : word())
    rows.push(row)
  }
  const big = XLSX.utils.aoa_to_sheet(rows)
  const mrows = []
  const merges = []
  for (let i = 0; i < 2000; i++) {
    const r = Math.floor(i / 4) * 3
    const c = (i % 4) * 3
    merges.push({ s: { r, c }, e: { r: r + 1, c: c + 1 } })
    mrows[r] ??= []
    mrows[r][c] = `merge ${i + 1} 병합`
  }
  for (let r = 0; r < mrows.length; r++) mrows[r] ??= []
  const ms = XLSX.utils.aoa_to_sheet(mrows)
  ms['!merges'] = merges
  ms['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 1501, c: 11 } })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, big, '100k rows')
  XLSX.utils.book_append_sheet(wb, ms, 'Merges')
  XLSX.writeFile(wb, join(out, 'perf-100k.xlsx'), { compression: true })
}
{
  const rows = [['Key', 'Text A', 'Text B', 'Text C', 'Value']]
  for (let r = 1; r <= 53000; r++) {
    rows.push([`K${r}-${Math.floor(rnd() * 1e9).toString(36)}`, Array.from({ length: 8 }, word).join(' ') + ` ${Math.floor(rnd() * 1e9).toString(36)}`, Math.floor(rnd() * 1e15).toString(36) + word(), `${word()}-${r}-${Math.floor(rnd() * 1e12).toString(36)}`, rnd() * 1e6])
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Text')
  XLSX.writeFile(wb, join(out, 'perf-8mb.xlsx'), { compression: true })
}
for (const f of ['perf-100k.xlsx', 'perf-8mb.xlsx']) console.log(f, (statSync(join(out, f)).size / 1048576).toFixed(1), 'MB')
