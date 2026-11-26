/** Pan/zoom SVG stage for the KiCad views: wheel zooms at the pointer, drag pans, pinch on touch,
 *  keyboard (+ − 0 F arrows), fit, optional mirror (board back side) and hover info. */
import type { PreviewContext, ThemeName } from '../../core/types.ts'
import { createZoom, h } from '../../core/ui.ts'
import { Box, fmt } from './scene.ts'

export interface Hit {
  title: string
  lines?: string[]
  /** Highlight outline (SVG path data in world units). */
  d?: string
}

export interface ViewSpec {
  /** Stylesheet text for a theme (class colours for the layers). */
  css(theme: ThemeName): string
  background(theme: ThemeName): string
  hit?(x: number, y: number, tolerance: number): Hit | null
}

export interface View {
  /** Replaces the drawing; `keepView` keeps the current pan/zoom (layer order changes). */
  setContent(svg: string, bounds: Box, keepView?: boolean): void
  /** Centres and zooms on a world box. */
  focus(b: Box): void
  setFlip(flip: boolean): void
  fit(): void
  /** Re-applies the stylesheet (after a layer or theme change). */
  restyle(): void
  svg: SVGSVGElement
  content: SVGGElement
}

const NS = 'http://www.w3.org/2000/svg'

const VIEW_CSS = `
.kc-stage { position: absolute; inset: 0; overflow: hidden; touch-action: none; cursor: grab; }
.kc-stage.kc-drag { cursor: grabbing; }
.kc-stage svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.kc-stage path.s { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.kc-stage path.f { stroke: none; }
.kc-stage text.t { stroke: none; font-family: system-ui, "Segoe UI", "Malgun Gothic", "Noto Sans KR", sans-serif; }
.kc-stage .kc-hl { fill: none; stroke-width: 0.25; vector-effect: non-scaling-stroke; stroke-width: 2px; pointer-events: none; }
.kc-tip { position: absolute; pointer-events: none; z-index: 3; max-width: min(360px, 80%); padding: 4px 8px; border-radius: 6px;
  font-size: 12px; line-height: 1.4; background: var(--orca-popover, #222); color: var(--orca-popover-foreground, #fff);
  border: 1px solid var(--orca-border, #555); box-shadow: 0 2px 8px rgba(0,0,0,.3); white-space: pre-wrap; }
.kc-tip b { font-weight: 600; }
`

export function createView(ctx: PreviewContext, spec: ViewSpec, host: HTMLElement = ctx.root): View {
  const { root, signal } = ctx
  root.style.overflow = 'hidden'
  host.style.position = 'relative'
  const style = h('style')
  style.textContent = VIEW_CSS
  const stage = h('div', 'kc-stage')
  stage.setAttribute('role', 'img')
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('preserveAspectRatio', 'none')
  const sheet = document.createElementNS(NS, 'style')
  const flipG = document.createElementNS(NS, 'g')
  const content = document.createElementNS(NS, 'g')
  const hl = document.createElementNS(NS, 'path')
  hl.setAttribute('class', 'kc-hl')
  flipG.append(content, hl)
  svg.append(sheet, flipG)
  const tip = h('div', 'kc-tip')
  tip.hidden = true
  stage.append(svg, tip)
  host.replaceChildren(style, stage)

  let bounds = new Box()
  let flip = false
  // View state: centre in world units and pixels per unit.
  let cx = 0
  let cy = 0
  let ppu = 1
  let fitPpu = 1

  const size = () => ({ w: stage.clientWidth || 800, h: stage.clientHeight || 600 })
  const apply = () => {
    const { w, h: hh } = size()
    const vw = w / ppu
    const vh = hh / ppu
    svg.setAttribute('viewBox', `${fmt(cx - vw / 2)} ${fmt(cy - vh / 2)} ${fmt(vw)} ${fmt(vh)}`)
  }
  const zoom = createZoom(
    1,
    (s) => {
      ppu = fitPpu * s
      apply()
    },
    () => 1,
    { min: 0.05, max: 400 }
  )
  const fitNow = () => {
    const { w, h: hh } = size()
    const b = bounds.empty ? Object.assign(new Box(), { x0: 0, y0: 0, x1: 100, y1: 100 }) : bounds
    const bw = Math.max(b.w, 1e-3)
    const bh = Math.max(b.h, 1e-3)
    fitPpu = Math.min((w - 24) / bw, (hh - 24) / bh)
    if (!(fitPpu > 0)) fitPpu = 1
    cx = flip ? -(b.x0 + b.x1) / 2 : (b.x0 + b.x1) / 2
    cy = (b.y0 + b.y1) / 2
    ppu = fitPpu
    if (Math.abs(zoom.get() - 1) > 1e-6) zoom.set(1)
    apply()
  }
  zoom.fit = fitNow
  ctx.toolbar.zoom(zoom)

  const restyle = () => {
    const t = ctx.theme()
    sheet.textContent = spec.css(t)
    stage.style.background = spec.background(t)
  }
  restyle()
  ctx.onTheme(restyle)

  /** Client point → world point (unflipped). */
  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const r = stage.getBoundingClientRect()
    const { w, h: hh } = size()
    const x = cx + (clientX - r.left - w / 2) / ppu
    const y = cy + (clientY - r.top - hh / 2) / ppu
    return [flip ? -x : x, y]
  }
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const r = stage.getBoundingClientRect()
    const { w, h: hh } = size()
    const px = clientX - r.left - w / 2
    const py = clientY - r.top - hh / 2
    const wx = cx + px / ppu
    const wy = cy + py / ppu
    const next = Math.min(400, Math.max(0.05, zoom.get() * factor))
    ppu = fitPpu * next
    cx = wx - px / ppu
    cy = wy - py / ppu
    zoom.set(next)
    apply()
  }

  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      if (e.shiftKey && !e.ctrlKey) {
        cx += (e.deltaX || dy) / ppu
        apply()
        return
      }
      zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0022))
    },
    { passive: false, signal }
  )

  const pts = new Map<number, { x: number; y: number }>()
  let last: { x: number; y: number } | null = null
  let pinch = 0
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return
      stage.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      last = { x: e.clientX, y: e.clientY }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
      }
      stage.classList.add('kc-drag')
      tip.hidden = true
    },
    { signal }
  )
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse') hover(e.clientX, e.clientY)
        return
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch > 0 && d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch)
        pinch = d
        return
      }
      if (last) {
        cx -= (e.clientX - last.x) / ppu
        cy -= (e.clientY - last.y) / ppu
        apply()
      }
      last = { x: e.clientX, y: e.clientY }
    },
    { signal }
  )
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId)
    if (pts.size < 2) pinch = 0
    if (!pts.size) {
      last = null
      stage.classList.remove('kc-drag')
    } else last = [...pts.values()][0]
  }
  stage.addEventListener('pointerup', up, { signal })
  stage.addEventListener('pointercancel', up, { signal })
  stage.addEventListener(
    'pointerleave',
    () => {
      tip.hidden = true
      hl.removeAttribute('d')
    },
    { signal }
  )

  let hoverRaf = 0
  const hover = (clientX: number, clientY: number) => {
    if (!spec.hit) return
    cancelAnimationFrame(hoverRaf)
    hoverRaf = requestAnimationFrame(() => {
      const [x, y] = toWorld(clientX, clientY)
      const hit = spec.hit!(x, y, 4 / ppu)
      if (!hit) {
        tip.hidden = true
        hl.removeAttribute('d')
        return
      }
      tip.replaceChildren(h('b', undefined, hit.title), ...(hit.lines ?? []).map((l) => h('div', undefined, l)))
      tip.hidden = false
      const r = stage.getBoundingClientRect()
      let tx = clientX - r.left + 14
      let ty = clientY - r.top + 14
      if (tx + tip.offsetWidth > r.width - 4) tx = Math.max(4, clientX - r.left - tip.offsetWidth - 10)
      if (ty + tip.offsetHeight > r.height - 4) ty = Math.max(4, clientY - r.top - tip.offsetHeight - 10)
      tip.style.left = `${tx}px`
      tip.style.top = `${ty}px`
      if (hit.d) hl.setAttribute('d', hit.d)
      else hl.removeAttribute('d')
    })
  }

  root.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey || e.metaKey || e.ctrlKey) return
      const step = 60 / ppu
      const k = e.key
      if (k === '+' || k === '=') zoom.set(zoom.get() * 1.25)
      else if (k === '-' || k === '_') zoom.set(zoom.get() / 1.25)
      else if (k === '0' || k === 'f' || k === 'F' || k === 'Home') fitNow()
      else if (k === 'ArrowLeft') cx -= step
      else if (k === 'ArrowRight') cx += step
      else if (k === 'ArrowUp') cy -= step
      else if (k === 'ArrowDown') cy += step
      else return
      e.preventDefault()
      apply()
    },
    { signal }
  )
  // Ctrl/Cmd + (+, −, 0) like the other previews.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === '+' || e.key === '=') zoom.set(zoom.get() * 1.25)
      else if (e.key === '-' || e.key === '_') zoom.set(zoom.get() / 1.25)
      else if (e.key === '0') fitNow()
      else return
      e.preventDefault()
    },
    { signal }
  )

  let fitted = false
  const ro = new ResizeObserver(() => {
    if (!fitted || zoom.get() === 1) fitNow()
    else apply()
    fitted = true
  })
  ro.observe(stage)
  signal.addEventListener('abort', () => ro.disconnect(), { once: true })

  return {
    svg,
    content,
    setContent(markup, b, keepView) {
      content.innerHTML = markup
      bounds = b
      hl.removeAttribute('d')
      if (!keepView) fitNow()
    },
    focus(b) {
      const { w, h: hh } = size()
      const s = Math.min((w - 24) / Math.max(b.w, 1e-3), (hh - 24) / Math.max(b.h, 1e-3))
      cx = flip ? -(b.x0 + b.x1) / 2 : (b.x0 + b.x1) / 2
      cy = (b.y0 + b.y1) / 2
      zoom.set(Math.min(400, Math.max(0.05, s / fitPpu)))
      ppu = fitPpu * zoom.get()
      apply()
    },
    setFlip(f) {
      if (f === flip) return
      flip = f
      flipG.setAttribute('transform', f ? 'scale(-1 1)' : '')
      cx = -cx
      apply()
    },
    fit: fitNow,
    restyle
  }
}
