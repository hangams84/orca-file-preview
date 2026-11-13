/** Document model shared by the HWP 5 (binary) and HWPX (OWPML) readers. Lengths are HWPUNIT
 *  (1/7200 inch) unless noted. Both formats describe the same Hangul document model, so the
 *  readers fill the same structures and one view draws them. */

export interface CharShape {
  /** Face names for Hangul and Latin text (other scripts fall back to these). */
  hangulFace: string
  latinFace: string
  /** Base size in HWPUNIT (1000 = 10 pt), before the Hangul relative size. */
  height: number
  /** Relative size (%) and letter spacing (%) for Hangul text. */
  relSize: number
  spacing: number
  /** Width ratio (장평, %). */
  ratio: number
  bold: boolean
  italic: boolean
  underline: 'none' | 'below' | 'above'
  strike: boolean
  sup: boolean
  sub: boolean
  color: string
  /** Highlight / shade colour or null. */
  shade: string | null
  underlineColor: string | null
}

export type Align = 'justify' | 'left' | 'right' | 'center' | 'distribute' | 'divide'

export interface ParaShape {
  align: Align
  /** Paragraph margins in HWPUNIT (already halved for HWP 5, which stores them doubled). */
  left: number
  right: number
  indent: number
  before: number
  after: number
  lineSpacingType: 'percent' | 'fixed' | 'space' | 'atleast'
  lineSpacing: number
  /** Paragraph heading: numbering / bullet / outline. */
  heading: 'none' | 'outline' | 'number' | 'bullet'
  headingId: number
  level: number
  borderFillId: number
}

export interface Border {
  /** CSS border style or 'none'. */
  style: 'none' | 'solid' | 'dashed' | 'dotted' | 'double'
  /** Width in mm. */
  width: number
  color: string
}

export interface BorderFill {
  left: Border
  right: Border
  top: Border
  bottom: Border
  /** Background colour or null. */
  fill: string | null
  /** Gradient colours (first to last) and angle in degrees. */
  gradient?: { colors: string[]; angle: number }
  /** Picture fill (bin key), stretched over the area. */
  image?: string
}

export interface Numbering {
  /** Per level (0-based): format such as `^1.` (`^n` = number of level n) and number style. */
  levels: { format: string; style: number; start: number }[]
  start: number
}

export interface Bullet {
  char: string
}

export interface LineSeg {
  /** Index into Para.text where the line starts. */
  start: number
  /** Vertical position of the line top, relative to its text area (page body, cell, box). */
  y: number
  height: number
  textHeight: number
  baseline: number
  spacing: number
  /** Start x and width relative to the text area / column. */
  x: number
  width: number
  flags: number
}

export interface Run {
  /** Index into Para.text where this char shape starts. */
  start: number
  cs: number
}

export interface Para {
  ps: number
  style: number
  /** Text: `\t` tab, `\n` line break, U+FFFC an extended control (see `ctrls`, in order). */
  text: string
  runs: Run[]
  lines: LineSeg[]
  /** One entry per U+FFFC in `text`, in order; null for controls that draw nothing. */
  ctrls: (Ctrl | null)[]
  pageBreak: boolean
  columnBreak: boolean
}

export interface ObjPos {
  /** 글자처럼 취급: laid out inside the text line. */
  inline: boolean
  vertRel: 'paper' | 'page' | 'para'
  horzRel: 'paper' | 'page' | 'column' | 'para'
  vertAlign: 'top' | 'center' | 'bottom' | 'inside' | 'outside'
  horzAlign: 'left' | 'center' | 'right' | 'inside' | 'outside'
  y: number
  x: number
  width: number
  height: number
  wrap: 'square' | 'topbottom' | 'behind' | 'front' | 'tight' | 'through'
  /** Outer margins left, right, top, bottom. */
  margin: [number, number, number, number]
  z: number
}

export interface Caption {
  side: 'left' | 'right' | 'top' | 'bottom'
  width: number
  gap: number
  paras: Para[]
}

export interface Cell {
  col: number
  row: number
  colSpan: number
  rowSpan: number
  width: number
  height: number
  /** Inner margins left, right, top, bottom. */
  margin: [number, number, number, number]
  borderFillId: number
  vAlign: 'top' | 'center' | 'bottom'
  paras: Para[]
}

export interface Table {
  kind: 'table'
  pos: ObjPos
  rows: number
  cols: number
  cellSpacing: number
  borderFillId: number
  cells: Cell[]
  caption?: Caption
}

export interface Picture {
  kind: 'picture'
  pos: ObjPos
  /** Key into Doc.bins. */
  bin: string
  caption?: Caption
}

export interface Shape {
  kind: 'shape'
  pos: ObjPos
  shape: 'rect' | 'ellipse' | 'line' | 'arc' | 'polygon' | 'curve' | 'group' | 'other'
  line: { color: string | null; width: number }
  fill: string | null
  /** Text box content with its inner margins (left, right, top, bottom). */
  text?: { paras: Para[]; margin: [number, number, number, number]; vAlign: 'top' | 'center' | 'bottom' }
  /** Children of a group, positioned relative to the group (pos.x / pos.y). */
  children?: Obj[]
  /** Corner radius ratio for rounded rectangles (0-50 %). */
  round?: number
  /** Picture drawn inside the shape (picture objects inside groups). */
  bin?: string
  caption?: Caption
}

export interface Placeholder {
  kind: 'placeholder'
  pos: ObjPos
  what: 'equation' | 'chart' | 'ole' | 'video' | 'form' | 'textart' | 'object'
  /** Equation script or other label text. */
  label: string
  caption?: Caption
}

export type Obj = Table | Picture | Shape | Placeholder

export interface Note {
  kind: 'footnote' | 'endnote'
  number: number
  paras: Para[]
}

export interface HeaderFooter {
  kind: 'header' | 'footer'
  apply: 'both' | 'even' | 'odd'
  paras: Para[]
  height: number
}

export interface AutoNumber {
  kind: 'autonum'
  what: 'page' | 'footnote' | 'endnote' | 'picture' | 'table' | 'equation' | 'totalpages'
  number: number
}

export interface PageNumberPos {
  kind: 'pagenum'
  /** 0 none, 1 top-left, 2 top-center, 3 top-right, 4 bottom-left, 5 bottom-center, 6 bottom-right,
   *  7 outside-top, 8 outside-bottom, 9 inside-top, 10 inside-bottom. */
  where: number
  dash: boolean
}

export interface Columns {
  kind: 'columns'
  count: number
  gap: number
  /** Relative widths and gaps (any unit; scaled to the body width) when columns differ. */
  widths: number[]
  gaps?: number[]
}

export interface SectionCtrl {
  kind: 'section'
  page: PageDef
  pageFill?: Section['pageFill']
  /** Master page (바탕쪽) contents, drawn behind the body of every page. */
  masters?: Para[][]
  /** HWPX: manifest ids of the master page parts. */
  masterRefs?: string[]
}

export interface Break {
  kind: 'hidden'
}

export type Ctrl = Obj | Note | HeaderFooter | AutoNumber | PageNumberPos | Columns | SectionCtrl | Break

export interface PageDef {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
  header: number
  footer: number
  gutter: number
  landscape: boolean
}

export interface Section {
  page: PageDef
  paras: Para[]
  masters?: Para[][]
  /** Page background / border (쪽 테두리/배경): border fill id (1-based) and the area it covers. */
  pageFill?: { id: number; area: 'paper' | 'page' }
}

export interface BinItem {
  bytes: Uint8Array
  mime: string
}

export interface HangulDoc {
  format: 'HWP' | 'HWPX'
  version: string
  charShapes: CharShape[]
  paraShapes: ParaShape[]
  borderFills: BorderFill[]
  numberings: Numbering[]
  bullets: Bullet[]
  /** Lazily loaded binary items (pictures) by key. */
  bin(key: string): BinItem | null
  sections: Section[]
  /** Things the reader skipped, for the info line (e.g. 'ole', 'chart'). */
  notes: string[]
}

export const A4: PageDef = {
  width: 59528,
  height: 84188,
  left: 8504,
  right: 8504,
  top: 5668,
  bottom: 4252,
  header: 4252,
  footer: 4252,
  gutter: 0,
  landscape: false
}

export const DEFAULT_CHAR: CharShape = {
  hangulFace: '함초롬바탕',
  latinFace: '함초롬바탕',
  height: 1000,
  relSize: 100,
  spacing: 0,
  ratio: 100,
  bold: false,
  italic: false,
  underline: 'none',
  strike: false,
  sup: false,
  sub: false,
  color: '#000000',
  shade: null,
  underlineColor: null
}

export const DEFAULT_PARA: ParaShape = {
  align: 'justify',
  left: 0,
  right: 0,
  indent: 0,
  before: 0,
  after: 0,
  lineSpacingType: 'percent',
  lineSpacing: 160,
  heading: 'none',
  headingId: 0,
  level: 0,
  borderFillId: 0
}

const NO_BORDER: Border = { style: 'none', width: 0.1, color: '#000000' }
export const EMPTY_BORDER_FILL: BorderFill = { left: NO_BORDER, right: NO_BORDER, top: NO_BORDER, bottom: NO_BORDER, fill: null }

export const DEFAULT_POS: ObjPos = {
  inline: true,
  vertRel: 'para',
  horzRel: 'para',
  vertAlign: 'top',
  horzAlign: 'left',
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  wrap: 'topbottom',
  margin: [0, 0, 0, 0],
  z: 0
}

/** Page size as drawn: landscape swaps a portrait-stored paper. */
export function paperSize(p: PageDef): { width: number; height: number } {
  if (p.landscape && p.width < p.height) return { width: p.height, height: p.width }
  return { width: p.width, height: p.height }
}

/** Border widths (mm) by the index HWP 5 stores. */
export const BORDER_WIDTHS_MM = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0]

/** HWP / OWPML line type to the closest CSS border style. */
export function borderStyle(t: number | string): Border['style'] {
  if (typeof t === 'string') {
    const s = t.toUpperCase()
    if (s === 'NONE' || s === '') return 'none'
    if (s === 'DOT' || s === 'CIRCLE') return 'dotted'
    if (s.includes('DASH')) return 'dashed'
    if (s === 'DOUBLE_SLIM' || s.includes('DOUBLE') || s.startsWith('SLIM_THICK') || s.startsWith('THICK_SLIM')) return 'double'
    return 'solid'
  }
  switch (t) {
    case 0:
      return 'none'
    case 3:
    case 7:
      return 'dotted'
    case 2:
    case 4:
    case 5:
    case 6:
      return 'dashed'
    case 8:
    case 9:
    case 10:
    case 11:
      return 'double'
    default:
      return 'solid'
  }
}

/** Number formats used by paragraph numbering and auto numbers. */
export function formatNumber(n: number, style: number): string {
  switch (style) {
    case 1: // circled digits
      return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n)
    case 2:
      return roman(n).toUpperCase()
    case 3:
      return roman(n)
    case 4:
      return alpha(n).toUpperCase()
    case 5:
      return alpha(n)
    case 6: // circled upper latin
      return n >= 1 && n <= 26 ? String.fromCharCode(0x24b6 + n - 1) : alpha(n).toUpperCase()
    case 7: // circled lower latin
      return n >= 1 && n <= 26 ? String.fromCharCode(0x24d0 + n - 1) : alpha(n)
    case 8: // 가나다
      return HANGUL_SYL[(n - 1) % HANGUL_SYL.length] ?? String(n)
    case 9: // circled 가나다
      return n >= 1 && n <= 14 ? String.fromCharCode(0x326e + n - 1) : HANGUL_SYL[(n - 1) % HANGUL_SYL.length]
    case 10: // ㄱㄴㄷ
      return HANGUL_JAMO[(n - 1) % HANGUL_JAMO.length] ?? String(n)
    case 11: // circled ㄱㄴㄷ
      return n >= 1 && n <= 14 ? String.fromCharCode(0x3260 + n - 1) : HANGUL_JAMO[(n - 1) % HANGUL_JAMO.length]
    case 12: // 일이삼
      return hangulNumber(n)
    case 13: // 一二三
      return hanjaNumber(n)
    default:
      return String(n)
  }
}

const HANGUL_SYL = [...'가나다라마바사아자차카타파하']
const HANGUL_JAMO = [...'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ']

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n)
  const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
  let s = ''
  for (const [v, r] of t) while (n >= v) {
    s += r
    n -= v
  }
  return s
}

function alpha(n: number): string {
  if (n <= 0) return String(n)
  let s = ''
  while (n > 0) {
    n--
    s = String.fromCharCode(97 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

function hangulNumber(n: number): string {
  const d = [...'영일이삼사오육칠팔구']
  return n >= 0 && n < 10 ? d[n] : String(n)
}

function hanjaNumber(n: number): string {
  const d = [...'〇一二三四五六七八九']
  return n >= 0 && n < 10 ? d[n] : String(n)
}

/** OWPML number type names to the HWP 5 style codes used by formatNumber. */
export function numberStyleFromName(name: string | null | undefined): number {
  switch ((name ?? '').toUpperCase()) {
    case 'CIRCLED_DIGIT':
      return 1
    case 'ROMAN_CAPITAL':
      return 2
    case 'ROMAN_SMALL':
      return 3
    case 'LATIN_CAPITAL':
      return 4
    case 'LATIN_SMALL':
      return 5
    case 'CIRCLED_LATIN_CAPITAL':
      return 6
    case 'CIRCLED_LATIN_SMALL':
      return 7
    case 'HANGUL_SYLLABLE':
      return 8
    case 'CIRCLED_HANGUL_SYLLABLE':
      return 9
    case 'HANGUL_JAMO':
      return 10
    case 'CIRCLED_HANGUL_JAMO':
      return 11
    case 'HANGUL_PHONETIC':
      return 12
    case 'IDEOGRAPH':
      return 13
    default:
      return 0
  }
}

/** Default outline numbering (개요) when a document refers to a numbering it does not define. */
export const DEFAULT_OUTLINE: Numbering = {
  start: 1,
  levels: [
    { format: '^1.', style: 0, start: 1 },
    { format: '^2.', style: 8, start: 1 },
    { format: '^3)', style: 0, start: 1 },
    { format: '^4)', style: 8, start: 1 },
    { format: '(^5)', style: 0, start: 1 },
    { format: '(^6)', style: 8, start: 1 },
    { format: '^7', style: 1, start: 1 },
    { format: '^8', style: 1, start: 1 },
    { format: '^9', style: 1, start: 1 },
    { format: '^10', style: 1, start: 1 }
  ]
}
