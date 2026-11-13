/** Word binary (.doc) reader for Word 97-2003 and Word 6/95: FIB, piece table, paragraph and
 *  character properties (FKPs) resolved through the style sheet, sections with their page setup,
 *  headers and footers, then Word's control characters become paragraphs, tables and breaks. */
import { findPictures } from './blip.ts'
import type { Cfb } from './cfb.ts'
import type { Block, DocModel, PageFmt, Paragraph, Picture, RowFmt, Run } from './model.ts'
import {
  applyChp,
  applyPap,
  applySep,
  bulletChar,
  defaultPap,
  defaultSep,
  formatNumber,
  readLists,
  readFontTable,
  readStyleSheet,
  type Chp,
  type ListLevel,
  type Pap,
  type Sep,
  type Style,
  type Tap
} from './wordfmt.ts'

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

/** Text gathered for the paragraph being read; formatting is resolved at its paragraph mark. */
type Item =
  | { kind: 'text'; text: string; run: PropRun | null }
  | { kind: 'pic'; run: PropRun | null }
  | { kind: 'box'; run: PropRun | null }

const TW = 20 // twips per point

export function readWord(cfb: Cfb): DocModel {
  const wd = cfb.stream('WordDocument')
  if (!wd || wd.length < 0x200) throw new WordError('corrupt', 'no WordDocument stream')
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength)
  const u16 = (o: number) => (o + 2 <= wd.length ? dv.getUint16(o, true) : 0)
  const u32 = (o: number) => (o + 4 <= wd.length ? dv.getUint32(o, true) : 0)
  if (u16(0) !== 0xa5ec && u16(0) !== 0xa5dc) throw new WordError('corrupt', 'bad FIB')
  const nFib = u16(2)
  const flags = u16(0x0a)
  if (flags & 0x0100) throw new WordError('encrypted', 'encrypted')
  const warnings: string[] = []
  if (nFib < 100) return readPlainOld(wd, nFib)
  const old = nFib < 0xc1

  // FIB: the fc/lcb pairs and character counts.
  let fcLcb: (i: number) => [number, number]
  let ccp: (i: number) => number
  if (old) {
    fcLcb = (i) => [u32(0x58 + i * 8), u32(0x58 + i * 8 + 4)]
    ccp = (i) => u32(0x34 + i * 4)
  } else {
    const csw = u16(0x20)
    const lwBase = 0x22 + csw * 2 + 2
    const cslw = u16(lwBase - 2)
    const fcBase = lwBase + cslw * 4 + 2
    const cbRgFcLcb = u16(fcBase - 2)
    fcLcb = (i) => (i < cbRgFcLcb && fcBase + i * 8 + 8 <= wd.length ? [u32(fcBase + i * 8), u32(fcBase + i * 8 + 4)] : [0, 0])
    // fibRgLw: 3 ccpText, 4 ccpFtn, 5 ccpHdd, 6 reserved, 7 ccpAtn, 8 ccpEdn, 9 ccpTxbx, 10 ccpHdrTxbx
    ccp = (i) => (3 + i < cslw ? u32(lwBase + (3 + i) * 4) : 0)
  }
  // ccp(i): 0 text, 1 footnotes, 2 headers, 3 macro (old) / reserved, 4 annotations, 5 endnotes, 6 text boxes
  const table = old ? wd : cfb.stream(flags & 0x0200 ? '1Table' : '0Table')
  if (!table) throw new WordError('corrupt', 'no table stream')
  const tdv = new DataView(table.buffer, table.byteOffset, table.byteLength)
  const tu16 = (o: number) => (o + 2 <= table.length ? tdv.getUint16(o, true) : 0)
  const tu32 = (o: number) => (o + 4 <= table.length ? tdv.getUint32(o, true) : 0)
  const data = cfb.stream('Data')

  // Piece table from the CLX (Word 6/95 files saved without fast-save have none: one piece).
  const [fcClx, lcbClx] = fcLcb(33)
  const pieces: Piece[] = []
  let p = fcClx
  const clxEnd = Math.min(table.length, fcClx + lcbClx)
  while (lcbClx && p + 5 <= clxEnd) {
    if (table[p] === 0x01) {
      // Prc: cbGrpprl is unsigned in practice; the offset must strictly increase.
      const next = p + 3 + tu16(p + 1)
      if (next <= p) break
      p = next
      continue
    }
    if (table[p] !== 0x02) break
    const lcb = tu32(p + 1)
    const start = p + 5
    const n = Math.max(0, Math.min(Math.floor((lcb - 4) / 12), Math.floor((clxEnd - start - 4) / 12)))
    for (let k = 0; k < n; k++) {
      const cpStart = tu32(start + k * 4)
      const cpEnd = tu32(start + (k + 1) * 4)
      const raw = tu32(start + (n + 1) * 4 + k * 8 + 2)
      if (old) pieces.push({ cpStart, cpEnd, fc: raw, compressed: true })
      else {
        const compressed = (raw & 0x40000000) !== 0
        const fcv = raw & 0x3fffffff
        pieces.push({ cpStart, cpEnd, fc: compressed ? fcv / 2 : fcv, compressed })
      }
    }
    break
  }
  if (!pieces.length) {
    const fcMin = u32(0x18)
    const fcMac = u32(0x1c)
    if (!old || !(fcMin < fcMac && fcMac <= wd.length)) throw new WordError('corrupt', 'no piece table')
    pieces.push({ cpStart: 0, cpEnd: fcMac - fcMin, fc: fcMin, compressed: true })
  }

  // FKPs: character and paragraph property runs.
  const runsFrom = (plcIndex: number, papx: boolean): PropRun[] => {
    const [fc, lcb] = fcLcb(plcIndex)
    const out: PropRun[] = []
    if (!lcb || fc + lcb > table.length) return out
    const pnSize = old ? 2 : 4
    const n = Math.floor((lcb - 4) / (4 + pnSize))
    const seen = new Set<number>()
    for (let k = 0; k < n; k++) {
      const pnAt = fc + (n + 1) * 4 + k * pnSize
      const pn = (old ? tu16(pnAt) : tu32(pnAt)) & 0x3fffff
      if (seen.has(pn)) continue
      seen.add(pn)
      const page = pn * 512
      if (page + 512 > wd.length) continue
      const crun = wd[page + 511]
      if (crun > 101) continue
      for (let r = 0; r < crun; r++) {
        const fcStart = u32(page + r * 4)
        const fcEnd = u32(page + (r + 1) * 4)
        let grpprl: Uint8Array
        if (papx) {
          const bxSize = old ? 7 : 13
          const bOff = wd[page + (crun + 1) * 4 + r * bxSize] * 2
          if (!bOff) {
            grpprl = new Uint8Array(0)
          } else {
            let cb = wd[page + bOff]
            let at = page + bOff + 1
            let len: number
            if (old) len = cb * 2
            else if (cb === 0) {
              cb = wd[at]
              at++
              len = cb * 2
            } else len = cb * 2 - 1
            grpprl = wd.subarray(at, Math.min(at + len, page + 511))
          }
        } else {
          const bOff = wd[page + (crun + 1) * 4 + r] * 2
          grpprl = bOff ? wd.subarray(page + bOff + 1, Math.min(page + 511, page + bOff + 1 + wd[page + bOff])) : new Uint8Array(0)
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

  // Styles and fonts.
  const [fcStsh, lcbStsh] = fcLcb(1)
  const { styles, defaults } = readStyleSheet(table, fcStsh, lcbStsh, old)
  const [fcFfn, lcbFfn] = fcLcb(15)
  const fontTable = readFontTable(table, fcFfn, lcbFfn, old)
  const fonts = fontTable.map((f) => f.name)
  const fontClasses: Record<string, number> = {}
  for (const f of fontTable) if (f.name) fontClasses[f.name] = f.ff
  const styleAt = (istd: number): Style | undefined => styles[istd]
  const normalStyle = styles[0]
  const baseChp: Chp = normalStyle?.chp ?? { ...defaults }

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

  const lists = old ? null : readLists(table, ...fcLcb(73), ...fcLcb(74))
  const listLevel = (pap: Pap): { lsid: number; level: ListLevel; ilfo: number } | null => {
    if (!lists || pap.ilfo <= 0 || pap.ilfo === 2047) return null
    const lfo = lists.lfo[pap.ilfo - 1]
    const levels = lfo && lists.defs.get(lfo.lsid)
    if (!levels || !levels.length) return null
    const ilvl = Math.min(levels.length - 1, Math.max(0, pap.ilvl))
    return { lsid: lfo.lsid, level: levels[ilvl], ilfo: pap.ilfo }
  }
  const counters = new Map<number, (number | undefined)[]>()

  const charStyle = (istd: number, target: Chp) => {
    const st = styleAt(istd)
    if (!st || st.stk !== 2) return
    for (const g of st.chpxChain) applyChp(target, g, target, old)
  }
  const chpCache = new Map<string, Chp>()
  let chpIds = new WeakMap<PropRun, number>()
  let nextId = 1
  const resolveChp = (run: PropRun | null, istd: number): Chp => {
    const style = styleAt(istd)?.chp ?? baseChp
    if (!run || !run.grpprl.length) return style
    let id = chpIds.get(run)
    if (id == null) {
      id = nextId++
      chpIds.set(run, id)
    }
    const key = `${id}:${istd}`
    let c = chpCache.get(key)
    if (c) return c
    c = { ...style }
    applyChp(c, run.grpprl, style, old, charStyle)
    chpCache.set(key, c)
    return c
  }
  const resolvePap = (fc: number): Pap => {
    const r = find(papRuns, fc)
    const g = r?.grpprl
    const istd = g && g.length >= 2 ? g[0] | (g[1] << 8) : 0
    const st = styleAt(istd) ?? normalStyle
    const pap: Pap = st ? { ...st.pap, line: { ...st.pap.line }, tap: undefined, hugePapx: undefined } : resolveDefaultPap()
    pap.istd = istd
    const direct = (target: Pap) => {
      if (g && g.length > 2) applyPap(target, g.subarray(2), old)
      if (target.hugePapx != null && data && target.hugePapx + 2 <= data.length) {
        const cb = data[target.hugePapx] | (data[target.hugePapx + 1] << 8)
        applyPap(target, data.subarray(target.hugePapx + 2, Math.min(data.length, target.hugePapx + 2 + cb)), old)
      }
    }
    direct(pap)
    // List paragraphs: style, then the list level's indents, then direct formatting.
    const lv = listLevel(pap)
    if (lv && lv.level.papx.length) {
      const again: Pap = st ? { ...st.pap, line: { ...st.pap.line }, tap: undefined, hugePapx: undefined } : resolveDefaultPap()
      again.istd = istd
      applyPap(again, lv.level.papx, old)
      direct(again)
      return again
    }
    return pap
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

  // Sections: CP ranges with their page setup.
  const sections: { cpEnd: number; sep: Sep }[] = []
  {
    const [fc, lcb] = fcLcb(6)
    const n = lcb >= 16 ? Math.floor((lcb - 4) / 16) : 0
    for (let k = 0; k < n && k < 1000; k++) {
      const cpEnd = tu32(fc + (k + 1) * 4)
      const fcSepx = tu32(fc + (n + 1) * 4 + k * 12 + 2)
      const sep = defaultSep()
      if (fcSepx !== 0xffffffff && fcSepx + 2 <= wd.length) {
        const cb = u16(fcSepx)
        applySep(sep, wd.subarray(fcSepx + 2, Math.min(wd.length, fcSepx + 2 + cb)), old)
      }
      sections.push({ cpEnd, sep })
    }
  }
  if (!sections.length) sections.push({ cpEnd: Number.MAX_SAFE_INTEGER, sep: defaultSep() })
  const pageFmt = (sep: Sep, first: boolean): PageFmt => {
    let w = sep.pageW / TW
    let hgt = sep.pageH / TW
    if (sep.landscape && w < hgt) [w, hgt] = [hgt, w]
    if (!(w > 72 && w < 6000)) w = 612
    if (!(hgt > 72 && hgt < 6000)) hgt = 792
    const clampM = (v: number, max: number) => Math.max(0, Math.min(v / TW, max * 0.45))
    return {
      w,
      h: hgt,
      top: clampM(sep.top, hgt),
      bottom: clampM(sep.bottom, hgt),
      left: clampM(sep.left + sep.gutter, w),
      right: clampM(sep.right, w),
      header: clampM(sep.header, hgt),
      footer: clampM(sep.footer, hgt),
      columns: sep.columns,
      colSpace: sep.colSpace / TW,
      newPage: first || sep.bkc !== 0,
      linePitch: sep.clm ? Math.max(0, sep.linePitch / TW) : 0
    }
  }

  const fontName = (ftc: number) => fonts[ftc] || undefined
  const pt = (tw: number) => tw / TW

  /** Turns one CP range into blocks. `withSections` emits section starts (main text only). */
  const story = (cpFrom: number, cpTo: number, withSections: boolean): Block[] => {
    const blocks: Block[] = []
    let items: Item[] = []
    const fields: boolean[] = [] // true while in a field's code part
    let inCode = 0 // how many entries of `fields` are true
    let fieldCode = '' // code text of the innermost field
    let fieldRun: PropRun | null = null
    let tableRows: Block[][][] | null = null
    let rowFmts: (RowFmt | undefined)[] = []
    let row: Block[][] = []
    let cell: Block[] = []
    let lastWasCellEnd = false
    let secIndex = -1

    const enterSection = (cp: number) => {
      if (!withSections) return
      let s = secIndex < 0 ? 0 : secIndex
      while (s < sections.length - 1 && cp >= sections[s].cpEnd) s++
      if (s === secIndex) return
      if (tableRows) closeTable()
      for (let k = secIndex + 1; k <= s; k++) blocks.push({ kind: 'sect', page: pageFmt(sections[k].sep, k === 0) })
      secIndex = s
    }

    const pushText = (text: string, run: PropRun | null) => {
      const last = items[items.length - 1]
      if (last && last.kind === 'text' && last.run === run) last.text += text
      else items.push({ kind: 'text', text, run })
    }

    const endPara = (mark: string, fc: number, markCp: number) => {
      const pap = resolvePap(fc)
      const istd = pap.istd
      const runs: Run[] = []
      for (const it of items) {
        const chp = resolveChp(it.run, istd)
        if (it.kind === 'box') {
          runs.push({ text: '', checkbox: true, pt: chp.hps / 2, font: fontName(chp.ftcAscii) })
          continue
        }
        if (it.kind === 'pic') {
          if (chp.ole) runs.push({ text: '', object: 'OLE' })
          else {
            const pic = pictureAt(chp.picLocation)
            runs.push(pic ? { text: '', image: pic } : { text: '', object: 'picture' })
          }
          continue
        }
        if (chp.hidden) continue
        const r: Run = { text: it.text, pt: chp.hps / 2 }
        if (chp.b) r.b = true
        if (chp.i) r.i = true
        if (chp.u) r.u = true
        if (chp.strike) r.s = true
        if (chp.color && chp.color !== '#000000') r.color = chp.color
        if (chp.highlight) r.bg = chp.highlight
        if (chp.iss === 1) r.sup = true
        if (chp.iss === 2) r.sub = true
        if (chp.caps) r.caps = true
        if (chp.smallCaps) r.smallCaps = true
        if (chp.dxaSpace) r.spacing = chp.dxaSpace / TW
        r.font = fontName(chp.ftcAscii)
        r.eaFont = fontName(chp.ftcFE)
        const prev = runs[runs.length - 1]
        if (prev && sameLook(prev, r)) prev.text += r.text
        else runs.push(r)
      }
      items = []
      const markChp = resolveChp(find(chpRuns, fc), istd)
      const lv = listLevel(pap)
      let hasLabel = false
      if (lv) {
        const { level } = lv
        const lvIndex = Math.min(8, Math.max(0, pap.ilvl))
        let cs = counters.get(lv.lsid)
        if (!cs) counters.set(lv.lsid, (cs = []))
        const levels = lists!.defs.get(lv.lsid)!
        const startOf = (k: number) => lists!.lfo[lv.ilfo - 1]?.startAt.get(k) ?? levels[k]?.start ?? 1
        const cur = cs[lvIndex]
        cs[lvIndex] = cur == null ? startOf(lvIndex) : cur + 1
        for (let k = lvIndex + 1; k < 9; k++) cs[k] = undefined
        let text = ''
        for (const ch of level.text) {
          const code = ch.charCodeAt(0)
          if (code < 9) {
            const lk = levels[code]
            const v = cs[code] ?? startOf(code)
            text += formatNumber(v, level.legal ? 0 : (lk?.nfc ?? 0))
          } else text += ch
        }
        if (level.nfc === 23 || /[\uf000-\uf0ff]/.test(text)) text = bulletChar(text)
        if (text) {
          const lchp: Chp = { ...markChp, u: 0, hidden: false }
          applyChp(lchp, level.chpx, markChp, old)
          const label: Run = { text: level.follow === 1 ? text + ' ' : text, pt: lchp.hps / 2 }
          if (lchp.b) label.b = true
          if (lchp.i) label.i = true
          if (lchp.color && lchp.color !== '#000000') label.color = lchp.color
          const f = fontName(lchp.ftcAscii)
          const symbol = !!f && /symbol|wingdings|webdings/i.test(f)
          label.font = symbol ? undefined : f
          if (symbol) label.symbolFont = f
          label.eaFont = fontName(lchp.ftcFE)
          if (level.follow === 0) {
            // tab after the number: to the hanging indent, or else the next default tab stop
            label.labelWidth = pap.first < 0 ? -pap.first / TW : 0
          } else label.labelWidth = undefined
          runs.unshift(label)
          hasLabel = true
        }
      }
      const kind = styleKind(istd)
      const para: Paragraph = { kind: 'p', runs }
      if (kind.heading != null) para.heading = kind.heading
      if (!hasLabel && (kind.list || pap.ilfo > 0)) para.list = true
      if (pap.jc === 1) para.align = 'center'
      else if (pap.jc === 2) para.align = 'right'
      else if (pap.jc === 3 || pap.jc === 4 || pap.jc === 5) para.align = 'justify'
      if (pap.left > 0 && !para.list) para.indent = Math.round((pap.left / 1440) * 96)
      const line = pap.line
      para.fmt = {
        before: pap.beforeAuto ? 14 : pt(pap.before),
        after: pap.afterAuto ? 14 : pt(pap.after),
        lineRule: line.mult ? 'auto' : line.dyaLine < 0 ? 'exact' : 'atLeast',
        line: line.mult ? Math.max(0.06, line.dyaLine / 240) : Math.abs(line.dyaLine) / TW,
        left: pt(pap.left),
        right: pt(pap.right),
        first: pt(pap.first),
        keepNext: pap.keepNext,
        keepLines: pap.keep,
        widow: pap.widow,
        pageBreakBefore: pap.pageBreakBefore,
        contextual: pap.contextual,
        style: istd,
        tabs: pap.tabs.filter((t) => t.jc !== 4).map((t) => ({ pos: t.pos / TW, jc: t.jc })),
        borders: pap.borders,
        markPt: markChp.hps / 2,
        markFont: fontName(markChp.ftcAscii),
        markEaFont: fontName(markChp.ftcFE)
      }
      const inTable = pap.inTable || (mark === '\x07' && chpRuns.length === 0)
      if (inTable) {
        tableRows ??= []
        const rowEnd = mark === '\x07' && (pap.ttp || (papRuns.length === 0 && lastWasCellEnd && !para.runs.length))
        if (rowEnd) {
          if (row.length) {
            tableRows.push(row)
            rowFmts.push(pap.tap ? rowFmt(pap.tap, row.length) : undefined)
          }
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
      enterSection(markCp)
      if (pap.pageBreakBefore && !para.fmt && blocks.length && blocks[blocks.length - 1].kind !== 'break') blocks.push({ kind: 'break' })
      blocks.push(para)
    }
    const closeTable = () => {
      if (cell.length) row.push(cell)
      if (row.length) {
        tableRows!.push(row)
        rowFmts.push(undefined)
      }
      if (tableRows!.length) blocks.push({ kind: 'table', rows: tableRows!, rowFmt: rowFmts })
      tableRows = null
      rowFmts = []
      row = []
      cell = []
    }

    if (withSections) enterSection(cpFrom)
    for (const pc of pieces) {
      const a = Math.max(pc.cpStart, cpFrom)
      const b = Math.min(pc.cpEnd, cpTo)
      if (a >= b) continue
      const off = pc.compressed ? pc.fc + (a - pc.cpStart) : pc.fc + 2 * (a - pc.cpStart)
      const n = b - a
      const raw = pc.compressed ? wd.subarray(off, off + n) : wd.subarray(off, off + 2 * n)
      const text = new TextDecoder(pc.compressed ? 'windows-1252' : 'utf-16le').decode(raw)
      const step = pc.compressed ? 1 : 2
      let run: PropRun | null = null
      for (let k = 0; k < text.length; k++) {
        const ch = text[k]
        const fc = off + k * step
        const cp = a + k
        const code = ch.charCodeAt(0)
        if (code === 0x13) {
          fields.push(true)
          inCode++
          fieldCode = ''
          fieldRun = find(chpRuns, fc)
          continue
        }
        if (code === 0x14 || code === 0x15) {
          const top = fields.length ? fields[fields.length - 1] : false
          // a check box form field shows a box where its code was
          if (top && /^\s*FORMCHECKBOX/i.test(fieldCode)) items.push({ kind: 'box', run: fieldRun })
          if (code === 0x14) {
            if (top) {
              fields[fields.length - 1] = false
              inCode--
            }
          } else if (fields.pop()) inCode--
          fieldCode = ''
          continue
        }
        if (inCode > 0 && fieldCode.length < 200) fieldCode += ch
        if (code === 0x0d || code === 0x07) {
          endPara(ch, fc, cp)
          continue
        }
        if (inCode > 0) continue
        if (!run || fc < run.fcStart || fc >= run.fcEnd) run = find(chpRuns, fc)
        if (code === 0x0c) {
          // A section break ends its section's last paragraph; anything else is a page break.
          const sec = sections.find((s) => cp < s.cpEnd)
          if (withSections && sec && cp === sec.cpEnd - 1) {
            // The break's own paragraph takes no space in Word when it holds nothing else.
            if (items.length) endPara('\r', fc, cp)
            continue
          }
          if (items.length) endPara('\r', fc, cp)
          if (tableRows) closeTable()
          blocks.push({ kind: 'break' })
          continue
        }
        if (code === 0x01) {
          items.push({ kind: 'pic', run })
          continue
        }
        if (code === 0x08 || code === 0x02 || code === 0x03 || code === 0x04 || code === 0x05) continue
        if (code === 0x0b || code === 0x0e) {
          pushText('\n', run)
          continue
        }
        if (code === 0x1e) {
          pushText('-', run)
          continue
        }
        if (code === 0x1f) continue
        if (code < 0x20 && code !== 0x09) continue
        pushText(code === 0xa0 ? ' ' : ch, run)
      }
    }
    if (items.length) endPara('\r', -1, cpTo)
    if (tableRows) closeTable()
    return blocks
  }

  function resolveDefaultPap(): Pap {
    const base = styles[0]?.pap ?? defaultPap()
    return { ...base, line: { ...base.line }, tap: undefined, hugePapx: undefined }
  }

  const ccpText = ccp(0)
  const ccpFtn = ccp(1)
  const ccpHdd = ccp(2)
  const ccpAtn = ccp(4)
  const ccpEdn = ccp(5)
  const ccpTxbx = ccp(6)
  const blocks = story(0, ccpText, true)

  // Headers and footers (odd-page stories of each section; empty stories inherit).
  const [fcHdd, lcbHdd] = fcLcb(11)
  if (ccpHdd > 0 && lcbHdd >= 8) {
    const cps: number[] = []
    for (let k = 0; k < lcbHdd / 4 && k < 2000; k++) cps.push(tu32(fcHdd + k * 4))
    const hddBase = ccpText + ccpFtn
    const storyAt = (idx: number): Block[] | null => {
      if (idx + 1 >= cps.length) return null
      const a = cps[idx]
      const b = cps[idx + 1]
      if (!(b > a + 1)) return null
      const bl = story(hddBase + a, hddBase + b - 1, false).filter((x) => x.kind !== 'break')
      return bl.some((x) => x.kind === 'table' || (x.kind === 'p' && x.runs.some((r) => r.text.trim() || r.image))) ? bl : null
    }
    let header: Block[] | undefined
    let footer: Block[] | undefined
    let firstHeader: Block[] | undefined
    let firstFooter: Block[] | undefined
    let s = 0
    for (const b of blocks) {
      if (b.kind !== 'sect') continue
      const base = 6 + s * 6
      header = storyAt(base + 1) ?? header
      footer = storyAt(base + 3) ?? footer
      firstHeader = storyAt(base + 4) ?? firstHeader
      firstFooter = storyAt(base + 5) ?? firstFooter
      if (header) b.header = header
      if (footer) b.footer = footer
      if (sections[s]?.sep.titlePage) {
        b.titlePage = true
        b.firstHeader = firstHeader
        b.firstFooter = firstFooter
      }
      s++
    }
  }

  let cp = ccpText
  const extra = (title: string, len: number) => {
    if (len > 1) {
      const b = story(cp, cp + len, false).filter((x) => x.kind !== 'p' || x.runs.some((r) => r.text.trim() || r.image))
      if (b.length) blocks.push({ kind: 'section', title }, ...b)
    }
    cp += len
  }
  extra('footnotes', ccpFtn)
  cp += ccpHdd
  if (!old) cp += ccp(3)
  cp += ccpAtn
  extra('endnotes', ccpEdn)
  extra('textboxes', ccpTxbx)
  if (flags & 0x8000) warnings.push('obfuscated')
  if (old) warnings.push('old')
  chpIds = new WeakMap()
  // DOP copts: fDontUseHTMLParagraphAutoSpacing (Word 2000+ documents; older ones add the spacings)
  let collapseSpacing = false
  if (!old) {
    const [fcDop, lcbDop] = fcLcb(31)
    if (lcbDop >= 513 && fcDop + 513 <= table.length) collapseSpacing = (table[fcDop + 512] & 0x04) === 0
  }
  return { blocks, variant: old ? `Word 6/95` : 'Word 97-2003', warnings, paged: true, fontClasses, collapseSpacing }
}

function sameLook(a: Run, b: Run): boolean {
  return (
    !a.image && !a.object && a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s && a.color === b.color && a.bg === b.bg &&
    a.pt === b.pt && a.sup === b.sup && a.sub === b.sub && a.font === b.font && a.eaFont === b.eaFont && a.caps === b.caps &&
    a.smallCaps === b.smallCaps && a.spacing === b.spacing
  )
}

function rowFmt(tap: Tap, cells: number): RowFmt | undefined {
  if (tap.centers.length < 2) return undefined
  const pt = (tw: number) => tw / TW
  const gap = tap.gapHalf
  const borders: [number, number, number, number][] = []
  const merged: boolean[] = []
  const tb = tap.tableBorders
  for (let k = 0; k < Math.max(cells, tap.centers.length - 1); k++) {
    const c = tap.cells[k]
    let b: [number, number, number, number] = c ? (c.borders.map((x) => x / 8) as [number, number, number, number]) : [0, 0, 0, 0]
    if (tb && b.every((x) => x === 0)) b = [tb[0] / 8 || tb[4] / 8, k === 0 ? tb[1] / 8 : tb[5] / 8, tb[2] / 8 || tb[4] / 8, k === tap.centers.length - 2 ? tb[3] / 8 : tb[5] / 8]
    borders.push(b)
    merged.push(!!c?.merged)
  }
  return {
    centers: tap.centers.map(pt),
    padLeft: pt(tap.padLeft ?? gap),
    padRight: pt(tap.padRight ?? gap),
    padTop: pt(tap.padTop ?? 0),
    padBottom: pt(tap.padBottom ?? 0),
    height: pt(tap.rowHeight),
    borders,
    merged,
    jc: tap.jc
  }
}

/** Word for DOS / Word 2 era files: no structure we read; the plain text between fcMin and fcMac. */
function readPlainOld(wd: Uint8Array, nFib: number): DocModel {
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength)
  const fcMin = dv.getUint32(0x18, true)
  const fcMac = dv.getUint32(0x1c, true)
  if (!(fcMin < fcMac && fcMac <= wd.length)) throw new WordError('old', `nFib ${nFib}`)
  const text = new TextDecoder('windows-1252').decode(wd.subarray(fcMin, fcMac))
  const blocks: Block[] = []
  for (const line of text.split(/[\r\x07]/)) {
    const clean = line.replace(/\x13[^\x14\x15]*\x14?|\x15/g, '').replace(/[\x00-\x08\x0e-\x1f]/g, '')
    if (clean.includes('\x0c')) blocks.push({ kind: 'break' })
    blocks.push({ kind: 'p', runs: [{ text: clean.replace(/\x0c/g, '').replace(/\x0b/g, '\n') }] })
  }
  return { blocks, variant: `Word (nFib ${nFib})`, warnings: ['old'] }
}
