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
  sup?: boolean
  sub?: boolean
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

export interface Paragraph {
  kind: 'p'
  runs: Run[]
  /** 1 to 6 for headings; 0 for the title style. */
  heading?: number
  list?: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  /** Left indent in CSS px. */
  indent?: number
}

export interface Table {
  kind: 'table'
  rows: Block[][][]
}

export interface PageBreak {
  kind: 'break'
}

export interface Section {
  kind: 'section'
  title: string
}

export type Block = Paragraph | Table | PageBreak | Section

export interface DocModel {
  blocks: Block[]
  /** Short description of the source variant, shown in the toolbar. */
  variant: string
  warnings: string[]
}

export function paragraphText(p: Paragraph): string {
  return p.runs.map((r) => r.text).join('')
}
