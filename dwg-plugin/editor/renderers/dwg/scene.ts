/** DWG database (as converted by @mlightcad/libredwg-web) → a flat, drawable scene: polylines, fills,
 *  hatch patterns and text per layer, block references expanded, model space and each paper-space
 *  layout with its viewports. Pure (scene.test.ts); the canvas drawing is in view.ts. */
import {
  aciToRgb,
  apply,
  arcPoints,
  bulgePolyline,
  Box,
  circlePoints,
  ellipsePoints,
  fitPointCurve,
  IDENTITY,
  lineweight,
  LW_BYBLOCK,
  LW_BYLAYER,
  LW_DEFAULT,
  type Mat,
  matScale,
  mirrors,
  mul,
  nurbsPoints,
  ocsMatrix,
  type P2,
  type P3,
  rotate,
  scale,
  translate
} from './geom.ts'
import { decodeControlCodes, parseMText, wrapLine } from './text.ts'

// The converted database is large and loosely typed; the scene reads it defensively.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ent = any

/** Colour drawn in the foreground colour of the current background (ACI 7, black/white). */
export const FOREGROUND = -1

export interface TextPrim {
  x: number
  y: number
  /** Text height (cap height) in drawing units. */
  h: number
  /** Rotation in radians, counter-clockwise. */
  rot: number
  /** Width factor. */
  wf: number
  /** Oblique angle in radians. */
  oblique: number
  /** Mirrored left-right (backwards) / upside down. */
  flipX: boolean
  flipY: boolean
  s: string
  /** 0 left, 1 centre, 2 right */
  ha: 0 | 1 | 2
  /** 0 baseline, 1 bottom, 2 middle, 3 top */
  va: 0 | 1 | 2 | 3
  font: string
}

export interface Prim {
  kind: 'line' | 'fill' | 'text' | 'pattern'
  layer: number
  color: number
  /** Line weight, 1/100 mm. */
  lw: number
  /** World-unit width of a wide polyline (0 = hairline/line weight). */
  ww?: number
  /** Dash pattern in drawing units, null for continuous. */
  dash?: number[] | null
  /** Polyline points (line) */
  pts?: number[]
  closed?: boolean
  /** Fill rings (fill, pattern clip) */
  rings?: number[][]
  /** Wipeout: filled with the background colour. */
  bg?: boolean
  /** Linear gradient fill (hatch gradients): colours and direction in radians. */
  grad?: { c1: number; c2: number; angle: number }
  /** Pattern line segments [x0, y0, x1, y1, ...] clipped by `rings` (even-odd). */
  segs?: number[]
  text?: TextPrim
}

export interface LayerInfo {
  name: string
  color: number
  visible: boolean
  frozen: boolean
  /** Number of primitives on the layer (all spaces). */
  count: number
}

export interface Viewport {
  /** Paper-space rectangle */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Model → paper transform */
  m: Mat
}

export interface Space {
  name: string
  paper: boolean
  prims: Prim[]
  box: Box
  /** Paper sheet (limits) for layouts. */
  sheet?: { x0: number; y0: number; x1: number; y1: number }
  viewports: Viewport[]
}

export interface Scene {
  layers: LayerInfo[]
  spaces: Space[]
  stats: {
    entities: number
    prims: number
    /** Entity types that are not drawn, with counts. */
    skipped: Record<string, number>
    truncated: boolean
  }
}

interface Inherit {
  layer: number
  color: number
  lw: number
  ltype: string
  ltScale: number
}

const MAX_POINTS = 6_000_000 // numbers across all primitives; beyond this the scene is truncated
const MAX_DEPTH = 12
const MAX_PATTERN_SEGS = 40_000 // per hatch
const DEFAULT_FONT = 'sans-serif'

export interface RawColor {
  index?: number
  rgb?: number
  method?: number
}

export interface BuildOptions {
  /** Width of a string at height 1 in drawing units (for MTEXT wrapping). */
  measure?: (s: string) => number
  /** LibreDWG's raw layer colours by layer name (read in the worker), used instead of the converted ones. */
  layerColors?: Record<string, RawColor>
}

/** A DWG colour record → ACI index or RGB. LibreDWG reports the colour index in `index` (R2000 and
 *  files it wrote), or in the low byte of `rgb` with method 0xC3 (AutoCAD 2004+), or a true colour
 *  with method 0xC2. libredwg-web 0.9.4 only knows the last two, which turns layers of some files
 *  white (index 255). */
export function decodeColor(c: RawColor): { aci: number } | { rgb: number } | null {
  const rgb = (c.rgb ?? 0) >>> 0
  const method = c.method || rgb >>> 24
  if (method === 0xc2) return { rgb: rgb & 0xffffff }
  const index = c.index ?? 0
  if (index >= 1 && index <= 255) return { aci: index }
  if (method === 0xc3 && (rgb & 0xff) >= 1 && (rgb & 0xff) <= 255) return { aci: rgb & 0xff }
  return null
}

/** Rough width of text at height 1: CJK full width, others ~0.6. */
export function approxWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    w += c >= 0x1100 && (c <= 0x11ff || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60)) ? 1 : c === 32 ? 0.35 : 0.62
  }
  return w
}

export function buildScene(db: Ent, opts: BuildOptions = {}): Scene {
  const measure = opts.measure ?? approxWidth
  const header: Ent = db.header ?? {}
  const ltScaleGlobal = num(header.LTSCALE, 1) || 1

  // ---- tables ----
  const layers: LayerInfo[] = []
  const layerIndex = new Map<string, number>()
  const layerMeta: { lw: number; ltype: string }[] = []
  for (const l of db.tables?.LAYER?.entries ?? []) {
    if (!l || typeof l.name !== 'string' || layerIndex.has(l.name)) continue
    const raw = opts.layerColors?.[l.name]
    const fixed = raw ? decodeColor(raw) : null
    const color = fixed
      ? 'aci' in fixed
        ? aciColor(fixed.aci)
        : fixed.rgb
      : l.colorIndex >= 1 && l.colorIndex <= 255
        ? aciColor(l.colorIndex)
        : l.colorIndex === 256 && typeof l.color === 'number'
          ? l.color & 0xffffff
          : FOREGROUND
    layerIndex.set(l.name, layers.length)
    layers.push({ name: l.name, color, visible: !l.off && !l.frozen, frozen: !!l.frozen, count: 0 })
    const lw = lineweight(l.lineweight)
    layerMeta.push({ lw: lw < 0 ? 25 : lw, ltype: String(l.lineType ?? 'Continuous') })
  }
  const layerOf = (name: unknown): number => {
    const n = typeof name === 'string' && name ? name : '0'
    let i = layerIndex.get(n)
    if (i == null) {
      i = layers.length
      layerIndex.set(n, i)
      layers.push({ name: n, color: FOREGROUND, visible: true, frozen: false, count: 0 })
      layerMeta.push({ lw: 25, ltype: 'Continuous' })
    }
    return i
  }
  const layer0 = layerOf('0')

  const ltypes = new Map<string, number[] | null>()
  for (const t of db.tables?.LTYPE?.entries ?? []) {
    const pat: Ent[] = Array.isArray(t?.pattern) ? t.pattern : []
    const dash = pat.map((p) => Math.abs(num(p.elementLength, 0)))
    ltypes.set(String(t.name).toLowerCase(), dash.length >= 2 && dash.some((d) => d > 0) ? dash : null)
  }

  const styles = new Map<string, Ent>()
  for (const s of db.tables?.STYLE?.entries ?? []) if (s?.name) styles.set(String(s.name).toLowerCase(), s)
  const dimstyles = new Map<string, Ent>()
  for (const s of db.tables?.DIMSTYLE?.entries ?? []) if (s?.name) dimstyles.set(String(s.name).toLowerCase(), s)

  const blocksByName = new Map<string, Ent>()
  const blocksByHandle = new Map<string, Ent>()
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (!b) continue
    if (typeof b.name === 'string') blocksByName.set(b.name.toLowerCase(), b)
    if (b.handle != null) blocksByHandle.set(String(b.handle), b)
  }

  const stats: Scene['stats'] = { entities: 0, prims: 0, skipped: {}, truncated: false }
  let budget = MAX_POINTS
  const skip = (type: string) => {
    stats.skipped[type] = (stats.skipped[type] ?? 0) + 1
  }

  // ---- emitting ----
  let prims: Prim[] = []
  let box = new Box()
  const rays: { prim: Prim; x: number; y: number; dx: number; dy: number; both: boolean }[] = []

  const fontFor = (styleName: unknown): string => {
    const st = styles.get(String(styleName ?? '').toLowerCase())
    const f = String(st?.font ?? '')
    // TrueType styles name the font file or family; SHX fonts (txt, romans, whgtxt) have no browser
    // equivalent: use the system sans-serif (Korean glyphs from Malgun Gothic / Apple SD Gothic Neo / Noto).
    if (/\.(ttf|ttc|otf)$/i.test(f)) return f.replace(/\.(ttf|ttc|otf)$/i, '')
    if (f && !/\.shx$/i.test(f) && !/^(txt|simplex|romans|romanc|isocp|gdt|monotxt)$/i.test(f)) return f
    return DEFAULT_FONT
  }

  function resolve(e: Ent, inh: Inherit): { layer: number; color: number; lw: number; dash: number[] | null; ltScale: number } {
    let layer = layerOf(e.layer)
    if (layer === layer0 && inh.layer !== layer0) layer = inh.layer
    let color: number
    if (typeof e.color === 'number' && e.color >= 0 && e.colorIndex !== 256 && e.colorIndex !== 0) color = e.color & 0xffffff
    else if (e.colorIndex === 0) color = inh.color
    else if (e.colorIndex >= 1 && e.colorIndex <= 255) color = aciColor(e.colorIndex)
    else color = layers[layer].color
    let lw = lineweight(e.lineweight)
    if (lw === LW_BYLAYER) lw = layerMeta[layer].lw
    else if (lw === LW_BYBLOCK) lw = inh.lw
    else if (lw === LW_DEFAULT) lw = 25
    let lt = String(e.lineType ?? '')
    if (!lt || /^bylayer$/i.test(lt)) lt = layerMeta[layer].ltype
    else if (/^byblock$/i.test(lt)) lt = inh.ltype
    const ltScale = num(e.lineTypeScale, 1) * inh.ltScale
    const base = ltypes.get(lt.toLowerCase()) ?? null
    const dash = base ? base.map((d) => Math.max(d, 0) * ltScale * ltScaleGlobal) : null
    return { layer, color, lw, dash, ltScale }
  }

  function addLine(r: ReturnType<typeof resolve>, m: Mat, pts: number[], closed: boolean, ww = 0) {
    if (pts.length < 2) return
    if (budget <= 0) {
      stats.truncated = true
      return
    }
    budget -= pts.length
    const out = new Array<number>(pts.length)
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const p = apply(m, pts[i], pts[i + 1])
      out[i] = p.x
      out[i + 1] = p.y
      box.add(p.x, p.y)
    }
    const s = matScale(m)
    prims.push({ kind: 'line', layer: r.layer, color: r.color, lw: r.lw, dash: r.dash ? r.dash.map((d) => d * s) : null, pts: out, closed, ww: ww * s || undefined })
  }

  function addFill(r: ReturnType<typeof resolve>, m: Mat, rings: number[][], bg = false) {
    if (budget <= 0) {
      stats.truncated = true
      return
    }
    const out = rings
      .filter((ring) => ring.length >= 6)
      .map((ring) => {
        budget -= ring.length
        const o = new Array<number>(ring.length)
        for (let i = 0; i + 1 < ring.length; i += 2) {
          const p = apply(m, ring[i], ring[i + 1])
          o[i] = p.x
          o[i + 1] = p.y
          box.add(p.x, p.y)
        }
        return o
      })
    if (out.length) prims.push({ kind: 'fill', layer: r.layer, color: r.color, lw: r.lw, rings: out, bg })
  }

  function addText(r: ReturnType<typeof resolve>, m: Mat, t: TextPrim) {
    if (!t.s.trim() || !(t.h > 0)) return
    const p = apply(m, t.x, t.y)
    // the text's x axis through the transform gives its new rotation and scale
    const ax = apply(m, Math.cos(t.rot), Math.sin(t.rot))
    const o = apply(m, 0, 0)
    const dx = ax.x - o.x
    const dy = ax.y - o.y
    const s = matScale(m)
    const mir = mirrors(m)
    const text: TextPrim = { ...t, x: p.x, y: p.y, h: t.h * s, rot: Math.atan2(dy, dx), flipY: mir ? !t.flipY : t.flipY }
    if (mir) text.rot = Math.atan2(dy, dx)
    const w = approxWidth(t.s) * text.h * text.wf
    box.add(p.x, p.y)
    box.add(p.x + Math.cos(text.rot) * w, p.y + Math.sin(text.rot) * w)
    prims.push({ kind: 'text', layer: r.layer, color: r.color, lw: r.lw, text })
  }

  function textBase(t: Ent, r: ReturnType<typeof resolve>, m: Mat, raw: string) {
    const ocs = ocsMatrix(t.extrusionDirection)
    const mm = mul(m, ocs)
    const st = styles.get(String(t.styleName ?? '').toLowerCase())
    const ha0 = num(t.halign, 0)
    const va0 = num(t.valign, 0)
    const aligned = ha0 !== 0 || va0 !== 0
    const start = t.startPoint ?? { x: 0, y: 0 }
    const end = t.endPoint ?? start
    // the alignment point; files that leave it unset (0, 0) are drawn from the insertion point
    const endSet = !!t.endPoint && (end.x !== 0 || end.y !== 0 || (start.x === 0 && start.y === 0))
    let at: P2 = aligned && ha0 !== 3 && ha0 !== 5 && endSet ? end : start
    let ha: 0 | 1 | 2 = ha0 === 1 || ha0 === 4 ? 1 : ha0 === 2 ? 2 : 0
    let va: 0 | 1 | 2 | 3 = ha0 === 4 ? 2 : (Math.min(3, Math.max(0, va0)) as 0 | 1 | 2 | 3)
    let rot = num(t.rotation, 0)
    let h = num(t.textHeight, 0) || num(st?.fixedTextHeight, 0) || num(st?.lastHeight, 0) || 2.5
    let wf = num(t.xScale, 0) || num(st?.widthFactor, 1) || 1
    const s = decodeControlCodes(raw)
    if (ha0 === 3 || ha0 === 5) {
      // ALIGNED / FIT: the text spans start → end
      const len = Math.hypot(end.x - start.x, end.y - start.y)
      if (len > 0) {
        rot = Math.atan2(end.y - start.y, end.x - start.x)
        const natural = approxWidth(s) * h * wf
        if (ha0 === 3 && natural > 0) {
          const k = len / natural
          h *= k
        } else if (natural > 0) wf *= len / natural
      }
      at = start
      ha = 0
      va = 0
    }
    const flags = num(t.generationFlag, 0)
    addText(r, mm, {
      x: at.x,
      y: at.y,
      h,
      rot,
      wf,
      oblique: num(t.obliqueAngle, 0),
      flipX: (flags & 2) !== 0,
      flipY: (flags & 4) !== 0,
      s,
      ha,
      va,
      font: fontFor(t.styleName)
    })
  }

  function mtext(e: Ent, r: ReturnType<typeof resolve>, m: Mat) {
    const st = styles.get(String(e.styleName ?? '').toLowerCase())
    const h = num(e.textHeight, 0) || num(st?.fixedTextHeight, 0) || num(header.TEXTSIZE, 0) || 2.5
    const ip: P3 = e.insertionPoint ?? { x: 0, y: 0 }
    const dir: P3 | undefined = e.direction
    let rot = num(e.rotation, 0)
    if (dir && Math.hypot(dir.x, dir.y) > 1e-9) rot = Math.atan2(dir.y, dir.x)
    // a box narrower than two characters is taken as "no wrapping" (some writers store the height there)
    const width = num(e.rectWidth, 0) >= h * 2 ? num(e.rectWidth, 0) : 0
    const lines = parseMText(String(e.text ?? ''))
      .flatMap((l) => wrapLine(l.text, width > 0 ? width * 1.02 : 0, (s) => measure(s) * h * l.height).map((text) => ({ text, height: l.height })))
    const ap = Math.min(9, Math.max(1, num(e.attachmentPoint, 1)))
    const col = ((ap - 1) % 3) as 0 | 1 | 2
    const row = Math.floor((ap - 1) / 3)
    const spacing = 5 / 3 * h * (num(e.lineSpacing, 1) || 1)
    const heights = lines.map((l) => l.height * h)
    const total = heights.reduce((a, b, i) => a + (i ? spacing * Math.max(1, b / h) : b), 0)
    let y = row === 0 ? 0 : row === 1 ? total / 2 : total
    const local = mul(m, mul(translate(ip.x, ip.y), rotate(rot)))
    lines.forEach((l, i) => {
      const lh = heights[i]
      y -= i === 0 ? lh : spacing * Math.max(1, lh / h)
      if (!l.text.trim()) return
      addText(r, local, { x: 0, y, h: lh, rot: 0, wf: 1, oblique: 0, flipX: false, flipY: false, s: l.text, ha: col, va: 0, font: fontFor(e.styleName) })
    })
  }

  function hatchRings(e: Ent): number[][] {
    const rings: number[][] = []
    for (const path of e.boundaryPaths ?? []) {
      if (Array.isArray(path.vertices)) {
        const pts = bulgePolyline(path.vertices, true)
        if (pts.length >= 6) rings.push(pts)
        continue
      }
      const ring: number[] = []
      for (const ed of path.edges ?? []) {
        const seg: number[] = []
        switch (ed.type) {
          case 1:
            seg.push(ed.start.x, ed.start.y, ed.end.x, ed.end.y)
            break
          case 2: {
            const ccw = ed.isCCW !== false
            let a0 = num(ed.startAngle, 0)
            let a1 = num(ed.endAngle, Math.PI * 2)
            if (!ccw) [a0, a1] = [-a1, -a0]
            arcPoints(ed.center.x, ed.center.y, num(ed.radius, 0), a0, a1, seg)
            if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9) seg.length -= 2
            if (!ccw) reversePairs(seg)
            break
          }
          case 3: {
            const ccw = ed.isCCW !== false
            const mx = num(ed.end?.x, 1)
            const my = num(ed.end?.y, 0)
            const minor = num(ed.lengthOfMinorAxis, 1)
            const ratio = minor <= 1 ? minor : minor / Math.hypot(mx, my)
            let t0 = num(ed.startAngle, 0)
            let t1 = num(ed.endAngle, Math.PI * 2)
            if (!ccw) [t0, t1] = [-t1, -t0]
            ellipsePoints(ed.center.x, ed.center.y, mx, my, ratio, t0, t1, seg)
            if (!ccw) reversePairs(seg)
            break
          }
          case 4: {
            const cps: Ent[] = ed.controlPoints ?? []
            const pts = cps.length
              ? nurbsPoints(num(ed.degree, 3), cps, ed.knots ?? [], cps.every((c) => c.weight != null) ? cps.map((c) => num(c.weight, 1)) : undefined)
              : fitPointCurve(ed.fitDatum ?? [])
            seg.push(...pts)
            break
          }
        }
        // join: drop a first point that repeats the previous end
        if (ring.length >= 2 && seg.length >= 2 && Math.abs(ring[ring.length - 2] - seg[0]) < 1e-9 && Math.abs(ring[ring.length - 1] - seg[1]) < 1e-9) seg.splice(0, 2)
        for (const v of seg) ring.push(v)
      }
      if (ring.length >= 6) rings.push(ring)
    }
    return rings
  }

  function hatch(e: Ent, r: ReturnType<typeof resolve>, m: Mat) {
    const mm = mul(m, ocsMatrix(e.extrusionDirection))
    const rings = hatchRings(e)
    if (!rings.length) return
    if (e.solidFill === 1 || /^solid$/i.test(String(e.patternName ?? ''))) {
      addFill(r, mm, rings)
      if (e.gradientFlag === 1 && Array.isArray(e.gradientColors) && e.gradientColors.length) {
        // two-colour (or one colour with tint) linear gradient; colours that cannot be decoded keep
        // the entity colour
        const cs: number[] = e.gradientColors.map((g: Ent) => {
          const d = decodeColor({ index: g.colorIndex, rgb: g.rgb, method: (num(g.rgb, 0) >>> 24) })
          return d ? ('aci' in d ? aciColor(d.aci) : d.rgb) : r.color
        })
        const c1 = cs[0]
        const c2 = cs.length > 1 ? cs[1] : c1
        const last = prims[prims.length - 1]
        if (last?.kind === 'fill') {
          last.color = c1
          if (c2 !== c1) last.grad = { c1, c2, angle: num(e.gradientRotation, 0) + mirrorAngle(mm) }
        }
      }
      return
    }
    const lines: Ent[] = e.definitionLines ?? []
    if (!lines.length) {
      addFill(r, mm, rings)
      return
    }
    // pattern lines over the boundary's box, clipped to the boundary when drawn
    const b = new Box()
    for (const ring of rings) b.addFlat(ring)
    const segs: number[] = []
    for (const dl of lines) {
      const ang = num(dl.angle, 0)
      const dx = Math.cos(ang)
      const dy = Math.sin(ang)
      const ox = num(dl.offset?.x, 0)
      const oy = num(dl.offset?.y, 0)
      // spacing between lines = offset component perpendicular to the direction
      const perp = -ox * dy + oy * dx
      if (Math.abs(perp) < 1e-9) continue
      const bx = num(dl.base?.x, 0)
      const by = num(dl.base?.y, 0)
      // perpendicular range of the box
      const corners = [
        [b.minX, b.minY],
        [b.maxX, b.minY],
        [b.minX, b.maxY],
        [b.maxX, b.maxY]
      ]
      let pmin = Infinity
      let pmax = -Infinity
      let tmin = Infinity
      let tmax = -Infinity
      for (const [cx, cy] of corners) {
        const p = -(cx - bx) * dy + (cy - by) * dx
        const t = (cx - bx) * dx + (cy - by) * dy
        pmin = Math.min(pmin, p)
        pmax = Math.max(pmax, p)
        tmin = Math.min(tmin, t)
        tmax = Math.max(tmax, t)
      }
      const k0 = Math.ceil(Math.min(pmin / perp, pmax / perp))
      const k1 = Math.floor(Math.max(pmin / perp, pmax / perp))
      if (k1 - k0 > MAX_PATTERN_SEGS) {
        segs.length = 0
        break
      }
      const dashes: number[] = (dl.dashLengths ?? []).map((d: unknown) => num(d, 0))
      const period = dashes.reduce((a, d) => a + Math.abs(d), 0)
      for (let k = k0; k <= k1; k++) {
        // line k passes through base + k * offset
        const px = bx + k * ox
        const py = by + k * oy
        // parameter range along the line covering the box
        const tc = (px - bx) * dx + (py - by) * dy
        const ta = tmin - tc
        const tb = tmax - tc
        if (!dashes.length || period <= 0) {
          segs.push(px + dx * ta, py + dy * ta, px + dx * tb, py + dy * tb)
        } else {
          // dashes start at the line's own origin; walk whole periods from before `ta`
          let t = Math.floor(ta / period) * period
          let guard = 0
          while (t < tb && guard++ < 100000) {
            for (const d of dashes) {
              const len = Math.abs(d)
              if (d >= 0) {
                const s0 = Math.max(t, ta)
                const s1 = Math.min(t + (d === 0 ? period * 0.001 : len), tb)
                if (s1 > s0) segs.push(px + dx * s0, py + dy * s0, px + dx * s1, py + dy * s1)
              }
              t += len
            }
          }
        }
        if (segs.length / 4 > MAX_PATTERN_SEGS) break
      }
      if (segs.length / 4 > MAX_PATTERN_SEGS) break
    }
    if (!segs.length || segs.length / 4 > MAX_PATTERN_SEGS) {
      // too dense to draw line by line: a light fill stands in
      addFill(r, mm, rings)
      const last = prims[prims.length - 1]
      if (last?.kind === 'fill') last.bg = false
      return
    }
    const tRings = rings.map((ring) => {
      const o: number[] = []
      for (let i = 0; i + 1 < ring.length; i += 2) {
        const p = apply(mm, ring[i], ring[i + 1])
        o.push(p.x, p.y)
        box.add(p.x, p.y)
      }
      return o
    })
    const tSegs = new Array<number>(segs.length)
    for (let i = 0; i + 1 < segs.length; i += 2) {
      const p = apply(mm, segs[i], segs[i + 1])
      tSegs[i] = p.x
      tSegs[i + 1] = p.y
    }
    budget -= tSegs.length
    prims.push({ kind: 'pattern', layer: r.layer, color: r.color, lw: r.lw, rings: tRings, segs: tSegs })
  }

  function arrow(r: ReturnType<typeof resolve>, m: Mat, tip: P2, from: P2, size: number) {
    const dx = tip.x - from.x
    const dy = tip.y - from.y
    const len = Math.hypot(dx, dy)
    if (!(len > 0) || !(size > 0)) return
    const ux = dx / len
    const uy = dy / len
    const bx = tip.x - ux * size
    const by = tip.y - uy * size
    const w = size / 6
    addFill(r, m, [[tip.x, tip.y, bx - uy * w, by + ux * w, bx + uy * w, by - ux * w]])
  }

  function dimScale(styleName: unknown): { asz: number; txt: number } {
    const ds = dimstyles.get(String(styleName ?? '').toLowerCase())
    const sc = num(ds?.DIMSCALE, num(header.DIMSCALE, 1)) || 1
    return { asz: num(ds?.DIMASZ, num(header.DIMASZ, 2.5)) * sc, txt: num(ds?.DIMTXT, num(header.DIMTXT, 2.5)) * sc }
  }

  function emit(e: Ent, m: Mat, inh: Inherit, depth: number) {
    try {
      emitEntity(e, m, inh, depth)
    } catch {
      // one malformed entity must not lose the drawing
      skip(`${String(e?.type ?? 'unknown')} (unreadable)`)
    }
  }

  function emitEntity(e: Ent, m: Mat, inh: Inherit, depth: number) {
    if (!e || e.isVisible === false) return
    stats.entities++
    const r = resolve(e, inh)
    const type = String(e.type ?? '')
    switch (type) {
      case 'LINE':
        addLine(r, m, [e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y], false)
        break
      case 'CIRCLE': {
        const mm = mul(m, ocsMatrix(e.extrusionDirection))
        addLine(r, mm, circlePoints(e.center.x, e.center.y, num(e.radius, 0)), true)
        break
      }
      case 'ARC': {
        const mm = mul(m, ocsMatrix(e.extrusionDirection))
        addLine(r, mm, arcPoints(e.center.x, e.center.y, num(e.radius, 0), num(e.startAngle, 0), num(e.endAngle, 0)), false)
        break
      }
      case 'ELLIPSE': {
        const c = e.center
        const mj = e.majorAxisEndPoint
        const n: P3 | undefined = e.extrusionDirection
        // centre and major axis are WCS; a normal pointing down reverses the parameter direction
        const down = (n?.z ?? 1) < 0
        const pts = ellipsePoints(c.x, c.y, mj.x, mj.y, num(e.axisRatio, 1), num(e.startAngle, 0), num(e.endAngle, Math.PI * 2))
        if (down) {
          // mirror the minor axis about the major axis
          for (let i = 0; i + 1 < pts.length; i += 2) {
            const rx = pts[i] - c.x
            const ry = pts[i + 1] - c.y
            const L = Math.hypot(mj.x, mj.y) || 1
            const ux = mj.x / L
            const uy = mj.y / L
            const along = rx * ux + ry * uy
            const across = -rx * uy + ry * ux
            pts[i] = c.x + along * ux + across * uy
            pts[i + 1] = c.y + along * uy - across * ux
          }
        }
        const full = Math.abs(num(e.endAngle, Math.PI * 2) - num(e.startAngle, 0)) >= Math.PI * 2 - 1e-6
        addLine(r, m, pts, full)
        break
      }
      case 'LWPOLYLINE': {
        const mm = mul(m, ocsMatrix(e.extrusionDirection))
        const closed = (num(e.flag, 0) & 1) !== 0 || (num(e.flag, 0) & 512) !== 0
        const vs: Ent[] = e.vertices ?? []
        let ww = num(e.constantWidth, 0)
        if (!ww && vs.length) {
          const avg = vs.reduce((a, v) => a + num(v.startWidth, 0) + num(v.endWidth, 0), 0) / (vs.length * 2)
          ww = avg
        }
        addLine(r, mm, bulgePolyline(vs, closed), closed, ww)
        break
      }
      case 'POLYLINE2D':
      case 'POLYLINE3D':
      case 'POLYLINE_PFACE':
      case 'POLYLINE_MESH': {
        const flag = num(e.flag, 0)
        const mm = type === 'POLYLINE2D' ? mul(m, ocsMatrix(e.extrusionDirection)) : m
        let vs: Ent[] = e.vertices ?? []
        if (type === 'POLYLINE_PFACE' || (flag & 64) !== 0) {
          // poly-face mesh: vertex list then faces with 1-based indexes
          const pts = vs.filter((v) => (num(v.flag, 0) & 128) === 0 || (num(v.flag, 0) & 64) !== 0)
          const faces = vs.filter((v) => (num(v.flag, 0) & 128) !== 0 && (num(v.flag, 0) & 64) === 0)
          for (const f of faces) {
            const idx = [f.polyfaceIndex0, f.polyfaceIndex1, f.polyfaceIndex2, f.polyfaceIndex3].map((i) => Math.abs(num(i, 0))).filter((i) => i > 0 && i <= pts.length)
            if (idx.length >= 2) addLine(r, mm, idx.flatMap((i) => [pts[i - 1].x, pts[i - 1].y]), true)
          }
          break
        }
        // spline/curve-fit polylines: draw the generated vertices, not the frame
        if (vs.some((v) => num(v.flag, 0) & 8)) vs = vs.filter((v) => (num(v.flag, 0) & 16) === 0)
        const closed = (flag & 1) !== 0
        addLine(r, mm, bulgePolyline(type === 'POLYLINE2D' ? vs : vs.map((v) => ({ x: v.x, y: v.y })), closed), closed, num(e.startWidth, 0))
        break
      }
      case 'SPLINE': {
        const cps: P3[] = e.controlPoints ?? []
        const closed = (num(e.flag, 0) & 1) !== 0
        const pts = cps.length >= 2 ? nurbsPoints(num(e.degree, 3), cps, e.knots ?? [], e.weights) : fitPointCurve(e.fitPoints ?? [], closed)
        addLine(r, m, pts, false)
        break
      }
      case 'POINT':
        addLine(r, m, [e.position.x, e.position.y, e.position.x, e.position.y], false)
        break
      case 'SOLID':
      case 'TRACE': {
        const mm = mul(m, ocsMatrix(e.extrusionDirection))
        const c = [e.corner1, e.corner2, e.corner4 ?? e.corner3, e.corner3].filter(Boolean)
        addFill(r, mm, [c.flatMap((p: P2) => [p.x, p.y])])
        break
      }
      case '3DFACE': {
        const c: P3[] = [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean)
        const flags = num(e.flag, 0)
        for (let i = 0; i < c.length; i++) {
          if (flags & (1 << i)) continue // invisible edge
          const a = c[i]
          const b = c[(i + 1) % c.length]
          if (a.x !== b.x || a.y !== b.y) addLine(r, m, [a.x, a.y, b.x, b.y], false)
        }
        break
      }
      case 'RAY':
      case 'XLINE': {
        const p = e.firstPoint ?? e.basePoint ?? e.position
        const d = e.unitDirection ?? e.direction
        if (!p || !d) break
        const a = apply(m, p.x, p.y)
        const o = apply(m, 0, 0)
        const q = apply(m, d.x, d.y)
        const prim: Prim = { kind: 'line', layer: r.layer, color: r.color, lw: r.lw, dash: r.dash, pts: [a.x, a.y, a.x, a.y], closed: false }
        prims.push(prim)
        rays.push({ prim, x: a.x, y: a.y, dx: q.x - o.x, dy: q.y - o.y, both: type === 'XLINE' })
        break
      }
      case 'TEXT':
        textBase(e, r, m, String(e.text ?? ''))
        break
      case 'ATTDEF':
        // attribute definitions show their tag only outside blocks
        if (depth === 0 && e.text) textBase(e.text, r, m, String(e.tag ?? ''))
        break
      case 'ATTRIB':
        if (e.text && (num(e.flags, 0) & 1) === 0) textBase(e.text, r, m, String(e.text.text ?? ''))
        break
      case 'MTEXT':
        mtext(e, r, m)
        break
      case 'TOLERANCE': {
        const ds = dimScale(e.styleName)
        const s = String(e.text ?? '').replace(/\{\\F[^;]*;[^}]*\}/g, '').replace(/%%v/gi, ' | ').replace(/\n/g, ' ')
        const d: P3 | undefined = e.xAxisDirection
        addText(r, m, { x: e.insertionPoint.x, y: e.insertionPoint.y, h: ds.txt, rot: d ? Math.atan2(d.y, d.x) : 0, wf: 1, oblique: 0, flipX: false, flipY: false, s, ha: 0, va: 2, font: DEFAULT_FONT })
        break
      }
      case 'HATCH':
      case 'MPOLYGON':
        hatch(e, r, m)
        break
      case 'WIPEOUT':
      case 'IMAGE': {
        const pos: P3 = e.position
        const u: P3 = e.uPixel
        const v: P3 = e.vPixel
        if (!pos || !u || !v) break
        const size: P2 = e.imageSize ?? { x: 1, y: 1 }
        let bnd: P2[] = Array.isArray(e.clippingBoundaryPath) && e.clippingBoundaryPath.length >= 2 && e.clipping ? e.clippingBoundaryPath : []
        if (bnd.length === 2) bnd = [bnd[0], { x: bnd[1].x, y: bnd[0].y }, bnd[1], { x: bnd[0].x, y: bnd[1].y }]
        if (!bnd.length) bnd = [{ x: -0.5, y: -0.5 }, { x: size.x - 0.5, y: -0.5 }, { x: size.x - 0.5, y: size.y - 0.5 }, { x: -0.5, y: size.y - 0.5 }]
        const ring = bnd.flatMap((p) => {
          const px = p.x + 0.5
          const py = size.y - (p.y + 0.5)
          return [pos.x + u.x * px + v.x * py, pos.y + u.y * px + v.y * py]
        })
        if (type === 'WIPEOUT') addFill(r, m, [ring], true)
        else {
          // raster images live in separate files: draw their frame
          addLine(r, m, ring, true)
          skip('IMAGE (frame only)')
        }
        break
      }
      case 'INSERT':
      case 'MINSERT': {
        const blk = blocksByName.get(String(e.name ?? '').toLowerCase())
        if (blk && depth < MAX_DEPTH) {
          const base: P3 = blk.basePoint ?? { x: 0, y: 0 }
          const ip: P3 = e.insertionPoint ?? { x: 0, y: 0 }
          const sx = num(e.xScale, 1) || 1
          const sy = num(e.yScale, 1) || 1
          const rows = Math.max(1, Math.min(1000, num(e.rowCount, 1)))
          const cols = Math.max(1, Math.min(1000, num(e.columnCount, 1)))
          const ocs = ocsMatrix(e.extrusionDirection)
          const child: Inherit = { layer: r.layer, color: r.color, lw: r.lw, ltype: String(e.lineType || 'ByLayer'), ltScale: r.ltScale }
          if (/^byblock$|^bylayer$|^$/i.test(child.ltype)) child.ltype = layerMeta[r.layer].ltype
          for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
              const t = mul(
                m,
                mul(ocs, mul(translate(ip.x, ip.y), mul(rotate(num(e.rotation, 0)), mul(translate(col * num(e.columnSpacing, 0), row * num(e.rowSpacing, 0)), mul(scale(sx, sy), translate(-base.x, -base.y))))))
              )
              for (const c of blk.entities ?? []) emit(c, t, child, depth + 1)
            }
          }
        } else skip(blk ? 'INSERT (nested too deep)' : 'INSERT (block missing)')
        for (const a of e.attribs ?? []) emit(a, m, inh, depth)
        break
      }
      case 'DIMENSION':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION': {
        const blk = blocksByName.get(String(e.name ?? '').toLowerCase())
        const child: Inherit = { layer: r.layer, color: r.color, lw: r.lw, ltype: 'Continuous', ltScale: r.ltScale }
        if (blk?.entities?.length && depth < MAX_DEPTH) {
          const ip: P2 = e.insertionPoint ?? { x: 0, y: 0 }
          const t = mul(m, mul(ocsMatrix(e.extrusionDirection), translate(ip.x ?? 0, ip.y ?? 0)))
          for (const c of blk.entities) emit(c, t, child, depth + 1)
        } else if (e.textPoint) {
          // no geometry block: show the measurement at the text position
          const ds = dimScale(e.styleName)
          const s = e.text && e.text !== '<>' ? String(e.text).replace('<>', fmt(e.measurement)) : fmt(e.measurement)
          addText(r, m, { x: e.textPoint.x, y: e.textPoint.y, h: ds.txt, rot: num(e.textRotation, 0), wf: 1, oblique: 0, flipX: false, flipY: false, s: decodeControlCodes(s), ha: 1, va: 2, font: DEFAULT_FONT })
          skip('DIMENSION (no block, text only)')
        }
        break
      }
      case 'LEADER': {
        const vs: P3[] = e.vertices ?? []
        if (vs.length < 2) break
        addLine(r, m, vs.flatMap((v) => [v.x, v.y]), false)
        if (e.isArrowheadEnabled !== false) arrow(r, m, vs[0], vs[1], dimScale(e.styleName).asz)
        break
      }
      case 'MULTILEADER': {
        const ctx: Ent = e.contextData ?? e
        for (const sec of ctx.leaderSections ?? e.leaderSections ?? []) {
          for (const ln of sec.leaderLines ?? []) {
            const vs: P3[] = [...(ln.vertices ?? [])]
            if (sec.lastLeaderLinePoint) vs.push(sec.lastLeaderLinePoint)
            if (vs.length >= 2) {
              addLine(r, m, vs.flatMap((v) => [v.x, v.y]), false)
              arrow(r, m, vs[0], vs[1], num(e.arrowheadSize, num(ctx.arrowheadSize, 2.5)) * (num(ctx.contentScale, 1) || 1))
            }
            if (sec.lastLeaderLinePoint && sec.doglegVector && num(sec.doglegLength, 0) > 0) {
              const p = sec.lastLeaderLinePoint
              const L = num(sec.doglegLength, 0)
              addLine(r, m, [p.x, p.y, p.x + sec.doglegVector.x * L, p.y + sec.doglegVector.y * L], false)
            }
          }
        }
        const txt = ctx.textContent ?? e.textContent
        const loc: P3 | undefined = ctx.textAnchor ?? ctx.textLocation ?? e.textAnchor
        if (txt && loc) {
          const dir: P3 | undefined = ctx.textDirection ?? e.textDirection
          mtext(
            {
              text: txt,
              textHeight: num(ctx.textHeight, num(e.textHeight, 2.5)),
              insertionPoint: loc,
              direction: dir,
              rectWidth: num(ctx.textWidth, 0),
              attachmentPoint: num(ctx.textAttachmentPoint, num(e.textAttachmentPoint, 1)) || 1,
              lineSpacing: num(ctx.textLineSpacingFactor, 1),
              styleName: ''
            },
            r,
            m
          )
        }
        break
      }
      case 'MLINE': {
        const vs: Ent[] = e.vertices ?? []
        const n = num(e.numberOfLines, vs[0]?.lines?.length ?? 0)
        for (let j = 0; j < n; j++) {
          const pts: number[] = []
          for (const v of vs) {
            const off = num(v.lines?.[j]?.segmentParams?.[0], 0)
            pts.push(v.vertex.x + v.miterDirection.x * off, v.vertex.y + v.miterDirection.y * off)
          }
          addLine(r, m, pts, (num(e.flags, 0) & 2) !== 0 && pts.length > 4)
        }
        break
      }
      case 'ACAD_TABLE': {
        const blk = e.blockRecordHandle ? blocksByHandle.get(String(e.blockRecordHandle)) : blocksByName.get(String(e.name ?? '').toLowerCase())
        if (blk?.entities?.length && depth < MAX_DEPTH) {
          const child: Inherit = { layer: r.layer, color: r.color, lw: r.lw, ltype: 'Continuous', ltScale: r.ltScale }
          for (const c of blk.entities) emit(c, m, child, depth + 1)
        } else skip(type)
        break
      }
      case 'VIEWPORT':
        break // handled per layout
      default:
        skip(type || 'unknown')
    }
  }

  // ---- spaces ----
  // Files written by some tools (LibreDWG's own writer among them) carry more than one *Model_Space
  // record: all of them, and the record the "Model" layout names, make up model space.
  const modelRecs = (db.tables?.BLOCK_RECORD?.entries ?? []).filter((b: Ent) => /^\*model_space$/i.test(String(b?.name ?? '')))
  const modelHandles = new Set<string>(modelRecs.filter((b: Ent) => b.handle != null).map((b: Ent) => String(b.handle)))
  for (const l of db.objects?.LAYOUT ?? []) if (/^model$/i.test(String(l?.layoutName ?? '')) && l.paperSpaceTableId) modelHandles.add(String(l.paperSpaceTableId))
  const spaceEntities = (recs: Ent[], handles: Set<string>, fallbackAll: boolean): Ent[] => {
    const seen = new Set<string>()
    const out: Ent[] = []
    const add = (e: Ent) => {
      const k = e?.handle != null ? String(e.handle) : ''
      if (k && seen.has(k)) return
      if (k) seen.add(k)
      out.push(e)
    }
    for (const e of db.entities ?? []) {
      if (handles.size ? handles.has(String(e.ownerBlockRecordSoftId)) : fallbackAll && !e.isInPaperSpace) add(e)
    }
    for (const rec of recs) for (const e of rec?.entities ?? []) add(e)
    return out
  }
  const rootInherit: Inherit = { layer: layer0, color: FOREGROUND, lw: 25, ltype: 'Continuous', ltScale: 1 }
  const build = (ents: Ent[]): { prims: Prim[]; box: Box } => {
    prims = []
    box = new Box()
    rays.length = 0
    for (const e of ents) emit(e, IDENTITY, rootInherit, 0)
    finishRays()
    return { prims, box }
  }
  const finishRays = () => {
    const diag = box.empty ? 1000 : Math.hypot(box.maxX - box.minX, box.maxY - box.minY) || 1000
    for (const ray of rays) {
      const L = diag * 4
      const len = Math.hypot(ray.dx, ray.dy) || 1
      const ux = ray.dx / len
      const uy = ray.dy / len
      ray.prim.pts = ray.both ? [ray.x - ux * L, ray.y - uy * L, ray.x + ux * L, ray.y + uy * L] : [ray.x, ray.y, ray.x + ux * L, ray.y + uy * L]
    }
  }

  const spaces: Space[] = []
  // Before R2000 there are no layout objects; LibreDWG files R12 and older entities under the paper-space
  // record: everything at the top level is the drawing then.
  const noLayouts = !(db.objects?.LAYOUT ?? []).length
  const model = build(noLayouts ? (db.entities ?? []).filter((e: Ent) => e && e.type !== 'VIEWPORT') : spaceEntities(modelRecs, modelHandles, true))
  spaces.push({ name: 'Model', paper: false, prims: model.prims, box: model.box, viewports: [] })

  const layouts: Ent[] = [...(db.objects?.LAYOUT ?? [])]
    .filter((l) => l && !/^model$/i.test(String(l.layoutName ?? '')) && !modelHandles.has(String(l.paperSpaceTableId ?? '')))
    .sort((a, b) => num(a.tabOrder, 0) - num(b.tabOrder, 0))
  for (const lay of layouts) {
    const handle = String(lay.paperSpaceTableId ?? '')
    const rec = blocksByHandle.get(handle)
    if (!rec) continue
    const ents = spaceEntities([rec], new Set([handle]), false)
    const built = build(ents.filter((e) => e.type !== 'VIEWPORT'))
    const viewports: Viewport[] = []
    for (const vp of ents) {
      if (vp.type !== 'VIEWPORT' || num(vp.viewportId, 0) === 1 || String(vp.handle) === String(lay.viewportId ?? '')) continue
      if (num(vp.statusBitFlags, 0) & 131072) continue // viewport off
      const w = num(vp.width, 0)
      const h = num(vp.height, 0)
      const vh = num(vp.viewHeight, 0)
      if (!(w > 0 && h > 0 && vh > 0)) continue
      const k = h / vh
      const c: P3 = vp.viewportCenter
      const tgt: P3 = vp.targetPoint ?? { x: 0, y: 0 }
      const dc: P2 = vp.displayCenter ?? { x: 0, y: 0 }
      const twist = num(vp.twistAngle, 0)
      const m = mul(translate(c.x, c.y), mul(rotate(-twist), mul(scale(k, k), translate(-(tgt.x + dc.x), -(tgt.y + dc.y)))))
      viewports.push({ x0: c.x - w / 2, y0: c.y - h / 2, x1: c.x + w / 2, y1: c.y + h / 2, m })
      built.box.add(c.x - w / 2, c.y - h / 2)
      built.box.add(c.x + w / 2, c.y + h / 2)
    }
    let sheet: Space['sheet']
    const lo = lay.minLimit
    const hi = lay.maxLimit
    if (lo && hi && hi.x > lo.x && hi.y > lo.y && hi.x - lo.x < 1e7) {
      sheet = { x0: lo.x, y0: lo.y, x1: hi.x, y1: hi.y }
      built.box.add(lo.x, lo.y)
      built.box.add(hi.x, hi.y)
    }
    spaces.push({ name: String(lay.layoutName || 'Layout'), paper: true, prims: built.prims, box: built.box, sheet, viewports })
  }

  for (const s of spaces) for (const p of s.prims) layers[p.layer].count++
  stats.prims = spaces.reduce((a, s) => a + s.prims.length, 0)
  return { layers, spaces, stats }
}

/** Rotation a transform adds to directions (for gradients inside rotated blocks). */
function mirrorAngle(m: Mat): number {
  return Math.atan2(m[1], m[0])
}

function aciColor(i: number): number {
  return i === 7 ? FOREGROUND : aciToRgb(i)
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

function fmt(v: unknown): string {
  const n = num(v, 0)
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, '')
}

function reversePairs(a: number[]): void {
  const n = a.length / 2
  for (let i = 0; i < n / 2; i++) {
    const j = n - 1 - i
    ;[a[2 * i], a[2 * j]] = [a[2 * j], a[2 * i]]
    ;[a[2 * i + 1], a[2 * j + 1]] = [a[2 * j + 1], a[2 * i + 1]]
  }
}
