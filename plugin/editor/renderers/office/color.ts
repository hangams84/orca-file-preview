/** DrawingML colour transforms (ECMA-376 §20.1.2.3), done the way Office renders them:
 *  `tint`/`shade` (and the explicit component mods) work on linear RGB (scRGB), `lum*`, `sat*` and
 *  `hue*` on HSL of the sRGB colour, `alpha*` on opacity. Pure functions, no DOM. */

export interface Rgba {
  /** sRGB components 0..255 (may be fractional until output). */
  r: number
  g: number
  b: number
  /** Opacity 0..1. */
  a: number
}

/** One modifier element: its local name and `val` in 1/1000 % (100000 = 100 %). */
export interface ColorMod {
  name: string
  val: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export function linearToSrgb(l: number): number {
  const v = clamp01(l)
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

export function hslToRgb(hh: number, s: number, l: number): [number, number, number] {
  hh = ((hh % 1) + 1) % 1
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

/** Applies modifiers in document order. */
export function applyColorMods(base: Rgba, mods: ColorMod[]): Rgba {
  let { r, g, b, a } = base
  const hsl = (fn: (h: number, s: number, l: number) => [number, number, number]) => {
    const [h0, s0, l0] = rgbToHsl(r, g, b)
    const [h1, s1, l1] = fn(h0, s0, l0)
    ;[r, g, b] = hslToRgb(h1, clamp01(s1), clamp01(l1))
  }
  const lin = (fn: (c: number) => number) => {
    r = linearToSrgb(fn(srgbToLinear(r)))
    g = linearToSrgb(fn(srgbToLinear(g)))
    b = linearToSrgb(fn(srgbToLinear(b)))
  }
  const channel = (which: 'r' | 'g' | 'b', fn: (c: number) => number) => {
    const v = linearToSrgb(fn(srgbToLinear(which === 'r' ? r : which === 'g' ? g : b)))
    if (which === 'r') r = v
    else if (which === 'g') g = v
    else b = v
  }
  for (const { name, val } of mods) {
    const v = val / 100000
    switch (name) {
      case 'tint':
        lin((c) => c * v + (1 - v))
        break
      case 'shade':
        lin((c) => c * v)
        break
      case 'lumMod':
        hsl((h, s, l) => [h, s, l * v])
        break
      case 'lumOff':
        hsl((h, s, l) => [h, s, l + v])
        break
      case 'lum':
        hsl((h, s) => [h, s, v])
        break
      case 'satMod':
        hsl((h, s, l) => [h, s * v, l])
        break
      case 'satOff':
        hsl((h, s, l) => [h, s + v, l])
        break
      case 'sat':
        hsl((h, _s, l) => [h, v, l])
        break
      case 'hueMod':
        hsl((h, s, l) => [h * v, s, l])
        break
      case 'hueOff':
        // val is in 1/60000 degree
        hsl((h, s, l) => [h + val / 60000 / 360, s, l])
        break
      case 'hue':
        hsl((_h, s, l) => [val / 60000 / 360, s, l])
        break
      case 'alpha':
        a = clamp01(v)
        break
      case 'alphaMod':
        a = clamp01(a * v)
        break
      case 'alphaOff':
        a = clamp01(a + v)
        break
      case 'redMod':
        channel('r', (c) => c * v)
        break
      case 'greenMod':
        channel('g', (c) => c * v)
        break
      case 'blueMod':
        channel('b', (c) => c * v)
        break
      case 'redOff':
        channel('r', (c) => c + v)
        break
      case 'greenOff':
        channel('g', (c) => c + v)
        break
      case 'blueOff':
        channel('b', (c) => c + v)
        break
      case 'gray': {
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = g = b = y
        break
      }
      case 'inv':
        r = 255 - r
        g = 255 - g
        b = 255 - b
        break
      case 'comp':
        hsl((h, s, l) => [h + 0.5, s, l])
        break
    }
  }
  return { r, g, b, a }
}

export function toHex(r: number, g: number, b: number): string {
  return [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

/** CSS colour (`#rrggbb` or `rgba()`). */
export function cssOf(c: Rgba): string {
  const R = Math.round(Math.min(255, Math.max(0, c.r)))
  const G = Math.round(Math.min(255, Math.max(0, c.g)))
  const B = Math.round(Math.min(255, Math.max(0, c.b)))
  return c.a < 1 ? `rgba(${R},${G},${B},${Number(c.a.toFixed(3))})` : `#${toHex(R, G, B)}`
}

export function parseHex(hex: string): Rgba | null {
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 }
}
