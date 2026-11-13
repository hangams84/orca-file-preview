/** A small document model shared by the .doc (binary Word) and RTF readers and their renderer. */

export interface Run {
  text: string
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  /** CSS colour such as `#c02626`. */
  color?: string
  /** Font size in points. */
  pt?: number
  /** Highlight / shading colour. */
  bg?: string
  sup?: boolean
  sub?: boolean
  /** Font face for Latin text and for East Asian text (from the document's font table). */
  font?: string
  eaFont?: string
  caps?: boolean
  smallCaps?: boolean
  /** Extra character spacing in points. */
  spacing?: number
  /** A list number or bullet: drawn as a box this wide (points) so the text starts at the tab. */
  labelWidth?: number
  /** The label's font is a symbol font (its glyph was mapped to Unicode); used for line metrics. */
  symbolFont?: string
  /** Inline picture. */
  image?: Picture
  /** Placeholder for an object that cannot be shown (OLE object, chart, drawing). */
  object?: string
}

export interface Picture {
  bytes: Uint8Array
  mime: string
  /** Display size in CSS px, when known. */
  width?: number
  height?: number
}

/** Paragraph layout as Word stores it, in points. Present for binary .doc paragraphs. */
export interface ParaFmt {
  before: number
  after: number
  /** 'auto': `line` is a multiple of single spacing; 'exact' / 'atLeast': `line` in points. */
  lineRule: 'auto' | 'exact' | 'atLeast'
  line: number
  left: number
  right: number
  /** First-line indent (negative = hanging). */
  first: number
  keepNext: boolean
  keepLines: boolean
  widow: boolean
  pageBreakBefore: boolean
  /** Don't add space between paragraphs of the same style. */
  contextual: boolean
  style: number
  /** Custom tab stops (points from the left margin) and alignment (0 left, 1 center, 2 right, 3 decimal). */
  tabs: { pos: number; jc: number }[]
  /** Paragraph borders (points) drawn around the text, inside the spacing before and after. */
  borders?: { top?: { width: number; space: number; color: string }; bottom?: { width: number; space: number; color: string }; left?: { width: number; space: number; color: string }; right?: { width: number; space: number; color: string } }
  /** Font size and faces of the paragraph mark (height of an empty paragraph). */
  markPt: number
  markFont?: string
  markEaFont?: string
}

export interface Paragraph {
  kind: 'p'
  runs: Run[]
  /** 1 to 6 for headings; 0 for the title style. */
  heading?: number
  list?: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  /** Left indent in CSS px. */
  indent?: number
  fmt?: ParaFmt
}

/** One table row's geometry, in points. */
export interface RowFmt {
  /** Cell boundaries relative to the text column's left edge (cells + 1 values). */
  centers: number[]
  padLeft: number
  padRight: number
  padTop: number
  padBottom: number
  /** Positive: at least; negative: exact; 0: auto. */
  height: number
  /** Per cell border widths in points (top, left, bottom, right), 0 = none. */
  borders: [number, number, number, number][]
  /** Horizontally merged continuation cells (drawn by the first cell). */
  merged: boolean[]
  jc: number
}

export interface Table {
  kind: 'table'
  rows: Block[][][]
  rowFmt?: (RowFmt | undefined)[]
}

export interface PageBreak {
  kind: 'break'
}

export interface Section {
  kind: 'section'
  title: string
}

/** Page setup in points. */
export interface PageFmt {
  w: number
  h: number
  top: number
  bottom: number
  left: number
  right: number
  header: number
  footer: number
  columns: number
  colSpace: number
  /** Starts on a new page (false for continuous section breaks). */
  newPage: boolean
  /** Document grid line pitch in points (0 = none). */
  linePitch: number
}

/** Start of a document section with its page setup. */
export interface SectionStart {
  kind: 'sect'
  page: PageFmt
  /** Header and footer paragraphs for the pages of this section. */
  header?: Block[]
  footer?: Block[]
  /** A different first page: its own header and footer (possibly none). */
  titlePage?: boolean
  firstHeader?: Block[]
  firstFooter?: Block[]
}

export type Block = Paragraph | Table | PageBreak | Section | SectionStart

export interface DocModel {
  blocks: Block[]
  /** Short description of the source variant, shown in the toolbar. */
  variant: string
  warnings: string[]
  /** True when the blocks carry Word's page and paragraph geometry (page layout possible). */
  paged?: boolean
  /** Font family class per font name (1 roman, 2 swiss, 3 modern, 4 script, 5 decorative), used to
   *  substitute fonts that are not installed the way Word does. */
  fontClasses?: Record<string, number>
  /** Word's HTML paragraph spacing (compatibility option off): the space between two paragraphs is
   *  the larger of space after and space before instead of their sum. */
  collapseSpacing?: boolean
}

export function paragraphText(p: Paragraph): string {
  return p.runs.map((r) => r.text).join('')
}
