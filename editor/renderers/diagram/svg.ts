/** SVG building blocks shared by the draw.io and Visio renderers: elements, per-page definitions
 *  (gradients, patterns, shadows), text boxes as foreignObject and arrow heads. */
import { DOMPurify } from '../../../vendor/purify.js'

export const SVG_NS = 'http://www.w3.org/2000/svg'
const XHTML_NS = 'http://www.w3.org/1999/xhtml'

export type Attrs = Record<string, string | number | null | undefined>

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs?: Attrs, parent?: Element | null): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag)
  if (attrs) setAttrs(e, attrs)
  parent?.append(e)
  return e
}

export function setAttrs(e: Element, attrs: Attrs): void {
  for (const k in attrs) {
    const v = attrs[k]
    if (v == null || v === '') continue
    e.setAttribute(k, typeof v === 'number' ? fmt(v) : v)
  }
}

/** Numbers for SVG attributes: at most 4 decimals, no `-0`. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 10000) / 10000
  return Object.is(r, -0) ? '0' : String(r)
}

export interface P {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Running bounds of what a page draws, so the view can frame it. */
export class Bounds {
  x0 = Infinity
  y0 = Infinity
  x1 = -Infinity
  y1 = -Infinity
  add(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < this.x0) this.x0 = x
    if (y < this.y0) this.y0 = y
    if (x > this.x1) this.x1 = x
    if (y > this.y1) this.y1 = y
  }
  rect(r: Rect): void {
    this.add(r.x, r.y)
    this.add(r.x + r.w, r.y + r.h)
  }
  get empty(): boolean {
    return !(this.x1 >= this.x0)
  }
}

let defsSeq = 0

/** Definitions of one page's SVG; ids carry a page prefix so pages can be shown together. */
export class Defs {
  readonly node: SVGDefsElement
  private prefix: string
  private n = 0
  private cache = new Map<string, string>()

  constructor(svg: SVGSVGElement) {
    this.node = el('defs', undefined, svg)
    this.prefix = `d${++defsSeq}`
  }

  id(): string {
    return `${this.prefix}-${++this.n}`
  }

  private memo(key: string, make: (id: string) => void): string {
    let id = this.cache.get(key)
    if (!id) {
      id = this.id()
      make(id)
      this.cache.set(key, id)
    }
    return `url(#${id})`
  }

  /** Linear gradient in object bounding box units; `angle` in degrees, 0 = left→right, 90 = top→bottom. */
  linear(stops: { offset: number; color: string; opacity?: number }[], angle: number): string {
    const key = `lin|${angle}|${JSON.stringify(stops)}`
    return this.memo(key, (id) => {
      const a = (angle * Math.PI) / 180
      const dx = Math.cos(a) / 2
      const dy = Math.sin(a) / 2
      const g = el('linearGradient', { id, x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy }, this.node)
      for (const s of stops) el('stop', { offset: s.offset, 'stop-color': s.color, 'stop-opacity': s.opacity == null || s.opacity >= 1 ? null : s.opacity }, g)
    })
  }

  radial(stops: { offset: number; color: string; opacity?: number }[], cx = 0.5, cy = 0.5, r = 0.5): string {
    const key = `rad|${cx}|${cy}|${r}|${JSON.stringify(stops)}`
    return this.memo(key, (id) => {
      const g = el('radialGradient', { id, cx, cy, r, fx: cx, fy: cy }, this.node)
      for (const s of stops) el('stop', { offset: s.offset, 'stop-color': s.color, 'stop-opacity': s.opacity == null || s.opacity >= 1 ? null : s.opacity }, g)
    })
  }

  /** Soft drop shadow (offset in user units). */
  shadow(dx = 2, dy = 3, blur = 1.7, color = '#000', opacity = 0.25): string {
    return this.memo(`shadow|${dx}|${dy}|${blur}|${color}|${opacity}`, (id) => {
      const f = el('filter', { id, x: '-20%', y: '-20%', width: '150%', height: '150%' }, this.node)
      el('feDropShadow', { dx, dy, stdDeviation: blur, 'flood-color': color, 'flood-opacity': opacity }, f)
    })
  }

  /** A repeating fill pattern: `draw` paints one tile of `size` user units. */
  pattern(key: string, size: number, draw: (tile: SVGPatternElement) => void): string {
    return this.memo(`pat|${key}|${size}`, (id) => {
      const p = el('pattern', { id, width: size, height: size, patternUnits: 'userSpaceOnUse' }, this.node)
      draw(p)
    })
  }
}

// ------------------------------------------------------------------------------------- text

export interface TextBox {
  x: number
  y: number
  w: number
  h: number
  /** Horizontal and vertical alignment inside the box. */
  align: 'left' | 'center' | 'right' | 'justify'
  valign: 'top' | 'middle' | 'bottom'
  wrap: boolean
  /** Rotation in degrees about the box centre. */
  rotate?: number
  /** Inline CSS for the text block (font, colour, background, border). */
  css: string
  /** Content: sanitised HTML nodes or plain text. */
  content: Node | string
}

/** Text in a foreignObject: HTML layout gives wrapping, rich labels and alignment for free. The
 *  object does not clip, so unwrapped labels may spill out of the box like they do in the apps. */
export function textObject(t: TextBox, parent: Element): SVGForeignObjectElement {
  const w = Math.max(1, t.w)
  const h = Math.max(1, t.h)
  const fo = el('foreignObject', { x: t.x, y: t.y, width: w, height: h, overflow: 'visible', 'pointer-events': 'none' }, parent)
  if (t.rotate) fo.setAttribute('transform', `rotate(${fmt(t.rotate)} ${fmt(t.x + t.w / 2)} ${fmt(t.y + t.h / 2)})`)
  const outer = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement
  outer.style.cssText =
    `display:flex;box-sizing:border-box;width:${fmt(w)}px;height:${fmt(h)}px;` +
    `align-items:${t.valign === 'top' ? 'flex-start' : t.valign === 'bottom' ? 'flex-end' : 'center'};` +
    `justify-content:${t.align === 'left' || t.align === 'justify' ? 'flex-start' : t.align === 'right' ? 'flex-end' : 'center'};` +
    'overflow:visible;line-height:1.2;pointer-events:none'
  const inner = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement
  inner.style.cssText =
    `box-sizing:border-box;text-align:${t.align};${t.wrap ? `width:${fmt(w)}px;max-width:${fmt(w)}px;white-space:normal;overflow-wrap:break-word` : 'white-space:nowrap'};` +
    'flex:none;pointer-events:all;' +
    t.css
  if (typeof t.content === 'string') {
    inner.style.whiteSpace = t.wrap ? 'pre-wrap' : 'pre'
    inner.textContent = t.content
  } else inner.append(t.content)
  outer.append(inner)
  fo.append(outer)
  return fo
}

/** Sanitised HTML (DOMPurify) as a fragment. Links keep their address; clicks are handled by the
 *  viewer's link guard. */
export function safeHtml(html: string): DocumentFragment {
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'link', 'meta', 'base', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'script'],
    FORBID_ATTR: ['action', 'formaction', 'target', 'ping', 'srcset', 'id', 'name']
  })
  const tpl = document.createElement('template')
  tpl.innerHTML = clean
  // Remote pictures cannot load (no network); keep data:/blob: ones only.
  for (const img of tpl.content.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? ''
    if (!/^(data:image\/|blob:)/i.test(src)) img.removeAttribute('src')
    img.style.maxWidth = '100%'
  }
  return tpl.content
}

// ------------------------------------------------------------------------------------ arrows

export interface ArrowSpec {
  type: string
  /** Length along the line in user units. */
  size: number
  filled: boolean
}

/** Draws an arrow head whose tip is `tip`, pointing away from `from`; returns how far the line must
 *  stop short of the tip so it does not poke through the head. */
export function arrowHead(parent: Element, tip: P, from: P, a: ArrowSpec, stroke: string, sw: number, extra: Attrs = {}): number {
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const len = Math.hypot(dx, dy)
  if (!len || a.type === 'none' || !a.type) return 0
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const L = a.size
  const W = L / 2
  const at = (along: number, side: number): string => `${fmt(tip.x - ux * along + nx * side)} ${fmt(tip.y - uy * along + ny * side)}`
  const base = { stroke, 'stroke-width': sw, 'stroke-linejoin': 'miter', 'stroke-dasharray': null, ...extra } as Attrs
  const fill = a.filled ? stroke : 'none'
  const filledArea = a.filled ? stroke : 'var(--dg-paper, #fff)'
  switch (a.type) {
    case 'classic':
    case 'classicThin': {
      const w = a.type === 'classicThin' ? L / 3 : W
      el('path', { ...base, fill, d: `M${at(0, 0)}L${at(L, w)}L${at(L * 0.75, 0)}L${at(L, -w)}Z` }, parent)
      return L * 0.75
    }
    case 'block':
    case 'blockThin': {
      const w = a.type === 'blockThin' ? L / 3 : W
      el('path', { ...base, fill: a.filled ? stroke : filledArea, d: `M${at(0, 0)}L${at(L, w)}L${at(L, -w)}Z` }, parent)
      return L
    }
    case 'open':
    case 'openThin':
    case 'async': {
      const w = a.type === 'openThin' ? L / 3 : W
      if (a.type === 'async') el('path', { ...base, fill, d: `M${at(0, 0)}L${at(L, w)}L${at(L, 0)}Z` }, parent)
      else el('path', { ...base, fill: 'none', d: `M${at(L, w)}L${at(0, 0)}L${at(L, -w)}` }, parent)
      return 0
    }
    case 'oval':
    case 'circle':
    case 'circlePlus': {
      const r = L / 2
      el('circle', { ...base, fill: a.filled ? stroke : filledArea, cx: tip.x - ux * r, cy: tip.y - uy * r, r }, parent)
      return L
    }
    case 'diamond':
    case 'diamondThin': {
      const w = a.type === 'diamondThin' ? L / 4 : W / 1.2
      el('path', { ...base, fill: a.filled ? stroke : filledArea, d: `M${at(0, 0)}L${at(L / 2, w)}L${at(L, 0)}L${at(L / 2, -w)}Z` }, parent)
      return L
    }
    case 'square':
      el('path', { ...base, fill: a.filled ? stroke : filledArea, d: `M${at(0, W / 1.5)}L${at(L * 0.8, W / 1.5)}L${at(L * 0.8, -W / 1.5)}L${at(0, -W / 1.5)}Z` }, parent)
      return L * 0.8
    case 'dash':
      el('path', { ...base, fill: 'none', d: `M${at(L / 2 - W, -W)}L${at(L / 2 + W, W)}` }, parent)
      return 0
    case 'cross':
      el('path', { ...base, fill: 'none', d: `M${at(L / 2 - W, -W)}L${at(L / 2 + W, W)}M${at(L / 2 + W, -W)}L${at(L / 2 - W, W)}` }, parent)
      return 0
    case 'halfCircle':
      el('path', { ...base, fill: 'none', d: `M${at(0, W)}A${fmt(W)} ${fmt(W)} 0 0 1 ${at(0, -W)}` }, parent)
      return 0
    case 'baseDash':
      el('path', { ...base, fill: 'none', d: `M${at(0, -W)}L${at(0, W)}` }, parent)
      return 0
    case 'ERone':
      el('path', { ...base, fill: 'none', d: `M${at(L, -W)}L${at(L, W)}` }, parent)
      return 0
    case 'ERmandOne':
      el('path', { ...base, fill: 'none', d: `M${at(L * 0.6, -W)}L${at(L * 0.6, W)}M${at(L, -W)}L${at(L, W)}` }, parent)
      return 0
    case 'ERmany':
      el('path', { ...base, fill: 'none', d: `M${at(0, -W)}L${at(L, 0)}L${at(0, W)}` }, parent)
      return 0
    case 'ERoneToMany':
      el('path', { ...base, fill: 'none', d: `M${at(0, -W)}L${at(L, 0)}L${at(0, W)}M${at(L * 1.3, -W)}L${at(L * 1.3, W)}` }, parent)
      return 0
    case 'ERzeroToOne':
    case 'ERzeroToMany': {
      const r = L / 3
      el('circle', { ...base, fill: filledArea, cx: tip.x - ux * (L + r * 1.4), cy: tip.y - uy * (L + r * 1.4), r }, parent)
      el('path', { ...base, fill: 'none', d: a.type === 'ERzeroToMany' ? `M${at(0, -W)}L${at(L, 0)}L${at(0, W)}` : `M${at(L * 0.7, -W)}L${at(L * 0.7, W)}` }, parent)
      return 0
    }
    default:
      el('path', { ...base, fill, d: `M${at(0, 0)}L${at(L, W)}L${at(L, -W)}Z` }, parent)
      return L
  }
}

// ------------------------------------------------------------------------------------- paths

/** Points as an SVG path; `rounded` > 0 rounds the corners, `curved` draws a smooth spline. */
export function polyPath(pts: P[], rounded = 0, curved = false): string {
  if (pts.length === 0) return ''
  let d = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`
  if (curved && pts.length > 2) {
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = i < pts.length - 2 ? { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 } : pts[i + 1]
      d += `Q${fmt(pts[i].x)} ${fmt(pts[i].y)} ${fmt(mid.x)} ${fmt(mid.y)}`
    }
    return d
  }
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]
    if (rounded > 0 && i < pts.length - 1) {
      const prev = pts[i - 1]
      const next = pts[i + 1]
      const l1 = Math.hypot(p.x - prev.x, p.y - prev.y)
      const l2 = Math.hypot(next.x - p.x, next.y - p.y)
      const r = Math.min(rounded, l1 / 2, l2 / 2)
      if (r > 0.5) {
        const a = { x: p.x - ((p.x - prev.x) / l1) * r, y: p.y - ((p.y - prev.y) / l1) * r }
        const b = { x: p.x + ((next.x - p.x) / l2) * r, y: p.y + ((next.y - p.y) / l2) * r }
        d += `L${fmt(a.x)} ${fmt(a.y)}Q${fmt(p.x)} ${fmt(p.y)} ${fmt(b.x)} ${fmt(b.y)}`
        continue
      }
    }
    d += `L${fmt(p.x)} ${fmt(p.y)}`
  }
  return d
}

/** Point at fraction `t` (0..1) of a polyline's length, with the unit direction there. */
export function pointAlong(pts: P[], t: number): { p: P; dir: P } {
  if (pts.length === 1) return { p: pts[0], dir: { x: 1, y: 0 } }
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let want = Math.max(0, Math.min(1, t)) * total
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const l = Math.hypot(b.x - a.x, b.y - a.y)
    if (want <= l || i === pts.length - 1) {
      const k = l ? Math.min(1, want / l) : 0
      return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, dir: l ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : { x: 1, y: 0 } }
    }
    want -= l
  }
  return { p: pts[pts.length - 1], dir: { x: 1, y: 0 } }
}

/** Removes repeated and collinear interior points of an orthogonal/straight route. */
export function simplify(pts: P[]): P[] {
  const out: P[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue
    if (out.length >= 2) {
      const a = out[out.length - 2]
      const b = last!
      const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)
      const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y)
      if (Math.abs(cross) < 0.01 && dot >= 0) out.pop()
    }
    out.push(p)
  }
  return out
}

/** A small "link" badge (circle with an outward arrow) whose centre is (x, y), size in user units. */
export function linkBadge(parent: Element, x: number, y: number, size = 12): void {
  const r = size / 2
  const g = el('g', { 'pointer-events': 'none' }, parent)
  el('circle', { cx: x, cy: y, r, fill: '#1a73e8', stroke: '#ffffff', 'stroke-width': size / 12 }, g)
  const k = size / 12
  el('path', { d: `M${fmt(x - 2.5 * k)} ${fmt(y + 2.5 * k)}L${fmt(x + 2.5 * k)} ${fmt(y - 2.5 * k)}M${fmt(x - 0.5 * k)} ${fmt(y - 2.5 * k)}H${fmt(x + 2.5 * k)}V${fmt(y - 0.5 * k)}`, stroke: '#ffffff', 'stroke-width': 1.4 * k, fill: 'none', 'stroke-linecap': 'round' }, g)
}
