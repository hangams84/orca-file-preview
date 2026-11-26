/** Visio Geometry sections to SVG path data, in the shape's local coordinates (inches, y up).
 *  Rows: MoveTo, LineTo, ArcTo, EllipticalArcTo, NURBSTo, SplineStart/SplineKnot, PolylineTo,
 *  Ellipse, InfiniteLine and the relative forms (RelMoveTo, RelLineTo, RelCubBezTo, RelQuadBezTo,
 *  RelEllipticalArcTo). */
import { fmt, type P } from './svg.ts'

export interface GeoRow {
  /** Row type (`T` attribute), e.g. `LineTo`. */
  t: string
  /** Cell values (`V`, or the formula `F` when there is no value) by name: X, Y, A, B, C, D, E. */
  v: Record<string, string>
}

export interface SubPath {
  /** Points along the path (curves sampled), for arrow directions and bounds. */
  pts: P[]
  closed: boolean
}

export interface GeoPath {
  d: string
  subpaths: SubPath[]
}

const numOf = (s: string | undefined, d = 0): number => {
  if (s == null || s === '') return d
  const n = Number(s)
  return Number.isFinite(n) ? n : d
}

/** Arguments of a NURBS(...) or POLYLINE(...) formula. */
export function formulaArgs(s: string | undefined, name: string): number[] | null {
  if (!s) return null
  const m = new RegExp(`${name}\\s*\\(([^)]*)\\)`, 'i').exec(s)
  if (!m) return null
  return m[1].split(',').map((x) => Number(x.trim()))
}

/** Circle through three points: centre and radius (null when they are collinear). */
export function circumcircle(a: P, b: P, c: P): { x: number; y: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  return { x, y, r: Math.hypot(a.x - x, a.y - y) }
}

/** Elliptical arc from p0 to p2 through the control point c; the ellipse's major axis is at
 *  `angle` (radians) and `ratio` = major/minor. Returns the SVG arc command and sample points. */
export function ellipticalArc(p0: P, p2: P, c: P, angle: number, ratio: number): { cmd: string; pts: P[] } {
  const k = ratio > 0 && Number.isFinite(ratio) ? ratio : 1
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  // To a space where the ellipse is a circle: rotate by -angle, squeeze x by 1/ratio.
  const to = (p: P): P => ({ x: (p.x * cos - p.y * sin) / k, y: p.x * sin + p.y * cos })
  const from = (p: P): P => {
    const x = p.x * k
    return { x: x * Math.cos(angle) - p.y * Math.sin(angle), y: x * Math.sin(angle) + p.y * Math.cos(angle) }
  }
  const a = to(p0)
  const b = to(c)
  const e = to(p2)
  const circ = circumcircle(a, b, e)
  if (!circ || Math.hypot(p2.x - p0.x, p2.y - p0.y) < 1e-12) return { cmd: `L${fmt(p2.x)} ${fmt(p2.y)}`, pts: [p2] }
  const cross = (b.x - a.x) * (e.y - a.y) - (b.y - a.y) * (e.x - a.x)
  const ccw = cross > 0
  const ang = (p: P) => Math.atan2(p.y - circ.y, p.x - circ.x)
  const a0 = ang(a)
  const a2 = ang(e)
  const tau = Math.PI * 2
  const span = ccw ? (((a2 - a0) % tau) + tau) % tau : (((a0 - a2) % tau) + tau) % tau
  const large = span > Math.PI ? 1 : 0
  const pts: P[] = []
  const steps = Math.max(2, Math.ceil(span / (Math.PI / 12)))
  for (let i = 1; i <= steps; i++) {
    const t = a0 + (ccw ? 1 : -1) * (span * i) / steps
    pts.push(from({ x: circ.x + circ.r * Math.cos(t), y: circ.y + circ.r * Math.sin(t) }))
  }
  const rx = circ.r * k
  const ry = circ.r
  return { cmd: `A${fmt(rx)} ${fmt(ry)} ${fmt((angle * 180) / Math.PI)} ${large} ${ccw ? 1 : 0} ${fmt(p2.x)} ${fmt(p2.y)}`, pts }
}

/** ArcTo: a circular arc to p2 whose midpoint is `bow` away from the chord's midpoint (positive
 *  bows bulge to the right of the travel direction). */
export function bowArc(p0: P, p2: P, bow: number): { cmd: string; pts: P[] } {
  const dx = p2.x - p0.x
  const dy = p2.y - p0.y
  const len = Math.hypot(dx, dy)
  if (Math.abs(bow) < 1e-9 || len < 1e-12) return { cmd: `L${fmt(p2.x)} ${fmt(p2.y)}`, pts: [p2] }
  const c = { x: (p0.x + p2.x) / 2 + (dy / len) * bow, y: (p0.y + p2.y) / 2 - (dx / len) * bow }
  return ellipticalArc(p0, p2, c, 0, 1)
}

/** Cox–de Boor basis function N(i, p) at t. */
function basis(i: number, p: number, t: number, U: number[]): number {
  if (p === 0) {
    const last = U[U.length - 1]
    return (U[i] <= t && t < U[i + 1]) || (t === last && U[i] < t && t <= U[i + 1]) ? 1 : 0
  }
  let s = 0
  const d1 = U[i + p] - U[i]
  const d2 = U[i + p + 1] - U[i + 1]
  if (d1 > 0) s += ((t - U[i]) / d1) * basis(i, p - 1, t, U)
  if (d2 > 0) s += ((U[i + p + 1] - t) / d2) * basis(i + 1, p - 1, t, U)
  return s
}

/** Samples a (rational) B-spline. Knots shorter than ctrl+degree+1 are padded with the last one. */
export function sampleNurbs(ctrl: P[], knots: number[], weights: number[], degree: number, perSpan = 12): P[] {
  const n = ctrl.length
  const p = Math.max(1, Math.min(degree | 0, n - 1))
  const U = knots.slice()
  while (U.length < n + p + 1) U.push(U[U.length - 1] ?? 1)
  if (U.length > n + p + 1) U.length = n + p + 1
  for (let i = 1; i < U.length; i++) if (U[i] < U[i - 1]) U[i] = U[i - 1]
  const t0 = U[p]
  const t1 = U[n]
  if (!(t1 > t0)) return ctrl.slice(1)
  const steps = Math.max(8, perSpan * (n - p))
  const out: P[] = []
  for (let s = 1; s <= steps; s++) {
    const t = t0 + ((t1 - t0) * s) / steps
    let x = 0
    let y = 0
    let w = 0
    for (let i = 0; i < n; i++) {
      const b = basis(i, p, t, U) * (weights[i] ?? 1)
      x += b * ctrl[i].x
      y += b * ctrl[i].y
      w += b
    }
    if (w > 0) out.push({ x: x / w, y: y / w })
  }
  return out
}

/** Path data for one Geometry section. `w`/`h` scale relative rows and relative NURBS/POLYLINE
 *  coordinates; `pageDiag` bounds InfiniteLine. */
export function geometryPath(rows: GeoRow[], w: number, h: number, pageDiag = 100): GeoPath {
  let d = ''
  const subpaths: SubPath[] = []
  let cur: SubPath | null = null
  let pos: P = { x: 0, y: 0 }
  let start: P = { x: 0, y: 0 }
  const pt = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`
  const begin = (p: P) => {
    if (cur) cur.closed = Math.hypot(pos.x - start.x, pos.y - start.y) < 1e-6
    d += `M${pt(p.x, p.y)}`
    cur = { pts: [p], closed: false }
    subpaths.push(cur)
    pos = p
    start = p
  }
  const ensure = () => {
    if (!cur) begin(pos)
  }
  const lineTo = (p: P) => {
    ensure()
    d += `L${pt(p.x, p.y)}`
    cur!.pts.push(p)
    pos = p
  }
  const polyTo = (pts: P[]) => {
    ensure()
    for (const p of pts) {
      d += `L${pt(p.x, p.y)}`
      cur!.pts.push(p)
    }
    if (pts.length) pos = pts[pts.length - 1]
  }

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    const v = row.v
    const X = numOf(v.X)
    const Y = numOf(v.Y)
    switch (row.t) {
      case 'MoveTo':
        begin({ x: X, y: Y })
        break
      case 'RelMoveTo':
        begin({ x: X * w, y: Y * h })
        break
      case 'LineTo':
        lineTo({ x: X, y: Y })
        break
      case 'RelLineTo':
        lineTo({ x: X * w, y: Y * h })
        break
      case 'ArcTo': {
        ensure()
        const p2 = { x: X, y: Y }
        const a = bowArc(pos, p2, numOf(v.A))
        d += a.cmd
        cur!.pts.push(...a.pts)
        pos = p2
        break
      }
      case 'EllipticalArcTo':
      case 'RelEllipticalArcTo': {
        ensure()
        const k = row.t === 'RelEllipticalArcTo'
        const p2 = k ? { x: X * w, y: Y * h } : { x: X, y: Y }
        const c = k ? { x: numOf(v.A) * w, y: numOf(v.B) * h } : { x: numOf(v.A), y: numOf(v.B) }
        const a = ellipticalArc(pos, p2, c, numOf(v.C), numOf(v.D, 1))
        d += a.cmd
        cur!.pts.push(...a.pts)
        pos = p2
        break
      }
      case 'RelCubBezTo': {
        ensure()
        const p2 = { x: X * w, y: Y * h }
        const c1 = { x: numOf(v.A) * w, y: numOf(v.B) * h }
        const c2 = { x: numOf(v.C) * w, y: numOf(v.D) * h }
        d += `C${pt(c1.x, c1.y)} ${pt(c2.x, c2.y)} ${pt(p2.x, p2.y)}`
        cur!.pts.push(c1, c2, p2)
        pos = p2
        break
      }
      case 'RelQuadBezTo': {
        ensure()
        const p2 = { x: X * w, y: Y * h }
        const c1 = { x: numOf(v.A) * w, y: numOf(v.B) * h }
        d += `Q${pt(c1.x, c1.y)} ${pt(p2.x, p2.y)}`
        cur!.pts.push(c1, p2)
        pos = p2
        break
      }
      case 'PolylineTo': {
        const args = formulaArgs(v.A, 'POLYLINE')
        const pts: P[] = []
        if (args && args.length >= 2) {
          const xRel = args[0] === 0
          const yRel = args[1] === 0
          for (let i = 2; i + 1 < args.length; i += 2) pts.push({ x: xRel ? args[i] * w : args[i], y: yRel ? args[i + 1] * h : args[i + 1] })
        }
        pts.push({ x: X, y: Y })
        polyTo(pts)
        break
      }
      case 'NURBSTo': {
        ensure()
        const args = formulaArgs(v.E, 'NURBS')
        const end = { x: X, y: Y }
        if (!args || args.length < 4) {
          lineTo(end)
          break
        }
        const [lastKnot, degree, xType, yType] = args
        const ctrl: P[] = [pos]
        const knots: number[] = [numOf(v.C)]
        const weights: number[] = [numOf(v.D, 1)]
        for (let i = 4; i + 3 < args.length; i += 4) {
          ctrl.push({ x: xType === 0 ? args[i] * w : args[i], y: yType === 0 ? args[i + 1] * h : args[i + 1] })
          knots.push(args[i + 2])
          weights.push(args[i + 3])
        }
        ctrl.push(end)
        knots.push(numOf(v.A), lastKnot)
        weights.push(numOf(v.B, 1))
        polyTo(sampleNurbs(ctrl, knots, weights, degree))
        if (Math.hypot(pos.x - end.x, pos.y - end.y) > 1e-6) lineTo(end)
        break
      }
      case 'SplineStart': {
        ensure()
        // SplineStart X,Y (2nd control point), A = second knot, B = first knot, C = last knot, D = degree;
        // following SplineKnot rows add control points and knots.
        const ctrl: P[] = [pos, { x: X, y: Y }]
        const knots = [numOf(v.B), numOf(v.A)]
        let j = r + 1
        while (j < rows.length && rows[j].t === 'SplineKnot') {
          ctrl.push({ x: numOf(rows[j].v.X), y: numOf(rows[j].v.Y) })
          knots.push(numOf(rows[j].v.A))
          j++
        }
        knots.push(numOf(v.C))
        polyTo(sampleNurbs(ctrl, knots, [], numOf(v.D, 3)))
        const last = ctrl[ctrl.length - 1]
        if (Math.hypot(pos.x - last.x, pos.y - last.y) > 1e-6) lineTo(last)
        r = j - 1
        break
      }
      case 'SplineKnot':
        lineTo({ x: X, y: Y })
        break
      case 'Ellipse': {
        // Centre X,Y; (A,B) ends one axis, (C,D) the other.
        const c = { x: X, y: Y }
        const p1 = { x: numOf(v.A), y: numOf(v.B) }
        const p2 = { x: numOf(v.C), y: numOf(v.D) }
        const rx = Math.hypot(p1.x - c.x, p1.y - c.y)
        const ry = Math.hypot(p2.x - c.x, p2.y - c.y)
        const rot = Math.atan2(p1.y - c.y, p1.x - c.x)
        const far = { x: 2 * c.x - p1.x, y: 2 * c.y - p1.y }
        const deg = fmt((rot * 180) / Math.PI)
        d += `M${pt(p1.x, p1.y)}A${fmt(rx)} ${fmt(ry)} ${deg} 1 1 ${pt(far.x, far.y)}A${fmt(rx)} ${fmt(ry)} ${deg} 1 1 ${pt(p1.x, p1.y)}Z`
        const pts: P[] = []
        for (let i = 0; i <= 24; i++) {
          const t = (i / 24) * Math.PI * 2
          const ex = Math.cos(t) * rx
          const ey = Math.sin(t) * ry
          pts.push({ x: c.x + ex * Math.cos(rot) - ey * Math.sin(rot), y: c.y + ex * Math.sin(rot) + ey * Math.cos(rot) })
        }
        if (cur) (cur as SubPath).closed = Math.hypot(pos.x - start.x, pos.y - start.y) < 1e-6
        cur = { pts, closed: true }
        subpaths.push(cur)
        pos = p1
        start = p1
        break
      }
      case 'InfiniteLine': {
        const a = { x: X, y: Y }
        const b = { x: numOf(v.A), y: numOf(v.B) }
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
        const ux = (b.x - a.x) / len
        const uy = (b.y - a.y) / len
        const p0 = { x: a.x - ux * pageDiag, y: a.y - uy * pageDiag }
        const p1 = { x: a.x + ux * pageDiag, y: a.y + uy * pageDiag }
        d += `M${pt(p0.x, p0.y)}L${pt(p1.x, p1.y)}`
        if (cur) (cur as SubPath).closed = Math.hypot(pos.x - start.x, pos.y - start.y) < 1e-6
        cur = { pts: [a, b], closed: false }
        subpaths.push(cur)
        pos = p1
        start = p0
        break
      }
      default:
        break
    }
  }
  if (cur && !(cur as SubPath).closed) (cur as SubPath).closed = Math.hypot(pos.x - start.x, pos.y - start.y) < 1e-6 && (cur as SubPath).pts.length > 2
  return { d, subpaths }
}
