/** Word 97-2003 binary (.doc) reader: FIB, piece table, paragraph and character properties
 *  (FKPs), style sheet, then Word's control characters become paragraphs, tables and breaks. */
import { findPictures } from './blip.ts'
import type { Cfb } from './cfb.ts'
import type { Block, DocModel, Paragraph, Picture, Run } from './model.ts'

export class WordError extends Error {
  readonly code: 'encrypted' | 'old' | 'corrupt'
  constructor(code: 'encrypted' | 'old' | 'corrupt', message: string) {
    super(message)
    this.code = code
  }
}

interface Piece {
  cpStart: number
  cpEnd: number
  /** Byte offset of the piece's first character in WordDocument. */
  fc: number
  compressed: boolean
}

interface PropRun {
  fcStart: number
  fcEnd: number
  grpprl: Uint8Array
}

interface CharProps {
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  hidden?: boolean
  color?: string
  pt?: number
  sup?: boolean
  sub?: boolean
  picLocation?: number
  special?: boolean
  ole?: boolean
}

interface ParaProps {
  istd: number
  inTable: boolean
  ttp: boolean
  ilfo: number
  pageBreakBefore?: boolean
  jc?: number
  indent?: number
}

const ICO = ['', '#000000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#ffff00', '#ffffff', '#000080',
  '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0']

/** Operand length of a sprm at `off` (the two sprm bytes excluded). */
function sprmSize(sprm: number, b: Uint8Array, off: number): number {
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

function* sprms(g: Uint8Array): Generator<[number, number, number]> {
  let i = 0
  while (i + 2 <= g.length) {
    const sprm = g[i] | (g[i + 1] << 8)
    const size = sprmSize(sprm, g, i + 2)
    yield [sprm, i + 2, size]
    i += 2 + size
  }
}

export function readWord(cfb: Cfb): DocModel {
  const wd = cfb.stream('WordDocument')
  if (!wd || wd.length < 0x200) throw new WordError('corrupt', 'no WordDocument stream')
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength)
  const u16 = (o: number) => dv.getUint16(o, true)
  const u32 = (o: number) => dv.getUint32(o, true)
  if (u16(0) !== 0xa5ec && u16(0) !== 0xa5dc) throw new WordError('corrupt', 'bad FIB')
  const nFib = u16(2)
  const flags = u16(0x0a)
  if (flags & 0x0100) throw new WordError('encrypted', 'encrypted')
  const warnings: string[] = []
  if (nFib < 0xc1) return readWord95(wd, nFib)

  const csw = u16(0x20)
  const lwBase = 0x22 + csw * 2 + 2
  const cslw = u16(lwBase - 2)
  const lw = (i: number) => (i < cslw ? u32(lwBase + i * 4) : 0)
  const fcBase = lwBase + cslw * 4 + 2
  const cbRgFcLcb = u16(fcBase - 2)
  const fcLcb = (i: number): [number, number] =>
    i < cbRgFcLcb && fcBase + i * 8 + 8 <= wd.length ? [u32(fcBase + i * 8), u32(fcBase + i * 8 + 4)] : [0, 0]

  const table = cfb.stream(flags & 0x0200 ? '1Table' : '0Table')
  if (!table) throw new WordError('corrupt', 'no table stream')
  const tdv = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const data = cfb.stream('Data')

  // Piece table from the CLX.
  const [fcClx, lcbClx] = fcLcb(33)
  const pieces: Piece[] = []
  let p = fcClx
  const clxEnd = Math.min(table.length, fcClx + lcbClx)
  while (p < clxEnd) {
    if (table[p] === 0x01) {
      p += 3 + tdv.getInt16(p + 1, true)
      continue
    }
    if (table[p] !== 0x02) break
    const lcb = tdv.getUint32(p + 1, true)
    const start = p + 5
    const n = Math.floor((lcb - 4) / 12)
    for (let k = 0; k < n; k++) {
      const cpStart = tdv.getUint32(start + k * 4, true)
      const cpEnd = tdv.getUint32(start + (k + 1) * 4, true)
      const raw = tdv.getUint32(start + (n + 1) * 4 + k * 8 + 2, true)
      const compressed = (raw & 0x40000000) !== 0
      const fcv = raw & 0x3fffffff
      pieces.push({ cpStart, cpEnd, fc: compressed ? fcv / 2 : fcv, compressed })
    }
    break
  }
  if (!pieces.length) throw new WordError('corrupt', 'no piece table')

  const runsFrom = (plcIndex: number, papx: boolean): PropRun[] => {
    const [fc, lcb] = fcLcb(plcIndex)
    const out: PropRun[] = []
    if (!lcb || fc + lcb > table.length) return out
    const n = (lcb - 4) / 8
    for (let k = 0; k < n; k++) {
      const pn = tdv.getUint32(fc + (n + 1) * 4 + k * 4, true) & 0x3fffff
      const page = pn * 512
      if (page + 512 > wd.length) continue
      const crun = wd[page + 511]
      for (let r = 0; r < crun; r++) {
        const fcStart = u32(page + r * 4)
        const fcEnd = u32(page + (r + 1) * 4)
        let grpprl: Uint8Array
        if (papx) {
          const bOff = wd[page + (crun + 1) * 4 + r * 13] * 2
          if (!bOff) {
            grpprl = new Uint8Array(0)
          } else {
            let cb = wd[page + bOff]
            let at = page + bOff + 1
            let len: number
            if (cb === 0) {
              cb = wd[at]
              at++
              len = cb * 2
            } else len = cb * 2 - 1
            grpprl = wd.subarray(at, Math.min(at + len, page + 511))
          }
        } else {
          const bOff = wd[page + (crun + 1) * 4 + r] * 2
          grpprl = bOff ? wd.subarray(page + bOff + 1, page + bOff + 1 + wd[page + bOff]) : new Uint8Array(0)
        }
        out.push({ fcStart, fcEnd, grpprl })
      }
    }
    out.sort((a, b) => a.fcStart - b.fcStart)
    return out
  }
  const chpRuns = runsFrom(12, false)
  const papRuns = runsFrom(13, true)
  const find = (runs: PropRun[], fc: number): PropRun | null => {
    let lo = 0
    let hi = runs.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const r = runs[mid]
      if (fc < r.fcStart) hi = mid - 1
      else if (fc >= r.fcEnd) lo = mid + 1
      else return r
    }
    return null
  }

  // Styles: istd -> sti and name (headings, title, list styles).
  const styles = readStyles(table, fcLcb(1))
  const styleKind = (istd: number): { heading?: number; list?: boolean } => {
    const s = styles[istd]
    if (!s) return {}
    if (s.sti >= 1 && s.sti <= 9) return { heading: Math.min(6, s.sti) }
    if (s.sti === 62) return { heading: 0 }
    const m = /^(?:heading|제목)\s*(\d)/i.exec(s.name)
    if (m) return { heading: Math.min(6, Number(m[1]) || 1) }
    if (/^title$/i.test(s.name)) return { heading: 0 }
    if ((s.sti >= 47 && s.sti <= 55) || /list (bullet|number)/i.test(s.name)) return { list: true }
    return {}
  }

  const chpCache = new Map<PropRun, CharProps>()
  const charProps = (fc: number): CharProps => {
    const r = find(chpRuns, fc)
    if (!r) return {}
    let c = chpCache.get(r)
    if (c) return c
    c = {}
    const g = r.grpprl
    for (const [sprm, o, size] of sprms(g)) {
      const v = g[o]
      const on = v === 1 || v === 0x81
      switch (sprm) {
        case 0x0835: c.b = on; break
        case 0x0836: c.i = on; break
        case 0x0837: c.s = on; break
        case 0x083c: c.hidden = on; break
        case 0x2a3e: c.u = v !== 0; break
        case 0x4a43: c.pt = (v | (g[o + 1] << 8)) / 2; break
        case 0x2a42: if (v > 0 && v < ICO.length) c.color = ICO[v]; break
        case 0x6870:
          if (size === 4 && g[o + 3] === 0) c.color = `rgb(${g[o]},${g[o + 1]},${g[o + 2]})`
          break
        case 0x2a48: c.sup = v === 1; c.sub = v === 2; break
        case 0x6a03: c.picLocation = v | (g[o + 1] << 8) | (g[o + 2] << 16) | (g[o + 3] << 24); break
        case 0x0855: c.special = on; break
        case 0x080a: c.ole = on; break
      }
    }
    chpCache.set(r, c)
    return c
  }
  const paraProps = (fc: number): ParaProps => {
    const out: ParaProps = { istd: 0, inTable: false, ttp: false, ilfo: 0 }
    const r = find(papRuns, fc)
    if (!r || r.grpprl.length < 2) return out
    const g = r.grpprl
    out.istd = g[0] | (g[1] << 8)
    for (const [sprm, o] of sprms(g.subarray(2))) {
      const at = o + 2
      const v = g[at]
      switch (sprm) {
        case 0x2416: out.inTable = v !== 0; break
        case 0x2417: out.ttp = v !== 0; break
        case 0x244b: if (v) out.inTable = true; break
        case 0x244c: if (v) out.ttp = true; break
        case 0x6649: if ((v | (g[at + 1] << 8)) > 0) out.inTable = true; break
        case 0x2407: out.pageBreakBefore = v !== 0; break
        case 0x460b: out.ilfo = v | (g[at + 1] << 8); break
        case 0x2403:
        case 0x2461: out.jc = v; break
        case 0x840f:
        case 0x845e: out.indent = ((v | (g[at + 1] << 8)) << 16) >> 16; break
      }
    }
    return out
  }

  const pictureAt = (loc: number | undefined): Picture | null => {
    if (!data || loc == null || loc + 0x44 > data.length) return null
    const ddv = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const lcb = ddv.getUint32(loc, true)
    const cbHeader = ddv.getUint16(loc + 4, true)
    if (lcb < cbHeader || loc + lcb > data.length) return null
    const pics = findPictures(data, loc + cbHeader, loc + lcb)
    const pic = pics[0]
    if (!pic) return null
    const dxa = ddv.getUint16(loc + 0x1c, true)
    const dya = ddv.getUint16(loc + 0x1e, true)
    const mx = ddv.getUint16(loc + 0x20, true) || 1000
    const my = ddv.getUint16(loc + 0x22, true) || 1000
    if (dxa && dya) {
      pic.width = Math.round(((dxa * mx) / 1000 / 1440) * 96)
      pic.height = Math.round(((dya * my) / 1000 / 1440) * 96)
    }
    return pic
  }

  // Text of one story (CP range) through the piece table, as (char, fc) pairs per piece.
  const story = (cpFrom: number, cpTo: number): Block[] => {
    const blocks: Block[] = []
    let runs: Run[] = []
    let cur: Run | null = null
    let curProps: CharProps | null = null
    const fields: boolean[] = [] // true while in a field's code part
    let tableRows: Block[][][] | null = null
    let row: Block[][] = []
    let cell: Block[] = []
    let lastWasCellEnd = false

    const pushChar = (ch: string, props: CharProps) => {
      if (cur && curProps === props) {
        cur.text += ch
        return
      }
      cur = { text: ch, b: props.b, i: props.i, u: props.u, s: props.s, color: props.color, sup: props.sup, sub: props.sub }
      if (props.pt) cur.pt = props.pt
      curProps = props
      runs.push(cur)
    }
    const endPara = (mark: string, fc: number) => {
      const pp = paraProps(fc)
      const kind = styleKind(pp.istd)
      const para: Paragraph = { kind: 'p', runs: runs.filter((r) => r.text || r.image || r.object) }
      if (kind.heading != null) para.heading = kind.heading
      if (kind.list || pp.ilfo > 0) para.list = true
      if (pp.jc === 1) para.align = 'center'
      else if (pp.jc === 2) para.align = 'right'
      else if (pp.jc === 3 || pp.jc === 4) para.align = 'justify'
      if (pp.indent && pp.indent > 0 && !para.list) para.indent = Math.round((pp.indent / 1440) * 96)
      runs = []
      cur = null
      curProps = null
      const inTable = pp.inTable || (mark === '\x07' && chpRuns.length === 0)
      if (inTable) {
        tableRows ??= []
        const rowEnd = mark === '\x07' && (pp.ttp || (papRuns.length === 0 && lastWasCellEnd && !para.runs.length))
        if (rowEnd) {
          if (row.length) tableRows.push(row)
          row = []
          cell = []
        } else if (mark === '\x07') {
          cell.push(para)
          row.push(cell)
          cell = []
        } else cell.push(para)
        lastWasCellEnd = mark === '\x07'
        return
      }
      lastWasCellEnd = false
      if (tableRows) closeTable()
      if (pp.pageBreakBefore && blocks.length && blocks[blocks.length - 1].kind !== 'break') blocks.push({ kind: 'break' })
      blocks.push(para)
    }
    const closeTable = () => {
      if (cell.length) row.push(cell)
      if (row.length) tableRows!.push(row)
      if (tableRows!.length) blocks.push({ kind: 'table', rows: tableRows! })
      tableRows = null
      row = []
      cell = []
    }

    for (const pc of pieces) {
      const a = Math.max(pc.cpStart, cpFrom)
      const b = Math.min(pc.cpEnd, cpTo)
      if (a >= b) continue
      const off = pc.compressed ? pc.fc + (a - pc.cpStart) : pc.fc + 2 * (a - pc.cpStart)
      const n = b - a
      const raw = pc.compressed ? wd.subarray(off, off + n) : wd.subarray(off, off + 2 * n)
      const text = new TextDecoder(pc.compressed ? 'windows-1252' : 'utf-16le').decode(raw)
      const step = pc.compressed ? 1 : 2
      for (let k = 0; k < text.length; k++) {
        const ch = text[k]
        const fc = off + k * step
        const code = ch.charCodeAt(0)
        if (code === 0x13) {
          fields.push(true)
          continue
        }
        if (code === 0x14) {
          if (fields.length) fields[fields.length - 1] = false
          continue
        }
        if (code === 0x15) {
          fields.pop()
          continue
        }
        if (code === 0x0d || code === 0x07) {
          endPara(ch, fc)
          continue
        }
        if (fields.some((f) => f)) continue
        const props = charProps(fc)
        if (props.hidden) continue
        if (code === 0x0c) {
          if (runs.length) endPara('\r', fc)
          if (tableRows) closeTable()
          blocks.push({ kind: 'break' })
          continue
        }
        if (code === 0x01) {
          if (props.ole) {
            runs.push({ text: '', object: 'OLE' })
            cur = null
            continue
          }
          const pic = pictureAt(props.picLocation)
          runs.push(pic ? { text: '', image: pic } : { text: '', object: 'picture' })
          cur = null
          continue
        }
        if (code === 0x08 || code === 0x02 || code === 0x03 || code === 0x04 || code === 0x05 || code === 0x28 && props.special) continue
        if (code === 0x0b || code === 0x0e) {
          pushChar('\n', props)
          continue
        }
        if (code === 0x1e) {
          pushChar('-', props)
          continue
        }
        if (code === 0x1f) continue
        if (code < 0x20 && code !== 0x09) continue
        pushChar(code === 0xa0 ? ' ' : ch, props)
      }
    }
    if (runs.length) endPara('\r', -1)
    if (tableRows) closeTable()
    return blocks
  }

  const ccpText = lw(3)
  const ccpFtn = lw(4)
  const ccpHdd = lw(5)
  const ccpAtn = lw(7)
  const ccpEdn = lw(8)
  const ccpTxbx = lw(9)
  const blocks = story(0, ccpText)
  let cp = ccpText
  const extra = (title: string, len: number) => {
    if (len > 1) {
      const b = story(cp, cp + len).filter((x) => x.kind !== 'p' || x.runs.some((r) => r.text.trim() || r.image))
      if (b.length) blocks.push({ kind: 'section', title }, ...b)
    }
    cp += len
  }
  extra('footnotes', ccpFtn)
  cp += ccpHdd
  cp += ccpAtn
  extra('endnotes', ccpEdn)
  extra('textboxes', ccpTxbx)
  if (flags & 0x8000) warnings.push('obfuscated')
  return { blocks, variant: 'Word 97-2003', warnings }
}

interface StyleInfo {
  sti: number
  name: string
}

function readStyles(table: Uint8Array, [fc, lcb]: [number, number]): StyleInfo[] {
  const out: StyleInfo[] = []
  if (!lcb || fc + lcb > table.length) return out
  try {
    const dv = new DataView(table.buffer, table.byteOffset + fc, lcb)
    const cbStshi = dv.getUint16(0, true)
    const cstd = dv.getUint16(2, true)
    const cbBase = dv.getUint16(4, true)
    let p = 2 + cbStshi
    for (let i = 0; i < cstd && p + 2 <= lcb; i++) {
      const cbStd = dv.getUint16(p, true)
      p += 2
      if (cbStd >= 10 && p + cbStd <= lcb) {
        const sti = dv.getUint16(p, true) & 0x0fff
        let name = ''
        const np = p + cbBase
        if (np + 2 <= p + cbStd) {
          const cch = dv.getUint16(np, true)
          for (let k = 0; k < cch && np + 2 + k * 2 + 2 <= p + cbStd; k++) name += String.fromCharCode(dv.getUint16(np + 2 + k * 2, true))
        }
        out[i] = { sti, name }
      }
      p += cbStd
    }
  } catch {
    // a damaged style sheet only costs heading detection
  }
  return out
}

/** Word 6 / 95: no piece table we understand; take the plain text between fcMin and fcMac. */
function readWord95(wd: Uint8Array, nFib: number): DocModel {
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength)
  const fcMin = dv.getUint32(0x18, true)
  const fcMac = dv.getUint32(0x1c, true)
  if (!(fcMin < fcMac && fcMac <= wd.length)) throw new WordError('old', `nFib ${nFib}`)
  const raw = wd.subarray(fcMin, fcMac)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    text = new TextDecoder('windows-1252').decode(raw)
  }
  const blocks: Block[] = []
  for (const line of text.split(/[\r\x07]/)) {
    const clean = line.replace(/\x13[^\x14\x15]*\x14?|\x15/g, '').replace(/[\x00-\x08\x0e-\x1f]/g, '')
    if (clean.includes('\x0c')) blocks.push({ kind: 'break' })
    blocks.push({ kind: 'p', runs: [{ text: clean.replace(/\x0c/g, '').replace(/\x0b/g, '\n') }] })
  }
  return { blocks, variant: `Word 6/95 (nFib ${nFib})`, warnings: ['old'] }
}
