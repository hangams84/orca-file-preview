/** Draws a `Scene` view on a 2D canvas: paths as cached Path2D objects (arcs stay exact at any
 *  zoom), hatches as clipped fills and pattern lines, text with system fonts (so Hangul uses the
 *  platform's Korean font: Malgun Gothic, Apple SD Gothic Neo, Noto Sans KR/CJK), images, points,
 *  block references and paper-space viewports. Items off screen are culled by their cached extents. */
import {
  addPoint,
  apply,
  C,
  emptyBox,
  isEmpty,
  itemsBox,
  mul,
  P,
  pathBox,
  textBox,
  type Box,
  type HatchItem,
  type Item,
  type Mat,
  type PathItem,
  type Scene,
  type TextItem,
  type TextRun
} from './scene.ts'

export const FONT_STACK =
  '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Nanum Gothic", "Segoe UI", Arial, sans-serif'

export interface PaintOptions {
  /** Background and foreground colours (0xRRGGBB). */
  bg: number
  fg: number
  /** Device pixels per CSS pixel. */
  dpr: number
  /** Per scene layer: drawn or not. */
  layerOn: boolean[]
  /** Draw line weights (mm) wider than a hairline. */
  lineweights: boolean
  /** Canvas size in device pixels (for culling). */
  width: number
  height: number
}

interface Inherit {
  layer: number
  color: number
  lw: number
}

interface Cache {
  _b?: Box | null
  _p?: Path2D
  _p2?: Path2D
  _lay?: MLayout
}

type Ctx = CanvasRenderingContext2D

const BASE = 100 // text is drawn at a 100 px font, scaled by the transform

export function paintView(ctx: Ctx, scene: Scene, viewIndex: number, m: Mat, o: PaintOptions): void {
  const view = scene.views[viewIndex]
  if (!view) return
  const p = new Painter(ctx, scene, o)
  p.items(view.items, m, { layer: -1, color: C.FG, lw: 0 }, 0, null, viewIndex)
}

class Painter {
  private measure = new Map<string, number>()
  constructor(
    private ctx: Ctx,
    private scene: Scene,
    private o: PaintOptions
  ) {}

  items(items: Item[], m: Mat, inh: Inherit, depth: number, frozen: Set<number> | null, viewIndex: number): void {
    if (depth > 24) return
    const { o, scene } = this
    for (const it of items) {
      const layer = it.layer === -1 ? inh.layer : it.layer
      if (layer >= 0 && (o.layerOn[layer] === false || frozen?.has(layer))) continue
      if (!this.visible(it, m)) continue
      const color = this.color(it.color, inh, layer)
      const lw = it.lw < 0 ? inh.lw : it.lw
      switch (it.k) {
        case 'path':
          this.path(it, m, color, lw)
          break
        case 'hatch':
          this.hatch(it, m, color)
          break
        case 'text':
          this.text(it, m, color)
          break
        case 'point':
          this.point(it.x, it.y, m, color)
          break
        case 'image':
          this.image(it, m, color)
          break
        case 'ref': {
          const blk = scene.blocks.get(it.block)
          if (!blk) break
          this.items(blk.items, mul(m, it.m), { layer, color, lw }, depth + 1, frozen, viewIndex)
          break
        }
        case 'viewport': {
          if (it.view === viewIndex) break
          const src = scene.views[it.view]
          if (!src) break
          const ctx = this.ctx
          ctx.save()
          ctx.setTransform(...m)
          ctx.beginPath()
          if (it.clip) ctx.clip(toPath(it.clip))
          else {
            ctx.rect(it.cx - it.w / 2, it.cy - it.h / 2, it.w, it.h)
            ctx.clip()
          }
          const fz = it.frozen?.length ? new Set([...(frozen ?? []), ...it.frozen]) : frozen
          this.items(src.items, mul(m, it.m), { layer: -1, color: C.FG, lw: 0 }, depth + 1, fz, it.view)
          ctx.restore()
          // The viewport's frame, like CAD programs show it on screen.
          ctx.setTransform(...m)
          ctx.strokeStyle = css(color)
          ctx.lineWidth = this.lineWidth(m, 0)
          if (it.clip) ctx.stroke(toPath(it.clip))
          else ctx.strokeRect(it.cx - it.w / 2, it.cy - it.h / 2, it.w, it.h)
          break
        }
      }
    }
  }

  /** Cull by the item's cached extents in its own coordinates, mapped to the device. */
  private visible(it: Item, m: Mat): boolean {
    const c = it as Item & Cache
    if (c._b === undefined) {
      if (it.k === 'ref') {
        const blk = this.scene.blocks.get(it.block)
        if (!blk) return false
        if (blk.box === undefined) blk.box = itemsBox(this.scene, blk.items)
        const b = emptyBox()
        if (!isEmpty(blk.box)) {
          for (const [x, y] of [
            [blk.box!.x0, blk.box!.y0],
            [blk.box!.x1, blk.box!.y0],
            [blk.box!.x0, blk.box!.y1],
            [blk.box!.x1, blk.box!.y1]
          ])
            addPoint(b, ...apply(it.m, x, y))
        }
        c._b = isEmpty(b) ? null : b
      } else if (it.k === 'path') {
        const b = pathBox(it.d)
        if (it.width) grow(b, it.width / 2)
        c._b = isEmpty(b) ? null : b
      } else if (it.k === 'hatch') c._b = pathBox(it.boundary)
      else if (it.k === 'text') c._b = textBox(it)
      else c._b = null // points, images, viewports: always considered
    }
    const b = c._b
    if (b === null) return it.k !== 'path' && it.k !== 'hatch' && it.k !== 'ref'
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [x, y] of [
      [b.x0, b.y0],
      [b.x1, b.y0],
      [b.x0, b.y1],
      [b.x1, b.y1]
    ]) {
      const px = m[0] * x + m[2] * y + m[4]
      const py = m[1] * x + m[3] * y + m[5]
      if (px < x0) x0 = px
      if (px > x1) x1 = px
      if (py < y0) y0 = py
      if (py > y1) y1 = py
    }
    const pad = 4 * this.o.dpr
    return x1 >= -pad && y1 >= -pad && x0 <= this.o.width + pad && y0 <= this.o.height + pad
  }

  private color(c: number, inh: Inherit, layer: number): number {
    let v = c
    if (v === C.BYBLOCK) v = inh.color
    if (v === C.BYLAYER_INHERIT) v = layer >= 0 ? (this.scene.layers[layer]?.color ?? C.FG) : inh.color
    if (v === C.BYBLOCK || v === C.BYLAYER_INHERIT) v = C.FG
    if (v === C.FG) return this.o.fg
    if (v === C.BG) return this.o.bg
    return contrast(v, this.o.bg, this.o.fg)
  }

  private lineWidth(m: Mat, lwMm: number, world = 0): number {
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
    const hair = this.o.dpr
    const lwPx = this.o.lineweights && lwMm > 0.25 ? lwMm * (96 / 25.4) * 0.75 * this.o.dpr : 0
    const px = Math.max(hair, lwPx, world * s)
    return px / s
  }

  private path(it: PathItem, m: Mat, color: number, lw: number): void {
    const ctx = this.ctx
    const c = it as PathItem & Cache
    const path = (c._p ??= toPath(it.d))
    ctx.setTransform(...m)
    ctx.globalAlpha = it.alpha ?? 1
    if (it.fill) {
      ctx.fillStyle = css(it.fillColor !== undefined ? this.color(it.fillColor, { layer: it.layer, color, lw }, it.layer) : color)
      ctx.fill(path, it.evenOdd ? 'evenodd' : 'nonzero')
    }
    if (it.stroke) {
      ctx.strokeStyle = css(color)
      ctx.lineWidth = this.lineWidth(m, lw, it.width ?? 0)
      ctx.lineCap = it.cap ?? (it.width ? 'butt' : 'round')
      ctx.lineJoin = it.join ?? 'round'
      if (it.dash && it.dash.length) {
        const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
        let total = 0
        for (const v of it.dash) total += Math.abs(v)
        // Patterns smaller than a few pixels read as solid lines anyway (and are slow).
        if (total * s > 3 * this.o.dpr) {
          const minDot = (0.75 * this.o.dpr) / s
          ctx.setLineDash(it.dash.map((v, i) => (i % 2 === 0 ? Math.max(Math.abs(v), minDot) : Math.abs(v))))
          if (ctx.lineCap === 'round') ctx.lineCap = 'butt'
        }
      }
      ctx.stroke(path)
      ctx.setLineDash([])
    }
    ctx.globalAlpha = 1
  }

  private hatch(it: HatchItem, m: Mat, color: number): void {
    const ctx = this.ctx
    const c = it as HatchItem & Cache
    const boundary = (c._p ??= toPath(it.boundary))
    ctx.save()
    ctx.setTransform(...m)
    ctx.globalAlpha = it.alpha ?? 1
    if (it.solid) {
      ctx.fillStyle = css(color)
      ctx.fill(boundary, 'evenodd')
    } else if (it.lines && it.lines.length) {
      ctx.clip(boundary, 'evenodd')
      if (!c._p2) {
        const p = new Path2D()
        const l = it.lines
        for (let i = 0; i + 3 < l.length; i += 4) {
          p.moveTo(l[i], l[i + 1])
          p.lineTo(l[i + 2], l[i + 3])
        }
        c._p2 = p
      }
      ctx.strokeStyle = css(color)
      ctx.lineWidth = this.lineWidth(m, 0)
      ctx.lineCap = 'butt'
      ctx.stroke(c._p2)
    }
    ctx.restore()
  }

  private point(x: number, y: number, m: Mat, color: number): void {
    const ctx = this.ctx
    const [px, py] = apply(m, x, y)
    const r = this.o.dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = css(color)
    ctx.fillRect(px - r, py - r, r * 2, r * 2)
  }

  private image(it: Item & { k: 'image' }, m: Mat, color: number): void {
    const ctx = this.ctx
    // Unit square, image row 0 at the top (y = 1).
    const mm = mul(mul(m, it.m), [1, 0, 0, -1, 0, 1])
    ctx.setTransform(...mm)
    if (it.src) {
      ctx.globalAlpha = it.alpha ?? 1
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(it.src, 0, 0, 1, 1)
      ctx.globalAlpha = 1
      return
    }
    const s = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1
    ctx.strokeStyle = css(color)
    ctx.lineWidth = this.o.dpr / s
    ctx.setLineDash([(4 * this.o.dpr) / s, (3 * this.o.dpr) / s])
    ctx.strokeRect(0, 0, 1, 1)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(1, 1)
    ctx.moveTo(1, 0)
    ctx.lineTo(0, 1)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ---- text ----------------------------------------------------------------------------------

  private font(family: string | undefined, bold?: boolean, italic?: boolean): string {
    const fam = family ? `"${family.replace(/["\\]/g, '')}", ${FONT_STACK}` : FONT_STACK
    return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${BASE}px ${fam}`
  }

  private width(font: string, text: string): number {
    const key = font + '\u0000' + text
    let w = this.measure.get(key)
    if (w === undefined) {
      this.ctx.font = font
      w = this.ctx.measureText(text).width
      if (this.measure.size > 20000) this.measure.clear()
      this.measure.set(key, w)
    }
    return w
  }

  /** Local text frame (origin at the insertion point, x along the baseline, y up) → device. */
  private frame(t: TextItem, m: Mat, wf: number): Mat {
    const c = Math.cos(t.rot)
    const s = Math.sin(t.rot)
    let f: Mat = mul(m, [c, s, -s, c, t.x, t.y])
    if (t.mx || t.my) f = mul(f, [t.mx ? -1 : 1, 0, 0, t.my ? -1 : 1, 0, 0])
    if (t.obl) f = mul(f, [1, 0, Math.tan(t.obl), 1, 0, 0])
    if (wf !== 1) f = mul(f, [wf, 0, 0, 1, 0, 0])
    return f
  }

  private text(t: TextItem, m: Mat, color: number): void {
    const ctx = this.ctx
    const emScale = t.emScale ?? 1 / 0.7
    const em = t.h * emScale
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
    if (!(em * s >= 1.2 * this.o.dpr)) return // too small to read: skip (fast at overview zoom)
    ctx.fillStyle = css(color)
    ctx.strokeStyle = css(color)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.globalAlpha = t.alpha ?? 1
    if (t.paras) {
      this.mtext(t, m, color, emScale)
      ctx.globalAlpha = 1
      return
    }
    const font = this.font(t.family, t.bold, t.italic)
    ctx.font = font
    const text = t.text
    if (!text) return
    const w100 = t.advances ? 0 : this.width(font, text)
    let wf = t.wf ?? 1
    if (t.fitWidth && w100 > 0) wf = t.fitWidth / ((w100 * em) / BASE)
    const f = mul(this.frame(t, m, wf), [em / BASE, 0, 0, -em / BASE, 0, 0])
    ctx.setTransform(...f)
    const cap = BASE / emScale
    const ha = t.ha ?? 0
    const va = t.va ?? 0
    const dx = ha === 1 ? -w100 / 2 : ha === 2 ? -w100 : 0
    const dy = va === 3 ? cap : va === 2 ? cap / 2 : va === 1 ? -0.22 * BASE : 0
    if (t.advances) {
      const chars = Array.from(text)
      for (let i = 0; i < chars.length; i++) ctx.fillText(chars[i], (t.advances[i] ?? 0) * BASE, dy)
    } else ctx.fillText(text, dx, dy)
    if (t.underline || t.overline) {
      const w = t.advances ? (t.advances[t.advances.length - 1] ?? 0) * BASE + BASE * 0.5 : w100
      ctx.lineWidth = BASE * 0.06
      ctx.beginPath()
      if (t.underline) {
        ctx.moveTo(dx, dy + BASE * 0.12)
        ctx.lineTo(dx + w, dy + BASE * 0.12)
      }
      if (t.overline) {
        ctx.moveTo(dx, dy - cap * 1.25)
        ctx.lineTo(dx + w, dy - cap * 1.25)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  private mtext(t: TextItem, m: Mat, color: number, emScale: number): void {
    const ctx = this.ctx
    const c = t as TextItem & Cache
    const lay = (c._lay ??= this.layout(t, emScale))
    const f = this.frame(t, m, t.wf ?? 1)
    if (t.bgFill !== undefined) {
      ctx.setTransform(...f)
      ctx.fillStyle = css(t.bgFill === C.BG ? this.o.bg : contrast(t.bgFill, this.o.bg, this.o.fg))
      const pad = t.h * 0.3
      ctx.fillRect(lay.x0 - pad, lay.y0 - pad, lay.x1 - lay.x0 + pad * 2, lay.y1 - lay.y0 + pad * 2)
    }
    for (const g of lay.glyphs) {
      const em = g.h * emScale
      const ff = mul(f, [(em / BASE) * g.wf, 0, 0, -em / BASE, g.x, g.y])
      ctx.setTransform(...ff)
      ctx.font = g.font
      const col = g.color !== undefined ? css(this.color(g.color, { layer: t.layer, color, lw: 0 }, t.layer)) : css(color)
      ctx.fillStyle = col
      ctx.fillText(g.text, 0, 0)
      if (g.underline || g.overline || g.strike) {
        ctx.strokeStyle = col
        ctx.lineWidth = BASE * 0.06
        ctx.beginPath()
        const w = g.w / ((em / BASE) * g.wf)
        const cap = BASE / emScale
        for (const [on, y] of [
          [g.underline, BASE * 0.15],
          [g.overline, -cap * 1.3],
          [g.strike, -cap / 2]
        ] as [boolean | undefined, number][]) {
          if (!on) continue
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
        }
        ctx.stroke()
      }
    }
  }

  /** Lays out MTEXT paragraphs in the local text frame (y up, top-left of the block at 0,0 before
   *  the attachment shift). Long lines wrap at word boundaries, or anywhere in CJK text. */
  private layout(t: TextItem, emScale: number): MLayout {
    const wrap = t.wrap && t.wrap > 0 ? t.wrap * 1.0001 : Infinity
    const lines: { glyphs: MGlyph[]; width: number; h: number }[] = []
    for (const para of t.paras ?? []) {
      let line: { glyphs: MGlyph[]; width: number; h: number } = { glyphs: [], width: 0, h: 0 }
      const push = () => {
        lines.push(line)
        line = { glyphs: [], width: 0, h: 0 }
      }
      let any = false
      for (const run of para) {
        const h = run.h ?? t.h
        const em = h * emScale
        const wf = run.wf ?? 1
        const font = this.font(run.family ?? t.family, run.bold ?? t.bold, run.italic ?? t.italic)
        for (const piece of splitWords(run.text)) {
          const w = (this.width(font, piece) * em * wf) / BASE
          if (line.glyphs.length && line.width + w > wrap && !/^\s+$/.test(piece)) {
            // Trailing spaces do not count against the wrap width.
            push()
            if (/^\s+$/.test(piece)) continue
          }
          if (!line.glyphs.length && /^\s+$/.test(piece) && lines.length && any) continue
          line.glyphs.push({ text: piece, x: line.width, y: 0, w, h, wf, font, color: run.color, underline: run.underline, overline: run.overline, strike: run.strike })
          line.width += w
          line.h = Math.max(line.h, h)
          any = true
        }
      }
      if (!line.h) line.h = t.h
      push()
    }
    const a = t.attach ?? 1
    const col = (a - 1) % 3
    const row = Math.floor((a - 1) / 3)
    const spacing = (5 / 3) * (t.spacing ?? 1)
    let y = 0
    const glyphs: MGlyph[] = []
    let maxW = 0
    lines.forEach((ln, i) => {
      y -= i === 0 ? ln.h : ln.h * spacing
      maxW = Math.max(maxW, ln.width)
      const x0 = col === 1 ? -ln.width / 2 : col === 2 ? -ln.width : 0
      for (const g of ln.glyphs) glyphs.push({ ...g, x: g.x + x0, y })
    })
    const total = -y
    const dy = row === 0 ? 0 : row === 1 ? total / 2 : total
    for (const g of glyphs) g.y += dy
    const x0 = col === 1 ? -maxW / 2 : col === 2 ? -maxW : 0
    return { glyphs, x0, x1: x0 + maxW, y0: -total + dy, y1: dy }
  }
}

interface MGlyph {
  text: string
  x: number
  y: number
  w: number
  h: number
  wf: number
  font: string
  color?: number
  underline?: boolean
  overline?: boolean
  strike?: boolean
}

interface MLayout {
  glyphs: MGlyph[]
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Words with their trailing spaces kept separate; CJK characters break anywhere. */
export function splitWords(s: string): string[] {
  const out: string[] = []
  const re = /\s+|[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]|[^\s\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]+/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(s))) out.push(mm[0])
  return out
}

function grow(b: Box, d: number): void {
  b.x0 -= d
  b.y0 -= d
  b.x1 += d
  b.y1 += d
}

export function toPath(d: number[]): Path2D {
  const p = new Path2D()
  for (let i = 0; i < d.length; ) {
    switch (d[i]) {
      case P.M:
        p.moveTo(d[i + 1], d[i + 2])
        i += 3
        break
      case P.L:
        p.lineTo(d[i + 1], d[i + 2])
        i += 3
        break
      case P.C:
        p.bezierCurveTo(d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5], d[i + 6])
        i += 7
        break
      case P.Q:
        p.quadraticCurveTo(d[i + 1], d[i + 2], d[i + 3], d[i + 4])
        i += 5
        break
      case P.E: {
        const rx = Math.abs(d[i + 3])
        const ry = Math.abs(d[i + 4])
        if (rx > 0 && ry > 0 && Number.isFinite(rx + ry)) p.ellipse(d[i + 1], d[i + 2], rx, ry, d[i + 5], d[i + 6], d[i + 7], d[i + 8] !== 1)
        i += 9
        break
      }
      case P.Z:
        p.closePath()
        i += 1
        break
      default:
        return p
    }
  }
  return p
}

export function css(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}

/** Colours that would vanish into the background (black on black, white on paper) become the
 *  foreground colour, as CAD viewers do for colour 7. */
export function contrast(c: number, bg: number, fg: number): number {
  const dr = ((c >> 16) & 255) - ((bg >> 16) & 255)
  const dg = ((c >> 8) & 255) - ((bg >> 8) & 255)
  const db = (c & 255) - (bg & 255)
  return dr * dr + dg * dg + db * db < 48 * 48 ? fg : c
}
