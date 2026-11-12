/** DrawingML basics shared by the slide renderer: theme colours and fonts, colour modifiers,
 *  fills and outlines. Colours resolve to CSS strings. */
import { attr, kid, kids, num, path } from './xml.ts'

export interface Theme {
  colors: Record<string, string>
  majorLatin: string
  majorEa: string
  minorLatin: string
  minorEa: string
  /** Format scheme lists referenced by `fillRef`/`lnRef`/`bgRef` idx (1-based; bg from 1001). */
  fillStyles: Element[]
  lnStyles: Element[]
  bgFillStyles: Element[]
}

export function parseTheme(doc: Document | null): Theme {
  const colors: Record<string, string> = {
    dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6',
    accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47',
    hlink: '0563C1', folHlink: '954F72'
  }
  const root = doc?.documentElement
  const scheme = path(root, 'themeElements', 'clrScheme')
  for (const c of kids(scheme)) {
    const v = kid(c, 'srgbClr') ? attr(kid(c, 'srgbClr'), 'val') : attr(kid(c, 'sysClr'), 'lastClr')
    if (v) colors[c.localName] = v
  }
  const fonts = path(root, 'themeElements', 'fontScheme')
  const fmt = path(root, 'themeElements', 'fmtScheme')
  const face = (which: string, script: string) => attr(path(fonts, which, script), 'typeface') ?? ''
  return {
    colors,
    majorLatin: face('majorFont', 'latin'),
    majorEa: face('majorFont', 'ea'),
    minorLatin: face('minorFont', 'latin'),
    minorEa: face('minorFont', 'ea'),
    fillStyles: kids(kid(fmt, 'fillStyleLst')),
    lnStyles: kids(kid(fmt, 'lnStyleLst')),
    bgFillStyles: kids(kid(fmt, 'bgFillStyleLst'))
  }
}

/** Colour context: the theme plus the master's colour map (bg1 → lt1, tx1 → dk1, …). */
export interface ColorCtx {
  theme: Theme
  map: Record<string, string>
  /** Colour that `phClr` stands for (inside style references). */
  phClr?: string
}

export const DEFAULT_CLR_MAP: Record<string, string> = {
  bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2',
  accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6',
  hlink: 'hlink', folHlink: 'folHlink'
}

export function parseClrMap(el: Element | null): Record<string, string> {
  const map = { ...DEFAULT_CLR_MAP }
  if (el) for (const a of Array.from(el.attributes)) map[a.localName] = a.value
  return map
}

const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', purple: '800080',
  cyan: '00FFFF', magenta: 'FF00FF', navy: '000080', silver: 'C0C0C0', maroon: '800000', teal: '008080'
}

const COLOR_TAGS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr'])

/** The colour element inside a fill-like parent (`solidFill`, `buClr`, `fontRef`, …). */
export function colorChild(el: Element | null): Element | null {
  if (!el) return null
  for (const c of kids(el)) if (COLOR_TAGS.has(c.localName)) return c
  return null
}

/** Resolves a colour element (srgbClr, schemeClr, …) with its modifiers to `rgba()`/`#hex`. */
export function resolveColor(el: Element | null, cc: ColorCtx): string | null {
  if (!el) return null
  let hex: string | null = null
  switch (el.localName) {
    case 'srgbClr':
      hex = attr(el, 'val')
      break
    case 'sysClr':
      hex = attr(el, 'lastClr') ?? (attr(el, 'val') === 'window' ? 'FFFFFF' : '000000')
      break
    case 'prstClr':
      hex = PRESET[attr(el, 'val') ?? ''] ?? '000000'
      break
    case 'scrgbClr': {
      const c = (n: string) => Math.round(Math.min(1, (num(el, n, 0) ?? 0) / 100000) * 255)
      hex = [c('r'), c('g'), c('b')].map((v) => v.toString(16).padStart(2, '0')).join('')
      break
    }
    case 'hslClr': {
      const [r, g, b] = hslToRgb((num(el, 'hue', 0)! / 60000) / 360, num(el, 'sat', 0)! / 100000, num(el, 'lum', 0)! / 100000)
      hex = toHex(r, g, b)
      break
    }
    case 'schemeClr': {
      const val = attr(el, 'val') ?? ''
      if (val === 'phClr') hex = cc.phClr ?? null
      else hex = cc.theme.colors[cc.map[val] ?? val] ?? cc.theme.colors[val] ?? null
      break
    }
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null
  let r = parseInt(hex.slice(0, 2), 16)
  let g = parseInt(hex.slice(2, 4), 16)
  let b = parseInt(hex.slice(4, 6), 16)
  let alpha = 1
  for (const m of kids(el)) {
    const v = (num(m, 'val', 0) ?? 0) / 100000
    switch (m.localName) {
      case 'alpha':
        alpha = v
        break
      case 'lumMod':
      case 'lumOff': {
        const [hh, s, l] = rgbToHsl(r, g, b)
        const nl = m.localName === 'lumMod' ? l * v : l + v
        ;[r, g, b] = hslToRgb(hh, s, Math.min(1, Math.max(0, nl)))
        break
      }
      case 'tint':
        r = r + (255 - r) * (1 - v)
        g = g + (255 - g) * (1 - v)
        b = b + (255 - b) * (1 - v)
        break
      case 'shade':
        r *= v
        g *= v
        b *= v
        break
      case 'satMod': {
        const [hh, s, l] = rgbToHsl(r, g, b)
        ;[r, g, b] = hslToRgb(hh, Math.min(1, s * v), l)
        break
      }
    }
  }
  const R = Math.round(r)
  const G = Math.round(g)
  const B = Math.round(b)
  return alpha < 1 ? `rgba(${R},${G},${B},${alpha.toFixed(3)})` : `#${toHex(R, G, B)}`
}

/** Hex (no #) of a resolved colour, for `phClr` substitution. */
export function hexOf(css: string | null): string | undefined {
  if (!css) return undefined
  if (css.startsWith('#')) return css.slice(1)
  const m = /rgba?\((\d+),(\d+),(\d+)/.exec(css)
  return m ? toHex(+m[1], +m[2], +m[3]) : undefined
}

function toHex(r: number, g: number, b: number): string {
  return [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let hh = 0
  if (max === r) hh = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) hh = (b - r) / d + 2
  else hh = (r - g) / d + 4
  return [hh / 6, s, l]
}

function hslToRgb(hh: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255]
}

/** A fill as CSS `background` (solid or gradient); `null` = no fill specified, `'none'` = noFill. */
export function fillCss(parent: Element | null, cc: ColorCtx): string | null {
  if (!parent) return null
  if (kid(parent, 'noFill')) return 'none'
  const solid = kid(parent, 'solidFill')
  if (solid) return resolveColor(colorChild(solid), cc)
  const grad = kid(parent, 'gradFill')
  if (grad) {
    const stops = kids(kid(grad, 'gsLst'), 'gs')
      .map((gs) => ({ pos: (num(gs, 'pos', 0) ?? 0) / 1000, color: resolveColor(colorChild(gs), cc) }))
      .filter((s) => s.color)
      .sort((a, b) => a.pos - b.pos)
    if (!stops.length) return null
    if (stops.length === 1) return stops[0].color
    const lin = kid(grad, 'lin')
    const angle = lin ? (num(lin, 'ang', 0) ?? 0) / 60000 : 90
    const shape = kid(grad, 'path')
    const list = stops.map((s) => `${s.color} ${s.pos}%`).join(', ')
    return shape ? `radial-gradient(circle, ${list})` : `linear-gradient(${angle + 90}deg, ${list})`
  }
  return null
}
