/** Page frame and title block, laid out like KiCad's default drawing sheet (approximation:
 *  10 mm margins, 50 mm grid references, the 110 × 34 mm title block in the bottom right). */
import type { Layer } from './scene.ts'
import { child, children, num, str, type SList } from './sexpr.ts'

const PAPER: Record<string, [number, number]> = {
  A5: [210, 148],
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
  A: [279.4, 215.9],
  B: [431.8, 279.4],
  C: [558.8, 431.8],
  D: [863.6, 558.8],
  E: [1117.6, 863.6],
  USLetter: [279.4, 215.9],
  USLegal: [355.6, 215.9],
  USLedger: [431.8, 279.4],
  GERBER: [812.8, 812.8]
}

export interface Paper {
  name: string
  w: number
  h: number
}

export function paperOf(root: SList): Paper {
  const p = child(root, 'paper')
  const name = str(p?.[1], 'A4')
  let [w, h] = PAPER[name] ?? PAPER.A4
  if (name === 'User') {
    w = num(p?.[2], 297)
    h = num(p?.[3], 210)
  }
  if (p && p.includes('portrait')) [w, h] = [Math.min(w, h), Math.max(w, h)]
  return { name, w, h }
}

export interface TitleBlock {
  title: string
  date: string
  rev: string
  company: string
  comments: string[]
}

export function titleBlockOf(root: SList): TitleBlock {
  const tb = child(root, 'title_block')
  const comments: string[] = []
  for (const c of children(tb, 'comment')) comments[num(c[1]) - 1] = str(c[2])
  return {
    title: str(child(tb, 'title')?.[1]),
    date: str(child(tb, 'date')?.[1]),
    rev: str(child(tb, 'rev')?.[1]),
    company: str(child(tb, 'company')?.[1]),
    comments
  }
}

export function drawSheet(L: Layer, paper: Paper, tb: TitleBlock, extra: { sheet?: string; file?: string } = {}): void {
  const { w, h } = paper
  const m = 10
  const lw = 0.15
  const ts = { size: [1.5, 1.5] as [number, number], thickness: 0.15, h: 'left' as const, v: 'center' as const }
  L.line(
    [
      [m, m],
      [w - m, m],
      [w - m, h - m],
      [m, h - m]
    ],
    lw,
    true
  )
  L.line(
    [
      [m + 2, m + 2],
      [w - m - 2, m + 2],
      [w - m - 2, h - m - 2],
      [m + 2, h - m - 2]
    ],
    lw,
    true
  )
  // Grid references: numbers along the top and bottom, letters down the sides.
  const step = 50
  const cts = { ...ts, size: [1.3, 1.3] as [number, number], h: 'center' as const }
  for (let i = 0, x = m; x < w - m - 1; i++, x += step) {
    if (i > 0) {
      L.seg(x, m, x, m + 2, lw)
      L.seg(x, h - m, x, h - m - 2, lw)
    }
    const cx = Math.min(x + step / 2, (x + w - m) / 2)
    L.text(String(i + 1), cx, m + 1, cts)
    L.text(String(i + 1), cx, h - m - 1, cts)
  }
  for (let i = 0, y = m; y < h - m - 1; i++, y += step) {
    if (i > 0) {
      L.seg(m, y, m + 2, y, lw)
      L.seg(w - m, y, w - m - 2, y, lw)
    }
    const cy = Math.min(y + step / 2, (y + h - m) / 2)
    const letter = String.fromCharCode(65 + (i % 26))
    L.text(letter, m + 1, cy, cts)
    L.text(letter, w - m - 1, cy, cts)
  }
  // Title block, positions measured from the inner bottom-right corner like KiCad's .kicad_wks.
  const rx = w - m
  const ry = h - m
  const X = (dx: number) => rx - dx
  const Y = (dy: number) => ry - dy
  L.line(
    [
      [X(110), Y(34)],
      [X(2), Y(34)],
      [X(2), Y(2)],
      [X(110), Y(2)]
    ],
    lw,
    true
  )
  for (const dy of [5.5, 8.5, 12.5, 18.5]) L.seg(X(110), Y(dy), X(2), Y(dy), lw)
  L.seg(X(90), Y(8.5), X(90), Y(5.5), lw)
  L.seg(X(26), Y(8.5), X(26), Y(2), lw)
  L.text(`Date: ${tb.date}`, X(87), Y(6.9), ts)
  L.text(`Rev: ${tb.rev}`, X(24), Y(6.9), { ...ts, thickness: 0.3 })
  L.text(`Size: ${paper.name}`, X(109), Y(6.9), ts)
  L.text('KiCad E.D.A.', X(109), Y(4.1), ts)
  L.text('Id: 1/1', X(24), Y(4.1), ts)
  L.text(`Title: ${tb.title}`, X(109), Y(10.7), { ...ts, size: [2, 2], thickness: 0.4 })
  L.text(`File: ${extra.file ?? ''}`, X(109), Y(14.3), ts)
  L.text(`Sheet: ${extra.sheet ?? '/'}`, X(109), Y(17), ts)
  L.text(tb.company, X(109), Y(20), { ...ts, thickness: 0.3 })
  for (let i = 0; i < 4; i++) if (tb.comments[i]) L.text(tb.comments[i], X(109), Y(23 + 3 * i), ts)
}
