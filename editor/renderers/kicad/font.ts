/** KiCad's stroke font (newstroke) laid out the way KiCad's STROKE_FONT does it: text becomes
 *  polylines in board/schematic units. Layout rules adapted from KiCanvas (MIT) and KiCad. */
import { GLYPHS, SHARED } from './newstroke.ts'

export type Pt = [number, number]
export type HJustify = 'left' | 'center' | 'right'
export type VJustify = 'top' | 'center' | 'bottom'

export interface TextStyle {
  /** Glyph width and height (KiCad `(size h w)` is height first; pass [w, h] here). */
  size: [number, number]
  thickness: number
  angle?: number
  h?: HJustify
  v?: VJustify
  mirror?: boolean
  italic?: boolean
  lineSpacing?: number
}

interface Glyph {
  strokes: Pt[][]
  width: number
}

const SCALE = 1 / 21
const OFFSET = -10
const ITALIC_TILT = 1 / 8
const INTERLINE = 1.62
const SPACE = 0.6
const INTER_CHAR = 0.2
const OVERBAR = 1.4
const SUB_SUPER = 0.7

const cache = new Map<number, Glyph | null>()
const sharedCache = new Map<number, Glyph>()

function decode(data: string): Glyph {
  let startX = 0
  let width = 0
  const strokes: Pt[][] = []
  let cur: Pt[] | null = null
  for (let i = 0; i + 1 < data.length; i += 2) {
    const a = data.charCodeAt(i) - 82
    const b = data.charCodeAt(i + 1) - 82
    if (i === 0) {
      startX = a * SCALE
      width = b * SCALE - startX
    } else if (data[i] === ' ' && data[i + 1] === 'R') cur = null
    else {
      if (!cur) {
        cur = []
        strokes.push(cur)
      }
      cur.push([a * SCALE - startX, (b + OFFSET) * SCALE])
    }
  }
  return { strokes, width }
}

function glyph(cp: number): Glyph | null {
  let g = cache.get(cp)
  if (g !== undefined) return g
  const d = GLYPHS[cp]
  if (typeof d === 'string') g = decode(d)
  else if (typeof d === 'number') {
    g = sharedCache.get(d) ?? decode(SHARED[d])
    sharedCache.set(d, g)
  } else g = null
  cache.set(cp, g)
  return g
}

/** True when every character has a newstroke glyph (else the caller uses a system font). */
export function hasGlyphs(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 10 || cp === 9 || cp === 13) continue
    if (!glyph(cp)) return false
  }
  return true
}

interface Run {
  text: string
  overbar: boolean
  sub: boolean
  sup: boolean
}

const ESCAPES: Record<string, string> = {
  slash: '/',
  backslash: String.fromCharCode(92),
  dblquote: '"',
  quote: "'",
  lt: '<',
  gt: '>',
  bar: '|',
  colon: ':',
  space: ' ',
  dollar: '$',
  tab: '\t',
  return: '\n',
  brace: '{',
  comma: ','
}

/** KiCad's string escapes in names (`{slash}`, `{dblquote}`, ...). */
export function unescapeKicad(s: string): string {
  return s.indexOf('{') < 0 ? s : s.replace(/\{(\w+)\}/g, (m, k: string) => ESCAPES[k] ?? m)
}

/** KiCad text markup: `~{overbar}`, `_{subscript}`, `^{superscript}`; nesting flattened. */
export function parseMarkup(text: string): Run[] {
  const runs: Run[] = []
  const re = /([~_^])\{([^{}]*)\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: unescapeKicad(text.slice(last, m.index)), overbar: false, sub: false, sup: false })
    runs.push({ text: unescapeKicad(m[2]), overbar: m[1] === '~', sub: m[1] === '_', sup: m[1] === '^' })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: unescapeKicad(text.slice(last)), overbar: false, sub: false, sup: false })
  return runs
}

/** Strips markup for display in tooltips and lists. */
export function plainText(text: string): string {
  return parseMarkup(text)
    .map((r) => r.text)
    .join('')
}

/** One line laid out at the origin (baseline y = 0, x from 0). */
function layoutLine(line: string, size: [number, number], italic: boolean): { strokes: Pt[][]; width: number } {
  const strokes: Pt[][] = []
  let x = 0
  const tilt = italic ? ITALIC_TILT : 0
  for (const run of parseMarkup(line)) {
    const gw = run.sub || run.sup ? size[0] * SUB_SUPER : size[0]
    const gh = run.sub || run.sup ? size[1] * SUB_SUPER : size[1]
    const dy = run.sub ? gh * 0.3 : run.sup ? -gh * 0.5 : 0
    const x0 = x
    for (const ch of run.text) {
      if (ch === ' ') {
        x += (glyph(32)?.width ?? SPACE) * gw
        continue
      }
      if (ch === '\t') {
        const tab = gw * 4 * 0.82
        x += tab - (x % tab)
        continue
      }
      const g = glyph(ch.codePointAt(0)!) ?? glyph(63)!
      for (const s of g.strokes) {
        strokes.push(s.map(([px, py]) => [x + px * gw - py * gh * tilt, py * gh + dy] as Pt))
      }
      x += g.width * gw
    }
    if (run.overbar && x > x0) {
      const y = -size[1] * OVERBAR + dy
      const trim = gw * 0.1
      strokes.push([
        [x0 + trim - y * tilt, y],
        [x - trim - y * tilt, y]
      ])
    }
  }
  return { strokes, width: Math.max(0, x - size[0] * INTER_CHAR) }
}

/** Width of one line of text (for boxes around labels). */
export function textWidth(line: string, size: [number, number]): number {
  return layoutLine(line, size, false).width
}

/** Lays `text` out at (x, y) as polylines in world coordinates (y down, angles counter-clockwise). */
export function strokeText(text: string, x: number, y: number, st: TextStyle): Pt[][] {
  const lines = text.split('\n')
  const [, sh] = st.size
  const interline = sh * INTERLINE * (st.lineSpacing ?? 1)
  let oy = 0
  const v = st.v ?? 'center'
  if (v === 'top') oy = sh
  else if (v === 'center') oy = (sh - interline * (lines.length - 1)) / 2
  else oy = -interline * (lines.length - 1)
  const a = ((st.angle ?? 0) * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const out: Pt[][] = []
  lines.forEach((line, i) => {
    const l = layoutLine(line, st.size, !!st.italic)
    const h = st.h ?? 'center'
    const ox = h === 'left' ? 0 : h === 'center' ? -l.width / 2 : -l.width
    const by = oy + i * interline
    for (const s of l.strokes) {
      out.push(
        s.map(([px, py]) => {
          let lx = px + ox
          const ly = py + by
          if (st.mirror) lx = -lx
          return [x + lx * cos + ly * sin, y - lx * sin + ly * cos] as Pt
        })
      )
    }
  })
  return out
}

/** Bounding box size of laid-out text (unrotated): width of the widest line, total height. */
export function textExtent(text: string, size: [number, number], lineSpacing = 1): { w: number; h: number } {
  const lines = text.split('\n')
  let w = 0
  for (const l of lines) w = Math.max(w, layoutLine(l, size, false).width)
  return { w, h: size[1] + size[1] * INTERLINE * lineSpacing * (lines.length - 1) }
}

/** Greedy word wrap to `maxWidth` (KiCad wraps text boxes the same way). */
export function wrapText(text: string, size: [number, number], maxWidth: number): string {
  if (!(maxWidth > 0)) return text
  return text
    .split('\n')
    .map((para) => {
      const words = para.split(' ')
      const lines: string[] = []
      let cur = ''
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w
        if (cur && layoutLine(next, size, false).width > maxWidth) {
          lines.push(cur)
          cur = w
        } else cur = next
      }
      lines.push(cur)
      return lines.join('\n')
    })
    .join('\n')
}
