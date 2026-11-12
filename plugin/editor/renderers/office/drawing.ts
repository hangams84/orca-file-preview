/** DrawingML basics shared by the slide renderer: theme colours and fonts, colour modifiers,
 *  fills and outlines. Colours resolve to CSS strings. */
import { applyColorMods, cssOf, hslToRgb, parseHex, toHex } from './color.ts'
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
  const base = hex ? parseHex(hex) : null
  if (!base) return null
  const mods = kids(el).map((m) => ({ name: m.localName, val: num(m, 'val', 0) ?? 0 }))
  return cssOf(applyColorMods(base, mods))
}

/** Hex (no #) of a resolved colour, for `phClr` substitution. */
export function hexOf(css: string | null): string | undefined {
  if (!css) return undefined
  if (css.startsWith('#')) return css.slice(1)
  const m = /rgba?\((\d+),(\d+),(\d+)/.exec(css)
  return m ? toHex(+m[1], +m[2], +m[3]) : undefined
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
