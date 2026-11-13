/** Formatting for binary Word (.doc): sprm decoding, the style sheet (STSH) with based-on
 *  inheritance, paragraph (PAP), character (CHP), section (SEP) and table row (TAP) properties,
 *  and the font table. Handles Word 97+ sprms (2-byte opcodes) and Word 6/95 sprms (1-byte). */

export interface Chp {
  b: boolean
  i: boolean
  /** Underline kind (0 none). */
  u: number
  strike: boolean
  caps: boolean
  smallCaps: boolean
  hidden: boolean
  /** Half-points. */
  hps: number
  /** Font indices into the font table: ascii, east asian, other. */
  ftcAscii: number
  ftcFE: number
  ftcOther: number
  color?: string
  highlight?: string
  /** 1 super, 2 sub. */
  iss: number
  /** Character spacing in twips. */
  dxaSpace: number
  picLocation?: number
  special: boolean
  ole: boolean
  data: boolean
  /** Character style (0 = default paragraph font). */
  istd: number
}

export interface LineSpacing {
  /** Twips (exact / at least) or 240ths of a line (auto). */
  dyaLine: number
  mult: boolean
}

export interface Pap {
  istd: number
  jc: number
  /** Twips. */
  left: number
  right: number
  first: number
  before: number
  after: number
  beforeAuto: boolean
  afterAuto: boolean
  line: LineSpacing
  keep: boolean
  keepNext: boolean
  pageBreakBefore: boolean
  widow: boolean
  contextual: boolean
  inTable: boolean
  ttp: boolean
  itap: number
  ilfo: number
  ilvl: number
  /** Table row properties, on the row-end (TTP) paragraph. */
  tap?: Tap
  /** Offset into the Data stream of a "huge" PAPX. */
  hugePapx?: number
  /** Custom tab stops: position in twips and alignment (0 left, 1 center, 2 right, 3 decimal, 4 bar). */
  tabs: { pos: number; jc: number }[]
  /** Paragraph borders: width and space in points, colour. */
  borders?: { top?: Brc; left?: Brc; bottom?: Brc; right?: Brc }
}

export interface Brc {
  width: number
  space: number
  color: string
}

export interface Tap {
  /** Cell boundaries in twips, relative to the paragraph's left margin (itcMac + 1 values). */
  centers: number[]
  gapHalf: number
  /** Cell padding in twips (left, right, top, bottom) when given explicitly. */
  padLeft?: number
  padRight?: number
  padTop?: number
  padBottom?: number
  /** Row height in twips: positive = at least, negative = exact. */
  rowHeight: number
  /** Per cell: borders present (top, left, bottom, right) and merge flags. */
  cells: { borders: [number, number, number, number]; merged: boolean; firstMerged: boolean; vMerge: boolean; vRestart: boolean; shade?: string }[]
  /** Table-wide borders (eighths of a point; 0 none): top, left, bottom, right, insideH, insideV. */
  tableBorders?: number[]
  jc: number
}

export interface Sep {
  /** Twips. */
  pageW: number
  pageH: number
  left: number
  right: number
  top: number
  bottom: number
  header: number
  footer: number
  gutter: number
  landscape: boolean
  columns: number
  colSpace: number
  /** 0 continuous, 1 new column, 2 new page, 3 even, 4 odd. */
  bkc: number
  /** Document grid: 0 none, 1 lines and characters, 2 lines, 3 snap to characters. */
  clm: number
  linePitch: number
  titlePage: boolean
}

export const defaultSep = (): Sep => ({
  pageW: 12240,
  pageH: 15840,
  left: 1800,
  right: 1800,
  top: 1440,
  bottom: 1440,
  header: 720,
  footer: 720,
  gutter: 0,
  landscape: false,
  columns: 1,
  colSpace: 720,
  bkc: 2,
  clm: 0,
  linePitch: 0,
  titlePage: false
})

export const defaultChp = (): Chp => ({
  b: false,
  i: false,
  u: 0,
  strike: false,
  caps: false,
  smallCaps: false,
  hidden: false,
  hps: 20,
  ftcAscii: 0,
  ftcFE: 0,
  ftcOther: 0,
  iss: 0,
  dxaSpace: 0,
  special: false,
  ole: false,
  data: false,
  istd: 10
})

export const defaultPap = (): Pap => ({
  istd: 0,
  jc: 0,
  left: 0,
  right: 0,
  first: 0,
  before: 0,
  after: 0,
  beforeAuto: false,
  afterAuto: false,
  line: { dyaLine: 240, mult: true },
  keep: false,
  keepNext: false,
  pageBreakBefore: false,
  widow: true,
  contextual: false,
  inTable: false,
  ttp: false,
  itap: 0,
  ilfo: 0,
  ilvl: 0,
  tabs: []
})

export const ICO = ['', '#000000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#ffff00', '#ffffff', '#000080',
  '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0']

// ------------------------------------------------------------------------------------- sprm walking

/** Operand length of a Word 97+ sprm at `off` (the two opcode bytes excluded). */
function sprmSize97(sprm: number, b: Uint8Array, off: number): number {
  switch (sprm >> 13) {
    case 0:
    case 1:
      return 1
    case 2:
    case 4:
    case 5:
      return 2
    case 3:
      return 4
    case 7:
      return 3
    default:
      if (sprm === 0xd608 || sprm === 0xd606) return off + 1 < b.length ? 2 + (b[off] | (b[off + 1] << 8)) - 1 : 2
      if (sprm === 0xc615 && b[off] === 255) return 1 + 255
      return 1 + (b[off] ?? 0)
  }
}

/** Word 6/95 sprm operand lengths: -1 variable (next byte is the length), -2 tDefTable (2-byte
 *  length), 0 no operand. Unlisted codes are treated as variable. Index = sprm code. */
const SPRM95: number[] = (() => {
  const t: number[] = new Array(256).fill(-1)
  const len: [number, number][] = [
    [2, 2], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [13, 1], [14, 1],
    [16, 2], [17, 2], [18, 2], [19, 2], [20, 4], [21, 2], [22, 2], [24, 1], [25, 1], [26, 2], [27, 2], [28, 2], [29, 1],
    [30, 2], [31, 2], [32, 2], [33, 2], [34, 2], [35, 2], [36, 2], [37, 1], [38, 2], [39, 2], [40, 2], [41, 2], [42, 2],
    [43, 2], [44, 1], [45, 2], [46, 2], [47, 2], [48, 2], [49, 2], [50, 1], [51, 1],
    [65, 1], [66, 1], [67, 1], [69, 2], [70, 4], [71, 1], [72, 2], [73, 3], [75, 1], [80, 2], [82, 0], [83, 0],
    [85, 1], [86, 1], [87, 1], [88, 1], [89, 1], [90, 1], [91, 1], [92, 1], [93, 2], [94, 1], [95, 3], [96, 2], [97, 2],
    [98, 1], [99, 2], [100, 1], [101, 2], [102, 1], [104, 1], [107, 2], [109, 2], [110, 2], [117, 1], [118, 1],
    [119, 1], [121, 2], [122, 2], [123, 2], [124, 2],
    [131, 1], [132, 1], [136, 3], [137, 3], [138, 1], [139, 1], [140, 2], [141, 2], [142, 1], [143, 1], [144, 2], [145, 2],
    [146, 1], [147, 1], [148, 2], [149, 2], [150, 1], [151, 1], [152, 1], [153, 1], [154, 2], [155, 2], [156, 2], [157, 2],
    [158, 1], [159, 1], [160, 2], [161, 2], [162, 1], [164, 2], [165, 2], [166, 2], [167, 2], [168, 2], [169, 2], [170, 2],
    [171, 2], [182, 2], [183, 2], [184, 2], [185, 1], [186, 1], [187, 12], [189, 2], [190, -2], [192, 4], [193, 5],
    [194, 4], [195, 2], [196, 4], [197, 2], [198, 2], [199, 5], [200, 4]
  ]
  for (const [c, n] of len) t[c] = n
  return t
})()

/** Word 6/95 -> Word 97 opcode for the sprms this reader understands. */
const MAP95: Record<number, number> = {
  2: 0x4600, // pIstd
  5: 0x2403, // pJc
  7: 0x2405, // pFKeep
  8: 0x2406, // pFKeepFollow
  9: 0x2407, // pFPageBreakBefore
  15: 0xc60d, // pChgTabsPapx
  16: 0x840e, // pDxaRight
  17: 0x840f, // pDxaLeft
  19: 0x8411, // pDxaLeft1
  20: 0x6412, // pDyaLine
  21: 0xa413, // pDyaBefore
  22: 0xa414, // pDyaAfter
  23: 0xc615, // pChgTabs
  24: 0x2416, // pFInTable
  25: 0x2417, // pFTtp
  51: 0x2431, // pFWidowControl
  71: 0x0806, // cFData
  75: 0x080a, // cFOle2
  80: 0x4a30, // cIstd
  85: 0x0835, // cFBold
  86: 0x0836, // cFItalic
  87: 0x0837, // cFStrike
  90: 0x083a, // cFSmallCaps
  91: 0x083b, // cFCaps
  92: 0x083c, // cFVanish
  93: 0x4a4f, // cFtc
  94: 0x2a3e, // cKul
  96: 0x8840, // cDxaSpace
  98: 0x2a42, // cIco
  99: 0x4a43, // cHps
  104: 0x2a48, // cIss
  117: 0x0855, // cFSpec
  142: 0x3009, // sBkc
  143: 0x300a, // sFTitlePage
  144: 0x500b, // sCcolumns
  145: 0x900c, // sDxaColumns
  156: 0xb017, // sDyaHdrTop
  157: 0xb018, // sDyaHdrBottom
  162: 0x301d, // sBOrientation
  164: 0xb01f, // sXaPage
  165: 0xb020, // sYaPage
  166: 0xb021, // sDxaLeft
  167: 0xb022, // sDxaRight
  168: 0x9023, // sDyaTop
  169: 0x9024, // sDyaBottom
  170: 0xb025, // sDzaGutter
  183: 0x9601, // tDxaLeft
  184: 0x9602, // tDxaGapHalf
  189: 0x9407, // tDyaRowHeight
  190: 0xd608 // tDefTable
}

/** Yields (opcode in Word 97 numbering, operand offset, operand size) for a grpprl. */
export function* sprms(g: Uint8Array, old = false): Generator<[number, number, number]> {
  let i = 0
  let guard = 0
  while (i < g.length && guard++ < 10000) {
    if (old) {
      const code = g[i]
      const n = SPRM95[code]
      let o = i + 1
      let size: number
      if (n === -2) {
        size = Math.max(0, u16(g, o) - 1)
        o += 2
      } else if (n === -1) {
        size = g[o] ?? 0
        o++
      } else size = n
      if (o + size > g.length) return
      const mapped = MAP95[code]
      if (mapped != null) yield [mapped, o, size]
      i = o + size
      continue
    }
    if (i + 2 > g.length) return
    const sprm = g[i] | (g[i + 1] << 8)
    const size = sprmSize97(sprm, g, i + 2)
    if (i + 2 + size > g.length) return
    yield [sprm, i + 2, size]
    i += 2 + size
  }
}

const i16 = (g: Uint8Array, o: number) => (((g[o] | (g[o + 1] << 8)) << 16) >> 16)
const u16 = (g: Uint8Array, o: number) => g[o] | (g[o + 1] << 8)
const u32 = (g: Uint8Array, o: number) => (g[o] | (g[o + 1] << 8) | (g[o + 2] << 16) | (g[o + 3] << 24)) >>> 0

const toggle = (v: number, style: boolean) => (v === 0 ? false : v === 1 ? true : v === 0x80 ? style : v === 0x81 ? !style : v !== 0)

function colorRef(g: Uint8Array, o: number): string | undefined {
  if (g[o + 3] === 0xff) return undefined // auto
  return `#${[g[o], g[o + 1], g[o + 2]].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

const HIGHLIGHT = ['', '#000000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#ffff00', '#ffffff', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0']

/** Applies character sprms to `chp`. `style` is the CHP of the applicable style (for 0x80/0x81 toggles);
 *  `charStyle` resolves a character style's CHP for sprmCIstd. */
export function applyChp(chp: Chp, g: Uint8Array, style: Chp, old: boolean, charStyle?: (istd: number, target: Chp) => void): void {
  for (const [sprm, o, size] of sprms(g, old)) {
    const v = g[o]
    switch (sprm) {
      case 0x4a30: {
        // character style: its properties underlie the direct formatting that follows
        const istd = u16(g, o)
        charStyle?.(istd, chp)
        chp.istd = istd
        break
      }
      case 0x0835: chp.b = toggle(v, style.b); break
      case 0x0836: chp.i = toggle(v, style.i); break
      case 0x0837: chp.strike = toggle(v, style.strike); break
      case 0x083a: chp.smallCaps = toggle(v, style.smallCaps); break
      case 0x083b: chp.caps = toggle(v, style.caps); break
      case 0x083c: chp.hidden = toggle(v, style.hidden); break
      case 0x2a53: chp.strike = chp.strike || toggle(v, false); break // double strike
      case 0x2a3e: chp.u = v; break
      case 0x4a43: chp.hps = u16(g, o) || chp.hps; break
      case 0x4a61: break // complex-script size: not used for display of Latin/CJK
      case 0x2a42: if (v > 0 && v < ICO.length) chp.color = ICO[v]; else if (v === 0) chp.color = undefined; break
      case 0x6870: if (size >= 4) chp.color = colorRef(g, o); break
      case 0x2a0c: chp.highlight = v > 0 && v < HIGHLIGHT.length ? HIGHLIGHT[v] : undefined; break
      case 0x2a48: chp.iss = v; break
      case 0x8840: chp.dxaSpace = i16(g, o); break
      case 0x4a4f: chp.ftcAscii = u16(g, o); if (old) { chp.ftcFE = chp.ftcAscii; chp.ftcOther = chp.ftcAscii } break
      case 0x4a50: chp.ftcFE = u16(g, o); break
      case 0x4a51: chp.ftcOther = u16(g, o); break
      case 0x4a4e: break // ftcBi
      case 0x6a03: chp.picLocation = u32(g, o); break
      case 0x0855: chp.special = toggle(v, false); break
      case 0x080a: chp.ole = toggle(v, false); break
      case 0x0806: chp.data = toggle(v, false); break
      case 0x2a33: // sprmCPlain: back to the paragraph style's properties
        Object.assign(chp, { ...style })
        break
    }
  }
}

/** Applies paragraph sprms (table sprms go to `pap.tap`). */
export function applyPap(pap: Pap, g: Uint8Array, old: boolean): void {
  for (const [sprm, o, size] of sprms(g, old)) {
    const v = g[o]
    switch (sprm) {
      case 0x4600: pap.istd = u16(g, o); break
      case 0x2403: case 0x2461: pap.jc = v; break
      case 0x840e: case 0x845d: pap.right = i16(g, o); break
      case 0x840f: case 0x845e: pap.left = i16(g, o); break
      case 0x8411: case 0x8460: pap.first = i16(g, o); break
      case 0x6412: if (size >= 4) pap.line = { dyaLine: i16(g, o), mult: i16(g, o + 2) !== 0 }; break
      case 0xa413: pap.before = u16(g, o); break
      case 0xa414: pap.after = u16(g, o); break
      case 0x245b: pap.beforeAuto = v !== 0; break
      case 0x245c: pap.afterAuto = v !== 0; break
      case 0x2405: pap.keep = v !== 0; break
      case 0x2406: pap.keepNext = v !== 0; break
      case 0x2407: pap.pageBreakBefore = v !== 0; break
      case 0x2431: pap.widow = v !== 0; break
      case 0x246d: pap.contextual = v !== 0; break
      case 0x2416: pap.inTable = v !== 0; break
      case 0x2417: pap.ttp = v !== 0; break
      case 0x244b: if (v) pap.inTable = true; break
      case 0x244c: if (v) pap.ttp = true; break
      case 0x6649: pap.itap = u32(g, o); if (pap.itap > 0) pap.inTable = true; break
      case 0x460b: pap.ilfo = u16(g, o); break
      case 0x260a: pap.ilvl = v; break
      case 0x6646: pap.hugePapx = u32(g, o); break
      case 0xc60d: case 0xc615: changeTabs(pap, g, o, size, sprm === 0xc615); break
      case 0x6424: case 0x6425: case 0x6426: case 0x6427: {
        const side = (['top', 'left', 'bottom', 'right'] as const)[sprm - 0x6424]
        setBorder(pap, side, brc80(g, o))
        break
      }
      case 0xc64e: case 0xc64f: case 0xc650: case 0xc651: {
        const side = (['top', 'left', 'bottom', 'right'] as const)[sprm - 0xc64e]
        setBorder(pap, side, brc(g, o + 1))
        break
      }
      default:
        if ((sprm >> 10) % 8 === 5) applyTap(pap, sprm, g, o, size, old)
    }
  }
}

function brc80(g: Uint8Array, o: number): Brc | null {
  const type = g[o + 1]
  if (type === 0 || type === 0xff) return null
  const ico = g[o + 2]
  return { width: Math.max(0.25, g[o] / 8), space: g[o + 3] & 0x1f, color: ICO[ico] || '#000000' }
}

function brc(g: Uint8Array, o: number): Brc | null {
  const type = g[o + 5]
  if (type === 0 || type === 0xff) return null
  return { width: Math.max(0.25, g[o + 4] / 8), space: g[o + 6] & 0x1f, color: colorRef(g, o) ?? '#000000' }
}

function setBorder(pap: Pap, side: 'top' | 'left' | 'bottom' | 'right', b: Brc | null): void {
  pap.borders = { ...pap.borders, [side]: b ?? undefined }
}

/** sprmPChgTabsPapx / sprmPChgTabs: delete then add tab stops. */
function changeTabs(pap: Pap, g: Uint8Array, o: number, size: number, withClose: boolean): void {
  let p = o + 1 // skip cb
  const end = o + size
  const nDel = g[p++] ?? 0
  const del: number[] = []
  for (let k = 0; k < nDel && p + 2 <= end; k++, p += 2) del.push(i16(g, p))
  if (withClose) p += nDel * 2 // rgdxaClose
  const nAdd = g[p++] ?? 0
  const add: number[] = []
  for (let k = 0; k < nAdd && p + 2 <= end; k++, p += 2) add.push(i16(g, p))
  const kinds: number[] = []
  for (let k = 0; k < nAdd && p < end; k++, p++) kinds.push(g[p] & 7)
  let tabs = pap.tabs.filter((t) => !del.some((d) => Math.abs(d - t.pos) <= 2))
  tabs = tabs.filter((t) => !add.includes(t.pos))
  add.forEach((pos, k) => tabs.push({ pos, jc: kinds[k] ?? 0 }))
  tabs.sort((a, b) => a.pos - b.pos)
  pap.tabs = tabs
}

function tapOf(pap: Pap): Tap {
  return (pap.tap ??= { centers: [], gapHalf: 0, rowHeight: 0, cells: [], jc: 0 })
}

function applyTap(pap: Pap, sprm: number, g: Uint8Array, o: number, size: number, old: boolean): void {
  const tap = tapOf(pap)
  switch (sprm) {
    case 0x9602: tap.gapHalf = i16(g, o); break
    case 0x9407: tap.rowHeight = i16(g, o); break
    case 0x5400: case 0x548a: tap.jc = u16(g, o); break
    case 0xd608: {
      // operand: (cb u16 already counted in size) itcMac, rgdxaCenter[itcMac+1], rgtc80[itcMac]
      const start = old ? o : o + 2
      const itcMac = g[start]
      if (!itcMac || itcMac > 64) break
      tap.centers = []
      for (let k = 0; k <= itcMac; k++) tap.centers.push(i16(g, start + 1 + k * 2))
      const tcStart = start + 1 + (itcMac + 1) * 2
      const tcSize = old ? 10 : 20
      tap.cells = []
      for (let k = 0; k < itcMac; k++) {
        const t = tcStart + k * tcSize
        if (t + tcSize > o + size) {
          tap.cells.push({ borders: [0, 0, 0, 0], merged: false, firstMerged: false, vMerge: false, vRestart: false })
          continue
        }
        const rgf = u16(g, t)
        const brc = (p: number) => (old ? (u16(g, p) & 0x7 ? 4 : 0) : g[p + 1] === 0 || g[p + 1] === 0xff ? 0 : Math.max(1, g[p]))
        const base = old ? t + 2 : t + 4
        const step = old ? 2 : 4
        tap.cells.push({
          borders: [brc(base), brc(base + step), brc(base + 2 * step), brc(base + 3 * step)],
          firstMerged: (rgf & 1) !== 0,
          merged: (rgf & 2) !== 0,
          vMerge: (rgf & 0x20) !== 0,
          vRestart: (rgf & 0x40) !== 0
        })
      }
      break
    }
    case 0xd605: {
      // sprmTTableBorders80: six BRC80
      const b: number[] = []
      for (let k = 0; k < 6; k++) b.push(g[o + 1 + k * 4 + 1] === 0 || g[o + 1 + k * 4 + 1] === 0xff ? 0 : Math.max(1, g[o + 1 + k * 4]))
      tap.tableBorders = b
      break
    }
    case 0xd613: {
      const b: number[] = []
      for (let k = 0; k < 6; k++) b.push(g[o + 1 + k * 8 + 5] === 0 || g[o + 1 + k * 8 + 5] === 0xff ? 0 : Math.max(1, g[o + 1 + k * 8 + 4]))
      tap.tableBorders = b
      break
    }
    case 0xd634: case 0xd632: case 0xd638: {
      // CSSA cell spacing / padding: itcFirst, itcLim, grfbrc, ftsWidth, wWidth
      const grf = g[o + 3]
      const w = u16(g, o + 5)
      if (g[o + 4] !== 3) break // only twips
      if (sprm === 0xd638) break // spacing between cells: ignored
      if (grf & 1) tap.padTop = w
      if (grf & 2) tap.padLeft = w
      if (grf & 4) tap.padBottom = w
      if (grf & 8) tap.padRight = w
      break
    }
  }
}

export function applySep(sep: Sep, g: Uint8Array, old: boolean): void {
  for (const [sprm, o] of sprms(g, old)) {
    const v = g[o]
    switch (sprm) {
      case 0xb01f: sep.pageW = u16(g, o); break
      case 0xb020: sep.pageH = u16(g, o); break
      case 0xb021: sep.left = u16(g, o); break
      case 0xb022: sep.right = u16(g, o); break
      case 0x9023: sep.top = Math.abs(i16(g, o)); break
      case 0x9024: sep.bottom = Math.abs(i16(g, o)); break
      case 0xb017: sep.header = u16(g, o); break
      case 0xb018: sep.footer = u16(g, o); break
      case 0xb025: sep.gutter = u16(g, o); break
      case 0x301d: sep.landscape = v === 2; break
      case 0x500b: sep.columns = u16(g, o) + 1; break
      case 0x900c: sep.colSpace = u16(g, o); break
      case 0x3009: sep.bkc = v; break
      case 0x5032: sep.clm = u16(g, o); break
      case 0x9031: sep.linePitch = i16(g, o); break
      case 0x300a: sep.titlePage = v !== 0; break
    }
  }
  if (sep.columns < 1 || sep.columns > 45) sep.columns = 1
}

// ------------------------------------------------------------------------------------- style sheet

export interface Style {
  sti: number
  name: string
  /** 1 paragraph, 2 character, 3 table, 4 numbering. */
  stk: number
  base: number
  pap: Pap
  chp: Chp
  /** Character property groups from the root of the based-on chain to this style. */
  chpxChain: Uint8Array[]
}

interface RawStd {
  sti: number
  stk: number
  base: number
  name: string
  papx?: Uint8Array
  chpx?: Uint8Array
}

/** Reads the STSH (Word 97 layout, or Word 6/95 when `old`) and resolves every style through its
 *  based-on chain. `docChp` holds the document's default character properties. */
export function readStyleSheet(table: Uint8Array, fc: number, lcb: number, old: boolean): { styles: Style[]; defaults: Chp } {
  const defaults = defaultChp()
  const raws: (RawStd | null)[] = []
  if (lcb > 4 && fc + lcb <= table.length) {
    try {
      const g = table.subarray(fc, fc + lcb)
      const cbStshi = u16(g, 0)
      const cstd = u16(g, 2)
      const cbBase = u16(g, 4)
      if (!old && cbStshi >= 18) {
        defaults.ftcAscii = u16(g, 2 + 12)
        defaults.ftcFE = u16(g, 2 + 14)
        defaults.ftcOther = u16(g, 2 + 16)
      } else if (old && cbStshi >= 14) {
        defaults.ftcAscii = defaults.ftcFE = defaults.ftcOther = u16(g, 2 + 12)
      }
      let p = 2 + cbStshi
      for (let k = 0; k < cstd && p + 2 <= g.length; k++) {
        const cbStd = u16(g, p)
        p += 2
        if (!cbStd || p + cbStd > g.length) {
          raws.push(null)
          p += cbStd
          continue
        }
        const s = g.subarray(p, p + cbStd)
        raws.push(parseStd(s, cbBase, old))
        p += cbStd
      }
    } catch {
      // a damaged style sheet: keep what was read
    }
  }
  const styles: Style[] = []
  const resolving = new Set<number>()
  const resolve = (k: number, depth: number): Style => {
    if (styles[k]) return styles[k]
    const raw = raws[k]
    const base: Style =
      raw && raw.base !== 0xfff && raw.base !== k && raw.base < raws.length && !resolving.has(raw.base) && depth < 20
        ? (resolving.add(k), resolve(raw.base, depth + 1))
        : { sti: 0, name: '', stk: 1, base: 0xfff, pap: defaultPap(), chp: { ...defaults }, chpxChain: [] }
    resolving.delete(k)
    const pap: Pap = { ...base.pap, line: { ...base.pap.line }, tap: undefined }
    const chp: Chp = { ...base.chp }
    if (raw?.papx && raw.stk === 1) applyPap(pap, raw.papx, old)
    if (raw?.chpx) applyChp(chp, raw.chpx, base.chp, old)
    pap.istd = k
    const chpxChain = raw?.chpx ? [...base.chpxChain, raw.chpx] : base.chpxChain
    const st: Style = { sti: raw?.sti ?? 0, name: raw?.name ?? '', stk: raw?.stk ?? 1, base: raw?.base ?? 0xfff, pap, chp, chpxChain }
    styles[k] = st
    return st
  }
  for (let k = 0; k < raws.length; k++) resolve(k, 0)
  return { styles, defaults }
}

function parseStd(s: Uint8Array, cbBase: number, old: boolean): RawStd {
  const sti = u16(s, 0) & 0x0fff
  const w2 = u16(s, 2)
  const stk = w2 & 0x000f
  const base = w2 >> 4
  const cupx = u16(s, 4) & 0x000f
  let p = cbBase
  let name = ''
  if (old) {
    // Word 6/95: Pascal-style 8-bit name with a trailing NUL
    const cch = s[p] ?? 0
    for (let k = 0; k < cch && p + 1 + k < s.length; k++) name += String.fromCharCode(s[p + 1 + k])
    p += 1 + cch + 1
  } else {
    const cch = u16(s, p)
    for (let k = 0; k < cch && p + 2 + k * 2 + 1 < s.length; k++) name += String.fromCharCode(u16(s, p + 2 + k * 2))
    p += 2 + cch * 2 + 2
  }
  const upx: Uint8Array[] = []
  for (let k = 0; k < cupx && p + 2 <= s.length; k++) {
    if (p & 1) p++ // UPX start on even offsets
    const cb = u16(s, p)
    p += 2
    upx.push(s.subarray(p, Math.min(s.length, p + cb)))
    p += cb
  }
  const out: RawStd = { sti, stk, base, name }
  if (stk === 1) {
    if (upx[0] && upx[0].length >= 2) out.papx = upx[0].subarray(2) // istd first
    if (upx[1]) out.chpx = upx[1]
  } else if (stk === 2) {
    if (upx[0]) out.chpx = upx[0]
  }
  return out
}

// ------------------------------------------------------------------------------------- fonts

/** Font names from SttbfFfn (Word 97: UTF-16 names; Word 6/95: 8-bit names). */
export function readFonts(table: Uint8Array, fc: number, lcb: number, old: boolean): string[] {
  return readFontTable(table, fc, lcb, old).map((f) => f.name)
}

/** Font names with their family class (FFN ff: 1 roman, 2 swiss, 3 modern, 4 script, 5 decorative). */
export function readFontTable(table: Uint8Array, fc: number, lcb: number, old: boolean): { name: string; ff: number }[] {
  const out: { name: string; ff: number }[] = []
  if (!lcb || fc + lcb > table.length) return out
  try {
    const g = table.subarray(fc, fc + lcb)
    if (old) {
      // cbSttbf u16 then FFNs: cbFfnM1 u8, flags, wWeight(2), chs, ixchSzAlt, name (8-bit, NUL)
      let p = 2
      while (p < g.length && out.length < 1000) {
        const cb = g[p] + 1
        if (cb < 7) break
        let name = ''
        for (let k = p + 6; k < p + cb && g[k]; k++) name += String.fromCharCode(g[k])
        out.push({ name, ff: (g[p + 1] >> 4) & 7 })
        p += cb
      }
      return out
    }
    const count = u16(g, 0)
    let p = 4
    for (let k = 0; k < count && p < g.length; k++) {
      const cb = g[p] + 1
      let name = ''
      for (let q = p + 1 + 39; q + 1 < p + cb; q += 2) {
        const c = u16(g, q)
        if (!c) break
        name += String.fromCharCode(c)
      }
      out.push({ name, ff: (g[p + 1] >> 4) & 7 })
      p += cb
    }
  } catch {
    // keep what was read
  }
  return out
}

// ------------------------------------------------------------------------------------- lists

export interface ListLevel {
  start: number
  /** Number format (0 decimal, 1 upper roman, 2 lower roman, 3 upper letter, 4 lower letter, 23 bullet, 255 none...). */
  nfc: number
  /** Number text; characters 0-8 stand for the counters of those levels. */
  text: string
  /** 0 tab, 1 space, 2 nothing. */
  follow: number
  legal: boolean
  papx: Uint8Array
  chpx: Uint8Array
}

export interface Lists {
  /** lsid -> levels (1 for simple lists, otherwise 9). */
  defs: Map<number, ListLevel[]>
  /** ilfo - 1 -> lsid, and per-level start-at overrides. */
  lfo: { lsid: number; startAt: Map<number, number> }[]
}

export function readLists(table: Uint8Array, fcLst: number, lcbLst: number, fcLfo: number, lcbLfo: number): Lists {
  const out: Lists = { defs: new Map(), lfo: [] }
  try {
    if (lcbLst >= 2 && fcLst + lcbLst <= table.length) {
      const g = table
      const n = u16(g, fcLst)
      const lsts: { lsid: number; simple: boolean }[] = []
      for (let k = 0; k < n && k < 1000; k++) {
        const o = fcLst + 2 + k * 28
        if (o + 28 > g.length) break
        lsts.push({ lsid: u32(g, o) | 0, simple: (g[o + 26] & 1) !== 0 })
      }
      let p = fcLst + 2 + n * 28
      for (const l of lsts) {
        const levels: ListLevel[] = []
        for (let v = 0; v < (l.simple ? 1 : 9); v++) {
          if (p + 28 > g.length) break
          const start = u32(g, p) | 0
          const nfc = g[p + 4]
          const legal = (g[p + 5] & 0x04) !== 0
          const follow = g[p + 15]
          const cbChpx = g[p + 24]
          const cbPapx = g[p + 25]
          p += 28
          const papx = g.subarray(p, Math.min(g.length, p + cbPapx))
          p += cbPapx
          const chpx = g.subarray(p, Math.min(g.length, p + cbChpx))
          p += cbChpx
          const cch = u16(g, p)
          p += 2
          let text = ''
          for (let c = 0; c < cch && p + c * 2 + 1 < g.length; c++) text += String.fromCharCode(u16(g, p + c * 2))
          p += cch * 2
          levels.push({ start, nfc, text, follow, legal, papx, chpx })
        }
        out.defs.set(l.lsid, levels)
      }
    }
    if (lcbLfo >= 4 && fcLfo + lcbLfo <= table.length) {
      const g = table
      const n = u32(g, fcLfo)
      const lfos: { lsid: number; clfolvl: number }[] = []
      for (let k = 0; k < n && k < 2000; k++) {
        const o = fcLfo + 4 + k * 16
        if (o + 16 > g.length) break
        lfos.push({ lsid: u32(g, o) | 0, clfolvl: g[o + 12] })
      }
      // LFOData: cp, then clfolvl LFOLVL (iStartAt i32, ilvl:4 + fStartAt:1 + fFormatting:1 ..., then an LVL when fFormatting)
      let p = fcLfo + 4 + n * 16
      for (const l of lfos) {
        const startAt = new Map<number, number>()
        p += 4
        for (let k = 0; k < l.clfolvl && p + 8 <= g.length; k++) {
          const iStartAt = u32(g, p) | 0
          const bits = u32(g, p + 4)
          const ilvl = bits & 0xf
          if (bits & 0x10) startAt.set(ilvl, iStartAt)
          p += 8
          if (bits & 0x20) {
            // a full LVL follows: skip it
            const cbChpx = g[p + 24]
            const cbPapx = g[p + 25]
            p += 28 + cbPapx + cbChpx
            const cch = u16(g, p)
            p += 2 + cch * 2
          }
        }
        out.lfo.push({ lsid: l.lsid, startAt })
      }
    }
  } catch {
    // damaged list tables: no numbering
  }
  return out
}

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
const GANADA = '가나다라마바사아자차카타파하'
const CHOSUNG = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'

export function formatNumber(n: number, nfc: number): string {
  if (n < 0) n = 0
  switch (nfc) {
    case 1:
    case 2: {
      let s = ''
      let v = Math.min(n, 3999)
      for (const [k, r] of ROMAN) while (v >= k) { s += r; v -= k }
      return nfc === 1 ? s.toUpperCase() : s
    }
    case 3:
    case 4: {
      if (n <= 0) return ''
      const ch = String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1)
      return nfc === 3 ? ch.toUpperCase() : ch
    }
    case 5: return `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`
    case 22: return n < 10 ? `0${n}` : String(n)
    case 24: return n > 0 ? GANADA[(n - 1) % GANADA.length] : ''
    case 25: return n > 0 ? CHOSUNG[(n - 1) % CHOSUNG.length] : ''
    case 255: return ''
    default: return String(n)
  }
}

/** Symbol / Wingdings private-use bullets as ordinary Unicode characters. */
export function bulletChar(c: string): string {
  const map: Record<number, string> = {
    0xf0b7: '•', 0xf0a7: '▪', 0xf0fc: '✓', 0xf0d8: '➢', 0xf076: '❖', 0xf06e: '■', 0xf071: '❑', 0xf0a8: '□', 0xf06f: '□',
    0xf075: '◆', 0xf0e0: '➔', 0xf0f0: '⇨', 0xf0a1: '○', 0xf0b0: '°', 0xf02d: '-', 0xf0de: '⇒', 0xf0d7: '▪'
  }
  return [...c].map((ch) => map[ch.charCodeAt(0)] ?? (ch.charCodeAt(0) >= 0xf020 && ch.charCodeAt(0) <= 0xf0ff ? '•' : ch)).join('')
}
