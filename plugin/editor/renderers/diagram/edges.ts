/** Edge routes for draw.io connectors: straight (with waypoints), orthogonal, elbow and
 *  entity-relation styles, with fixed connection points (exitX/exitY, entryX/entryY). A compact
 *  heuristic in the spirit of mxGraph's connectors, not a port of them. */
import { simplify, type P, type Rect } from './svg.ts'

export interface Terminal {
  rect: Rect
  shape: string
  rotation: number
}

export interface Constraint {
  x: number
  y: number
  dx: number
  dy: number
  perimeter: boolean
}

export interface RouteInput {
  src: Terminal
  tgt: Terminal
  /** Waypoints in absolute coordinates. */
  points: P[]
  /** draw.io `edgeStyle` (empty = straight). */
  style: string
  elbow: 'horizontal' | 'vertical'
  exit: Constraint | null
  entry: Constraint | null
  /** entityRelationEdgeStyle stub length. */
  segment: number
  /** Distance a route keeps from a shape before it turns. */
  jetty: number
  perimeter(t: Terminal, toward: P): P
}

type Dir = { x: number; y: number }
const LEFT: Dir = { x: -1, y: 0 }
const RIGHT: Dir = { x: 1, y: 0 }
const UP: Dir = { x: 0, y: -1 }
const DOWN: Dir = { x: 0, y: 1 }

const center = (r: Rect): P => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** A fixed connection point and the outward direction of the side it sits on. */
export function constraintPoint(t: Terminal, c: Constraint, perimeter: (t: Terminal, toward: P) => P): { p: P; dir: Dir } {
  const r = t.rect
  let p = { x: r.x + c.x * r.w + c.dx, y: r.y + c.y * r.h + c.dy }
  if (c.perimeter && t.shape !== 'rect' && t.shape !== 'point' && (r.w || r.h)) {
    // Non-rectangular shapes: project the box point onto the outline along the centre ray.
    const cc = center(r)
    if (Math.hypot(p.x - cc.x, p.y - cc.y) > 0.01) {
      const far = { x: cc.x + (p.x - cc.x) * 4, y: cc.y + (p.y - cc.y) * 4 }
      p = perimeter(t, far)
    }
  }
  let dir: Dir
  if (c.x <= 0) dir = LEFT
  else if (c.x >= 1) dir = RIGHT
  else if (c.y <= 0) dir = UP
  else if (c.y >= 1) dir = DOWN
  else {
    const d = [c.x, 1 - c.x, c.y, 1 - c.y]
    const i = d.indexOf(Math.min(...d))
    dir = [LEFT, RIGHT, UP, DOWN][i]
  }
  return { p, dir }
}

/** The side of `r` facing `p`, and the point on it (aligned with p when it can be straight). */
function facing(r: Rect, p: P, preferHorizontal: boolean): { p: P; dir: Dir } {
  const c = center(r)
  const left = p.x < r.x
  const right = p.x > r.x + r.w
  const above = p.y < r.y
  const below = p.y > r.y + r.h
  const inY = !above && !below
  const inX = !left && !right
  const clampY = (y: number) => Math.max(r.y, Math.min(r.y + r.h, y))
  const clampX = (x: number) => Math.max(r.x, Math.min(r.x + r.w, x))
  if ((left || right) && (inY || preferHorizontal || !(above || below)))
    return left ? { p: { x: r.x, y: inY ? clampY(p.y) : c.y }, dir: LEFT } : { p: { x: r.x + r.w, y: inY ? clampY(p.y) : c.y }, dir: RIGHT }
  if (above || below) return above ? { p: { x: inX ? clampX(p.x) : c.x, y: r.y }, dir: UP } : { p: { x: inX ? clampX(p.x) : c.x, y: r.y + r.h }, dir: DOWN }
  // p inside r: leave through the nearest side
  return { p: { x: r.x + r.w, y: c.y }, dir: RIGHT }
}

/** Orthogonal route between two ports, each with an outward direction. */
export function orthRoute(P0: P, d0: Dir, P1: P, d1: Dir, jetty: number): P[] {
  const H0 = d0.x !== 0
  const H1 = d1.x !== 0
  const Q0 = { x: P0.x + d0.x * jetty, y: P0.y + d0.y * jetty }
  const Q1 = { x: P1.x + d1.x * jetty, y: P1.y + d1.y * jetty }
  if (H0 && H1) {
    if (d0.x === -d1.x && (P1.x - P0.x) * d0.x > 0) {
      if (Math.abs(P0.y - P1.y) < 0.5) return [P0, P1]
      const mx = (P0.x + P1.x) / 2
      return [P0, { x: mx, y: P0.y }, { x: mx, y: P1.y }, P1]
    }
    if (d0.x === d1.x) {
      const x = d0.x > 0 ? Math.max(P0.x, P1.x) + jetty : Math.min(P0.x, P1.x) - jetty
      return [P0, { x, y: P0.y }, { x, y: P1.y }, P1]
    }
    const my = (P0.y + P1.y) / 2
    return [P0, Q0, { x: Q0.x, y: my }, { x: Q1.x, y: my }, Q1, P1]
  }
  if (!H0 && !H1) {
    if (d0.y === -d1.y && (P1.y - P0.y) * d0.y > 0) {
      if (Math.abs(P0.x - P1.x) < 0.5) return [P0, P1]
      const my = (P0.y + P1.y) / 2
      return [P0, { x: P0.x, y: my }, { x: P1.x, y: my }, P1]
    }
    if (d0.y === d1.y) {
      const y = d0.y > 0 ? Math.max(P0.y, P1.y) + jetty : Math.min(P0.y, P1.y) - jetty
      return [P0, { x: P0.x, y }, { x: P1.x, y }, P1]
    }
    const mx = (P0.x + P1.x) / 2
    return [P0, Q0, { x: mx, y: Q0.y }, { x: mx, y: Q1.y }, Q1, P1]
  }
  // One horizontal, one vertical: an L when the corner lies ahead of both ports.
  const corner = H0 ? { x: P1.x, y: P0.y } : { x: P0.x, y: P1.y }
  const ahead0 = (corner.x - P0.x) * d0.x + (corner.y - P0.y) * d0.y > 0
  const ahead1 = (corner.x - P1.x) * d1.x + (corner.y - P1.y) * d1.y > 0
  if (ahead0 && ahead1) return [P0, corner, P1]
  return H0 ? [P0, Q0, { x: Q0.x, y: Q1.y }, Q1, P1] : [P0, Q0, { x: Q1.x, y: Q0.y }, Q1, P1]
}

/** Joins points with horizontal/vertical segments; `firstHorizontal` picks the first turn. */
function orthThrough(pts: P[], firstHorizontal: boolean): P[] {
  const out: P[] = [pts[0]]
  let horizontal = firstHorizontal
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
      out.push(horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y })
    } else horizontal = Math.abs(a.y - b.y) <= 0.5
    out.push(b)
    horizontal = !horizontal
  }
  return out
}

const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

/** Ends on the outline, projected straight (horizontally or vertically) toward the next point. */
function orthEnd(r: Rect, toward: P): P {
  const c = center(r)
  if (toward.y >= r.y && toward.y <= r.y + r.h && (toward.x < r.x || toward.x > r.x + r.w)) return { x: toward.x < c.x ? r.x : r.x + r.w, y: toward.y }
  if (toward.x >= r.x && toward.x <= r.x + r.w) return { x: toward.x, y: toward.y < c.y ? r.y : r.y + r.h }
  return Math.abs(toward.x - c.x) * r.h > Math.abs(toward.y - c.y) * r.w ? { x: toward.x < c.x ? r.x : r.x + r.w, y: c.y } : { x: c.x, y: toward.y < c.y ? r.y : r.y + r.h }
}

/** mxGraph's ElbowConnector: side-to-side or top-to-bottom, steered by the first waypoint. */
function elbow(i: RouteInput, exitP: P | null, entryP: P | null): P[] {
  const s = i.src.rect
  const t = i.tgt.rect
  const pt = i.points[0] ?? null
  let vertical = false
  let horizontal = false
  if (pt) {
    const left = Math.min(s.x, t.x)
    const right = Math.max(s.x + s.w, t.x + t.w)
    const top = Math.min(s.y, t.y)
    const bottom = Math.max(s.y + s.h, t.y + t.h)
    vertical = pt.y < top || pt.y > bottom
    horizontal = pt.x < left || pt.x > right
  } else {
    vertical = Math.max(s.x, t.x) === Math.min(s.x + s.w, t.x + t.w)
    if (!vertical) horizontal = Math.max(s.y, t.y) === Math.min(s.y + s.h, t.y + t.h)
  }
  const useVertical = i.style === 'topToBottomEdgeStyle' || (i.style !== 'sideToSideEdgeStyle' && !horizontal && (vertical || i.elbow === 'vertical'))
  const mid: P[] = []
  const push = (x: number, y: number) => {
    if (!contains(t, x, y) && !contains(s, x, y)) mid.push({ x, y })
  }
  if (useVertical) {
    const tt = Math.max(s.y, t.y)
    const bb = Math.min(s.y + s.h, t.y + t.h)
    let x = s.x + s.w / 2
    if (pt && pt.x >= s.x && pt.x <= s.x + s.w) x = pt.x
    const y = pt ? pt.y : Math.round(bb + (tt - bb) / 2)
    push(x, y)
    x = pt && pt.x >= t.x && pt.x <= t.x + t.w ? pt.x : t.x + t.w / 2
    push(x, y)
    if (mid.length === 1 && !pt) mid.push({ x: mid[0].x, y })
  } else {
    const l = Math.max(s.x, t.x)
    const r = Math.min(s.x + s.w, t.x + t.w)
    const x = pt ? pt.x : Math.round(r + (l - r) / 2)
    let y1 = s.y + s.h / 2
    let y2 = t.y + t.h / 2
    if (pt) {
      if (pt.y >= s.y && pt.y <= s.y + s.h) y1 = pt.y
      if (pt.y >= t.y && pt.y <= t.y + t.h) y2 = pt.y
    }
    push(x, y1)
    push(x, y2)
    if (mid.length === 1) {
      if (pt) push(x, pt.y)
      else mid.push({ x, y: Math.max(s.y, t.y) + (Math.min(s.y + s.h, t.y + t.h) - Math.max(s.y, t.y)) / 2 })
    }
  }
  const first = mid[0] ?? center(t)
  const last = mid[mid.length - 1] ?? center(s)
  const P0 = exitP ?? (i.src.shape === 'point' ? center(s) : orthEnd(s, first))
  const P1 = entryP ?? (i.tgt.shape === 'point' ? center(t) : orthEnd(t, last))
  return [P0, ...mid, P1]
}

export function routeEdge(i: RouteInput): P[] {
  const { src, tgt, points, exit, entry } = i
  const sc = center(src.rect)
  const tc = center(tgt.rect)
  const style = i.style
  const ex = exit && src.shape !== 'point' ? constraintPoint(src, exit, i.perimeter) : null
  const en = entry && tgt.shape !== 'point' ? constraintPoint(tgt, entry, i.perimeter) : null

  const ortho = /^(orthogonalEdgeStyle|segmentEdgeStyle|isometricEdgeStyle)$/.test(style)
  if (style === 'elbowEdgeStyle' || style === 'sideToSideEdgeStyle' || style === 'topToBottomEdgeStyle') {
    return simplify(elbow(i, ex?.p ?? null, en?.p ?? null))
  }
  if (style === 'entityRelationEdgeStyle') {
    const s = i.segment
    const srcRight = tc.x >= sc.x
    const P0 = ex?.p ?? { x: srcRight ? src.rect.x + src.rect.w : src.rect.x, y: sc.y }
    const d0 = ex?.dir.x ? ex.dir.x : srcRight ? 1 : -1
    const tgtLeft = P0.x + d0 * s <= tgt.rect.x + tgt.rect.w / 2
    const P1 = en?.p ?? { x: tgtLeft ? tgt.rect.x : tgt.rect.x + tgt.rect.w, y: tc.y }
    const d1 = en?.dir.x ? en.dir.x : tgtLeft ? -1 : 1
    return simplify([P0, { x: P0.x + d0 * s, y: P0.y }, { x: P1.x + d1 * s, y: P1.y }, P1])
  }

  if (ortho) {
    if (points.length) {
      const first = points[0]
      const last = points[points.length - 1]
      const s = ex ?? facing(src.rect, first, true)
      const t = en ?? facing(tgt.rect, last, true)
      const startPts = src.shape === 'point' ? sc : s.p
      const endPts = tgt.shape === 'point' ? tc : t.p
      const through = orthThrough([startPts, ...points, endPts], s.dir.x !== 0)
      return simplify(through)
    }
    if (src.shape === 'point' && tgt.shape === 'point') return simplify(orthThrough([sc, tc], true))
    let s = ex
    let t = en
    if (!s && !t) {
      const r0 = src.rect
      const r1 = tgt.rect
      const ox0 = Math.max(r0.x, r1.x)
      const ox1 = Math.min(r0.x + r0.w, r1.x + r1.w)
      const oy0 = Math.max(r0.y, r1.y)
      const oy1 = Math.min(r0.y + r0.h, r1.y + r1.h)
      if (ox1 - ox0 > 1 && (r1.y >= r0.y + r0.h || r0.y >= r1.y + r1.h)) {
        const x = (ox0 + ox1) / 2
        return r1.y >= r0.y + r0.h ? [{ x, y: r0.y + r0.h }, { x, y: r1.y }] : [{ x, y: r0.y }, { x, y: r1.y + r1.h }]
      }
      if (oy1 - oy0 > 1 && (r1.x >= r0.x + r0.w || r0.x >= r1.x + r1.w)) {
        const y = (oy0 + oy1) / 2
        return r1.x >= r0.x + r0.w ? [{ x: r0.x + r0.w, y }, { x: r1.x, y }] : [{ x: r0.x, y }, { x: r1.x + r1.w, y }]
      }
      const dx = tc.x - sc.x
      const dy = tc.y - sc.y
      const horizontal = Math.abs(dx) >= Math.abs(dy)
      s = horizontal ? { p: { x: dx > 0 ? r0.x + r0.w : r0.x, y: sc.y }, dir: dx > 0 ? RIGHT : LEFT } : { p: { x: sc.x, y: dy > 0 ? r0.y + r0.h : r0.y }, dir: dy > 0 ? DOWN : UP }
      t = horizontal ? { p: { x: dx > 0 ? r1.x : r1.x + r1.w, y: tc.y }, dir: dx > 0 ? LEFT : RIGHT } : { p: { x: tc.x, y: dy > 0 ? r1.y : r1.y + r1.h }, dir: dy > 0 ? UP : DOWN }
    } else if (!s) s = src.shape === 'point' ? { p: sc, dir: facing(tgt.rect, sc, true).dir.x ? (t!.p.x > sc.x ? RIGHT : LEFT) : t!.p.y > sc.y ? DOWN : UP } : facing(src.rect, t!.p, t!.dir.y !== 0)
    else if (!t) t = tgt.shape === 'point' ? { p: tc, dir: s.dir.x ? (s.p.x > tc.x ? RIGHT : LEFT) : s.p.y > tc.y ? DOWN : UP } : facing(tgt.rect, s.p, s.dir.y !== 0)
    return simplify(orthRoute(s.p, s.dir, t!.p, t!.dir, i.jetty))
  }

  // Straight segments through the waypoints, ends on the outlines.
  const firstToward = points[0] ?? en?.p ?? tc
  const lastToward = points[points.length - 1] ?? ex?.p ?? sc
  const P0 = ex?.p ?? i.perimeter(src, firstToward)
  const P1 = en?.p ?? i.perimeter(tgt, lastToward)
  return simplify([P0, ...points, P1])
}
