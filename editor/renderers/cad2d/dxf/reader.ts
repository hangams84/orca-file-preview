/** DXF group-code reader for ASCII and binary DXF (R12 one-byte codes and R13+ two-byte codes),
 *  and the document model: header variables, tables, blocks, entities and layout objects.
 *  Entities keep index ranges into the shared tag arrays instead of copying their tags. */

export const BINARY_SENTINEL = 'AutoCAD Binary DXF\r\n\x1a\x00'

export interface Tags {
  codes: Int32Array
  vals: (string | number)[]
  n: number
  binary: boolean
  encoding: string
}

export class DxfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DxfError'
  }
}

type Kind = 0 | 1 | 2 | 3 // string, float, int, bool/int

export function valueKind(code: number): Kind {
  if ((code >= 10 && code <= 59) || (code >= 110 && code <= 149) || (code >= 210 && code <= 239) || (code >= 460 && code <= 469) || (code >= 1010 && code <= 1059)) return 1
  if (
    (code >= 60 && code <= 79) ||
    (code >= 90 && code <= 99) ||
    (code >= 160 && code <= 179) ||
    (code >= 270 && code <= 289) ||
    (code >= 370 && code <= 389) ||
    (code >= 400 && code <= 409) ||
    (code >= 420 && code <= 429) ||
    (code >= 440 && code <= 459) ||
    (code >= 1060 && code <= 1071)
  )
    return 2
  if (code >= 290 && code <= 299) return 3
  return 0
}

/** Windows code page names used by $DWGCODEPAGE → WHATWG encoding labels. */
const CODEPAGES: Record<string, string> = {
  ANSI_874: 'windows-874',
  ANSI_932: 'shift_jis',
  ANSI_936: 'gbk',
  ANSI_949: 'euc-kr',
  ANSI_950: 'big5',
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258',
  DOS437: 'ibm866',
  DOS850: 'windows-1252',
  DOS932: 'shift_jis',
  BIG5: 'big5',
  GB2312: 'gbk',
  KSC5601: 'euc-kr',
  JOHAB: 'euc-kr'
}

/** Picks the text encoding: UTF-8 from AutoCAD 2007 (AC1021) on, else $DWGCODEPAGE. */
export function pickEncoding(acadver: string, codepage: string): string {
  const ver = parseInt(acadver.replace(/^AC/i, ''), 10)
  if (ver >= 1021) return 'utf-8'
  const cp = CODEPAGES[codepage.trim().toUpperCase()]
  return cp ?? 'windows-1252'
}

/** No $ACADVER: UTF-8 when the bytes are valid UTF-8, else EUC-KR when they decode as such,
 *  else Windows-1252. */
function guessEncoding(bytes: Uint8Array, codepage: string): string {
  for (const label of ['utf-8', CODEPAGES[codepage.trim().toUpperCase()] ?? 'euc-kr']) {
    try {
      new TextDecoder(label, { fatal: true }).decode(bytes)
      return label
    } catch {
      // try the next one
    }
  }
  return 'windows-1252'
}

function decoder(label: string): TextDecoder {
  try {
    return new TextDecoder(label)
  } catch {
    return new TextDecoder('windows-1252')
  }
}

/** Finds a header variable's string value by scanning raw bytes (ASCII-safe names). */
function sniffVar(text: string, name: string): string {
  const i = text.indexOf(name)
  if (i < 0) return ''
  const m = /^\s*\r?\n\s*\d+\s*\r?\n([^\r\n]*)/.exec(text.slice(i + name.length, i + name.length + 200))
  return m ? m[1].trim() : ''
}

export function isBinaryDxf(b: Uint8Array): boolean {
  if (b.length < 22) return false
  for (let i = 0; i < 18; i++) if (b[i] !== BINARY_SENTINEL.charCodeAt(i)) return false
  return true
}

export function readTags(bytes: Uint8Array): Tags {
  return isBinaryDxf(bytes) ? readBinary(bytes) : readAscii(bytes)
}

function readAscii(bytes: Uint8Array): Tags {
  // The header is ASCII: look up the version and code page before decoding the rest.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)))
  const ver = sniffVar(head, '$ACADVER')
  const encoding =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8' : ver ? pickEncoding(ver, sniffVar(head, '$DWGCODEPAGE')) : guessEncoding(bytes, sniffVar(head, '$DWGCODEPAGE'))
  let text = decoder(encoding).decode(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const len = text.length
  let cap = Math.max(1024, Math.floor(len / 12))
  let codes = new Int32Array(cap)
  const vals: (string | number)[] = []
  let n = 0
  let pos = 0
  const line = (): string | null => {
    if (pos >= len) return null
    let e = text.indexOf('\n', pos)
    if (e < 0) e = len
    let s = text.slice(pos, e)
    pos = e + 1
    if (s.endsWith('\r')) s = s.slice(0, -1)
    return s
  }
  for (;;) {
    const cl = line()
    if (cl === null) break
    const ct = cl.trim()
    if (ct === '') {
      if (pos >= len) break
      continue // tolerate blank lines between pairs
    }
    const code = Number(ct)
    if (!Number.isInteger(code)) throw new DxfError(`bad group code "${ct.slice(0, 20)}" at tag ${n}`)
    const vl = line()
    if (vl === null) break
    if (n >= cap) {
      cap *= 2
      const c2 = new Int32Array(cap)
      c2.set(codes)
      codes = c2
    }
    codes[n] = code
    const k = valueKind(code)
    if (k === 0) vals.push(vl)
    else {
      const v = k === 1 ? parseFloat(vl) : parseInt(vl, 10)
      vals.push(Number.isFinite(v) ? v : 0)
    }
    n++
    if (code === 0 && vl.trim() === 'EOF') break
  }
  return { codes: codes.subarray(0, n), vals, n, binary: false, encoding }
}

function readBinary(bytes: Uint8Array): Tags {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 22
  // R13+ uses two-byte group codes: the first code (0) is then followed by another zero byte.
  const wide = bytes[23] === 0
  const raw: Uint8Array[] = [] // strings decoded after the code page is known
  const codes: number[] = []
  const vals: (string | number)[] = []
  const strIdx: number[] = []
  const end = bytes.length
  const need = (k: number) => {
    if (pos + k > end) throw new DxfError('binary DXF ends early')
  }
  while (pos < end) {
    let code: number
    if (wide) {
      need(2)
      code = dv.getUint16(pos, true)
      pos += 2
    } else {
      need(1)
      code = bytes[pos++]
      if (code === 255) {
        need(2)
        code = dv.getUint16(pos, true)
        pos += 2
      }
    }
    if (code === 310 || code === 1004) {
      need(1)
      const l = bytes[pos++]
      need(l)
      pos += l
      codes.push(code)
      vals.push('')
      continue
    }
    const k = valueKind(code)
    let v: string | number
    if (k === 0) {
      let e = pos
      while (e < end && bytes[e] !== 0) e++
      if (e >= end) throw new DxfError('binary DXF string not terminated')
      raw.push(bytes.subarray(pos, e))
      strIdx.push(vals.length)
      v = ''
      pos = e + 1
    } else if (k === 1) {
      need(8)
      v = dv.getFloat64(pos, true)
      pos += 8
    } else if (k === 3) {
      need(1)
      v = bytes[pos++]
    } else if ((code >= 90 && code <= 99) || (code >= 420 && code <= 429) || (code >= 440 && code <= 459) || code === 1071) {
      need(4)
      v = dv.getInt32(pos, true)
      pos += 4
    } else if (code >= 160 && code <= 169) {
      need(8)
      v = Number(dv.getBigInt64(pos, true))
      pos += 8
    } else {
      need(2)
      v = dv.getInt16(pos, true)
      pos += 2
    }
    codes.push(code)
    vals.push(v)
  }
  // Decode strings: find $ACADVER / $DWGCODEPAGE (ASCII) first.
  const latin = new TextDecoder('latin1')
  let acadver = ''
  let cp = ''
  for (let i = 0; i < strIdx.length - 1 && i < 4000; i++) {
    const s = latin.decode(raw[i])
    if (s === '$ACADVER') acadver = latin.decode(raw[i + 1])
    if (s === '$DWGCODEPAGE') cp = latin.decode(raw[i + 1])
  }
  let encoding = pickEncoding(acadver, cp)
  if (!acadver) {
    let all = 0
    for (const r of raw) all += r.length
    const joined = new Uint8Array(all)
    let o = 0
    for (const r of raw) {
      joined.set(r, o)
      o += r.length
    }
    encoding = guessEncoding(joined, cp)
  }
  const dec = decoder(encoding)
  for (let i = 0; i < strIdx.length; i++) vals[strIdx[i]] = dec.decode(raw[i])
  // EOF tag
  let n = codes.length
  for (let i = 0; i < n; i++)
    if (codes[i] === 0 && vals[i] === 'EOF') {
      n = i + 1
      break
    }
  return { codes: Int32Array.from(codes.slice(0, n)), vals: vals.slice(0, n), n, binary: true, encoding }
}

// ---- text escapes -------------------------------------------------------------------------

const MIF_PAGES: Record<string, string> = { '1': 'shift_jis', '2': 'big5', '3': 'euc-kr', '4': 'euc-kr', '5': 'gbk' }

/** Decodes \U+XXXX and \M+nXXXX escapes and ^J/^I caret codes. */
export function unescapeDxf(s: string): string {
  if (s.indexOf('\\') < 0 && s.indexOf('^') < 0) return s
  return s
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\M\+([1-5])([0-9a-fA-F]{4})/g, (all, p, h) => {
      try {
        const v = parseInt(h, 16)
        return new TextDecoder(MIF_PAGES[p]).decode(new Uint8Array([v >> 8, v & 255]))
      } catch {
        return all
      }
    })
    .replace(/\^([JIM ])/g, (_, c) => (c === 'J' ? '\n' : c === 'I' ? '\t' : c === 'M' ? '' : '^'))
}

// ---- document -----------------------------------------------------------------------------

export interface Ent {
  type: string
  /** Tag range [s, e): s is the (0, TYPE) tag. */
  s: number
  e: number
  /** VERTEX records of a POLYLINE, ATTRIB records of an INSERT. */
  children?: Ent[]
}

export interface LayerRec {
  name: string
  handle: string
  color: number // ACI (negative = off)
  trueColor?: number
  frozen: boolean
  ltype: string
  lw: number // 1/100 mm, -3 default
}

export interface StyleRec {
  name: string
  font: string
  bigFont: string
  family: string
  height: number
  width: number
  oblique: number
  flags: number
}

export interface BlockRec {
  name: string
  base: [number, number]
  flags: number
  ents: Ent[]
  /** Path of the referenced drawing for an external reference (flag 4), as written (group 1). */
  xref?: string
}

export interface DxfDoc {
  t: Tags
  header: Map<string, number> // header variable name → tag index of its first value
  layers: LayerRec[]
  ltypes: Map<string, number[]>
  styles: Map<string, StyleRec>
  /** BLOCK_RECORD handle → name, and name → layout handle. */
  recordByHandle: Map<string, string>
  layoutOfRecord: Map<string, string>
  blocks: Map<string, BlockRec>
  entities: Ent[]
  layouts: Ent[]
  dimstyles: Map<string, Ent>
  /** IMAGEDEF handle (upper case) → file name of the raster image, as written. */
  imageDefs: Map<string, string>
}

/** Value of the first tag with `code` in [s, e). */
export function tag(t: Tags, s: number, e: number, code: number): string | number | undefined {
  for (let i = s + 1; i < e; i++) if (t.codes[i] === code) return t.vals[i]
  return undefined
}

export function num(t: Tags, s: number, e: number, code: number, def = 0): number {
  const v = tag(t, s, e, code)
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : def
}

export function str(t: Tags, s: number, e: number, code: number, def = ''): string {
  const v = tag(t, s, e, code)
  return v === undefined ? def : String(v)
}

export function parseDoc(t: Tags): DxfDoc {
  const doc: DxfDoc = {
    t,
    header: new Map(),
    layers: [],
    ltypes: new Map(),
    styles: new Map(),
    recordByHandle: new Map(),
    layoutOfRecord: new Map(),
    blocks: new Map(),
    entities: [],
    layouts: [],
    dimstyles: new Map(),
    imageDefs: new Map()
  }
  let sawSection = false
  let i = 0
  const n = t.n
  while (i < n) {
    if (t.codes[i] === 0 && t.vals[i] === 'SECTION') {
      sawSection = true
      const name = t.codes[i + 1] === 2 ? String(t.vals[i + 1]) : ''
      let e = i + 2
      while (e < n && !(t.codes[e] === 0 && (t.vals[e] === 'ENDSEC' || t.vals[e] === 'EOF'))) e++
      const s = i + 2
      if (name === 'HEADER') header(doc, s, e)
      else if (name === 'TABLES') tables(doc, s, e)
      else if (name === 'BLOCKS') blocks(doc, s, e)
      else if (name === 'ENTITIES') doc.entities = entities(t, s, e)
      else if (name === 'OBJECTS') objects(doc, s, e)
      i = e + 1
      continue
    }
    i++
  }
  if (!sawSection) {
    // Some writers emit a bare ENTITIES list without sections.
    if (n > 0 && t.codes[0] === 0) doc.entities = entities(t, 0, n)
    else throw new DxfError('no DXF sections found')
  }
  return doc
}

function header(doc: DxfDoc, s: number, e: number): void {
  const t = doc.t
  for (let i = s; i < e; i++) if (t.codes[i] === 9) doc.header.set(String(t.vals[i]), i + 1)
}

/** Header value: the first value after `$NAME` with the given code (or any code). */
export function hdr(doc: DxfDoc, name: string, code?: number): string | number | undefined {
  const i = doc.header.get(name)
  if (i === undefined) return undefined
  const t = doc.t
  for (let j = i; j < t.n && t.codes[j] !== 9 && t.codes[j] !== 0; j++) if (code === undefined || t.codes[j] === code) return t.vals[j]
  return undefined
}

/** Splits [s, e) into records starting at each (0, X) tag. */
function records(t: Tags, s: number, e: number): Ent[] {
  const out: Ent[] = []
  let cur: Ent | null = null
  for (let i = s; i < e; i++) {
    if (t.codes[i] === 0) {
      if (cur) cur.e = i
      cur = { type: String(t.vals[i]).trim().toUpperCase(), s: i, e }
      out.push(cur)
    }
  }
  if (cur) cur.e = e
  return out
}

function tables(doc: DxfDoc, s: number, e: number): void {
  const t = doc.t
  for (const r of records(t, s, e)) {
    const S = r.s
    const E = r.e
    switch (r.type) {
      case 'LAYER':
        doc.layers.push({
          name: str(t, S, E, 2, '0'),
          handle: str(t, S, E, 5),
          color: num(t, S, E, 62, 7),
          trueColor: tag(t, S, E, 420) as number | undefined,
          frozen: (num(t, S, E, 70) & 1) === 1,
          ltype: str(t, S, E, 6, 'CONTINUOUS'),
          lw: num(t, S, E, 370, -3)
        })
        break
      case 'LTYPE': {
        const dashes: number[] = []
        for (let i = S + 1; i < E; i++) if (t.codes[i] === 49) dashes.push(Number(t.vals[i]))
        doc.ltypes.set(str(t, S, E, 2).toUpperCase(), dashes)
        break
      }
      case 'STYLE': {
        let family = ''
        for (let i = S + 1; i < E; i++) if (t.codes[i] === 1000 && !family) family = String(t.vals[i])
        doc.styles.set(str(t, S, E, 2, 'STANDARD').toUpperCase(), {
          name: str(t, S, E, 2),
          font: str(t, S, E, 3),
          bigFont: str(t, S, E, 4),
          family,
          height: num(t, S, E, 40),
          width: num(t, S, E, 41, 1),
          oblique: num(t, S, E, 50),
          flags: num(t, S, E, 71)
        })
        break
      }
      case 'BLOCK_RECORD': {
        const name = str(t, S, E, 2)
        doc.recordByHandle.set(str(t, S, E, 5).toUpperCase(), name)
        const lay = str(t, S, E, 340)
        if (lay) doc.layoutOfRecord.set(name.toUpperCase(), lay.toUpperCase())
        break
      }
      case 'DIMSTYLE':
        doc.dimstyles.set(str(t, S, E, 2).toUpperCase(), r)
        break
    }
  }
}

function blocks(doc: DxfDoc, s: number, e: number): void {
  const t = doc.t
  const recs = records(t, s, e)
  let cur: BlockRec | null = null
  let body: Ent[] = []
  for (const r of recs) {
    if (r.type === 'BLOCK') {
      cur = { name: str(t, r.s, r.e, 2), base: [num(t, r.s, r.e, 10), num(t, r.s, r.e, 20)], flags: num(t, r.s, r.e, 70), ents: [] }
      if (cur.flags & 4) cur.xref = str(t, r.s, r.e, 1) || undefined
      body = []
    } else if (r.type === 'ENDBLK') {
      if (cur) {
        cur.ents = group(body)
        doc.blocks.set(cur.name.toUpperCase(), cur)
      }
      cur = null
    } else if (cur) body.push(r)
  }
}

export function entities(t: Tags, s: number, e: number): Ent[] {
  return group(records(t, s, e))
}

/** Attaches VERTEX and ATTRIB records to their POLYLINE / INSERT. */
function group(recs: Ent[]): Ent[] {
  const out: Ent[] = []
  let owner: Ent | null = null
  for (const r of recs) {
    if (r.type === 'SEQEND') {
      owner = null
      continue
    }
    if (owner && ((owner.type === 'POLYLINE' && r.type === 'VERTEX') || (owner.type === 'INSERT' && r.type === 'ATTRIB'))) {
      owner.children!.push(r)
      continue
    }
    owner = null
    if (r.type === 'POLYLINE' || r.type === 'INSERT') {
      r.children = []
      owner = r
    }
    out.push(r)
  }
  return out
}

function objects(doc: DxfDoc, s: number, e: number): void {
  for (const r of records(doc.t, s, e)) {
    if (r.type === 'LAYOUT') doc.layouts.push(r)
    else if (r.type === 'IMAGEDEF') {
      const file = str(doc.t, r.s, r.e, 1)
      if (file) doc.imageDefs.set(str(doc.t, r.s, r.e, 5).toUpperCase(), file)
    }
  }
}

export const VERSIONS: Record<string, string> = {
  AC1006: 'R10',
  AC1009: 'R11/R12',
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018'
}

export const UNITS = ['', 'in', 'ft', 'mi', 'mm', 'cm', 'm', 'km', 'µin', 'mil', 'yd', 'Å', 'nm', 'µm', 'dm', 'dam', 'hm', 'Gm', 'AU', 'ly', 'pc']
