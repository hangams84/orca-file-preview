/** HWP 5.x reader: OLE compound file → FileHeader, DocInfo and BodyText/SectionN record streams
 *  (raw deflate when the header says so) → the shared HangulDoc model. Spec: Hancom "한글 문서 파일
 *  형식 5.0". Read-only; nothing here touches the DOM, so it runs in unit tests. */
import { inflateSync } from '../../../vendor/zip.js'
import { isCfb, readCfb, type Cfb } from '../legacy/cfb.ts'
import {
  BORDER_WIDTHS_MM,
  borderStyle,
  DEFAULT_CHAR,
  DEFAULT_PARA,
  DEFAULT_POS,
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
  type Shape,
  A4
} from './model.ts'
import { buildTree, colorRef, ctrlName, decodeParaText, readRecords, Reader, TAG, textIndex, type DecodedText, type HwpRecord } from './records.ts'

export class HangulError extends Error {
  readonly code: 'hwp3' | 'password' | 'distribution' | 'drm' | 'not-hwp' | 'damaged'
  constructor(code: HangulError['code'], detail?: string) {
    super(detail ?? code)
    this.code = code
  }
}

const SIGNATURE = 'HWP Document File'

/** "HWP Document File V3.00" (HWP 3.x and earlier) at the start of the file. */
export function isHwp3(b: Uint8Array): boolean {
  const head = String.fromCharCode(...b.subarray(0, 20))
  return head.startsWith('HWP Document File V')
}

export interface FileHeader {
  version: string
  /** Version as a number: major << 24 | minor << 16 | build << 8 | revision. */
  ver: number
  compressed: boolean
  password: boolean
  distribution: boolean
  drm: boolean
}

export function readFileHeader(fh: Uint8Array): FileHeader {
  const sig = String.fromCharCode(...fh.subarray(0, 17))
  if (sig !== SIGNATURE || fh.length < 40) throw new HangulError('not-hwp', 'bad FileHeader signature')
  const r = new Reader(fh).skip(32)
  const ver = r.u32()
  const flags = r.u32()
  return {
    ver,
    version: `${ver >>> 24}.${(ver >>> 16) & 0xff}.${(ver >>> 8) & 0xff}.${ver & 0xff}`,
    compressed: (flags & 1) !== 0,
    password: (flags & 2) !== 0,
    distribution: (flags & 4) !== 0,
    drm: (flags & 16) !== 0
  }
}

/** Inflates a raw-deflate stream; a stream that is not compressed after all is returned as is. */
function inflate(data: Uint8Array): Uint8Array {
  try {
    return inflateSync(data)
  } catch {
    throw new HangulError('damaged', 'cannot inflate stream')
  }
}

export function readHwp(bytes: Uint8Array): HangulDoc {
  if (isHwp3(bytes)) throw new HangulError('hwp3')
  if (!isCfb(bytes)) throw new HangulError('not-hwp')
  let cfb: Cfb
  try {
    cfb = readCfb(bytes)
  } catch {
    throw new HangulError('damaged', 'compound file')
  }
  const fhBytes = cfb.open?.('FileHeader') ?? cfb.stream('FileHeader')
  if (!fhBytes) throw new HangulError('not-hwp', 'no FileHeader')
  const fh = readFileHeader(fhBytes)
  if (fh.password) throw new HangulError('password')
  if (fh.drm) throw new HangulError('drm')
  if (fh.distribution) throw new HangulError('distribution')
  const raw = (s: Uint8Array | null | undefined): Uint8Array | null => (s ? (fh.compressed ? inflate(s) : s) : null)

  const docInfo = raw(cfb.stream('DocInfo'))
  if (!docInfo) throw new HangulError('damaged', 'no DocInfo')
  const info = readDocInfo(readRecords(docInfo), fh.ver)

  const sectionNames = (cfb.list?.('BodyText') ?? [])
    .map((n) => /^Section(\d+)$/i.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
  const sections: Section[] = []
  const notes = new Set<string>()
  const ctx: SectionCtx = { info, notes, ver: fh.ver }
  for (const n of sectionNames) {
    const data = raw(cfb.open?.(`BodyText/Section${n}`))
    if (!data) continue
    sections.push(...readSection(buildTree(readRecords(data)), ctx))
  }
  if (!sections.length) throw new HangulError('damaged', 'no body text')

  const cache = new Map<string, BinItem | null>()
  return {
    format: 'HWP',
    version: fh.version,
    charShapes: info.charShapes,
    paraShapes: info.paraShapes,
    borderFills: info.borderFills,
    numberings: info.numberings,
    bullets: info.bullets,
    sections,
    notes: [...notes],
    bin(key) {
      if (cache.has(key)) return cache.get(key)!
      const meta = info.bins.get(Number(key))
      let item: BinItem | null = null
      if (meta) {
        const name = `BinData/BIN${meta.id.toString(16).toUpperCase().padStart(4, '0')}.${meta.ext}`
        const s = cfb.open?.(name) ?? null
        if (s) {
          let data = s
          const compress = meta.compress === 1 || (meta.compress === 0 && fh.compressed)
          if (compress) {
            try {
              data = inflateSync(s)
            } catch {
              data = s // some writers store pictures uncompressed despite the flag
            }
          }
          item = { bytes: data, mime: mimeOf(meta.ext, data) }
        }
      }
      cache.set(key, item)
      return item
    }
  }
}

export function mimeOf(ext: string, data?: Uint8Array): string {
  const e = ext.toLowerCase()
  if (data && data.length > 4) {
    if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
    if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
    if (data[0] === 0x47 && data[1] === 0x49) return 'image/gif'
    if (data[0] === 0x42 && data[1] === 0x4d) return 'image/bmp'
  }
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg'
  if (e === 'png') return 'image/png'
  if (e === 'gif') return 'image/gif'
  if (e === 'bmp') return 'image/bmp'
  if (e === 'svg') return 'image/svg+xml'
  if (e === 'webp') return 'image/webp'
  if (e === 'tif' || e === 'tiff') return 'image/tiff'
  if (e === 'wmf') return 'image/wmf'
  if (e === 'emf') return 'image/emf'
  return 'application/octet-stream'
}

// ---------------------------------------------------------------- DocInfo

export interface DocInfo {
  faces: string[][]
  charShapes: CharShape[]
  paraShapes: ParaShape[]
  borderFills: BorderFill[]
  numberings: Numbering[]
  bullets: Bullet[]
  bins: Map<number, { id: number; ext: string; compress: number }>
}

export function readDocInfo(records: HwpRecord[], ver = 0x05000300): DocInfo {
  const faces: string[][] = [[], [], [], [], [], [], []]
  let faceCounts: number[] = []
  let faceSeen = 0
  const rawChars: Uint8Array[] = []
  const info: DocInfo = { faces, charShapes: [], paraShapes: [], borderFills: [], numberings: [], bullets: [], bins: new Map() }
  let binIndex = 0
  for (const rec of records) {
    switch (rec.tag) {
      case TAG.ID_MAPPINGS: {
        const r = new Reader(rec.data)
        const counts: number[] = []
        while (r.has(4)) counts.push(r.i32())
        faceCounts = counts.slice(1, 8)
        break
      }
      case TAG.FACE_NAME: {
        // Faces come grouped by language (Hangul, Latin, Hanja, Japanese, other, symbol, user).
        let lang = 0
        let acc = 0
        for (; lang < 7; lang++) {
          acc += Math.max(0, faceCounts[lang] ?? 0)
          if (faceSeen < acc) break
        }
        faceSeen++
        const r = new Reader(rec.data)
        r.u8()
        faces[Math.min(lang, 6)].push(r.hstr())
        break
      }
      case TAG.BORDER_FILL:
        info.borderFills.push(readBorderFill(rec.data))
        break
      case TAG.CHAR_SHAPE:
        rawChars.push(rec.data)
        break
      case TAG.PARA_SHAPE:
        info.paraShapes.push(readParaShape(rec.data, ver))
        break
      case TAG.NUMBERING:
        info.numberings.push(readNumbering(rec.data))
        break
      case TAG.BULLET: {
        const r = new Reader(rec.data).skip(12)
        const c = r.u16()
        info.bullets.push({ char: c >= 32 ? bulletChar(c) : '•' })
        break
      }
      case TAG.BIN_DATA: {
        binIndex++
        const r = new Reader(rec.data)
        const props = r.u16()
        const type = props & 0xf
        if (type === 0) {
          // A linked file outside the document: nothing to show.
          break
        }
        const id = r.u16()
        const ext = r.hstr() || 'bin'
        info.bins.set(binIndex, { id, ext, compress: (props >> 4) & 3 })
        break
      }
    }
  }
  info.charShapes = rawChars.map((d) => readCharShape(d, faces))
  return info
}

/** Private-use bullet code points (Wingdings-like) map to common Unicode bullets. */
function bulletChar(c: number): string {
  if (c >= 0xf000 && c <= 0xf0ff) {
    const m: Record<number, string> = { 0xf09f: '•', 0xf0a7: '▪', 0xf06c: '●', 0xf06e: '■', 0xf075: '◆', 0xf0d8: '➢', 0xf0fc: '✓', 0xf0b7: '•' }
    return m[c] ?? '•'
  }
  return String.fromCharCode(c)
}

export function readCharShape(d: Uint8Array, faces: string[][]): CharShape {
  const r = new Reader(d)
  const faceIds = Array.from({ length: 7 }, () => r.u16())
  const ratio = Array.from({ length: 7 }, () => r.u8())
  const spacing = Array.from({ length: 7 }, () => r.i8())
  const rel = Array.from({ length: 7 }, () => r.u8())
  r.skip(7) // offsets
  const height = r.i32()
  const props = r.u32()
  r.skip(2) // shadow gaps
  const color = r.u32()
  const ulColor = r.u32()
  const shade = r.u32()
  const ul = (props >> 2) & 3
  return {
    hangulFace: faces[0][faceIds[0]] ?? DEFAULT_CHAR.hangulFace,
    latinFace: faces[1][faceIds[1]] ?? faces[0][faceIds[0]] ?? DEFAULT_CHAR.latinFace,
    height: height > 0 ? height : 1000,
    relSize: rel[0] || 100,
    spacing: spacing[0],
    ratio: ratio[0] || 100,
    italic: (props & 1) !== 0,
    bold: (props & 2) !== 0,
    underline: ul === 1 ? 'below' : ul === 3 ? 'above' : 'none',
    strike: ((props >> 18) & 7) !== 0,
    sup: (props & (1 << 15)) !== 0,
    sub: (props & (1 << 16)) !== 0,
    color: colorRef(color) ?? '#000000',
    underlineColor: colorRef(ulColor),
    shade: shade === 0xffffffff ? null : colorRef(shade)
  }
}

const ALIGNS: Align[] = ['justify', 'left', 'right', 'center', 'distribute', 'divide']
const LINE_TYPES: ParaShape['lineSpacingType'][] = ['percent', 'fixed', 'space', 'atleast']

export function readParaShape(d: Uint8Array, ver = 0x05000300): ParaShape {
  const r = new Reader(d)
  const p1 = r.u32()
  // HWP 5 stores paragraph margins and spacing doubled.
  const left = r.i32() / 2
  const right = r.i32() / 2
  const indent = r.i32() / 2
  const before = r.i32() / 2
  const after = r.i32() / 2
  const oldSpacing = r.i32()
  r.u16() // tab def
  const headingId = r.u16()
  const borderFillId = r.u16()
  r.skip(8)
  r.u32() // props2
  const p3 = r.u32()
  const newSpacing = r.u32()
  const useNew = d.length >= 54 && ver >= 0x05000205
  const heading = (['none', 'outline', 'number', 'bullet'] as const)[(p1 >>> 23) & 3]
  return {
    align: ALIGNS[(p1 >>> 2) & 7] ?? 'justify',
    left,
    right,
    indent,
    before,
    after,
    lineSpacingType: LINE_TYPES[useNew ? p3 & 0x1f : p1 & 3] ?? 'percent',
    lineSpacing: useNew ? newSpacing : oldSpacing,
    heading,
    headingId,
    level: (p1 >>> 25) & 7,
    borderFillId
  }
}

export function readBorderFill(d: Uint8Array): BorderFill {
  const r = new Reader(d)
  r.u16()
  const side = (): Border => {
    const type = r.u8()
    const w = r.u8()
    const color = r.u32()
    return { style: borderStyle(type), width: BORDER_WIDTHS_MM[w] ?? 0.12, color: colorRef(color) ?? '#000000' }
  }
  const left = side()
  const right = side()
  const top = side()
  const bottom = side()
  r.skip(6) // diagonal
  const fillType = r.u32()
  let fill: string | null = null
  if (fillType & 1) {
    const bk = r.u32()
    fill = colorRef(bk)
  }
  return { left, right, top, bottom, fill }
}

export function readNumbering(d: Uint8Array): Numbering {
  const r = new Reader(d)
  const levels: Numbering['levels'] = []
  for (let i = 0; i < 7 && r.has(12); i++) {
    const props = r.u32()
    r.skip(8)
    const format = r.hstr()
    levels.push({ format, style: (props >>> 5) & 0xf, start: 1 })
  }
  const start = r.has(2) ? r.u16() : 1
  for (let i = 0; i < levels.length && r.has(4); i++) levels[i].start = r.u32() || 1
  // HWP 5.1: levels 8-10 follow with their own head info, format and start number.
  for (let i = 7; i < 10 && r.has(12); i++) {
    const props = r.u32()
    r.skip(8)
    const format = r.hstr()
    levels.push({ format, style: (props >>> 5) & 0xf, start: 1 })
  }
  for (let i = 7; i < levels.length && r.has(4); i++) levels[i].start = r.u32() || 1
  return { levels, start: start || 1 }
}

// ---------------------------------------------------------------- BodyText

interface SectionCtx {
  info: DocInfo
  notes: Set<string>
  ver: number
}

/** A section stream: top-level paragraphs, split into sections where a paragraph defines one. */
export function readSection(roots: HwpRecord[], ctx: SectionCtx): Section[] {
  const out: Section[] = []
  let cur: Section | null = null
  for (const rec of roots) {
    if (rec.tag !== TAG.PARA_HEADER) continue
    const para = readPara(rec, ctx)
    const sec = para.ctrls.find((c) => c?.kind === 'section')
    if (sec && sec.kind === 'section' && (!cur || cur.paras.length)) {
      cur = { page: sec.page, paras: [] }
      out.push(cur)
    } else if (sec && sec.kind === 'section' && cur) cur.page = sec.page
    if (!cur) {
      cur = { page: { ...A4 }, paras: [] }
      out.push(cur)
    }
    cur.paras.push(para)
  }
  return out
}

/** Paragraphs that follow a LIST_HEADER among its siblings (cells, text boxes, notes, captions). */
function readList(siblings: HwpRecord[], from: number, count: number, ctx: SectionCtx): { paras: Para[]; next: number } {
  const paras: Para[] = []
  let i = from
  const max = count > 0 ? count : 1e9
  while (i < siblings.length && siblings[i].tag === TAG.PARA_HEADER && paras.length < max) {
    paras.push(readPara(siblings[i], ctx))
    i++
  }
  return { paras, next: i }
}

export function readPara(rec: HwpRecord, ctx: SectionCtx): Para {
  const r = new Reader(rec.data)
  const nChars = r.u32() & 0x7fffffff
  r.u32() // control mask
  const ps = r.u16()
  const style = r.u8()
  const brk = r.u8()
  let decoded: DecodedText | null = null
  const runs: Run[] = []
  const lines: LineSeg[] = []
  const ctrlRecs: HwpRecord[] = []
  for (const c of rec.children) {
    if (c.tag === TAG.PARA_TEXT) decoded = decodeParaText(c.data)
    else if (c.tag === TAG.CTRL_HEADER) ctrlRecs.push(c)
  }
  const d: DecodedText = decoded ?? { text: '', pos: new Int32Array(Math.max(1, nChars) + 1), ctrls: [] }
  for (const c of rec.children) {
    if (c.tag === TAG.PARA_CHAR_SHAPE) {
      const cr = new Reader(c.data)
      while (cr.has(8)) {
        const at = cr.u32()
        const cs = cr.u32()
        runs.push({ start: textIndex(d, at), cs })
      }
    } else if (c.tag === TAG.PARA_LINE_SEG) {
      const lr = new Reader(c.data)
      while (lr.has(36)) {
        const at = lr.u32()
        lines.push({
          start: textIndex(d, at),
          y: lr.i32(),
          height: lr.i32(),
          textHeight: lr.i32(),
          baseline: lr.i32(),
          spacing: lr.i32(),
          x: lr.i32(),
          width: lr.i32(),
          flags: lr.u32()
        })
      }
    }
  }
  if (!runs.length) runs.push({ start: 0, cs: 0 })
  const ctrls: (Ctrl | null)[] = []
  const nObj = d.ctrls.length
  for (let k = 0; k < nObj; k++) {
    const cr = ctrlRecs[k]
    let c: Ctrl | null = null
    if (cr) {
      try {
        c = readCtrl(cr, ctx)
      } catch {
        c = null
      }
    }
    ctrls.push(c)
  }
  return { ps, style, text: d.text, runs, lines, ctrls, pageBreak: (brk & 0x04) !== 0, columnBreak: (brk & 0x08) !== 0 }
}

const VREL: ObjPos['vertRel'][] = ['paper', 'page', 'para', 'para']
const HREL: ObjPos['horzRel'][] = ['paper', 'page', 'column', 'para']
const VALIGN: ObjPos['vertAlign'][] = ['top', 'center', 'bottom', 'inside', 'outside']
const HALIGN: ObjPos['horzAlign'][] = ['left', 'center', 'right', 'inside', 'outside']
const WRAP: ObjPos['wrap'][] = ['square', 'topbottom', 'behind', 'front', 'tight', 'through']

/** The common object properties at the start of a table / drawing / equation CTRL_HEADER. */
export function readObjPos(data: Uint8Array): ObjPos {
  const r = new Reader(data).skip(4)
  const props = r.u32()
  const y = r.i32()
  const x = r.i32()
  const width = r.u32()
  const height = r.u32()
  const z = r.i32()
  const margin: [number, number, number, number] = [r.i16(), r.i16(), r.i16(), r.i16()]
  return {
    inline: (props & 1) !== 0,
    vertRel: VREL[(props >>> 3) & 3],
    vertAlign: VALIGN[(props >>> 5) & 7] ?? 'top',
    horzRel: HREL[(props >>> 8) & 3],
    horzAlign: HALIGN[(props >>> 10) & 7] ?? 'left',
    wrap: WRAP[(props >>> 21) & 7] ?? 'square',
    x,
    y,
    width,
    height,
    z,
    margin
  }
}

function readCtrl(rec: HwpRecord, ctx: SectionCtx): Ctrl | null {
  const r = new Reader(rec.data)
  const id = ctrlName(r.u32())
  const kids = rec.children
  switch (id) {
    case 'secd': {
      const pd = kids.find((k) => k.tag === TAG.PAGE_DEF)
      return { kind: 'section', page: pd ? readPageDef(pd.data) : { ...A4 } }
    }
    case 'cold': {
      const props = r.u16()
      const count = Math.max(1, (props >>> 2) & 0xff)
      const same = (props & (1 << 12)) !== 0
      const gap = r.u16()
      const widths: number[] = []
      const gaps: number[] = []
      if (!same && count > 1) {
        // Different widths: (width, gap) pairs in relative units.
        for (let i = 0; i < count && r.has(4); i++) {
          widths.push(r.u16())
          gaps.push(r.u16())
        }
      }
      return { kind: 'columns', count, gap, widths, gaps }
    }
    case 'tbl ':
      return readTable(rec, ctx)
    case 'gso ': {
      const pos = readObjPos(rec.data)
      let caption: Caption | undefined
      let obj: Obj | null = null
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i]
        if (k.tag === TAG.LIST_HEADER && !obj) {
          const cap = readCaption(k, kids, i, ctx)
          caption = cap.caption
          i = cap.next - 1
        } else if (k.tag === TAG.SHAPE_COMPONENT && !obj) obj = readShapeComponent(k, pos, ctx, true)
      }
      if (!obj) return null
      if (caption) obj.caption = caption
      return obj
    }
    case 'eqed': {
      const pos = readObjPos(rec.data)
      const eq = kids.find((k) => k.tag === TAG.EQEDIT)
      let label = ''
      if (eq) {
        const er = new Reader(eq.data).skip(4)
        label = er.hstr()
      }
      ctx.notes.add('equation')
      return { kind: 'placeholder', pos, what: 'equation', label }
    }
    case 'head':
    case 'foot': {
      const props = r.u32()
      const li = kids.findIndex((k) => k.tag === TAG.LIST_HEADER)
      if (li < 0) return null
      const lr = new Reader(kids[li].data)
      const count = lr.i32()
      lr.u32()
      lr.u32() // text width
      const height = lr.u32()
      const { paras } = readList(kids, li + 1, count, ctx)
      const apply = (['both', 'even', 'odd'] as const)[props & 3] ?? 'both'
      return { kind: id === 'head' ? 'header' : 'footer', apply, paras, height }
    }
    case 'fn  ':
    case 'en  ': {
      const number = r.u32()
      const li = kids.findIndex((k) => k.tag === TAG.LIST_HEADER)
      const count = li >= 0 ? new Reader(kids[li].data).i32() : 0
      const { paras } = li >= 0 ? readList(kids, li + 1, count, ctx) : { paras: [] }
      return { kind: id === 'fn  ' ? 'footnote' : 'endnote', number, paras }
    }
    case 'atno': {
      const props = r.u32()
      const number = r.u16()
      const what = (['page', 'footnote', 'endnote', 'picture', 'table', 'equation', 'totalpages'] as const)[props & 0xf] ?? 'page'
      return { kind: 'autonum', what, number }
    }
    case 'pgnp': {
      const props = r.u32()
      return { kind: 'pagenum', where: (props >>> 8) & 0xf, dash: false }
    }
    case 'pghd':
      return { kind: 'hidden' }
    default:
      return null
  }
}

export function readPageDef(d: Uint8Array): PageDef {
  const r = new Reader(d)
  const page: PageDef = {
    width: r.u32(),
    height: r.u32(),
    left: r.u32(),
    right: r.u32(),
    top: r.u32(),
    bottom: r.u32(),
    header: r.u32(),
    footer: r.u32(),
    gutter: r.u32(),
    landscape: (r.u32() & 1) !== 0
  }
  if (page.width < 1000 || page.height < 1000) return { ...A4 }
  return page
}

function readCaption(lh: HwpRecord, siblings: HwpRecord[], at: number, ctx: SectionCtx): { caption: Caption; next: number } {
  const r = new Reader(lh.data)
  const count = r.i32()
  r.u32()
  const props = r.u32()
  const width = r.u32()
  const gap = r.u16()
  const { paras, next } = readList(siblings, at + 1, count, ctx)
  const side = (['left', 'right', 'top', 'bottom'] as const)[props & 3]
  return { caption: { side, width, gap, paras }, next }
}

function readTable(rec: HwpRecord, ctx: SectionCtx): Obj | null {
  const pos = readObjPos(rec.data)
  const kids = rec.children
  let caption: Caption | undefined
  let tableRec: HwpRecord | null = null
  const cells: Cell[] = []
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    if (k.tag === TAG.TABLE) tableRec = k
    else if (k.tag === TAG.LIST_HEADER && !tableRec) {
      const cap = readCaption(k, kids, i, ctx)
      caption = cap.caption
      i = cap.next - 1
    } else if (k.tag === TAG.LIST_HEADER) {
      const r = new Reader(k.data)
      const count = r.i32()
      const props = r.u32()
      const cell: Cell = {
        col: r.u16(),
        row: r.u16(),
        colSpan: Math.max(1, r.u16()),
        rowSpan: Math.max(1, r.u16()),
        width: r.u32(),
        height: r.u32(),
        margin: [r.u16(), r.u16(), r.u16(), r.u16()],
        borderFillId: r.u16(),
        vAlign: (['top', 'center', 'bottom', 'top'] as const)[(props >>> 5) & 3],
        paras: []
      }
      const list = readList(kids, i + 1, count, ctx)
      cell.paras = list.paras
      i = list.next - 1
      cells.push(cell)
    }
  }
  if (!tableRec) return null
  const tr = new Reader(tableRec.data)
  tr.u32()
  const rows = tr.u16()
  const cols = tr.u16()
  const cellSpacing = tr.u16()
  tr.skip(8)
  tr.skip(rows * 2)
  const borderFillId = tr.u16()
  return { kind: 'table', pos, rows, cols, cellSpacing, borderFillId, cells, caption }
}

/** A drawing object (SHAPE_COMPONENT and its type record). `top` components repeat their id. */
function readShapeComponent(rec: HwpRecord, pos: ObjPos, ctx: SectionCtx, top: boolean): Obj | null {
  const r = new Reader(rec.data)
  const id0 = r.u32()
  if (top) {
    const save = r.pos
    if (r.u32() !== id0) r.pos = save
  }
  const type = ctrlName(id0)
  const gx = r.i32()
  const gy = r.i32()
  r.u16() // group level
  r.u16() // local file version
  const initW = r.u32()
  const initH = r.u32()
  const curW = r.u32()
  const curH = r.u32()
  r.u32() // flip
  r.u16() // rotation
  r.skip(8) // centre
  const nMatrix = r.u16()
  r.skip(48 + nMatrix * 96)
  let line: Shape['line'] = { color: null, width: 0 }
  let fill: string | null = null
  if (type !== '$con') {
    const lc = r.u32()
    const lw = r.i32()
    const lp = r.u32()
    r.u8()
    line = { color: lw > 0 && (lp & 0x3f) !== 0 ? colorRef(lc) : null, width: lw }
    const ft = r.u32()
    if (ft & 1) fill = colorRef(r.u32())
  }
  // Inside a group, children are placed by their offsets in the group and drawn at their size.
  const p: ObjPos = top ? pos : { ...DEFAULT_POS, inline: false, x: gx, y: gy, width: curW || initW, height: curH || initH }

  let text: Shape['text']
  const children: Obj[] = []
  let shape: Shape['shape'] = 'other'
  let bin: string | undefined
  let round = 0
  const kids = rec.children
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    if (k.tag === TAG.LIST_HEADER) {
      const lr = new Reader(k.data)
      const count = lr.i32()
      const props = lr.u32()
      const margin: [number, number, number, number] = [lr.i16(), lr.i16(), lr.i16(), lr.i16()]
      const list = readList(kids, i + 1, count, ctx)
      text = { paras: list.paras, margin, vAlign: (['top', 'center', 'bottom', 'top'] as const)[(props >>> 5) & 3] }
      i = list.next - 1
    } else if (k.tag === TAG.SHAPE_COMPONENT) {
      const child = readShapeComponent(k, p, ctx, false)
      if (child) children.push(child)
    } else if (k.tag === TAG.SHAPE_RECTANGLE) {
      shape = 'rect'
      round = k.data[0] ?? 0
    } else if (k.tag === TAG.SHAPE_ELLIPSE) shape = 'ellipse'
    else if (k.tag === TAG.SHAPE_LINE) shape = 'line'
    else if (k.tag === TAG.SHAPE_ARC) shape = 'arc'
    else if (k.tag === TAG.SHAPE_POLYGON) shape = 'polygon'
    else if (k.tag === TAG.SHAPE_CURVE) shape = 'curve'
    else if (k.tag === TAG.SHAPE_CONTAINER) shape = 'group'
    else if (k.tag === TAG.SHAPE_PICTURE) {
      const pr = new Reader(k.data)
      const borderColor = pr.u32()
      const borderWidth = pr.i32()
      const bprops = pr.u32()
      if (borderWidth > 0 && (bprops & 0x3f) !== 0) line = { color: colorRef(borderColor), width: borderWidth }
      pr.skip(32 + 16 + 8 + 3)
      bin = String(pr.u16())
    } else if (k.tag === TAG.SHAPE_OLE) {
      ctx.notes.add('ole')
      return { kind: 'placeholder', pos: p, what: 'ole', label: '' }
    } else if (k.tag === TAG.CHART_DATA) {
      ctx.notes.add('chart')
      return { kind: 'placeholder', pos: p, what: 'chart', label: '' }
    } else if (k.tag === TAG.SHAPE_TEXTART) {
      return { kind: 'placeholder', pos: p, what: 'textart', label: '' }
    } else if (k.tag === TAG.VIDEO_DATA) {
      return { kind: 'placeholder', pos: p, what: 'video', label: '' }
    }
  }
  if (type === '$pic' || bin) {
    if (bin) {
      if (top) return { kind: 'picture', pos: p, bin }
      return { kind: 'shape', pos: p, shape: 'rect', line, fill, bin }
    }
  }
  if (type === '$con') shape = 'group'
  if (type === '$ole') {
    ctx.notes.add('ole')
    return { kind: 'placeholder', pos: p, what: 'ole', label: '' }
  }
  // Scale group children from the group's original to its current size.
  if (shape === 'group' && initW && initH && (curW !== initW || curH !== initH)) {
    const sx = curW / initW
    const sy = curH / initH
    for (const c of children) {
      c.pos = { ...c.pos, x: c.pos.x * sx, y: c.pos.y * sy, width: c.pos.width * sx, height: c.pos.height * sy }
    }
  }
  return { kind: 'shape', pos: p, shape, line, fill, text, children: children.length ? children : undefined, round }
}
