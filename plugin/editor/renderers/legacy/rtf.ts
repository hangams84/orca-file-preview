/** A forgiving RTF reader for ".doc" files that are really RTF (Word's "save as .doc" from many
 *  tools). Keeps paragraphs, bold/italic/underline, simple tables, page breaks and PNG/JPEG pictures. */
import type { Block, DocModel, Paragraph, Picture, Run } from './model.ts'

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
  let st: State = { b: false, i: false, u: false, s: false, sup: false, sub: false, cf: 0, cb: 0, fs: 0, skip: false, uc: 1, pict: null, fldinst: false }
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
    if (
      last && !last.image && last.b === st.b && last.i === st.i && last.u === st.u && last.s === st.s && last.sup === st.sup &&
      last.sub === st.sub && last.color === color && last.bg === bg && last.pt === pt
    ) {
      last.text += text
    } else runs.push({ text, b: st.b, i: st.i, u: st.u, s: st.s, sup: st.sup, sub: st.sub, color, bg, pt })
  }
  const endPara = () => {
    flushBytes()
    const p: Paragraph = { kind: 'p', runs }
    const hd = styleHeadings.get(paraStyle)
    if (hd != null) p.heading = hd
    if (paraList) {
      p.list = true
      if (runs[0]) runs[0].text = runs[0].text.replace(/^[	 •·•]+/, '')
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
  const endCell = () => {
    flushBytes()
    if (runs.length) cell.push({ kind: 'p', runs })
    runs = []
    row.push(cell)
    cell = []
  }
  const endRow = () => {
    if (cell.length || runs.length) endCell()
    if (row.length) rows.push(row)
    row = []
  }
  const closeTable = () => {
    if (row.length || cell.length) endRow()
    if (rows.length) blocks.push({ kind: 'table', rows })
    rows = []
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
          break
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
  return { blocks, variant: 'RTF', warnings: ['rtf'] }
}

function pictFromHex(p: { mime: string; hex: string[]; w?: number; h?: number }): Picture | null {
  if (!p.mime) return null
  const hex = p.hex.join('').replace(/\s+/g, '')
  if (hex.length < 16) return null
  const bytes = new Uint8Array(hex.length >> 1)
  for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(hex.substr(k * 2, 2), 16)
  return { bytes, mime: p.mime, width: p.w, height: p.h }
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
