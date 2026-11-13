/** A forgiving RTF reader for ".doc" files that are really RTF (Word's "save as .doc" from many
 *  tools). Keeps paragraphs, bold/italic/underline, simple tables, page breaks and PNG/JPEG pictures. */
import type { Block, DocModel, PageFmt, ParaFmt, Paragraph, Picture, RowFmt, Run } from './model.ts'

interface State {
  b: boolean
  i: boolean
  u: boolean
  s: boolean
  sup: boolean
  sub: boolean
  /** Index into the colour table (0 = auto). */
  cf: number
  /** Highlight / background colour index. */
  cb: number
  /** Font size in half-points (0 = default). */
  fs: number
  /** Latin and East Asian font indices into the font table (-1 = default). */
  f: number
  eaf: number
  /** Which font a following \\af applies to: after \\dbch it is the East Asian one. */
  fontMode: 'lo' | 'hi' | 'db' | 'rtl'
  skip: boolean
  uc: number
  pict: { mime: string; hex: string[]; w?: number; h?: number } | null
  /** Destination that only collects text, such as a field instruction. */
  fldinst: boolean
}

const SKIP_DESTS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl',
  'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'filetbl', 'revtbl', 'pgdsctbl', 'object', 'fldinst', 'bkmkstart',
  'bkmkend', 'footnote', 'annotation', 'atnid', 'atnauthor', 'nonshppict', 'operator', 'author', 'title', 'company'
])

const CODEPAGES: Record<number, string> = {
  949: 'euc-kr', 932: 'shift_jis', 936: 'gbk', 950: 'big5', 1250: 'windows-1250', 1251: 'windows-1251',
  1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256',
  1257: 'windows-1257', 1258: 'windows-1258', 874: 'windows-874', 10000: 'macintosh'
}

export function isRtf(b: Uint8Array): boolean {
  return b.length > 5 && b[0] === 0x7b && b[1] === 0x5c && b[2] === 0x72 && b[3] === 0x74 && b[4] === 0x66
}

export function readRtf(bytes: Uint8Array): DocModel {
  const src = new TextDecoder('latin1').decode(bytes)
  const styleHeadings = readStyleHeadings(src)
  let paraStyle = 0
  let decoder = new TextDecoder('windows-1252')
  const blocks: Block[] = []
  let runs: Run[] = []
  let pendingBytes: number[] = []
  const colors = readColorTable(src)
  const fonts = readFontTable(src)
  let st: State = { b: false, i: false, u: false, s: false, sup: false, sub: false, cf: 0, cb: 0, fs: 0, f: -1, eaf: -1, fontMode: 'lo', skip: false, uc: 1, pict: null, fldinst: false }
  // document and paragraph layout (twips), for the page view
  const page = { w: 12240, h: 15840, l: 1800, r: 1800, t: 1440, b: 1440, hdr: 720, ftr: 720, landscape: false }
  let deff = -1
  let deffFE = -1
  const freshPara = () => ({ sb: 0, sa: 0, sl: 0, slmult: 0, li: 0, ri: 0, fi: 0, q: 'l', keepn: false, keep: false })
  let pp = freshPara()
  let rowDef: { left: number; gaph: number; cellx: number[]; borders: boolean; height: number } = { left: 0, gaph: 108, cellx: [], borders: false, height: 0 }
  let rowFmts: (RowFmt | undefined)[] = []
  const collapseSpacing = /\\htmautsp/.test(src)
  let latinFE = false
  let paged = /\\paperw|\\margl|\\sb\d|\\sa\d|\\sl\d/.test(src)
  const stack: State[] = []
  let ucSkip = 0
  let inTable = false
  let rows: Block[][][] = []
  let row: Block[][] = []
  let cell: Block[] = []
  let paraInTbl = false
  let paraList = false
  let breakBefore = false

  const flushBytes = () => {
    if (!pendingBytes.length) return
    const text = decoder.decode(new Uint8Array(pendingBytes))
    pendingBytes = []
    addText(text)
  }
  const addText = (text: string) => {
    if (st.skip || !text) return
    const last = runs[runs.length - 1]
    const color = colors[st.cf] || undefined
    const bg = colors[st.cb] || undefined
    const pt = st.fs ? st.fs / 2 : undefined
    const font = fonts.get(st.f >= 0 ? st.f : deff)
    const eaFont = fonts.get(st.eaf >= 0 ? st.eaf : deffFE >= 0 ? deffFE : deff)
    if (
      last && !last.image && last.b === st.b && last.i === st.i && last.u === st.u && last.s === st.s && last.sup === st.sup &&
      last.sub === st.sub && last.color === color && last.bg === bg && last.pt === pt && last.font === font && last.eaFont === eaFont
    ) {
      last.text += text
    } else runs.push({ text, b: st.b, i: st.i, u: st.u, s: st.s, sup: st.sup, sub: st.sub, color, bg, pt, font, eaFont, latinFE: latinFE || undefined })
  }
  const paraFmt = (): ParaFmt => {
    const tw = (v: number) => v / 20
    const lineRule: ParaFmt['lineRule'] = !pp.sl || pp.slmult ? 'auto' : pp.sl < 0 ? 'exact' : 'atLeast'
    return {
      before: tw(pp.sb),
      after: tw(pp.sa),
      lineRule,
      line: lineRule === 'auto' ? (pp.sl ? Math.abs(pp.sl) / 240 : 1) : tw(Math.abs(pp.sl)),
      left: tw(pp.li),
      right: tw(pp.ri),
      first: tw(pp.fi),
      keepNext: pp.keepn,
      keepLines: pp.keep,
      widow: true,
      pageBreakBefore: false,
      contextual: false,
      style: paraStyle,
      tabs: [],
      markPt: st.fs ? st.fs / 2 : 12,
      markFont: fonts.get(st.f >= 0 ? st.f : deff),
      markEaFont: fonts.get(st.eaf >= 0 ? st.eaf : deffFE >= 0 ? deffFE : deff)
    }
  }
  const endPara = () => {
    flushBytes()
    const p: Paragraph = { kind: 'p', runs, fmt: paraFmt() }
    if (pp.q === 'c') p.align = 'center'
    else if (pp.q === 'r') p.align = 'right'
    else if (pp.q === 'j') p.align = 'justify'
    const hd = styleHeadings.get(paraStyle)
    if (hd != null) p.heading = hd
    if (paraList && runs[0]) {
      const m = /^([^\t]{1,12})\t/.exec(runs[0].text)
      if (m && pp.fi < 0) {
        // the list label written by the RTF producer (\listtext): number or bullet, then a tab
        const label: Run = { ...runs[0], text: m[1].replace(/[\uf0b7\u00b7]/g, '•').trim(), labelWidth: -pp.fi / 20, joinLabel: true }
        runs[0] = { ...runs[0], text: runs[0].text.slice(m[0].length) }
        runs.unshift(label)
      } else {
        p.list = true
        runs[0].text = runs[0].text.replace(/^[\t \u2022\u00b7\uf0b7]+/, '')
      }
    }
    runs = []
    if (inTable && paraInTbl) {
      cell.push(p)
      return
    }
    if (inTable) closeTable()
    if (breakBefore && blocks.length) blocks.push({ kind: 'break' })
    breakBefore = false
    blocks.push(p)
  }
  const currentRowFmt = (): RowFmt | undefined => {
    const d = rowDef
    if (!d.cellx.length) return undefined
    const pt = (v: number) => v / 20
    const centers = [d.left, ...d.cellx].map(pt)
    const w = d.borders ? 0.5 : 0
    return {
      centers,
      padLeft: pt(d.gaph),
      padRight: pt(d.gaph),
      padTop: 0,
      padBottom: 0,
      height: pt(d.height),
      borders: d.cellx.map(() => [w, w, w, w] as [number, number, number, number]),
      merged: d.cellx.map(() => false),
      jc: 0
    }
  }
  const endCell = () => {
    flushBytes()
    if (runs.length) cell.push({ kind: 'p', runs, fmt: paraFmt() })
    runs = []
    row.push(cell)
    cell = []
  }
  const endRow = () => {
    if (cell.length || runs.length) endCell()
    if (row.length) {
      rows.push(row)
      rowFmts.push(currentRowFmt())
    }
    row = []
  }
  const closeTable = () => {
    if (row.length || cell.length) endRow()
    if (rows.length) blocks.push({ kind: 'table', rows, rowFmt: rowFmts })
    rows = []
    rowFmts = []
    inTable = false
  }

  let i = 0
  const n = src.length
  let groupStart = false
  while (i < n) {
    const c = src[i]
    if (c === '{') {
      flushBytes()
      stack.push({ ...st, pict: st.pict })
      groupStart = true
      i++
      continue
    }
    if (c === '}') {
      flushBytes()
      if (st.pict && (stack[stack.length - 1]?.pict !== st.pict)) {
        const pic = pictFromHex(st.pict)
        if (pic && !stack[stack.length - 1]?.skip) runs.push({ text: '', image: pic })
      }
      st = stack.pop() ?? st
      groupStart = false
      i++
      continue
    }
    if (c === '\\') {
      const next = src[i + 1]
      if (next === '\'') {
        const hex = parseInt(src.substr(i + 2, 2), 16)
        i += 4
        if (ucSkip > 0) {
          ucSkip--
          continue
        }
        if (!st.skip && !Number.isNaN(hex)) pendingBytes.push(hex)
        groupStart = false
        continue
      }
      if (next === '*') {
        st.skip = true
        i += 2
        continue
      }
      if (next === '\\' || next === '{' || next === '}') {
        flushBytes()
        if (ucSkip > 0) ucSkip--
        else addText(next)
        i += 2
        groupStart = false
        continue
      }
      if (next === '~') {
        flushBytes()
        addText(' ')
        i += 2
        continue
      }
      if (next === '\n' || next === '\r') {
        endPara()
        i += 2
        continue
      }
      const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(src.slice(i + 1, i + 46))
      if (!m) {
        i += 2
        continue
      }
      i += 1 + m[0].length
      const word = m[1]
      const arg = m[2] != null ? Number(m[2]) : undefined
      const first = groupStart
      groupStart = false
      if (first && SKIP_DESTS.has(word)) {
        st.skip = true
        continue
      }
      if (st.skip && word !== 'bin') continue
      if (word !== 'u' && word !== 'bin') flushBytes()
      switch (word) {
        case 'ansicpg':
          if (arg && CODEPAGES[arg]) decoder = new TextDecoder(CODEPAGES[arg])
          break
        case 'par':
        case 'sect':
          endPara()
          break
        case 'line':
          addText('\n')
          break
        case 'tab':
          addText('\t')
          break
        case 'page':
          endPara()
          if (inTable) closeTable()
          blocks.push({ kind: 'break' })
          break
        case 'intbl':
          inTable = true
          paraInTbl = true
          break
        case 'ls':
        case 'ilvl':
          paraList = true
          break
        case 'pagebb':
          breakBefore = true
          break
        case 'cell':
          inTable = true
          endCell()
          break
        case 'row':
          endRow()
          break
        case 's':
          paraStyle = arg ?? 0
          break
        case 'pard':
          paraStyle = 0
          paraInTbl = false
          paraList = false
          pp = freshPara()
          break
        case 'sb': pp.sb = arg ?? 0; break
        case 'sa': pp.sa = arg ?? 0; break
        case 'sl': pp.sl = arg ?? 0; break
        case 'slmult': pp.slmult = arg ?? 0; break
        case 'li': pp.li = arg ?? 0; break
        case 'ri': pp.ri = arg ?? 0; break
        case 'fi': pp.fi = arg ?? 0; break
        case 'ql': pp.q = 'l'; break
        case 'qc': pp.q = 'c'; break
        case 'qr': pp.q = 'r'; break
        case 'qj': case 'qd': pp.q = 'j'; break
        case 'keepn': pp.keepn = true; break
        case 'keep': pp.keep = true; break
        case 'paperw': if (arg && arg > 1440) page.w = arg; break
        case 'paperh': if (arg && arg > 1440) page.h = arg; break
        case 'pgwsxn': if (arg && arg > 1440) page.w = arg; break
        case 'pghsxn': if (arg && arg > 1440) page.h = arg; break
        case 'margl': case 'marglsxn': page.l = arg ?? page.l; break
        case 'margr': case 'margrsxn': page.r = arg ?? page.r; break
        case 'margt': case 'margtsxn': page.t = Math.abs(arg ?? page.t); break
        case 'margb': case 'margbsxn': page.b = Math.abs(arg ?? page.b); break
        case 'headery': page.hdr = arg ?? page.hdr; break
        case 'footery': page.ftr = arg ?? page.ftr; break
        case 'landscape': case 'lndscpsxn': page.landscape = true; break
        case 'deff': deff = arg ?? -1; break
        case 'langfe': latinFE = !!arg && ![1042, 2066, 1041, 2052, 1028, 3076, 4100, 5124].includes(arg); break
        case 'stshfdbch': deffFE = arg ?? -1; break
        case 'f': st.f = arg ?? -1; break
        case 'af': if (st.fontMode === 'db') st.eaf = arg ?? -1; break
        case 'loch': st.fontMode = 'lo'; break
        case 'hich': st.fontMode = 'hi'; break
        case 'dbch': st.fontMode = 'db'; break
        case 'rtlch': st.fontMode = 'rtl'; break
        case 'ltrch': st.fontMode = 'lo'; break
        case 'trowd': rowDef = { left: 0, gaph: 108, cellx: [], borders: false, height: 0 }; break
        case 'trgaph': rowDef.gaph = arg ?? 108; break
        case 'trleft': rowDef.left = arg ?? 0; break
        case 'trrh': rowDef.height = arg ?? 0; break
        case 'cellx': rowDef.cellx.push(arg ?? 0); break
        case 'clbrdrt': case 'clbrdrb': case 'clbrdrl': case 'clbrdrr': case 'trbrdrt': case 'trbrdrb': case 'trbrdrl': case 'trbrdrr': rowDef.borders = true; break
        case 'b':
          st.b = arg !== 0
          break
        case 'i':
          st.i = arg !== 0
          break
        case 'ul':
          st.u = arg !== 0
          break
        case 'ulnone':
          st.u = false
          break
        case 'strike':
          st.s = arg !== 0
          break
        case 'super':
          st.sup = true
          break
        case 'sub':
          st.sub = true
          break
        case 'nosupersub':
          st.sup = st.sub = false
          break
        case 'plain':
          st.b = st.i = st.u = st.s = st.sup = st.sub = false
          st.cf = st.cb = st.fs = 0
          break
        case 'cf':
          st.cf = arg ?? 0
          break
        case 'cb':
        case 'highlight':
        case 'chcbpat':
          st.cb = arg ?? 0
          break
        case 'fs':
          st.fs = arg ?? 0
          break
        case 'uc':
          st.uc = arg ?? 1
          break
        case 'u':
          flushBytes()
          if (arg != null) addText(String.fromCharCode(arg < 0 ? arg + 65536 : arg))
          ucSkip = st.uc
          continue
        case 'emdash':
          addText('—')
          break
        case 'endash':
          addText('–')
          break
        case 'bullet':
          addText('•')
          break
        case 'lquote':
          addText('‘')
          break
        case 'rquote':
          addText('’')
          break
        case 'ldblquote':
          addText('“')
          break
        case 'rdblquote':
          addText('”')
          break
        case 'pict':
          st.pict = { mime: '', hex: [] }
          break
        case 'pngblip':
          if (st.pict) st.pict.mime = 'image/png'
          break
        case 'jpegblip':
          if (st.pict) st.pict.mime = 'image/jpeg'
          break
        case 'picwgoal':
          if (st.pict && arg) st.pict.w = Math.round((arg / 1440) * 96)
          break
        case 'pichgoal':
          if (st.pict && arg) st.pict.h = Math.round((arg / 1440) * 96)
          break
        case 'bin':
          i += Math.max(0, arg ?? 0)
          break
      }
      if (ucSkip > 0 && word !== 'u') ucSkip = 0
      continue
    }
    if (c === '\r' || c === '\n') {
      i++
      continue
    }
    groupStart = false
    if (st.pict) {
      if (st.skip) {
        i++
        continue
      }
      let j = i
      while (j < n && /[0-9a-fA-F\s]/.test(src[j])) j++
      st.pict.hex.push(src.slice(i, j))
      i = j === i ? i + 1 : j
      continue
    }
    if (ucSkip > 0) {
      ucSkip--
      i++
      continue
    }
    let j = i
    while (j < n && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}' && src[j] !== '\r' && src[j] !== '\n') j++
    if (!st.skip) for (let k = i; k < j; k++) pendingBytes.push(src.charCodeAt(k) & 0xff)
    i = j
  }
  flushBytes()
  if (runs.length) endPara()
  if (inTable) closeTable()
  while (blocks.length && blocks[blocks.length - 1].kind === 'p' && !(blocks[blocks.length - 1] as Paragraph).runs.length) blocks.pop()
  let w = page.w / 20
  let hgt = page.h / 20
  if (page.landscape && w < hgt) [w, hgt] = [hgt, w]
  const pageFmt: PageFmt = {
    w,
    h: hgt,
    top: page.t / 20,
    bottom: page.b / 20,
    left: page.l / 20,
    right: page.r / 20,
    header: page.hdr / 20,
    footer: page.ftr / 20,
    columns: 1,
    colSpace: 36,
    newPage: true,
    linePitch: 0
  }
  paged = paged && w > 72 && hgt > 72
  return { blocks: paged ? [{ kind: 'sect', page: pageFmt }, ...blocks] : blocks, variant: 'RTF', warnings: ['rtf'], paged, collapseSpacing }
}

function pictFromHex(p: { mime: string; hex: string[]; w?: number; h?: number }): Picture | null {
  if (!p.mime) return null
  const hex = p.hex.join('').replace(/\s+/g, '')
  if (hex.length < 16) return null
  const bytes = new Uint8Array(hex.length >> 1)
  for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.substr(k * 2, 2), 16)
  return { bytes, mime: p.mime, width: p.w, height: p.h }
}

/** The \fonttbl group: font index -> face name. */
function readFontTable(src: string): Map<number, string> {
  const out = new Map<number, string>()
  const at = src.indexOf('{\\fonttbl')
  if (at < 0) return out
  const re = /\{\\f(\d+)((?:[^{}]|\{[^{}]*\})*)\}/g
  re.lastIndex = at + 9
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = re.exec(src)) && guard++ < 2000) {
    const name = m[2].replace(/\{[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/;\s*$/, '').trim()
    if (name) out.set(Number(m[1]), decodeFontName(name))
    if (src.startsWith('}}', re.lastIndex - 1) || src.startsWith('}\r\n{\\colortbl', re.lastIndex - 1)) break
    if (re.lastIndex > at + 100000) break
  }
  return out
}

/** Font names may carry \\'hh escapes (Korean names in the document code page). */
function decodeFontName(name: string): string {
  if (!name.includes("\\'")) return name
  const bytes: number[] = []
  for (let i = 0; i < name.length; i++) {
    if (name[i] === '\\' && name[i + 1] === "'") {
      bytes.push(parseInt(name.substr(i + 2, 2), 16))
      i += 3
    } else bytes.push(name.charCodeAt(i) & 0xff)
  }
  try {
    return new TextDecoder('euc-kr').decode(new Uint8Array(bytes))
  } catch {
    return name
  }
}

/** The \colortbl group: index -> CSS colour ('' for the "auto" entry). */
function readColorTable(src: string): string[] {
  const at = src.indexOf('{\\colortbl')
  if (at < 0) return []
  const end = src.indexOf('}', at + 10)
  if (end < 0 || end - at > 100000) return []
  return src
    .slice(at + 10, end)
    .split(';')
    .slice(0, -1)
    .map((entry) => {
      const r = /\\red(\d+)/.exec(entry)
      const g = /\\green(\d+)/.exec(entry)
      const b = /\\blue(\d+)/.exec(entry)
      if (!r && !g && !b) return ''
      const v = (m: RegExpExecArray | null) => Math.min(255, Number(m?.[1] ?? 0))
      return `rgb(${v(r)},${v(g)},${v(b)})`
    })
}

/** Style numbers whose names are "heading N" or "Title" in the style sheet. */
function readStyleHeadings(src: string): Map<number, number> {
  const out = new Map<number, number>()
  const at = src.indexOf('\\stylesheet')
  if (at < 0) return out
  const re = /\{\\s(\d+)((?:[^{}]|\{[^{}]*\})*)\}/g
  re.lastIndex = at
  const stop = at + 200000
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) && m.index < stop) {
    const name = m[2].replace(/\{[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/;\s*$/, '').trim()
    const hm = /^(?:heading|제목)\s*(\d)/i.exec(name)
    if (hm) out.set(Number(m[1]), Math.min(6, Number(hm[1])))
    else if (/^title$/i.test(name)) out.set(Number(m[1]), 0)
    if (src.startsWith('}}', re.lastIndex - 1)) break
  }
  return out
}
