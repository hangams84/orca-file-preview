/** Subset of SheetJS CE 0.20.3 used by editor/renderers/sheet.ts. */
export interface CellObject {
  t: 'b' | 'e' | 'n' | 'd' | 's' | 'z'
  v?: string | number | boolean | Date
  w?: string
  f?: string
  /** Number format string. */
  z?: string | number
  s?: unknown
}
export interface Range {
  s: { r: number; c: number }
  e: { r: number; c: number }
}
export interface ColInfo { wpx?: number; wch?: number; width?: number; hidden?: boolean }
export interface RowInfo { hpx?: number; hpt?: number; hidden?: boolean }
export interface WorkSheet {
  [cell: string]: CellObject | unknown
  '!ref'?: string
  /** Real sheet size when parsing stopped at `sheetRows`. */
  '!fullref'?: string
  /** Set by office/sheet-worker.js: the cell window that was transferred. */
  '!window'?: { r0: number; c0: number; r1: number; c1: number }
  /** Present when read with `dense: true`: rows of cells. */
  '!data'?: (CellObject | undefined)[][]
  '!merges'?: Range[]
  '!cols'?: ColInfo[]
  '!rows'?: RowInfo[]
}
export interface WorkBook {
  SheetNames: string[]
  Sheets: Record<string, WorkSheet>
  Workbook?: { Sheets?: { name?: string; Hidden?: number }[] }
}
export interface ParsingOptions {
  type?: 'array' | 'buffer' | 'binary' | 'base64' | 'string'
  cellDates?: boolean
  cellNF?: boolean
  cellStyles?: boolean
  cellHTML?: boolean
  cellFormula?: boolean
  dense?: boolean
  sheetRows?: number
  WTF?: boolean
}
export function read(data: Uint8Array | ArrayBuffer, opts?: ParsingOptions): WorkBook
export const utils: {
  decode_range(ref: string): Range
  encode_col(c: number): string
  encode_cell(cell: { r: number; c: number }): string
}
export const SSF: { format(fmt: string | number, value: unknown): string }
