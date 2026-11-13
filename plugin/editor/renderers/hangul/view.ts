/** Draws a HangulDoc. Page view: white pages at Hangul's paper size with every line placed where
 *  Hangul's saved line segments put it (lines are then fitted to the saved width, so a missing
 *  Hancom font does not change line breaks), tables / pictures / text boxes positioned from their
 *  anchors, header / footer, footnotes and page numbers. Pages are painted when they come near
 *  the viewport. Reading view: the same content as flowing text that wraps at the screen width
 *  (the default on phones). All lengths are em of the wrapper: 1em = 1000 HWPUNIT (10 pt). */
import type { PreviewContext } from '../../core/types.ts'
import { bindZoomGestures, clampZoom, createZoom, h, objectUrl } from '../../core/ui.ts'
import { fontStack } from './fonts.ts'
import {
  ctrlIndex,
  hasLineLayout,
  layoutDoc,
  listHeight,
  objHeight,
  objPosition,
  objWidth,
  tableGeom,
  type Layout,
  type Page,
  type PlacedObj
} from './layout.ts'
import { EMPTY_BORDER_FILL, type Border, type BorderFill, type Caption, type CharShape, type HangulDoc, type HeaderFooter, type Obj, type Para, type ParaShape, type Table } from './model.ts'

/** px per em at 100 %: 10 pt. */
const BASE_PX = 40 / 3
/** Headroom above the baseline used by the baseline spacer of each line (HWPUNIT). */
const ASC = 3000
const PAGE_GAP_PX = 14

export const em = (u: number): string => `${Math.round(u) / 1000}em`
const hairline = (mmw: number): string => `max(${Math.round((mmw / 25.4) * 7200) / 1000}em, 0.75px)`

const STYLE = `
.fp-hwp { box-sizing: border-box; padding: 14px 12px 28px; width: max-content; min-width: 100%; }
.fp-hwp .hp-page { position: relative; background: #fff; color: #000; margin: 0 auto ${PAGE_GAP_PX}px; overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,.28); contain: layout paint; }
.fp-hwp .hl { position: absolute; display: flex; align-items: baseline; white-space: pre; line-height: normal; tab-size: 4em; }
.fp-hwp .hl > i { display: block; width: 0; flex: none; }
.fp-hwp .hl > .ht { flex: none; }
.fp-hwp .hl.c { justify-content: center; } .fp-hwp .hl.r { justify-content: flex-end; }
.fp-hwp .ho { position: absolute; box-sizing: border-box; }
.fp-hwp .hi { display: inline-block; position: relative; vertical-align: baseline; white-space: normal; }
.fp-hwp .hc { position: absolute; box-sizing: border-box; }
.fp-hwp .hd { position: absolute; pointer-events: none; border: 0 solid transparent; }
.fp-hwp .hph { position: absolute; box-sizing: border-box; display: flex; align-items: center; justify-content: center; overflow: hidden;
  border: 1px dashed #8a8f98; background: #f4f5f7; color: #4b5563; text-align: center; font: 0.9em/1.3 system-ui, sans-serif; padding: 0.2em; white-space: normal; }
.fp-hwp .hph b { font-weight: 600; margin-right: .35em; }
.fp-hwp .hp-sep { position: absolute; border-top: 1px solid #000; height: 0; }
.fp-hwp .hp-flow { position: absolute; }
.fp-hwp img.ho { object-fit: fill; }
.fp-hwp .hl .hpre::before { content: attr(data-pre); position: absolute; right: 100%; top: auto; padding-right: .25em; white-space: pre; }
.fp-hwp .hl .hpre { position: static; }
.fp-hwp sup.hn { font-size: .6em; vertical-align: super; line-height: 0; }
/* Reading view */
.fp-hwp.reading { width: auto; min-width: 0; padding: 0; }
.fp-hwp .hr-sec { background: #fff; color: #000; padding: 1.4em 1.3em 2em; margin: 0 0 2px; overflow-wrap: anywhere; }
.fp-hwp .hr-p { margin: 0; white-space: pre-wrap; tab-size: 4em; min-height: 1em; }
.fp-hwp .hr-p.e { min-height: 1.2em; }
.fp-hwp .hr-tw { overflow-x: auto; max-width: 100%; margin: .3em 0; -webkit-overflow-scrolling: touch; }
.fp-hwp table.hr-t { border-collapse: collapse; table-layout: fixed; }
.fp-hwp td.hr-c { box-sizing: border-box; vertical-align: middle; overflow-wrap: anywhere; }
.fp-hwp .hr-img { display: block; max-width: 100%; height: auto; margin: .3em 0; }
.fp-hwp .hr-box { box-sizing: border-box; max-width: 100%; margin: .3em 0; padding: .4em .6em; }
.fp-hwp .hr-ph { display: inline-block; max-width: 100%; box-sizing: border-box; border: 1px dashed #8a8f98; background: #f4f5f7; color: #4b5563;
  font: 0.9em/1.4 system-ui, sans-serif; padding: .25em .6em; margin: .2em 0; white-space: normal; }
.fp-hwp .hr-pb { border: 0; border-top: 1px dashed #b8bcc4; margin: 1.2em 0; }
.fp-hwp .hr-notes { margin-top: 1.4em; padding-top: .6em; border-top: 1px solid #999; font-size: .92em; }
.fp-hwp .hr-hf { color: #555; border-bottom: 1px dashed #ccc; margin: 0 0 1em; padding-bottom: .4em; }
.fp-hwp .hr-hf.f { border-bottom: 0; border-top: 1px dashed #ccc; margin: 1.4em 0 0; padding: .4em 0 0; }
.fp-hwp .hr-cap { font-size: .95em; margin: .2em 0 .6em; }
.fp-hwp-note { margin: 0 auto 8px; max-width: 800px; padding: 6px 10px; border-radius: var(--orca-radius, 6px); box-sizing: border-box;
  background: var(--orca-muted, #f4f4f5); color: var(--orca-foreground, #111); font-size: 12px; }
`

/** Character shape classes: one CSS rule per shape instead of inline styles on every run. */
function charCss(shapes: CharShape[]): string {
  const rules: string[] = []
  shapes.forEach((c, i) => {
    const size = (c.height * (c.relSize || 100)) / 100
    const d: string[] = [`font-family:${fontStack(c.latinFace, c.hangulFace)}`, `font-size:${em(size * (c.sup || c.sub ? 0.7 : 1))}`]
    if (c.bold) d.push('font-weight:700')
    if (c.italic) d.push('font-style:italic')
    if (c.color && c.color !== '#000000') d.push(`color:${c.color}`)
    if (c.spacing) d.push(`letter-spacing:${c.spacing / 100}em`)
    if (c.spacing < 0) rules.push(`.fp-hwp.reading .k${i}{word-spacing:${-c.spacing / 100}em}`)
    const deco = [c.underline === 'below' ? 'underline' : c.underline === 'above' ? 'overline' : '', c.strike ? 'line-through' : ''].filter(Boolean)
    if (deco.length) d.push(`text-decoration:${deco.join(' ')}`)
    if (c.underline !== 'none' && c.underlineColor && c.underlineColor !== c.color) d.push(`text-decoration-color:${c.underlineColor}`)
    if (c.shade && c.shade !== '#ffffff') d.push(`background:${c.shade}`)
    if (c.sup) d.push('vertical-align:super')
    if (c.sub) d.push('vertical-align:sub')
    rules.push(`.fp-hwp .k${i}{${d.join(';')}}`)
  })
  return rules.join('\n')
}

interface Env {
  doc: HangulDoc
  layout: Layout
  tr: PreviewContext['tr']
  page: Page | null
  totalPages: number
  url(bin: string): string | null
  /** Text spans painted since the last fit pass. */
  fits: Fit[]
  /** Page-view flow fallback (no saved line layout): floating objects are positioned on this page. */
  flowPage?: { page: Page; frag: DocumentFragment } | null
}

interface Fit {
  el: HTMLElement
  target: number
  mode: 'shrink' | 'justify' | 'distribute'
  spaces: number
  chars: number
  align: 'l' | 'c' | 'r'
}

// ---------------------------------------------------------------- runs

function charShapeAt(para: Para, i: number): number {
  let cs = para.runs[0]?.cs ?? 0
  for (const r of para.runs) {
    if (r.start <= i) cs = r.cs
    else break
  }
  return cs
}

/** Text of an auto number / note reference. */
function ctrlText(c: NonNullable<Para['ctrls'][number]>, env: Env, inNote: boolean): string | null {
  if (c.kind === 'autonum') {
    if (c.what === 'page') return String(env.page?.number ?? 1)
    if (c.what === 'totalpages') return String(env.totalPages)
    if (c.what === 'footnote' || c.what === 'endnote') return inNote ? `${c.number})` : String(c.number)
    return String(c.number)
  }
  return null
}

/** Appends the content of text range [s, e) of a paragraph: runs as classed spans, inline
 *  objects as inline boxes, note references as superscripts. Returns counts for fitting. */
function appendRange(
  parent: HTMLElement,
  para: Para,
  s: number,
  e: number,
  env: Env,
  opts: { inNote: boolean; flow: boolean; lineH?: number; lineBase?: number }
): { spaces: number; chars: number; objects: number } {
  let k = -1
  for (let i = 0; i < s; i++) if (para.text.charCodeAt(i) === 0xfffc) k++
  let spaces = 0
  let chars = 0
  let objects = 0
  let buf = ''
  let cls = -1
  const flush = () => {
    if (!buf) return
    const span = h('span', `k${cls}`, buf)
    parent.append(span)
    buf = ''
  }
  for (let i = s; i < e; i++) {
    const ch = para.text[i]
    const cs = charShapeAt(para, i)
    if (cs !== cls) {
      flush()
      cls = cs
    }
    if (ch === '￼') {
      k++
      const c = para.ctrls[k]
      if (!c) continue
      const t = ctrlText(c, env, opts.inNote)
      if (t != null) {
        buf += t
        chars += t.length
        continue
      }
      if (c.kind === 'footnote' || c.kind === 'endnote') {
        flush()
        parent.append(h('sup', `k${cs} hn`, String(c.number)))
        continue
      }
      if ((c.kind === 'table' || c.kind === 'picture' || c.kind === 'shape' || c.kind === 'placeholder') && (c.pos.inline || opts.flow)) {
        flush()
        if (opts.flow) {
          if (c.pos.inline) parent.append(flowObj(c, env, true))
        } else {
          const box = h('span', 'hi')
          const [ml, mr, mt, mb] = c.pos.margin
          const w = objWidth(c)
          const oh = c.kind === 'table' ? tableGeom(c).height : c.pos.height
          box.style.width = em(w + ml + mr)
          box.style.height = em(oh + mt + mb)
          if (opts.lineH != null && opts.lineBase != null) box.style.marginBottom = em(-(opts.lineH - opts.lineBase))
          const el = paintObj(c, env)
          el.style.left = em(ml)
          el.style.top = em(mt)
          box.append(el)
          parent.append(box)
          objects++
        }
      }
      continue
    }
    if (ch === '\n' && !opts.flow) continue
    if (ch === ' ') spaces++
    chars++
    buf += ch
  }
  flush()
  return { spaces, chars, objects }
}

// ---------------------------------------------------------------- positioned lines

function alignOf(ps: ParaShape | undefined): 'l' | 'c' | 'r' {
  const a = ps?.align ?? 'justify'
  return a === 'center' ? 'c' : a === 'right' ? 'r' : 'l'
}

function paintLine(parent: HTMLElement | DocumentFragment, para: Para, li: number, x: number, y: number, env: Env, inNote = false): void {
  const line = para.lines[li]
  const s = Math.max(0, Math.min(para.text.length, line.start))
  let e = li + 1 < para.lines.length ? para.lines[li + 1].start : para.text.length
  e = Math.max(s, Math.min(para.text.length, e))
  // Hangul does not draw trailing spaces of a line.
  let end = e
  while (end > s && (para.text[end - 1] === ' ' || para.text[end - 1] === '\n')) end--
  const ps = env.doc.paraShapes[para.ps]
  const align = alignOf(ps)
  const div = h('div', 'hl' + (align === 'c' ? ' c' : align === 'r' ? ' r' : ''))
  div.style.left = em(x)
  div.style.top = em(y - ASC)
  div.style.width = em(Math.max(0, line.width))
  const spacer = h('i')
  spacer.style.height = em(line.baseline + ASC)
  const tx = h('span', 'ht')
  if (li === 0) {
    const pre = env.layout.prefixes.get(para)
    if (pre) {
      const s0 = h('span', `k${para.runs[0]?.cs ?? 0} hpre`)
      s0.dataset.pre = pre + ' '
      tx.append(s0)
    }
  }
  const st = appendRange(tx, para, s, end, env, { inNote, flow: false, lineH: line.height, lineBase: line.baseline })
  div.append(spacer, tx)
  parent.append(div)
  if (!st.chars || st.objects) return
  const last = li === para.lines.length - 1 || para.text[e - 1] === '\n'
  const a = ps?.align ?? 'justify'
  const mode: Fit['mode'] = a === 'distribute' || a === 'divide' ? 'distribute' : a === 'justify' && !last ? 'justify' : 'shrink'
  env.fits.push({ el: tx, target: line.width, mode, spaces: st.spaces, chars: st.chars, align })
}

/** Measures painted lines once, then writes the adjustments: lines wider than Hangul's saved width
 *  are condensed, justified lines are spread to it. Stored in em so zooming keeps them. */
function fitLines(fits: Fit[], basePx: number): void {
  if (!fits.length) return
  const widths = fits.map((f) => f.el.getBoundingClientRect().width / basePx)
  fits.forEach((f, i) => {
    const natural = widths[i] * 1000
    const target = f.target
    if (!(natural > 0) || !(target > 0)) return
    if (natural > target * 1.003) {
      f.el.style.transform = `scaleX(${Math.max(0.5, target / natural).toFixed(4)})`
      f.el.style.transformOrigin = f.align === 'c' ? '50% 0' : f.align === 'r' ? '100% 0' : '0 0'
    } else if (f.mode !== 'shrink' && natural < target) {
      const gap = target - natural
      if (f.mode === 'justify' && f.spaces > 0) f.el.style.wordSpacing = em(gap / f.spaces)
      else if (f.chars > 1) f.el.style.letterSpacing = em(gap / f.chars)
    }
  })
}

// ---------------------------------------------------------------- lists (cells, boxes, notes)

/** Paragraphs of a sub-list at (0, 0) of `parent`, from their own saved lines. */
function paintList(parent: HTMLElement, paras: Para[], width: number, env: Env, inNote = false): void {
  if (!hasLineLayout(paras)) {
    const flow = h('div')
    flow.style.width = em(width)
    const saved = env.flowPage
    env.flowPage = null
    flow.append(flowParas(paras, env))
    env.flowPage = saved
    parent.append(flow)
    return
  }
  for (const para of paras) {
    para.lines.forEach((l, li) => paintLine(parent, para, li, l.x, l.y, env, inNote))
    anchored(parent, para, env, 0, para.lines[0]?.y ?? 0, width)
  }
}

/** Floating objects of a paragraph inside a list, relative to the list box. */
function anchored(parent: HTMLElement, para: Para, env: Env, x0: number, paraY: number, width: number): void {
  para.ctrls.forEach((c) => {
    if (!c || !(c.kind === 'table' || c.kind === 'picture' || c.kind === 'shape' || c.kind === 'placeholder') || c.pos.inline) return
    const w = objWidth(c)
    let x = x0 + c.pos.x + (c.pos.horzAlign === 'center' ? (width - w) / 2 : c.pos.horzAlign === 'right' ? width - w - 2 * c.pos.x : 0)
    const y = (c.pos.vertRel === 'para' ? paraY : 0) + c.pos.y + (c.pos.vertRel === 'para' ? c.pos.margin[2] : 0)
    if (c.pos.horzAlign === 'left') x += c.pos.margin[0]
    placeObj(parent, c, x, y, env)
  })
}

// ---------------------------------------------------------------- objects

function borderCss(el: HTMLElement, side: 'Left' | 'Right' | 'Top' | 'Bottom', b: Border): void {
  if (b.style === 'none') return
  const w = hairline(b.style === 'double' ? Math.max(b.width, 0.5) : b.width)
  el.style.setProperty(`border-${side.toLowerCase()}`, `${w} ${b.style} ${b.color}`)
}

/** Background of a border fill: colour, gradient or a stretched picture. */
function fillCss(el: HTMLElement, bf: BorderFill, env: Env): void {
  const img = bf.image ? env.url(bf.image) : null
  if (img) {
    el.style.backgroundImage = `url("${img}")`
    el.style.backgroundSize = '100% 100%'
  } else if (bf.gradient && bf.gradient.colors.length > 1) el.style.backgroundImage = `linear-gradient(${(bf.gradient.angle + 180) % 360}deg, ${bf.gradient.colors.join(', ')})`
  if (bf.fill) el.style.backgroundColor = bf.fill
  else if (!img && bf.gradient?.colors.length === 1) el.style.backgroundColor = bf.gradient.colors[0]
}

function placeObj(parent: HTMLElement | DocumentFragment, o: Obj, x: number, y: number, env: Env, rows?: [number, number]): void {
  const el = paintObj(o, env, rows)
  el.style.left = em(x)
  el.style.top = em(y)
  if (o.pos.wrap === 'behind') el.style.zIndex = '0'
  else if (o.pos.wrap === 'front') el.style.zIndex = '2'
  parent.append(el)
}

function paintObj(o: Obj, env: Env, rows?: [number, number]): HTMLElement {
  let el: HTMLElement
  let height = o.pos.height
  if (o.kind === 'table') {
    el = paintTable(o, env, rows)
    const g = tableGeom(o)
    height = rows ? g.rowY[rows[1]] - g.rowY[rows[0]] : g.height
  } else if (o.kind === 'picture') {
    const url = env.url(o.bin)
    if (url) {
      const img = h('img', 'ho')
      img.alt = env.tr('그림', 'Picture')
      img.decoding = 'async'
      img.src = url
      el = img
    } else el = placeholder(env.tr('그림', 'Picture'), '', env)
    el.style.width = em(o.pos.width)
    el.style.height = em(o.pos.height)
  } else if (o.kind === 'placeholder') {
    el = placeholder(placeholderTitle(o.what, env), o.label, env)
    el.style.width = em(o.pos.width)
    el.style.height = em(o.pos.height)
  } else {
    el = h('div', 'ho')
    el.style.width = em(o.pos.width)
    el.style.height = em(o.pos.height)
    if (o.shape === 'line') {
      const svgNs = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(svgNs, 'svg')
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      svg.setAttribute('preserveAspectRatio', 'none')
      svg.setAttribute('viewBox', `0 0 ${Math.max(1, o.pos.width)} ${Math.max(1, o.pos.height)}`)
      svg.style.overflow = 'visible'
      svg.style.position = 'absolute'
      const ln = document.createElementNS(svgNs, 'line')
      ln.setAttribute('x1', '0')
      ln.setAttribute('y1', '0')
      ln.setAttribute('x2', String(o.pos.width))
      ln.setAttribute('y2', String(o.pos.height))
      ln.setAttribute('stroke', o.line.color ?? '#000')
      ln.setAttribute('stroke-width', String(Math.max(20, o.line.width)))
      ln.setAttribute('vector-effect', 'non-scaling-stroke')
      svg.append(ln)
      el.append(svg)
    } else if (o.bin) {
      const url = env.url(o.bin)
      if (url) {
        const img = h('img')
        img.src = url
        img.alt = env.tr('그림', 'Picture')
        img.style.cssText = 'width:100%;height:100%;display:block'
        el.append(img)
      }
    } else {
      if (o.line.color && o.shape !== 'group') el.style.border = `${hairline((o.line.width / 7200) * 25.4)} solid ${o.line.color}`
      if (o.fill && o.shape !== 'group') el.style.background = o.fill
      if (o.shape === 'ellipse') el.style.borderRadius = '50%'
      else if (o.shape === 'rect' && o.round) el.style.borderRadius = `${Math.min(50, o.round)}%`
    }
    if (o.text) {
      const [ml, mr, mt, mb] = o.text.margin
      const inner = h('div', 'ho')
      const contentH = listHeight(o.text.paras)
      const room = o.pos.height - mt - mb
      const off = o.text.vAlign === 'center' ? (room - contentH) / 2 : o.text.vAlign === 'bottom' ? room - contentH : 0
      inner.style.left = em(ml)
      inner.style.top = em(mt + Math.max(0, off))
      inner.style.width = em(Math.max(0, o.pos.width - ml - mr))
      paintList(inner, o.text.paras, o.pos.width - ml - mr, env)
      el.append(inner)
    }
    for (const c of o.children ?? []) placeObj(el, c, c.pos.x, c.pos.y, env)
  }
  if (o.caption && (!rows || rows[1] >= tableGeom(o as Table).rowY.length - 1)) paintCaption(el, o.caption, objWidth(o), height, env)
  return el
}

function placeholderTitle(what: string, env: Env): string {
  switch (what) {
    case 'equation':
      return env.tr('수식', 'Equation')
    case 'chart':
      return env.tr('차트', 'Chart')
    case 'ole':
      return env.tr('OLE 개체', 'OLE object')
    case 'video':
      return env.tr('동영상', 'Video')
    case 'form':
      return env.tr('양식 개체', 'Form control')
    case 'textart':
      return env.tr('글맵시', 'Text art')
    default:
      return env.tr('개체', 'Object')
  }
}

function placeholder(title: string, label: string, _env: Env): HTMLElement {
  const el = h('div', 'hph')
  el.append(h('b', undefined, title))
  if (label) el.append(document.createTextNode(label.length > 160 ? label.slice(0, 160) + '…' : label))
  el.title = label ? `${title}: ${label}` : title
  return el
}

function paintCaption(objEl: HTMLElement, cap: Caption, w: number, hgt: number, env: Env): void {
  const box = h('div', 'ho')
  const cw = cap.side === 'left' || cap.side === 'right' ? cap.width || 8504 : w
  box.style.width = em(cw)
  const ch = listHeight(cap.paras)
  if (cap.side === 'bottom') box.style.top = em(hgt + cap.gap)
  else if (cap.side === 'top') box.style.top = em(-cap.gap - ch)
  else box.style.top = '0'
  if (cap.side === 'left') box.style.left = em(-cap.gap - cw)
  else if (cap.side === 'right') box.style.left = em(w + cap.gap)
  else box.style.left = '0'
  paintList(box, cap.paras, cw, env)
  objEl.style.overflow = 'visible'
  objEl.append(box)
}

function paintTable(t: Table, env: Env, rows?: [number, number]): HTMLElement {
  const g = tableGeom(t)
  const from = rows?.[0] ?? 0
  const to = rows?.[1] ?? g.rowY.length - 1
  const el = h('div', 'ho')
  el.style.width = em(g.width)
  el.style.height = em(g.rowY[to] - g.rowY[from])
  el.setAttribute('role', 'table')
  for (const c of t.cells) {
    const r0 = c.row
    const r1 = Math.min(g.rowY.length - 1, c.row + c.rowSpan)
    if (r1 <= from || r0 >= to) continue
    const top = g.rowY[Math.max(r0, from)] - g.rowY[from]
    const bottom = g.rowY[Math.min(r1, to)] - g.rowY[from]
    const x0 = g.colX[Math.min(c.col, g.colX.length - 1)]
    const x1 = g.colX[Math.min(c.col + c.colSpan, g.colX.length - 1)]
    const cell = h('div', 'hc')
    cell.setAttribute('role', 'cell')
    cell.style.left = em(x0)
    cell.style.top = em(top)
    cell.style.width = em(x1 - x0)
    cell.style.height = em(bottom - top)
    const bf = env.doc.borderFills[c.borderFillId - 1] ?? EMPTY_BORDER_FILL
    fillCss(cell, bf, env)
    // Each shared edge is drawn once (by the cell left of / above it), centred on the edge.
    const bd = h('i', 'hd')
    const lastCol = c.col + c.colSpan >= g.colX.length - 1
    const lastRow = Math.min(r1, to) >= to
    const half = (b: Border) => (b.style === 'none' ? '0' : `calc(${hairline(b.width)} / -2)`)
    bd.style.left = half(bf.left)
    bd.style.top = half(bf.top)
    bd.style.right = lastCol ? half(bf.right) : '0'
    bd.style.bottom = lastRow ? half(bf.bottom) : '0'
    borderCss(bd, 'Left', bf.left)
    borderCss(bd, 'Top', bf.top)
    if (lastCol) borderCss(bd, 'Right', bf.right)
    if (lastRow) borderCss(bd, 'Bottom', bf.bottom)
    if (r0 >= from) {
      const [ml, mr, mt, mb] = c.margin
      const inner = h('div', 'ho')
      const contentH = listHeight(c.paras)
      const room = g.rowY[r1] - g.rowY[r0] - mt - mb
      const off = c.vAlign === 'center' ? (room - contentH) / 2 : c.vAlign === 'bottom' ? room - contentH : 0
      inner.style.left = em(ml)
      inner.style.width = em(Math.max(0, x1 - x0 - ml - mr))
      if (hasLineLayout(c.paras)) inner.style.top = em(mt + Math.max(0, off))
      else {
        // No saved lines: let the browser centre the flowing text in the cell.
        inner.style.top = em(mt)
        inner.style.height = em(Math.max(0, room))
        inner.style.display = 'flex'
        inner.style.flexDirection = 'column'
        inner.style.justifyContent = c.vAlign === 'center' ? 'center' : c.vAlign === 'bottom' ? 'flex-end' : 'flex-start'
      }
      paintList(inner, c.paras, x1 - x0 - ml - mr, env)
      cell.append(inner)
    }
    cell.append(bd)
    el.append(cell)
  }
  return el
}

// ---------------------------------------------------------------- pages

function paintPage(el: HTMLElement, page: Page, env: Env): void {
  env.page = page
  const frag = document.createDocumentFragment()
  const objs = [...page.objs].sort((a, b) => a.obj.pos.z - b.obj.pos.z)
  const behind = objs.filter((o) => o.obj.pos.wrap === 'behind')
  const rest = objs.filter((o) => o.obj.pos.wrap !== 'behind')
  const place = (p: PlacedObj) => placeObj(frag, p.obj, p.x, p.y, env, p.rows)
  if (page.pageFill) {
    const bf = env.doc.borderFills[page.pageFill.id - 1]
    if (bf && (bf.fill || bf.image || bf.gradient)) {
      const bg = h('div', 'ho')
      const b = page.pageFill.area === 'paper' ? { x: 0, y: 0, w: page.width, h: page.height } : page.body
      bg.style.left = em(b.x)
      bg.style.top = em(b.y)
      bg.style.width = em(b.w)
      bg.style.height = em(b.h)
      fillCss(bg, bf, env)
      frag.append(bg)
    }
  }
  for (const m of page.masters ?? []) {
    const box = h('div', 'ho')
    box.style.left = em(page.body.x)
    box.style.top = em(page.body.y)
    box.style.width = em(page.body.w)
    paintList(box, m, page.body.w, env)
    frag.append(box)
  }
  behind.forEach(place)
  if (page.flow) {
    const flow = h('div', 'hp-flow')
    flow.style.left = em(page.body.x)
    flow.style.top = em(page.body.y)
    flow.style.width = em(page.body.w)
    env.flowPage = { page, frag }
    try {
      flow.append(flowParas(page.flow.paras, env))
    } finally {
      env.flowPage = null
    }
    frag.append(flow)
  }
  for (const l of page.lines) paintLine(frag, l.para, l.li, l.x, l.y, env)
  rest.forEach(place)
  const sec = env.doc.sections[page.section]
  if (sec) {
    const p = sec.page
    if (page.header) paintHf(frag, page.header, page.body.x, p.top, page.body.w, p.header, env)
    if (page.footer) paintHf(frag, page.footer, page.body.x, page.height - p.bottom - p.footer, page.body.w, p.footer, env)
    if (page.pageNum) {
      const n = page.pageNum
      const where = n.where
      const top = where >= 1 && where <= 3 ? p.top + p.header / 2 : where === 7 || where === 9 ? p.top + p.header / 2 : page.height - p.bottom - p.footer / 2
      const div = h('div', 'hl' + ([2, 5].includes(where) ? ' c' : [3, 6].includes(where) || (where >= 7 && page.number % 2 === (where <= 8 ? 1 : 0)) ? ' r' : ''))
      div.style.left = em(page.body.x)
      div.style.top = em(top - 500 - ASC)
      div.style.width = em(page.body.w)
      const sp = h('i')
      sp.style.height = em(850 + ASC)
      const t = h('span', 'ht k0', n.dash ? `- ${page.number} -` : String(page.number))
      div.append(sp, t)
      frag.append(div)
    }
  }
  if (page.footnotes.length) paintNotes(frag, page.footnotes, page, env, 'bottom')
  if (page.endnotes.length) paintNotes(frag, page.endnotes, page, env, 'end')
  el.append(frag)
}

function paintHf(parent: DocumentFragment, hf: HeaderFooter, x: number, y: number, w: number, hgt: number, env: Env): void {
  const box = h('div', 'ho')
  box.style.left = em(x)
  box.style.width = em(w)
  const contentH = listHeight(hf.paras)
  // Footers sit at the bottom of their area when their content is shorter than it.
  const top = hf.kind === 'footer' && contentH < hgt ? y + hgt - contentH : y
  box.style.top = em(top)
  paintList(box, hf.paras, w, env)
  parent.append(box)
}

function paintNotes(parent: DocumentFragment, notes: { paras: Para[] }[], page: Page, env: Env, where: 'bottom' | 'end'): void {
  const gap = 283
  const heights = notes.map((n) => Math.max(listHeight(n.paras), 1000))
  const total = heights.reduce((a, b) => a + b, 0) + gap * (notes.length - 1)
  let y: number
  if (where === 'bottom') y = page.body.y + page.body.h - total
  else {
    let bottom = page.body.y
    for (const l of page.lines) bottom = Math.max(bottom, l.y + l.para.lines[l.li].height)
    y = bottom + 1700
  }
  const sep = h('div', 'hp-sep')
  sep.style.left = em(page.body.x)
  sep.style.top = em(y - 567)
  sep.style.width = em(Math.min(page.body.w, 14173))
  parent.append(sep)
  notes.forEach((n, i) => {
    const box = h('div', 'ho')
    box.style.left = em(page.body.x)
    box.style.top = em(y)
    box.style.width = em(page.body.w)
    paintList(box, n.paras, page.body.w, env, true)
    parent.append(box)
    y += heights[i] + gap
  })
}

// ---------------------------------------------------------------- reading (flow) view

function lineHeightCss(ps: ParaShape | undefined): string {
  if (!ps) return '1.6'
  const v = ps.lineSpacing
  switch (ps.lineSpacingType) {
    case 'fixed':
      return v > 0 ? em(v) : '1.6'
    case 'space':
      return `calc(1.2em + ${em(Math.max(0, v))})`
    case 'atleast':
      return '1.6'
    default:
      return String(Math.max(0.8, Math.min(5, (v || 160) / 100)))
  }
}

function flowParas(paras: Para[], env: Env): DocumentFragment {
  const frag = document.createDocumentFragment()
  for (const p of paras) {
    const ps = env.doc.paraShapes[p.ps]
    // Floating objects of the paragraph come first: as blocks in the reading view; in a page
    // without saved layout, at their offsets (paper / page objects on the page itself).
    const fp = env.flowPage
    p.ctrls.forEach((c) => {
      if (!c || !(c.kind === 'table' || c.kind === 'picture' || c.kind === 'shape' || c.kind === 'placeholder') || c.pos.inline) return
      if (!fp) {
        frag.append(flowObj(c, env, false))
        return
      }
      const body = fp.page.body
      const w = objWidth(c)
      const hh = objHeight(c)
      if (c.pos.vertRel !== 'para') {
        const at = objPosition(c.pos, w, hh, {
          paper: { x: 0, y: 0, w: fp.page.width, h: fp.page.height },
          page: body,
          column: body,
          para: body
        })
        placeObj(fp.frag, c, at.x, at.y, env)
        return
      }
      const at = objPosition(c.pos, w, hh, {
        paper: { x: -body.x, y: 0, w: fp.page.width, h: fp.page.height },
        page: { ...body, x: 0, y: 0 },
        column: { ...body, x: 0, y: 0 },
        para: { ...body, x: 0, y: 0 }
      })
      if (c.pos.wrap === 'topbottom') {
        // Takes its height in the text flow.
        const holder = h('div')
        holder.style.cssText = `position:relative;height:${em(hh + c.pos.margin[2] + c.pos.margin[3])}`
        placeObj(holder, c, at.x, c.pos.margin[2] + Math.max(0, c.pos.y), env)
        frag.append(holder)
      } else {
        const anchor = h('div')
        anchor.style.cssText = 'position:relative;height:0'
        placeObj(anchor, c, at.x, at.y, env)
        frag.append(anchor)
      }
    })
    const div = h('div', 'hr-p')
    const st = div.style
    if (ps) {
      if (ps.left > 0) st.marginLeft = em(ps.left)
      if (ps.right > 0) st.marginRight = em(ps.right)
      if (ps.indent < 0) {
        st.paddingLeft = em(-ps.indent)
        st.textIndent = em(ps.indent)
      } else if (ps.indent > 0) st.textIndent = em(ps.indent)
      if (ps.before > 0) st.marginTop = em(ps.before)
      if (ps.after > 0) st.marginBottom = em(ps.after)
      st.lineHeight = lineHeightCss(ps)
      const a = ps.align
      if (a === 'center' || a === 'right') st.textAlign = a
      else if (a === 'justify' || a === 'distribute' || a === 'divide') st.textAlign = 'justify'
    }
    const pre = env.layout.prefixes.get(p)
    if (pre) div.append(h('span', `k${p.runs[0]?.cs ?? 0}`, pre + ' '))
    // An empty paragraph keeps the height of its character size.
    div.classList.toggle('e', !p.text.replace(/￼/g, '').trim())
    if (div.classList.contains('e')) div.append(h('span', `k${p.runs[0]?.cs ?? 0}`, '​'))
    appendRange(div, p, 0, p.text.length, env, { inNote: false, flow: true })
    frag.append(div)
  }
  return frag
}

function flowObj(o: Obj, env: Env, inline: boolean): HTMLElement {
  if (o.kind === 'table') {
    const wrap = h(inline ? 'span' : 'div', 'hr-tw')
    if (inline) wrap.style.display = 'block'
    const g = tableGeom(o)
    const t = h('table', 'hr-t')
    t.style.width = em(g.width)
    // Narrow tables shrink to the screen; wide ones keep their widths and scroll sideways.
    const fitWidth = g.colX.length - 1 <= 5
    if (fitWidth) t.style.maxWidth = '100%'
    const cg = h('colgroup')
    for (let i = 0; i + 1 < g.colX.length; i++) {
      const col = h('col')
      const w = g.colX[i + 1] - g.colX[i]
      col.style.width = fitWidth && g.width > 0 ? `${((w / g.width) * 100).toFixed(3)}%` : em(w)
      cg.append(col)
    }
    t.append(cg)
    const rows = g.rowY.length - 1
    for (let r = 0; r < rows; r++) {
      const tr = h('tr')
      for (const c of o.cells.filter((c) => c.row === r).sort((a, b) => a.col - b.col)) {
        const td = h('td', 'hr-c')
        if (c.colSpan > 1) td.colSpan = c.colSpan
        if (c.rowSpan > 1) td.rowSpan = c.rowSpan
        const bf = env.doc.borderFills[c.borderFillId - 1] ?? EMPTY_BORDER_FILL
        borderCss(td, 'Left', bf.left)
        borderCss(td, 'Right', bf.right)
        borderCss(td, 'Top', bf.top)
        borderCss(td, 'Bottom', bf.bottom)
        if (bf.fill) td.style.background = bf.fill
        td.style.padding = `${em(c.margin[2])} ${em(c.margin[1])} ${em(c.margin[3])} ${em(c.margin[0])}`
        td.style.verticalAlign = c.vAlign === 'center' ? 'middle' : c.vAlign
        if (r === c.row) td.style.height = em(Math.min(c.height, g.rowY[Math.min(rows, r + c.rowSpan)] - g.rowY[r]))
        td.append(flowParas(c.paras, env))
        tr.append(td)
      }
      t.append(tr)
    }
    wrap.append(t)
    if (o.caption) wrap.append(flowCaption(o.caption, env))
    return wrap
  }
  if (o.kind === 'picture') {
    const url = env.url(o.bin)
    if (!url) return flowPlaceholder(env.tr('그림', 'Picture'), '', env)
    const img = h('img', 'hr-img')
    img.src = url
    img.alt = env.tr('그림', 'Picture')
    img.loading = 'lazy'
    img.decoding = 'async'
    img.style.width = em(o.pos.width)
    if (inline) img.style.display = 'inline-block'
    if (!o.caption) return img
    const box = h('div')
    box.append(img, flowCaption(o.caption, env))
    return box
  }
  if (o.kind === 'placeholder') return flowPlaceholder(placeholderTitle(o.what, env), o.label, env)
  const box = h('div', 'hr-box')
  if (o.line.color && o.shape !== 'line' && o.shape !== 'group') box.style.border = `${hairline((o.line.width / 7200) * 25.4)} solid ${o.line.color}`
  if (o.fill) box.style.background = o.fill
  if (o.shape === 'ellipse') box.style.borderRadius = '50%'
  box.style.width = em(o.pos.width)
  if (o.text) box.append(flowParas(o.text.paras, env))
  for (const c of o.children ?? []) box.append(flowObj(c, env, false))
  if (o.bin) {
    const url = env.url(o.bin)
    if (url) {
      const img = h('img', 'hr-img')
      img.src = url
      img.alt = env.tr('그림', 'Picture')
      box.append(img)
    }
  }
  if (!o.text && !o.children?.length && !o.bin) {
    // A plain drawing without text: keep its outline at its size.
    box.style.height = em(Math.min(o.pos.height, 30000))
    if (o.shape === 'line') {
      box.style.height = '0'
      box.style.borderTop = `1px solid ${o.line.color ?? '#000'}`
    }
  }
  if (o.caption) box.append(flowCaption(o.caption, env))
  return box
}

function flowCaption(cap: Caption, env: Env): HTMLElement {
  const d = h('div', 'hr-cap')
  d.append(flowParas(cap.paras, env))
  return d
}

function flowPlaceholder(title: string, label: string, _env: Env): HTMLElement {
  const el = h('span', 'hr-ph')
  el.append(h('b', undefined, title + (label ? ': ' : '')))
  if (label) el.append(document.createTextNode(label))
  return el
}

// ---------------------------------------------------------------- render

export interface ViewOptions {
  /** Banner above the pages. */
  note?: string
}

export function renderHangul(ctx: PreviewContext, doc: HangulDoc, opts: ViewOptions = {}): () => void {
  const { root, toolbar, tr, signal } = ctx
  const layout = layoutDoc(doc)
  const pages = layout.pages
  const urls = new Map<string, string | null>()
  const env: Env = {
    doc,
    layout,
    tr,
    page: null,
    totalPages: pages.length,
    fits: [],
    url(bin) {
      if (urls.has(bin)) return urls.get(bin)!
      const item = doc.bin(bin)
      const ok = item && /^image\/(png|jpeg|gif|bmp|webp|svg\+xml)$/.test(item.mime)
      const u = ok ? objectUrl(item.bytes, item.mime, signal) : null
      urls.set(bin, u)
      return u
    }
  }

  const style = h('style', undefined, STYLE + '\n' + charCss(doc.charShapes))
  const wrap = h('div', 'fp-hwp')
  const pagesBox = h('div')
  const readBox = h('div')
  wrap.append(pagesBox, readBox)
  const empty = isEmptyDoc(doc)
  const noteText = [opts.note, empty ? tr('내용이 없는 빈 문서입니다.', 'This document is empty.') : ''].filter(Boolean).join(' ')
  const banner = noteText ? h('div', 'fp-hwp-note', noteText) : null

  // Page shells with their final size, painted on demand.
  const shells = pages.map((p, i) => {
    const el = h('div', 'hp-page fp-page')
    el.setAttribute('data-fp-page', String(i + 1))
    el.style.width = em(p.width)
    // A page without saved layout grows with its flowing text.
    if (p.flow) el.style.minHeight = em(p.height)
    else el.style.height = em(p.height)
    el.setAttribute('role', 'document')
    el.setAttribute('aria-label', `${tr('쪽', 'Page')} ${i + 1}`)
    return el
  })
  const painted = new Uint8Array(pages.length)
  pagesBox.append(...shells)

  let scale = 1
  let reading = false
  let readBuilt = false
  const basePx = () => BASE_PX * scale
  const paint = (idx: number[]) => {
    env.fits = []
    for (const i of idx) {
      if (painted[i]) continue
      painted[i] = 1
      try {
        paintPage(shells[i], pages[i], env)
      } catch (e) {
        console.warn('hwp: page paint failed', e)
      }
    }
    fitLines(env.fits, basePx())
    env.fits = []
  }
  /** Pages in or near the viewport, from their geometry (no IntersectionObserver). */
  const check = () => {
    if (reading || signal.aborted) return
    const top = root.scrollTop
    const bottom = top + root.clientHeight
    const margin = root.clientHeight * 0.75 + 200
    const need: number[] = []
    let lo = 0
    let hi = shells.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const el = shells[mid]
      if (el.offsetTop + el.offsetHeight < top - margin) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < shells.length; i++) {
      const el = shells[i]
      if (el.offsetTop > bottom + margin) break
      if (!painted[i]) need.push(i)
    }
    if (need.length) paint(need)
  }

  // Background: paint the rest a page at a time so search and printing see everything.
  let timer = 0
  const idle = () => {
    if (signal.aborted) return
    if (!reading) {
      const next = painted.indexOf(0)
      if (next < 0) return
      paint([next])
    }
    timer = window.setTimeout(idle, 60)
  }

  const buildReading = () => {
    if (readBuilt) return
    readBuilt = true
    doc.sections.forEach((sec) => {
      const box = h('div', 'hr-sec')
      env.page = pages.find((p) => p.section === doc.sections.indexOf(sec)) ?? null
      const chunks: Para[][] = [[]]
      for (const p of sec.paras) {
        if (p.pageBreak && chunks[chunks.length - 1].length) chunks.push([])
        chunks[chunks.length - 1].push(p)
      }
      const hf = (kind: 'header' | 'footer') => {
        for (const p of sec.paras) for (const c of p.ctrls) if (c && c.kind === kind && c.paras.some((q) => visibleText(q))) return c
        return null
      }
      const head = hf('header')
      if (head && head.kind === 'header') {
        const d = h('div', 'hr-hf')
        d.append(flowParas(head.paras, env))
        box.append(d)
      }
      for (const m of sec.masters ?? []) {
        if (!m.some(visibleText)) continue
        const d = h('div', 'hr-hf')
        d.append(flowParas(m, env))
        box.append(d)
      }
      chunks.forEach((ch, i) => {
        if (i) box.append(h('hr', 'hr-pb'))
        box.append(flowParas(ch, env))
      })
      const foot = hf('footer')
      if (foot && foot.kind === 'footer') {
        const d = h('div', 'hr-hf f')
        d.append(flowParas(foot.paras, env))
        box.append(d)
      }
      // Footnotes and endnotes of the section at its end.
      const notes: { n: number; paras: Para[] }[] = []
      for (const p of sec.paras) for (const c of p.ctrls) if (c && (c.kind === 'footnote' || c.kind === 'endnote')) notes.push({ n: c.number, paras: c.paras })
      if (notes.length) {
        const nb = h('div', 'hr-notes')
        for (const n of notes) {
          const d = h('div')
          for (const p of n.paras) {
            const line = h('div', 'hr-p')
            appendRange(line, p, 0, p.text.length, env, { inNote: true, flow: true })
            d.append(line)
          }
          nb.append(d)
        }
        box.append(nb)
      }
      readBox.append(box)
    })
  }

  const naturalWidth = () => Math.max(...pages.map((p) => p.width)) / 1000 * BASE_PX + 24
  const fit = () => (reading ? 1 : clampZoom((root.clientWidth - 8) / naturalWidth(), 0.2, 4))
  const zoom = createZoom(
    1,
    (s) => {
      const ratio = root.scrollHeight > 0 ? root.scrollTop / root.scrollHeight : 0
      scale = s
      wrap.style.fontSize = `${BASE_PX * s}px`
      root.scrollTop = ratio * root.scrollHeight
      check()
    },
    fit,
    { min: 0.2, max: 5 }
  )
  wrap.style.fontSize = `${BASE_PX}px`

  const readBtn = toolbar.button({
    label: tr('읽기', 'Reading'),
    title: tr('읽기 모드: 화면 폭에 맞춰 줄바꿈', 'Reading layout: text wraps to the screen'),
    onClick: () => setMode(true)
  })
  const pageBtn = toolbar.button({
    label: tr('페이지', 'Page'),
    title: tr('페이지 모드: 한글과 같은 쪽 배치', 'Page layout: pages as Hangul lays them out'),
    onClick: () => setMode(false)
  })
  const count = pages.length
  const info = [doc.format === 'HWP' ? `HWP ${doc.version}` : 'HWPX', `${count.toLocaleString()} ${tr('쪽', count === 1 ? 'page' : 'pages')}`]
  if (doc.notes.includes('equation')) info.push(tr('수식은 자리 표시', 'equations as placeholders'))
  toolbar.info(info.join(' · '))
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)

  const setMode = (next: boolean) => {
    reading = next
    readBtn.setAttribute('aria-pressed', String(reading))
    pageBtn.setAttribute('aria-pressed', String(!reading))
    wrap.classList.toggle('reading', reading)
    if (reading) buildReading()
    pagesBox.style.display = reading ? 'none' : ''
    readBox.style.display = reading ? '' : 'none'
    if (reading) zoom.set(1)
    else if (root.clientWidth < naturalWidth()) zoom.set(fit())
    else zoom.set(1)
    root.scrollTo(0, 0)
    check()
  }

  root.replaceChildren(style, ...(banner ? [banner] : []), wrap)
  root.addEventListener('scroll', check, { passive: true, signal })
  window.addEventListener('resize', check, { signal })
  setMode(ctx.compact)
  if (!reading) check()
  timer = window.setTimeout(idle, 250)
  return () => window.clearTimeout(timer)
}

const visibleText = (p: Para): boolean => !!p.text.replace(/￼/g, '').trim()

/** No text, objects, headers or master pages anywhere. */
function isEmptyDoc(doc: HangulDoc): boolean {
  for (const s of doc.sections) {
    if (s.masters?.some((m) => m.some(visibleText))) return false
    for (const p of s.paras) {
      if (visibleText(p)) return false
      for (const c of p.ctrls) {
        if (!c) continue
        if (c.kind === 'table' || c.kind === 'picture' || c.kind === 'shape' || c.kind === 'placeholder') return false
        if ((c.kind === 'header' || c.kind === 'footer' || c.kind === 'footnote' || c.kind === 'endnote') && c.paras.some(visibleText)) return false
      }
    }
  }
  return true
}

export { ctrlIndex }
