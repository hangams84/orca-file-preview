/** Library symbols (from a schematic's lib_symbols or a .kicad_sym file): units, body styles,
 *  graphics and pins, drawn through a symbol transform. */
import { apply, applyLin, effects, fill, placeText, SCH_LINE, stroke, type Xf } from './common.ts'
import { type Pt } from './font.ts'
import type { Layer, Scene } from './scene.ts'
import { arcPoints, child, children, flag, head, isList, num, nums, points, str, val, type SList } from './sexpr.ts'

export interface LibSymbol {
  name: string
  node: SList
  /** Sub-symbol lists with their unit (0 = all units) and body style (0 = all styles). */
  parts: { unit: number; style: number; node: SList }[]
  unitCount: number
  hasAltStyle: boolean
  power: boolean
  pinNamesHide: boolean
  pinNumbersHide: boolean
  pinNameOffset: number
  extendsName?: string
  props: Map<string, string>
  unitNames: Map<number, string>
}

export function parseLibSymbol(node: SList): LibSymbol {
  const name = str(node[1])
  const parts: LibSymbol['parts'] = []
  const unitNames = new Map<number, string>()
  // Items directly in the symbol (KiCad allows that) count as unit 0, style 0.
  parts.push({ unit: 0, style: 0, node })
  let unitCount = 1
  let hasAltStyle = false
  for (const sub of children(node, 'symbol')) {
    const m = /_(\d+)_(\d+)$/.exec(str(sub[1]))
    const unit = m ? Number(m[1]) : 0
    const style = m ? Number(m[2]) : 0
    parts.push({ unit, style, node: sub })
    unitCount = Math.max(unitCount, unit)
    if (style > 1) hasAltStyle = true
    const un = val(sub, 'unit_name')
    if (un) unitNames.set(unit, un)
  }
  const pn = child(node, 'pin_names')
  const props = new Map<string, string>()
  for (const p of children(node, 'property')) props.set(str(p[1]), str(p[2]))
  return {
    name,
    node,
    parts,
    unitCount,
    hasAltStyle,
    power: !!child(node, 'power'),
    pinNamesHide: flag(pn, 'hide'),
    pinNumbersHide: flag(child(node, 'pin_numbers'), 'hide'),
    pinNameOffset: pn && child(pn, 'offset') ? num(child(pn, 'offset')![1]) : 0.508,
    extendsName: val(node, 'extends'),
    props,
    unitNames
  }
}

export interface PinHit {
  x0: number
  y0: number
  x1: number
  y1: number
  number: string
  name: string
  type: string
  /** Hidden pins (power symbols) still connect; they are neither drawn nor hoverable. */
  hidden?: boolean
}

export interface SymbolLayers {
  layer(base: string, color?: string, dash?: string): Layer
}

/** Layer helper: `base` keeps the theme colour; an explicit colour or dash makes a variant. */
export function layersFor(scene: Scene): SymbolLayers {
  return {
    layer(base, color, dash) {
      const key = color || dash ? `${base}|${color ?? ''}|${dash ?? ''}` : base
      const l = scene.layer(key)
      if (color) l.color = color
      if (dash) l.dash = dash
      return l
    }
  }
}

const INVERT_R = 0.635
const CLOCK = 0.635

/** Draws unit `unit` / body style `style` of `sym` (graphics of `body` when the symbol extends another). */
export function drawSymbol(
  L: SymbolLayers,
  sym: LibSymbol,
  body: LibSymbol,
  xf: Xf,
  unit: number,
  style: number,
  pins?: PinHit[],
  dim = false
): void {
  const parts = body.parts.filter((p) => (p.unit === 0 || p.unit === unit) && (p.style === 0 || p.style === style))
  const pre = dim ? 'dim-' : ''
  // Background fills first so outlines and pins stay on top.
  for (const p of parts) for (const it of p.node) if (isList(it)) drawGraphic(L, it, xf, pre, true)
  for (const p of parts) for (const it of p.node) if (isList(it)) drawGraphic(L, it, xf, pre, false)
  for (const p of parts) for (const pin of children(p.node, 'pin')) drawPin(L, sym, pin, xf, pins, pre)
}

function drawGraphic(L: SymbolLayers, it: SList, xf: Xf, pre: string, fills: boolean): void {
  const kind = head(it)
  if (!['rectangle', 'circle', 'arc', 'polyline', 'bezier', 'text', 'text_box'].includes(kind)) return
  const st = stroke(it, SCH_LINE)
  const f = fill(it)
  const lineLayer = L.layer(pre + 'body', st.color, st.dash)
  const fillLayer =
    f.kind === 'background' ? L.layer(pre + 'bodyfill') : f.kind === 'outline' ? L.layer(pre + 'body', st.color) : f.kind === 'color' ? L.layer(pre + 'bodyfill', f.color) : null
  const P = (x: number, y: number) => apply(xf, x, y)
  let outline: Pt[] | null = null
  let closed = false
  let circle: { c: Pt; r: number } | null = null
  if (kind === 'rectangle' || kind === 'text_box') {
    const s = nums(it, 'start', 2) ?? nums(it, 'at', 2)
    let e = nums(it, 'end', 2)
    if (kind === 'text_box' && !e) {
      const size = nums(it, 'size', 2)
      if (s && size) e = [s[0] + size[0], s[1] - size[1]]
    }
    if (!s || !e) return
    outline = [P(s[0], s[1]), P(e[0], s[1]), P(e[0], e[1]), P(s[0], e[1])]
    closed = true
  } else if (kind === 'circle') {
    const c = nums(it, 'center', 2)
    if (!c) return
    circle = { c: P(c[0], c[1]), r: num(child(it, 'radius')?.[1]) }
  } else if (kind === 'arc') {
    const s = nums(it, 'start', 2)
    const m = nums(it, 'mid', 2)
    const e = nums(it, 'end', 2)
    if (!s || !e) return
    if (m) outline = arcPoints(P(s[0], s[1]), P(m[0], m[1]), P(e[0], e[1]), 32)
    else {
      // KiCad 6 early: (radius (at) (length) (angles a0 a1)).
      const rad = child(it, 'radius')
      const at = nums(rad, 'at', 2)
      const ang = nums(rad, 'angles', 2)
      const r = num(child(rad, 'length')?.[1])
      if (at && ang && r > 0) {
        outline = []
        let a0 = ang[0]
        let a1 = ang[1]
        if (a1 < a0) a1 += 360
        for (let i = 0; i <= 32; i++) {
          const t = ((a0 + ((a1 - a0) * i) / 32) * Math.PI) / 180
          outline.push(P(at[0] + r * Math.cos(t), at[1] + r * Math.sin(t)))
        }
        a0 = 0
      } else outline = [P(s[0], s[1]), P(e[0], e[1])]
    }
  } else if (kind === 'polyline' || kind === 'bezier') {
    let pts = points(it)
    if (kind === 'bezier' && pts.length === 4) pts = bezier(pts)
    outline = pts.map(([x, y]) => P(x, y))
  } else if (kind === 'text') {
    if (fills) return
    const e = effects(child(it, 'effects'))
    if (e.hide) return
    const at = nums(it, 'at', 3) ?? [0, 0, 0]
    let a = at[2]
    // Library text angles are stored in tenths of a degree by some KiCad versions.
    if (Math.abs(a) > 360) a /= 10
    placeText(L.layer(pre + 'body', st.color), str(it[1]), P(at[0], at[1]), e, a, xf)
    return
  }
  if (fills) {
    if (!fillLayer) return
    if (circle) fillLayer.fillCircle(circle.c[0], circle.c[1], circle.r)
    else if (outline && outline.length > 2) fillLayer.fill(outline)
    return
  }
  if (circle) lineLayer.circle(circle.c[0], circle.c[1], circle.r, st.width)
  else if (outline) lineLayer.line(outline, st.width, closed)
  if (kind === 'text_box') {
    const s = nums(it, 'at', 3) ?? nums(it, 'start', 2)
    const size = nums(it, 'size', 2)
    const e = effects(child(it, 'effects'))
    if (s && size && !e.hide) {
      const m = 0.9525
      const x = e.h === 'left' ? s[0] + m : e.h === 'right' ? s[0] + size[0] - m : s[0] + size[0] / 2
      const y = e.v === 'top' ? s[1] - m : e.v === 'bottom' ? s[1] - size[1] + m : s[1] - size[1] / 2
      placeText(L.layer(pre + 'body', st.color), str(it[1]), P(x, y), e, 0, xf)
    }
  }
}

export function bezier(p: Pt[], segs = 24): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    out.push([a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]])
  }
  return out
}

function drawPin(L: SymbolLayers, sym: LibSymbol, pin: SList, xf: Xf, hits: PinHit[] | undefined, pre: string): void {
  const type = str(pin[1])
  const shape = str(pin[2])
  const at = nums(pin, 'at', 3) ?? [0, 0, 0]
  const len = num(child(pin, 'length')?.[1])
  const t = (at[2] * Math.PI) / 180
  const dl: Pt = [Math.round(Math.cos(t) * 1e6) / 1e6, Math.round(Math.sin(t) * 1e6) / 1e6]
  const p0 = apply(xf, at[0], at[1])
  const p1 = apply(xf, at[0] + dl[0] * len, at[1] + dl[1] * len)
  const d = applyLin(xf, dl[0], dl[1])
  const n: Pt = [-d[1], d[0]]
  const pinL = L.layer(pre + 'pin')
  const w = SCH_LINE
  const nameNode = child(pin, 'name')
  const numNode = child(pin, 'number')
  const name = str(nameNode?.[1])
  const number = str(numNode?.[1])
  const hidden = flag(pin, 'hide')
  hits?.push({ x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1], number, name, type, hidden })
  if (hidden) return

  // Line, shortened for an inversion bubble.
  const inverted = shape === 'inverted' || shape === 'inverted_clock'
  const lineEnd: Pt = inverted ? [p1[0] - d[0] * 2 * INVERT_R, p1[1] - d[1] * 2 * INVERT_R] : p1
  if (len > 0) pinL.line([p0, lineEnd], w)
  if (inverted) pinL.circle(p1[0] - d[0] * INVERT_R, p1[1] - d[1] * INVERT_R, INVERT_R, w)
  if (shape === 'clock' || shape === 'inverted_clock' || shape === 'clock_low' || shape === 'edge_clock_high') {
    pinL.line(
      [
        [p1[0] + n[0] * CLOCK, p1[1] + n[1] * CLOCK],
        [p1[0] + d[0] * CLOCK, p1[1] + d[1] * CLOCK],
        [p1[0] - n[0] * CLOCK, p1[1] - n[1] * CLOCK]
      ],
      w
    )
  }
  const D = 2 * INVERT_R
  const up = nUp(n)
  if (shape === 'input_low' || shape === 'clock_low' || shape === 'edge_clock_high') {
    // Low-active input: a wedge outside the body, rising from the pin line to the body edge.
    pinL.line(
      [
        [p1[0] - d[0] * D + up[0] * D, p1[1] - d[1] * D + up[1] * D],
        p1
      ],
      w
    )
  }
  if (shape === 'output_low') {
    pinL.line(
      [
        [p1[0] + up[0] * D, p1[1] + up[1] * D],
        [p1[0] - d[0] * D, p1[1] - d[1] * D]
      ],
      w
    )
  }
  const cross = (c: Pt) => {
    const r = 0.635
    pinL.seg(c[0] - r, c[1] - r, c[0] + r, c[1] + r, w)
    pinL.seg(c[0] - r, c[1] + r, c[0] + r, c[1] - r, w)
  }
  if (shape === 'non_logic') cross(p1)
  if (type === 'no_connect') cross(p0)

  // Texts.
  const horizontal = Math.abs(d[0]) > 0.5
  const margin = 0.1016 + w + 0.0762
  const showName = !sym.pinNamesHide && name !== '~' && name !== '' && !effects(child(nameNode, 'effects')).hide
  const showNum = !sym.pinNumbersHide && number !== '' && !effects(child(numNode, 'effects')).hide
  const ne = effects(child(nameNode, 'effects'))
  const nume = effects(child(numNode, 'effects'))
  const mid: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
  const off = sym.pinNameOffset
  const draw = (layer: Layer, text: string, x: number, y: number, e: typeof ne, h: 'left' | 'center' | 'right', v: 'top' | 'center' | 'bottom') =>
    layer.text(text, x, y, { size: e.size, thickness: e.thickness, angle: horizontal ? 0 : 90, h, v, italic: e.italic })
  // "Above" the pin line: up for horizontal pins, left for vertical ones (text reads upwards).
  const above: Pt = horizontal ? [0, -1] : [-1, 0]
  if (off > 0) {
    if (showName) {
      const ax = p1[0] + d[0] * off
      const ay = p1[1] + d[1] * off
      const along = horizontal ? d[0] : -d[1]
      draw(L.layer(pre + 'pinname'), name, ax, ay, ne, along > 0 ? 'left' : 'right', 'center')
    }
    if (showNum) draw(L.layer(pre + 'pinnum'), number, mid[0] + above[0] * margin, mid[1] + above[1] * margin, nume, 'center', 'bottom')
  } else {
    if (showName) draw(L.layer(pre + 'pinname'), name, mid[0] + above[0] * margin, mid[1] + above[1] * margin, ne, 'center', 'bottom')
    if (showNum) draw(L.layer(pre + 'pinnum'), number, mid[0] - above[0] * margin, mid[1] - above[1] * margin, nume, 'center', 'top')
  }
}

/** The normal pointing up (or left for vertical pins), for the low-active wedges. */
function nUp(n: Pt): Pt {
  if (Math.abs(n[1]) > 0.5) return n[1] < 0 ? n : [-n[0], -n[1]]
  return n[0] < 0 ? n : [-n[0], -n[1]]
}

/** Symbol bounding box in lib coordinates helper: transforms and collects pin ends and graphics. */
export function libPins(sym: LibSymbol, unit: number, style: number): SList[] {
  return sym.parts.filter((p) => (p.unit === 0 || p.unit === unit) && (p.style === 0 || p.style === style)).flatMap((p) => children(p.node, 'pin'))
}
