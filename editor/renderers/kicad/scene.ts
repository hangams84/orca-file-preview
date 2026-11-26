/** Retained drawing for the KiCad views: named layers holding stroked and filled path data in
 *  millimetres (y down). Serialised to one SVG string; colours come from a per-theme stylesheet,
 *  so theme switches and layer toggles never rebuild the geometry. */
import { hasGlyphs, plainText, strokeText, type Pt, type TextStyle } from './font.ts'
import { circleFrom3 } from './sexpr.ts'

export const fmt = (n: number): string => {
  const r = Math.round(n * 10000) / 10000
  return Object.is(r, -0) ? '0' : String(r)
}

export class Box {
  x0 = Infinity
  y0 = Infinity
  x1 = -Infinity
  y1 = -Infinity
  add(x: number, y: number, pad = 0): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x - pad < this.x0) this.x0 = x - pad
    if (y - pad < this.y0) this.y0 = y - pad
    if (x + pad > this.x1) this.x1 = x + pad
    if (y + pad > this.y1) this.y1 = y + pad
  }
  addBox(b: Box): void {
    if (b.empty) return
    this.add(b.x0, b.y0)
    this.add(b.x1, b.y1)
  }
  get empty(): boolean {
    return !(this.x1 >= this.x0 && this.y1 >= this.y0)
  }
  get w(): number {
    return this.x1 - this.x0
  }
  get h(): number {
    return this.y1 - this.y0
  }
  contains(x: number, y: number, pad = 0): boolean {
    return x >= this.x0 - pad && x <= this.x1 + pad && y >= this.y0 - pad && y <= this.y1 + pad
  }
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function polyD(pts: Pt[], closed: boolean): string {
  if (!pts.length) return ''
  let d = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`
  for (let i = 1; i < pts.length; i++) d += `L${fmt(pts[i][0])} ${fmt(pts[i][1])}`
  if (pts.length === 1) d += 'l0 0'
  return closed ? d + 'Z' : d
}

/** Polygon points wound clockwise on screen, so overlapping fills in one path never cancel. */
export function clockwise<T extends [number, number]>(pts: T[]): T[] {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]
  return a < 0 ? [...pts].reverse() : pts
}

/** Circle as a path, drawn clockwise. */
export function circleD(cx: number, cy: number, r: number): string {
  return `M${fmt(cx - r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(-2 * r)} 0Z`
}

/** SVG path for an arc through start, mid, end. */
export function arcD(s: Pt, m: Pt, e: Pt, moveTo = true): string {
  const c = circleFrom3(s, m, e)
  const start = moveTo ? `M${fmt(s[0])} ${fmt(s[1])}` : ''
  if (!c) return `${start}L${fmt(e[0])} ${fmt(e[1])}`
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const a0 = Math.atan2(s[1] - c.cy, s[0] - c.cx)
  const am = Math.atan2(m[1] - c.cy, m[0] - c.cx)
  const a1 = Math.atan2(e[1] - c.cy, e[0] - c.cx)
  let sweep = norm(a1 - a0)
  if (norm(am - a0) > sweep) sweep -= 2 * Math.PI
  if (Math.hypot(s[0] - e[0], s[1] - e[1]) < 1e-9) return start + circleD(c.cx, c.cy, c.r)
  const large = Math.abs(sweep) > Math.PI ? 1 : 0
  return `${start}A${fmt(c.r)} ${fmt(c.r)} 0 ${large} ${sweep > 0 ? 1 : 0} ${fmt(e[0])} ${fmt(e[1])}`
}

interface FallbackText {
  text: string
  x: number
  y: number
  st: TextStyle
}

export class Layer {
  readonly strokes = new Map<number, string[]>()
  readonly fills: string[] = []
  readonly texts: FallbackText[] = []
  /** Pre-built SVG elements (embedded images), drawn under the paths. */
  readonly raw: string[] = []
  readonly box = new Box()
  /** Explicit colour (file-defined) instead of the theme's. */
  color?: string
  opacity?: number
  /** SVG stroke-dasharray in world units. */
  dash?: string
  constructor(
    readonly name: string,
    private readonly owner: { probe?: Box } = {}
  ) {}
  /** Grows this layer's bounds and the owner's probe (bounds of one item being drawn). */
  grow(x: number, y: number, pad = 0): void {
    this.box.add(x, y, pad)
    this.owner.probe?.add(x, y, pad)
  }
  growBox(b: Box): void {
    this.box.addBox(b)
    this.owner.probe?.addBox(b)
  }
  /** Class base: the part of the name before `|` (variants share their base colour). */
  get base(): string {
    const i = this.name.indexOf('|')
    return i < 0 ? this.name : this.name.slice(0, i)
  }

  private s(w: number): string[] {
    const k = Math.round(Math.max(w, 0) * 10000) / 10000
    let a = this.strokes.get(k)
    if (!a) this.strokes.set(k, (a = []))
    return a
  }
  path(d: string, w: number): void {
    this.s(w).push(d)
  }
  line(pts: Pt[], w: number, closed = false): void {
    if (pts.length < 1) return
    for (const p of pts) this.grow(p[0], p[1], w / 2)
    this.s(w).push(polyD(pts, closed))
  }
  seg(x0: number, y0: number, x1: number, y1: number, w: number): void {
    this.line(
      [
        [x0, y0],
        [x1, y1]
      ],
      w
    )
  }
  circle(cx: number, cy: number, r: number, w: number): void {
    this.grow(cx, cy, r + w / 2)
    this.s(w).push(circleD(cx, cy, r))
  }
  arc(s: Pt, m: Pt, e: Pt, w: number): void {
    const c = circleFrom3(s, m, e)
    if (c) {
      // Loose but safe bounds.
      this.grow(s[0], s[1], w)
      this.grow(m[0], m[1], w)
      this.grow(e[0], e[1], w)
    }
    this.s(w).push(arcD(s, m, e))
  }
  fill(pts: Pt[]): void {
    if (pts.length < 3) return
    for (const p of pts) this.grow(p[0], p[1])
    this.fills.push(polyD(clockwise(pts), true))
  }
  fillD(d: string, box: Box): void {
    this.growBox(box)
    this.fills.push(d)
  }
  fillCircle(cx: number, cy: number, r: number): void {
    this.grow(cx, cy, r)
    this.fills.push(circleD(cx, cy, r))
  }
  /** Stroke-font text; characters newstroke lacks (CJK, Hangul) use a system font instead. */
  text(text: string, x: number, y: number, st: TextStyle): void {
    if (!text) return
    if (!hasGlyphs(text)) {
      this.texts.push({ text, x, y, st })
      const r = st.size[1] * (text.length + 1)
      this.grow(x, y, Math.min(r, st.size[1] * 4))
      return
    }
    const w = st.thickness
    const arr = this.s(w)
    for (const s of strokeText(text, x, y, st)) {
      for (const p of s) this.grow(p[0], p[1], w / 2)
      arr.push(polyD(s, false))
    }
  }
}

export class Scene {
  readonly layers = new Map<string, Layer>()
  /** When set, every drawing call also grows this box (bounds of one symbol or footprint). */
  probe?: Box
  layer(name: string): Layer {
    let l = this.layers.get(name)
    if (!l) this.layers.set(name, (l = new Layer(name, this)))
    return l
  }
  bounds(filter?: (l: Layer) => boolean): Box {
    const b = new Box()
    for (const l of this.layers.values()) if (!filter || filter(l)) b.addBox(l.box)
    return b
  }
  /** SVG markup of the layers in `order` (others after them, in creation order). */
  toSvg(order: string[] = [], classOf: (name: string) => string): string {
    const all = [...this.layers.values()]
    const rank = (l: Layer) => {
      const i = order.indexOf(l.base)
      return i < 0 ? order.length : i
    }
    // Stable sort by the base's position in `order`.
    const sorted = all.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i)
    let out = ''
    for (const { l } of sorted) {
      if (!l.strokes.size && !l.fills.length && !l.texts.length && !l.raw.length) continue
      const style: string[] = []
      if (l.color) style.push(`stroke:${l.color};fill:${l.color}`)
      if (l.opacity != null) style.push(`opacity:${l.opacity}`)
      out += `<g class="${classOf(l.base)}" data-layer="${esc(l.base)}"${style.length ? ` style="${style.join(';')}"` : ''}>`
      out += l.raw.join('')
      if (l.fills.length) out += `<path class="f" d="${l.fills.join('')}"/>`
      const dash = l.dash ? ` stroke-dasharray="${l.dash}"` : ''
      for (const [w, ds] of l.strokes) out += `<path class="s" stroke-width="${fmt(w || 0.01)}"${dash} d="${ds.join('')}"/>`
      for (const t of l.texts) out += fallbackText(t)
      out += '</g>'
    }
    return out
  }
}

function fallbackText(t: FallbackText): string {
  const { st } = t
  const anchor = st.h === 'left' ? 'start' : st.h === 'right' ? 'end' : 'middle'
  const lines = plainText(t.text).split('\n')
  const lh = st.size[1] * 1.62
  const v = st.v ?? 'center'
  const y0 = v === 'top' ? st.size[1] : v === 'center' ? (st.size[1] - lh * (lines.length - 1)) / 2 : -lh * (lines.length - 1)
  const tf = `translate(${fmt(t.x)} ${fmt(t.y)}) rotate(${fmt(-(st.angle ?? 0))})${st.mirror ? ' scale(-1 1)' : ''}`
  let out = `<text class="t" transform="${tf}" text-anchor="${anchor}" font-size="${fmt(st.size[1] * 1.25)}">`
  lines.forEach((l, i) => {
    out += `<tspan x="0" y="${fmt(y0 + i * lh)}">${esc(l)}</tspan>`
  })
  return out + '</text>'
}
