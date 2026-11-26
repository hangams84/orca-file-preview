/** EPLAN Electric P8 files, read without EPLAN.
 *
 *  - `.elk` `.ell` `.elr` `.els` `.ela`: project *link* files. UTF-16 (or ANSI) text whose first
 *    line names the project data directory (`<name>.edb`) and whose second line is the database
 *    version. The project itself lives in that directory, which a single-file preview cannot see.
 *  - `.zw1` (project backup), `.elp` (packed project), `.elx` (packed filed-off project): archives
 *    of the `.edb` directory, normally 7z (some tools write ZIP). Inside: `ProjectInfo.xml`
 *    (project properties by id), `A_BAKINFO.XML` (backup info), `Page.eod` and other EPLAN object
 *    databases (proprietary binary), `Images/` (pictures used on pages).
 *  - `.edz`: EPLAN Data Portal part packages. A 7z (sometimes ZIP) with `manifest.xml` that lists
 *    packages (part, manufacturer, construction, ...) and their items (`items/partxml/*.part.xml`,
 *    macros `*.ema`, pictures, PDF documents).
 *
 *  Schematic pages are stored in the binary object databases and macros as EPLAN PXF graphics:
 *  neither can be drawn here, and the viewer says so. */
import { readZipEntry } from '../legacy/zip.ts'
import { is7z, readSevenZip, type SevenZip } from './sevenzip.ts'

export interface ArchiveEntry {
  path: string
  size: number
  dir: boolean
  mtime?: Date
  read(): Promise<Uint8Array>
}

export interface Archive {
  format: '7z' | 'zip'
  entries: ArchiveEntry[]
  methods: string[]
  solid: boolean
  encrypted: boolean
}

export function isZipBytes(b: Uint8Array): boolean {
  return b.length > 22 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)
}

/** ZIP central directory with sizes and UTF-8 names. */
function listZip(b: Uint8Array): ArchiveEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip: no end of central directory')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out: ArchiveEntry[] = []
  const utf8 = new TextDecoder('utf-8')
  const cp437 = new TextDecoder('windows-1252')
  for (let k = 0; k < count && p + 46 <= b.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip: bad central directory')
    const flags = dv.getUint16(p + 8, true)
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const size = dv.getUint32(p + 24, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    const rawName = b.subarray(p + 46, p + 46 + nameLen)
    const name = (flags & 0x800 ? utf8 : cp437).decode(rawName).replace(/\\/g, '/')
    const entry = { name, method, compSize, localOffset }
    out.push({
      path: name.replace(/\/$/, ''),
      size,
      dir: name.endsWith('/'),
      read: () => readZipEntry(b, entry)
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

export function openArchive(b: Uint8Array): Archive {
  if (is7z(b)) {
    const z: SevenZip = readSevenZip(b)
    return {
      format: '7z',
      methods: z.methods,
      solid: z.solid,
      encrypted: z.encrypted,
      entries: z.entries.map((e) => ({ path: e.path, size: e.size, dir: e.dir, mtime: e.mtime, read: async () => z.read(e) }))
    }
  }
  if (isZipBytes(b)) return { format: 'zip', methods: ['ZIP'], solid: false, encrypted: false, entries: listZip(b) }
  throw new Error('not an archive')
}

/** Case-insensitive lookup by full path or by the path's last part. */
export function findEntry(a: Archive, path: string): ArchiveEntry | undefined {
  const want = path.replace(/\\/g, '/').toLowerCase()
  return a.entries.find((e) => !e.dir && e.path.toLowerCase() === want)
}

export function findByBasename(a: Archive, re: RegExp): ArchiveEntry[] {
  return a.entries.filter((e) => !e.dir && re.test(e.path.split('/').pop() ?? ''))
}

// ---------------------------------------------------------------------------------------------
// Multi-language strings: "de_DE@Text;en_US@Text;" ("??_??" is language neutral).

export function parseMultiLang(s: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!/^[a-z?]{2}_[A-Z?]{2}@/.test(s)) return map
  // Values may contain ';' only escaped as ';;'? EPLAN does not escape: split at ";xx_XX@".
  const re = /([a-z?]{2}_[A-Z?]{2})@([\s\S]*?)(?=;[a-z?]{2}_[A-Z?]{2}@|;?$)/g
  for (const m of s.matchAll(re)) if (!map.has(m[1])) map.set(m[1], m[2].replace(/;$/, ''))
  return map
}

/** Picks the text for the UI language: Korean, else English, else neutral, else the first. */
export function pickLang(s: string, korean: boolean): string {
  const map = parseMultiLang(s)
  if (!map.size) return s
  const prefer = korean ? ['ko_KR', 'en_US', 'en_GB', '??_??'] : ['en_US', 'en_GB', '??_??']
  for (const k of prefer) {
    const v = map.get(k)
    if (v && v.trim()) return v.trim()
  }
  for (const v of map.values()) if (v.trim()) return v.trim()
  return ''
}

// ---------------------------------------------------------------------------------------------
// Link files

export interface LinkFile {
  /** Data directory named on line 1, e.g. `Project.edb`. */
  dataDir: string
  /** Database version on line 2, e.g. `18.0`. */
  dbVersion: string
  lines: string[]
  encoding: string
}

export function decodeTextGuess(b: Uint8Array): { text: string; encoding: string } {
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16LE' }
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16BE' }
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8' }
  // UTF-16LE without BOM: every other byte zero for ASCII text.
  let zeros = 0
  const n = Math.min(b.length, 200)
  for (let i = 1; i < n; i += 2) if (b[i] === 0) zeros++
  if (n > 4 && zeros > n / 3) return { text: new TextDecoder('utf-16le').decode(b), encoding: 'UTF-16LE' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252' }
  }
}

/** A project link file, or null when the bytes are not one (binary or too long). */
export function parseLinkFile(b: Uint8Array): LinkFile | null {
  if (b.length === 0 || b.length > 64 * 1024) return null
  const { text, encoding } = decodeTextGuess(b)
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) return null
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  if (!lines.length || lines.length > 50) return null
  return { dataDir: lines[0] ?? '', dbVersion: lines[1] ?? '', lines, encoding }
}

// ---------------------------------------------------------------------------------------------
// Minimal XML reading without a DOM (unit tests run without one). Enough for EPLAN's flat XML:
// elements, attributes, text; no DTDs or entities beyond the predefined and numeric ones.

export interface XmlEl {
  name: string
  attrs: Record<string, string>
  children: XmlEl[]
  text: string
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITY[e] ?? m
  })
}

/** Parses XML text into a tree. Throws on badly nested markup. */
export function parseXml(text: string, maxElements = 2_000_000): XmlEl {
  const root: XmlEl = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlEl[] = [root]
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>/g
  const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let last = 0
  let count = 0
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    const top = stack[stack.length - 1]
    if (m.index > last) top.text += unescapeXml(text.slice(last, m.index))
    last = tag.lastIndex
    if (m[5] != null) {
      top.text += m[5]
      continue
    }
    if (!m[2]) continue
    if (m[1]) {
      if (stack.length < 2 || top.name !== m[2]) throw new Error(`xml: unexpected </${m[2]}>`)
      stack.pop()
      continue
    }
    if (++count > maxElements) throw new Error('xml: too many elements')
    const attrs: Record<string, string> = {}
    for (const a of m[3].matchAll(attrRe)) attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '')
    const el: XmlEl = { name: m[2], attrs, children: [], text: '' }
    top.children.push(el)
    if (!m[4]) stack.push(el)
  }
  if (stack.length !== 1) throw new Error('xml: unclosed element')
  return root
}

export function xmlText(b: Uint8Array): string {
  return decodeTextGuess(b).text
}

export function* walkXml(el: XmlEl): Generator<XmlEl> {
  for (const c of el.children) {
    yield c
    yield* walkXml(c)
  }
}

// ---------------------------------------------------------------------------------------------
// EDZ

export interface EdzItem {
  type: string
  name: string
  locator: string
}

export interface EdzPackage {
  type: string
  key: string
  name: string
  items: EdzItem[]
}

export function parseManifest(text: string): { version: string; packages: EdzPackage[] } {
  const root = parseXml(text)
  const manifest = root.children.find((c) => c.name === 'manifest')
  if (!manifest) throw new Error('edz: manifest.xml has no <manifest>')
  const packages: EdzPackage[] = []
  for (const el of walkXml(manifest)) {
    if (el.name !== 'package') continue
    const items: EdzItem[] = []
    for (const it of walkXml(el)) if (it.name === 'item') items.push({ type: it.attrs.type ?? '', name: it.attrs.name ?? '', locator: it.attrs.locator ?? '' })
    packages.push({ type: el.attrs.type ?? '', key: el.attrs.key ?? '', name: el.attrs.name ?? el.attrs.key ?? '', items })
  }
  return { version: manifest.attrs.version ?? '', packages }
}

/** Archive entry for a manifest locator: `items/<item type>/<locator>`; part XML names escape
 *  characters such as `/` as `%2F`. Falls back to a case-insensitive basename match. */
export function resolveItem(a: Archive, item: EdzItem): ArchiveEntry | undefined {
  const loc = item.locator.replace(/\\/g, '/')
  const candidates = [`items/${item.type}/${loc}`, `items/${item.type}/${loc.split('/').map(encodeLocatorPart).join('/')}`, loc]
  // Part XML files sit flat in items/partxml: a '/' in the part number is part of the name.
  if (item.type === 'partxml') candidates.push(`items/partxml/${encodeLocatorPart(item.locator)}`)
  for (const c of candidates) {
    const e = findEntry(a, c)
    if (e) return e
  }
  const base = loc.split('/').pop()!.toLowerCase()
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  }
  return a.entries.find((e) => !e.dir && e.path.toLowerCase().startsWith(`items/${item.type.toLowerCase()}/`) && decode(e.path.split('/').pop()!).toLowerCase() === base)
}

function encodeLocatorPart(s: string): string {
  return s.replace(/[%/\\:*?"<>|]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
}

export interface EdzPart {
  /** P_ARTICLE_* and other attributes of <part> (raw). */
  attrs: Record<string, string>
  /** Free properties: description and value. */
  free: [string, string][]
  /** Function templates count per variant. */
  functionTemplates: number
  variants: number
  units: { length?: string; weight?: string }
}

export function parsePartXml(text: string): EdzPart[] {
  const root = parseXml(text)
  const pm = root.children.find((c) => c.name === 'partsmanagement')
  if (!pm) throw new Error('edz: part XML has no <partsmanagement>')
  const out: EdzPart[] = []
  for (const el of walkXml(pm)) {
    if (el.name !== 'part') continue
    const free: [string, string][] = []
    let templates = 0
    let variants = 0
    for (const c of walkXml(el)) {
      if (c.name === 'freeproperty') free.push([c.attrs.P_ARTICLE_FREE_DATA_DESCRIPTION ?? '', c.attrs.P_ARTICLE_FREE_DATA_VALUE ?? ''])
      else if (c.name === 'functiontemplate') templates++
      else if (c.name === 'variant') variants++
    }
    out.push({ attrs: el.attrs, free, functionTemplates: templates, variants, units: { length: pm.attrs['length-unit'], weight: pm.attrs['weight-unit'] } })
  }
  return out
}

/** Manufacturer / supplier address XML: <address P_PART_ADDRESS_SHORTNAME=..>. */
export function parseAddressXml(text: string): Record<string, string>[] {
  const root = parseXml(text)
  const out: Record<string, string>[] = []
  for (const el of walkXml(root)) if (el.name === 'address') out.push(el.attrs)
  return out
}

/** Readable labels for the part attributes shown first. The rest are listed under their names. */
export const PART_FIELDS: [string, string, string][] = [
  ['P_ARTICLE_PARTNR', '부품 번호', 'Part number'],
  ['P_ARTICLE_TYPENR', '형식 번호', 'Type number'],
  ['P_ARTICLE_ORDERNR', '주문 번호', 'Order number'],
  ['P_ARTICLE_MANUFACTURER', '제조사', 'Manufacturer'],
  ['P_ARTICLE_SUPPLIER', '공급사', 'Supplier'],
  ['P_ARTICLE_DESCR1', '설명 1', 'Description 1'],
  ['P_ARTICLE_DESCR2', '설명 2', 'Description 2'],
  ['P_ARTICLE_DESCR3', '설명 3', 'Description 3'],
  ['P_ARTICLE_NOTE', '비고', 'Note'],
  ['P_ARTICLE_PRODUCTTOPGROUP', '제품 상위 그룹', 'Product top group'],
  ['P_ARTICLE_PRODUCTGROUP', '제품 그룹', 'Product group'],
  ['P_ARTICLE_PRODUCTSUBGROUP', '제품 하위 그룹', 'Product subgroup'],
  ['P_ARTICLE_WIDTH', '폭', 'Width'],
  ['P_ARTICLE_HEIGHT', '높이', 'Height'],
  ['P_ARTICLE_DEPTH', '깊이', 'Depth'],
  ['P_ARTICLE_WEIGHT', '무게', 'Weight'],
  ['P_ARTICLE_CERTIFICATE_CE', 'CE 인증', 'CE certificate'],
  ['P_ARTICLE_DISCONTINUED', '단종', 'Discontinued'],
  ['P_ARTICLE_MACRO', '그래픽 매크로', 'Graphic macro'],
  ['P_ARTICLE_GROUPSYMBOLMACRO', '그룹 심볼 매크로', 'Group symbol macro'],
  ['P_ARTICLE_PICTUREFILE', '그림 파일', 'Picture file'],
  ['P_PART_CREATE', '생성', 'Created'],
  ['P_PART_LASTCHANGE', '마지막 변경', 'Last change']
]

// ---------------------------------------------------------------------------------------------
// Projects (archived)

export interface ProjectProperty {
  id: number
  name: string
  value: string
}

/** ProjectInfo.xml: <Property name=".." id="10011" index="0" type="7">value</Property>. */
export function parseProjectInfo(text: string): ProjectProperty[] {
  const root = parseXml(text)
  const out: ProjectProperty[] = []
  const seen = new Set<string>()
  for (const el of walkXml(root)) {
    if (el.name !== 'Property') continue
    const id = Number(el.attrs.id)
    const value = el.text.trim()
    if (!Number.isFinite(id) || !value) continue
    const key = `${id}\u0000${value}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id, name: el.attrs.name ?? '', value })
  }
  return out
}

/** Project property ids worth a readable label (names in the file follow the author's language). */
export const PROJECT_FIELDS: [number, string, string, 'text' | 'time'][] = [
  [10011, '프로젝트 설명', 'Project description', 'text'],
  [10013, '프로젝트 번호', 'Project number', 'text'],
  [10031, '프로젝트 유형', 'Project type', 'text'],
  [10015, '회사', 'Company', 'text'],
  [10032, '설치 장소', 'Installation site', 'text'],
  [10042, '제작 연도', 'Year of construction', 'text'],
  [10020, '작성자', 'Created by', 'text'],
  [10021, '생성 일시', 'Created', 'time'],
  [10022, '마지막 수정자', 'Last modified by', 'text'],
  [10023, '수정 일시', 'Modified', 'time'],
  [10025, '프로젝트 책임자', 'Project manager', 'text'],
  [10043, '마지막으로 저장한 EPLAN 버전', 'Last saved with EPLAN', 'text'],
  [10044, 'EPLAN 빌드', 'EPLAN build', 'text'],
  [10088, '사용된 최고 EPLAN 버전', 'Highest EPLAN version used', 'text']
]

export function formatUnixTime(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 1e8 || n > 4e9) return v
  return new Date(n * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

/** Multi-language descriptions stored in an EPLAN object database (Page.eod holds one per page
 *  that has a description). The record layout is not documented; this only collects the text
 *  runs that look like `xx_XX@...;` lists, in stored order. */
export function scanMultiLangStrings(b: Uint8Array, limit = 5000): string[] {
  const out: string[] = []
  const n = b.length
  for (let i = 0; i + 7 < n && out.length < limit; i++) {
    // ASCII "xx_XX@" (or "??_??@")
    const c0 = b[i]
    if (!((c0 >= 0x61 && c0 <= 0x7a) || c0 === 0x3f)) continue
    if (b[i + 2] !== 0x5f || b[i + 5] !== 0x40) continue
    const ok = (c: number, lower: boolean) => c === 0x3f || (lower ? c >= 0x61 && c <= 0x7a : c >= 0x41 && c <= 0x5a)
    if (!ok(b[i + 1], true) || !ok(b[i + 3], false) || !ok(b[i + 4], false)) continue
    if (i > 0 && b[i - 1] !== 0 && b[i - 1] !== 0x3b && b[i - 1] < 0x80 && b[i - 1] >= 0x20) continue
    // Run until a NUL byte.
    let j = i
    while (j < n && b[j] !== 0 && j - i < 8192) j++
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(i, j))
    } catch {
      text = new TextDecoder('utf-8').decode(b.subarray(i, j))
    }
    if (parseMultiLang(text).size) out.push(text)
    i = j
  }
  return out
}
