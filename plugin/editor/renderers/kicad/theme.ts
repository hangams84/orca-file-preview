/** Colours for the KiCad views. Light schematic colours follow KiCad's built-in default theme;
 *  the board colours follow KiCad's default PCB theme (dark) and a print-like light variant. */
import type { ThemeName } from '../../core/types.ts'

export const SCH_COLORS: Record<ThemeName, Record<string, string>> = {
  light: {
    background: '#f5f4ef',
    wire: '#009600',
    bus: '#000084',
    junction: '#009600',
    nc: '#000084',
    body: '#840000',
    bodyfill: '#ffffc2',
    pin: '#840000',
    pinname: '#006464',
    pinnum: '#a90000',
    ref: '#006464',
    value: '#006464',
    field: '#840084',
    label: '#0f0f0f',
    glabel: '#840000',
    hlabel: '#725600',
    netclass: '#484848',
    note: '#0000c2',
    sheet: '#840000',
    sheetfill: 'rgba(255,255,255,0)',
    sheetname: '#006464',
    sheetfile: '#725600',
    sheetpin: '#006464',
    border: '#840000',
    hl: '#0a84ff'
  },
  dark: {
    background: '#15181d',
    wire: '#4ec94e',
    bus: '#6f8fff',
    junction: '#4ec94e',
    nc: '#8fa3ff',
    body: '#e06a62',
    bodyfill: '#2b2a22',
    pin: '#e06a62',
    pinname: '#4cc9c9',
    pinnum: '#ff8a80',
    ref: '#4cc9c9',
    value: '#4cc9c9',
    field: '#d58ad5',
    label: '#e8e8e8',
    glabel: '#ff7a70',
    hlabel: '#d9b85a',
    netclass: '#b0b0b0',
    note: '#8fa3ff',
    sheet: '#e06a62',
    sheetfill: 'rgba(0,0,0,0)',
    sheetname: '#4cc9c9',
    sheetfile: '#d9b85a',
    sheetpin: '#4cc9c9',
    border: '#a35a55',
    hl: '#ffd60a'
  }
}

const DARK_PCB: Record<string, string> = {
  background: '#001023',
  'F.Cu': '#c83434',
  'B.Cu': '#4d7fc4',
  'In1.Cu': '#7fc87f',
  'In2.Cu': '#ce7d2c',
  'In3.Cu': '#4fcbcb',
  'In4.Cu': '#db6ea0',
  'In5.Cu': '#a8a26b',
  'In6.Cu': '#7c6ad8',
  'F.SilkS': '#f2eda1',
  'B.SilkS': '#e8b2a7',
  'F.Mask': '#d864ff',
  'B.Mask': '#02ffee',
  'F.Paste': '#b4a09a',
  'B.Paste': '#00c2c2',
  'F.Adhes': '#844584',
  'B.Adhes': '#0000c2',
  'Edge.Cuts': '#d0d2cd',
  Margin: '#ff26e2',
  'F.CrtYd': '#ff26e2',
  'B.CrtYd': '#26e9ff',
  'F.Fab': '#afafaf',
  'B.Fab': '#585d84',
  'Dwgs.User': '#c2c2c2',
  'Cmts.User': '#5994dc',
  'Eco1.User': '#b4dbd2',
  'Eco2.User': '#d8c852',
  user: '#c2c2c2',
  hole: '#e3b72e',
  hl: '#ffffff'
}

const LIGHT_PCB: Record<string, string> = {
  background: '#fbfbf8',
  'F.Cu': '#c83434',
  'B.Cu': '#3a6fb8',
  'In1.Cu': '#3f9a3f',
  'In2.Cu': '#c06a14',
  'In3.Cu': '#1f9a9a',
  'In4.Cu': '#c0457e',
  'In5.Cu': '#7f7a30',
  'In6.Cu': '#5a48c0',
  'F.SilkS': '#4d4a1e',
  'B.SilkS': '#8a4f42',
  'F.Mask': '#a43fd0',
  'B.Mask': '#0aa59a',
  'F.Paste': '#8a7068',
  'B.Paste': '#008a8a',
  'F.Adhes': '#844584',
  'B.Adhes': '#0000c2',
  'Edge.Cuts': '#2a2a2a',
  Margin: '#c41aad',
  'F.CrtYd': '#c41aad',
  'B.CrtYd': '#1a9ab8',
  'F.Fab': '#6a6a6a',
  'B.Fab': '#4a5084',
  'Dwgs.User': '#555555',
  'Cmts.User': '#2f6fb8',
  'Eco1.User': '#3f8a7a',
  'Eco2.User': '#8a7a10',
  user: '#666666',
  hole: '#b88a10',
  hl: '#0a84ff'
}

const INNER_EXTRA = ['#7fc87f', '#ce7d2c', '#4fcbcb', '#db6ea0', '#a8a26b', '#7c6ad8']

export function pcbColor(theme: ThemeName, layer: string): string {
  const t = theme === 'light' ? LIGHT_PCB : DARK_PCB
  if (t[layer]) return t[layer]
  const m = /^In(\d+)\.Cu$/.exec(layer)
  if (m) return INNER_EXTRA[(Number(m[1]) - 1) % INNER_EXTRA.length]
  return t.user
}

/** Layer opacity like KiCad's defaults (masks and paste are translucent). */
export function pcbOpacity(layer: string): number | undefined {
  if (/\.Mask$/.test(layer)) return 0.4
  if (/\.Paste$/.test(layer)) return 0.8
  return undefined
}

/** CSS class for a layer name. */
export function layerClass(name: string): string {
  return 'L-' + name.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)
}

/** `(color r g b a)` → CSS colour, or undefined when all zero (KiCad: "use default"). */
export function kicadColor(r: number, g: number, b: number, a: number): string | undefined {
  if (!r && !g && !b && !a) return undefined
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`
}
