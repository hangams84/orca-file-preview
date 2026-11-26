/** KiCad S-expression reader. Lists become `SList` (an array with the head symbol at [0]); atoms
 *  stay strings (numbers are parsed on demand with `num`). Quoted strings are unescaped. */

export type SNode = string | SList
export interface SList extends Array<SNode> {}

export class SexprError extends Error {}

/** Parses the first top-level list of `text`. Throws SexprError on malformed input. */
export function parseSexpr(text: string, maxDepth = 400): SList {
  let i = 0
  const n = text.length
  const stack: SList[] = []
  let root: SList | null = null
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c === 40 /* ( */) {
      const list: SList = []
      if (stack.length) stack[stack.length - 1].push(list)
      else if (root) break
      else root = list
      stack.push(list)
      if (stack.length > maxDepth) throw new SexprError('nesting too deep')
      i++
    } else if (c === 41 /* ) */) {
      if (!stack.length) throw new SexprError(`unexpected ) at ${i}`)
      stack.pop()
      i++
      if (!stack.length) break
    } else if (c <= 32) {
      i++
    } else if (c === 34 /* " */) {
      i++
      let s = ''
      let start = i
      for (;;) {
        if (i >= n) throw new SexprError('unterminated string')
        const d = text.charCodeAt(i)
        if (d === 34) break
        if (d === 92 /* \ */) {
          s += text.slice(start, i)
          const e = text[i + 1]
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : (e ?? '')
          i += 2
          start = i
        } else i++
      }
      s += text.slice(start, i)
      i++
      if (!stack.length) throw new SexprError('atom outside a list')
      stack[stack.length - 1].push(s)
    } else {
      const start = i
      while (i < n) {
        const d = text.charCodeAt(i)
        if (d <= 32 || d === 40 || d === 41 || d === 34) break
        i++
      }
      if (!stack.length) throw new SexprError('atom outside a list')
      stack[stack.length - 1].push(text.slice(start, i))
    }
  }
  if (!root) throw new SexprError('no S-expression found')
  if (stack.length) throw new SexprError('unbalanced parentheses (truncated file?)')
  return root
}

export const isList = (n: SNode | undefined): n is SList => Array.isArray(n)
export const head = (n: SNode | undefined): string => (isList(n) && typeof n[0] === 'string' ? n[0] : '')

/** First child list with this head. */
export function child(list: SList | undefined, name: string): SList | undefined {
  if (!list) return undefined
  for (let i = 1; i < list.length; i++) {
    const c = list[i]
    if (isList(c) && c[0] === name) return c
  }
  return undefined
}

/** All child lists with this head. */
export function children(list: SList | undefined, name: string): SList[] {
  const out: SList[] = []
  if (!list) return out
  for (let i = 1; i < list.length; i++) {
    const c = list[i]
    if (isList(c) && c[0] === name) out.push(c)
  }
  return out
}

export function num(n: SNode | undefined, fallback = 0): number {
  if (typeof n !== 'string') return fallback
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

export function str(n: SNode | undefined, fallback = ''): string {
  return typeof n === 'string' ? n : fallback
}

/** `(name a b c)` → numbers a, b, c (missing → 0). */
export function nums(list: SList | undefined, name: string, count: number): number[] | undefined {
  const c = child(list, name)
  if (!c) return undefined
  const out: number[] = []
  for (let i = 1; i <= count; i++) out.push(num(c[i]))
  return out
}

/** Value of `(name value)`. */
export function val(list: SList | undefined, name: string): string | undefined {
  const c = child(list, name)
  return c && typeof c[1] === 'string' ? c[1] : undefined
}

/** True for a bare flag atom (`hide`) or `(hide yes)` (KiCad 8+). */
export function flag(list: SList | undefined, name: string): boolean {
  if (!list) return false
  for (let i = 1; i < list.length; i++) {
    const c = list[i]
    if (c === name) return true
    if (isList(c) && c[0] === name) return c[1] === undefined || c[1] === 'yes' || c[1] === 'true'
  }
  return false
}

/** Atoms (not lists) of a list after the head. */
export function atoms(list: SList | undefined): string[] {
  const out: string[] = []
  if (!list) return out
  for (let i = 1; i < list.length; i++) if (typeof list[i] === 'string') out.push(list[i] as string)
  return out
}

/** `(pts (xy x y) (xy x y) ...)` points; `(arc ...)` inside pts is approximated by its points. */
export function points(list: SList | undefined): [number, number][] {
  const pts = child(list, 'pts')
  const out: [number, number][] = []
  if (!pts) return out
  for (let i = 1; i < pts.length; i++) {
    const c = pts[i]
    if (!isList(c)) continue
    if (c[0] === 'xy') out.push([num(c[1]), num(c[2])])
    else if (c[0] === 'arc') {
      const s = nums(c, 'start', 2)
      const m = nums(c, 'mid', 2)
      const e = nums(c, 'end', 2)
      if (s && m && e) for (const p of arcPoints(s as [number, number], m as [number, number], e as [number, number], 16)) out.push(p)
    }
  }
  return out
}

/** Circle through three points, or null if collinear. */
export function circleFrom3(a: [number, number], b: [number, number], c: [number, number]): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a[0] * a[0] + a[1] * a[1]
  const b2 = b[0] * b[0] + b[1] * b[1]
  const c2 = c[0] * c[0] + c[1] * c[1]
  const cx = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d
  const cy = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) }
}

/** Points along the arc start→mid→end (inclusive). Collinear → the straight segment. */
export function arcPoints(s: [number, number], m: [number, number], e: [number, number], segs = 24): [number, number][] {
  const c = circleFrom3(s, m, e)
  if (!c) return [s, e]
  const a0 = Math.atan2(s[1] - c.cy, s[0] - c.cx)
  const am = Math.atan2(m[1] - c.cy, m[0] - c.cx)
  const a1 = Math.atan2(e[1] - c.cy, e[0] - c.cx)
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  // Sweep from a0 to a1 in the direction that passes through am.
  let sweep = norm(a1 - a0)
  if (norm(am - a0) > sweep) sweep -= 2 * Math.PI
  if (Math.abs(sweep) < 1e-9) sweep = 2 * Math.PI
  const out: [number, number][] = []
  for (let i = 0; i <= segs; i++) {
    const t = a0 + (sweep * i) / segs
    out.push([c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t)])
  }
  return out
}
