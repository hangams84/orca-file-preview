/** AutoCAD Color Index (ACI) → 0xRRGGBB. Colours 10–249 are 24 hues in 15° steps, each at five
 *  brightness levels (255, 165, 127, 76, 38) in full and half saturation; 250–255 are greys. */
const BASIC = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0]
const GREYS = [0x333333, 0x505050, 0x696969, 0x828282, 0xbebebe, 0xffffff]
const LEVELS = [255, 165, 127, 76, 38]

function hsv(hueDeg: number, sat: number, v: number): number {
  const lo = v * (1 - sat)
  const sector = Math.floor(hueDeg / 60) % 6
  const f = (hueDeg % 60) / 60
  const up = lo + (v - lo) * f
  const down = lo + (v - lo) * (1 - f)
  const [r, g, b] = [
    [v, up, lo],
    [down, v, lo],
    [lo, v, up],
    [lo, down, v],
    [up, lo, v],
    [v, lo, down]
  ][sector]
  return (Math.floor(r) << 16) | (Math.floor(g) << 8) | Math.floor(b)
}

export const ACI: number[] = (() => {
  const t = new Array<number>(256)
  for (let i = 0; i < 10; i++) t[i] = BASIC[i]
  for (let i = 10; i < 250; i++) {
    const k = i - 10
    const hue = Math.floor(k / 10) * 15
    const level = LEVELS[Math.floor((k % 10) / 2)]
    t[i] = hsv(hue, k % 2 ? 0.5 : 1, level)
  }
  for (let i = 250; i < 256; i++) t[i] = GREYS[i - 250]
  return t
})()

/** 7 (white/black) and 255-ish whites are drawn in the foreground colour by the caller. */
export function aciColor(i: number): number {
  return ACI[Math.abs(i) & 255] ?? 0xffffff
}
