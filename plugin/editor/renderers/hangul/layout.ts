/** Page layout from Hangul's saved line segments. Every line of body text carries the vertical
 *  position, height, baseline, start x and width Hangul computed when it saved the file; a line
 *  whose position goes back up starts the next column or page. Objects anchored to paragraphs are
 *  placed from their offsets, tables taller than the remaining page continue on the next page.
 *  Pure computation (no DOM): HWPUNIT in, HWPUNIT out. */
import {
  DEFAULT_OUTLINE,
  formatNumber,
  paperSize,
  type Cell,
  type Columns,
  type HangulDoc,
  type HeaderFooter,
  type Note,
  type Obj,
  type ObjPos,
  type PageNumberPos,
  type Para,
  type Section,
  type Table
} from './model.ts'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface PlacedLine {
  para: Para
  li: number
  x: number
  y: number
}

export interface PlacedObj {
  obj: Obj
  x: number
  y: number
  /** For a table split over pages: the rows shown here [from, to). */
  rows?: [number, number]
  /** Paragraph the object belongs to, for its caption numbering. */
  para: Para
}

export interface Page {
  index: number
  /** Page number shown by page-number fields (1-based, continuous). */
  number: number
  section: number
  width: number
  height: number
  body: Box
  lines: PlacedLine[]
  objs: PlacedObj[]
  header: HeaderFooter | null
  footer: HeaderFooter | null
  footnotes: Note[]
  endnotes: Note[]
  pageNum: PageNumberPos | null
  /** The section had no saved line layout: draw its paragraphs as flowing text in this page. */
  flow?: Section
}

export interface Layout {
  pages: Page[]
  /** Paragraph number / bullet prefixes. */
  prefixes: Map<Para, string>
}

/** The line index of a text position within a paragraph. */
export function lineOf(para: Para, textIndex: number): number {
  let li = 0
  for (let i = 1; i < para.lines.length; i++) if (para.lines[i].start <= textIndex) li = i
  return li
}

/** Text index of the k-th U+FFFC (control k). */
export function ctrlIndex(para: Para, k: number): number {
  let n = -1
  for (let i = 0; i < para.text.length; i++) {
    if (para.text.charCodeAt(i) === 0xfffc && ++n === k) return i
  }
  return -1
}

/** Lines with layout in a share of the paragraphs: below half, the section is drawn as flow. */
export function hasLineLayout(paras: Para[]): boolean {
  if (!paras.length) return false
  let n = 0
  for (const p of paras) if (p.lines.length) n++
  return n / paras.length >= 0.5
}

/** Height of a paragraph list from its saved lines (bottom of the lowest line). */
export function listHeight(paras: Para[]): number {
  let h = 0
  for (const p of paras) for (const l of p.lines) h = Math.max(h, l.y + l.height)
  return h
}

export interface TableGeom {
  colX: number[]
  rowY: number[]
  width: number
  height: number
}

const geomCache = new WeakMap<Table, TableGeom>()

/** Column and row boundaries from the cells' sizes and content. Hangul stores each cell's width
 *  and a minimum height; rows grow to fit the saved line layout of their cells. */
export function tableGeom(t: Table): TableGeom {
  const hit = geomCache.get(t)
  if (hit) return hit
  const cols = Math.max(1, t.cols, ...t.cells.map((c) => c.col + c.colSpan))
  const rows = Math.max(1, t.rows, ...t.cells.map((c) => c.row + c.rowSpan))
  const colX = boundaries(
    cols,
    t.cells.map((c) => ({ a: c.col, n: c.colSpan, size: c.width })),
    t.pos.width
  )
  const need = (c: Cell) => Math.max(c.height, listHeight(c.paras) + c.margin[2] + c.margin[3])
  const heights = new Array<number>(rows).fill(0)
  for (const c of t.cells) if (c.rowSpan === 1 && c.row < rows) heights[c.row] = Math.max(heights[c.row], need(c))
  for (const c of t.cells) {
    if (c.rowSpan <= 1) continue
    let sum = 0
    for (let r = c.row; r < Math.min(rows, c.row + c.rowSpan); r++) sum += heights[r]
    const want = need(c)
    if (sum < want) heights[Math.min(rows, c.row + c.rowSpan) - 1] += want - sum
  }
  const rowY = [0]
  for (let r = 0; r < rows; r++) rowY.push(rowY[r] + heights[r])
  const g = { colX, rowY, width: colX[cols], height: rowY[rows] }
  geomCache.set(t, g)
  return g
}

/** Boundaries 0..n from spans {start, count, size}: solved left to right, gaps filled evenly. */
export function boundaries(n: number, spans: { a: number; n: number; size: number }[], total: number): number[] {
  const x: (number | null)[] = new Array(n + 1).fill(null)
  x[0] = 0
  for (let pass = 0; pass < n + 1; pass++) {
    let changed = false
    for (const s of spans) {
      const e = Math.min(n, s.a + s.n)
      if (x[s.a] != null && x[e] == null) {
        x[e] = x[s.a]! + s.size
        changed = true
      } else if (x[e] != null && x[s.a] == null) {
        x[s.a] = x[e]! - s.size
        changed = true
      }
    }
    if (!changed) break
  }
  if (x[n] == null) x[n] = total > 0 ? total : Math.max(0, ...x.filter((v): v is number => v != null)) || n * 1000
  // Fill unknown boundaries by interpolation between known ones.
  for (let i = 1; i < n; i++) {
    if (x[i] != null) continue
    let j = i + 1
    while (x[j] == null) j++
    const a = x[i - 1]!
    const b = x[j]!
    x[i] = a + (b - a) / (j - i + 1)
  }
  return x as number[]
}

/** Column boxes (x offset and width inside the body) for a column definition. */
export function columnBoxes(c: Columns | null, bodyWidth: number): { x: number; w: number }[] {
  const n = c ? Math.max(1, Math.min(c.count, 16)) : 1
  if (n === 1) return [{ x: 0, w: bodyWidth }]
  const out: { x: number; w: number }[] = []
  if (c && c.widths.length >= n) {
    // OWPML / HWP store relative widths and gaps (fractions of 32768).
    const ws = c.widths.slice(0, n)
    const gaps = c.gaps ?? []
    const sum = ws.reduce((a, b) => a + b, 0) + gaps.slice(0, n - 1).reduce((a, b) => a + b, 0)
    const scale = sum > 0 ? bodyWidth / sum : 1
    let x = 0
    for (let i = 0; i < n; i++) {
      out.push({ x, w: ws[i] * scale })
      x += ws[i] * scale + (gaps[i] ?? 0) * scale
    }
    return out
  }
  const gap = c?.gap ?? 0
  const w = (bodyWidth - gap * (n - 1)) / n
  for (let i = 0; i < n; i++) out.push({ x: i * (w + gap), w })
  return out
}

/** Size of an object's outer box including its caption. */
export function objHeight(o: Obj): number {
  const h = o.kind === 'table' ? tableGeom(o).height : o.pos.height
  const cap = o.caption
  if (!cap || cap.side === 'left' || cap.side === 'right') return h
  return h + cap.gap + listHeight(cap.paras)
}

export function layoutDoc(doc: HangulDoc): Layout {
  const pages: Page[] = []
  let number = 0
  doc.sections.forEach((sec, si) => {
    const size = paperSize(sec.page)
    const p = sec.page
    const body: Box = {
      x: p.left + p.gutter,
      y: p.top + p.header,
      w: Math.max(1000, size.width - p.left - p.right - p.gutter),
      h: Math.max(1000, size.height - p.top - p.header - p.bottom - p.footer)
    }
    let header: HeaderFooter | null = null
    let footer: HeaderFooter | null = null
    let evenHeader: HeaderFooter | null = null
    let evenFooter: HeaderFooter | null = null
    let pageNum: PageNumberPos | null = null
    let cols = columnBoxes(null, body.w)
    const newPage = (): Page => {
      const pg: Page = {
        index: pages.length,
        number: ++number,
        section: si,
        width: size.width,
        height: size.height,
        body,
        lines: [],
        objs: [],
        header: null,
        footer: null,
        footnotes: [],
        endnotes: [],
        pageNum
      }
      pages.push(pg)
      return pg
    }
    const assign = (pg: Page) => {
      const even = pg.number % 2 === 0
      pg.header = (even ? evenHeader : header) ?? header
      pg.footer = (even ? evenFooter : footer) ?? footer
      pg.pageNum = pageNum
    }

    if (!hasLineLayout(sec.paras)) {
      // No saved layout (written by a tool, not Hangul): one flowing page per section.
      const pg = newPage()
      pg.flow = sec
      for (const para of sec.paras) collectSectionCtrls(para)
      assign(pg)
      return
    }

    let pageIdx = pages.length
    let col = 0
    let lastY = -Infinity
    let started = false
    let pg = newPage()
    pageIdx = pg.index
    const advance = (forcePage: boolean) => {
      if (!forcePage && col < cols.length - 1) {
        col++
      } else {
        col = 0
        if (pageIdx + 1 < pages.length) pageIdx++
        else {
          newPage()
          pageIdx = pages.length - 1
        }
        pg = pages[pageIdx]
        assign(pg)
      }
      lastY = -Infinity
    }
    function collectSectionCtrls(para: Para) {
      for (const c of para.ctrls) {
        if (!c) continue
        if (c.kind === 'header') {
          if (c.apply === 'even') evenHeader = c
          else header = c
        } else if (c.kind === 'footer') {
          if (c.apply === 'even') evenFooter = c
          else footer = c
        } else if (c.kind === 'pagenum') pageNum = c.where ? c : null
        else if (c.kind === 'columns') cols = columnBoxes(c, body.w)
      }
    }
    assign(pg)

    for (const para of sec.paras) {
      collectSectionCtrls(para)
      assign(pg)
      if (para.pageBreak && started && pg.lines.length) advance(true)
      else if (para.columnBreak && started) advance(false)
      const linePage: number[] = []
      const lineCol: number[] = []
      para.lines.forEach((line, li) => {
        if (started && line.y < lastY - 10) advance(false)
        started = true
        lastY = line.y
        linePage[li] = pageIdx
        lineCol[li] = col
        pg.lines.push({ para, li, x: body.x + cols[col].x + line.x, y: body.y + line.y })
      })
      if (!para.lines.length) {
        linePage[0] = pageIdx
        lineCol[0] = col
      }
      // Objects and notes anchored in this paragraph.
      let k = -1
      for (let i = 0; i < para.text.length; i++) {
        if (para.text.charCodeAt(i) !== 0xfffc) continue
        k++
        const c = para.ctrls[k]
        if (!c) continue
        const li = lineOf(para, i)
        const at = pages[linePage[li] ?? pageIdx]
        const line = para.lines[li]
        const colBox = cols[lineCol[li] ?? col] ?? cols[0]
        if (c.kind === 'footnote') at.footnotes.push(c)
        else if (c.kind === 'endnote') pages[pages.length - 1].endnotes.push(c)
        else if (c.kind === 'table' || c.kind === 'picture' || c.kind === 'shape' || c.kind === 'placeholder') {
          if (c.pos.inline) {
            // A table alone on its line is laid out as a block so it can continue on the next page.
            if (c.kind === 'table' && line && soleObject(para, li)) {
              const g = tableGeom(c)
              const lineX = body.x + colBox.x + line.x
              const free = line.width - g.width - c.pos.margin[0] - c.pos.margin[1]
              const ps = doc.paraShapes[para.ps]
              const off = ps?.align === 'center' ? free / 2 : ps?.align === 'right' ? free : 0
              const top = body.y + line.y + c.pos.margin[2]
              const end = placeTable(c, para, at.index, lineX + c.pos.margin[0] + Math.max(0, off), top)
              if (end) {
                pageIdx = end.page
                pg = pages[pageIdx]
                lastY = end.y - body.y - 3000
              }
            }
            continue
          }
          const paraTop = body.y + (para.lines[0]?.y ?? Math.max(0, lastY))
          const paraLeft = body.x + colBox.x + (doc.paraShapes[para.ps]?.left ?? 0)
          const { x, y } = objPosition(c.pos, objWidth(c), objHeight(c), {
            paper: { x: 0, y: 0, w: size.width, h: size.height },
            page: body,
            column: { x: body.x + colBox.x, y: body.y, w: colBox.w, h: body.h },
            para: { x: paraLeft, y: paraTop, w: colBox.w, h: body.h }
          })
          if (c.kind === 'table' && c.pos.vertRel === 'para' && (c.pos.wrap === 'topbottom' || c.pos.wrap === 'square')) {
            const end = placeTable(c, para, at.index, x, y)
            if (end) {
              pageIdx = end.page
              pg = pages[pageIdx]
              lastY = end.y - body.y - 3000
            }
          } else at.objs.push({ obj: c, x, y, para })
        }
      }
    }

    /** Places a table at (x, y) on page `pi`; rows that do not fit continue on following pages.
     *  Returns the last page and bottom when it spilled over. */
    function placeTable(t: Table, para: Para, pi: number, x: number, y: number): { page: number; y: number } | null {
      const g = tableGeom(t)
      const bottom = body.y + body.h
      if (y + g.height <= bottom + 200 || g.height <= 0) {
        pages[pi].objs.push({ obj: t, x, y, para })
        return null
      }
      let from = 0
      let top = y
      let page = pi
      let guard = 0
      while (from < g.rowY.length - 1 && guard++ < 500) {
        let to = from
        while (to < g.rowY.length - 1 && top + (g.rowY[to + 1] - g.rowY[from]) <= bottom + 200) to++
        if (to === from) {
          if (top > body.y + 1) {
            // Not even one row fits: start on the next page.
          } else to = from + 1 // a row taller than the page: show it anyway
        }
        if (to > from) pages[page].objs.push({ obj: t, x, y: top, rows: [from, to], para })
        from = to
        if (from >= g.rowY.length - 1) break
        page++
        while (page >= pages.length) {
          const np = newPage()
          assign(np)
        }
        top = body.y
      }
      const last = pages[page].objs[pages[page].objs.length - 1]
      const endY = last && last.obj === t && last.rows ? last.y + (g.rowY[last.rows[1]] - g.rowY[last.rows[0]]) : top
      return { page, y: endY }
    }
  })
  if (!pages.length) {
    pages.push({
      index: 0,
      number: 1,
      section: 0,
      width: 59528,
      height: 84188,
      body: { x: 8504, y: 9920, w: 42520, h: 66016 },
      lines: [],
      objs: [],
      header: null,
      footer: null,
      footnotes: [],
      endnotes: [],
      pageNum: null
    })
  }
  return { pages, prefixes: numberParas(doc) }
}

function soleObject(para: Para, li: number): boolean {
  const start = para.lines[li]?.start ?? 0
  const end = para.lines[li + 1]?.start ?? para.text.length
  const s = para.text.slice(start, end)
  let objs = 0
  for (const ch of s) {
    if (ch === '￼') objs++
    else if (ch.trim()) return false
  }
  return objs >= 1
}

export function objWidth(o: Obj): number {
  return o.kind === 'table' ? tableGeom(o).width : o.pos.width
}

/** Top-left of a floating object from its reference box, alignment and offsets. */
export function objPosition(pos: ObjPos, w: number, h: number, ref: Record<'paper' | 'page' | 'column' | 'para', Box>): { x: number; y: number } {
  const v = ref[pos.vertRel] ?? ref.para
  const hz = ref[pos.horzRel] ?? ref.column
  let y: number
  if (pos.vertRel === 'para') y = v.y + pos.y
  else if (pos.vertAlign === 'center') y = v.y + (v.h - h) / 2 + pos.y
  else if (pos.vertAlign === 'bottom' || pos.vertAlign === 'outside') y = v.y + v.h - h - pos.y
  else y = v.y + pos.y
  let x: number
  if (pos.horzAlign === 'center') x = hz.x + (hz.w - w) / 2 + pos.x
  else if (pos.horzAlign === 'right' || pos.horzAlign === 'outside') x = hz.x + hz.w - w - pos.x
  else x = hz.x + pos.x
  // Outer margins push text-flow objects away from their anchor.
  if (pos.wrap === 'topbottom' || pos.wrap === 'square') {
    if (pos.vertRel === 'para') y += pos.margin[2]
    if (pos.horzRel !== 'paper' && pos.horzAlign === 'left') x += pos.margin[0]
  }
  return { x, y }
}

// ---------------------------------------------------------------- numbering

/** Paragraph heading prefixes: outline / numbering counters and bullets, in document order. */
export function numberParas(doc: HangulDoc): Map<Para, string> {
  const out = new Map<Para, string>()
  const counters = new Map<number, number[]>()
  const visit = (p: Para) => {
    const ps = doc.paraShapes[p.ps]
    if (!ps || ps.heading === 'none') return
    const level = Math.max(0, Math.min(9, ps.level))
    if (ps.heading === 'bullet') {
      const b = doc.bullets[ps.headingId - 1] ?? doc.bullets[ps.headingId]
      out.set(p, b?.char || '•')
      return
    }
    const key = ps.heading === 'outline' ? -1 : ps.headingId
    const def = ps.heading === 'outline' ? (doc.numberings[0] ?? DEFAULT_OUTLINE) : (doc.numberings[ps.headingId - 1] ?? DEFAULT_OUTLINE)
    const lv = def.levels[level] ?? DEFAULT_OUTLINE.levels[level]
    if (!lv || !lv.format) return
    let c = counters.get(key)
    if (!c) {
      c = def.levels.map((l) => (l?.start ?? 1) - 1)
      counters.set(key, c)
    }
    c[level] = (c[level] ?? (lv.start ?? 1) - 1) + 1
    for (let i = level + 1; i < c.length; i++) c[i] = (def.levels[i]?.start ?? 1) - 1
    const text = lv.format.replace(/\^(\d+)/g, (_m, d: string) => {
      const n = Number(d) - 1
      const style = def.levels[n]?.style ?? 0
      return formatNumber(Math.max(1, c![n] ?? 1), style)
    })
    out.set(p, text)
  }
  for (const s of doc.sections) for (const p of s.paras) visit(p)
  return out
}
