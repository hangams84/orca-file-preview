/** Spreadsheets (.xlsx, .xlsm, .xls, .ods) via SheetJS CE (Apache-2.0). A sheet picker, a grid
 *  with sticky column letters and row numbers, merged cells, formatted values (cell `.w`), column
 *  widths, and progressive rendering: rows append in chunks while scrolling, capped with a notice. */
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, createZoom, h } from '../core/ui.ts'
import { read, utils, type CellObject, type WorkBook, type WorkSheet } from '../../vendor/sheet.js'

const STYLE = `
.fp-sheet-wrap { display: inline-block; min-width: 100%; box-sizing: border-box; }
.fp-sheet { border-collapse: separate; border-spacing: 0; font: 12px/1.35 system-ui, -apple-system, "Segoe UI",
  "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; color: var(--orca-foreground, #111);
  background: var(--orca-background, #fff); table-layout: fixed; }
.fp-sheet td, .fp-sheet th { border-right: 1px solid var(--orca-border, #ddd); border-bottom: 1px solid var(--orca-border, #ddd);
  padding: 2px 5px; height: 20px; box-sizing: border-box; white-space: pre; overflow: hidden; text-overflow: ellipsis;
  vertical-align: bottom; max-width: 480px; }
.fp-sheet td.n { text-align: right; font-variant-numeric: tabular-nums; }
.fp-sheet td.b, .fp-sheet td.e { text-align: center; }
.fp-sheet td.e { color: #d33; }
.fp-sheet td.wrap { white-space: pre-wrap; }
.fp-sheet td.f { color: var(--orca-muted-foreground, #777); font-style: italic; }
.fp-sheet th { position: sticky; background: var(--orca-muted, #f1f1f1); color: var(--orca-muted-foreground, #555);
  font-weight: 500; text-align: center; z-index: 1; }
.fp-sheet thead th { top: 0; z-index: 2; }
.fp-sheet tbody th { left: 0; min-width: 40px; padding: 2px 6px; text-align: right; }
.fp-sheet thead th.corner { left: 0; z-index: 3; }
.fp-sheet-note { position: sticky; left: 0; padding: 8px 12px; color: var(--orca-muted-foreground, #666); font-size: 12px; }
.fp-sheet-empty { padding: 32px 16px; text-align: center; color: var(--orca-muted-foreground, #666); }
`

/** Rows appended per chunk, and the most rows / columns ever put in the DOM. */
const CHUNK = 300
const MAX_ROWS = 5000
const MAX_COLS = 200
const DEFAULT_COL_PX = 80

export async function render(ctx: PreviewContext): Promise<void> {
  const { bytes, root, toolbar, tr, signal } = ctx
  let wb: WorkBook
  try {
    wb = read(bytes, { type: 'array', dense: true, cellStyles: true, cellNF: false, cellHTML: false })
  } catch (err) {
    console.error(err)
    throw new PreviewError(
      'sheet',
      tr('스프레드시트를 읽을 수 없습니다. 파일이 손상되었거나 암호로 보호되어 있을 수 있습니다.', 'Cannot read this spreadsheet. It may be damaged or password-protected.')
    )
  }
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

  let stop: (() => void) | null = null
  const show = (index: number) => {
    stop?.()
    root.scrollTo(0, 0)
    stop = renderSheet(ctx, wrap, wb.Sheets[wb.SheetNames[index]], scale, (info) =>
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
  const r0 = range.s.r
  const c0 = range.s.c
  const totalRows = range.e.r - r0 + 1
  const totalCols = range.e.c - c0 + 1
  const nRows = Math.min(totalRows, MAX_ROWS)
  const nCols = Math.min(totalCols, MAX_COLS)
  const rEnd = r0 + nRows - 1
  const cEnd = c0 + nCols - 1
  info(`${totalRows.toLocaleString()} × ${totalCols.toLocaleString()}`)

  // Merges: the top-left cell gets spans, the rest are skipped. Clipped to the rendered window.
  const spans = new Map<number, { rs: number; cs: number }>()
  const covered = new Set<number>()
  const key = (r: number, c: number) => r * 16384 + c
  for (const m of ws['!merges'] ?? []) {
    if (m.s.r > rEnd || m.s.c > cEnd || m.e.r < r0 || m.e.c < c0) continue
    const sr = Math.max(m.s.r, r0)
    const sc = Math.max(m.s.c, c0)
    const er = Math.min(m.e.r, rEnd)
    const ec = Math.min(m.e.c, cEnd)
    spans.set(key(sr, sc), { rs: er - sr + 1, cs: ec - sc + 1 })
    for (let r = sr; r <= er; r++) for (let c = sc; c <= ec; c++) if (r !== sr || c !== sc) covered.add(key(r, c))
  }

  const table = h('table', 'fp-sheet')
  table.style.zoom = String(scale)
  const colgroup = h('colgroup')
  const rowHeadCol = h('col')
  rowHeadCol.style.width = `${Math.max(40, String(r0 + nRows).length * 8 + 16)}px`
  colgroup.append(rowHeadCol)
  const cols = ws['!cols'] ?? []
  let tableWidth = 0
  for (let c = c0; c <= cEnd; c++) {
    const ci = cols[c]
    const col = h('col')
    const px = ci?.hidden ? 0 : Math.round(ci?.wpx ?? (ci?.wch ? ci.wch * 7 + 5 : DEFAULT_COL_PX))
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
  let next = r0
  const appendRows = () => {
    const frag = document.createDocumentFragment()
    const end = Math.min(rEnd, next + CHUNK - 1)
    for (; next <= end; next++) {
      const r = next
      const rowEl = h('tr')
      const ri = rowsInfo[r]
      if (ri?.hidden) rowEl.style.display = 'none'
      else if (ri?.hpx) rowEl.style.height = `${ri.hpx}px`
      rowEl.append(h('th', undefined, String(r + 1)))
      const row = data[r]
      for (let c = c0; c <= cEnd; c++) {
        const k = key(r, c)
        if (covered.has(k)) continue
        const cell = row?.[c] as CellObject | undefined
        const td = h('td')
        if (cell) {
          const text = cellText(cell)
          td.textContent = text
          if (cell.t === 'n' || cell.t === 'd') td.className = 'n'
          else if (cell.t === 'b' || cell.t === 'e') td.className = cell.t
          else if (cell.t === 'z' && cell.f) {
            // A formula saved without a cached result (some generators do this): show the formula.
            td.className = 'f'
            td.title = tr('계산된 값이 저장되지 않은 수식', 'Formula without a saved result')
          }
          if (text.includes('\n')) td.classList.add('wrap')
          if (text.length > 12 && !td.title) td.title = text
        }
        const sp = spans.get(k)
        if (sp) {
          if (sp.rs > 1) td.rowSpan = sp.rs
          if (sp.cs > 1) td.colSpan = sp.cs
        }
        rowEl.append(td)
      }
      frag.append(rowEl)
    }
    tbody.append(frag)
    if (next > rEnd && (totalRows > nRows || totalCols > nCols)) {
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
  }
  appendRows()
  const onScroll = () => {
    if (next <= rEnd && root.scrollTop + root.clientHeight > root.scrollHeight - 800) appendRows()
  }
  root.addEventListener('scroll', onScroll, { passive: true })
  // Fill the viewport if the first chunk is shorter than the screen.
  let raf = requestAnimationFrame(function fill() {
    if (next <= rEnd && root.scrollHeight <= root.clientHeight + 800) {
      appendRows()
      raf = requestAnimationFrame(fill)
    }
  })
  return () => {
    root.removeEventListener('scroll', onScroll)
    cancelAnimationFrame(raf)
  }
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
