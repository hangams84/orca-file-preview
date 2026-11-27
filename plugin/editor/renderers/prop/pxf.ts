/** EPLAN macros (.ema window macros, .emp page macros): PXF, an XML serialisation of EPLAN objects whose
 *  element and attribute names are numbers. Each `MacroVariant` (representation type × variant) carries its
 *  graphics inline:
 *
 *    O31 line         A531 start, A532 end ("x/y", mm, y up)
 *    O32 arc/circle   A555 centre, A556 "rx/ry" (ry 0: circle), A553 start and A554 end angle (radians, CCW)
 *    O34 curve        A621 four points "x/y;…": a cubic Bézier segment
 *    O30 text         A501 position, A511 multilingual text, child S54x505 A961 height (mm)
 *    O89 rectangle    A1651 / A1652 corners
 *    O17 function     a device placed from a symbol library; its symbol graphics live in the library, not
 *                     the macro (only a black box outline S89x5, relative to S40x1201 A762, is drawn)
 *    A414             line width (mm, "L" = from the layer)
 *
 *  The meaning of the numbers was read from public part data (Bachmann EDZ, 25 macros, 60k primitives; see
 *  docs/evidence/companions-eng/README.md). Symbols, layers, colours and fonts are not resolved. */
import { pickLang } from './eplan.ts'

export type PxfPrim =
  | { k: 'line'; a: [number, number]; b: [number, number]; w: number }
  | { k: 'arc'; c: [number, number]; rx: number; ry: number; a0: number; a1: number; w: number }
  | { k: 'bez'; p: [number, number][]; w: number }
  | { k: 'text'; at: [number, number]; text: string; h: number }
  | { k: 'rect'; a: [number, number]; b: [number, number]; w: number; dashed?: boolean }

export interface PxfVariant {
  funcType: string
  variantId: string
  description: string
  area?: [number, number, number, number]
  prims: PxfPrim[]
  /** Devices placed from symbol libraries (graphics not in the macro). */
  symbols: number
}

export interface PxfMacro {
  name: string
  type: string
  version: string
  description: string
  variants: PxfVariant[]
}

const attr = (s: string, n: string): string | undefined => {
  const m = new RegExp(`\\s${n}="([^"]*)"`).exec(s)
  return m ? m[1] : undefined
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function pt(s: string | undefined): [number, number] | null {
  if (!s) return null
  const [x, y] = s.split('/').map(Number)
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e7 && Math.abs(y) < 1e7 ? [x, y] : null
}

const width = (tag: string) => {
  const w = Number(attr(tag, 'A414'))
  return Number.isFinite(w) && w > 0 && w < 10 ? w : 0.25
}

export function isPxf(head: string): boolean {
  return /<EplanPxfRoot\b/.test(head)
}

/** Reads every variant's graphics. `korean` picks the text language. Limits: 400k primitives. */
export function parsePxf(text: string, korean = false): PxfMacro {
  const root = /<EplanPxfRoot\b([^>]*)>/.exec(text)
  if (!root) throw new Error('not an EPLAN PXF file')
  const macro: PxfMacro = {
    name: unxml(attr(root[1], 'Name') ?? ''),
    type: attr(root[1], 'Type') ?? '',
    version: attr(root[1], 'Version') ?? '',
    description: unxml(attr(root[1], 'Description') ?? ''),
    variants: []
  }
  const starts: number[] = []
  const re = /<MacroVariant\b/g
  for (let m = re.exec(text); m; m = re.exec(text)) starts.push(m.index)
  // A file without variants (an .emp page macro, older PXF) is one variant.
  if (!starts.length) starts.push(root.index)
  let total = 0
  starts.forEach((s, i) => {
    const body = text.slice(s, i + 1 < starts.length ? starts[i + 1] : text.length)
    const head = /^<MacroVariant\b([^>]*)>/.exec(body)?.[1] ?? ''
    const area = attr(head, 'SelectionArea')?.split('/').map(Number)
    const v: PxfVariant = {
      funcType: attr(head, 'MacroFuncType') ?? '',
      variantId: attr(head, 'VariantId') ?? '',
      description: unxml(attr(head, 'Description') ?? ''),
      area: area && area.length === 4 && area.every(Number.isFinite) ? (area as [number, number, number, number]) : undefined,
      prims: [],
      symbols: 0
    }
    const tag = /<(O\d+|S40x1201|S89x5|S54x505)\b([^>]*)>/g
    let lastText: Extract<PxfPrim, { k: 'text' }> | null = null
    let fnAt: [number, number] | null = null
    for (let m = tag.exec(body); m && total < 400_000; m = tag.exec(body)) {
      const t = m[2]
      switch (m[1]) {
        case 'O31': {
          const a = pt(attr(t, 'A531'))
          const b = pt(attr(t, 'A532'))
          if (a && b) v.prims.push({ k: 'line', a, b, w: width(t) })
          break
        }
        case 'O32': {
          const c = pt(attr(t, 'A555'))
          const r = pt(attr(t, 'A556'))
          const a0 = Number(attr(t, 'A553') ?? 0)
          const a1 = Number(attr(t, 'A554') ?? Math.PI * 2)
          if (c && r && r[0] > 0) v.prims.push({ k: 'arc', c, rx: r[0], ry: r[1] > 0 ? r[1] : r[0], a0: Number.isFinite(a0) ? a0 : 0, a1: Number.isFinite(a1) ? a1 : Math.PI * 2, w: width(t) })
          break
        }
        case 'O34': {
          const p = (attr(t, 'A621') ?? '').split(';').map(pt).filter((x): x is [number, number] => !!x)
          if (p.length >= 2) v.prims.push({ k: 'bez', p, w: width(t) })
          break
        }
        case 'O30': {
          const at = pt(attr(t, 'A501'))
          const raw = unxml(attr(t, 'A511') ?? '')
          const txt = pickLang(raw, korean).trim()
          lastText = at && txt ? { k: 'text', at, text: txt, h: 2.5 } : null
          if (lastText) v.prims.push(lastText)
          break
        }
        case 'S54x505': {
          const hgt = Number(attr(t, 'A961'))
          if (lastText && Number.isFinite(hgt) && hgt > 0 && hgt < 100) lastText.h = hgt
          lastText = null
          break
        }
        case 'O89': {
          const a = pt(attr(t, 'A1651'))
          const b = pt(attr(t, 'A1652'))
          if (a && b) v.prims.push({ k: 'rect', a, b, w: width(t) })
          break
        }
        case 'O17':
          v.symbols++
          fnAt = null
          break
        case 'S40x1201':
          fnAt = pt(attr(t, 'A762'))
          break
        case 'S89x5': {
          // A device's black box outline, relative to its placement.
          const a = pt(attr(t, 'A1651'))
          const b = pt(attr(t, 'A1652'))
          if (a && b && fnAt) v.prims.push({ k: 'rect', a: [fnAt[0] + a[0], fnAt[1] + a[1]], b: [fnAt[0] + b[0], fnAt[1] + b[1]], w: 0.25, dashed: true })
          break
        }
      }
      if (m[1] !== 'O30' && m[1] !== 'S54x505') lastText = null
      total++
    }
    macro.variants.push(v)
  })
  return macro
}

export interface Bounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function pxfBounds(v: PxfVariant): Bounds | null {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const add = (x: number, y: number) => {
    b.x0 = Math.min(b.x0, x)
    b.y0 = Math.min(b.y0, y)
    b.x1 = Math.max(b.x1, x)
    b.y1 = Math.max(b.y1, y)
  }
  for (const p of v.prims) {
    if (p.k === 'line' || p.k === 'rect') {
      add(...p.a)
      add(...p.b)
    } else if (p.k === 'arc') {
      add(p.c[0] - p.rx, p.c[1] - p.ry)
      add(p.c[0] + p.rx, p.c[1] + p.ry)
    } else if (p.k === 'bez') for (const q of p.p) add(...q)
    else {
      add(...p.at)
      add(p.at[0] + p.h * 0.6 * p.text.length, p.at[1] + p.h)
    }
  }
  return Number.isFinite(b.x0) ? b : null
}

const f = (n: number) => (Math.round(n * 1000) / 1000).toString()
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** SVG markup (world units mm, y flipped so that EPLAN's y-up reads correctly). Classes: `px` strokes,
 *  `pd` dashed strokes, `pt` text. */
export function pxfSvg(v: PxfVariant): string {
  const byWidth = new Map<number, string[]>()
  const dashed: string[] = []
  const texts: string[] = []
  const push = (w: number, d: string) => {
    const k = Math.round(w * 100) / 100
    if (!byWidth.has(k)) byWidth.set(k, [])
    byWidth.get(k)!.push(d)
  }
  const Y = (y: number) => -y
  for (const p of v.prims) {
    switch (p.k) {
      case 'line':
        push(p.w, `M${f(p.a[0])} ${f(Y(p.a[1]))}L${f(p.b[0])} ${f(Y(p.b[1]))}`)
        break
      case 'rect': {
        const d = `M${f(p.a[0])} ${f(Y(p.a[1]))}H${f(p.b[0])}V${f(Y(p.b[1]))}H${f(p.a[0])}Z`
        if (p.dashed) dashed.push(d)
        else push(p.w, d)
        break
      }
      case 'bez':
        if (p.p.length === 4) push(p.w, `M${f(p.p[0][0])} ${f(Y(p.p[0][1]))}C${p.p.slice(1).map((q) => `${f(q[0])} ${f(Y(q[1]))}`).join(' ')}`)
        else push(p.w, `M${p.p.map((q) => `${f(q[0])} ${f(Y(q[1]))}`).join('L')}`)
        break
      case 'arc': {
        let sweep = p.a1 - p.a0
        while (sweep <= 0) sweep += Math.PI * 2
        if (sweep > Math.PI * 2 - 1e-6) {
          push(p.w, `M${f(p.c[0] + p.rx)} ${f(Y(p.c[1]))}A${f(p.rx)} ${f(p.ry)} 0 1 0 ${f(p.c[0] - p.rx)} ${f(Y(p.c[1]))}A${f(p.rx)} ${f(p.ry)} 0 1 0 ${f(p.c[0] + p.rx)} ${f(Y(p.c[1]))}`)
          break
        }
        const sx = p.c[0] + p.rx * Math.cos(p.a0)
        const sy = p.c[1] + p.ry * Math.sin(p.a0)
        const ex = p.c[0] + p.rx * Math.cos(p.a0 + sweep)
        const ey = p.c[1] + p.ry * Math.sin(p.a0 + sweep)
        // CCW in y-up is clockwise once y is flipped: SVG sweep flag 0.
        push(p.w, `M${f(sx)} ${f(Y(sy))}A${f(p.rx)} ${f(p.ry)} 0 ${sweep > Math.PI ? 1 : 0} 0 ${f(ex)} ${f(Y(ey))}`)
        break
      }
      case 'text':
        texts.push(`<text class="pt" x="${f(p.at[0])}" y="${f(Y(p.at[1]))}" font-size="${f(p.h)}">${esc(p.text)}</text>`)
        break
    }
  }
  let out = ''
  for (const [w, ds] of byWidth) out += `<path class="px" stroke-width="${f(w)}" d="${ds.join('')}"/>`
  if (dashed.length) out += `<path class="pd" stroke-width="0.25" stroke-dasharray="2 1 0.4 1" d="${dashed.join('')}"/>`
  return out + texts.join('')
}

/** Representation types seen in macros (EPLAN's "representation type" numbers). */
export function variantLabel(v: PxfVariant, tr: (ko: string, en: string) => string): string {
  const letter = String.fromCharCode(65 + (Number(v.variantId) % 26 || 0))
  return `${tr('표현 형식', 'Representation')} ${v.funcType} · ${tr('변형', 'variant')} ${letter}${v.description ? ` · ${v.description}` : ''}`
}
