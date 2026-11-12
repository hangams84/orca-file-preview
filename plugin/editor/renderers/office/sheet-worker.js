// Spreadsheet parsing off the main thread. SheetJS can loop for a long time on damaged input; in a
// worker the page stays responsive and the renderer can terminate it after a time limit.
// Plain JavaScript (module worker) so it loads without a TypeScript transpile step.
//
// in:  { bytes: ArrayBuffer, maxRows: number, maxCols: number }
// out: { loaded: true } first, then { ok: true, book } | { ok: false, message }
//   book = { SheetNames, Workbook: { Sheets: [{ Hidden }] }, Sheets: { [name]: sheet } }
//   sheet = { '!ref', '!merges', '!cols', '!rows', '!data' (capped), '!window': { r0, c0, r1, c1 } }
import { read, utils } from '../../../vendor/sheet.js'

// Tells the page the script and SheetJS loaded; errors after this are parse failures.
self.postMessage({ loaded: true })

self.onmessage = (e) => {
  const { bytes, maxRows, maxCols } = e.data
  try {
    const wb = read(new Uint8Array(bytes), { type: 'array', dense: true, cellStyles: true, cellNF: false, cellHTML: false })
    const Sheets = {}
    for (const name of wb.SheetNames) Sheets[name] = slim(wb.Sheets[name], maxRows, maxCols)
    const hidden = (wb.Workbook && wb.Workbook.Sheets ? wb.Workbook.Sheets : []).map((s) => ({ Hidden: s && s.Hidden ? s.Hidden : 0 }))
    self.postMessage({ ok: true, book: { SheetNames: wb.SheetNames, Workbook: { Sheets: hidden }, Sheets } })
  } catch (err) {
    self.postMessage({ ok: false, message: String((err && err.message) || err) })
  }
}

/** Only what the grid and the formula evaluator need, for the rendered window. */
function slim(ws, maxRows, maxCols) {
  if (!ws) return {}
  const out = {}
  const ref = ws['!ref']
  if (!ref) return out
  const range = utils.decode_range(ref)
  const r0 = range.s.r
  const c0 = range.s.c
  const r1 = Math.min(range.e.r, r0 + maxRows - 1)
  const c1 = Math.min(range.e.c, c0 + maxCols - 1)
  out['!ref'] = ref
  out['!window'] = { r0, c0, r1, c1 }
  if (ws['!merges']) out['!merges'] = ws['!merges'].filter((m) => m.s.r <= r1 && m.s.c <= c1)
  if (ws['!cols']) out['!cols'] = ws['!cols'].slice(0, c1 + 1).map(col)
  if (ws['!rows']) out['!rows'] = ws['!rows'].slice(0, r1 + 1).map((r) => (r ? { hpx: r.hpx, hpt: r.hpt, hidden: r.hidden } : r))
  const data = ws['!data'] || []
  const rows = new Array(Math.min(data.length, r1 + 1))
  for (let r = r0; r < rows.length; r++) {
    const row = data[r]
    if (!row) continue
    const outRow = new Array(Math.min(row.length, c1 + 1))
    for (let c = c0; c < outRow.length; c++) {
      const cell = row[c]
      if (!cell) continue
      const o = { t: cell.t }
      if (cell.v !== undefined) o.v = cell.v instanceof Date ? cell.v.getTime() : cell.v
      if (cell.w !== undefined) o.w = cell.w
      if (cell.f !== undefined) o.f = cell.f
      if (cell.z !== undefined) o.z = cell.z
      outRow[c] = o
    }
    rows[r] = outRow
  }
  out['!data'] = rows
  return out
}

function col(c) {
  return c ? { wpx: c.wpx, wch: c.wch, width: c.width, hidden: c.hidden } : c
}
