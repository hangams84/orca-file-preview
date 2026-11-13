/** HWP 5.0 binary building blocks: the record stream (tag / level / size headers), paragraph text
 *  with its inline and extended control characters, and the units Hangul stores lengths in.
 *  Spec: Hancom "한글 문서 파일 형식 5.0" (HWP 5.0 file format), sections 3.1-3.2 and 4. */

/** 1 HWPUNIT = 1/7200 inch; 100 HWPUNIT = 1 pt. */
export const HWPUNIT_PER_PT = 100
/** CSS px (1/96 in) per HWPUNIT. */
export const PX_PER_HWPUNIT = 96 / 7200

export const hwpToPt = (u: number): number => u / HWPUNIT_PER_PT
export const hwpToPx = (u: number): number => u * PX_PER_HWPUNIT
export const hwpToMm = (u: number): number => (u / 7200) * 25.4
export const mmToHwp = (mm: number): number => Math.round((mm / 25.4) * 7200)

/** COLORREF (0x00BBGGRR) to `#rrggbb`; null for "no colour" (0xFFFFFFFF and friends). */
export function colorRef(v: number): string | null {
  if (v >>> 24 !== 0) return null
  const r = v & 0xff
  const g = (v >>> 8) & 0xff
  const b = (v >>> 16) & 0xff
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Record tags (HWPTAG_BEGIN = 0x10). */
export const TAG = {
  DOCUMENT_PROPERTIES: 0x10,
  ID_MAPPINGS: 0x11,
  BIN_DATA: 0x12,
  FACE_NAME: 0x13,
  BORDER_FILL: 0x14,
  CHAR_SHAPE: 0x15,
  TAB_DEF: 0x16,
  NUMBERING: 0x17,
  BULLET: 0x18,
  PARA_SHAPE: 0x19,
  STYLE: 0x1a,
  PARA_HEADER: 0x42,
  PARA_TEXT: 0x43,
  PARA_CHAR_SHAPE: 0x44,
  PARA_LINE_SEG: 0x45,
  PARA_RANGE_TAG: 0x46,
  CTRL_HEADER: 0x47,
  LIST_HEADER: 0x48,
  PAGE_DEF: 0x49,
  FOOTNOTE_SHAPE: 0x4a,
  PAGE_BORDER_FILL: 0x4b,
  SHAPE_COMPONENT: 0x4c,
  TABLE: 0x4d,
  SHAPE_LINE: 0x4e,
  SHAPE_RECTANGLE: 0x4f,
  SHAPE_ELLIPSE: 0x50,
  SHAPE_ARC: 0x51,
  SHAPE_POLYGON: 0x52,
  SHAPE_CURVE: 0x53,
  SHAPE_OLE: 0x54,
  SHAPE_PICTURE: 0x55,
  SHAPE_CONTAINER: 0x56,
  CTRL_DATA: 0x57,
  EQEDIT: 0x58,
  SHAPE_TEXTART: 0x5a,
  FORM_OBJECT: 0x5b,
  CHART_DATA: 0x5f,
  VIDEO_DATA: 0x60
} as const

export interface HwpRecord {
  tag: number
  level: number
  data: Uint8Array
  children: HwpRecord[]
}

export class HwpFormatError extends Error {}

/** Splits a stream into records. Header: tag (10 bits), level (10 bits), size (12 bits); size 0xFFF
 *  means a 32-bit size follows. A truncated last record is cut to the bytes that exist. */
export function readRecords(buf: Uint8Array, limit = 2_000_000): HwpRecord[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: HwpRecord[] = []
  let p = 0
  while (p + 4 <= buf.length && out.length < limit) {
    const h = dv.getUint32(p, true)
    p += 4
    const tag = h & 0x3ff
    const level = (h >>> 10) & 0x3ff
    let size = h >>> 20
    if (size === 0xfff) {
      if (p + 4 > buf.length) break
      size = dv.getUint32(p, true)
      p += 4
    }
    const end = Math.min(buf.length, p + size)
    out.push({ tag, level, data: buf.subarray(p, end), children: [] })
    p = end
  }
  return out
}

/** Nests records by level: a record's children are the following records with a higher level. */
export function buildTree(records: HwpRecord[]): HwpRecord[] {
  const roots: HwpRecord[] = []
  const stack: HwpRecord[] = []
  for (const r of records) {
    while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(r)
    else roots.push(r)
    stack.push(r)
  }
  return roots
}

/** Little-endian cursor over a record body. Reads past the end return 0 / empty strings, so a short
 *  record from an older writer leaves later fields at their defaults instead of throwing. */
export class Reader {
  private dv: DataView
  readonly buf: Uint8Array
  pos = 0
  constructor(buf: Uint8Array) {
    this.buf = buf
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  get left(): number {
    return this.buf.length - this.pos
  }
  has(n: number): boolean {
    return this.pos + n <= this.buf.length
  }
  skip(n: number): this {
    this.pos += n
    return this
  }
  u8(): number {
    const v = this.has(1) ? this.buf[this.pos] : 0
    this.pos += 1
    return v
  }
  i8(): number {
    const v = this.has(1) ? this.dv.getInt8(this.pos) : 0
    this.pos += 1
    return v
  }
  u16(): number {
    const v = this.has(2) ? this.dv.getUint16(this.pos, true) : 0
    this.pos += 2
    return v
  }
  i16(): number {
    const v = this.has(2) ? this.dv.getInt16(this.pos, true) : 0
    this.pos += 2
    return v
  }
  u32(): number {
    const v = this.has(4) ? this.dv.getUint32(this.pos, true) : 0
    this.pos += 4
    return v
  }
  i32(): number {
    const v = this.has(4) ? this.dv.getInt32(this.pos, true) : 0
    this.pos += 4
    return v
  }
  /** A WCHAR string of `n` code units. */
  wstr(n: number): string {
    let s = ''
    for (let i = 0; i < n && this.has(2); i++) s += String.fromCharCode(this.u16())
    return s
  }
  /** A string with a WORD length prefix. */
  hstr(): string {
    return this.wstr(Math.min(this.u16(), this.left >> 1))
  }
}

/** Control identifiers are four ASCII characters stored as a little-endian UINT32 of the
 *  big-endian spelling: 'secd' = ('s' << 24) | ('e' << 16) | ('c' << 8) | 'd'. */
export function ctrlId(s: string): number {
  return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0
}
export function ctrlName(id: number): string {
  return String.fromCharCode((id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff)
}

/** How a control character below 32 occupies PARA_TEXT: 'char' is one WCHAR, 'inline' and
 *  'extended' are eight WCHARs (code, 6 WCHARs of data, code). Extended controls each have a
 *  CTRL_HEADER record, in text order. */
export function controlKind(c: number): 'char' | 'inline' | 'extended' {
  switch (c) {
    case 1: case 2: case 3: case 11: case 12: case 14: case 15: case 16: case 17: case 18: case 21: case 22: case 23:
      return 'extended'
    case 4: case 5: case 6: case 7: case 8: case 9: case 19: case 20:
      return 'inline'
    default:
      return 'char'
  }
}

/** Decoded paragraph text. `text` holds displayable characters: `\t` tab, `\n` line break,
 *  U+FFFC an extended control (object, note, field…) whose index in `ctrls` is the k-th U+FFFC;
 *  other control characters are dropped. `pos[w]` maps a WCHAR offset (as used by char-shape runs
 *  and line segments) to an index in `text`; it has one entry per WCHAR plus one for the end. */
export interface DecodedText {
  text: string
  pos: Int32Array
  /** Extended control codes in order (the char code: 11 object/table, 16 header/footer, …). */
  ctrls: number[]
}

export function decodeParaText(data: Uint8Array): DecodedText {
  const n = data.length >> 1
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const pos = new Int32Array(n + 1)
  const ctrls: number[] = []
  let text = ''
  let w = 0
  while (w < n) {
    const c = dv.getUint16(w * 2, true)
    if (c >= 32) {
      pos[w] = text.length
      text += String.fromCharCode(c)
      w++
      continue
    }
    const kind = controlKind(c)
    const width = kind === 'char' ? 1 : Math.min(8, n - w)
    for (let k = 0; k < width; k++) pos[w + k] = text.length
    if (c === 9) text += '\t'
    else if (c === 10) text += '\n'
    else if (c === 24) text += '-'
    else if (c === 30) text += ' '
    else if (c === 31) text += ' '
    else if (kind === 'extended') {
      ctrls.push(c)
      text += '￼'
    }
    w += width
  }
  pos[n] = text.length
  return { text, pos, ctrls }
}

/** Text index for a WCHAR offset (clamped). */
export function textIndex(d: DecodedText, w: number): number {
  if (w <= 0) return 0
  if (w >= d.pos.length) return d.text.length
  return d.pos[w]
}
