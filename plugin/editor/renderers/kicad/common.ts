/** Pieces shared by the schematic, symbol and board readers: text effects, strokes, fills,
 *  2×3 transforms and text placement. */
import { textExtent, type HJustify, type VJustify } from './font.ts'
import { type Layer } from './scene.ts'
import { child, flag, num, nums, type SList } from './sexpr.ts'
import { kicadColor } from './theme.ts'

export interface Effects {
  /** [width, height] */
  size: [number, number]
  thickness: number
  bold: boolean
  italic: boolean
  h: HJustify
  v: VJustify
  mirror: boolean
  hide: boolean
  lineSpacing: number
}

/** Schematic default line width (6 mil). */
export const SCH_LINE = 0.1524

export function effects(e: SList | undefined, defaultSize = 1.27, defaultThickness = SCH_LINE): Effects {
  const font = child(e, 'font')
  const size = nums(font, 'size', 2)
  const h = size ? size[0] : defaultSize
  const w = size ? size[1] : defaultSize
  const bold = flag(font, 'bold')
  const thick = num(child(font, 'thickness')?.[1], 0)
  let thickness = thick > 0 ? thick : bold ? h / 5 : defaultThickness
  thickness = Math.min(thickness, Math.max(h, w) * 0.25)
  const just = child(e, 'justify')
  const js = just ? (just.slice(1) as string[]) : []
  return {
    size: [w, h],
    thickness,
    bold,
    italic: flag(font, 'italic'),
    h: js.includes('left') ? 'left' : js.includes('right') ? 'right' : 'center',
    v: js.includes('top') ? 'top' : js.includes('bottom') ? 'bottom' : 'center',
    mirror: js.includes('mirror'),
    hide: flag(e, 'hide'),
    lineSpacing: num(child(font, 'line_spacing')?.[1], 1) || 1
  }
}

export interface Stroke {
  width: number
  dash?: string
  color?: string
}

export function stroke(list: SList | undefined, defaultWidth: number): Stroke {
  const s = child(list, 'stroke')
  // KiCad 6 symbols and old boards: (width w) directly on the item.
  const w = s ? num(child(s, 'width')?.[1], 0) : num(child(list, 'width')?.[1], 0)
  const width = w > 0 ? w : defaultWidth
  const type = s ? (child(s, 'type')?.[1] as string | undefined) : undefined
  const c = nums(s, 'color', 4)
  const color = c ? kicadColor(c[0], c[1], c[2], c[3]) : undefined
  const ww = Math.max(width, 0.1)
  let dash: string | undefined
  if (type === 'dash') dash = `${ww * 5} ${ww * 4}`
  else if (type === 'dot') dash = `${ww * 0.01} ${ww * 3}`
  else if (type === 'dash_dot') dash = `${ww * 5} ${ww * 3} ${ww * 0.01} ${ww * 3}`
  else if (type === 'dash_dot_dot') dash = `${ww * 5} ${ww * 3} ${ww * 0.01} ${ww * 3} ${ww * 0.01} ${ww * 3}`
  return { width, dash, color }
}

export type FillKind = 'none' | 'outline' | 'background' | 'color' | 'hatch'

export function fill(list: SList | undefined): { kind: FillKind; color?: string } {
  const f = child(list, 'fill')
  if (!f) return { kind: 'none' }
  // Board: (fill solid|yes|none) or (fill yes); schematic: (fill (type ...) (color ...)).
  const atom = typeof f[1] === 'string' ? f[1] : undefined
  if (atom) return { kind: atom === 'solid' || atom === 'yes' ? 'outline' : 'none' }
  const c = nums(f, 'color', 4)
  const color = c ? kicadColor(c[0], c[1], c[2], c[3]) : undefined
  // Sheets write only (fill (color r g b a)).
  const t = (child(f, 'type')?.[1] as string | undefined) ?? (color ? 'color' : 'none')
  if (t === 'color') return color ? { kind: 'color', color } : { kind: 'none' }
  if (t === 'outline' || t === 'background' || t === 'hatch') return { kind: t as FillKind }
  return { kind: 'none' }
}

/** Affine map: world = (tx + a·x + b·y, ty + c·x + d·y). */
export interface Xf {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
}

export const apply = (m: Xf, x: number, y: number): [number, number] => [m.tx + m.a * x + m.b * y, m.ty + m.c * x + m.d * y]
export const applyLin = (m: Xf, x: number, y: number): [number, number] => [m.a * x + m.b * y, m.c * x + m.d * y]

/** Symbol library coordinates (y up) to schematic (y down) for a placed symbol. */
export function symbolXf(x: number, y: number, angle: number, mirror: string | undefined): Xf {
  const r = ((Math.round(angle) % 360) + 360) % 360
  let m: [number, number, number, number]
  if (r === 90) m = [0, -1, -1, 0]
  else if (r === 180) m = [-1, 0, 0, 1]
  else if (r === 270) m = [0, 1, 1, 0]
  else m = [1, 0, 0, -1]
  let [a, b, c, d] = m
  if (mirror === 'x') {
    c = -c
    d = -d
  } else if (mirror === 'y') {
    a = -a
    b = -b
  }
  return { a, b, c, d, tx: x, ty: y }
}

/** Rotation by `deg` counter-clockwise on screen (y down). */
export function rot(x: number, y: number, deg: number): [number, number] {
  if (!deg) return [x, y]
  const t = (deg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  return [x * c + y * s, -x * s + y * c]
}

/**
 * Draws a symbol field or library text the way KiCad does: the text box is built from the
 * justification in the field's own frame, carried through the symbol transform, and the text is
 * drawn centred in it, horizontal or vertical (never upside down).
 * `anchor` is in world units; `xf` is the symbol transform (lib, y up) or null for free text.
 */
export function placeText(layer: Layer, text: string, anchor: [number, number], e: Effects, angle: number, xf: Xf | null): void {
  if (!text) return
  const ext = textExtent(text, e.size, e.lineSpacing)
  const cx = e.h === 'left' ? ext.w / 2 : e.h === 'right' ? -ext.w / 2 : 0
  const cy = e.v === 'top' ? ext.h / 2 : e.v === 'bottom' ? -ext.h / 2 : 0
  const a = ((Math.round(angle) % 360) + 360) % 360
  const [lx, ly] = rot(cx, cy, a)
  let off: [number, number]
  let vertical = a === 90 || a === 270
  if (xf) {
    off = applyLin(xf, lx, -ly)
    if (xf.a === 0) vertical = !vertical
  } else off = [lx, ly]
  layer.text(text, anchor[0] + off[0], anchor[1] + off[1], {
    size: e.size,
    thickness: e.thickness,
    angle: vertical ? 90 : 0,
    h: 'center',
    v: 'center',
    italic: e.italic,
    lineSpacing: e.lineSpacing
  })
}

/** Free text (labels, notes, board text): KiCad keeps schematic text readable, so 180° becomes 0°
 *  with the justification flipped, and 270° becomes 90°. */
export function readable(angle: number, h: HJustify): { angle: number; h: HJustify } {
  const a = ((Math.round(angle) % 360) + 360) % 360
  const flipH = (x: HJustify): HJustify => (x === 'left' ? 'right' : x === 'right' ? 'left' : 'center')
  if (a === 180) return { angle: 0, h: flipH(h) }
  if (a === 270) return { angle: 90, h: flipH(h) }
  return { angle: a, h }
}

/** Board text "keep upright": angles in (90°, 270°] are turned by 180° with flipped justification. */
export function upright(angle: number, h: HJustify, v: VJustify): { angle: number; h: HJustify; v: VJustify } {
  const a = ((angle % 360) + 360) % 360
  if (a > 90.001 && a <= 270.001) {
    const fh = (x: HJustify): HJustify => (x === 'left' ? 'right' : x === 'right' ? 'left' : 'center')
    const fv = (x: VJustify): VJustify => (x === 'top' ? 'bottom' : x === 'bottom' ? 'top' : 'center')
    return { angle: a - 180, h: fh(h), v: fv(v) }
  }
  return { angle: a, h, v }
}
