/** HWPX (OWPML, KS X 6101) reader: a zip with Contents/header.xml (fonts, char / para properties,
 *  border fills, numbering), Contents/sectionN.xml (paragraphs, runs, tables, drawing objects,
 *  saved line segments) and BinData/. Produces the same HangulDoc model as the HWP 5 reader.
 *  Positions in <hp:lineseg textpos> count characters the way HWP 5 does: a control or tab takes
 *  eight units, other characters one. */
import { strFromU8, unzipSync } from '../../../vendor/zip.js'
import { mimeOf, HangulError } from './hwp5.ts'
import {
  A4,
  borderStyle,
  DEFAULT_CHAR,
  DEFAULT_POS,
  numberStyleFromName,
  type Align,
  type BinItem,
  type Border,
  type BorderFill,
  type Bullet,
  type Caption,
  type Cell,
  type CharShape,
  type Ctrl,
  type HangulDoc,
  type LineSeg,
  type Numbering,
  type Obj,
  type ObjPos,
  type PageDef,
  type Para,
  type ParaShape,
  type Run,
  type Section,
  type Shape
} from './model.ts'
import { find, kid, kids, num, parseXml, text, type XNode } from './xml.ts'

export function isZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)
}

export function readHwpx(bytes: Uint8Array): HangulDoc {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: (f) => !f.name.startsWith('BinData/') && !f.name.startsWith('Preview/') })
  } catch {
    throw new HangulError('damaged', 'zip')
  }
  const str = (name: string): string | null => {
    const f = files[name] ?? files[Object.keys(files).find((k) => k.toLowerCase() === name.toLowerCase()) ?? '']
    return f ? strFromU8(f) : null
  }
  const mimetype = str('mimetype')
  const headerXml = str('Contents/header.xml')
  if (!headerXml && !(mimetype ?? '').includes('hwp')) throw new HangulError('not-hwp', 'not an HWPX package')

  // Manifest: item ids → paths (pictures), spine → section order.
  const items = new Map<string, string>()
  let sectionPaths: string[] = []
  const hpf = str('Contents/content.hpf')
  if (hpf) {
    try {
      const pkg = parseXml(hpf)
      const manifest = find(pkg, 'manifest')
      for (const it of kids(manifest, 'item')) items.set(it.attrs.id ?? '', it.attrs.href ?? '')
      const spine = find(pkg, 'spine')
      for (const ref of kids(spine, 'itemref')) {
        const href = items.get(ref.attrs.idref ?? '')
        if (href && /section\d+\.xml$/i.test(href)) sectionPaths.push(href)
      }
    } catch {
      // fall back to the file names below
    }
  }
  if (!sectionPaths.length) {
    sectionPaths = Object.keys(files)
      .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/i.exec(a)![1]) - Number(/(\d+)\.xml$/i.exec(b)![1]))
  }

  const head = readHeader(headerXml ? safeParse(headerXml) : null)
  const notes = new Set<string>()
  const sections: Section[] = []
  for (const p of sectionPaths) {
    const xml = str(p)
    if (!xml) continue
    const root = safeParse(xml)
    if (!root) continue
    sections.push(
      ...readSectionXml(root, {
        notes,
        master: (id) => {
          const href = items.get(id) ?? `Contents/${id}.xml`
          const mx = str(href)
          const mroot = mx ? safeParse(mx) : null
          return mroot ? readParas(kid(mroot, 'subList') ?? find(mroot, 'subList'), { notes }) : null
        }
      })
    )
  }
  if (!sections.length) throw new HangulError('damaged', 'no sections')

  const cache = new Map<string, BinItem | null>()
  return {
    format: 'HWPX',
    version: '',
    ...head,
    sections,
    notes: [...notes],
    bin(key) {
      if (cache.has(key)) return cache.get(key)!
      const href = items.get(key) ?? (key.includes('/') ? key : '')
      let item: BinItem | null = null
      if (href) {
        try {
          const got = unzipSync(bytes, { filter: (f) => f.name === href })
          const data = got[href]
          if (data) item = { bytes: data, mime: mimeOf(href.split('.').pop() ?? '', data) }
        } catch {
          item = null
        }
      }
      cache.set(key, item)
      return item
    }
  }
}

function safeParse(xml: string): XNode | null {
  try {
    return parseXml(xml)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- header.xml

const LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER']

export interface HeaderInfo {
  charShapes: CharShape[]
  paraShapes: ParaShape[]
  borderFills: BorderFill[]
  numberings: Numbering[]
  bullets: Bullet[]
}

export function readHeader(root: XNode | null): HeaderInfo {
  const out: HeaderInfo = { charShapes: [], paraShapes: [], borderFills: [], numberings: [], bullets: [] }
  if (!root) return out
  const faces: Record<string, string[]> = {}
  const fontfaces = find(root, 'fontfaces')
  for (const ff of kids(fontfaces, 'fontface')) {
    const list: string[] = []
    for (const f of kids(ff, 'font')) list[num(f, 'id')] = f.attrs.face ?? ''
    faces[(ff.attrs.lang ?? '').toUpperCase()] = list
  }
  for (const bf of kids(find(root, 'borderFills'), 'borderFill')) out.borderFills[num(bf, 'id', 1) - 1] = readBorderFillXml(bf)
  for (const cp of kids(find(root, 'charProperties'), 'charPr')) out.charShapes[num(cp, 'id')] = readCharPr(cp, faces)
  for (const pp of kids(find(root, 'paraProperties'), 'paraPr')) out.paraShapes[num(pp, 'id')] = readParaPr(pp)
  for (const nb of kids(find(root, 'numberings'), 'numbering')) {
    const levels: Numbering['levels'] = []
    for (const ph of kids(nb, 'paraHead')) {
      const lv = Math.max(1, num(ph, 'level', 1))
      levels[lv - 1] = { format: text(ph), style: numberStyleFromName(ph.attrs.numFormat), start: num(ph, 'start', 1) }
    }
    for (let i = 0; i < levels.length; i++) levels[i] ??= { format: '', style: 0, start: 1 }
    out.numberings[num(nb, 'id', 1) - 1] = { levels, start: num(nb, 'start', 1) || 1 }
  }
  for (const b of kids(find(root, 'bullets'), 'bullet')) {
    const c = b.attrs.char ?? ''
    out.bullets[num(b, 'id', 1) - 1] = { char: c && c.charCodeAt(0) >= 0xf000 && c.charCodeAt(0) <= 0xf0ff ? '•' : c || '•' }
  }
  // Sparse ids (gaps) get defaults so lookups never hit holes.
  for (let i = 0; i < out.charShapes.length; i++) out.charShapes[i] ??= { ...DEFAULT_CHAR }
  return out
}

/** "0.12 mm" → 0.12 */
function mm(s: string | undefined): number {
  const v = parseFloat(s ?? '')
  return Number.isFinite(v) ? v : 0.12
}

function color(s: string | undefined): string | null {
  if (!s || s === 'none' || s.length < 7) return null
  // #AARRGGBB (alpha first) from some writers: keep the RGB part.
  if (s.length === 9) return '#' + s.slice(3).toLowerCase()
  return s.slice(0, 7).toLowerCase()
}

export function readBorderFillXml(bf: XNode): BorderFill {
  const side = (name: string): Border => {
    const b = kid(bf, name)
    return { style: borderStyle(b?.attrs.type ?? 'NONE'), width: mm(b?.attrs.width), color: color(b?.attrs.color) ?? '#000000' }
  }
  const fb = kid(bf, 'fillBrush')
  const brush = kid(fb, 'winBrush')
  const out: BorderFill = {
    left: side('leftBorder'),
    right: side('rightBorder'),
    top: side('topBorder'),
    bottom: side('bottomBorder'),
    fill: color(brush?.attrs.faceColor)
  }
  const grad = kid(fb, 'gradation')
  if (grad) {
    const colors = kids(grad, 'color').map((c) => color(c.attrs.value)).filter((c): c is string => !!c)
    if (colors.length) out.gradient = { colors, angle: num(grad, 'angle', 0) }
  }
  const img = find(kid(fb, 'imgBrush'), 'img')
  if (img?.attrs.binaryItemIDRef) out.image = img.attrs.binaryItemIDRef
  return out
}

export function readCharPr(cp: XNode, faces: Record<string, string[]>): CharShape {
  const ref = kid(cp, 'fontRef')
  const face = (lang: string) => faces[lang]?.[num(ref, lang.toLowerCase())] ?? ''
  const hangulFace = face('HANGUL') || DEFAULT_CHAR.hangulFace
  const latinFace = face('LATIN') || hangulFace
  const ul = kid(cp, 'underline')?.attrs.type ?? 'NONE'
  const strike = kid(cp, 'strikeout')?.attrs.shape ?? 'NONE'
  return {
    hangulFace,
    latinFace,
    height: num(cp, 'height', 1000) || 1000,
    relSize: num(kid(cp, 'relSz'), 'hangul', 100) || 100,
    spacing: num(kid(cp, 'spacing'), 'hangul', 0),
    ratio: num(kid(cp, 'ratio'), 'hangul', 100) || 100,
    bold: !!kid(cp, 'bold'),
    italic: !!kid(cp, 'italic'),
    underline: ul === 'BOTTOM' ? 'below' : ul === 'TOP' ? 'above' : 'none',
    strike: strike !== 'NONE' && strike !== '3D',
    sup: !!kid(cp, 'supscript'),
    sub: !!kid(cp, 'subscript'),
    color: color(cp.attrs.textColor) ?? '#000000',
    shade: color(cp.attrs.shadeColor),
    underlineColor: color(kid(cp, 'underline')?.attrs.color)
  }
}

const ALIGN_X: Record<string, Align> = {
  JUSTIFY: 'justify',
  LEFT: 'left',
  RIGHT: 'right',
  CENTER: 'center',
  DISTRIBUTE: 'distribute',
  DISTRIBUTE_SPACE: 'divide'
}
const LINE_X: Record<string, ParaShape['lineSpacingType']> = { PERCENT: 'percent', FIXED: 'fixed', BETWEEN_LINES: 'space', AT_LEAST: 'atleast' }

export function readParaPr(pp: XNode): ParaShape {
  // <hp:switch><hp:case> holds HWPUNIT values; <hp:default> the HWP 5 doubled ones.
  const sw = kid(pp, 'switch')
  const cs = kid(sw, 'case')
  const src = cs ?? pp
  const halve = !cs && !!kid(sw, 'default')
  const margin = kid(src, 'margin') ?? kid(kid(sw, 'default'), 'margin')
  const ls = kid(src, 'lineSpacing') ?? kid(kid(sw, 'default'), 'lineSpacing')
  const m = (name: string) => num(kid(margin, name), 'value', 0) / (halve ? 2 : 1)
  const heading = kid(pp, 'heading')
  const ht = (heading?.attrs.type ?? 'NONE').toUpperCase()
  return {
    align: ALIGN_X[(kid(pp, 'align')?.attrs.horizontal ?? 'JUSTIFY').toUpperCase()] ?? 'justify',
    left: m('left'),
    right: m('right'),
    indent: m('intent') || m('indent'),
    before: m('prev'),
    after: m('next'),
    lineSpacingType: LINE_X[(ls?.attrs.type ?? 'PERCENT').toUpperCase()] ?? 'percent',
    lineSpacing: num(ls, 'value', 160),
    heading: ht === 'OUTLINE' ? 'outline' : ht === 'NUMBER' ? 'number' : ht === 'BULLET' ? 'bullet' : 'none',
    headingId: num(heading, 'idRef', 0),
    level: num(heading, 'level', 0),
    borderFillId: num(kid(pp, 'border'), 'borderFillIDRef', 0)
  }
}

// ---------------------------------------------------------------- sections

interface Ctx {
  notes: Set<string>
  /** Paragraphs of a master page part by manifest id. */
  master?: (id: string) => Para[] | null
}

export function readSectionXml(root: XNode, ctx: Ctx): Section[] {
  const out: Section[] = []
  let cur: Section | null = null
  for (const p of kids(root, 'p')) {
    const para = readP(p, ctx)
    const sec = para.ctrls.find((c) => c?.kind === 'section')
    if (sec && sec.kind === 'section' && (!cur || cur.paras.length)) {
      cur = { page: sec.page, paras: [], pageFill: sec.pageFill }
      out.push(cur)
    }
    if (sec && sec.kind === 'section' && cur && sec.masterRefs?.length && ctx.master) {
      const masters = sec.masterRefs.map((id) => ctx.master!(id)).filter((m): m is Para[] => !!m && m.length > 0)
      if (masters.length) cur.masters = masters
    }
    if (!cur) {
      cur = { page: { ...A4 }, paras: [] }
      out.push(cur)
    }
    cur.paras.push(para)
  }
  return out
}

function readParas(sub: XNode | null, ctx: Ctx): Para[] {
  return kids(sub, 'p').map((p) => readP(p, ctx))
}

const OBJECTS = new Set(['tbl', 'pic', 'rect', 'ellipse', 'line', 'arc', 'polygon', 'curve', 'connectLine', 'container', 'equation', 'ole', 'textart', 'video', 'chart', 'compose', 'dutmal', 'btn', 'radioBtn', 'checkBtn', 'comboBox', 'edit', 'listBox', 'scrollBar'])

/** One <hp:p>: text with the HWP 5 position units, runs, line segments and controls. */
export function readP(p: XNode, ctx: Ctx): Para {
  let textOut = ''
  const pos: number[] = [] // text index per position unit
  const runs: Run[] = []
  const ctrls: (Ctrl | null)[] = []
  const add = (s: string, units: number) => {
    for (let k = 0; k < units; k++) pos.push(textOut.length)
    textOut += s
  }
  const addText = (s: string) => {
    for (let k = 0; k < s.length; k++) pos.push(textOut.length + k)
    textOut += s
  }
  const addCtrl = (c: Ctrl | null) => {
    ctrls.push(c)
    add('￼', 8)
  }
  for (const run of kids(p, 'run')) {
    runs.push({ start: textOut.length, cs: num(run, 'charPrIDRef', 0) })
    for (const item of run.kids) {
      if (typeof item === 'string') continue
      switch (item.name) {
        case 't':
          for (const t of item.kids) {
            if (typeof t === 'string') addText(t)
            else if (t.name === 'tab') add('\t', 8)
            else if (t.name === 'lineBreak') add('\n', 1)
            else if (t.name === 'hyphen') add('-', 1)
            else if (t.name === 'nbSpace') add(' ', 1)
            else if (t.name === 'fwSpace') add(' ', 1)
            else if (t.name === 'titleMark') add('', 8)
          }
          break
        case 'secPr':
          addCtrl({
            kind: 'section',
            page: readPagePr(item),
            masterRefs: kids(item, 'masterPage').map((m) => m.attrs.idRef ?? '').filter(Boolean),
            pageFill: readPageFill(item)
          })
          break
        case 'ctrl':
          for (const c of kids(item)) {
            if (c.name === 'fieldEnd') add('', 8)
            else addCtrl(readCtrlXml(c, ctx))
          }
          break
        default:
          if (OBJECTS.has(item.name)) addCtrl(readObject(item, ctx))
      }
    }
  }
  pos.push(textOut.length)
  const at = (w: number) => (w <= 0 ? 0 : w >= pos.length ? textOut.length : pos[w])
  const lines: LineSeg[] = kids(kid(p, 'linesegarray'), 'lineseg').map((l) => ({
    start: at(num(l, 'textpos')),
    y: num(l, 'vertpos'),
    height: num(l, 'vertsize'),
    textHeight: num(l, 'textheight'),
    baseline: num(l, 'baseline'),
    spacing: num(l, 'spacing'),
    x: num(l, 'horzpos'),
    width: num(l, 'horzsize'),
    flags: num(l, 'flags')
  }))
  if (!runs.length) runs.push({ start: 0, cs: 0 })
  return {
    ps: num(p, 'paraPrIDRef', 0),
    style: num(p, 'styleIDRef', 0),
    text: textOut,
    runs,
    lines,
    ctrls,
    pageBreak: p.attrs.pageBreak === '1',
    columnBreak: p.attrs.columnBreak === '1'
  }
}

export function readPagePr(secPr: XNode): PageDef {
  const pp = kid(secPr, 'pagePr')
  const m = kid(pp, 'margin')
  if (!pp) return { ...A4 }
  const page: PageDef = {
    width: num(pp, 'width', A4.width),
    height: num(pp, 'height', A4.height),
    left: num(m, 'left', A4.left),
    right: num(m, 'right', A4.right),
    top: num(m, 'top', A4.top),
    bottom: num(m, 'bottom', A4.bottom),
    header: num(m, 'header', A4.header),
    footer: num(m, 'footer', A4.footer),
    gutter: num(m, 'gutter', 0),
    // OWPML: WIDELY = portrait (the default), NARROWLY = landscape.
    landscape: (pp.attrs.landscape ?? '').toUpperCase() === 'NARROWLY'
  }
  if (page.width < 1000 || page.height < 1000) return { ...A4 }
  return page
}

function readPageFill(secPr: XNode): Section['pageFill'] {
  const pbf = kids(secPr, 'pageBorderFill').find((p) => (p.attrs.type ?? 'BOTH').toUpperCase() === 'BOTH')
  const id = num(pbf, 'borderFillIDRef', 0)
  if (!pbf || !id) return undefined
  return { id, area: (pbf.attrs.fillArea ?? 'PAPER').toUpperCase() === 'PAPER' ? 'paper' : 'page' }
}

const PAGE_NUM_POS: Record<string, number> = {
  NONE: 0,
  TOP_LEFT: 1,
  TOP_CENTER: 2,
  TOP_RIGHT: 3,
  BOTTOM_LEFT: 4,
  BOTTOM_CENTER: 5,
  BOTTOM_RIGHT: 6,
  OUTSIDE_TOP: 7,
  OUTSIDE_BOTTOM: 8,
  INSIDE_TOP: 9,
  INSIDE_BOTTOM: 10
}

function readCtrlXml(c: XNode, ctx: Ctx): Ctrl | null {
  switch (c.name) {
    case 'colPr': {
      const count = Math.max(1, num(c, 'colCount', 1))
      const sz = c.attrs.sameSz === '0' ? kids(c, 'colSz') : []
      return { kind: 'columns', count, gap: num(c, 'sameGap', 0), widths: sz.map((s) => num(s, 'width')), gaps: sz.map((s) => num(s, 'gap')) }
    }
    case 'header':
    case 'footer': {
      const sub = kid(c, 'subList')
      const a = (c.attrs.applyPageType ?? 'BOTH').toUpperCase()
      return {
        kind: c.name,
        apply: a === 'EVEN' ? 'even' : a === 'ODD' ? 'odd' : 'both',
        paras: readParas(sub, ctx),
        height: num(sub, 'textHeight', 0)
      }
    }
    case 'footNote':
    case 'endNote':
      return { kind: c.name === 'footNote' ? 'footnote' : 'endnote', number: num(c, 'number', 0), paras: readParas(kid(c, 'subList'), ctx) }
    case 'autoNum':
    case 'newNum': {
      if (c.name === 'newNum') return null
      const t = (c.attrs.numType ?? 'PAGE').toUpperCase()
      const what =
        t === 'FOOTNOTE' ? 'footnote' : t === 'ENDNOTE' ? 'endnote' : t === 'PICTURE' ? 'picture' : t === 'TABLE' ? 'table' : t === 'EQUATION' ? 'equation' : t === 'TOTAL_PAGE' ? 'totalpages' : 'page'
      return { kind: 'autonum', what, number: num(c, 'num', 0) }
    }
    case 'pageNum':
      return { kind: 'pagenum', where: PAGE_NUM_POS[(c.attrs.pos ?? 'NONE').toUpperCase()] ?? 0, dash: (c.attrs.sideChar ?? '') === '-' }
    case 'pageHiding':
      return { kind: 'hidden' }
    default:
      return null
  }
}

const VREL: Record<string, ObjPos['vertRel']> = { PAPER: 'paper', PAGE: 'page', PARA: 'para' }
const HREL: Record<string, ObjPos['horzRel']> = { PAPER: 'paper', PAGE: 'page', COLUMN: 'column', PARA: 'para' }
const WRAP: Record<string, ObjPos['wrap']> = {
  SQUARE: 'square',
  TOP_AND_BOTTOM: 'topbottom',
  BEHIND_TEXT: 'behind',
  IN_FRONT_OF_TEXT: 'front',
  TIGHT: 'tight',
  THROUGH: 'through'
}

export function readPosXml(o: XNode): ObjPos {
  const sz = kid(o, 'sz')
  const ps = kid(o, 'pos')
  const om = kid(o, 'outMargin')
  const va = (ps?.attrs.vertAlign ?? 'TOP').toLowerCase()
  const ha = (ps?.attrs.horzAlign ?? 'LEFT').toLowerCase()
  return {
    inline: ps?.attrs.treatAsChar === '1',
    vertRel: VREL[(ps?.attrs.vertRelTo ?? 'PARA').toUpperCase()] ?? 'para',
    horzRel: HREL[(ps?.attrs.horzRelTo ?? 'PARA').toUpperCase()] ?? 'para',
    vertAlign: (['top', 'center', 'bottom', 'inside', 'outside'].includes(va) ? va : 'top') as ObjPos['vertAlign'],
    horzAlign: (['left', 'center', 'right', 'inside', 'outside'].includes(ha) ? ha : 'left') as ObjPos['horzAlign'],
    y: num(ps, 'vertOffset'),
    x: num(ps, 'horzOffset'),
    width: num(sz, 'width'),
    height: num(sz, 'height'),
    wrap: WRAP[(o.attrs.textWrap ?? 'TOP_AND_BOTTOM').toUpperCase()] ?? 'topbottom',
    margin: [num(om, 'left'), num(om, 'right'), num(om, 'top'), num(om, 'bottom')],
    z: num(o, 'zOrder')
  }
}

function readCaptionXml(o: XNode, ctx: Ctx): Caption | undefined {
  const c = kid(o, 'caption')
  if (!c) return undefined
  const side = (c.attrs.side ?? 'BOTTOM').toLowerCase()
  return {
    side: (['left', 'right', 'top', 'bottom'].includes(side) ? side : 'bottom') as Caption['side'],
    width: num(c, 'width'),
    gap: num(c, 'gap', 850),
    paras: readParas(kid(c, 'subList'), ctx)
  }
}

const VALIGN = (s: string | undefined): 'top' | 'center' | 'bottom' => {
  const v = (s ?? 'TOP').toUpperCase()
  return v === 'CENTER' ? 'center' : v === 'BOTTOM' ? 'bottom' : 'top'
}

export function readObject(o: XNode, ctx: Ctx, inGroup = false): Obj | null {
  let pos = readPosXml(o)
  if (inGroup) {
    // Group members: offset inside the group, drawn at their current size.
    const off = kid(o, 'offset')
    const cur = kid(o, 'curSz')
    const org = kid(o, 'orgSz')
    pos = {
      ...DEFAULT_POS,
      inline: false,
      x: num(off, 'x'),
      y: num(off, 'y'),
      width: num(cur, 'width') || num(org, 'width') || pos.width,
      height: num(cur, 'height') || num(org, 'height') || pos.height
    }
  }
  const caption = readCaptionXml(o, ctx)
  switch (o.name) {
    case 'tbl': {
      const im = kid(o, 'inMargin')
      const cells: Cell[] = []
      for (const tr of kids(o, 'tr')) {
        for (const tc of kids(tr, 'tc')) {
          const addr = kid(tc, 'cellAddr')
          const span = kid(tc, 'cellSpan')
          const sz = kid(tc, 'cellSz')
          const cm = kid(tc, 'cellMargin')
          const sub = kid(tc, 'subList')
          const own = tc.attrs.hasMargin === '1'
          const mg = own ? cm : im
          cells.push({
            col: num(addr, 'colAddr'),
            row: num(addr, 'rowAddr'),
            colSpan: Math.max(1, num(span, 'colSpan', 1)),
            rowSpan: Math.max(1, num(span, 'rowSpan', 1)),
            width: num(sz, 'width'),
            height: num(sz, 'height'),
            margin: [num(mg, 'left', 510), num(mg, 'right', 510), num(mg, 'top', 141), num(mg, 'bottom', 141)],
            borderFillId: num(tc, 'borderFillIDRef', 0),
            vAlign: VALIGN(sub?.attrs.vertAlign),
            paras: readParas(sub, ctx)
          })
        }
      }
      return {
        kind: 'table',
        pos,
        rows: num(o, 'rowCnt', 1),
        cols: num(o, 'colCnt', 1),
        cellSpacing: num(o, 'cellSpacing', 0),
        borderFillId: num(o, 'borderFillIDRef', 0),
        cells,
        caption
      }
    }
    case 'pic': {
      const img = find(o, 'img')
      const bin = img?.attrs.binaryItemIDRef ?? ''
      const ls = kid(o, 'lineShape')
      if (inGroup) return { kind: 'shape', pos, shape: 'rect', line: lineOf(ls), fill: null, bin, caption }
      return { kind: 'picture', pos, bin, caption }
    }
    case 'equation':
      ctx.notes.add('equation')
      return { kind: 'placeholder', pos, what: 'equation', label: text(kid(o, 'script')).trim(), caption }
    case 'ole':
      ctx.notes.add('ole')
      return { kind: 'placeholder', pos, what: 'ole', label: '', caption }
    case 'chart':
      ctx.notes.add('chart')
      return { kind: 'placeholder', pos, what: 'chart', label: '', caption }
    case 'textart':
      return { kind: 'placeholder', pos, what: 'textart', label: text(kid(o, 'text')) || (o.attrs.text ?? ''), caption }
    case 'video':
      return { kind: 'placeholder', pos, what: 'video', label: '', caption }
    case 'btn':
    case 'radioBtn':
    case 'checkBtn':
    case 'comboBox':
    case 'edit':
    case 'listBox':
    case 'scrollBar':
      return { kind: 'placeholder', pos, what: 'form', label: o.attrs.caption ?? o.attrs.name ?? '', caption }
    case 'compose':
    case 'dutmal':
      return null
    default: {
      const shape: Shape['shape'] =
        o.name === 'rect' ? 'rect' : o.name === 'ellipse' ? 'ellipse' : o.name === 'line' || o.name === 'connectLine' ? 'line' : o.name === 'arc' ? 'arc' : o.name === 'polygon' ? 'polygon' : o.name === 'curve' ? 'curve' : o.name === 'container' ? 'group' : 'other'
      const dt = kid(o, 'drawText')
      const tm = kid(dt, 'textMargin')
      const sub = kid(dt, 'subList')
      const out: Shape = {
        kind: 'shape',
        pos,
        shape,
        line: lineOf(kid(o, 'lineShape')),
        fill: color(find(kid(o, 'fillBrush'), 'winBrush')?.attrs.faceColor),
        round: num(o, 'ratio', 0),
        caption
      }
      if (dt) out.text = { paras: readParas(sub, ctx), margin: [num(tm, 'left', 283), num(tm, 'right', 283), num(tm, 'top', 283), num(tm, 'bottom', 283)], vAlign: VALIGN(sub?.attrs.vertAlign) }
      if (shape === 'group') {
        const children: Obj[] = []
        for (const k of kids(o)) if (OBJECTS.has(k.name)) {
          const c = readObject(k, ctx, true)
          if (c) children.push(c)
        }
        out.children = children
        // Scale members from the group's original to its current size.
        const org = kid(o, 'orgSz')
        const cur = kid(o, 'curSz')
        const ow = num(org, 'width')
        const oh = num(org, 'height')
        const cw = num(cur, 'width') || pos.width
        const ch = num(cur, 'height') || pos.height
        if (ow && oh && (cw !== ow || ch !== oh)) {
          const sx = cw / ow
          const sy = ch / oh
          for (const c of children) c.pos = { ...c.pos, x: c.pos.x * sx, y: c.pos.y * sy, width: c.pos.width * sx, height: c.pos.height * sy }
        }
      }
      return out
    }
  }
}

function lineOf(ls: XNode | null): Shape['line'] {
  if (!ls) return { color: null, width: 0 }
  const style = (ls.attrs.style ?? 'SOLID').toUpperCase()
  const w = num(ls, 'width', 0)
  return { color: style === 'NONE' || w <= 0 ? null : color(ls.attrs.color), width: w }
}
