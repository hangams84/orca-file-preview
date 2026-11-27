/** Custom drawing sheets (.kicad_wks, and the older `page_layout` files): lines, rectangles, texts and
 *  polygons placed from a page corner inside the margins, with repeat/increment, page-1-only options and
 *  KiCad's text variables (${TITLE}, %T …). Bitmaps are not drawn. */
import type { Pt } from './font.ts'
import type { Layer } from './scene.ts'
import type { Paper, TitleBlock } from './sheet.ts'
import { child, children, head, isList, num, str, type SList, type SNode } from './sexpr.ts'

export interface WksSetup {
  textW: number
  textH: number
  lineWidth: number
  textLineWidth: number
  left: number
  right: number
  top: number
  bottom: number
}

type Corner = 'ltcorner' | 'lbcorner' | 'rbcorner' | 'rtcorner'

export function isWorksheet(root: SList): boolean {
  const k = head(root)
  return k === 'kicad_wks' || k === 'page_layout'
}

export function wksSetup(root: SList): WksSetup {
  const s = child(root, 'setup')
  const ts = child(s, 'textsize')
  return {
    textW: num(ts?.[1], 1.5),
    textH: num(ts?.[2], 1.5),
    lineWidth: num(child(s, 'linewidth')?.[1], 0.15),
    textLineWidth: num(child(s, 'textlinewidth')?.[1], 0.15),
    left: num(child(s, 'left_margin')?.[1], 10),
    right: num(child(s, 'right_margin')?.[1], 10),
    top: num(child(s, 'top_margin')?.[1], 10),
    bottom: num(child(s, 'bottom_margin')?.[1], 10)
  }
}

/** The values KiCad substitutes in drawing-sheet texts. */
export interface WksVars {
  paper: Paper
  tb: TitleBlock
  sheetName?: string
  sheetPath?: string
  file?: string
  page?: string
  pages?: string
  /** Project text variables (.kicad_pro `text_variables`). */
  project?: Record<string, string>
}

export function expandWksText(text: string, v: WksVars): string {
  const named: Record<string, string> = {
    TITLE: v.tb.title,
    ISSUE_DATE: v.tb.date,
    REVISION: v.tb.rev,
    COMPANY: v.tb.company,
    KICAD_VERSION: 'KiCad E.D.A.',
    '#': v.page ?? '1',
    '##': v.pages ?? '1',
    SHEETNAME: v.sheetName ?? '',
    SHEETPATH: v.sheetPath ?? '/',
    FILENAME: v.file ?? '',
    PAPER: v.paper.name,
    LAYER: ''
  }
  for (let i = 0; i < 9; i++) named[`COMMENT${i + 1}`] = v.tb.comments[i] ?? ''
  let out = text.replace(/\$\{([^}]+)\}/g, (m, k: string) => named[k] ?? v.project?.[k] ?? m)
  // The pre-6 format letters.
  out = out.replace(/%(C[0-9]|[TDRYSNFPZKL])/g, (m, k: string) => {
    if (k[0] === 'C' && k.length === 2) return v.tb.comments[Number(k[1])] ?? ''
    const map: Record<string, string> = { T: named.TITLE, D: named.ISSUE_DATE, R: named.REVISION, Y: named.COMPANY, S: named['#'], N: named['##'], F: named.FILENAME, P: named.SHEETPATH, Z: named.PAPER, K: named.KICAD_VERSION, L: '' }
    return map[k] ?? m
  })
  return out
}

function corner(n: SList | undefined): Corner {
  for (const x of n ?? []) if (x === 'ltcorner' || x === 'lbcorner' || x === 'rbcorner' || x === 'rtcorner') return x
  return 'rbcorner'
}

/** Labels like "1", "A" advance by `n` per repeat. */
export function incrementLabel(text: string, n: number): string {
  if (/^-?\d+$/.test(text)) return String(Number(text) + n)
  if (/^[A-Za-z]$/.test(text)) {
    const base = text <= 'Z' ? 65 : 97
    return String.fromCharCode(base + ((((text.charCodeAt(0) - base + n) % 26) + 26) % 26))
  }
  return text
}

/** Draws the sheet on `L`. `page1` decides `page1only` / `notonpage1` items. Returns the item count. */
export function drawWorksheet(L: Layer, root: SList, vars: WksVars, page1 = true): number {
  const s = wksSetup(root)
  const { w, h } = vars.paper
  const x0 = s.left
  const y0 = s.top
  const x1 = w - s.right
  const y1 = h - s.bottom
  // Corner-relative to page coordinates (KiCad: rb = from the bottom-right, x leftwards, y upwards).
  const at = (x: number, y: number, c: Corner): Pt => {
    switch (c) {
      case 'ltcorner':
        return [x0 + x, y0 + y]
      case 'lbcorner':
        return [x0 + x, y1 - y]
      case 'rtcorner':
        return [x1 - x, y0 + y]
      default:
        return [x1 - x, y1 - y]
    }
  }
  const inside = (p: Pt) => p[0] >= x0 - 0.01 && p[0] <= x1 + 0.01 && p[1] >= y0 - 0.01 && p[1] <= y1 + 0.01
  let count = 0
  for (const it of root) {
    if (!isList(it)) continue
    const kind = head(it)
    if (kind !== 'line' && kind !== 'rect' && kind !== 'tbtext' && kind !== 'polygon') continue
    const opt = child(it, 'option')
    if (opt?.includes('page1only') && !page1) continue
    if (opt?.includes('notonpage1') && page1) continue
    const repeat = Math.min(Math.max(1, num(child(it, 'repeat')?.[1], 1)), 500)
    const ix = num(child(it, 'incrx')?.[1], 0)
    const iy = num(child(it, 'incry')?.[1], 0)
    const lw = num(child(it, 'linewidth')?.[1], 0) || (kind === 'tbtext' ? s.textLineWidth : s.lineWidth)
    if (kind === 'line' || kind === 'rect') {
      const st = child(it, 'start')
      const en = child(it, 'end')
      const sc = corner(st)
      const ec = corner(en)
      for (let i = 0; i < repeat; i++) {
        const a = at(num(st?.[1]) + ix * i, num(st?.[2]) + iy * i, sc)
        const b = at(num(en?.[1]) + ix * i, num(en?.[2]) + iy * i, ec)
        if (i > 0 && (!inside(a) || !inside(b))) break
        if (kind === 'line') L.seg(a[0], a[1], b[0], b[1], lw)
        else
          L.line(
            [
              [a[0], a[1]],
              [b[0], a[1]],
              [b[0], b[1]],
              [a[0], b[1]]
            ],
            lw,
            true
          )
        count++
      }
    } else if (kind === 'tbtext') {
      const raw = str(it[1])
      const pos = child(it, 'pos')
      const c = corner(pos)
      const font = child(it, 'font')
      const size = child(font, 'size')
      const tw = num(size?.[1], s.textW)
      const th = num(size?.[2], s.textH)
      const bold = !!font?.includes('bold')
      const italic = !!font?.includes('italic')
      const just = child(it, 'justify') ?? []
      const hj = just.includes('center') ? 'center' : just.includes('right') ? 'right' : 'left'
      const vj = just.includes('top') ? 'top' : just.includes('bottom') ? 'bottom' : 'center'
      const angle = num(child(it, 'rotate')?.[1], 0)
      const incrLabel = num(child(it, 'incrlabel')?.[1], 1)
      const thick = num(font && child(font, 'linewidth')?.[1], 0) || (bold ? Math.max(lw, th / 5) : lw)
      for (let i = 0; i < repeat; i++) {
        const p = at(num(pos?.[1]) + ix * i, num(pos?.[2]) + iy * i, c)
        if (i > 0 && !inside(p)) break
        const label = repeat > 1 ? incrementLabel(raw, incrLabel * i) : raw
        const text = expandWksText(label, vars)
        if (text) L.text(text, p[0], p[1], { size: [tw, th], thickness: thick, h: hj, v: vj, angle, italic })
        count++
      }
    } else {
      // polygon: (pos x y corner) (rotate a) (pts (xy …)) — points relative to pos, y down.
      const pos = child(it, 'pos')
      const c = corner(pos)
      const rot = (num(child(it, 'rotate')?.[1], 0) * Math.PI) / 180
      const outlines = children(it, 'pts')
      for (let i = 0; i < repeat; i++) {
        const o = at(num(pos?.[1]) + ix * i, num(pos?.[2]) + iy * i, c)
        if (i > 0 && !inside(o)) break
        for (const pts of outlines) {
          const poly: Pt[] = []
          for (const xy of children(pts, 'xy')) {
            const x = num(xy[1])
            const y = num(xy[2])
            poly.push([o[0] + x * Math.cos(rot) + y * Math.sin(rot), o[1] - x * Math.sin(rot) + y * Math.cos(rot)])
          }
          if (poly.length > 2) L.fill(poly)
        }
        count++
      }
    }
  }
  return count
}

export type { SNode }
