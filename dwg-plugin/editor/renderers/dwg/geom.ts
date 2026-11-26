/** Geometry helpers for the DWG preview: AutoCAD colour index, object coordinate systems, 2D affine
 *  transforms, and tessellation of bulges, arcs, ellipses and splines into polylines. Pure functions
 *  (unit-tested in geom.test.ts). */

export interface P2 {
  x: number
  y: number
}
export interface P3 extends P2 {
  z?: number
}

// ---------------------------------------------------------------------------------------------
// AutoCAD Color Index (ACI) → 0xRRGGBB
// ---------------------------------------------------------------------------------------------

const ACI_FIXED: Record<number, number> = {
  1: 0xff0000,
  2: 0xffff00,
  3: 0x00ff00,
  4: 0x00ffff,
  5: 0x0000ff,
  6: 0xff00ff,
  7: 0xffffff,
  8: 0x808080,
  9: 0xc0c0c0,
  250: 0x333333,
  251: 0x5b5b5b,
  252: 0x848484,
  253: 0xadadad,
  254: 0xd6d6d6,
  255: 0xffffff
}
const ACI_LEVELS = [255, 165, 127, 76, 38]

/** RGB of an ACI index 1–255 (7 is "white"; the renderer swaps it for the foreground). */
export function aciToRgb(index: number): number {
  const i = Math.abs(Math.round(index))
  if (ACI_FIXED[i] != null) return ACI_FIXED[i]
  if (i < 10 || i > 249) return 0xffffff
  const hue = Math.floor((i - 10) / 10) * 15
  const sub = (i - 10) % 10
  const v = ACI_LEVELS[sub >> 1]
  const pale = sub % 2 === 1
  const [r, g, b] = hueRgb(hue)
  const ch = (c: number) => Math.floor(v * (pale ? 0.5 + c * 0.5 : c) + 1e-9) // AutoCAD truncates: ACI 11 = 255,127,127
  return (ch(r) << 16) | (ch(g) << 8) | ch(b)
}

function hueRgb(h: number): [number, number, number] {
  const x = (h % 60) / 60
  if (h < 60) return [1, x, 0]
  if (h < 120) return [1 - x, 1, 0]
  if (h < 180) return [0, 1, x]
  if (h < 240) return [0, 1 - x, 1]
  if (h < 300) return [x, 0, 1]
  return [1, 0, 1 - x]
}

/** DWG stores line weights as an index (0–23), 29 ByLayer, 30 ByBlock, 31 Default; DXF as 1/100 mm. */
const LW_TABLE = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
export const LW_BYLAYER = -1
export const LW_BYBLOCK = -2
export const LW_DEFAULT = -3
/** Line weight in 1/100 mm, or one of LW_BYLAYER / LW_BYBLOCK / LW_DEFAULT. */
export function lineweight(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return LW_BYLAYER
  if (raw < 0) return raw >= -3 ? raw : LW_DEFAULT
  if (raw <= 23) return LW_TABLE[raw]
  if (raw === 29) return LW_BYLAYER
  if (raw === 30) return LW_BYBLOCK
  if (raw === 31) return LW_DEFAULT
  return raw <= 211 ? raw : LW_DEFAULT
}

// ---------------------------------------------------------------------------------------------
// 2D affine transforms: [a, b, c, d, e, f] maps (x, y) to (a x + c y + e, b x + d y + f)
// ---------------------------------------------------------------------------------------------

export type Mat = [number, number, number, number, number, number]
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

export function mul(m: Mat, n: Mat): Mat {
  // m ∘ n: apply n first, then m
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}
export function apply(m: Mat, x: number, y: number): P2 {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}
export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y]
}
export function rotate(a: number): Mat {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c, s, -s, c, 0, 0]
}
export function scale(sx: number, sy: number): Mat {
  return [sx, 0, 0, sy, 0, 0]
}
/** Uniform-ish scale of a transform (geometric mean of the axis lengths). */
export function matScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
}
/** Whether the transform mirrors (negative determinant). */
export function mirrors(m: Mat): boolean {
  return m[0] * m[3] - m[1] * m[2] < 0
}

// ---------------------------------------------------------------------------------------------
// Object coordinate system (arbitrary axis algorithm), projected onto the WCS XY plane
// ---------------------------------------------------------------------------------------------

/** The 2D part of the OCS → WCS transform for an extrusion direction (normal). */
export function ocsMatrix(n: P3 | undefined): Mat {
  let nx = n?.x ?? 0
  let ny = n?.y ?? 0
  let nz = n?.z ?? 1
  const len = Math.hypot(nx, ny, nz)
  if (!(len > 1e-12)) return IDENTITY
  nx /= len
  ny /= len
  nz /= len
  if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12) return nz >= 0 ? IDENTITY : [-1, 0, 0, 1, 0, 0]
  // Ax = (Wy or Wz) × N, Ay = N × Ax
  let ax: [number, number, number]
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) ax = [nz, 0, -nx] // Wy × N
  else ax = [-ny, nx, 0] // Wz × N
  const al = Math.hypot(...ax)
  ax = [ax[0] / al, ax[1] / al, ax[2] / al]
  const ay: [number, number, number] = [ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2], nx * ax[1] - ny * ax[0]]
  return [ax[0], ax[1], ay[0], ay[1], 0, 0]
}

/** The z offset part of OCS → WCS is dropped (plan view). */
export function isPlanNormal(n: P3 | undefined): boolean {
  if (!n) return true
  const len = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0)
  return !(len > 1e-12) || Math.abs((n.z ?? 0) / len) > 1 - 1e-9
}

// ---------------------------------------------------------------------------------------------
// Tessellation (flat arrays [x0, y0, x1, y1, ...])
// ---------------------------------------------------------------------------------------------

/** Segments for an arc sweep, by angle (1.5° per segment, smooth up to ~10× zoom), clamped. */
export function arcSegments(sweep: number, minSeg = 4, maxSeg = 480): number {
  return Math.max(minSeg, Math.min(maxSeg, Math.ceil(Math.abs(sweep) / (Math.PI / 120))))
}

/** Points of a circular arc from `a0` counter-clockwise to `a1` (radians), both ends included. */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, out: number[] = []): number[] {
  let sweep = a1 - a0
  while (sweep <= 0) sweep += Math.PI * 2
  while (sweep > Math.PI * 2 + 1e-12) sweep -= Math.PI * 2
  const n = arcSegments(sweep)
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return out
}

export function circlePoints(cx: number, cy: number, r: number): number[] {
  const n = 240
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return out
}

/** Points of a bulged segment from p to q (bulge = tan(angle/4), positive counter-clockwise),
 *  excluding p and including q. */
export function bulgePoints(px: number, py: number, qx: number, qy: number, bulge: number, out: number[]): void {
  if (!bulge || Math.abs(bulge) < 1e-9) {
    out.push(qx, qy)
    return
  }
  const dx = qx - px
  const dy = qy - py
  const chord = Math.hypot(dx, dy)
  if (chord < 1e-12) {
    out.push(qx, qy)
    return
  }
  const theta = 4 * Math.atan(bulge) // signed included angle
  const r = chord / (2 * Math.sin(theta / 2))
  // centre: midpoint + perpendicular * (r cos(θ/2)), sign follows the bulge direction
  const mx = (px + qx) / 2
  const my = (py + qy) / 2
  const h = r * Math.cos(theta / 2)
  const nx = -dy / chord
  const ny = dx / chord
  const cx = mx + nx * h
  const cy = my + ny * h
  const a0 = Math.atan2(py - cy, px - cx)
  const n = arcSegments(theta, 2)
  const rr = Math.abs(r)
  for (let i = 1; i <= n; i++) {
    const a = a0 + (theta * i) / n
    out.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a))
  }
  // land exactly on q
  out[out.length - 2] = qx
  out[out.length - 1] = qy
}

/** Polyline with bulges → points. `closed` adds the closing segment (without repeating the start). */
export function bulgePolyline(vs: { x: number; y: number; bulge?: number }[], closed: boolean): number[] {
  const out: number[] = []
  if (!vs.length) return out
  out.push(vs[0].x, vs[0].y)
  const n = closed ? vs.length : vs.length - 1
  for (let i = 0; i < n; i++) {
    const p = vs[i]
    const q = vs[(i + 1) % vs.length]
    if (closed && i === vs.length - 1) {
      if (!p.bulge) break // straight closing segment: the path closes itself
      bulgePoints(p.x, p.y, q.x, q.y, p.bulge, out)
      out.length -= 2 // do not repeat the start point
      break
    }
    bulgePoints(p.x, p.y, q.x, q.y, p.bulge ?? 0, out)
  }
  return out
}

/** Ellipse (centre, major axis vector, ratio) between parameters t0 → t1 (counter-clockwise). */
export function ellipsePoints(
  cx: number,
  cy: number,
  mx: number,
  my: number,
  ratio: number,
  t0: number,
  t1: number,
  out: number[] = []
): number[] {
  let sweep = t1 - t0
  while (sweep <= 1e-12) sweep += Math.PI * 2
  while (sweep > Math.PI * 2 + 1e-9) sweep -= Math.PI * 2
  const n = arcSegments(sweep, 8, 360)
  // minor axis = N × major (counter-clockwise perpendicular) * ratio
  const nx = -my * ratio
  const ny = mx * ratio
  for (let i = 0; i <= n; i++) {
    const t = t0 + (sweep * i) / n
    const c = Math.cos(t)
    const s = Math.sin(t)
    out.push(cx + mx * c + nx * s, cy + my * c + ny * s)
  }
  return out
}

/** NURBS curve by de Boor's algorithm, `samples` points. Falls back to the control polygon. */
export function nurbsPoints(degree: number, ctrl: P2[], knots: number[], weights?: number[], samples?: number): number[] {
  const n = ctrl.length
  const p = Math.max(1, Math.min(degree | 0, n - 1))
  const out: number[] = []
  if (n < 2) {
    for (const c of ctrl) out.push(c.x, c.y)
    return out
  }
  if (knots.length !== n + p + 1 || knots.some((k, i) => i > 0 && k < knots[i - 1])) {
    for (const c of ctrl) out.push(c.x, c.y)
    return out
  }
  const w = weights && weights.length === n && weights.every((x) => x > 0) ? weights : null
  const lo = knots[p]
  const hi = knots[n]
  if (!(hi > lo)) {
    for (const c of ctrl) out.push(c.x, c.y)
    return out
  }
  const count = samples ?? Math.min(2000, Math.max(16, n * 12))
  for (let i = 0; i <= count; i++) {
    const t = lo + ((hi - lo) * i) / count
    // span index k with knots[k] <= t < knots[k+1]
    let k = p
    while (k < n - 1 && t >= knots[k + 1]) k++
    const dx: number[] = []
    const dy: number[] = []
    const dw: number[] = []
    for (let j = 0; j <= p; j++) {
      const c = ctrl[k - p + j]
      const wt = w ? w[k - p + j] : 1
      dx.push(c.x * wt)
      dy.push(c.y * wt)
      dw.push(wt)
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const left = knots[j + k - p]
        const right = knots[j + 1 + k - r]
        const a = right - left === 0 ? 0 : (t - left) / (right - left)
        dx[j] = (1 - a) * dx[j - 1] + a * dx[j]
        dy[j] = (1 - a) * dy[j - 1] + a * dy[j]
        dw[j] = (1 - a) * dw[j - 1] + a * dw[j]
      }
    }
    out.push(dx[p] / dw[p], dy[p] / dw[p])
  }
  return out
}

/** A smooth curve through fit points (centripetal Catmull-Rom), for splines stored as fit data. */
export function fitPointCurve(pts: P2[], closed = false, perSpan = 12): number[] {
  const out: number[] = []
  const n = pts.length
  if (n < 3) {
    for (const p of pts) out.push(p.x, p.y)
    return out
  }
  const at = (i: number): P2 => {
    if (closed) return pts[(i + n) % n]
    if (i < 0) return { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y }
    if (i >= n) return { x: 2 * pts[n - 1].x - pts[n - 2].x, y: 2 * pts[n - 1].y - pts[n - 2].y }
    return pts[i]
  }
  const spans = closed ? n : n - 1
  out.push(pts[0].x, pts[0].y)
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const d = (a: P2, b: P2) => Math.max(1e-9, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)))
    const t1 = d(p0, p1)
    const t2 = t1 + d(p1, p2)
    const t3 = t2 + d(p2, p3)
    for (let s = 1; s <= perSpan; s++) {
      const t = t1 + ((t2 - t1) * s) / perSpan
      const lerp = (a: P2, b: P2, ta: number, tb: number): P2 => {
        const u = (t - ta) / (tb - ta)
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
      }
      const a1 = lerp(p0, p1, 0, t1)
      const a2 = lerp(p1, p2, t1, t2)
      const a3 = lerp(p2, p3, t2, t3)
      const b1 = lerp(a1, a2, 0, t2)
      const b2 = lerp(a2, a3, t1, t3)
      const c = lerp(b1, b2, t1, t2)
      out.push(c.x, c.y)
    }
  }
  return out
}

/** Bounding box of flat point arrays. */
export class Box {
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity
  add(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < this.minX) this.minX = x
    if (y < this.minY) this.minY = y
    if (x > this.maxX) this.maxX = x
    if (y > this.maxY) this.maxY = y
  }
  addFlat(pts: ArrayLike<number>): void {
    for (let i = 0; i + 1 < pts.length; i += 2) this.add(pts[i], pts[i + 1])
  }
  get empty(): boolean {
    return !(this.maxX >= this.minX && this.maxY >= this.minY)
  }
}
