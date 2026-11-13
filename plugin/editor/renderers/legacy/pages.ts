/** Page layout for binary Word documents: every page is a box of the physical page size
 *  (1 pt = 96/72 CSS px at 100 %) with the text laid out inside its margins, paginated by measured
 *  height the way Word does (space before/after, single / multiple / exact / at-least line spacing,
 *  indents, keep with next, widow control, table rows, page and section breaks, headers, footers).
 *  Pages after the first screens are laid out in the background without requestAnimationFrame. */
import type { PreviewContext } from '../../core/types.ts'
import { bindZoomGestures, clampZoom, createZoom, h, objectUrl } from '../../core/ui.ts'
import type { Block, DocModel, PageFmt, Paragraph, RowFmt, Run, Table } from './model.ts'

const PX = 96 / 72

const STYLE = `
.fp-pages { padding: 16px 12px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.fp-pages .fp-page { position: relative; flex: none; margin: 0; background: #fff; color: #000; overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.fp-pages .fp-body, .fp-pages .fp-hdr, .fp-pages .fp-ftr { position: absolute; }
.fp-pages .fp-ftr { display: flex; flex-direction: column; justify-content: flex-end; }
.fp-pages .wp { margin: 0; white-space: pre-wrap; overflow-wrap: break-word; font-kerning: none; font-variant-ligatures: none;
  tab-size: 48px; box-sizing: border-box; }
.fp-pages .wp > .wl { position: relative; }
.fp-pages .wt { border-collapse: collapse; table-layout: fixed; }
.fp-pages .wt td { vertical-align: top; box-sizing: border-box; overflow: hidden; }
.fp-pages img { vertical-align: bottom; }
.fp-pages .gb { position: absolute; left: 100000px; color: transparent; pointer-events: none; user-select: none; }
.fp-pages .obj { display: inline-block; padding: 0 .4em; border: 1px dashed #999; color: #666; font-size: .85em; }
.fp-pages .sect { margin: 12pt 0 6pt; padding-top: 6pt; border-top: 1px solid #ccc; color: #555; font: 600 10pt/1.3 "Segoe UI", system-ui, sans-serif; }
.fp-pages-note { align-self: stretch; max-width: 100%; padding: 6px 10px; border-radius: var(--orca-radius, 6px); box-sizing: border-box;
  background: var(--orca-muted, #f4f4f5); color: var(--orca-foreground, #111); font-size: 12px; }
`

/** Korean font names as stored in documents, and fallbacks with similar metrics on other systems. */
const FONT_ALIASES: Record<string, string[]> = {
  '맑은 고딕': ['Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', 'NanumGothic'],
  'malgun gothic': ['맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans KR', 'NanumGothic'],
  '바탕': ['Batang', 'AppleMyungjo', 'Noto Serif KR', 'NanumMyeongjo'],
  batang: ['바탕', 'AppleMyungjo', 'Noto Serif KR', 'NanumMyeongjo'],
  '바탕체': ['BatangChe', 'Batang', 'Noto Serif KR'],
  '굴림': ['Gulim', 'Apple SD Gothic Neo', 'Noto Sans KR'],
  gulim: ['굴림', 'Apple SD Gothic Neo', 'Noto Sans KR'],
  '굴림체': ['GulimChe', 'Gulim', 'Noto Sans KR'],
  '돋움': ['Dotum', 'Apple SD Gothic Neo', 'Noto Sans KR'],
  dotum: ['돋움', 'Apple SD Gothic Neo', 'Noto Sans KR'],
  '돋움체': ['DotumChe', 'Dotum', 'Noto Sans KR'],
  '궁서': ['Gungsuh', 'Noto Serif KR'],
  'times new roman': ['Times', 'Liberation Serif', 'Tinos'],
  arial: ['Helvetica', 'Liberation Sans', 'Arimo'],
  calibri: ['Carlito'],
  cambria: ['Caladea'],
  'courier new': ['Courier', 'Liberation Mono', 'Cousine']
}
const GENERIC_SERIF = /times|roman|serif|batang|바탕|myeongjo|명조|cambria|georgia|garamond|book|century|minion|palatino|gungsuh|궁서/i
const CJK = /[\u1100-\u11ff\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u3130-\u318f\u3200-\u32ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/
const CJK_RUNS = /([\u1100-\u11ff\u2e80-\u2fdf\u3000-\u303f\u3040-\u30ff\u3130-\u318f\u3200-\u32ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]+)/

/** Word's single line height and descent per em for common fonts: single = max(win ascent + win
 *  descent, hhea ascent + descent + line gap); the baseline sits at single - descent from the line top. */
const WORD_METRICS: Record<string, [number, number]> = {
  'times new roman': [1.1499, 0.2163],
  arial: [1.1499, 0.2119],
  'arial narrow': [1.1499, 0.2119],
  calibri: [1.2207, 0.2686],
  'calibri light': [1.2207, 0.2686],
  cambria: [1.1724, 0.2222],
  verdana: [1.2153, 0.21],
  tahoma: [1.207, 0.2065],
  'segoe ui': [1.3301, 0.251],
  georgia: [1.1362, 0.2192],
  'courier new': [1.1328, 0.3003],
  'trebuchet ms': [1.1621, 0.2207],
  symbol: [1.2649, 0.2197],
  wingdings: [1.1, 0.21],
  '맑은 고딕': [1.733, 0.44],
  'malgun gothic': [1.733, 0.44],
  '바탕': [1.2925, 0.2225],
  batang: [1.2925, 0.2225],
  '바탕체': [1.2925, 0.2225],
  batangche: [1.2925, 0.2225]
}

/** Extra width Word gives a space after East Asian text, in em (measured against Word 2021). */
const CJK_SPACE = 0.167

const KOREAN_FACE = /맑은|malgun|바탕|batang|굴림|gulim|돋움|dotum|궁서|gungsuh|나눔|nanum|apple sd|noto (sans|serif) (kr|cjk)|한컴|함초롬|hcr|휴먼|hy|korean|gothic neo/i
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/
/** The face Word uses for East Asian text: Hangul in a font without Hangul (Japanese / Chinese
 *  faces such as MS Mincho) falls back to Malgun Gothic, as on Korean Windows. */
export function eaFace(ea: string | undefined, text: string): string | undefined {
  if (!ea) return HANGUL.test(text) ? '맑은 고딕' : undefined
  if (HANGUL.test(text) && !KOREAN_FACE.test(ea)) return '맑은 고딕'
  return ea
}
/** A space that follows Hangul is drawn wider by Word when the run's Latin font is a Korean face. */
function koreanLatin(font: string | undefined): boolean {
  return !!font && KOREAN_FACE.test(font)
}

const q = (name: string) => `"${name.replace(/["\\]/g, '')}"`
const stackCache = new Map<string, string>()
/** CSS font-family for a document font: the face, its aliases, Korean fallbacks, then a generic. */
export function fontStack(font: string | undefined, ea?: string): string {
  const key = `${font ?? ''}|${ea ?? ''}`
  let s = stackCache.get(key)
  if (s) return s
  const names: string[] = []
  const add = (n: string | undefined) => {
    if (!n) return
    if (!names.includes(n)) names.push(n)
    for (const a of FONT_ALIASES[n.toLowerCase()] ?? FONT_ALIASES[n] ?? []) if (!names.includes(a)) names.push(a)
  }
  add(font)
  add(ea)
  const serif = GENERIC_SERIF.test(font ?? ea ?? '')
  for (const k of serif ? ['Batang', '바탕', 'AppleMyungjo', 'Noto Serif KR'] : ['Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans KR', 'NanumGothic'])
    if (!names.includes(k)) names.push(k)
  s = names.map(q).join(', ') + (serif ? ', serif' : ', sans-serif')
  stackCache.set(key, s)
  return s
}

/** An invisible zero-width mark after a text group that Word draws apart from what follows on the
 *  same line (table cells, text after a wide tab). Reading tools that rebuild lines from glyph
 *  positions (like PDF text extraction) then see separate groups, as in Word's own output. */
function groupBreak(): HTMLElement {
  const m = document.createElement('span')
  m.className = 'gb'
  m.textContent = '\u200b'
  m.setAttribute('aria-hidden', 'true')
  return m
}

/** The first run of a list paragraph is its number or bullet (set by the reader). */
function isLabel(p: Paragraph): boolean {
  return p.runs[0]?.labelWidth != null
}

let measureCtx: CanvasRenderingContext2D | null = null
/** Width of a run's text in points (canvas measurement with the run's font). */
function textWidth(r: Run, f: { markPt: number }): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  const size = (r.pt ?? f.markPt) * PX
  if (!measureCtx) return r.text.length * size * 0.5 / PX
  measureCtx.font = `${r.i ? 'italic ' : ''}${r.b ? '700 ' : ''}${size}px ${fontStack(r.font, r.eaFont)}`
  return measureCtx.measureText(r.text).width / PX
}

interface PageBox {
  el: HTMLElement
  body: HTMLElement
  /** Usable body height in px. */
  limit: number
  fmt: PageFmt
  /** Blocks placed on this page (their elements), for keep-with-next moves. */
  placed: { el: HTMLElement; keepNext: boolean }[]
}

export interface PagesOptions {
  note?: string
}

const DEFAULT_PAGE: PageFmt = { w: 595.3, h: 841.9, top: 72, bottom: 72, left: 72, right: 72, header: 36, footer: 36, columns: 1, colSpace: 36, newPage: true, linePitch: 0 }

export function renderPages(ctx: PreviewContext, model: DocModel, opts: PagesOptions = {}): () => void {
  const { root, toolbar, tr, signal } = ctx
  const wrap = h('div', 'fp-pages')
  const style = h('style', undefined, STYLE)
  if (opts.note) wrap.append(h('div', 'fp-pages-note', opts.note))
  root.replaceChildren(style, wrap)

  // ---- line metrics -----------------------------------------------------------------------
  const probe = h('div')
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;line-height:100px;height:100px'
  const probeText = h('span')
  const marker = h('span')
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
  probe.append(probeText, marker)
  wrap.append(probe)
  const chromeCache = new Map<string, { half: number; normal: number; descent: number }>()
  /** Chrome's own metrics for a CSS font: baseline offset from the middle of a line box
   *  ((ascent - descent) / 2), its 'normal' line height and descent, in px. */
  const chrome = (family: string, sizePx: number, cjk: boolean) => {
    const key = `${family}|${sizePx}|${cjk}`
    let v = chromeCache.get(key)
    if (v) return v
    probe.style.fontFamily = family
    probe.style.fontSize = `${sizePx}px`
    probeText.textContent = cjk ? 'Xg한' : 'Xg'
    probe.style.lineHeight = '100px'
    const base = marker.offsetTop
    const half = base - 50
    probe.style.lineHeight = 'normal'
    probe.style.height = 'auto'
    const normal = probe.getBoundingClientRect().height / (scale || 1) || sizePx * 1.2
    const content = probeText.getBoundingClientRect().height / (scale || 1) || sizePx * 1.15
    probe.style.height = '100px'
    // content = ascent + descent, half = (ascent - descent) / 2
    const descent = content / 2 - half
    v = { half, normal, descent }
    chromeCache.set(key, v)
    return v
  }
  /** Word's single line height and descent for a run, in px. */
  const wordMetrics = (font: string | undefined, family: string, sizePx: number, cjk: boolean) => {
    const m = font ? WORD_METRICS[font.toLowerCase()] : undefined
    if (m) return { single: m[0] * sizePx, descent: m[1] * sizePx }
    const c = chrome(family, sizePx, cjk)
    return { single: c.normal, descent: c.descent }
  }

  // ---- elements ---------------------------------------------------------------------------
  const runEls = (r: Run, para: Paragraph): Node[] => {
    if (r.image) {
      const img = h('img')
      img.alt = tr('그림', 'Picture')
      img.src = objectUrl(r.image.bytes, r.image.mime, signal)
      if (r.image.width) img.style.width = `${r.image.width}px`
      if (r.image.height) img.style.height = `${r.image.height}px`
      img.style.maxWidth = '100%'
      return [img]
    }
    if (r.object) return [h('span', 'obj', r.object === 'OLE' ? tr('[개체]', '[Object]') : tr('[그림]', '[Picture]'))]
    const out: Node[] = []
    // Word widens a space that follows East Asian text (to about half an em): give those spaces
    // their own piece with extra word spacing.
    const parts: { text: string; cjk: boolean; wide?: boolean }[] = []
    r.text.split(CJK_RUNS).forEach((t, k) => {
      if (!t) return
      const cjk = k % 2 === 1
      if (!cjk && t[0] === ' ' && parts.length && parts[parts.length - 1].cjk && koreanLatin(r.font ?? r.eaFont)) {
        parts.push({ text: ' ', cjk: false, wide: true })
        t = t.slice(1)
        if (!t) return
      }
      parts.push({ text: t, cjk })
    })
    for (const part of parts) {
      const text = part.text
      const cjk = part.cjk
      const el = h(r.sup ? 'sup' : r.sub ? 'sub' : 'span', undefined, text)
      if (part.wide) el.style.wordSpacing = `${CJK_SPACE}em`

      const st = el.style
      st.fontFamily = cjk ? fontStack(eaFace(r.eaFont ?? r.font, text), r.font) : fontStack(r.font ?? para.fmt?.markFont, r.eaFont)
      if (r.pt) st.fontSize = `${r.pt * PX}px`
      if (r.b) st.fontWeight = '700'
      if (r.i) st.fontStyle = 'italic'
      if (r.u || r.s) st.textDecoration = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].join(' ').trim()
      if (r.color) st.color = r.color
      if (r.bg) st.background = r.bg
      if (r.caps) st.textTransform = 'uppercase'
      if (r.smallCaps) st.fontVariant = 'small-caps'
      if (r.spacing) st.letterSpacing = `${r.spacing * PX}px`
      if (r.sup || r.sub) {
        st.fontSize = `${(r.pt ?? 10) * PX * 0.65}px`
        st.lineHeight = '0'
      }
      out.push(el)
    }
    return out
  }

  /** Runs with tab characters: each tab becomes a spacer that reaches the next tab stop (custom
   *  stops from the paragraph, the hanging indent, then default stops every 36 pt), with left,
   *  center and right alignment. Widths come from canvas measurement in the runs' fonts. */
  const tabbed = (runs: Run[], p: Paragraph, label: Run | null): Node[] => {
    const f = p.fmt!
    const pieces: { run: Run; text: string }[][] = [[]]
    for (const r of runs) {
      const parts = r.text.split('\t')
      parts.forEach((t, k) => {
        if (k > 0) pieces.push([])
        if (t) pieces[pieces.length - 1].push({ run: r, text: t })
      })
    }
    const width = (seg: { run: Run; text: string }[]) => seg.reduce((w, x) => w + textWidth({ ...x.run, text: x.text }, f), 0)
    const out: Node[] = []
    let x = f.left + f.first + (label ? 0 : 0)
    if (label) x = f.left + f.first + textWidth(label, f)
    pieces.forEach((seg, k) => {
      if (k > 0) {
        const w = width(seg)
        const sizePt = seg[0]?.run.pt ?? f.markPt
        let stop = f.tabs.find((t) => t.pos > x + 0.5)
        if (!stop && f.first < 0 && x < f.left - 0.5) stop = { pos: f.left, jc: 0 }
        const pos = stop ? stop.pos : Math.floor(x / 36 + 1) * 36
        const jc = stop?.jc ?? 0
        let gap = pos - x
        if (jc === 1) gap -= w / 2
        else if (jc === 2 || jc === 3) gap -= w
        gap = Math.max(gap, 0)
        const sp = h('span')
        sp.style.cssText = `display:inline-block;width:${gap * PX}px`
        out.push(sp)
        if (gap > sizePt) out.push(groupBreak())
        x += gap
      }
      for (const piece of seg) out.push(...runEls({ ...piece.run, text: piece.text }, p))
      x += width(seg)
    })
    return out
  }

  /** A paragraph element: outer box carries spacing and indents, the inner line box carries text. */
  const paraEl = (p: Paragraph, prevStyle: number | null): HTMLElement => {
    const f = p.fmt
    const el = h('div', 'wp')
    const inner = h('div', 'wl')
    const label = p.fmt && isLabel(p) ? p.runs[0] : null
    const body = label ? p.runs.slice(1) : p.runs
    if (p.fmt && body.some((r) => r.text.includes('\t'))) inner.append(...tabbed(body, p, label))
    else for (const r of body) inner.append(...runEls(r, p))
    const markPt = f?.markPt ?? p.runs.find((r) => r.pt)?.pt ?? 10
    const sizes = p.runs.filter((r) => r.text && !r.image).map((r) => r.pt ?? markPt)
    const maxPt = sizes.length ? Math.max(...sizes) : markPt
    const text = p.runs.map((r) => r.text).join('')
    if (!text.length || /^\s*$/.test(text) && !p.runs.some((r) => r.image)) {
      const z = h('span', undefined, '\u200b')
      z.style.fontFamily = fontStack(f?.markFont, f?.markEaFont)
      z.style.fontSize = `${markPt * PX}px`
      inner.append(z)
    }
    let labelEl: HTMLElement | null = null
    let labelFirst = false
    const st = el.style
    const baseFont = p.runs.find((r) => r.text.trim())?.font ?? f?.markFont
    const baseEa = p.runs.find((r) => r.text.trim())?.eaFont ?? f?.markEaFont
    st.fontFamily = fontStack(baseFont, baseEa)
    st.fontSize = `${maxPt * PX}px`
    if (p.align && p.align !== 'left') st.textAlign = p.align
    if (f) {
      const sameStyleGap = f.contextual && prevStyle === f.style
      if (f.before && !sameStyleGap) st.paddingTop = `${f.before * PX}px`
      if (f.after) st.paddingBottom = `${f.after * PX}px`
      el.dataset.before = String(sameStyleGap ? 0 : f.before)
      el.dataset.after = String(f.after)
      const b = f.borders
      if (b) {
        const ist = inner.style
        const side = (x: { width: number; space: number; color: string } | undefined, name: 'Top' | 'Bottom' | 'Left' | 'Right') => {
          if (!x) return
          ist[`border${name}`] = `${Math.max(1, x.width * PX)}px solid ${x.color}`
          ist[`padding${name}`] = `${x.space * PX}px`
        }
        side(b.top, 'Top')
        side(b.bottom, 'Bottom')
        side(b.left, 'Left')
        side(b.right, 'Right')
      }
      if (f.left) st.marginLeft = `${f.left * PX}px`
      if (f.right) st.marginRight = `${f.right * PX}px`
      if (f.first) st.textIndent = `${f.first * PX}px`
      if (label) {
        // number at left + first; text at the hanging indent, or the next tab stop past the number
        const lw = textWidth(label, f)
        const numberPos = f.left + f.first
        let textPos = label.labelWidth ? f.left : numberPos + lw
        if (label.labelWidth != null && (label.labelWidth === 0 || numberPos + lw > f.left - 0.5)) {
          textPos = Math.max(numberPos + lw, numberPos)
          textPos = Math.ceil((textPos + 0.01) / 36) * 36
        }
        if (label.labelWidth == null) textPos = numberPos + lw
        st.textIndent = `${(textPos - f.left) * PX}px`
        const box = h('span', 'lbl')
        box.append(...runEls({ ...label, labelWidth: undefined }, p))
        box.style.cssText = `position:absolute;top:0;left:${f.first * PX}px;text-indent:0;white-space:pre`
        labelEl = box
        // Word's PDF keeps a number and its text on one text line unless the gap is wide or the
        // bullet comes from a symbol font; reading order follows (it decides how lines are read).
        const gap = textPos - numberPos - lw
        labelFirst = !/^symbol$/i.test(label.symbolFont ?? "") && gap <= (label.pt ?? f.markPt) * 1.0
      }
      // Line height and baseline as Word computes them: the tallest run's single spacing times the
      // rule; Word puts extra leading below the text (multiple) or keeps 20 % below the baseline (exact).
      let one = 0
      let desc = 0
      const consider = (font: string | undefined, fam: string, pt: number, cjk: boolean) => {
        const m = wordMetrics(font, fam, pt * PX, cjk)
        one = Math.max(one, m.single)
        desc = Math.max(desc, m.descent)
      }
      for (const r of p.runs) {
        if (!r.text || r.image) continue
        if (r.symbolFont) {
          consider(r.symbolFont, fontStack(r.symbolFont), r.pt ?? markPt, false)
          continue
        }
        for (const [k, seg] of r.text.split(CJK_RUNS).entries()) {
          if (!seg) continue
          const cjk = k % 2 === 1
          const font = cjk ? eaFace(r.eaFont ?? r.font, seg) : (r.font ?? r.eaFont)
          consider(font, cjk ? fontStack(font, r.font) : fontStack(r.font, r.eaFont), r.pt ?? markPt, cjk)
        }
      }
      if (!one) consider(f.markFont ?? f.markEaFont, fontStack(f.markFont, f.markEaFont), markPt, false)
      let lh = one
      let base = one - desc
      if (f.lineRule === 'auto') lh = one * f.line
      else if (f.lineRule === 'exact') {
        lh = f.line * PX
        base = lh * 0.8
      } else if (f.line * PX > one) {
        lh = f.line * PX
        base = lh - desc
      }
      st.lineHeight = `${lh}px`
      const c = chrome(st.fontFamily, maxPt * PX, CJK.test(text))
      const shift = base - (lh / 2 + c.half)
      if (Math.abs(shift) > 0.05) inner.style.top = `${shift}px`
      el.dataset.lh = String(lh)
    } else st.lineHeight = '1.3'
    if (labelEl) {
      if (labelFirst) inner.prepend(labelEl)
      else inner.append(labelEl)
    }
    el.append(inner)
    return el
  }

  const tableEl = (t: Table, rows: number[]): HTMLElement => {
    const fmt0 = t.rowFmt?.find((r) => r)
    const el = h('table', 'wt')
    const centers = fmt0?.centers
    if (centers && centers.length > 1) {
      el.style.marginLeft = `${centers[0] * PX}px`
      el.style.width = `${(centers[centers.length - 1] - centers[0]) * PX}px`
    } else el.style.width = '100%'
    for (const ri of rows) {
      const row = t.rows[ri]
      const rf = t.rowFmt?.[ri] ?? fmt0
      const tr = h('tr')
      if (rf?.height) tr.style.height = `${Math.abs(rf.height) * PX}px`
      let col = 0
      for (let ci = 0; ci < row.length; ci++) {
        if (rf?.merged[ci]) continue
        const td = h('td')
        let span = 1
        while (rf && ci + span < row.length && rf.merged[ci + span]) span++
        if (span > 1) td.colSpan = span
        if (rf && rf.centers.length > ci + span) td.style.width = `${(rf.centers[ci + span] - rf.centers[ci]) * PX}px`
        if (rf) {
          td.style.padding = `${rf.padTop * PX}px ${rf.padRight * PX}px ${rf.padBottom * PX}px ${rf.padLeft * PX}px`
          const b = rf.borders[ci] ?? [0, 0, 0, 0]
          const side = (w: number) => (w ? `${Math.max(1, w * PX)}px solid #000` : 'none')
          td.style.borderTop = side(b[0])
          td.style.borderLeft = side(b[1])
          td.style.borderBottom = side(b[2])
          td.style.borderRight = side(b[3])
        } else td.style.padding = `0 ${5.4 * PX}px`
        let prev: number | null = null
        for (const cb of row[ci]) {
          if (cb.kind === 'p') {
            td.append(paraEl(cb, prev))
            prev = cb.fmt?.style ?? null
          } else if (cb.kind === 'table') td.append(tableEl(cb, cb.rows.map((_, k) => k)))
        }
        const lastP = td.querySelector(':scope > .wp:last-child > .wl')
        if (lastP) lastP.append(groupBreak())
        tr.append(td)
        col += span
      }
      el.append(tr)
    }
    return el
  }

  // ---- pages ------------------------------------------------------------------------------
  const pages: PageBox[] = []
  let fmt: PageFmt = DEFAULT_PAGE
  let header: Block[] | undefined
  let footer: Block[] | undefined
  const hfEl = (blocks: Block[]): HTMLElement[] => {
    const out: HTMLElement[] = []
    let prev: number | null = null
    for (const b of blocks) {
      if (b.kind === 'p') {
        out.push(paraEl(b, prev))
        prev = b.fmt?.style ?? null
      } else if (b.kind === 'table') out.push(tableEl(b, b.rows.map((_, k) => k)))
    }
    return out
  }
  const newPage = (): PageBox => {
    const f = fmt
    const el = h('div', 'fp-page')
    el.dataset.fpPage = String(pages.length + 1)
    el.setAttribute('role', 'document')
    el.setAttribute('aria-label', `${tr('쪽', 'Page')} ${pages.length + 1}`)
    el.style.width = `${f.w * PX}px`
    el.style.height = `${f.h * PX}px`
    const body = h('div', 'fp-body')
    body.style.left = `${f.left * PX}px`
    body.style.top = `${f.top * PX}px`
    body.style.width = `${Math.max(36, f.w - f.left - f.right) * PX}px`
    el.append(body)
    if (header) {
      const hd = h('div', 'fp-hdr')
      hd.style.left = `${f.left * PX}px`
      hd.style.top = `${f.header * PX}px`
      hd.style.width = `${Math.max(36, f.w - f.left - f.right) * PX}px`
      hd.append(...hfEl(header))
      el.append(hd)
    }
    if (footer) {
      const fd = h('div', 'fp-ftr')
      fd.style.left = `${f.left * PX}px`
      fd.style.bottom = `${f.footer * PX}px`
      fd.style.width = `${Math.max(36, f.w - f.left - f.right) * PX}px`
      fd.append(...hfEl(footer))
      el.append(fd)
    }
    wrap.append(el)
    const box: PageBox = { el, body, limit: Math.max(36, f.h - f.top - f.bottom) * PX, fmt: f, placed: [] }
    pages.push(box)
    return box
  }
  let page = newPage()
  let prevStyle: number | null = null

  const bottomOf = (b: PageBox) => {
    const last = b.body.lastElementChild as HTMLElement | null
    if (!last) return 0
    const after = last.classList.contains('wp') ? parseFloat(last.style.paddingBottom) || 0 : 0
    return last.offsetTop + last.offsetHeight - after
  }
  const fits = (b: PageBox) => bottomOf(b) <= b.limit + 0.5

  /** Moves `el` (and keep-with-next predecessors) to a fresh page. */
  const moveToNewPage = (el: HTMLElement, keepNext: boolean) => {
    const from = page
    const moving: { el: HTMLElement; keepNext: boolean }[] = [{ el, keepNext }]
    // pull back chained keep-with-next paragraphs (never empty the page)
    while (from.placed.length > 1 && from.placed[from.placed.length - 1].keepNext && moving.length < 6) {
      moving.unshift(from.placed.pop()!)
    }
    page = newPage()
    for (const m of moving) {
      page.body.append(m.el)
      page.placed.push(m)
    }
  }

  /** Splits a paragraph element at the first line that ends below `limit` (px from the body top).
   *  Returns the remainder element, or null when no split is possible. */
  const splitPara = (el: HTMLElement, limit: number, widow: boolean): HTMLElement | null => {
    const inner = el.firstElementChild as HTMLElement
    if (!inner) return null
    // client rects are zoomed; offsets and `limit` are not
    const z = scale || 1
    const bodyTop = el.getBoundingClientRect().top - el.offsetTop * z
    limit *= z
    // line boxes from the text
    const range = document.createRange()
    range.selectNodeContents(inner)
    const tops: number[] = []
    for (const r of range.getClientRects()) {
      if (r.height <= 0) continue
      const t = Math.round(r.top - bodyTop)
      if (!tops.some((x) => Math.abs(x - t) < 2)) tops.push(t)
    }
    tops.sort((a, b) => a - b)
    if (tops.length < 2) return null
    const lh = (Number(el.dataset.lh) || (tops[1] - tops[0]) / z) * z
    // number of lines that fit
    let fit = 0
    for (let k = 0; k < tops.length; k++) if (tops[k] + lh <= limit + 0.5) fit = k + 1
    if (widow) {
      if (fit === tops.length - 1) fit--
      if (fit < 2) return null
    } else if (fit < 1) return null
    if (fit >= tops.length) return null
    const cutTop = tops[fit]
    // first character on line `fit`
    const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT)
    const cr = document.createRange()
    let node: Text | null = null
    let offset = 0
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const len = n.length
      if (!len) continue
      cr.setStart(n, len - 1)
      cr.setEnd(n, len)
      const lastRect = cr.getClientRects()[0]
      if (!lastRect || lastRect.top - bodyTop < cutTop - 1) continue
      let lo = 0
      let hi = len - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        cr.setStart(n, mid)
        cr.setEnd(n, mid + 1)
        const rc = cr.getClientRects()[0]
        if (rc && rc.top - bodyTop >= cutTop - 1) hi = mid
        else lo = mid + 1
      }
      node = n
      offset = lo
      break
    }
    if (!node) return null
    const rest = el.cloneNode(false) as HTMLElement
    const restInner = inner.cloneNode(false) as HTMLElement
    const cut = document.createRange()
    cut.setStart(node, offset)
    cut.setEndAfter(inner.lastChild!)
    restInner.append(cut.extractContents())
    rest.append(restInner)
    // the first part keeps the space before, the rest keeps the space after
    el.style.paddingBottom = '0px'
    rest.style.paddingTop = '0px'
    rest.style.textIndent = '0px'
    return rest
  }

  let prevPara: { el: HTMLElement; style: number; contextual: boolean } | null = null
  const placePara = (p: Paragraph) => {
    const f = p.fmt
    if (f?.pageBreakBefore && page.placed.length) page = newPage()
    let el = paraEl(p, prevStyle)
    if (f && prevPara && prevPara.style === f.style && prevPara.contextual && prevPara.el.isConnected) prevPara.el.style.paddingBottom = '0px'
    // Word separates two paragraphs by the larger of the first one's space after and the second
    // one's space before (not their sum).
    if (f && prevPara && prevPara.el.isConnected && prevPara.el.parentElement === page.body) {
      const prevAfter = parseFloat(prevPara.el.style.paddingBottom) || 0
      const before = (Number(el.dataset.before) || 0) * PX
      el.style.paddingTop = `${Math.max(0, before - prevAfter)}px`
    }
    prevStyle = f?.style ?? null
    prevPara = f ? { el, style: f.style, contextual: f.contextual } : null
    page.body.append(el)
    page.placed.push({ el, keepNext: !!f?.keepNext })
    for (let guard = 0; guard < 500 && !fits(page); guard++) {
      if (page.placed.length === 1) {
        // first on its page: split it across pages, or leave it overflowing
        const rest = splitPara(el, page.limit - el.offsetTop, !!f?.widow)
        if (!rest) break
        page = newPage()
        page.body.append(rest)
        page.placed.push({ el: rest, keepNext: !!f?.keepNext })
        el = rest
        continue
      }
      const rest = f?.keepLines ? null : splitPara(el, page.limit - el.offsetTop, !!f?.widow)
      if (rest) {
        page = newPage()
        page.body.append(rest)
        page.placed.push({ el: rest, keepNext: !!f?.keepNext })
        el = rest
        continue
      }
      page.placed.pop()
      el.remove()
      moveToNewPage(el, !!f?.keepNext)
    }
  }

  const placeTable = (t: Table) => {
    let start = 0
    const n = t.rows.length
    let guard = 0
    while (start < n && guard++ < 1000) {
      const rows: number[] = []
      for (let k = start; k < n; k++) rows.push(k)
      let el = tableEl(t, rows)
      page.body.append(el)
      page.placed.push({ el, keepNext: false })
      if (fits(page)) return
      // keep the rows that fit; move the rest to the next page
      const trs = [...el.querySelectorAll(':scope > tr, :scope > tbody > tr')] as HTMLElement[]
      let keep = 0
      for (const tr of trs) {
        if (el.offsetTop + tr.offsetTop + tr.offsetHeight <= page.limit + 0.5) keep++
        else break
      }
      if (keep === 0) {
        if (page.placed.length === 1) {
          // a single row taller than the page: leave it
          keep = 1
        } else {
          page.placed.pop()
          el.remove()
          page = newPage()
          continue
        }
      }
      if (keep >= rows.length) return
      page.placed.pop()
      el.remove()
      el = tableEl(t, rows.slice(0, keep))
      page.body.append(el)
      page.placed.push({ el, keepNext: false })
      start += keep
      page = newPage()
    }
  }

  // ---- flow -------------------------------------------------------------------------------
  const blocks = model.blocks
  let next = 0
  let firstSection = true
  const step = (budget: number) => {
    const end = Math.min(blocks.length, next + budget)
    for (; next < end; next++) {
      const b = blocks[next]
      if (b.kind === 'sect') {
        fmt = b.page
        header = b.header
        footer = b.footer
        if (firstSection) {
          // the first page was made before the first section's setup was known
          const old = page
          old.el.remove()
          pages.pop()
          page = newPage()
          firstSection = false
        } else if (b.page.newPage && page.placed.length) page = newPage()
        continue
      }
      if (b.kind === 'break') {
        page = newPage()
        prevStyle = null
        continue
      }
      if (b.kind === 'p') placePara(b)
      else if (b.kind === 'table') placeTable(b)
      else if (b.kind === 'section') {
        const el = h('div', 'sect', b.title === 'footnotes' ? tr('각주', 'Footnotes') : b.title === 'endnotes' ? tr('미주', 'Endnotes') : tr('텍스트 상자', 'Text boxes'))
        page.body.append(el)
        page.placed.push({ el, keepNext: true })
        if (!fits(page)) {
          page.placed.pop()
          el.remove()
          page = newPage()
          page.body.append(el)
          page.placed.push({ el, keepNext: true })
        }
      }
    }
    info()
  }
  const info = () =>
    toolbar.info(
      `${model.variant} · ${pages.length.toLocaleString()}${next < blocks.length ? '+' : ''} ${tr('쪽', pages.length === 1 ? 'page' : 'pages')} · ${(fmt.w / 72 * 25.4).toFixed(0)}×${(fmt.h / 72 * 25.4).toFixed(0)} mm`
    )

  // ---- zoom -------------------------------------------------------------------------------
  let scale = 1
  const widest = () => Math.max(...pages.map((p) => p.fmt.w)) * PX + 24
  const fit = () => clampZoom((root.clientWidth - 8) / widest(), 0.1, 3)
  const zoom = createZoom(
    1,
    (s) => {
      scale = s
      wrap.style.zoom = String(s)
    },
    fit,
    { min: 0.1, max: 5 }
  )
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)

  step(250)
  let timer = 0
  const idle = () => {
    if (signal.aborted || next >= blocks.length) return
    step(120)
    timer = window.setTimeout(idle, 15)
  }
  if (next < blocks.length) timer = window.setTimeout(idle, 50)
  if (root.clientWidth < widest()) zoom.set(fit())
  return () => window.clearTimeout(timer)
}
