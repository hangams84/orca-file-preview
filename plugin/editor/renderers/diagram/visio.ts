/** Visio (.vsdx/.vsdm/.vstx/.vssx) reader: OPC package → pages (with background pages), masters
 *  and style sheets resolved per cell, Geometry sections, groups, connectors, text blocks, fills,
 *  line patterns, gradients, basic theme colours and fonts, pictures (EMF/WMF via office/images.ts)
 *  and hyperlinks → SVG. Lengths stay in inches (Visio's internal unit) and the page transform maps
 *  them to CSS pixels (96 per inch) with y pointing down. */
import { PreviewError, type PreviewContext } from '../../core/types.ts'
import { OoxmlPackage, type Rel } from '../office/package.ts'
import { guardZip, isZip } from '../office/zipguard.ts'
import { arrowHead, Bounds, Defs, el, fmt, linkBadge, textObject, type P } from './svg.ts'
import { PAGE_LINK_ATTR, type BuiltPage, type DiagramDoc, type DiagramPage } from './types.ts'
import { geometryPath, type GeoRow } from './visio-geom.ts'

const PX = 96

// --------------------------------------------------------------------------------- sheets

interface Cell {
  v: string | null
  f: string | null
}
interface Row {
  t: string | null
  ix: number
  n: string | null
  del: boolean
  cells: Map<string, Cell>
}
interface Section {
  n: string
  ix: number
  del: boolean
  cells: Map<string, Cell>
  rows: Map<string, Row>
}
interface Sheet {
  cells: Map<string, Cell>
  /** Sections by `N` (Geometry sections by `Geometry#IX`). */
  sections: Map<string, Section>
  /** LineStyle / FillStyle / TextStyle attributes. */
  style: { line: string | null; fill: string | null; text: string | null }
}

function readCell(c: Element): Cell {
  return { v: c.getAttribute('V'), f: c.getAttribute('F') }
}

function readSheet(e: Element): Sheet {
  const sheet: Sheet = {
    cells: new Map(),
    sections: new Map(),
    style: { line: e.getAttribute('LineStyle'), fill: e.getAttribute('FillStyle'), text: e.getAttribute('TextStyle') }
  }
  for (const c of Array.from(e.children)) {
    if (c.localName === 'Cell') sheet.cells.set(c.getAttribute('N') ?? '', readCell(c))
    else if (c.localName === 'Section') {
      const n = c.getAttribute('N') ?? ''
      const ix = Number(c.getAttribute('IX') ?? '0') || 0
      const sec: Section = { n, ix, del: c.getAttribute('Del') === '1', cells: new Map(), rows: new Map() }
      let auto = 0
      for (const r of Array.from(c.children)) {
        if (r.localName === 'Cell') sec.cells.set(r.getAttribute('N') ?? '', readCell(r))
        else if (r.localName === 'Row') {
          const rn = r.getAttribute('N')
          const rix = r.getAttribute('IX') != null ? Number(r.getAttribute('IX')) : auto
          auto = rix + 1
          const row: Row = { t: r.getAttribute('T'), ix: rix, n: rn, del: r.getAttribute('Del') === '1', cells: new Map() }
          for (const rc of Array.from(r.children)) if (rc.localName === 'Cell') row.cells.set(rc.getAttribute('N') ?? '', readCell(rc))
          sec.rows.set(rn ?? String(rix), row)
        }
      }
      sheet.sections.set(n === 'Geometry' ? `Geometry#${ix}` : n, sec)
    }
  }
  return sheet
}

// --------------------------------------------------------------------------------- shapes

interface VShape {
  id: string
  type: string
  sheet: Sheet
  text: Element | null
  children: VShape[]
  /** The master shape this shape inherits from. */
  master: VShape | null
  foreign: Element | null
  /** Relationships of the part the shape lives in (for pictures). */
  part: string
  name: string
}

interface Master {
  id: string
  name: string
  shapes: VShape[]
  byId: Map<string, VShape>
  sheet: Sheet | null
}

interface StyleSheet {
  sheet: Sheet
}

const LINE_CELLS = new Set(['LineWeight', 'LineColor', 'LinePattern', 'Rounding', 'EndArrowSize', 'BeginArrow', 'EndArrow', 'LineCap', 'BeginArrowSize', 'LineColorTrans', 'CompoundType'])
const FILL_CELLS = new Set([
  'FillForegnd', 'FillBkgnd', 'FillPattern', 'ShdwForegnd', 'ShdwPattern', 'FillForegndTrans', 'FillBkgndTrans', 'ShdwForegndTrans',
  'ShapeShdwType', 'ShapeShdwOffsetX', 'ShapeShdwOffsetY', 'ShapeShdwShow', 'ShapeShdwBlur', 'FillGradientEnabled', 'FillGradientDir', 'FillGradientAngle'
])
const TEXT_CELLS = new Set(['LeftMargin', 'RightMargin', 'TopMargin', 'BottomMargin', 'VerticalAlign', 'TextBkgnd', 'TextBkgndTrans', 'TextDirection', 'DefaultTabStop'])
const TEXT_SECTIONS = new Set(['Character', 'Paragraph', 'Tabs'])
const FILL_SECTIONS = new Set(['FillGradient'])
const LINE_SECTIONS = new Set(['LineGradient'])

type Category = 'line' | 'fill' | 'text' | 'other'
const cellCategory = (n: string): Category => (LINE_CELLS.has(n) ? 'line' : FILL_CELLS.has(n) ? 'fill' : TEXT_CELLS.has(n) ? 'text' : 'other')
const sectionCategory = (n: string): Category => (TEXT_SECTIONS.has(n) ? 'text' : FILL_SECTIONS.has(n) ? 'fill' : LINE_SECTIONS.has(n) ? 'line' : 'other')

class Doc {
  styles = new Map<string, StyleSheet>()
  colors = new Map<number, string>()
  fonts = new Map<string, string>()
  masters = new Map<string, Master>()
  theme: { colors: Record<string, string>; minor: string; major: string } = { colors: {}, minor: 'Calibri', major: 'Calibri' }

  /** Sheets that may define a cell, nearest first: shape, its masters, then its style sheets. */
  chain(s: VShape, cat: Category): Sheet[] {
    const out: Sheet[] = [s.sheet]
    let m = s.master
    let guard = 0
    while (m && guard++ < 8) {
      out.push(m.sheet)
      m = m.master
    }
    if (cat !== 'other') {
      let id: string | null = null
      for (let x: VShape | null = s, g = 0; x && g < 8; x = x.master, g++) {
        id = x.sheet.style[cat]
        if (id != null) break
      }
      const seen = new Set<string>()
      while (id != null && !seen.has(id)) {
        seen.add(id)
        const st = this.styles.get(id)
        if (!st) break
        out.push(st.sheet)
        id = st.sheet.style[cat]
      }
    }
    return out
  }

  cell(s: VShape, name: string): Cell | null {
    for (const sh of this.chain(s, cellCategory(name))) {
      const c = sh.cells.get(name)
      if (c && (c.v != null || c.f != null)) return c
    }
    return null
  }

  num(s: VShape, name: string, d: number): number {
    const c = this.cell(s, name)
    if (!c || c.v == null || c.v === '') return d
    const n = Number(c.v)
    return Number.isFinite(n) ? n : d
  }

  str(s: VShape, name: string): string | null {
    return this.cell(s, name)?.v ?? null
  }

  /** A section row's cell, inherited row by row (rows match by IX or name). */
  rowCell(s: VShape, section: string, row: string, name: string): Cell | null {
    for (const sh of this.chain(s, sectionCategory(section))) {
      const sec = sh.sections.get(section)
      if (!sec) continue
      if (sec.del) return null
      const r = sec.rows.get(row)
      if (!r) continue
      if (r.del) return null
      const c = r.cells.get(name)
      if (c && (c.v != null || c.f != null)) return c
    }
    return null
  }

  /** Row keys of a section across the chain. */
  rowKeys(s: VShape, section: string): string[] {
    const keys = new Set<string>()
    const chain = this.chain(s, sectionCategory(section)).reverse()
    for (const sh of chain) {
      const sec = sh.sections.get(section)
      if (!sec) continue
      if (sec.del) keys.clear()
      for (const [k, r] of sec.rows) {
        if (r.del) keys.delete(k)
        else keys.add(k)
      }
    }
    return [...keys]
  }

  /** Geometry sections merged by IX (master rows overridden cell by cell, Del honoured). */
  geometry(s: VShape): { noFill: boolean; noLine: boolean; noShow: boolean; rows: GeoRow[] }[] {
    const chain: Sheet[] = []
    for (let x: VShape | null = s, g = 0; x && g < 8; x = x.master, g++) chain.push(x.sheet)
    chain.reverse()
    const merged = new Map<number, { cells: Map<string, Cell>; rows: Map<number, Row> }>()
    for (const sh of chain) {
      for (const sec of sh.sections.values()) {
        if (sec.n !== 'Geometry') continue
        if (sec.del) {
          merged.delete(sec.ix)
          continue
        }
        let m = merged.get(sec.ix)
        if (!m) merged.set(sec.ix, (m = { cells: new Map(), rows: new Map() }))
        for (const [k, c] of sec.cells) m.cells.set(k, c)
        for (const r of sec.rows.values()) {
          if (r.del) {
            m.rows.delete(r.ix)
            continue
          }
          const prev = m.rows.get(r.ix)
          if (prev) {
            const cells = new Map(prev.cells)
            for (const [k, c] of r.cells) cells.set(k, c)
            m.rows.set(r.ix, { ...prev, t: r.t ?? prev.t, cells })
          } else m.rows.set(r.ix, r)
        }
      }
    }
    const flagOf = (cells: Map<string, Cell>, k: string) => {
      const v = cells.get(k)?.v
      return v === '1' || v === 'TRUE' || v === 'true'
    }
    return [...merged.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, m]) => ({
        noFill: flagOf(m.cells, 'NoFill'),
        noLine: flagOf(m.cells, 'NoLine'),
        noShow: flagOf(m.cells, 'NoShow'),
        rows: [...m.rows.values()]
          .sort((a, b) => a.ix - b.ix)
          .map((r) => {
            const v: Record<string, string> = {}
            for (const [k, c] of r.cells) {
              const val = c.v != null && c.v !== '' && !/^(NURBS|POLYLINE)$/i.test(c.v) ? c.v : (c.f ?? '')
              v[k] = val
            }
            return { t: r.t ?? '', v }
          })
      }))
  }

  /** Text: the shape's own, else the nearest master's. */
  textOf(s: VShape): { el: Element; owner: VShape } | null {
    for (let x: VShape | null = s, g = 0; x && g < 8; x = x.master, g++) if (x.text) return { el: x.text, owner: x }
    return null
  }

  /** A colour cell as CSS (#rrggbb), or null. */
  color(c: Cell | null, fallback: string | null): string | null {
    if (!c) return fallback
    const v = (c.v ?? '').trim()
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
    if (/^\d+$/.test(v)) return this.colors.get(Number(v)) ?? DEFAULT_COLORS[Number(v)] ?? fallback
    const rgb = /^RGB\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(v || (c.f ?? ''))
    if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}`
    return fallback
  }

  /** Theme colour by quick-style index (0 dark 1, 1 light 1, 2–7 accent 1–6). */
  themeColor(ix: number, fallback: string): string {
    const keys = ['dk1', 'lt1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
    return this.theme.colors[keys[ix] ?? 'accent1'] ?? fallback
  }
}

const DEFAULT_COLORS = [
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#800000', '#008000', '#000080', '#808000',
  '#800080', '#008080', '#c0c0c0', '#e6e6e6', '#cdcdcd', '#b3b3b3', '#9a9a9a', '#808080', '#666666', '#4d4d4d', '#333333', '#1a1a1a'
]

function readShapes(parent: Element | null, part: string, resolveMaster: (sh: Element, inherited: VShape | null) => VShape | null, inheritedParent: VShape | null): VShape[] {
  const out: VShape[] = []
  if (!parent) return out
  for (const e of Array.from(parent.children)) {
    if (e.localName !== 'Shape') continue
    const s: VShape = {
      id: e.getAttribute('ID') ?? '',
      type: e.getAttribute('Type') ?? 'Shape',
      sheet: readSheet(e),
      text: Array.from(e.children).find((c) => c.localName === 'Text') ?? null,
      children: [],
      master: null,
      foreign: Array.from(e.children).find((c) => c.localName === 'ForeignData') ?? null,
      part,
      name: e.getAttribute('NameU') ?? e.getAttribute('Name') ?? ''
    }
    s.master = resolveMaster(e, inheritedParent)
    const sub = Array.from(e.children).find((c) => c.localName === 'Shapes') ?? null
    s.children = readShapes(sub, part, resolveMaster, s)
    // An instance without its own sub-shapes shows the master's (a grouped master).
    if (!sub && s.master && s.master.children.length) s.children = s.master.children.map((c) => ({ ...c, master: c, sheet: emptySheet(), text: null, children: c.children }))
    out.push(s)
  }
  return out
}

function emptySheet(): Sheet {
  return { cells: new Map(), sections: new Map(), style: { line: null, fill: null, text: null } }
}

// ------------------------------------------------------------------------------- reading

type Tr = (ko: string, en: string) => string

function readTheme(pkg: OoxmlPackage, path: string | undefined, doc: Doc): void {
  if (!path) return
  const x = pkg.xml(path)
  if (!x) return
  const scheme = x.getElementsByTagNameNS('*', 'clrScheme')[0]
  if (scheme) {
    for (const c of Array.from(scheme.children)) {
      const srgb = c.getElementsByTagNameNS('*', 'srgbClr')[0]?.getAttribute('val')
      const sys = c.getElementsByTagNameNS('*', 'sysClr')[0]?.getAttribute('lastClr')
      const v = srgb ?? sys
      if (v) doc.theme.colors[c.localName] = `#${v.toLowerCase()}`
    }
  }
  const minor = x.getElementsByTagNameNS('*', 'minorFont')[0]?.getElementsByTagNameNS('*', 'latin')[0]?.getAttribute('typeface')
  const major = x.getElementsByTagNameNS('*', 'majorFont')[0]?.getElementsByTagNameNS('*', 'latin')[0]?.getAttribute('typeface')
  if (minor) doc.theme.minor = minor
  if (major) doc.theme.major = major
}

export async function readVisio(bytes: Uint8Array, ctx: PreviewContext): Promise<DiagramDoc> {
  const { tr, signal } = ctx
  if (!isZip(bytes)) {
    throw new PreviewError(
      'visio-format',
      bytes[0] === 0xd0 && bytes[1] === 0xcf
        ? tr('이전 Visio 형식(.vsd)은 지원하지 않습니다. Visio에서 .vsdx로 저장해 주세요.', 'The old binary Visio format (.vsd) is not supported. Save it as .vsdx in Visio.')
        : tr('Visio 패키지(ZIP)가 아닙니다.', 'This is not a Visio package (ZIP).')
    )
  }
  guardZip(bytes, tr)
  let pkg: OoxmlPackage
  try {
    pkg = OoxmlPackage.open(bytes, signal)
  } catch {
    throw new PreviewError('visio-zip', tr('Visio 파일의 압축을 풀 수 없습니다. 손상되었을 수 있습니다.', 'The Visio package could not be unpacked. It may be damaged.'))
  }
  // The document part from the package relationships (fallback: the usual path).
  const pkgRels = pkg.xml('_rels/.rels')
  let documentPath = 'visio/document.xml'
  for (const r of Array.from(pkgRels?.documentElement.children ?? [])) {
    if ((r.getAttribute('Type') ?? '').endsWith('/document')) documentPath = (r.getAttribute('Target') ?? documentPath).replace(/^\//, '')
  }
  const docXml = pkg.xml(documentPath)
  if (!docXml) throw new PreviewError('visio-document', tr('Visio 문서 파트(visio/document.xml)가 없습니다.', 'The Visio document part (visio/document.xml) is missing.'))
  const doc = new Doc()
  const dRels = pkg.rels(documentPath)
  const relOf = (type: string) => [...dRels.values()].find((r) => r.type === type)
  readTheme(pkg, relOf('theme')?.target, doc)

  // Colours, fonts and style sheets.
  for (const ce of Array.from(docXml.getElementsByTagNameNS('*', 'ColorEntry'))) {
    const rgb = ce.getAttribute('RGB')
    if (rgb) doc.colors.set(Number(ce.getAttribute('IX')), rgb.toLowerCase())
  }
  for (const fe of Array.from(docXml.getElementsByTagNameNS('*', 'FaceName'))) {
    const name = fe.getAttribute('NameU') ?? fe.getAttribute('Name')
    if (name) {
      if (fe.getAttribute('ID')) doc.fonts.set(fe.getAttribute('ID')!, name)
      doc.fonts.set(name, name)
    }
  }
  for (const se of Array.from(docXml.getElementsByTagNameNS('*', 'StyleSheet'))) doc.styles.set(se.getAttribute('ID') ?? '', { sheet: readSheet(se) })

  // Masters.
  const mastersPath = relOf('masters')?.target
  const mastersXml = mastersPath ? pkg.xml(mastersPath) : null
  const masterRels = mastersPath ? pkg.rels(mastersPath) : new Map<string, Rel>()
  const masterEls = new Map<string, { el: Element; part: string | null }>()
  for (const me of Array.from(mastersXml?.documentElement.children ?? [])) {
    if (me.localName !== 'Master') continue
    const rel = Array.from(me.children).find((c) => c.localName === 'Rel')
    const rid = rel ? (rel.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? rel.getAttribute('r:id')) : null
    masterEls.set(me.getAttribute('ID') ?? '', { el: me, part: rid ? (masterRels.get(rid)?.target ?? null) : null })
  }
  const loading = new Set<string>()
  const owner = new WeakMap<VShape, Master>()
  const getMaster = (id: string): Master | null => {
    const have = doc.masters.get(id)
    if (have) return have
    const m = masterEls.get(id)
    if (!m || !m.part || loading.has(id)) return null
    loading.add(id)
    const x = pkg.xml(m.part)
    const shapesEl = x ? Array.from(x.documentElement.children).find((c) => c.localName === 'Shapes') ?? null : null
    const master: Master = { id, name: m.el.getAttribute('NameU') ?? m.el.getAttribute('Name') ?? `Master ${id}`, shapes: [], byId: new Map(), sheet: null }
    const ps = Array.from(m.el.children).find((c) => c.localName === 'PageSheet')
    if (ps) master.sheet = readSheet(ps)
    // Shapes inside a master may point at other masters (rare) but not at their own master.
    master.shapes = readShapes(shapesEl, m.part, (e) => (e.getAttribute('Master') ? (getMaster(e.getAttribute('Master')!)?.shapes[0] ?? null) : null), null)
    const index = (list: VShape[]) => {
      for (const s of list) {
        master.byId.set(s.id, s)
        owner.set(s, master)
        index(s.children)
      }
    }
    index(master.shapes)
    doc.masters.set(id, master)
    loading.delete(id)
    return master
  }

  // Resolves the master shape of a page shape: `Master` on top-level instances, `MasterShape`
  // on sub-shapes (looked up in the master that holds the parent's master shape).
  const resolve = (e: Element, parent: VShape | null): VShape | null => {
    const mid = e.getAttribute('Master')
    const msid = e.getAttribute('MasterShape')
    if (mid) {
      const m = getMaster(mid)
      if (!m) return null
      return (msid ? m.byId.get(msid) : null) ?? m.shapes[0] ?? null
    }
    if (msid && parent?.master) return owner.get(parent.master)?.byId.get(msid) ?? null
    return null
  }

  // Pages.
  const pagesPath = relOf('pages')?.target
  const pagesXml = pagesPath ? pkg.xml(pagesPath) : null
  const pageRels = pagesPath ? pkg.rels(pagesPath) : new Map<string, Rel>()
  interface PageInfo {
    id: string
    name: string
    background: boolean
    backPage: string | null
    part: string | null
    width: number
    height: number
  }
  const infos: PageInfo[] = []
  for (const pe of Array.from(pagesXml?.documentElement.children ?? [])) {
    if (pe.localName !== 'Page') continue
    const rel = Array.from(pe.children).find((c) => c.localName === 'Rel')
    const rid = rel ? (rel.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? rel.getAttribute('r:id')) : null
    const ps = Array.from(pe.children).find((c) => c.localName === 'PageSheet')
    const sheet = ps ? readSheet(ps) : emptySheet()
    const n = (k: string, d: number) => {
      const v = Number(sheet.cells.get(k)?.v)
      return Number.isFinite(v) && v > 0 ? v : d
    }
    infos.push({
      id: pe.getAttribute('ID') ?? String(infos.length),
      name: pe.getAttribute('Name') ?? pe.getAttribute('NameU') ?? `Page-${infos.length + 1}`,
      background: pe.getAttribute('Background') === '1',
      backPage: pe.getAttribute('BackPage'),
      part: rid ? (pageRels.get(rid)?.target ?? null) : null,
      width: n('PageWidth', 8.5),
      height: n('PageHeight', 11)
    })
  }
  const byName = new Map(infos.map((p) => [p.name.toLowerCase(), p.id]))
  const pageShapes = new Map<string, VShape[]>()
  const shapesOfPage = (p: PageInfo): VShape[] => {
    let list = pageShapes.get(p.id)
    if (list) return list
    const x = p.part ? pkg.xml(p.part) : null
    const shapesEl = x ? Array.from(x.documentElement.children).find((c) => c.localName === 'Shapes') ?? null : null
    list = readShapes(shapesEl, p.part ?? '', resolve, null)
    pageShapes.set(p.id, list)
    return list
  }

  const pages: DiagramPage[] = []
  const build = (p: PageInfo) => async (): Promise<BuiltPage> => {
    const r = new Renderer(doc, pkg, byName, signal)
    const layers: VShape[][] = []
    const seen = new Set<string>()
    let bp: PageInfo | undefined = p
    while (bp && !seen.has(bp.id)) {
      seen.add(bp.id)
      layers.unshift(shapesOfPage(bp))
      const next: string | null = bp.backPage
      bp = next != null ? infos.find((q) => q.id === next) : undefined
    }
    return r.page(layers, p.width, p.height)
  }
  for (const p of infos) pages.push({ name: p.name, id: p.id, background: p.background, build: build(p) })

  // Stencils (.vssx) have no pages: show each master as a page.
  if (!pages.length) {
    for (const id of masterEls.keys()) {
      const m = getMaster(id)
      if (!m) continue
      const w = Number(m.sheet?.cells.get('PageWidth')?.v) || 2
      const h = Number(m.sheet?.cells.get('PageHeight')?.v) || 2
      pages.push({ name: m.name, id: `m${id}`, build: async () => new Renderer(doc, pkg, byName, signal).page([m.shapes], w, h) })
    }
  }
  if (!pages.length) throw new PreviewError('visio-empty', tr('Visio 파일에 페이지가 없습니다.', 'The Visio file has no pages.'))
  return { pages, format: 'Visio' }
}

// ------------------------------------------------------------------------------ rendering

/** 2-D affine matrix [a b c d e f] (x' = a x + c y + e, y' = b x + d y + f). */
type M = [number, number, number, number, number, number]
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5]
]
const apply = (m: M, p: P): P => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
const mstr = (m: M) => `matrix(${m.map(fmt).join(' ')})`

/** Local → parent transform of a shape (pin, local pin, flips, angle). */
function shapeMatrix(pinX: number, pinY: number, locX: number, locY: number, angle: number, flipX: boolean, flipY: boolean): M {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const fx = flipX ? -1 : 1
  const fy = flipY ? -1 : 1
  // T(pin) · R(angle) · S(flip) · T(-locPin)
  const r: M = [c * fx, s * fx, -s * fy, c * fy, 0, 0]
  const t = apply(r, { x: -locX, y: -locY })
  return [r[0], r[1], r[2], r[3], t.x + pinX, t.y + pinY]
}

const PATTERN_DASH: Record<number, number[]> = {
  2: [4, 3], 3: [1, 3], 4: [4, 3, 1, 3], 5: [4, 3, 1, 3, 1, 3], 6: [8, 3, 4, 3], 7: [10, 4], 8: [12, 3, 3, 3, 3, 3], 9: [6, 4],
  10: [1, 2], 11: [3, 2], 12: [5, 2, 1, 2], 13: [6, 2, 1, 2, 1, 2], 14: [8, 2, 3, 2], 15: [12, 4], 16: [16, 4, 4, 4], 17: [1, 1],
  18: [2, 1], 19: [3, 1, 1, 1], 20: [3, 1, 1, 1, 1, 1], 21: [5, 1, 3, 1], 22: [10, 2], 23: [2, 2]
}

/** Visio arrow numbers to our arrow kinds (approximate by kind). */
function arrowKind(n: number): { type: string; filled: boolean } | null {
  if (!n) return null
  if (n === 1 || n === 7 || n === 8 || n === 9 || n === 12 || n === 16) return { type: 'open', filled: false }
  if (n === 15) return { type: 'block', filled: false }
  if (n === 3 || n === 6) return { type: 'classic', filled: false }
  if (n === 2 || n === 4 || n === 13 || n === 14 || n === 17) return { type: 'block', filled: true }
  if (n === 5) return { type: 'classic', filled: true }
  if (n === 10) return { type: 'oval', filled: true }
  if (n === 20 || n === 21) return { type: 'oval', filled: false }
  if (n === 11) return { type: 'square', filled: true }
  if (n === 22) return { type: 'diamond', filled: false }
  if (n === 23 || n === 24) return { type: 'dash', filled: false }
  if (n >= 29 && n <= 45) return { type: n % 2 ? 'ERmany' : 'ERone', filled: false }
  return { type: 'block', filled: true }
}
const ARROW_SIZE = [0.05, 0.07, 0.09, 0.13, 0.18, 0.25, 0.35]

class Renderer {
  private defs!: Defs
  private bounds = new Bounds()
  private stats = { shapes: 0, fallbacks: 0, links: 0 }
  private pictures: Promise<unknown>[] = []

  constructor(
    private doc: Doc,
    private pkg: OoxmlPackage,
    private pagesByName: Map<string, string>,
    private signal: AbortSignal
  ) {}

  async page(layers: VShape[][], width: number, height: number): Promise<BuiltPage> {
    const svg = el('svg', { xmlns: 'http://www.w3.org/2000/svg' })
    this.defs = new Defs(svg)
    const W = width * PX
    const H = height * PX
    el('rect', { x: 0, y: 0, width: W, height: H, fill: '#ffffff' }, svg)
    // Page (inches, y up) → SVG pixels (y down).
    const page: M = [PX, 0, 0, -PX, 0, H]
    const root = el('g', undefined, svg)
    const diag = Math.hypot(width, height) * 2
    layers.forEach((shapes, i) => {
      // Only the page's own shapes may widen the view; background pages are cut to the page.
      if (i === layers.length - 1) this.bounds = new Bounds()
      for (const s of shapes) this.shape(s, page, root, diag)
    })
    await Promise.all(this.pictures)
    const B = this.bounds
    let x0 = 0
    let y0 = 0
    let x1 = W
    let y1 = H
    if (!B.empty) {
      // Keep shapes that spill off the page visible.
      x0 = Math.min(0, B.x0 - 4)
      y0 = Math.min(0, B.y0 - 4)
      x1 = Math.max(W, B.x1 + 4)
      y1 = Math.max(H, B.y1 + 4)
    }
    svg.setAttribute('viewBox', `${fmt(x0)} ${fmt(y0)} ${fmt(x1 - x0)} ${fmt(y1 - y0)}`)
    return { svg, width: x1 - x0, height: y1 - y0, stats: this.stats }
  }

  private shape(s: VShape, parentM: M, parent: Element, diag: number): void {
    const d = this.doc
    if (s.type === 'Guide') return
    const width = d.num(s, 'Width', 0)
    const height = d.num(s, 'Height', 0)
    const m = mul(
      parentM,
      shapeMatrix(d.num(s, 'PinX', 0), d.num(s, 'PinY', 0), d.num(s, 'LocPinX', width / 2), d.num(s, 'LocPinY', height / 2), d.num(s, 'Angle', 0), d.num(s, 'FlipX', 0) === 1, d.num(s, 'FlipY', 0) === 1)
    )
    this.stats.shapes++
    const host = this.linkWrap(s, parent)
    const g = el('g', undefined, host)
    if (s.type === 'Foreign') this.picture(s, m, width, height, g)
    this.geometry(s, m, width, height, g, diag)
    for (const c of s.children) this.shape(c, m, g, diag)
    this.text(s, m, width, height, g)
    if (host !== parent) {
      const tr = apply(m, { x: width, y: height })
      linkBadge(g, tr.x, tr.y, 12)
    }
    for (const p of [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }]) {
      const q = apply(m, p)
      this.bounds.add(q.x, q.y)
    }
  }

  private linkWrap(s: VShape, parent: Element): Element {
    const d = this.doc
    const keys = d.rowKeys(s, 'Hyperlink')
    if (!keys.length) return parent
    const k = keys[0]
    const addr = d.rowCell(s, 'Hyperlink', k, 'Address')?.v ?? ''
    const sub = d.rowCell(s, 'Hyperlink', k, 'SubAddress')?.v ?? ''
    const desc = d.rowCell(s, 'Hyperlink', k, 'Description')?.v ?? ''
    const a = el('a', undefined, parent)
    if (addr) a.setAttribute('href', addr)
    else if (sub) {
      const pageId = this.pagesByName.get(sub.split('/')[0].toLowerCase())
      if (pageId == null) return parent
      a.setAttribute(PAGE_LINK_ATTR, pageId)
    } else return parent
    el('title', undefined, a).textContent = [desc, addr || sub].filter(Boolean).join('\n')
    a.style.cursor = 'pointer'
    this.stats.links++
    return a
  }

  // ------------------------------------------------------------------------ fill / line

  private fillPaint(s: VShape): { fill: string; opacity: number | null } | null {
    const d = this.doc
    const pattern = d.num(s, 'FillPattern', 1)
    const fgCell = d.cell(s, 'FillForegnd')
    const themed = (c: Cell | null) => !!c && (c.v == null || c.v === '' || c.v === 'Themed') && /THEME/i.test(c.f ?? '')
    const fg = themed(fgCell) ? d.themeColor(d.num(s, 'QuickStyleFillColor', 2), '#4472c4') : d.color(fgCell, '#ffffff')!
    const bg = d.color(d.cell(s, 'FillBkgnd'), '#ffffff')!
    const fgT = d.num(s, 'FillForegndTrans', 0)
    const bgT = d.num(s, 'FillBkgndTrans', 0)
    const opacity = fgT > 0 ? Math.max(0, 1 - fgT) : null
    if (d.num(s, 'FillGradientEnabled', 0) === 1) {
      const keys = d.rowKeys(s, 'FillGradient')
      const stops = keys
        .map((k) => ({
          offset: Math.max(0, Math.min(1, Number(d.rowCell(s, 'FillGradient', k, 'GradientStopPosition')?.v ?? 0))),
          color: d.color(d.rowCell(s, 'FillGradient', k, 'GradientStopColor'), fg)!,
          opacity: 1 - Number(d.rowCell(s, 'FillGradient', k, 'GradientStopColorTrans')?.v ?? 0)
        }))
        .sort((a, b) => a.offset - b.offset)
      if (stops.length >= 2) {
        const dir = d.num(s, 'FillGradientDir', 0)
        if (dir >= 8 && dir <= 12) {
          const c = [[0.5, 0.5], [0, 1], [1, 1], [0, 0], [1, 0]][dir - 8]
          return { fill: this.defs.radial(stops, c[0], c[1], dir === 8 ? 0.5 : 1), opacity: null }
        }
        // Visio measures the angle from the x axis, counter-clockwise; local space is y-up.
        return { fill: this.defs.linear(stops, (d.num(s, 'FillGradientAngle', Math.PI / 2) * 180) / Math.PI), opacity: null }
      }
    }
    if (pattern === 0) return null
    if (pattern === 1) return { fill: fg, opacity }
    const two = [
      { offset: 0, color: fg, opacity: 1 - fgT },
      { offset: 1, color: bg, opacity: 1 - bgT }
    ]
    if (pattern >= 25 && pattern <= 40) {
      // Legacy gradient fills: linear (25–30) and radial (31–40) approximations.
      const lin: Record<number, number> = { 25: 0, 26: 180, 27: 0, 28: 270, 29: 90, 30: 270 }
      if (pattern === 26 || pattern === 29)
        return { fill: this.defs.linear([{ ...two[1], offset: 0 }, { offset: 0.5, color: fg, opacity: 1 - fgT }, { offset: 1, color: bg, opacity: 1 - bgT }], lin[pattern]), opacity: null }
      if (pattern in lin) return { fill: this.defs.linear(two, lin[pattern]), opacity: null }
      const centres = [[0, 1], [1, 1], [0, 0], [1, 0], [0.5, 0.5]]
      const c = centres[(pattern - 31) % 5]
      return { fill: this.defs.radial(two, c[0], c[1], c[0] === 0.5 ? 0.7 : 1.2), opacity: null }
    }
    // Patterns 2–24: hatches and dots in the foreground colour on the background colour (the
    // kinds follow LibreOffice's reading of Visio's pattern numbers; local space is y-up).
    const t = 12 / PX
    const id = this.defs.pattern(`${pattern}|${fg}|${bg}`, t, (tile) => {
      el('rect', { width: t, height: t, fill: bg, 'fill-opacity': 1 - bgT }, tile)
      const line = (d0: string) => el('path', { d: d0, stroke: fg, 'stroke-width': 0.6 / PX, fill: 'none', 'stroke-opacity': 1 - fgT }, tile)
      const z = fmt(t)
      const hz = fmt(t / 2)
      const kinds: Record<number, string> = {
        2: `M0 0L${z} ${z}`,
        3: `M0 ${hz}H${z}M${hz} 0V${z}`,
        4: `M0 0L${z} ${z}M0 ${z}L${z} 0`,
        5: `M0 ${z}L${z} 0`,
        6: `M0 ${hz}H${z}`,
        7: `M${hz} 0V${z}`
      }
      const k = kinds[pattern] ?? kinds[2 + ((pattern - 2) % 6)]
      if (pattern <= 7) line(k)
      else {
        line(k)
        el('circle', { cx: t / 4, cy: t / 4, r: t / 10, fill: fg, 'fill-opacity': 1 - fgT }, tile)
      }
    })
    return { fill: id, opacity: null }
  }

  private lineStyle(s: VShape): { stroke: string; width: number; dash: string | null; opacity: number | null; cap: string } | null {
    const d = this.doc
    const pattern = d.num(s, 'LinePattern', 1)
    if (pattern === 0) return null
    const c = d.cell(s, 'LineColor')
    const themed = !!c && (c.v == null || c.v === '' || c.v === 'Themed') && /THEME/i.test(c.f ?? '')
    const stroke = themed ? d.themeColor(d.num(s, 'QuickStyleLineColor', 0), '#000000') : d.color(c, '#000000')!
    const width = Math.max(d.num(s, 'LineWeight', 0.75 / 72), 0.5 / PX)
    const k = Math.max(width, 1 / 72)
    const dash = PATTERN_DASH[pattern]?.map((x) => fmt(x * k)).join(' ') ?? null
    const tr = d.num(s, 'LineColorTrans', 0)
    const capN = d.num(s, 'LineCap', 0)
    return { stroke, width, dash, opacity: tr > 0 ? 1 - tr : null, cap: capN === 1 ? 'square' : capN === 2 ? 'butt' : 'round' }
  }

  private geometry(s: VShape, m: M, w: number, h: number, g: Element, diag: number): void {
    const d = this.doc
    const sections = d.geometry(s)
    if (!sections.length) return
    const line = this.lineStyle(s)
    const fill = this.fillPaint(s)
    const local = el('g', { transform: mstr(m) }, g)
    const shadowOn = d.num(s, 'ShdwPattern', 0) > 0 || d.num(s, 'ShapeShdwShow', 0) === 1
    const shadowColor = d.color(d.cell(s, 'ShdwForegnd'), '#000000') ?? '#000000'
    const paths = sections.filter((sec) => !sec.noShow).map((sec) => ({ sec, geo: geometryPath(sec.rows, w, h, diag) }))
    if (shadowOn && fill) {
      const dx = d.num(s, 'ShapeShdwOffsetX', 0.0625)
      const dy = d.num(s, 'ShapeShdwOffsetY', -0.0625)
      const sg = el('g', { transform: `translate(${fmt(dx)} ${fmt(dy)})`, opacity: 1 - d.num(s, 'ShdwForegndTrans', 0.5) }, local)
      for (const { sec, geo } of paths) if (!sec.noFill && geo.subpaths.every((p) => p.closed)) el('path', { d: geo.d, fill: shadowColor, stroke: 'none' }, sg)
    }
    // Fills first, then lines (Visio paints every section's fill before the outlines).
    if (fill) {
      // All filled sections form one path: overlapping sections cut holes (even-odd), as in Visio.
      const dAll = paths.filter(({ sec, geo }) => !sec.noFill && geo.d && geo.subpaths.some((p) => p.closed)).map(({ geo }) => geo.d).join('')
      if (dAll) el('path', { d: dAll, fill: fill.fill, 'fill-opacity': fill.opacity, 'fill-rule': 'evenodd', stroke: 'none' }, local)
    }
    if (line) {
      const rounding = d.num(s, 'Rounding', 0)
      for (const { sec, geo } of paths) {
        if (sec.noLine || !geo.d) continue
        el(
          'path',
          { d: geo.d, fill: 'none', stroke: line.stroke, 'stroke-width': line.width, 'stroke-dasharray': line.dash, 'stroke-opacity': line.opacity, 'stroke-linecap': line.cap, 'stroke-linejoin': rounding > 0 ? 'round' : 'miter', 'stroke-miterlimit': 10 },
          local
        )
      }
      // Arrow heads on the first and last open sub-paths.
      const open = paths.filter((p) => !p.sec.noLine).flatMap((p) => p.geo.subpaths).filter((p) => !p.closed && p.pts.length >= 2)
      if (open.length) {
        const first = open[0]
        const last = open[open.length - 1]
        const begin = arrowKind(d.num(s, 'BeginArrow', 0))
        const end = arrowKind(d.num(s, 'EndArrow', 0))
        const size = (k: string) => (ARROW_SIZE[Math.max(0, Math.min(6, d.num(s, k, 2)))] ?? 0.09) + line.width * 2
        const away = (pts: P[], fromEnd: boolean): [P, P] => {
          const tip = fromEnd ? pts[pts.length - 1] : pts[0]
          for (let i = 1; i < pts.length; i++) {
            const q = fromEnd ? pts[pts.length - 1 - i] : pts[i]
            if (Math.hypot(q.x - tip.x, q.y - tip.y) > 1e-4) return [tip, q]
          }
          return [tip, fromEnd ? pts[0] : pts[pts.length - 1]]
        }
        if (begin) {
          const [tip, q] = away(first.pts, false)
          arrowHead(local, tip, q, { ...begin, size: size('BeginArrowSize') }, line.stroke, line.width, { 'stroke-opacity': line.opacity })
        }
        if (end) {
          const [tip, q] = away(last.pts, true)
          arrowHead(local, tip, q, { ...end, size: size('EndArrowSize') }, line.stroke, line.width, { 'stroke-opacity': line.opacity })
        }
      }
    }
  }

  // --------------------------------------------------------------------------- pictures

  private picture(s: VShape, m: M, w: number, h: number, g: Element): void {
    const rel = s.foreign && Array.from(s.foreign.children).find((c) => c.localName === 'Rel')
    const rid = rel ? (rel.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? rel.getAttribute('r:id')) : null
    const target = rid ? this.pkg.rels(s.part).get(rid)?.target : undefined
    const d = this.doc
    const ox = d.num(s, 'ImgOffsetX', 0)
    const oy = d.num(s, 'ImgOffsetY', 0)
    const iw = d.num(s, 'ImgWidth', w)
    const ih = d.num(s, 'ImgHeight', h)
    const local = el('g', { transform: mstr(m) }, g)
    if (!target) {
      this.placeholder(local, ox, oy, iw, ih, 'picture')
      return
    }
    const img = el('image', { x: ox, y: -(oy + ih), width: iw, height: ih, transform: 'scale(1 -1)', preserveAspectRatio: 'none' }, local)
    this.pictures.push(
      this.pkg.picture(target).then((r) => {
        if ('url' in r) img.setAttribute('href', r.url)
        else {
          img.remove()
          this.placeholder(local, ox, oy, iw, ih, r.error)
        }
      })
    )
  }

  private placeholder(local: Element, x: number, y: number, w: number, h: number, label: string): void {
    this.stats.fallbacks++
    el('rect', { x, y, width: w, height: h, fill: '#f3f3f3', stroke: '#999', 'stroke-width': 1 / PX, 'stroke-dasharray': `${fmt(4 / PX)} ${fmt(3 / PX)}` }, local)
    const g = el('g', { transform: `matrix(${fmt(1 / PX)} 0 0 ${fmt(-1 / PX)} ${fmt(x)} ${fmt(y + h)})` }, local)
    textObject({ x: 0, y: 0, w: w * PX, h: h * PX, align: 'center', valign: 'middle', wrap: true, css: 'font:10px sans-serif;color:#777', content: `🖼 ${label}` }, g)
  }

  // ------------------------------------------------------------------------------- text

  private fontFamily(v: string | null, f: string | null): string {
    let name = v ?? ''
    if (/^\d+$/.test(name)) name = this.doc.fonts.get(name) ?? ''
    if (!name || name === 'Themed' || /THEME/i.test(f ?? '')) name = name && name !== 'Themed' && !/^\d+$/.test(name) ? name : this.doc.theme.minor
    return `'${name.replace(/['"<>;{}]/g, '')}',Calibri,'Segoe UI',Arial,sans-serif`
  }

  private text(s: VShape, m: M, w: number, h: number, g: Element): void {
    const d = this.doc
    if (d.num(s, 'HideText', 0) === 1) return
    const t = d.textOf(s)
    if (!t) return
    const runs = textRuns(t.el)
    if (!runs.some((r) => r.text.trim())) return
    const tw = d.num(s, 'TxtWidth', w)
    const th = d.num(s, 'TxtHeight', h)
    let tm = mul(
      m,
      shapeMatrix(d.num(s, 'TxtPinX', w / 2), d.num(s, 'TxtPinY', h / 2), d.num(s, 'TxtLocPinX', tw / 2), d.num(s, 'TxtLocPinY', th / 2), d.num(s, 'TxtAngle', 0), false, false)
    )
    // Flipped shapes keep readable text: mirror the text block back about its centre.
    const fx = d.num(s, 'FlipX', 0) === 1
    const fy = d.num(s, 'FlipY', 0) === 1
    if (fx || fy) tm = mul(tm, [fx ? -1 : 1, 0, 0, fy ? -1 : 1, fx ? tw : 0, fy ? th : 0])
    // Text box in CSS pixels, y down: (x, y)px → (x/96, th - y/96) inches in the text block.
    const box = mul(tm, [1 / PX, 0, 0, -1 / PX, 0, th])
    const layer = el('g', { transform: mstr(box) }, g)
    const ml = d.num(s, 'LeftMargin', 4 / 72) * PX
    const mr = d.num(s, 'RightMargin', 4 / 72) * PX
    const mt = d.num(s, 'TopMargin', 4 / 72) * PX
    const mb = d.num(s, 'BottomMargin', 4 / 72) * PX
    const va = d.num(s, 'VerticalAlign', 1)
    const bgCell = d.cell(s, 'TextBkgnd')
    const bgv = Number(bgCell?.v ?? 0)
    const bg = bgCell && bgCell.v && bgCell.v !== '0' ? (/^#/.test(bgCell.v) ? bgCell.v : d.colors.get(bgv - 1) ?? DEFAULT_COLORS[bgv - 1] ?? null) : null

    // Paragraphs with their runs.
    const frag = document.createDocumentFragment()
    let para: HTMLElement | null = null
    const newPara = (ix: number) => {
      const p = document.createElement('div')
      const pc = (n: string, dflt: number) => {
        const c = d.rowCell(s, 'Paragraph', String(ix), n) ?? d.rowCell(s, 'Paragraph', '0', n)
        const v = Number(c?.v)
        return Number.isFinite(v) && c?.v != null && c.v !== '' ? v : dflt
      }
      const align = ['left', 'center', 'right', 'justify', 'justify'][pc('HorzAlign', 1)] ?? 'center'
      const spLine = pc('SpLine', -1.2)
      p.style.cssText =
        `text-align:${align};margin:0;padding-left:${fmt(pc('IndLeft', 0) * PX)}px;padding-right:${fmt(pc('IndRight', 0) * PX)}px;` +
        `text-indent:${fmt(pc('IndFirst', 0) * PX)}px;` +
        `margin-top:${fmt(Math.max(0, pc('SpBefore', 0)) * PX)}px;margin-bottom:${fmt(Math.max(0, pc('SpAfter', 0)) * PX)}px;` +
        (spLine < 0 ? `line-height:${fmt(-spLine)};` : spLine > 0 ? `line-height:${fmt(spLine * PX)}px;` : 'line-height:1.2;')
      const bullet = pc('Bullet', 0)
      if (bullet > 0) {
        const bs = d.rowCell(s, 'Paragraph', String(ix), 'BulletStr')?.v || '•'
        const mark = document.createElement('span')
        mark.textContent = `${bs} `
        p.append(mark)
      }
      frag.append(p)
      para = p
    }
    let needNew = true
    for (const r of runs) {
      const parts = r.text.split(/\n|\u2029/)
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) needNew = true
        const txt = parts[i].replace(/\u2028/g, '\n')
        if (needNew && (txt || i < parts.length - 1)) {
          newPara(r.pp)
          needNew = false
        }
        if (txt) {
          const sp = this.span(s, r.cp, txt)
          // Visio paints the text background behind the text itself.
          if (bg) sp.style.backgroundColor = bg
          para!.append(sp)
        }
      }
    }
    // Empty paragraphs keep their line height.
    for (const p of Array.from(frag.children) as HTMLElement[]) if (!p.textContent) p.append(document.createElement('br'))
    const inner = document.createElement('div')
    inner.append(frag)
    textObject(
      {
        // Blocks thinner than their margins (connector labels) centre on the block instead.
        x: tw * PX - ml - mr >= 1 ? ml : (tw * PX) / 2 - 0.5,
        y: th * PX - mt - mb >= 1 ? mt : (th * PX) / 2 - 0.5,
        w: Math.max(1, tw * PX - ml - mr),
        h: Math.max(1, th * PX - mt - mb),
        align: 'left',
        valign: va === 0 ? 'top' : va === 2 ? 'bottom' : 'middle',
        wrap: true,
        css: 'color:#000;',
        content: inner
      },
      layer
    )
  }

  private span(s: VShape, ix: number, txt: string): HTMLElement {
    const d = this.doc
    const cc = (n: string) => d.rowCell(s, 'Character', String(ix), n) ?? d.rowCell(s, 'Character', '0', n)
    const sp = document.createElement('span')
    const size = Number(cc('Size')?.v ?? 12 / 72) || 12 / 72
    const style = Number(cc('Style')?.v ?? 0) | 0
    const colorCell = cc('Color')
    const themed = !!colorCell && (colorCell.v == null || colorCell.v === '' || colorCell.v === 'Themed') && /THEME/i.test(colorCell.f ?? '')
    const color = themed ? d.themeColor(d.num(s, 'QuickStyleFontColor', 0), '#000000') : d.color(colorCell, '#000000')
    const font = cc('Font')
    const deco = [style & 4 || Number(cc('DblUnderline')?.v) === 1 ? 'underline' : '', Number(cc('Strikethru')?.v) === 1 ? 'line-through' : ''].filter(Boolean).join(' ')
    const trans = Number(cc('ColorTrans')?.v ?? 0)
    const pos = Number(cc('Pos')?.v ?? 0)
    const caseV = Number(cc('Case')?.v ?? 0)
    sp.style.cssText =
      `font-family:${this.fontFamily(font?.v ?? null, font?.f ?? null)};font-size:${fmt(size * PX)}px;color:${color ?? '#000'};` +
      (style & 1 ? 'font-weight:bold;' : '') +
      (style & 2 ? 'font-style:italic;' : '') +
      (style & 8 ? 'font-variant:small-caps;' : '') +
      (deco ? `text-decoration:${deco};` : '') +
      (trans > 0 ? `opacity:${fmt(1 - trans)};` : '') +
      (pos === 1 ? 'vertical-align:super;font-size:smaller;' : pos === 2 ? 'vertical-align:sub;font-size:smaller;' : '') +
      (caseV === 1 ? 'text-transform:uppercase;' : '')
    sp.textContent = txt
    return sp
  }
}

/** Text runs with their character (cp) and paragraph (pp) row indexes; fields keep their text. */
export function textRuns(text: Element): { text: string; cp: number; pp: number }[] {
  const out: { text: string; cp: number; pp: number }[] = []
  let cp = 0
  let pp = 0
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) {
        const t = c.nodeValue ?? ''
        if (t) out.push({ text: t, cp, pp })
      } else if (c.nodeType === 1) {
        const e = c as Element
        const ix = Number(e.getAttribute('IX') ?? '0') || 0
        if (e.localName === 'cp') cp = ix
        else if (e.localName === 'pp') pp = ix
        else if (e.localName === 'fld') walk(e)
      }
    }
  }
  walk(text)
  // A trailing newline ends the last paragraph; it does not open a new one.
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/\n$/, '')
  return out
}
