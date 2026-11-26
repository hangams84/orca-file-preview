/** SolidWorks documents (.sldprt, .sldasm, .slddrw, templates): the two containers and what can be
 *  read from them without SolidWorks.
 *
 *  - Up to SolidWorks 2014 a document is an OLE compound file. Large streams carry a `__ZLB` suffix
 *    and a frame: a 16-byte GUID, then chunks of (u32 inflated size, u32 compressed size, zlib),
 *    then 8 zero bytes. Files from 2001 and earlier use PKWARE "implode" (`__Zip`), not decoded here.
 *  - From 2015 a document is a ZIP-like archive behind an 8-byte header: local headers, a central
 *    directory and an end record sit at the ZIP offsets (counted from byte 8) but with per-file
 *    signatures, and each stream name byte is rotated by `byte 7 & 7` bits. Streams are raw
 *    deflate.
 *
 *  Inside either: `PreviewPNG` / `Preview` (DIB) thumbnails, `Images/Sheet_N` drawing sheet
 *  images, OLE property sets or `docProps/*.xml`, `swXmlContents/*` XML (referenced files,
 *  configurations, feature names), `_MO_VERSION_<n>` (release that saved the file) and
 *  `Contents/DisplayLists` / `FaceTessellations/*` (the display mesh SolidWorks drew). Layouts
 *  follow the public notes at github.com/blussyya/sldprt-format-research (facts only, no code). */
import { inflateSync, unzlibSync } from '../../../vendor/zip.js'
import { isCfb, readCfb } from '../legacy/cfb.ts'
import { readPropertySet, FMTID_DOCSUMMARY, FMTID_SUMMARY, FMTID_USER } from './olepropset.ts'

export class SwError extends Error {}

export interface SwStream {
  /** Path with `/` separators and any `__ZLB` suffix removed. */
  name: string
  /** Stored (compressed) size when known. */
  stored: number
  /** Decoded size when known without decoding, else -1. */
  size: number
  /** `zlb` and `deflate` streams decode transparently; `implode` and `bad` cannot be read. */
  encoding: 'plain' | 'zlb' | 'deflate' | 'implode'
  read(): Uint8Array
}

export interface SwContainer {
  kind: 'modern' | 'ole'
  streams: SwStream[]
  get(name: string): Uint8Array | null
}

const MODERN_MAGIC_AT = 4

/** Modern (2015+) container: bytes 4..7 are 00 00 00 04. */
export function isModernSw(b: Uint8Array): boolean {
  return b.length > 64 && b[MODERN_MAGIC_AT] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 4
}

export function isSolidWorks(b: Uint8Array): boolean {
  return isModernSw(b) || isCfb(b)
}

export function openSw(b: Uint8Array): SwContainer {
  if (isCfb(b)) return openOle(b)
  if (isModernSw(b)) return openModern(b)
  throw new SwError('not a SolidWorks container')
}

function makeContainer(kind: SwContainer['kind'], streams: SwStream[]): SwContainer {
  const byName = new Map(streams.map((s) => [s.name.toLowerCase(), s]))
  return {
    kind,
    streams,
    get(name) {
      const s = byName.get(name.toLowerCase())
      if (!s || s.encoding === 'implode') return null
      try {
        return s.read()
      } catch {
        return null
      }
    }
  }
}

function openModern(b: Uint8Array): SwContainer {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const k = b[7] & 7
  const unrotate = (x: number) => ((x >>> k) | (x << (8 - k))) & 0xff
  // The end record sits at 8 + directory offset + directory size; scan back for the one whose
  // directory walks with one signature and in-range headers.
  for (let i = b.length - 22; i >= 8; i--) {
    if (dv.getUint32(i + 4, true) !== 0) continue
    const count = dv.getUint16(i + 8, true)
    if (count === 0 || count !== dv.getUint16(i + 10, true)) continue
    const size = dv.getUint32(i + 12, true)
    const off = dv.getUint32(i + 16, true)
    if (8 + off + size !== i) continue
    const streams = walkModernDirectory(b, dv, 8 + off, count, unrotate)
    if (streams) return makeContainer('modern', streams)
  }
  throw new SwError('modern container: no directory (truncated or damaged file)')
}

function walkModernDirectory(b: Uint8Array, dv: DataView, start: number, count: number, unrotate: (x: number) => number): SwStream[] | null {
  const out: SwStream[] = []
  let p = start
  if (p + 46 > b.length) return null
  const sig = dv.getUint32(p, true)
  const latin = new TextDecoder('latin1')
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== sig) return null
    const compSize = dv.getUint32(p + 20, true)
    const size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true) + 8
    if (p + 46 + nameLen > b.length || local + 30 > b.length) return null
    const raw = b.subarray(p + 46, p + 46 + nameLen).map(unrotate)
    let name = latin.decode(raw)
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    } catch {
      // keep the Latin-1 reading
    }
    const lNameLen = dv.getUint16(local + 26, true)
    const lExtra = dv.getUint16(local + 28, true)
    const dataStart = local + 30 + lNameLen + lExtra
    if (dataStart + compSize > b.length) return null
    out.push({
      name,
      stored: compSize,
      size,
      encoding: 'deflate',
      read() {
        if (compSize === 0 || size === 0) return new Uint8Array(0)
        const data = inflateSync(b.subarray(dataStart, dataStart + compSize), { out: new Uint8Array(size) })
        if (data.length !== size) throw new SwError(`stream ${name}: size mismatch`)
        return data
      }
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const ZLB_GUID = [0x23, 0x1d, 0xd5, 0x71, 0xda, 0x81, 0x48, 0xa2, 0xa8, 0x58, 0x98, 0xb2, 0x1b, 0x89, 0xef, 0x99]

/** The `__ZLB` frame (and the Parasolid section frame after its size word). */
export function decodeZlbFrame(s: Uint8Array): Uint8Array {
  let p = 0
  if (!ZLB_GUID.every((v, i) => s[i] === v)) {
    // Parasolid partitions put a u32 size in front of the GUID.
    if (ZLB_GUID.every((v, i) => s[i + 4] === v)) p = 4
    else throw new SwError('zlb: no frame GUID')
  }
  p += 16
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength)
  const parts: Uint8Array[] = []
  let total = 0
  while (p + 8 <= s.length) {
    const inflated = dv.getUint32(p, true)
    const compressed = dv.getUint32(p + 4, true)
    p += 8
    if (inflated === 0 && compressed === 0) break
    if (p + compressed > s.length) throw new SwError('zlb: chunk beyond the stream')
    const part = unzlibSync(s.subarray(p, p + compressed))
    if (part.length !== inflated) throw new SwError('zlb: chunk size mismatch')
    parts.push(part)
    total += part.length
    p += compressed
  }
  if (parts.length === 1) return parts[0]
  const out = new Uint8Array(total)
  let o = 0
  for (const part of parts) {
    out.set(part, o)
    o += part.length
  }
  return out
}

function openOle(b: Uint8Array): SwContainer {
  const cfb = readCfb(b)
  const streams: SwStream[] = []
  const walk = (path: string, depth: number) => {
    if (depth > 8) return
    for (const name of cfb.list?.(path) ?? []) {
      const full = path ? `${path}/${name}` : name
      const data = cfb.open?.(full) ?? null
      if (!data) {
        // A storage (or an empty name): descend. `_MO_VERSION_<n>` storages carry the version.
        streams.push({ name: `${full}/`, stored: 0, size: 0, encoding: 'plain', read: () => new Uint8Array(0) })
        walk(full, depth + 1)
        continue
      }
      if (/__ZLB$/i.test(name)) {
        let cached: Uint8Array | null = null
        streams.push({
          name: full.replace(/__ZLB$/i, ''),
          stored: data.length,
          size: -1,
          encoding: 'zlb',
          read: () => (cached ??= decodeZlbFrame(data))
        })
      } else if (/__Zip$/i.test(name)) {
        streams.push({ name: full.replace(/__Zip$/i, ''), stored: data.length, size: -1, encoding: 'implode', read: () => data })
      } else {
        streams.push({ name: full, stored: data.length, size: data.length, encoding: 'plain', read: () => data })
      }
    }
  }
  walk('', 0)
  return makeContainer('ole', streams)
}

// ---------------------------------------------------------------------------------------------
// Versions

const RELEASES: [number, string][] = [
  [44, '95'],
  [822, '98'],
  [1500, '2000'],
  [1750, '2001'],
  [1950, '2001 Plus'],
  [2200, '2003'],
  [3400, '2007'],
  [3800, '2008'],
  [4100, '2009'],
  [4400, '2010'],
  [4700, '2011'],
  [5000, '2012']
]

/** SolidWorks release for a version code (`_MO_VERSION_<n>`), e.g. 17000 → "2024". */
export function releaseName(code: number): string {
  if (code >= 6000) return String(2007 + Math.floor(code / 1000))
  let best: [number, string] | null = null
  for (const r of RELEASES) if (r[0] <= code) best = r
  if (!best) return `? (${code})`
  return best[0] === code ? best[1] : `${best[1]}+`
}

export interface SwSave {
  code: number
  release: string
  /** Build date from the YYYYDDD date code, when present. */
  build?: string
  created: boolean
}

/** Saves recorded in the `History` stream (moVersionHistory_c). Returns [] when it does not parse. */
export function readHistory(s: Uint8Array): SwSave[] {
  try {
    const dv = new DataView(s.buffer, s.byteOffset, s.byteLength)
    let p = 0
    const u16 = () => {
      const v = dv.getUint16(p, true)
      p += 2
      return v
    }
    const u32 = () => {
      const v = dv.getUint32(p, true)
      p += 4
      return v
    }
    const classHeader = () => {
      const tag = u16()
      if (tag === 0xffff) {
        u16()
        const len = u16()
        p += len
      } else if ((tag & 0x8000) === 0) throw new Error('class tag')
    }
    const string = () => {
      if (s[p] === 0xff && s[p + 1] === 0xfe && s[p + 2] === 0xff) {
        p += 3
        let n = s[p++]
        if (n === 0xff) n = u16()
        p += n * 2
      } else {
        const n = s[p++]
        p += n
      }
    }
    classHeader()
    const count = u32()
    if (count > 1000) return []
    const saves: SwSave[] = []
    for (let i = 0; i < count; i++) {
      u32()
      u16()
      u32()
      string()
      const code = u32()
      classHeader()
      const k = u32()
      if (k > 100) return []
      let last = 0
      for (let j = 0; j < k; j++) last = u32()
      const date = last & 0xffffff
      const year = Math.floor(date / 1000)
      const day = date % 1000
      saves.push({
        code,
        release: releaseName(code),
        build: year > 1990 && year < 2100 && day > 0 && day <= 366 ? `${year}/${String(day).padStart(3, '0')}` : undefined,
        created: (last >>> 24) === 1
      })
    }
    return saves
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------------------------
// Properties

export interface SwProps {
  /** Summary-like fields: title, author, dates, application. */
  summary: [string, string][]
  /** Custom properties of the document (file-level). */
  custom: [string, string][]
  /** Per configuration custom properties (configuration-specific tab). */
  configs: { name: string; props: [string, string][] }[]
  /** SolidWorks-maintained document information (SW-* names, unit settings), shown collapsed. */
  info: [string, string][]
}

function fmtValue(v: unknown): string {
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v ?? '')
}

function xmlDoc(bytes: Uint8Array | null): Document | null {
  if (!bytes || bytes.length === 0) return null
  // Some swXmlContents streams carry a few bytes before the XML declaration.
  let text = new TextDecoder('utf-8').decode(bytes)
  const at = text.indexOf('<')
  if (at < 0) return null
  text = text.slice(at)
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

/** docProps/*.xml (modern) property lists: <property name=".."><vt:x>value</vt:x></property>. */
function xmlPropertyList(doc: Document | null): [string, string][] {
  if (!doc) return []
  const out: [string, string][] = []
  for (const el of Array.from(doc.getElementsByTagName('property'))) {
    const name = el.getAttribute('name') ?? ''
    if (!name) continue
    out.push([name, (el.textContent ?? '').trim()])
  }
  return out
}

const CORE_LABELS: Record<string, string> = {
  title: 'Title',
  subject: 'Subject',
  creator: 'Author',
  keywords: 'Keywords',
  description: 'Comments',
  lastModifiedBy: 'Last saved by',
  created: 'Created',
  modified: 'Last saved',
  Application: 'Application',
  AppVersion: 'Application version',
  Company: 'Company',
  TotalTime: 'Total editing time (min)'
}

export function readProps(c: SwContainer): SwProps {
  const props: SwProps = { summary: [], custom: [], configs: [], info: [] }
  const summarySeen = new Set<string>()
  const addSummary = (k: string, v: string) => {
    if (!v || summarySeen.has(k)) return
    // docProps dates are ISO 8601: show them like the property-set dates.
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v)) v = v.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC')
    summarySeen.add(k)
    props.summary.push([k, v])
  }
  // Modern: docProps/*.xml
  for (const part of ['docProps/core.xml', 'docProps/app.xml']) {
    const doc = xmlDoc(c.get(part))
    if (!doc?.documentElement) continue
    for (const el of Array.from(doc.documentElement.children)) {
      const label = CORE_LABELS[el.localName]
      if (label) addSummary(label, (el.textContent ?? '').trim())
    }
  }
  const sections = (name: string) => {
    const s = c.get(name)
    return s ? readPropertySet(s) : []
  }
  // OLE: property sets.
  for (const sec of [...sections('SummaryInformation'), ...sections('DocumentSummaryInformation')]) {
    if (sec.fmtid === FMTID_SUMMARY || sec.fmtid === FMTID_DOCSUMMARY) {
      for (const p of sec.properties) if (!p.name.startsWith('#')) addSummary(p.name, fmtValue(p.value))
    } else if (sec.fmtid === FMTID_USER) {
      for (const p of sec.properties) if (p.name && !p.name.startsWith('#')) props.custom.push([p.name, fmtValue(p.value)])
    }
  }
  const customXml = xmlPropertyList(xmlDoc(c.get('docProps/custom.xml'))).filter(([k]) => k)
  for (const kv of customXml) if (!props.custom.some(([k]) => k === kv[0])) props.custom.push(kv)
  // ISolidWorksInformation: SW-* fields and units.
  const swInfo: [string, string][] = xmlPropertyList(xmlDoc(c.get('docProps/ISolidWorksInformation.xml')))
  for (const sec of sections('ISolidWorksInformation')) for (const p of sec.properties) if (!p.name.startsWith('#')) swInfo.push([p.name, fmtValue(p.value)])
  props.info = swInfo
  const pick = (k: string) => swInfo.find(([n]) => n === k)?.[1] ?? ''
  addSummary('Author', pick('SW-Author'))
  addSummary('Created', pick('SW-Created Date'))
  addSummary('Last saved', pick('SW-Last Saved Date'))
  addSummary('Last saved by', pick('SW-Last Saved By'))
  addSummary('Title', pick('SW-Title'))
  // Configuration-specific custom properties.
  const configNames = new Map<string, string>()
  for (const s of c.streams) {
    const m = /^(?:docProps\/)?Config-(\d+)-Properties(?:\.xml)?$/i.exec(s.name)
    if (!m) continue
    const data = c.get(s.name)
    if (!data) continue
    let list: [string, string][]
    if (data[0] === 0xfe && data[1] === 0xff) {
      list = []
      for (const sec of readPropertySet(data)) for (const p of sec.properties) if (p.name && !p.name.startsWith('#')) list.push([p.name, fmtValue(p.value)])
    } else list = xmlPropertyList(xmlDoc(data))
    list = list.filter(([k]) => k)
    if (list.length) configNames.set(m[1], m[1])
    if (list.length) props.configs.push({ name: `Config-${m[1]}`, props: list })
  }
  return props
}

// ---------------------------------------------------------------------------------------------
// swXmlContents: referenced files, configurations, features, components

export interface SwXmlFacts {
  files: { path: string; type: string; imported?: string }[]
  configurations: { name: string; recent: boolean; description?: string }[]
  features: { name: string; type: string }[]
  components: string[]
  /** Drawing sheet names from SheetPreviews/SheetNames. */
  sheets: string[]
}

export function readXmlFacts(c: SwContainer): SwXmlFacts {
  const facts: SwXmlFacts = { files: [], configurations: [], features: [], components: [], sheets: [] }
  const seenFiles = new Set<string>()
  const seenConfigs = new Set<string>()
  for (const s of c.streams) {
    if (!/^swXmlContents\//i.test(s.name)) continue
    const doc = xmlDoc(c.get(s.name))
    if (!doc) continue
    for (const el of Array.from(doc.getElementsByTagName('swFile'))) {
      const path = el.getAttribute('swPath') ?? ''
      if (!path || seenFiles.has(path.toLowerCase())) continue
      seenFiles.add(path.toLowerCase())
      facts.files.push({ path, type: el.getAttribute('swDocType') ?? '', imported: el.getAttribute('swImportedPath') ?? undefined })
    }
    for (const el of Array.from(doc.getElementsByTagName('swConfiguration'))) {
      const name = el.getAttribute('swName') ?? ''
      if (!name || seenConfigs.has(name)) continue
      seenConfigs.add(name)
      facts.configurations.push({ name, recent: el.getAttribute('swMostRecentConfiguration') === 'YES' })
    }
    if (doc.documentElement?.localName === 'Keywords') {
      for (const el of Array.from(doc.documentElement.children)) {
        const name = el.getAttribute('Name') ?? ''
        if (el.localName === 'Configuration' && name && !seenConfigs.has(name)) {
          seenConfigs.add(name)
          facts.configurations.push({ name, recent: false, description: el.getAttribute('Description') ?? undefined })
        } else if (el.localName === 'Feature' && name) {
          facts.features.push({ name: name.replace(/___EndTag___$/, ''), type: el.getAttribute('Type') ?? '' })
        } else if (el.localName === 'Reference' && name) facts.components.push(name)
      }
    }
  }
  const sheetNames = c.get('SheetPreviews/SheetNames')
  if (sheetNames) facts.sheets = readMfcStrings(sheetNames)
  return facts
}

/** MFC CStrings (`ff fe ff`, a length, UTF-16LE) found in a small stream, in order. */
export function readMfcStrings(s: Uint8Array): string[] {
  const out: string[] = []
  for (let p = 0; p + 4 <= s.length; p++) {
    if (s[p] !== 0xff || s[p + 1] !== 0xfe || s[p + 2] !== 0xff) continue
    let n = s[p + 3]
    let q = p + 4
    if (n === 0xff) {
      n = s[q] | (s[q + 1] << 8)
      q += 2
    }
    if (n === 0 || q + n * 2 > s.length) continue
    out.push(new TextDecoder('utf-16le').decode(s.subarray(q, q + n * 2)))
    p = q + n * 2 - 1
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Images

export interface SwImage {
  name: string
  mime: 'image/png' | 'image/bmp'
  bytes: Uint8Array
}

/** A DIB (BITMAPINFOHEADER and pixels) as a .bmp file. */
export function dibToBmp(dib: Uint8Array): Uint8Array | null {
  if (dib.length < 40) return null
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength)
  const hdr = dv.getUint32(0, true)
  if (hdr !== 40 && hdr !== 108 && hdr !== 124) return null
  const bpp = dv.getUint16(14, true)
  const compression = dv.getUint32(16, true)
  let colors = dv.getUint32(32, true)
  if (colors === 0 && bpp <= 8) colors = 1 << bpp
  const masks = compression === 3 && hdr === 40 ? 12 : 0
  const pixelOffset = 14 + hdr + masks + colors * 4
  const out = new Uint8Array(14 + dib.length)
  const o = new DataView(out.buffer)
  out[0] = 0x42
  out[1] = 0x4d
  o.setUint32(2, out.length, true)
  o.setUint32(10, pixelOffset, true)
  out.set(dib, 14)
  return out
}

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

export function readImages(c: SwContainer): SwImage[] {
  const out: SwImage[] = []
  const png = c.get('PreviewPNG')
  if (png && isPng(png)) out.push({ name: 'PreviewPNG', mime: 'image/png', bytes: png })
  for (const s of c.streams) {
    if (!/^Images\/Sheet_\d+$/i.test(s.name)) continue
    const data = c.get(s.name)
    if (data && isPng(data)) out.push({ name: s.name, mime: 'image/png', bytes: data })
  }
  const dib = c.get('Preview')
  if (dib && dib.length > 44) {
    // u32 length, then the DIB.
    const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength)
    const len = dv.getUint32(0, true)
    const body = len > 0 && len <= dib.length - 4 ? dib.subarray(4, 4 + len) : dib.subarray(4)
    const bmp = dibToBmp(body)
    if (bmp) out.push({ name: 'Preview', mime: 'image/bmp', bytes: bmp })
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Display mesh

export interface SwMesh {
  name: string
  /** Millimetres. */
  position: Float32Array
  normal: Float32Array
  index: Uint32Array
  faces: number
}

export const MESH_LIMITS = { faces: 500_000, vertices: 20_000_000 }

/** Face records of a DisplayLists / FaceTessellations stream: strip lengths [4,8,2,S], then
 *  positions and normals [12,100,2,V] with V = sum of the strip lengths and unit normals. Each
 *  strip is an ordinary triangle strip over its own vertices; coordinates are metres. */
export function readDisplayMesh(d: Uint8Array, name: string): SwMesh | null {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const n = d.length
  const u32 = (o: number) => dv.getUint32(o, true)
  const faces: { strips: number[]; pos: number; nrm: number; v: number }[] = []
  let totalV = 0
  let totalT = 0
  let i = 0
  while (i + 16 <= n) {
    // Cheap first-byte test: the header starts 04 00 00 00 08 00 00 00 02 00 00 00.
    if (d[i] !== 4 || d[i + 4] !== 8 || d[i + 8] !== 2 || u32(i) !== 4 || u32(i + 4) !== 8 || u32(i + 8) !== 2) {
      i++
      continue
    }
    const S = u32(i + 12)
    let p = i + 16
    if (S === 0 || S > 1_000_000 || p + 4 * S + 32 > n) {
      i++
      continue
    }
    let V = 0
    let ok = true
    const strips: number[] = []
    for (let k = 0; k < S; k++) {
      const L = u32(p + 4 * k)
      if (L < 3 || L > 10_000_000) {
        ok = false
        break
      }
      strips.push(L)
      V += L
    }
    p += 4 * S
    if (!ok || u32(p) !== 12 || u32(p + 4) !== 100 || u32(p + 8) !== 2 || u32(p + 12) !== V || p + 32 + 24 * V > n) {
      i++
      continue
    }
    const pos = p + 16
    const q = pos + 12 * V
    if (u32(q) !== 12 || u32(q + 4) !== 100 || u32(q + 8) !== 2 || u32(q + 12) !== V) {
      i++
      continue
    }
    const nrm = q + 16
    // Normals are unit length; positions are finite and within a kilometre.
    let bad = false
    const step = Math.max(1, Math.floor(V / 64))
    for (let k = 0; k < V && !bad; k += step) {
      const x = dv.getFloat32(nrm + 12 * k, true)
      const y = dv.getFloat32(nrm + 12 * k + 4, true)
      const z = dv.getFloat32(nrm + 12 * k + 8, true)
      const l = x * x + y * y + z * z
      if (!(Math.abs(l - 1) < 0.02)) bad = true
      const px = dv.getFloat32(pos + 12 * k, true)
      const py = dv.getFloat32(pos + 12 * k + 4, true)
      const pz = dv.getFloat32(pos + 12 * k + 8, true)
      if (!(Math.abs(px) < 1000 && Math.abs(py) < 1000 && Math.abs(pz) < 1000)) bad = true
    }
    if (bad) {
      i++
      continue
    }
    faces.push({ strips, pos, nrm, v: V })
    totalV += V
    totalT += V - 2 * S
    if (faces.length > MESH_LIMITS.faces || totalV > MESH_LIMITS.vertices) throw new SwError('display mesh too large')
    i = nrm + 12 * V
  }
  if (!faces.length) return null
  const position = new Float32Array(totalV * 3)
  const normal = new Float32Array(totalV * 3)
  const index = new Uint32Array(totalT * 3)
  let v = 0
  let t = 0
  for (const f of faces) {
    for (let k = 0; k < f.v * 3; k++) {
      position[v * 3 + k] = dv.getFloat32(f.pos + 4 * k, true) * 1000
      normal[v * 3 + k] = dv.getFloat32(f.nrm + 4 * k, true)
    }
    let base = v
    for (const L of f.strips) {
      for (let k = 2; k < L; k++) {
        if (k % 2 === 0) {
          index[t++] = base + k - 2
          index[t++] = base + k - 1
        } else {
          index[t++] = base + k - 1
          index[t++] = base + k - 2
        }
        index[t++] = base + k
      }
      base += L
    }
    v += f.v
  }
  return { name, position, normal, index, faces: faces.length }
}

export interface SwMeshResult {
  meshes: SwMesh[]
  /** Streams that were looked at. */
  sources: string[]
  /** A display stream exists but is stored with the old implode compression. */
  imploded: boolean
}

/** The display mesh of a part (`Contents/DisplayLists`) or the per-component tessellations an
 *  assembly stores (`FaceTessellations/*`). */
export function readMeshes(c: SwContainer): SwMeshResult {
  const res: SwMeshResult = { meshes: [], sources: [], imploded: false }
  const candidates = c.streams.filter((s) => /^(Contents\/)?DisplayLists$/i.test(s.name) || /^FaceTessellations\/(?!Directory$)/i.test(s.name))
  for (const s of candidates) {
    if (s.encoding === 'implode') {
      res.imploded = true
      continue
    }
    const data = c.get(s.name)
    if (!data) continue
    res.sources.push(s.name)
    const m = readDisplayMesh(data, s.name)
    if (m) res.meshes.push(m)
  }
  // An assembly's own DisplayLists holds no faces; prefer the component tessellations when both exist.
  if (res.meshes.some((m) => /^FaceTessellations\//i.test(m.name))) res.meshes = res.meshes.filter((m) => /^FaceTessellations\//i.test(m.name))
  return res
}

// ---------------------------------------------------------------------------------------------
// Summary of everything

export interface SwDocument {
  container: SwContainer
  docType: 'part' | 'assembly' | 'drawing' | 'sheet-format' | 'unknown'
  /** Release code of the last save (`_MO_VERSION_<n>`), or 0. */
  versionCode: number
  saves: SwSave[]
  props: SwProps
  xml: SwXmlFacts
  images: SwImage[]
}

const EXT_TYPES: Record<string, SwDocument['docType']> = {
  sldprt: 'part',
  prtdot: 'part',
  sldasm: 'assembly',
  asmdot: 'assembly',
  slddrw: 'drawing',
  drwdot: 'drawing',
  slddrt: 'sheet-format'
}

export function readSwDocument(b: Uint8Array, ext: string): SwDocument {
  const container = openSw(b)
  let versionCode = 0
  let historyStream: string | null = null
  for (const s of container.streams) {
    const m = /^_MO_VERSION_(\d+)(\/|$)/i.exec(s.name)
    if (m) {
      versionCode = Math.max(versionCode, Number(m[1]))
      if (/\/History$/i.test(s.name)) historyStream = s.name
    }
  }
  if (!historyStream && container.streams.some((s) => /^History$/i.test(s.name))) historyStream = 'History'
  const saves = historyStream ? readHistory(container.get(historyStream) ?? new Uint8Array(0)) : []
  let docType = EXT_TYPES[ext] ?? 'unknown'
  // The contents tell the truth when the suffix does not.
  const has = (re: RegExp) => container.streams.some((s) => re.test(s.name))
  if (has(/^Images\/Sheet_/i) || has(/^SheetPreviews\//i)) docType = ext === 'slddrt' ? 'sheet-format' : 'drawing'
  else if (has(/MatesList$/i) || has(/COMPINSTANCETREE$/i)) docType = 'assembly'
  return { container, docType, versionCode, saves, props: readProps(container), xml: readXmlFacts(container), images: readImages(container) }
}
