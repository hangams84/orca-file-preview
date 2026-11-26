/** Path builder shared by the readers: commands in world units, with an optional affine map
 *  applied on the fly. Arcs stay exact (P.E) under similarities, including mirrors, and are
 *  flattened under general affine maps. */
import { apply, arcPoints, P, type Mat } from './scene.ts'

/** Builds paths, applying an optional affine map (OCS → WCS, or other). Arcs stay exact under
 *  similarities (including mirrors) and are flattened under general affine maps. */
export class PathB {
  d: number[] = []
  private open = false
  constructor(private m?: Mat) {}

  private pt(x: number, y: number): [number, number] {
    return this.m ? apply(this.m, x, y) : [x, y]
  }

  M(x: number, y: number): this {
    const [a, b] = this.pt(x, y)
    this.d.push(P.M, a, b)
    this.open = true
    return this
  }

  L(x: number, y: number): this {
    const [a, b] = this.pt(x, y)
    this.d.push(this.open ? P.L : P.M, a, b)
    this.open = true
    return this
  }

  Z(): this {
    if (this.open) this.d.push(P.Z)
    this.open = false
    return this
  }

  /** Elliptical arc continuing the current figure (or starting one). */
  E(cx: number, cy: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw: boolean): this {
    const m = this.m
    if (!(rx > 0) || !(ry > 0)) return this
    if (!m) {
      if (!this.open) {
        const [sx, sy] = ellipsePoint(cx, cy, rx, ry, rot, a0)
        this.d.push(P.M, sx, sy)
      }
      this.d.push(P.E, cx, cy, rx, ry, rot, a0, a1, ccw ? 1 : 0)
      this.open = true
      return this
    }
    const [a, b, c, dd] = m
    const s1 = Math.hypot(a, b)
    const s2 = Math.hypot(c, dd)
    const det = a * dd - b * c
    const similar = Math.abs(a * c + b * dd) <= 1e-9 * s1 * s2 + 1e-12 && Math.abs(s1 - s2) <= 1e-9 * Math.max(s1, s2)
    if (similar) {
      const phi = Math.atan2(b, a)
      const [ncx, ncy] = apply(m, cx, cy)
      if (det > 0) {
        if (!this.open) this.d.push(P.M, ...ellipsePoint(ncx, ncy, rx * s1, ry * s1, phi + rot, a0))
        this.d.push(P.E, ncx, ncy, rx * s1, ry * s1, phi + rot, a0, a1, ccw ? 1 : 0)
      } else {
        if (!this.open) this.d.push(P.M, ...ellipsePoint(ncx, ncy, rx * s1, ry * s1, phi - rot, -a0))
        this.d.push(P.E, ncx, ncy, rx * s1, ry * s1, phi - rot, -a0, -a1, ccw ? 0 : 1)
      }
      this.open = true
      return this
    }
    const pts = arcPoints(cx, cy, rx, ry, rot, a0, a1, ccw)
    for (let i = 0; i < pts.length; i += 2) this.L(pts[i], pts[i + 1])
    return this
  }

  circle(cx: number, cy: number, r: number): this {
    this.open = false
    this.E(cx, cy, r, r, 0, 0, Math.PI * 2, true)
    return this.Z()
  }

  /** Arc from the current point (x0, y0) to (x1, y1) with a DXF bulge. */
  bulge(x0: number, y0: number, x1: number, y1: number, b: number): this {
    if (!b || (x0 === x1 && y0 === y1)) return this.L(x1, y1)
    const dx = x1 - x0
    const dy = y1 - y0
    const chord = Math.hypot(dx, dy)
    const r = (chord * (1 + b * b)) / (4 * Math.abs(b))
    const k = (1 - b * b) / (4 * b)
    const cx = (x0 + x1) / 2 - k * dy
    const cy = (y0 + y1) / 2 + k * dx
    const a0 = Math.atan2(y0 - cy, x0 - cx)
    const a1 = Math.atan2(y1 - cy, x1 - cx)
    return this.E(cx, cy, r, r, 0, a0, a1, b > 0)
  }
}

function ellipsePoint(cx: number, cy: number, rx: number, ry: number, rot: number, t: number): [number, number] {
  const ex = rx * Math.cos(t)
  const ey = ry * Math.sin(t)
  return [cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]
}
