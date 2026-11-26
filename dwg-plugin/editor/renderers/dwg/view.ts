/** Canvas 2D viewer for a built DWG scene: pan (drag), zoom (wheel, pinch, keys), fit, layer
 *  visibility, dark/light background, line weights, paper-space layouts with model-space viewports. */
import { apply, type Mat, matScale } from './geom.ts'
import { FOREGROUND, type Prim, type Scene, type Space, type TextPrim } from './scene.ts'

export interface ViewState {
  /** CSS px per drawing unit */
  s: number
  /** screen = (x * s + tx, -y * s + ty) */
  tx: number
  ty: number
}

interface Batch {
  kind: 'line' | 'fill' | 'pattern' | 'wipeout'
  layer: number
  color: number
  lw: number
  ww: number
  dash: number[] | null
  path: Path2D
  /** pattern: clip path */
  clip?: Path2D
  /** gradient fill: colours, angle and the fill's extent along that angle */
  grad?: { c1: number; c2: number; x0: number; y0: number; x1: number; y1: number }
}
interface Group {
  batches: Batch[]
  texts: Prim[]
}

const FONT_FALLBACK = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", system-ui, sans-serif'

export class DwgView {
  readonly canvas: HTMLCanvasElement
  private readonly g: CanvasRenderingContext2D
  private space: Space
  private groups = new Map<Space, Group[]>()
  state: ViewState = { s: 1, tx: 0, ty: 0 }
  private fitS = 1
  dark: boolean
  lineweights = true
  readonly layerOn: boolean[]
  private frame = 0
  private listeners: (() => void)[] = []
  private cssW = 0
  private cssH = 0

  constructor(
    private readonly host: HTMLElement,
    readonly scene: Scene,
    dark: boolean
  ) {
    this.dark = dark
    this.layerOn = scene.layers.map((l) => l.visible)
    // open on model space, or on the first layout with something on it
    this.space = scene.spaces.find((sp) => sp.prims.length > 0 || sp.viewports.length > 0) ?? scene.spaces[0]
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab;display:block'
    const g = this.canvas.getContext('2d')
    if (!g) throw new Error('canvas 2d unavailable')
    this.g = g
    host.append(this.canvas)
  }

  get current(): Space {
    return this.space
  }

  onChange(l: () => void): void {
    this.listeners.push(l)
  }
  private changed(): void {
    for (const l of this.listeners) l()
  }

  setSpace(i: number): void {
    const s = this.scene.spaces[i]
    if (!s || s === this.space) return
    this.space = s
    this.fit()
  }

  /** Zoom relative to "fit" (1 = whole drawing). */
  get zoom(): number {
    return this.state.s / this.fitS
  }

  resize(): boolean {
    const r = this.host.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width))
    const h = Math.max(1, Math.round(r.height))
    if (w === this.cssW && h === this.cssH) return false
    const first = this.cssW === 0
    // keep the centre of the view where it was
    const cx = (this.cssW / 2 - this.state.tx) / this.state.s
    const cy = (this.state.ty - this.cssH / 2) / this.state.s
    this.cssW = w
    this.cssH = h
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    if (first) this.fit()
    else {
      this.computeFit()
      this.state.tx = w / 2 - cx * this.state.s
      this.state.ty = h / 2 + cy * this.state.s
      this.redraw()
    }
    return true
  }

  private extent(): { x0: number; y0: number; x1: number; y1: number } {
    const b = this.space.box
    if (b.empty) return { x0: 0, y0: 0, x1: 100, y1: 100 }
    return { x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY }
  }

  private computeFit(): void {
    const e = this.extent()
    const w = Math.max(e.x1 - e.x0, 1e-9)
    const h = Math.max(e.y1 - e.y0, 1e-9)
    const pad = 16
    this.fitS = Math.max(1e-12, Math.min((this.cssW - pad * 2) / w, (this.cssH - pad * 2) / h))
  }

  fit(): void {
    this.computeFit()
    const e = this.extent()
    this.state.s = this.fitS
    this.state.tx = this.cssW / 2 - ((e.x0 + e.x1) / 2) * this.fitS
    this.state.ty = this.cssH / 2 + ((e.y0 + e.y1) / 2) * this.fitS
    this.redraw()
    this.changed()
  }

  /** Zoom to `z` × fit about a screen point (default: centre). */
  setZoom(z: number, at?: { x: number; y: number }): void {
    const zClamped = Math.min(1e5, Math.max(0.02, z))
    const s = zClamped * this.fitS
    const p = at ?? { x: this.cssW / 2, y: this.cssH / 2 }
    const wx = (p.x - this.state.tx) / this.state.s
    const wy = (this.state.ty - p.y) / this.state.s
    this.state.s = s
    this.state.tx = p.x - wx * s
    this.state.ty = p.y + wy * s
    this.redraw()
    this.changed()
  }

  pan(dx: number, dy: number): void {
    this.state.tx += dx
    this.state.ty += dy
    this.redraw()
  }

  toWorld(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.state.tx) / this.state.s, y: (this.state.ty - y) / this.state.s }
  }

  redraw(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  /** Draw now (tests and screenshots). */
  drawNow(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.draw()
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.canvas.remove()
    this.groups.clear()
  }

  // ------------------------------------------------------------------------------------------

  get background(): string {
    return this.dark ? '#212830' : '#ffffff'
  }
  private get desk(): string {
    return this.dark ? '#14181d' : '#d9dce1'
  }
  private colourCache = new Map<number, string>()
  css(color: number): string {
    const key = color === FOREGROUND ? -1 : color
    const k2 = key * 2 + (this.dark ? 1 : 0)
    let c = this.colourCache.get(k2)
    if (c) return c
    if (color === FOREGROUND) c = this.dark ? '#ffffff' : '#000000'
    else {
      let r = (color >> 16) & 255
      let g = (color >> 8) & 255
      let b = color & 255
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      // colours that would vanish into the background are pulled towards the foreground
      if (!this.dark && lum > 0.88) [r, g, b] = [r * 0.45, g * 0.45, b * 0.45]
      if (this.dark && lum < 0.06) [r, g, b] = [r + (200 - r) * 0.7, g + (200 - g) * 0.7, b + (200 - b) * 0.7]
      c = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
    }
    this.colourCache.set(k2, c)
    return c
  }

  private groupsFor(space: Space): Group[] {
    let gs = this.groups.get(space)
    if (gs) return gs
    gs = []
    let cur: Group = { batches: [], texts: [] }
    let byKey = new Map<string, Batch>()
    const flush = () => {
      if (cur.batches.length || cur.texts.length) gs!.push(cur)
      cur = { batches: [], texts: [] }
      byKey = new Map()
    }
    for (const p of space.prims) {
      if (p.kind === 'text') {
        cur.texts.push(p)
        continue
      }
      if (p.kind === 'fill' && p.bg) {
        // a wipeout covers what was drawn before it: close the group
        flush()
        const path = new Path2D()
        for (const r of p.rings ?? []) ringPath(path, r, true)
        gs.push({ batches: [{ kind: 'wipeout', layer: p.layer, color: p.color, lw: 0, ww: 0, dash: null, path }], texts: [] })
        continue
      }
      if (p.kind === 'pattern') {
        const clip = new Path2D()
        for (const r of p.rings ?? []) ringPath(clip, r, true)
        const path = new Path2D()
        const s = p.segs ?? []
        for (let i = 0; i + 3 < s.length; i += 4) {
          path.moveTo(s[i], s[i + 1])
          path.lineTo(s[i + 2], s[i + 3])
        }
        cur.batches.push({ kind: 'pattern', layer: p.layer, color: p.color, lw: p.lw, ww: 0, dash: null, path, clip })
        continue
      }
      if (p.kind === 'fill') {
        // one path per fill: rings of one hatch use even-odd holes, separate fills must not cancel
        const path = new Path2D()
        for (const r of p.rings ?? []) ringPath(path, r, true)
        const batch: Batch = { kind: 'fill', layer: p.layer, color: p.color, lw: 0, ww: 0, dash: null, path }
        if (p.grad) {
          // gradient axis through the fill's centre, spanning its extent along the gradient direction
          const ux = Math.cos(p.grad.angle)
          const uy = Math.sin(p.grad.angle)
          let lo = Infinity
          let hi = -Infinity
          let cx = 0
          let cy = 0
          let n = 0
          for (const r of p.rings ?? [])
            for (let i = 0; i + 1 < r.length; i += 2) {
              const t = r[i] * ux + r[i + 1] * uy
              lo = Math.min(lo, t)
              hi = Math.max(hi, t)
              cx += r[i]
              cy += r[i + 1]
              n++
            }
          if (n && hi > lo) {
            cx /= n
            cy /= n
            const mid = cx * ux + cy * uy
            batch.grad = { c1: p.grad.c1, c2: p.grad.c2, x0: cx + ux * (lo - mid), y0: cy + uy * (lo - mid), x1: cx + ux * (hi - mid), y1: cy + uy * (hi - mid) }
          }
        }
        cur.batches.push(batch)
        continue
      }
      const ww = p.ww ?? 0
      const dk = p.dash ? p.dash.map((d) => d.toPrecision(4)).join(',') : ''
      const key = `${p.layer}|${p.color}|${p.lw}|${ww}|${dk}`
      let b = byKey.get(key)
      if (!b) {
        b = { kind: 'line', layer: p.layer, color: p.color, lw: p.lw, ww, dash: p.dash ?? null, path: new Path2D() }
        byKey.set(key, b)
        cur.batches.push(b)
      }
      ringPath(b.path, p.pts ?? [], !!p.closed)
    }
    flush()
    this.groups.set(space, gs)
    return gs
  }

  private draw(): void {
    const g = this.g
    const dpr = this.canvas.width / Math.max(1, this.cssW)
    const { s, tx, ty } = this.state
    g.setTransform(1, 0, 0, 1, 0, 0)
    const space = this.space
    g.fillStyle = space.paper ? this.desk : this.background
    g.fillRect(0, 0, this.canvas.width, this.canvas.height)
    const base: Mat = [dpr * s, 0, 0, -dpr * s, dpr * tx, dpr * ty]
    if (space.paper && space.sheet) {
      const sh = space.sheet
      g.setTransform(...base)
      g.shadowColor = 'rgba(0,0,0,.35)'
      g.shadowBlur = 8 * dpr
      g.fillStyle = this.background
      g.fillRect(sh.x0, sh.y0, sh.x1 - sh.x0, sh.y1 - sh.y0)
      g.shadowColor = 'transparent'
      g.shadowBlur = 0
    }
    if (space.paper) {
      const model = this.scene.spaces[0]
      for (const vp of space.viewports) {
        g.save()
        g.setTransform(...base)
        g.beginPath()
        g.rect(vp.x0, vp.y0, vp.x1 - vp.x0, vp.y1 - vp.y0)
        g.clip()
        this.drawSpace(model, mulMat(base, vp.m), dpr)
        g.restore()
      }
    }
    this.drawSpace(space, base, dpr)
  }

  /** Draw a space's primitives with `m` mapping drawing units to device pixels. */
  private drawSpace(space: Space, m: Mat, dpr: number): void {
    const g = this.g
    const unit = matScale(m) // device px per drawing unit
    if (!(unit > 0)) return
    for (const grp of this.groupsFor(space)) {
      g.setTransform(...m)
      for (const b of grp.batches) {
        if (!this.layerOn[b.layer] && b.kind !== 'wipeout') continue
        if (b.kind === 'wipeout') {
          g.fillStyle = this.background
          g.fill(b.path, 'evenodd')
          continue
        }
        const css = this.css(b.color)
        if (b.kind === 'fill') {
          if (b.grad) {
            const gr = g.createLinearGradient(b.grad.x0, b.grad.y0, b.grad.x1, b.grad.y1)
            gr.addColorStop(0, this.css(b.grad.c1))
            gr.addColorStop(1, this.css(b.grad.c2))
            g.fillStyle = gr
          } else g.fillStyle = css
          g.fill(b.path, 'evenodd')
          continue
        }
        const px = this.lineweights ? Math.max(1, b.lw * 0.03) : 1
        g.lineWidth = Math.max((px * dpr) / unit, b.ww)
        g.strokeStyle = css
        g.lineCap = 'round'
        g.lineJoin = 'round'
        if (b.kind === 'pattern') {
          g.save()
          g.clip(b.clip!, 'evenodd')
          g.lineWidth = dpr / unit
          g.stroke(b.path)
          g.restore()
          continue
        }
        const period = b.dash ? b.dash.reduce((a, d) => a + d, 0) : 0
        // dashes smaller than ~3 px on screen read as a solid line (and are slow): draw solid
        g.setLineDash(b.dash && period * unit > 3 * dpr ? b.dash.map((d) => (d > 0 ? d : (dpr * 0.5) / unit)) : [])
        g.stroke(b.path)
      }
      g.setLineDash([])
      if (grp.texts.length) this.drawTexts(grp.texts, m, unit, dpr)
    }
  }

  private drawTexts(texts: Prim[], m: Mat, unit: number, dpr: number): void {
    const g = this.g
    const W = this.canvas.width
    const H = this.canvas.height
    for (const p of texts) {
      if (!this.layerOn[p.layer]) continue
      const t = p.text as TextPrim
      const hp = t.h * unit
      if (hp < 1.2 * dpr) continue
      const at = apply(m, t.x, t.y)
      const reach = hp * (t.s.length + 2) * Math.max(1, t.wf)
      if (at.x < -reach || at.y < -reach || at.x > W + reach || at.y > H + reach) continue
      // the canvas y axis points down: angles turn the other way
      const ax = apply(m, t.x + Math.cos(t.rot), t.y + Math.sin(t.rot))
      const ang = Math.atan2(ax.y - at.y, ax.x - at.x)
      g.setTransform(1, 0, 0, 1, at.x, at.y)
      g.rotate(ang)
      if (t.flipY) g.scale(1, -1)
      g.scale(t.wf * (t.flipX ? -1 : 1), 1)
      if (t.oblique) g.transform(1, 0, -Math.tan(t.oblique), 1, 0, 0)
      g.fillStyle = this.css(p.color)
      g.font = `${hp / 0.72}px ${t.font === 'sans-serif' ? FONT_FALLBACK : `"${t.font}", ${FONT_FALLBACK}`}`
      g.textAlign = t.ha === 1 ? 'center' : t.ha === 2 ? 'right' : 'left'
      g.textBaseline = t.va === 3 ? 'top' : t.va === 2 ? 'middle' : t.va === 1 ? 'bottom' : 'alphabetic'
      g.fillText(t.s, 0, 0)
    }
  }
}

function ringPath(path: Path2D, pts: number[], closed: boolean): void {
  if (pts.length < 2) return
  path.moveTo(pts[0], pts[1])
  if (pts.length === 2) path.lineTo(pts[0], pts[1])
  for (let i = 2; i + 1 < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1])
  if (closed) path.closePath()
}

function mulMat(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}
