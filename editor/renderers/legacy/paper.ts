/** Draws a DocModel as white "paper" pages: paragraphs, headings, lists, tables and pictures.
 *  Pages are appended in chunks while the person scrolls, so long documents open at once. */
import type { PreviewContext } from '../../core/types.ts'
import { bindZoomGestures, clampZoom, createZoom, h, objectUrl } from '../../core/ui.ts'
import type { Block, DocModel, Paragraph, Run } from './model.ts'

const BASE_PX = 15
/** Page width in em at BASE_PX: about an A4 page (794 px). */
const PAGE_EM = 794 / BASE_PX

const STYLE = `
.fp-doc { padding: 12px; box-sizing: border-box; font-size: ${BASE_PX}px; }
.fp-doc .fp-page { width: ${PAGE_EM}em; max-width: none; padding: 4.5em 5em; box-sizing: border-box; min-height: ${1123 / BASE_PX}em;
  font: 1em/1.6 "Calibri", "Segoe UI", "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", NanumGothic, "나눔고딕", system-ui, sans-serif;
  overflow-wrap: anywhere; }
.fp-doc.compact { padding: 8px; }
.fp-doc.compact .fp-page { width: auto; min-height: 0; padding: 1.4em 1.2em; margin: 0 0 10px; }
.fp-doc .fp-page:last-child { margin-bottom: 24px; }
.fp-doc p { margin: 0 0 .55em; white-space: pre-wrap; min-height: 1.2em; }
.fp-doc h1, .fp-doc h2, .fp-doc h3, .fp-doc h4, .fp-doc h5, .fp-doc h6 { margin: .9em 0 .4em; line-height: 1.35; white-space: pre-wrap; color: #17365d; }
.fp-doc h1.title { font-size: 2.1em; color: #17365d; border-bottom: 1px solid #4f81bd; padding-bottom: .2em; margin-top: 0; }
.fp-doc h1 { font-size: 1.55em; } .fp-doc h2 { font-size: 1.3em; } .fp-doc h3 { font-size: 1.15em; }
.fp-doc h4, .fp-doc h5, .fp-doc h6 { font-size: 1em; }
.fp-doc p.li { position: relative; padding-left: 1.4em; }
.fp-doc p.li::before { content: "•"; position: absolute; left: .35em; }
.fp-doc .tbl { overflow-x: auto; margin: .4em 0 .8em; }
.fp-doc table { border-collapse: collapse; min-width: 50%; }
.fp-doc td { border: 1px solid #9aa3ad; padding: .25em .5em; vertical-align: top; }
.fp-doc td p { margin: 0; }
.fp-doc tr:first-child td { background: #f2f5f9; }
.fp-doc img { max-width: 100%; height: auto; vertical-align: bottom; }
.fp-doc .obj { display: inline-block; padding: .1em .5em; border: 1px dashed #999; border-radius: 4px; color: #666; font-size: .85em; }
.fp-doc .sect { margin: 1.6em 0 .6em; padding-top: .6em; border-top: 1px solid #ccc; color: #555; font-weight: 600; font-size: .9em; }
.fp-doc-note { margin: 0 auto 8px; max-width: ${PAGE_EM}em; padding: 6px 10px; border-radius: var(--orca-radius, 6px); box-sizing: border-box;
  background: var(--orca-muted, #f4f4f5); color: var(--orca-foreground, #111); font-size: 12px; }
.fp-doc.compact .fp-doc-note { max-width: none; }
`

/** Blocks rendered per chunk. */
const CHUNK = 300

export interface PaperOptions {
  /** Banner above the first page (e.g. "this .doc is really RTF"). */
  note?: string
}

export function renderPaper(ctx: PreviewContext, model: DocModel, opts: PaperOptions = {}): () => void {
  const { root, toolbar, tr, signal } = ctx
  const wrap = h('div', 'fp-doc' + (ctx.compact ? ' compact' : ''))
  if (opts.note) wrap.append(h('div', 'fp-doc-note', opts.note))
  const sectionTitle = (t: string) =>
    t === 'footnotes' ? tr('각주', 'Footnotes') : t === 'endnotes' ? tr('미주', 'Endnotes') : t === 'textboxes' ? tr('텍스트 상자', 'Text boxes') : t

  const basePt = commonPt(model.blocks)
  const runEl = (r: Run): Node => {
    if (r.image) {
      const img = h('img')
      img.alt = tr('그림', 'Picture')
      img.src = objectUrl(r.image.bytes, r.image.mime, signal)
      if (r.image.width) img.style.width = `${r.image.width / BASE_PX}em`
      img.decoding = 'async'
      img.loading = 'lazy'
      return img
    }
    if (r.object) return h('span', 'obj', r.object === 'OLE' ? tr('[개체]', '[Object]') : tr('[그림]', '[Picture]'))
    if (r.checkbox) {
      const b = h('span', undefined, '☐ ')
      return b
    }
    if (r.labelWidth != null) {
      // a list number or bullet: keep the text after it at the tab
      const l = h('span', undefined, r.text)
      l.style.display = 'inline-block'
      l.style.minWidth = `${Math.max(r.labelWidth, 9) / (BASE_PX * 0.75)}em`
      l.style.textIndent = '0'
      return l
    }
    if (!r.b && !r.i && !r.u && !r.s && !r.color && !r.bg && !(r.pt && Math.abs(r.pt - basePt) > 0.4) && !r.sup && !r.sub) return document.createTextNode(r.text)
    const el = h(r.sup ? 'sup' : r.sub ? 'sub' : 'span', undefined, r.text)
    const st = el.style
    if (r.b) st.fontWeight = '700'
    if (r.i) st.fontStyle = 'italic'
    if (r.u || r.s) st.textDecoration = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].join(' ').trim()
    if (r.color && r.color !== '#000000') st.color = r.color
    if (r.bg) st.background = r.bg
    if (r.pt && Math.abs(r.pt - basePt) > 0.4) st.fontSize = `${Math.min(4, Math.max(0.5, r.pt / basePt))}em`
    return el
  }
  const paraEl = (p: Paragraph): HTMLElement => {
    const el =
      p.heading != null ? h(`h${Math.max(1, p.heading)}` as 'h1', p.heading === 0 ? 'title' : undefined) : h('p', p.list ? 'li' : undefined)
    for (const r of p.runs) el.append(runEl(p.heading != null ? { ...r, pt: undefined } : r))
    if (p.align && p.align !== 'left') el.style.textAlign = p.align
    if (p.indent) el.style.marginLeft = `${Math.min(p.indent, 300) / BASE_PX}em`
    return el
  }
  const blockEl = (b: Block): HTMLElement | null => {
    if (b.kind === 'p') return paraEl(b)
    if (b.kind === 'section') return h('div', 'sect', sectionTitle(b.title))
    if (b.kind === 'table') {
      const box = h('div', 'tbl')
      const t = h('table')
      for (const row of b.rows) {
        const rowEl = h('tr')
        for (const cell of row) {
          const td = h('td')
          for (const cb of cell) {
            const e = blockEl(cb)
            if (e) td.append(e)
          }
          rowEl.append(td)
        }
        t.append(rowEl)
      }
      box.append(t)
      return box
    }
    return null
  }

  const blocks = model.blocks
  let pages = 1 + blocks.filter((b) => b.kind === 'break').length
  if (blocks.length && blocks[blocks.length - 1].kind === 'break') pages--
  let page = h('div', 'fp-page')
  page.setAttribute('role', 'document')
  wrap.append(page)
  let shown = 0
  const more = () => {
    const end = Math.min(blocks.length, shown + CHUNK)
    for (; shown < end; shown++) {
      const b = blocks[shown]
      if (b.kind === 'break') {
        if (shown === blocks.length - 1) continue
        page = h('div', 'fp-page')
        page.setAttribute('role', 'document')
        wrap.append(page)
        continue
      }
      const el = blockEl(b)
      if (el) page.append(el)
    }
  }
  more()
  const onScroll = () => {
    if (shown < blocks.length && root.scrollTop + root.clientHeight > root.scrollHeight - 1200) more()
  }
  root.addEventListener('scroll', onScroll, { signal })
  // Keep filling in the background so search (Ctrl+F) and the scroll bar see the whole document.
  let timer = 0
  const idle = () => {
    if (signal.aborted || shown >= blocks.length) return
    more()
    timer = window.setTimeout(idle, 30)
  }
  timer = window.setTimeout(idle, 200)

  const naturalWidth = () => PAGE_EM * BASE_PX + 24
  const fit = () => (ctx.compact ? 1 : clampZoom((root.clientWidth - 8) / naturalWidth(), 0.25, 3))
  const zoom = createZoom(
    1,
    (s) => {
      wrap.style.fontSize = `${BASE_PX * s}px`
    },
    fit,
    { min: 0.25, max: 4 }
  )
  toolbar.info(
    `${model.variant} · ${pages.toLocaleString()} ${tr('쪽', pages === 1 ? 'page' : 'pages')} · ${blocks.filter((b) => b.kind === 'p').length.toLocaleString()} ${tr('문단', 'paragraphs')}`
  )
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)
  root.replaceChildren(h('style', undefined, STYLE), wrap)
  if (!ctx.compact && root.clientWidth < naturalWidth()) zoom.set(fit())
  return () => window.clearTimeout(timer)
}

/** The most used font size (by characters) is drawn as 1em; other sizes are relative to it. */
function commonPt(blocks: Block[]): number {
  const count = new Map<number, number>()
  const visit = (bs: Block[]) => {
    for (const b of bs) {
      if (b.kind === 'p') {
        if (b.heading != null) continue
        for (const r of b.runs) if (r.pt) count.set(r.pt, (count.get(r.pt) ?? 0) + r.text.length)
      } else if (b.kind === 'table') for (const row of b.rows) for (const c of row) visit(c)
    }
  }
  visit(blocks.slice(0, 5000))
  let best = 11
  let n = 0
  for (const [pt, c] of count) if (c > n) [best, n] = [pt, c]
  return best
}
