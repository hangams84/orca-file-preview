/** CSV / TSV: encoding detection with override, RFC 4180 parsing, delimiter auto-detect with a
 *  picker, header toggle, sticky header and row numbers, column sort, filter and a raw view.
 *  Parsing runs in slices and rows are appended while scrolling, so 50k-row files stay smooth. */
import { decodeText, FALLBACK_ENCODINGS, looksBinary } from '../core/encoding.ts'
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, createZoom, h } from '../core/ui.ts'
import { DELIMITERS, detectDelimiter, guessHeader, isNumeric, parseChunk, toNumber } from './legacy/csvparse.ts'

const STYLE = `
.fp-csv { --bar: 40px; font-size: 13px; min-width: 100%; width: max-content; }
.fp-csv .bar { position: sticky; top: 0; left: 0; z-index: 3; height: var(--bar); box-sizing: border-box; width: var(--vw, 100%);
  display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: var(--orca-background, #fff);
  border-bottom: 1px solid var(--orca-border, #ddd); }
.fp-csv .bar input { flex: 1 1 auto; min-width: 0; max-width: 360px; font: inherit; height: 28px; box-sizing: border-box; padding: 0 8px;
  color: var(--orca-foreground, inherit); background: var(--orca-background, #fff); border: 1px solid var(--orca-input, #ccc);
  border-radius: var(--orca-radius, 6px); }
.fp-csv .bar input:focus-visible { outline: 2px solid var(--orca-ring, #48f); outline-offset: 0; }
.fp-csv .bar .count { color: var(--orca-muted-foreground, #666); white-space: nowrap; font-variant-numeric: tabular-nums; font-size: 12px; }
.fp-csv table { border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.fp-csv th, .fp-csv td { padding: 3px 8px; border-right: 1px solid var(--orca-border, #e5e5e5); border-bottom: 1px solid var(--orca-border, #e5e5e5);
  max-width: 28em; white-space: pre-wrap; overflow-wrap: anywhere; vertical-align: top; text-align: left; }
.fp-csv thead th { position: sticky; top: var(--bar); z-index: 2; background: var(--orca-card, #f6f6f6); color: var(--orca-card-foreground, inherit);
  font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; }
.fp-csv thead th:hover { background: var(--orca-accent, #eee); }
.fp-csv thead th .arrow { margin-left: 4px; opacity: .7; font-size: 10px; }
.fp-csv .rn { position: sticky; left: 0; z-index: 1; background: var(--orca-card, #f6f6f6); color: var(--orca-muted-foreground, #888);
  text-align: right; min-width: 3ch; font-size: 11px; user-select: none; }
.fp-csv thead .rn { z-index: 4; cursor: default; }
.fp-csv td.num { text-align: right; }
.fp-csv tbody tr:hover td { background: color-mix(in srgb, var(--orca-accent, #eee) 60%, transparent); }
.fp-csv mark { background: #fde047; color: #000; border-radius: 2px; }
.fp-csv .empty { padding: 24px; color: var(--orca-muted-foreground, #888); }
.fp-csv-raw { margin: 0; padding: 10px 12px; font: 12.5px/1.55 ui-monospace, "Cascadia Mono", Consolas, "D2Coding", Menlo, monospace;
  white-space: pre; tab-size: 8; }
@media (max-width: 600px) { .fp-csv { --bar: 44px; } .fp-csv .bar input { height: 34px; } .fp-csv th, .fp-csv td { max-width: 16em; } }
`

/** Rows appended per scroll step. */
const CHUNK = 400
/** Rows parsed per slice before yielding to the UI. */
const PARSE_SLICE = 20000

const DELIM_LABEL: Record<string, [string, string]> = {
  ',': ['쉼표 ,', 'Comma ,'],
  ';': ['세미콜론 ;', 'Semicolon ;'],
  '\t': ['탭', 'Tab'],
  '|': ['세로선 |', 'Pipe |']
}

export async function render(ctx: PreviewContext): Promise<() => void> {
  const { bytes, root, toolbar, tr, signal } = ctx
  if (looksBinary(bytes)) {
    throw new PreviewError('binary', tr('텍스트가 아닌 바이너리 파일로 보입니다.', 'This looks like a binary file, not text.'))
  }

  let encoding: string | undefined
  let text = ''
  let usedEncoding = ''
  let delim = ''
  let header = true
  let raw = false
  let rows: string[][] = []
  let cols = 0
  let parsedAll = false
  let parseGen = 0
  let sortCol = -1
  let sortDir: 1 | -1 = 1
  let filter = ''
  let order: number[] = []
  let shown = 0
  let rowText: string[] | null = null
  const numericCols = new Set<number>()
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  const style = h('style', undefined, STYLE)
  const wrap = h('div', 'fp-csv')
  const bar = h('div', 'bar')
  const input = h('input')
  input.type = 'search'
  input.placeholder = tr('필터…', 'Filter…')
  input.setAttribute('aria-label', tr('행 필터', 'Filter rows'))
  const count = h('span', 'count')
  bar.append(input, count)
  const table = h('table')
  const thead = h('thead')
  const tbody = h('tbody')
  table.append(thead, tbody)
  wrap.append(bar, table)
  const rawPre = h('pre', 'fp-csv-raw')
  let rawShown = 0
  let rawLines: string[] = []

  const decode = () => {
    const d = decodeText(bytes, encoding)
    text = d.text
    usedEncoding = d.encoding
    // Excel's "sep=;" hint line
    const m = /^sep=(.)\r?\n/.exec(text)
    if (m) {
      text = text.slice(m[0].length)
      delim = m[1]
    }
  }

  const body = () => (header ? rows.slice(1) : rows)
  const bodyStart = () => (header ? 1 : 0)

  /** Parses the whole text in slices; paints as soon as the first slice is ready. */
  const parse = async () => {
    const gen = ++parseGen
    rows = []
    cols = 0
    parsedAll = false
    rowText = null
    let pos = 0
    let first = true
    while (pos < text.length) {
      const { rows: part, next } = parseChunk(text, delim, pos, first ? 2000 : PARSE_SLICE)
      for (const r of part) {
        if (r.length === 1 && r[0] === '') continue
        rows.push(r)
        if (r.length > cols) cols = r.length
      }
      pos = next
      if (first) {
        first = false
        header = guessHeader(rows)
        detectNumeric()
        repaint()
      } else {
        extendOrder()
        info()
      }
      await new Promise((r) => setTimeout(r, 0))
      if (gen !== parseGen || signal.aborted) return
    }
    parsedAll = true
    if (first) repaint()
    else {
      if (sortCol >= 0 || filter) repaint()
      else extendOrder()
      info()
      onScroll()
    }
  }

  const detectNumeric = () => {
    numericCols.clear()
    const sample = body().slice(0, 200)
    for (let k = 0; k < cols; k++) {
      let num = 0
      let filled = 0
      for (const r of sample) {
        const v = r[k] ?? ''
        if (v === '') continue
        filled++
        if (isNumeric(v)) num++
      }
      if (filled && num / filled > 0.8) numericCols.add(k)
    }
  }

  const matches = (i: number): boolean => {
    if (!filter) return true
    rowText ??= []
    let t = rowText[i]
    if (t == null) t = rowText[i] = rows[i].join('\u0001').toLowerCase()
    return t.includes(filter)
  }

  /** Recomputes the visible order (filter + sort) over all parsed rows. */
  const computeOrder = () => {
    const start = bodyStart()
    order = []
    for (let i = start; i < rows.length; i++) if (matches(i)) order.push(i)
    if (sortCol >= 0) {
      const k = sortCol
      const num = numericCols.has(k)
      order.sort((a, b) => {
        const x = rows[a][k] ?? ''
        const y = rows[b][k] ?? ''
        if (x === '' || y === '') return x === y ? a - b : x === '' ? 1 : -1
        const c = num ? toNumber(x) - toNumber(y) : collator.compare(x, y)
        return (c || a - b) * sortDir
      })
    }
  }
  /** While parsing continues unsorted, new rows are appended to the order. */
  let ordered = 0
  const extendOrder = () => {
    if (sortCol >= 0) return
    const start = Math.max(bodyStart(), ordered)
    for (let i = start; i < rows.length; i++) if (matches(i)) order.push(i)
    ordered = rows.length
  }

  const headerCells = () => {
    const tr0 = h('tr')
    const corner = h('th', 'rn', '#')
    tr0.append(corner)
    const names = header ? rows[0] ?? [] : []
    for (let k = 0; k < cols; k++) {
      const label = header ? (names[k] ?? '') : colName(k)
      const th = h('th', undefined, label || colName(k))
      th.title = tr('클릭하여 정렬', 'Click to sort')
      if (k === sortCol) th.append(h('span', 'arrow', sortDir > 0 ? '▲' : '▼'))
      th.setAttribute('aria-sort', k === sortCol ? (sortDir > 0 ? 'ascending' : 'descending') : 'none')
      th.addEventListener('click', () => {
        if (sortCol !== k) {
          sortCol = k
          sortDir = 1
        } else if (sortDir === 1) sortDir = -1
        else sortCol = -1
        repaint()
      })
      tr0.append(th)
    }
    thead.replaceChildren(tr0)
  }

  const highlight = (td: HTMLElement, v: string) => {
    if (!filter) {
      td.textContent = v
      return
    }
    const low = v.toLowerCase()
    let at = 0
    let k = low.indexOf(filter)
    if (k < 0) {
      td.textContent = v
      return
    }
    while (k >= 0) {
      td.append(v.slice(at, k), h('mark', undefined, v.slice(k, k + filter.length)))
      at = k + filter.length
      k = low.indexOf(filter, at)
    }
    td.append(v.slice(at))
  }

  const more = () => {
    const end = Math.min(order.length, shown + CHUNK)
    const frag = document.createDocumentFragment()
    for (; shown < end; shown++) {
      const i = order[shown]
      const r = rows[i]
      const trEl = h('tr')
      trEl.append(h('td', 'rn', String(i - bodyStart() + 1)))
      for (let k = 0; k < cols; k++) {
        const td = h('td', numericCols.has(k) ? 'num' : undefined)
        highlight(td, r[k] ?? '')
        trEl.append(td)
      }
      frag.append(trEl)
    }
    tbody.append(frag)
  }

  const info = () => {
    const total = Math.max(0, rows.length - bodyStart())
    const label = `${total.toLocaleString()}${parsedAll ? '' : '+'} × ${cols} · ${usedEncoding.toUpperCase()} · ${formatBytes(bytes.byteLength)}`
    toolbar.info(label)
    count.textContent = filter ? `${order.length.toLocaleString()} / ${total.toLocaleString()}` : `${total.toLocaleString()}${parsedAll ? '' : '+'} ${tr('행', 'rows')}`
  }

  const repaint = () => {
    if (raw) {
      paintRaw()
      return
    }
    computeOrder()
    ordered = rows.length
    headerCells()
    tbody.replaceChildren()
    shown = 0
    more()
    if (!order.length) {
      const tr0 = h('tr')
      const td = h('td', 'empty', filter ? tr('일치하는 행이 없습니다.', 'No matching rows.') : tr('데이터가 없습니다.', 'No data.'))
      td.colSpan = cols + 1
      tr0.append(td)
      tbody.append(tr0)
    }
    info()
    headerBtn.setAttribute('aria-pressed', String(header))
    if (root.firstChild !== style || root.lastChild !== wrap) root.replaceChildren(style, wrap)
    sizeBar()
  }

  const paintRaw = () => {
    rawLines = text.split(/\r\n|\r|\n/)
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') rawLines.pop()
    rawPre.replaceChildren()
    rawShown = 0
    moreRaw()
    root.replaceChildren(style, rawPre)
    root.scrollTo(0, 0)
    toolbar.info(`${usedEncoding.toUpperCase()} · ${rawLines.length.toLocaleString()} ${tr('줄', 'lines')} · ${formatBytes(bytes.byteLength)}`)
  }
  const moreRaw = () => {
    const end = Math.min(rawLines.length, rawShown + 2000)
    rawPre.append(rawLines.slice(rawShown, end).join('\n') + (end < rawLines.length ? '\n' : ''))
    rawShown = end
  }

  const onScroll = () => {
    if (root.scrollTop + root.clientHeight < root.scrollHeight - 800) return
    if (raw) {
      if (rawShown < rawLines.length) moreRaw()
    } else if (shown < order.length) more()
  }
  root.addEventListener('scroll', onScroll, { passive: true, signal })

  // The filter bar spans the viewport even when the table scrolls sideways.
  const sizeBar = () => wrap.style.setProperty('--vw', `${root.clientWidth}px`)
  const ro = new ResizeObserver(sizeBar)
  ro.observe(root)

  let debounce = 0
  input.addEventListener(
    'input',
    () => {
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => {
        filter = input.value.trim().toLowerCase()
        repaint()
        root.scrollTo({ top: 0 })
      }, 150)
    },
    { signal }
  )

  // Toolbar: delimiter, header, raw, encoding, zoom.
  decode()
  const preferred = delim || (ctx.fileType === 'tsv' ? '\t' : ',')
  if (!delim) delim = detectDelimiter(text, preferred)
  const delimSel = toolbar.select(
    tr('구분 기호', 'Delimiter'),
    DELIMITERS.map((d) => ({ value: d, label: tr(...DELIM_LABEL[d]) })),
    (v) => {
      delim = v
      sortCol = -1
      void parse()
    }
  )
  delimSel.value = delim
  const headerBtn = toolbar.button({
    label: tr('머리글', 'Header'),
    title: tr('첫 행을 머리글로 사용', 'First row is the header'),
    onClick: () => {
      header = !header
      sortCol = -1
      detectNumeric()
      repaint()
    }
  })
  const rawBtn = toolbar.button({
    label: tr('원본', 'Raw'),
    title: tr('원본 텍스트 보기', 'Show the source text'),
    onClick: () => {
      raw = !raw
      rawBtn.setAttribute('aria-pressed', String(raw))
      delimSel.disabled = raw
      headerBtn.disabled = raw
      if (raw) paintRaw()
      else {
        root.replaceChildren(style, wrap)
        repaint()
      }
    }
  })
  rawBtn.setAttribute('aria-pressed', 'false')
  const encSel = toolbar.select(
    tr('인코딩', 'Encoding'),
    ['utf-8', 'utf-16le', 'utf-16be', ...FALLBACK_ENCODINGS].map((e) => ({ value: e, label: e.toUpperCase() })),
    (v) => {
      encoding = v
      const keep = delim
      decode()
      delim = keep
      if (raw) paintRaw()
      else void parse()
    }
  )
  encSel.value = usedEncoding

  const zoom = createZoom(1, (s) => {
    wrap.style.fontSize = `${13 * s}px`
    rawPre.style.fontSize = `${12.5 * s}px`
  }, undefined, { min: 0.5, max: 3 })
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)

  root.replaceChildren(style, wrap)
  // The first slice paints synchronously; the rest parses in the background.
  void parse()
  return () => {
    parseGen++
    ro.disconnect()
    window.clearTimeout(debounce)
  }
}

function colName(k: number): string {
  let s = ''
  let n = k + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
