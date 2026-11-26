/** draw.io / diagrams.net reader: `mxfile` (pages, compressed or plain `mxGraphModel`) to SVG.
 *  A clean-room renderer for the common shape set; the official viewer needs `eval` (refused by
 *  Orca's frame policy) and 3.6 MB of script. Unknown stencils draw as a labelled box. */
import { inflateSync } from '../../../vendor/zip.js'
import { PreviewError } from '../../core/types.ts'
import { aliasShape, KNOWN_SHAPES, labelMargins, perimeterPoint, shapeGeometry } from './drawio-shapes.ts'
import { routeEdge, type Terminal } from './edges.ts'
import { arrowHead, Bounds, Defs, el, fmt, linkBadge, pointAlong, polyPath, safeHtml, textObject, type P, type Rect } from './svg.ts'
import { PAGE_LINK_ATTR, type BuiltPage, type DiagramDoc, type DiagramPage } from './types.ts'

type Tr = (ko: string, en: string) => string

// ------------------------------------------------------------------------------- decoding

/** A compressed diagram: base64 → raw deflate → (usually) URI-encoded XML. */
export function inflateDiagram(data: string): string {
  const bin = atob(data.replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const raw = inflateSync(bytes)
  let s = ''
  for (let i = 0; i < raw.length; i += 0x8000) s += String.fromCharCode(...raw.subarray(i, i + 0x8000))
  // Current files URI-encode the XML before deflating; older ones deflate the UTF-8 bytes as-is.
  if (/%[0-9a-f]{2}/i.test(s) || !/[\x80-\xff]/.test(s)) {
    try {
      return decodeURIComponent(s)
    } catch {
      // not URI-encoded after all
    }
  }
  return new TextDecoder().decode(raw)
}

export interface RawPage {
  name: string
  id: string
  model: Element
}

/** Pages of a draw.io file (mxfile with diagrams, or a bare mxGraphModel). */
export function readPages(text: string, tr: Tr): RawPage[] {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new PreviewError('drawio-xml', tr('draw.io XML을 읽을 수 없습니다.', 'The draw.io XML could not be read.'))
  const root = doc.documentElement
  const pages: RawPage[] = []
  if (root.localName === 'mxGraphModel') pages.push({ name: 'Page-1', id: 'page-1', model: root })
  else if (root.localName === 'mxfile') {
    let n = 0
    for (const d of Array.from(root.children)) {
      if (d.localName !== 'diagram') continue
      n++
      const name = d.getAttribute('name') || `Page-${n}`
      const id = d.getAttribute('id') || `page-${n}`
      let model = Array.from(d.children).find((c) => c.localName === 'mxGraphModel') ?? null
      if (!model) {
        const body = (d.textContent ?? '').trim()
        if (!body) continue
        let xml: string
        try {
          xml = body.startsWith('<') ? body : inflateDiagram(body)
        } catch {
          throw new PreviewError('drawio-compressed', tr(`"${name}" 페이지의 압축을 풀 수 없습니다.`, `Page "${name}" could not be decompressed.`))
        }
        const sub = new DOMParser().parseFromString(xml, 'application/xml')
        if (sub.getElementsByTagName('parsererror').length || sub.documentElement.localName !== 'mxGraphModel')
          throw new PreviewError('drawio-compressed', tr(`"${name}" 페이지의 내용이 손상되었습니다.`, `Page "${name}" is damaged.`))
        model = sub.documentElement
      }
      pages.push({ name, id, model })
    }
  } else throw new PreviewError('drawio-root', tr('draw.io 다이어그램(mxfile)이 아닙니다.', 'This is not a draw.io diagram (no mxfile).'))
  if (!pages.length) throw new PreviewError('drawio-empty', tr('다이어그램에 페이지가 없습니다.', 'The diagram has no pages.'))
  return pages
}

// ---------------------------------------------------------------------------------- styles

export type Style = Record<string, string>

/** Named styles of draw.io's default stylesheet that matter for drawing. */
const NAMED: Record<string, Style> = {
  text: { fillColor: 'none', strokeColor: 'none', gradientColor: 'none', align: 'left', verticalAlign: 'top' },
  edgeLabel: { fillColor: 'none', strokeColor: 'none', labelBackgroundColor: 'default', fontSize: '11' },
  label: { shape: 'label', fontStyle: '1', align: 'left', verticalAlign: 'middle', spacing: '2', spacingLeft: '52', imageWidth: '42', imageHeight: '42', rounded: '1' },
  icon: { shape: 'label', verticalLabelPosition: 'bottom', verticalAlign: 'top', imageWidth: '42', imageHeight: '42', imageAlign: 'center', imageVerticalAlign: 'middle' },
  swimlane: { shape: 'swimlane', fontSize: '12', fontStyle: '1', startSize: '23' },
  group: { verticalAlign: 'top', fillColor: 'none', strokeColor: 'none', gradientColor: 'none' },
  ellipse: { shape: 'ellipse', perimeter: 'ellipsePerimeter' },
  rhombus: { shape: 'rhombus', perimeter: 'rhombusPerimeter' },
  triangle: { shape: 'triangle', perimeter: 'trianglePerimeter' },
  line: { shape: 'line', strokeWidth: '4', labelBackgroundColor: 'default', verticalAlign: 'top', spacingTop: '8' },
  image: { shape: 'image', verticalLabelPosition: 'bottom', verticalAlign: 'top', imageAspect: '1' },
  rounded: { rounded: '1' },
  shadow: { shadow: '1' }
}

const VERTEX_DEFAULT: Style = { shape: 'rect', fillColor: '#ffffff', strokeColor: '#000000', fontColor: '#000000', fontSize: '12', fontFamily: 'Helvetica', align: 'center', verticalAlign: 'middle', strokeWidth: '1' }
const EDGE_DEFAULT: Style = { shape: 'connector', strokeColor: '#000000', fontColor: '#000000', fontSize: '12', fontFamily: 'Helvetica', align: 'center', verticalAlign: 'middle', endArrow: 'classic', startArrow: 'none', labelBackgroundColor: '#ffffff', strokeWidth: '1' }

export function parseStyle(s: string | null, edge: boolean): Style {
  const out: Style = { ...(edge ? EDGE_DEFAULT : VERTEX_DEFAULT) }
  if (!s) return out
  for (const part of s.split(';')) {
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq < 0) {
      const named = NAMED[part]
      if (named) Object.assign(out, named)
      else if (!edge && KNOWN_SHAPES.has(aliasShape(part))) out.shape = part
      continue
    }
    const k = part.slice(0, eq).trim()
    let v = part.slice(eq + 1).trim()
    // Image data URLs are stored without ';base64' because ';' separates style entries.
    if (k === 'image' && /^data:image\/[\w.+-]+,(?!.*;base64)/i.test(v)) v = v.replace(/^(data:image\/[\w.+-]+),/i, '$1;base64,')
    out[k] = v
  }
  return out
}

const num = (st: Style, k: string, d: number): number => {
  const v = parseFloat(st[k])
  return Number.isFinite(v) ? v : d
}
const flag = (st: Style, k: string, d = false): boolean => (st[k] == null ? d : st[k] === '1' || st[k] === 'true')

/** A style colour as CSS, or null for none. `light-dark(a, b)` takes the light value. */
export function color(v: string | undefined, fallback: string | null): string | null {
  if (v == null || v === '') return fallback
  const s = v.trim()
  if (s === 'none' || s === 'transparent') return null
  if (s === 'default' || s === 'inherit') return fallback
  const ld = /^light-dark\(\s*([^,]+?)\s*,/.exec(s)
  if (ld) return color(ld[1], fallback)
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^(rgb|rgba|hsl|hsla)\([\d\s.,%]+\)$/i.test(s) || /^[a-z]+$/i.test(s)) return s
  return fallback
}

function fontCss(st: Style): string {
  const fam = (st.fontFamily || 'Helvetica').replace(/["<>;{}]/g, '')
  const fs = num(st, 'fontStyle', 0)
  const deco = [fs & 4 ? 'underline' : '', fs & 8 ? 'line-through' : ''].filter(Boolean).join(' ')
  let css = `font-family:${fam.includes(',') ? fam : `'${fam}'`},Helvetica,Arial,sans-serif;font-size:${fmt(num(st, 'fontSize', 12))}px;color:${color(st.fontColor, '#000000') ?? 'transparent'};`
  if (fs & 1) css += 'font-weight:bold;'
  if (fs & 2) css += 'font-style:italic;'
  if (deco) css += `text-decoration:${deco};`
  const bg = color(st.labelBackgroundColor, null)
  if (bg) css += `background-color:${bg};`
  const bd = color(st.labelBorderColor, null)
  if (bd) css += `border:1px solid ${bd};`
  const op = num(st, 'textOpacity', 100)
  if (op < 100) css += `opacity:${fmt(op / 100)};`
  return css
}

// ---------------------------------------------------------------------------------- model

interface Cell {
  id: string
  parent: string | null
  value: string
  style: Style
  vertex: boolean
  edge: boolean
  visible: boolean
  collapsed: boolean
  source: string | null
  target: string | null
  geo: Geo | null
  attrs: Record<string, string>
  link: string | null
  tooltip: string | null
  children: Cell[]
  /** Absolute bounds once laid out (vertices). */
  abs?: Rect
  /** Origin of this cell's children. */
  origin?: P
  /** Route once computed (edges). */
  route?: P[]
}

interface Geo {
  x: number
  y: number
  w: number
  h: number
  relative: boolean
  points: P[]
  sourcePoint: P | null
  targetPoint: P | null
  offset: P | null
}

function pt(e: Element | null | undefined): P | null {
  if (!e) return null
  return { x: parseFloat(e.getAttribute('x') ?? '0') || 0, y: parseFloat(e.getAttribute('y') ?? '0') || 0 }
}

function readGeo(g: Element | null): Geo | null {
  if (!g) return null
  const n = (k: string) => parseFloat(g.getAttribute(k) ?? '0') || 0
  const geo: Geo = { x: n('x'), y: n('y'), w: n('width'), h: n('height'), relative: g.getAttribute('relative') === '1', points: [], sourcePoint: null, targetPoint: null, offset: null }
  for (const c of Array.from(g.children)) {
    const as = c.getAttribute('as')
    if (c.localName === 'mxPoint') {
      if (as === 'sourcePoint') geo.sourcePoint = pt(c)
      else if (as === 'targetPoint') geo.targetPoint = pt(c)
      else if (as === 'offset') geo.offset = pt(c)
    } else if (c.localName === 'Array' && as === 'points') {
      for (const p of Array.from(c.children)) if (p.localName === 'mxPoint') geo.points.push(pt(p)!)
    }
  }
  return geo
}

function readCells(model: Element): Map<string, Cell> {
  const root = Array.from(model.children).find((c) => c.localName === 'root')
  const cells = new Map<string, Cell>()
  if (!root) return cells
  let auto = 0
  for (const node of Array.from(root.children)) {
    let cellEl: Element | null = node
    const attrs: Record<string, string> = {}
    let value: string | null = null
    if (node.localName !== 'mxCell') {
      // UserObject / object / any custom tag wraps the mxCell and carries the label and properties.
      for (const a of Array.from(node.attributes)) attrs[a.name] = a.value
      value = node.getAttribute('label') ?? ''
      cellEl = Array.from(node.children).find((c) => c.localName === 'mxCell') ?? null
      if (!cellEl) continue
    }
    const id = node.getAttribute('id') ?? cellEl.getAttribute('id') ?? `auto-${++auto}`
    const edge = cellEl.getAttribute('edge') === '1'
    const style = parseStyle(cellEl.getAttribute('style'), edge)
    let v = value ?? cellEl.getAttribute('value') ?? ''
    if (flag(style, 'placeholders')) v = v.replace(/%([\w-]+)%/g, (m, k: string) => attrs[k] ?? m)
    cells.set(id, {
      id,
      parent: cellEl.getAttribute('parent'),
      value: v,
      style,
      vertex: cellEl.getAttribute('vertex') === '1',
      edge,
      visible: cellEl.getAttribute('visible') !== '0',
      collapsed: cellEl.getAttribute('collapsed') === '1',
      source: cellEl.getAttribute('source'),
      target: cellEl.getAttribute('target'),
      geo: readGeo(Array.from(cellEl.children).find((c) => c.localName === 'mxGeometry') ?? null),
      attrs,
      link: attrs.link ?? null,
      tooltip: attrs.tooltip ?? null,
      children: []
    })
  }
  for (const c of cells.values()) if (c.parent && cells.has(c.parent) && c.parent !== c.id) cells.get(c.parent)!.children.push(c)
  return cells
}

// ------------------------------------------------------------------------------- rendering

interface Ctx {
  defs: Defs
  bounds: Bounds
  cells: Map<string, Cell>
  stats: BuiltPage['stats']
  /** Page ids of the file, for `data:page/id,...` links. */
  pageIds: Set<string>
  /** Wait for pictures to decode before the page is shown. */
  pending: Promise<unknown>[]
}

function layout(cell: Cell, origin: P): void {
  for (const c of cell.children) {
    if (c.vertex && c.geo) {
      const g = c.geo
      let x = origin.x + g.x
      let y = origin.y + g.y
      if (g.relative && cell.vertex && cell.abs) {
        x = cell.abs.x + g.x * cell.abs.w + (g.offset?.x ?? 0)
        y = cell.abs.y + g.y * cell.abs.h + (g.offset?.y ?? 0)
      }
      if (!(g.relative && cell.edge)) {
        c.abs = { x, y, w: g.w, h: g.h }
        c.origin = { x, y }
      }
    } else c.origin = origin
    layout(c, c.origin ?? origin)
  }
}

/** Visible terminal of an edge: a laid-out vertex or another edge's midpoint. */
function terminal(ctx: Ctx, id: string | null): Cell | null {
  if (!id) return null
  const c = ctx.cells.get(id)
  return c ?? null
}

function computeRoute(ctx: Ctx, e: Cell, depth = 0): P[] {
  if (e.route) return e.route
  const g = e.geo ?? { x: 0, y: 0, w: 0, h: 0, relative: true, points: [], sourcePoint: null, targetPoint: null, offset: null }
  const o = e.origin ?? { x: 0, y: 0 }
  const abs = (p: P): P => ({ x: p.x + o.x, y: p.y + o.y })
  const term = (id: string | null, fallback: P | null): Terminal | null => {
    const c = terminal(ctx, id)
    if (c?.abs && c.visible) {
      const shape = aliasShape(c.style.shape || 'rect')
      return { rect: c.abs, shape, rotation: num(c.style, 'rotation', 0) }
    }
    if (c?.edge && depth < 4) {
      const r = computeRoute(ctx, c, depth + 1)
      const m = pointAlong(r, 0.5).p
      return { rect: { x: m.x, y: m.y, w: 0, h: 0 }, shape: 'point', rotation: 0 }
    }
    return fallback ? { rect: { ...abs(fallback), w: 0, h: 0 }, shape: 'point', rotation: 0 } : null
  }
  const src = term(e.source, g.sourcePoint)
  const tgt = term(e.target, g.targetPoint)
  if (!src || !tgt) {
    e.route = []
    return e.route
  }
  const st = e.style
  const cons = (pre: 'exit' | 'entry') =>
    st[`${pre}X`] != null && st[`${pre}Y`] != null
      ? { x: num(st, `${pre}X`, 0.5), y: num(st, `${pre}Y`, 0.5), dx: num(st, `${pre}Dx`, 0), dy: num(st, `${pre}Dy`, 0), perimeter: flag(st, `${pre}Perimeter`, true) }
      : null
  e.route = routeEdge({
    src,
    tgt,
    points: g.points.map(abs),
    style: st.edgeStyle ?? (st.noEdgeStyle === '1' ? 'none' : ''),
    elbow: st.elbow === 'vertical' ? 'vertical' : 'horizontal',
    exit: cons('exit'),
    entry: cons('entry'),
    segment: num(st, 'segment', 30),
    jetty: st.jettySize && st.jettySize !== 'auto' ? num(st, 'jettySize', 20) : 20,
    perimeter: (t, toward) => perimeterPoint(t, toward)
  })
  return e.route
}

function linkTarget(ctx: Ctx, link: string): { href?: string; page?: string } | null {
  const l = link.trim()
  const m = /^data:page\/id,(.+)$/.exec(l)
  if (m) return ctx.pageIds.has(m[1]) ? { page: m[1] } : null
  if (/^data:action\//.test(l)) return null
  return { href: l }
}

/** Wraps `child` in an <a> when the cell has a link. */
function linkWrap(ctx: Ctx, cell: Cell, parent: Element): Element {
  const tip = cell.tooltip
  if (!cell.link) {
    if (tip) {
      const g = el('g', undefined, parent)
      el('title', undefined, g).textContent = tip
      return g
    }
    return parent
  }
  const t = linkTarget(ctx, cell.link)
  if (!t) return parent
  const a = el('a', undefined, parent)
  if (t.page) a.setAttribute(PAGE_LINK_ATTR, t.page)
  else a.setAttribute('href', t.href!)
  el('title', undefined, a).textContent = tip ? `${tip}\n${cell.link}` : cell.link
  a.style.cursor = 'pointer'
  ctx.stats.links++
  return a
}

function strokeAttrs(st: Style, fallback: string | null): Record<string, string | number | null> {
  const stroke = color(st.strokeColor, fallback)
  const sw = num(st, 'strokeWidth', 1)
  let dash: string | null = null
  if (flag(st, 'dashed')) {
    const pat = (st.dashPattern || '3 3').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n))
    const k = flag(st, 'fixDash') ? 1 : sw
    dash = pat.map((n) => fmt(n * k)).join(' ')
  }
  const so = num(st, 'strokeOpacity', 100)
  return { stroke: stroke ?? 'none', 'stroke-width': sw, 'stroke-dasharray': dash, 'stroke-opacity': so < 100 ? so / 100 : null, 'stroke-miterlimit': 10 }
}

function fillOf(ctx: Ctx, st: Style, fallback: string | null): { fill: string; opacity: number | null } {
  const fill = color(st.fillColor, fallback)
  const fo = num(st, 'fillOpacity', 100)
  if (!fill) return { fill: 'none', opacity: null }
  const grad = color(st.gradientColor, null)
  if (grad) {
    const dir = st.gradientDirection || 'south'
    const angle = dir === 'north' ? 270 : dir === 'east' ? 0 : dir === 'west' ? 180 : 90
    return { fill: ctx.defs.linear([{ offset: 0, color: fill }, { offset: 1, color: grad }], angle), opacity: fo < 100 ? fo / 100 : null }
  }
  return { fill, opacity: fo < 100 ? fo / 100 : null }
}

function labelContent(cell: Cell): Node | string | null {
  const v = cell.value
  if (!v || flag(cell.style, 'noLabel')) return null
  if (cell.style.html === '1') {
    const frag = safeHtml(v)
    return frag.textContent?.trim() || frag.querySelector('img') ? frag : null
  }
  return v
}

function drawLabel(ctx: Ctx, cell: Cell, box: Rect, parent: Element, opts: { rotation?: number; edge?: boolean } = {}): void {
  const content = labelContent(cell)
  if (content == null) return
  const st = cell.style
  const sp = num(st, 'spacing', 2)
  let { x, y, w, h } = box
  if (!opts.edge) {
    const lp = st.labelPosition
    const vp = st.verticalLabelPosition
    if (lp === 'left') x -= w
    else if (lp === 'right') x += w
    if (vp === 'top') y -= h
    else if (vp === 'bottom') y += h
  }
  const l = sp + num(st, 'spacingLeft', 0)
  const r = sp + num(st, 'spacingRight', 0)
  const t = sp + num(st, 'spacingTop', 0)
  const b = sp + num(st, 'spacingBottom', 0)
  x += l
  y += t
  w = Math.max(0, w - l - r)
  h = Math.max(0, h - t - b)
  const horizontal = st.horizontal !== '0'
  const wrap = st.whiteSpace === 'wrap' && st.html === '1' && !opts.edge && w > 0
  let rot = opts.rotation ?? 0
  if (!horizontal) {
    rot -= 90
    const cx = x + w / 2
    const cy = y + h / 2
    ;[w, h] = [h, w]
    x = cx - w / 2
    y = cy - h / 2
  }
  const align = (st.align as 'left' | 'center' | 'right') || 'center'
  const valign = (st.verticalAlign as 'top' | 'middle' | 'bottom') || 'middle'
  textObject({ x, y, w, h, align, valign, wrap, rotate: rot || undefined, css: fontCss(st), content }, parent)
  ctx.bounds.rect({ x, y, w, h })
  if (!wrap) {
    // Unwrapped text spills out of its box: estimate its extent so the view does not cut it.
    const plain = typeof content === 'string' ? content : (content.textContent ?? '')
    const lines = plain.split('\n')
    const fsz = num(st, 'fontSize', 12)
    const tw = Math.max(...lines.map((l) => l.length)) * fsz * 0.6
    const th = lines.length * fsz * 1.2
    const tx = align === 'left' ? x : align === 'right' ? x + w - tw : x + w / 2 - tw / 2
    const ty = valign === 'top' ? y : valign === 'bottom' ? y + h - th : y + h / 2 - th / 2
    if (!rot) ctx.bounds.rect({ x: tx, y: ty, w: tw, h: th })
  }
}

function drawVertex(ctx: Ctx, cell: Cell, parent: Element): void {
  const b = cell.abs!
  const st = cell.style
  const shapeName = aliasShape(st.shape || 'rect')
  ctx.stats.shapes++
  const host = linkWrap(ctx, cell, parent)
  const g = el('g', undefined, host)
  const op = num(st, 'opacity', 100)
  const rot = num(st, 'rotation', 0)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const tf: string[] = []
  if (rot) tf.push(`rotate(${fmt(rot)} ${fmt(cx)} ${fmt(cy)})`)
  const flipH = flag(st, 'flipH')
  const flipV = flag(st, 'flipV')
  if (flipH || flipV) tf.push(`translate(${fmt(cx)} ${fmt(cy)}) scale(${flipH ? -1 : 1} ${flipV ? -1 : 1}) translate(${fmt(-cx)} ${fmt(-cy)})`)
  const shapeG = el('g', { transform: tf.join(' ') || null, opacity: op < 100 ? op / 100 : null }, g)
  if (flag(st, 'shadow')) shapeG.setAttribute('filter', ctx.defs.shadow())

  const known = KNOWN_SHAPES.has(shapeName)
  if (!known) ctx.stats.fallbacks++
  const fill = fillOf(ctx, st, '#ffffff')
  const stroke = strokeAttrs(st, '#000000')
  if (!known) {
    // Unknown stencil: a light box in the stencil's colour, dashed, named inside.
    const tint = color(st.fillColor, null) ?? color(st.strokeColor, null) ?? '#999999'
    fill.fill = tint
    fill.opacity = 0.18
    Object.assign(stroke, { stroke: tint, 'stroke-dasharray': '4 3', 'stroke-width': 1 })
  }

  if (shapeName === 'image' || (shapeName === 'label' && st.image)) drawImage(ctx, st, b, shapeG, shapeName === 'label')
  if (shapeName !== 'image') {
    const geom = shapeGeometry(known ? shapeName : 'rect', b.w, b.h, st)
    const dirRot = { south: 90, west: 180, north: 270 }[st.direction as string] ?? 0
    let inner: Element = shapeG
    if (dirRot && geom.directional) {
      // Directional shapes draw in a box rotated by the direction (width/height swap for north/south).
      inner = el('g', { transform: `rotate(${dirRot} ${fmt(cx)} ${fmt(cy)})` }, shapeG)
    }
    const swap = dirRot === 90 || dirRot === 270
    const gw = swap && geom.directional ? b.h : b.w
    const gh = swap && geom.directional ? b.w : b.h
    const geo2 = swap && geom.directional ? shapeGeometry(shapeName, gw, gh, st) : geom
    const ox = cx - gw / 2
    const oy = cy - gh / 2
    const t = `translate(${fmt(ox)} ${fmt(oy)})`
    if (geo2.fill) el('path', { d: geo2.fill, transform: t, fill: fill.fill, 'fill-opacity': fill.opacity, ...stroke, 'stroke-linejoin': 'round' }, inner)
    if (geo2.fillOnly) el('path', { d: geo2.fillOnly, transform: t, fill: fill.fill, 'fill-opacity': fill.opacity, stroke: 'none' }, inner)
    if (geo2.band) {
      const bandFill = fillOf(ctx, st, '#ffffff')
      const body = color(st.swimlaneFillColor, null)
      if (body && geo2.body) el('path', { d: geo2.body, transform: t, fill: body, stroke: 'none' }, inner)
      el('path', { d: geo2.band, transform: t, fill: bandFill.fill, 'fill-opacity': bandFill.opacity, ...stroke }, inner)
      if (geo2.body) el('path', { d: geo2.body, transform: t, fill: 'none', ...stroke }, inner)
    }
    if (geo2.lines) el('path', { d: geo2.lines, transform: t, fill: 'none', ...stroke }, inner)
    if (geo2.fillLines) el('path', { d: geo2.fillLines, transform: t, fill: fill.fill === 'none' ? 'none' : fill.fill, 'fill-opacity': fill.opacity, ...stroke }, inner)
  }
  ctx.bounds.rect(b)
  if (host !== parent && host.localName === 'a') linkBadge(g, b.x + b.w, b.y, 12)

  // Label: swimlanes put it in the title band; unknown stencils without text show their name.
  let box: Rect = b
  if (shapeName === 'swimlane') {
    const ss = num(st, 'startSize', 23)
    box = st.horizontal === '0' ? { x: b.x, y: b.y, w: ss, h: b.h } : { x: b.x, y: b.y, w: b.w, h: ss }
  } else {
    const m = labelMargins(shapeName, b.w, b.h, st)
    if (m) box = { x: b.x + m.l, y: b.y + m.t, w: Math.max(0, b.w - m.l - m.r), h: Math.max(0, b.h - m.t - m.b) }
  }
  if (!known) {
    const name = (st.shape || '').replace(/^mxgraph\./, '')
    textObject({ x: b.x, y: b.y, w: b.w, h: b.h, align: 'center', valign: 'middle', wrap: true, css: 'font:10px Helvetica,Arial,sans-serif;color:#555;overflow-wrap:anywhere', content: name }, g)
  }
  drawLabel(ctx, cell, box, g, { rotation: rot && st.horizontal !== '0' ? rot : 0 })
}

function drawImage(ctx: Ctx, st: Style, b: Rect, parent: Element, asLabelIcon: boolean): void {
  const src = st.image ?? ''
  let box = b
  if (asLabelIcon) {
    const iw = num(st, 'imageWidth', 42)
    const ih = num(st, 'imageHeight', 42)
    box = { x: b.x + 4, y: b.y + (b.h - ih) / 2, w: iw, h: ih }
  }
  if (/^data:image\//i.test(src)) {
    el(
      'image',
      { x: box.x, y: box.y, width: box.w, height: box.h, href: src, preserveAspectRatio: st.imageAspect === '0' ? 'none' : 'xMidYMid meet' },
      parent
    )
    return
  }
  // Remote or library pictures cannot load offline: a framed placeholder with the name.
  ctx.stats.fallbacks++
  el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, fill: '#f3f3f3', stroke: '#999', 'stroke-dasharray': '4 3' }, parent)
  const name = src.replace(/^.*\//, '').slice(0, 60) || 'image'
  textObject({ x: box.x, y: box.y, w: box.w, h: box.h, align: 'center', valign: 'middle', wrap: true, css: 'font:10px Helvetica,Arial,sans-serif;color:#777;overflow-wrap:anywhere', content: `🖼 ${name}` }, parent)
}

function arrowSpec(st: Style, end: 'start' | 'end'): { type: string; size: number; filled: boolean } {
  const type = st[`${end}Arrow`] ?? (end === 'end' ? 'classic' : 'none')
  const size = num(st, `${end}Size`, 6)
  const filled = st[`${end}Fill`] !== '0'
  return { type, size, filled }
}

function drawEdge(ctx: Ctx, cell: Cell, parent: Element): void {
  const route = computeRoute(ctx, cell)
  if (route.length < 2) return
  ctx.stats.shapes++
  const st = cell.style
  const host = linkWrap(ctx, cell, parent)
  const g = el('g', undefined, host)
  const op = num(st, 'opacity', 100)
  const line = el('g', { opacity: op < 100 ? op / 100 : null }, g)
  if (flag(st, 'shadow')) line.setAttribute('filter', ctx.defs.shadow())
  const stroke = strokeAttrs(st, '#000000')
  const sw = num(st, 'strokeWidth', 1)
  const strokeColor = stroke.stroke as string
  const pts = route.map((p) => ({ ...p }))
  for (const p of pts) ctx.bounds.add(p.x, p.y)
  const flex = st.shape === 'flexArrow'
  if (st.shape === 'link' || flex) {
    const width = flex ? num(st, 'width', 10) : num(st, 'width', 4)
    el('path', { d: polyPath(pts), fill: 'none', stroke: strokeColor, 'stroke-width': width + 2, 'stroke-linejoin': 'round' }, line)
    el('path', { d: polyPath(pts), fill: 'none', stroke: color(st.fillColor, '#ffffff') ?? '#ffffff', 'stroke-width': width, 'stroke-linejoin': 'round' }, line)
  } else {
    const ends = { start: arrowSpec(st, 'start'), end: arrowSpec(st, 'end') }
    // Heads are drawn in the stroke's colour; the line stops at the head's back.
    const headAttrs = { 'stroke-opacity': stroke['stroke-opacity'] }
    const n = pts.length
    const endBack = arrowHead(line, route[n - 1], route[n - 2], { ...ends.end, size: ends.end.size + sw }, strokeColor, sw, headAttrs)
    const startBack = arrowHead(line, route[0], route[1], { ...ends.start, size: ends.start.size + sw }, strokeColor, sw, headAttrs)
    const shorten = (a: P, b: P, by: number) => {
      const l = Math.hypot(a.x - b.x, a.y - b.y)
      if (!by || !l) return a
      const k = Math.min(by, l - 0.5) / l
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
    pts[n - 1] = shorten(pts[n - 1], pts[n - 2], endBack)
    pts[0] = shorten(pts[0], pts[1], startBack)
    const curved = flag(st, 'curved')
    const rounded = flag(st, 'rounded') ? num(st, 'arcSize', 20) / 2 : 0
    const path = el('path', { d: polyPath(pts, rounded, curved), fill: 'none', ...stroke, 'stroke-linejoin': 'round' }, line)
    line.insertBefore(path, line.firstChild)
  }
  // The edge's own label sits on its middle (geometry x/y move it along/off the line).
  if (cell.value) {
    const gx = cell.geo?.relative !== false ? (cell.geo?.x ?? 0) : 0
    const at = pointAlong(route, (gx + 1) / 2)
    const gy = cell.geo?.relative !== false ? (cell.geo?.y ?? 0) : 0
    const off = cell.geo?.offset ?? { x: 0, y: 0 }
    const p = { x: at.p.x - at.dir.y * gy + off.x, y: at.p.y + at.dir.x * gy + off.y }
    drawLabel(ctx, { ...cell, style: { ...cell.style, spacing: '0' } }, { x: p.x, y: p.y, w: 0, h: 0 }, g, { edge: true })
  }
  // Label cells attached to the edge (relative geometry: x along the edge, y across it).
  for (const c of cell.children) {
    if (!c.vertex || !c.visible || !c.geo) continue
    const at = pointAlong(route, (c.geo.x + 1) / 2)
    const off = c.geo.offset ?? { x: 0, y: 0 }
    const p = { x: at.p.x - at.dir.y * c.geo.y + off.x, y: at.p.y + at.dir.x * c.geo.y + off.y }
    const w = c.geo.w
    const h = c.geo.h
    const box = { x: p.x - w / 2, y: p.y - h / 2, w, h }
    ctx.stats.shapes++
    drawLabel(ctx, { ...c, style: { ...c.style, spacing: c.style.spacing ?? '0' } }, box, linkWrap(ctx, c, g), { edge: w === 0 })
  }
}

function drawTree(ctx: Ctx, cell: Cell, parent: Element): void {
  for (const c of cell.children) {
    if (!c.visible) continue
    if (c.vertex && c.abs) drawVertex(ctx, c, parent)
    else if (c.edge) drawEdge(ctx, c, parent)
    if (c.collapsed) continue
    if (!c.edge) drawTree(ctx, c, parent)
  }
}

export function buildPage(raw: RawPage, pageIds: Set<string>): BuiltPage {
  const cells = readCells(raw.model)
  const svg = el('svg', { xmlns: 'http://www.w3.org/2000/svg' })
  const ctx: Ctx = { defs: new Defs(svg), bounds: new Bounds(), cells, stats: { shapes: 0, fallbacks: 0, links: 0 }, pageIds, pending: [] }
  const roots = [...cells.values()].filter((c) => !c.parent || !cells.has(c.parent))
  for (const r of roots) {
    r.origin = { x: 0, y: 0 }
    layout(r, r.origin)
  }
  const bgColor = color(raw.model.getAttribute('background') ?? undefined, null)
  const bgRect = el('rect', { fill: bgColor ?? 'none' }, svg)
  const content = el('g', undefined, svg)
  for (const r of roots) drawTree(ctx, r, content)
  const B = ctx.bounds
  const pad = 10
  const x0 = B.empty ? 0 : B.x0 - pad
  const y0 = B.empty ? 0 : B.y0 - pad
  const w = B.empty ? 200 : B.x1 - B.x0 + 2 * pad
  const h = B.empty ? 120 : B.y1 - B.y0 + 2 * pad
  svg.setAttribute('viewBox', `${fmt(x0)} ${fmt(y0)} ${fmt(w)} ${fmt(h)}`)
  if (bgColor) {
    bgRect.setAttribute('x', fmt(x0))
    bgRect.setAttribute('y', fmt(y0))
    bgRect.setAttribute('width', fmt(w))
    bgRect.setAttribute('height', fmt(h))
  } else bgRect.remove()
  return { svg, width: w, height: h, stats: ctx.stats }
}

export function readDrawio(text: string, tr: Tr): DiagramDoc {
  const raws = readPages(text, tr)
  const ids = new Set(raws.map((r) => r.id))
  const pages: DiagramPage[] = raws.map((r) => ({ name: r.name, id: r.id, build: async () => buildPage(r, ids) }))
  return { pages, format: 'draw.io' }
}
