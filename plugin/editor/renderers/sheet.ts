/** Spreadsheets (.xlsx, .xlsm, .xls, .ods) via SheetJS CE (Apache-2.0). A sheet picker, a grid
 *  with sticky column letters and row numbers, merged cells, formatted values (cell `.w`), column
 *  widths, and progressive rendering: rows append in chunks while scrolling, capped with a notice. */
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, createZoom, h } from '../core/ui.ts'
import { read, SSF, utils, type CellObject, type ColInfo, type WorkBook, type WorkSheet } from '../../vendor/sheet.js'
import { FormulaEngine, FormulaError, formatGeneral, type Scalar } from './office/formula.ts'
import { installOfficeFonts, OFFICE_SANS } from './office/fonts.ts'

const STYLE = `
.fp-sheet-wrap { display: inline-block; min-width: 100%; box-sizing: border-box; }
.fp-sheet { border-collapse: separate; border-spacing: 0; font: 12px/1.35 Calibri, "맑은 고딕", ${OFFICE_SANS}; color: var(--orca-foreground, #111);
  background: var(--orca-background, #fff); table-layout: fixed; }
.fp-sheet td, .fp-sheet th { border-right: 1px solid var(--orca-border, #ddd); border-bottom: 1px solid var(--orca-border, #ddd);
  padding: 2px 5px; height: 20px; line-height: 15px; box-sizing: border-box; white-space: pre; overflow: hidden; text-overflow: ellipsis;
  vertical-align: bottom; max-width: 480px; }
.fp-sheet td.n { text-align: right; font-variant-numeric: tabular-nums; }
.fp-sheet td.b, .fp-sheet td.e { text-align: center; }
.fp-sheet td.e { color: #d33; }
.fp-sheet td.wrap { white-space: pre-wrap; }
.fp-sheet tr.fp-sheet-spacer td { padding: 0; border: 0; height: auto; }
.fp-sheet td.spill { overflow: visible; text-overflow: clip; position: relative; }
.fp-sheet td.f { color: var(--orca-muted-foreground, #777); font-style: italic; }
.fp-sheet td.calc { background: linear-gradient(135deg, var(--orca-muted-foreground, #999) 0 50%, transparent 50%)
  no-repeat 0 0 / 5px 5px; background-origin: padding-box; background-clip: padding-box; }
.fp-sheet th { position: sticky; background: var(--orca-muted, #f1f1f1); color: var(--orca-muted-foreground, #555);
  font-weight: 500; text-align: center; z-index: 1; }
.fp-sheet thead th { top: 0; z-index: 2; }
.fp-sheet tbody th { left: 0; min-width: 40px; padding: 2px 6px; text-align: right; }
.fp-sheet thead th.corner { left: 0; z-index: 3; }
.fp-sheet-note { position: sticky; left: 0; padding: 8px 12px; color: var(--orca-muted-foreground, #666); font-size: 12px; }
.fp-sheet-empty { padding: 32px 16px; text-align: center; color: var(--orca-muted-foreground, #666); }
`

/** Most rows / columns parsed and shown (rows are virtualised), the default row height, and the
 *  rows kept rendered above and below the viewport. */
const MAX_ROWS = 20000
const ROW_PX = 20
const OVERSCAN = 40
const MAX_COLS = 200
const DEFAULT_COL_PX = 64
/** Rows scanned to widen columns whose numbers/dates would not fit (Excel shows ### there). */
const AUTOFIT_ROWS = 200
const AUTOFIT_MAX_PX = 260

/** Parsing gets this long before the worker is stopped and the file reported as too complex. */
const PARSE_TIMEOUT_MS = 10000

/** Parses the workbook in a Web Worker (office/sheet-worker.js) with a time limit, so damaged
 *  files that make SheetJS loop never freeze the page. Falls back to the main thread only when
 *  the worker cannot start at all. */
async function loadBook(ctx: PreviewContext): Promise<WorkBook> {
  const { bytes, tr, signal } = ctx
  const damaged = () =>
    new PreviewError(
      'sheet',
      tr('스프레드시트를 읽을 수 없습니다. 파일이 손상되었거나 암호로 보호되어 있을 수 있습니다.', 'Cannot read this spreadsheet. It may be damaged or password-protected.')
    )
  let worker: Worker
  try {
    worker = new Worker(new URL('./office/sheet-worker.js', import.meta.url), { type: 'module' })
  } catch (err) {
    console.warn('sheet: worker unavailable, parsing on the main thread', err)
    return parseHere(bytes, damaged)
  }
  return new Promise<WorkBook>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      worker.terminate()
      fn()
    }
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new PreviewError(
              'sheet-timeout',
              tr('스프레드시트가 너무 복잡하거나 손상되어 시간 안에 읽지 못했습니다.', 'This spreadsheet is too complex or damaged to read in time.')
            )
          )
        ),
      PARSE_TIMEOUT_MS
    )
    const onAbort = () => finish(() => reject(new DOMException('aborted', 'AbortError')))
    signal.addEventListener('abort', onAbort, { once: true })
    let loaded = false
    worker.onmessage = (e: MessageEvent<{ loaded?: boolean; ok?: boolean; book?: WorkBook; message?: string }>) => {
      if (e.data.loaded) {
        loaded = true
        return
      }
      finish(() => {
        if (e.data.ok && e.data.book) resolve(e.data.book)
        else {
          console.error('sheet:', e.data.message)
          reject(damaged())
        }
      })
    }
    // The worker script itself failed to load: parse here instead. A crash after it loaded
    // (out of memory on a damaged file) is reported as damage, never retried on the main thread.
    worker.onerror = (e) => {
      e.preventDefault()
      if (loaded) {
        console.error('sheet: worker crashed', e.message)
        finish(() => reject(damaged()))
        return
      }
      finish(() => {
        console.warn('sheet: worker failed, parsing on the main thread', e.message)
        try {
          resolve(parseHere(bytes, damaged))
        } catch (err) {
          reject(err)
        }
      })
    }
    const copy = bytes.slice()
    worker.postMessage({ bytes: copy.buffer, maxRows: MAX_ROWS, maxCols: MAX_COLS }, [copy.buffer])
  })
}

function parseHere(bytes: Uint8Array, damaged: () => Error): WorkBook {
  try {
    return read(bytes, { type: 'array', dense: true, cellStyles: true, cellNF: false, cellHTML: false, sheetRows: MAX_ROWS })
  } catch (err) {
    console.error(err)
    throw damaged()
  }
}

export async function render(ctx: PreviewContext): Promise<void> {
  const { bytes, root, toolbar, tr, signal } = ctx
  installOfficeFonts()
  const wb = await loadBook(ctx)
  if (signal.aborted) return
  if (!wb.SheetNames.length) throw new PreviewError('sheet', tr('시트가 없습니다.', 'This workbook has no sheets.'))

  const style = h('style', undefined, STYLE)
  const wrap = h('div', 'fp-sheet-wrap')
  root.replaceChildren(style, wrap)

  const hidden = (i: number) => !!wb.Workbook?.Sheets?.[i]?.Hidden
  const first = Math.max(0, wb.SheetNames.findIndex((_, i) => !hidden(i)))
  if (wb.SheetNames.length > 1) {
    const sel = toolbar.select(
      tr('시트', 'Sheet'),
      wb.SheetNames.map((name, i) => ({
        value: String(i),
        label: hidden(i) ? `${name} (${tr('숨김', 'hidden')})` : name
      })),
      (v) => show(Number(v))
    )
    sel.value = String(first)
  }

  let scale = 1
  const zoom = createZoom(
    ctx.compact ? 0.9 : 1,
    (s) => {
      scale = s
      const t = wrap.querySelector<HTMLElement>('.fp-sheet')
      if (t) t.style.zoom = String(s)
    },
    undefined,
    { min: 0.25, max: 4 }
  )
  scale = zoom.get()
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)

  // Formula cells saved without a cached result are calculated on demand (office/formula.ts).
  const engine = new FormulaEngine({
    sheet: (name) => wb.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase()) ?? null,
    cell: (sheet, r, c) => (wb.Sheets[sheet]?.['!data']?.[r]?.[c] as CellObject | undefined) ?? null,
    // Cells outside what the worker sent are unknown, not blank: such formulas stay uncalculated.
    known: (sheet, r, c) => {
      const w = wb.Sheets[sheet]?.['!window']
      return !w || (r <= w.r1 && c <= w.c1)
    }
  })

  let stop: (() => void) | null = null
  const show = (index: number) => {
    stop?.()
    root.scrollTo(0, 0)
    stop = renderSheet(ctx, wrap, wb.Sheets[wb.SheetNames[index]], wb.SheetNames[index], engine, scale, (info) =>
      toolbar.info(`${wb.SheetNames[index]} · ${info} · ${formatBytes(bytes.byteLength)}`)
    )
  }
  show(first)
  signal.addEventListener('abort', () => stop?.(), { once: true })
}

function renderSheet(
  ctx: PreviewContext,
  wrap: HTMLElement,
  ws: WorkSheet,
  sheetName: string,
  engine: FormulaEngine,
  scale: number,
  info: (text: string) => void
): () => void {
  const { root, tr } = ctx
  wrap.replaceChildren()
  const ref = ws['!ref']
  const data = ws['!data'] ?? []
  if (!ref) {
    wrap.append(h('div', 'fp-sheet-empty', tr('빈 시트입니다.', 'This sheet is empty.')))
    info(tr('빈 시트', 'empty'))
    return () => {}
  }
  const range = utils.decode_range(ref)
  // Parsing stops after MAX_ROWS rows (sheetRows); !fullref keeps the sheet's real size.
  const full = ws['!fullref'] ? utils.decode_range(ws['!fullref']) : range
  const r0 = range.s.r
  const c0 = range.s.c
  const totalRows = full.e.r - full.s.r + 1
  const totalCols = full.e.c - full.s.c + 1
  const nRows = Math.min(totalRows, MAX_ROWS)
  const nCols = Math.min(totalCols, MAX_COLS)
  const rEnd = r0 + nRows - 1
  const cEnd = c0 + nCols - 1
  info(`${totalRows.toLocaleString()} × ${totalCols.toLocaleString()}`)

  const key = (r: number, c: number) => r * 16384 + c
  // Cells inside merges, for the autofit scan below (the grid clips merges per rendered window).
  const mergedAt = new Set<number>()
  const fitEnd = Math.min(rEnd, r0 + AUTOFIT_ROWS)
  for (const m of ws['!merges'] ?? []) {
    if (m.s.r > fitEnd) continue
    for (let r = m.s.r; r <= Math.min(m.e.r, fitEnd); r++) for (let c = m.s.c; c <= Math.min(m.e.c, cEnd); c++) mergedAt.add(key(r, c))
  }

  const table = h('table', 'fp-sheet')
  table.style.zoom = String(scale)
  const colgroup = h('colgroup')
  const rowHeadCol = h('col')
  rowHeadCol.style.width = `${Math.max(40, String(r0 + nRows).length * 8 + 16)}px`
  colgroup.append(rowHeadCol)
  const cols = ws['!cols'] ?? []
  // Numbers and dates never spill into neighbours, so widen their columns to the widest of the
  // first rows (formatted text at ~7 px per character, the default 11 pt digit width).
  const fit: number[] = []
  for (let r = r0; r <= Math.min(rEnd, r0 + AUTOFIT_ROWS); r++) {
    const row = data[r]
    if (!row) continue
    for (let c = c0; c <= cEnd; c++) {
      const cell = row[c] as CellObject | undefined
      if (!cell || (cell.t !== 'n' && cell.t !== 'd') || mergedAt.has(key(r, c))) continue
      const w = Math.min(AUTOFIT_MAX_PX, cellText(cell).length * 7 + 12)
      if (w > (fit[c] ?? 0)) fit[c] = w
    }
  }
  let tableWidth = 0
  for (let c = c0; c <= cEnd; c++) {
    const ci = cols[c]
    const col = h('col')
    const px = ci?.hidden ? 0 : Math.max(colWidthPx(ci), fit[c] ?? 0)
    col.style.width = `${Math.max(px, ci?.hidden ? 0 : 24)}px`
    tableWidth += px
    colgroup.append(col)
  }
  table.style.width = `${tableWidth + 48}px`
  table.append(colgroup)

  const thead = h('thead')
  const hr = h('tr')
  hr.append(h('th', 'corner'))
  for (let c = c0; c <= cEnd; c++) hr.append(h('th', undefined, utils.encode_col(c)))
  thead.append(hr)
  const tbody = h('tbody')
  table.append(thead, tbody)
  wrap.append(table)

  const rowsInfo = ws['!rows'] ?? []
  const merges = ws['!merges'] ?? []

  // Virtualised rows: only the rows near the viewport exist; spacer rows above and below keep the
  // scroll height. Row heights are fixed (stored height or 20 px), so offsets are a prefix sum.
  const heights = new Float64Array(nRows)
  const prefix = new Float64Array(nRows + 1)
  for (let i = 0; i < nRows; i++) {
    const ri = rowsInfo[r0 + i]
    heights[i] = ri?.hidden ? 0 : Math.max(ROW_PX, Math.round(ri?.hpx ?? ROW_PX))
    prefix[i + 1] = prefix[i] + heights[i]
  }
  /** Index of the row containing offset y (unscaled px from the first data row). */
  const rowAt = (y: number) => {
    let lo = 0
    let hi = nRows
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (prefix[mid + 1] <= y) lo = mid + 1
      else hi = mid
    }
    return Math.min(nRows - 1, lo)
  }
  const spacer = () => {
    const row = h('tr', 'fp-sheet-spacer')
    const td = h('td')
    td.colSpan = cEnd - c0 + 2
    row.append(td)
    return row
  }
  const topSpacer = spacer()
  const bottomSpacer = spacer()

  const buildRow = (r: number, spans: Map<number, { rs: number; cs: number }>, covered: Set<number>) => {
    const rowEl = h('tr')
    const ri = rowsInfo[r]
    rowEl.style.height = `${heights[r - r0]}px`
    if (ri?.hidden) rowEl.style.display = 'none'
    rowEl.append(h('th', undefined, String(r + 1)))
    const row = data[r]
    for (let c = c0; c <= cEnd; c++) {
      const k = key(r, c)
      if (covered.has(k)) continue
      const cell = row?.[c] as CellObject | undefined
      const td = h('td')
      if (cell) {
        let text = cellText(cell)
        if (cell.t === 'n' || cell.t === 'd') td.className = 'n'
        else if (cell.t === 'b' || cell.t === 'e') td.className = cell.t
        else if (cell.t === 'z' && cell.f) {
          // A formula saved without a cached result (openpyxl, scripts): calculate it here, or
          // show the formula text when it uses something the evaluator does not support.
          const res = engine.evaluateCell(sheetName, r, c, cell.f)
          if (res.ok) {
            text = formatResult(res.value, cell.z)
            td.className = classOf(res.value)
            td.classList.add('calc')
            td.title = `${tr('미리보기에서 계산됨', 'Calculated by the preview')}: =${cell.f}`
          } else {
            td.className = 'f'
            td.title = tr('계산되지 않은 수식 (저장된 결과 없음)', 'Formula not calculated (no saved result)')
          }
        }
        td.textContent = text
        // Multi-line text wraps only when the stored row height has room: rows keep fixed heights.
        if (text.includes('\n') && heights[r - r0] >= text.split('\n').length * 15 + 4) td.classList.add('wrap')
        if (text.length > 12 && !td.title) td.title = text
        // Text overflows into empty cells on its right, as in Excel.
        if (!td.className && text && !text.includes('\n') && c < cEnd && !spans.has(k)) {
          const nx = row?.[c + 1] as CellObject | undefined
          if ((!nx || (nx.t === 'z' && !nx.f) || cellText(nx) === '') && !covered.has(key(r, c + 1))) td.classList.add('spill')
        }
      }
      const sp = spans.get(k)
      if (sp) {
        if (sp.rs > 1) td.rowSpan = sp.rs
        if (sp.cs > 1) td.colSpan = sp.cs
      }
      rowEl.append(td)
    }
    return rowEl
  }

  let winA = -1
  let winB = -1
  /** Renders rows [a, b) (relative to r0); merges are clipped to the window, so a merge that
   *  starts above it still shows in the window's first row. */
  const renderWindow = (a: number, b: number) => {
    winA = a
    winB = b
    const ra = r0 + a
    const rb = r0 + b - 1
    const spans = new Map<number, { rs: number; cs: number }>()
    const covered = new Set<number>()
    for (const m of merges) {
      if (m.s.r > rb || m.e.r < ra || m.s.c > cEnd || m.e.c < c0) continue
      const sr = Math.max(m.s.r, ra)
      const sc = Math.max(m.s.c, c0)
      const er = Math.min(m.e.r, rb)
      const ec = Math.min(m.e.c, cEnd)
      spans.set(key(sr, sc), { rs: er - sr + 1, cs: ec - sc + 1 })
      for (let r = sr; r <= er; r++) for (let c = sc; c <= ec; c++) if (r !== sr || c !== sc) covered.add(key(r, c))
    }
    const frag = document.createDocumentFragment()
    ;(topSpacer.firstChild as HTMLElement).style.height = `${prefix[a]}px`
    topSpacer.style.display = prefix[a] > 0 ? '' : 'none'
    frag.append(topSpacer)
    for (let r = ra; r <= rb; r++) frag.append(buildRow(r, spans, covered))
    const rest = prefix[nRows] - prefix[b]
    ;(bottomSpacer.firstChild as HTMLElement).style.height = `${rest}px`
    bottomSpacer.style.display = rest > 0 ? '' : 'none'
    frag.append(bottomSpacer)
    tbody.replaceChildren(frag)
  }

  const zoomOf = () => Number(table.style.zoom || 1) || 1
  const update = () => {
    const z = zoomOf()
    const head = thead.getBoundingClientRect().height
    const top = Math.max(0, (root.scrollTop - table.offsetTop - head) / z)
    const first = rowAt(top)
    const last = rowAt(top + root.clientHeight / z)
    if (winA >= 0 && (first >= winA + 10 || winA === 0) && (last <= winB - 10 || winB === nRows)) return
    renderWindow(Math.max(0, first - OVERSCAN), Math.min(nRows, last + 1 + OVERSCAN))
  }
  update()
  if (totalRows > nRows || totalCols > nCols) {
    wrap.append(
      h(
        'div',
        'fp-sheet-note',
        tr(
          `큰 시트라서 처음 ${nRows.toLocaleString()}행 × ${nCols.toLocaleString()}열만 표시합니다 (전체 ${totalRows.toLocaleString()}행 × ${totalCols.toLocaleString()}열).`,
          `Large sheet: showing the first ${nRows.toLocaleString()} rows × ${nCols.toLocaleString()} columns of ${totalRows.toLocaleString()} × ${totalCols.toLocaleString()}.`
        )
      )
    )
  }
  // Scroll updates run on the next frame, and also after a short timeout for hidden windows
  // where frames are throttled.
  let raf = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const onScroll = () => {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
      })
    clearTimeout(timer)
    timer = setTimeout(update, 120)
  }
  root.addEventListener('scroll', onScroll, { passive: true })
  const ro = new ResizeObserver(() => update())
  ro.observe(root)
  const zo = new MutationObserver(() => {
    winA = -1
    update()
  })
  zo.observe(table, { attributes: true, attributeFilter: ['style'] })
  return () => {
    root.removeEventListener('scroll', onScroll)
    cancelAnimationFrame(raf)
    clearTimeout(timer)
    ro.disconnect()
    zo.disconnect()
  }
}

/** Column width in CSS px. SheetJS's `wpx` for BIFF (.xls) assumes a 14 px digit and comes out
 *  about twice too wide, so use the character width (`width`, Excel's column units incl. padding)
 *  at 7 px per unit for every format, then `wch`, then `wpx`. */
function colWidthPx(ci: ColInfo | undefined): number {
  if (!ci) return DEFAULT_COL_PX
  if (ci.width != null && ci.width > 0) return Math.round(ci.width * 7)
  if (ci.wch != null && ci.wch > 0) return Math.round(ci.wch * 7 + 5)
  if (ci.wpx != null && ci.wpx > 0) return Math.round(ci.wpx)
  return DEFAULT_COL_PX
}

function classOf(v: Scalar): string {
  if (typeof v === 'number') return 'n'
  if (typeof v === 'boolean') return 'b'
  if (v instanceof FormulaError) return 'e'
  return ''
}

function formatResult(v: Scalar, fmt: string | number | undefined): string {
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof FormulaError) return v.code
  if (typeof v === 'string') return v
  if (fmt != null && fmt !== 'General') {
    try {
      return SSF.format(fmt, v)
    } catch {
      // fall through to General
    }
  }
  return formatGeneral(v)
}

function cellText(cell: CellObject): string {
  if (cell.t === 'z') return cell.f ? `=${cell.f}` : ''
  if (cell.w != null) return cell.w
  const v = cell.v
  if (v == null) return ''
  if (cell.t === 'b') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return v.toLocaleString()
  return String(v)
}
