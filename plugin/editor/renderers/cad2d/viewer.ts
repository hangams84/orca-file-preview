/** Interactive 2D drawing viewer for a `Scene`: canvas with pan (drag), zoom (wheel, pinch,
 *  buttons, keys) around the pointer, fit, a layer list with visibility toggles, a model/layout/
 *  sheet selector, a dark/light background toggle and an info bar (version, units, extents, counts,
 *  cursor position). Heavy drawings pan and zoom on a snapshot and redraw when the gesture rests. */
import type { PreviewContext, ZoomController } from '../../core/types.ts'
import { createZoom, h } from '../../core/ui.ts'
import { paintView } from './paint.ts'
import { invert, isEmpty, viewBox, type Mat, type Scene } from './scene.ts'

const CSS = `
.cad-root { position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; }
.cad-main { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
.cad-stage { position: relative; flex: 1 1 auto; min-width: 0; overflow: hidden; touch-action: none; cursor: grab; outline: none; }
.cad-stage.cad-drag { cursor: grabbing; }
.cad-stage canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }
.cad-notice { position: absolute; left: 8px; right: 8px; top: 8px; z-index: 2; padding: 6px 10px; border-radius: 6px;
  background: rgba(255, 196, 0, .92); color: #222; font-size: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.25); pointer-events: none; }
.cad-layers { flex: none; width: 240px; max-width: 70vw; display: none; flex-direction: column; border-left: 1px solid var(--orca-border, #ccc);
  background: var(--orca-card, #fafafa); color: var(--orca-card-foreground, inherit); font-size: 12px; }
.cad-layers.cad-open { display: flex; }
.cad-layers header { display: flex; gap: 4px; align-items: center; padding: 6px; border-bottom: 1px solid var(--orca-border, #ddd); flex-wrap: wrap; }
.cad-layers header strong { flex: 1 1 auto; }
.cad-layers header button { font: inherit; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--orca-border, #ccc);
  background: var(--orca-secondary, #eee); color: var(--orca-secondary-foreground, inherit); cursor: pointer; min-height: 24px; }
.cad-layers input[type=search] { flex: 1 0 100%; font: inherit; padding: 2px 6px; box-sizing: border-box; border-radius: 4px;
  border: 1px solid var(--orca-border, #ccc); background: var(--orca-background, #fff); color: inherit; }
.cad-layers ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1 1 auto; }
.cad-layers li label { display: flex; align-items: center; gap: 6px; padding: 3px 8px; cursor: pointer; }
.cad-layers li label:hover { background: var(--orca-accent, rgba(0,0,0,.06)); }
.cad-layers .cad-sw { width: 11px; height: 11px; border-radius: 2px; flex: none; border: 1px solid rgba(128,128,128,.6); }
.cad-layers .cad-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cad-layers .cad-n { color: var(--orca-muted-foreground, #777); font-variant-numeric: tabular-nums; }
.cad-status { flex: none; display: flex; gap: 12px; align-items: center; min-height: 22px; padding: 2px 8px; box-sizing: border-box;
  border-top: 1px solid var(--orca-border, #ddd); background: var(--orca-card, #fafafa); color: var(--orca-muted-foreground, #555);
  font-size: 11.5px; white-space: nowrap; overflow: hidden; }
.cad-status .cad-facts { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
.cad-status .cad-xy { flex: none; font-variant-numeric: tabular-nums; }
@media (max-width: 600px) {
  .cad-layers { position: absolute; right: 0; top: 0; bottom: 0; z-index: 3; width: 78vw; box-shadow: -2px 0 8px rgba(0,0,0,.3); }
  .cad-status { white-space: normal; flex-wrap: wrap; }
  .cad-status .cad-xy { display: none; }
}
`

const THEMES = {
  dark: { bg: 0x1d2027, fg: 0xffffff, outside: 0x121418, paperEdge: 0x50545c },
  light: { bg: 0xffffff, fg: 0x000000, outside: 0xd9dbe0, paperEdge: 0x9aa0a8 }
}

export interface ViewerOptions {
  /** Facts shown in the toolbar info text. */
  summary: string
}

export function showScene(ctx: PreviewContext, scene: Scene, opts: ViewerOptions): () => void {
  const { root, toolbar, tr, signal } = ctx
  const style = h('style')
  style.textContent = CSS
  root.style.overflow = 'hidden'
  const wrap = h('div', 'cad-root')
  const main = h('div', 'cad-main')
  const stage = h('div', 'cad-stage')
  stage.tabIndex = 0
  stage.setAttribute('role', 'img')
  const canvas = h('canvas')
  const notice = h('div', 'cad-notice')
  notice.setAttribute('role', 'note')
  stage.append(canvas)
  const panel = h('div', 'cad-layers')
  main.append(stage, panel)
  const status = h('div', 'cad-status')
  const facts = h('span', 'cad-facts')
  const xy = h('span', 'cad-xy')
  status.append(facts, xy)
  wrap.append(main, status)
  root.replaceChildren(style, wrap)

  const g = canvas.getContext('2d', { alpha: false })!
  let viewIndex = 0
  let bgMode: 'dark' | 'light' = scene.views[0]?.background ?? ctx.theme()
  const layerOn = scene.layers.map((l) => l.visible)
  let lineweights = true
  // View transform: device = [s, 0, 0, -s, tx, ty] · world
  let s = 1
  let tx = 0
  let ty = 0
  let fitScale = 1
  let W = 0
  let H = 0
  let dpr = 1

  const matrix = (): Mat => [s, 0, 0, -s, tx, ty]

  // ---- drawing -------------------------------------------------------------------------------
  let snap: HTMLCanvasElement | null = null
  let snapM: Mat | null = null
  let lastMs = 0
  let raf = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  let interacting = false

  const full = () => {
    if (!W || !H) return
    const t0 = performance.now()
    const th = THEMES[bgMode]
    const view = scene.views[viewIndex]
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1
    g.fillStyle = hex(view?.paper ? th.outside : th.bg)
    g.fillRect(0, 0, W, H)
    if (view?.paper) {
      const p = view.paper
      const m = matrix()
      const x = m[0] * p.x0 + m[4]
      const y = m[3] * p.y1 + m[5]
      const w = (p.x1 - p.x0) * s
      const hh = (p.y1 - p.y0) * s
      g.fillStyle = 'rgba(0,0,0,.25)'
      g.fillRect(x + 3 * dpr, y + 3 * dpr, w, hh)
      g.fillStyle = hex(th.bg)
      g.fillRect(x, y, w, hh)
      g.strokeStyle = hex(th.paperEdge)
      g.lineWidth = dpr
      g.strokeRect(x, y, w, hh)
    }
    try {
      paintView(g, scene, viewIndex, matrix(), { bg: th.bg, fg: th.fg, dpr, layerOn, lineweights, width: W, height: H })
    } catch (err) {
      console.warn('cad2d paint', err)
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
    lastMs = performance.now() - t0
    // Keep a snapshot for fast interaction on heavy drawings.
    if (lastMs > 30) {
      if (!snap) snap = document.createElement('canvas')
      if (snap.width !== W || snap.height !== H) {
        snap.width = W
        snap.height = H
      }
      snap.getContext('2d')!.drawImage(canvas, 0, 0)
      snapM = matrix()
    } else snapM = null
    document.body.dataset.cadPaintMs = String(Math.round(lastMs))
  }

  const fast = () => {
    if (!snap || !snapM) return full()
    const th = THEMES[bgMode]
    const k = s / snapM[0]
    const dx = tx - snapM[4] * k
    const dy = ty - snapM[5] * k
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = hex(scene.views[viewIndex]?.paper ? th.outside : th.bg)
    g.fillRect(0, 0, W, H)
    g.setTransform(k, 0, 0, k, dx, dy)
    g.drawImage(snap, 0, 0)
    g.setTransform(1, 0, 0, 1, 0, 0)
  }

  const draw = (quick = false) => {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      if (quick && snapM && lastMs > 30) {
        fast()
        clearTimeout(idle)
        idle = setTimeout(() => {
          if (!interacting) full()
          else draw(true)
        }, 160)
      } else full()
    })
  }

  // ---- view geometry ------------------------------------------------------------------------
  const fit = () => {
    const view = scene.views[viewIndex]
    const b = view ? viewBox(scene, view) : null
    if (!b || isEmpty(b) || !W || !H) {
      s = 1
      tx = W / 2
      ty = H / 2
      fitScale = 1
      return
    }
    const bw = Math.max(b.x1 - b.x0, 1e-9)
    const bh = Math.max(b.y1 - b.y0, 1e-9)
    const pad = 16 * dpr
    s = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh)
    if (!(s > 0) || !Number.isFinite(s)) s = 1
    fitScale = s
    tx = W / 2 - s * (b.x0 + bw / 2)
    ty = H / 2 + s * (b.y0 + bh / 2)
  }

  const zoomAt = (k: number, px: number, py: number) => {
    const next = Math.min(Math.max(s * k, fitScale / 50), fitScale * 1e5)
    k = next / s
    tx = px - (px - tx) * k
    ty = py - (py - ty) * k
    s = next
    zoomListeners.forEach((l) => l(s / fitScale))
  }

  const zoomListeners: ((v: number) => void)[] = []
  const zoom: ZoomController = createZoom(1, () => {}, undefined, { min: 0.02, max: 100000 })
  // Replace the plain controller's behaviour with view-centred zooming.
  zoom.get = () => s / fitScale
  zoom.set = (v: number) => {
    const k = (v * fitScale) / s
    zoomAt(k, W / 2, H / 2)
    draw()
  }
  zoom.onChange = (l) => {
    zoomListeners.push(l)
  }
  zoom.fit = () => {
    fit()
    zoomListeners.forEach((l) => l(1))
    draw()
  }

  // ---- size ---------------------------------------------------------------------------------
  const resize = () => {
    const r = stage.getBoundingClientRect()
    const nd = window.devicePixelRatio || 1
    const nw = Math.max(1, Math.round(r.width * nd))
    const nh = Math.max(1, Math.round(r.height * nd))
    if (nw === W && nh === H && nd === dpr) return
    const first = !W
    // Keep the centre of the view where it was.
    const cxw = (W / 2 - tx) / s
    const cyw = (ty - H / 2) / s
    const rel = s / fitScale
    W = nw
    H = nh
    dpr = nd
    canvas.width = W
    canvas.height = H
    fit()
    if (!first) {
      s = fitScale * rel
      tx = W / 2 - s * cxw
      ty = H / 2 + s * cyw
    }
    snapM = null
    full()
  }
  const ro = new ResizeObserver(() => resize())
  ro.observe(stage)

  // ---- input --------------------------------------------------------------------------------
  const pts = new Map<number, { x: number; y: number }>()
  let pinch: { d: number; mx: number; my: number } | null = null
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.getBoundingClientRect()
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }
  }
  const showXY = (p: { x: number; y: number }) => {
    const wx = (p.x - tx) / s
    const wy = (ty - p.y) / s
    xy.textContent = `${fmt(wx)}, ${fmt(wy)}`
  }
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const p = local(e)
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      interacting = true
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y)
      draw(true)
      interacting = false
    },
    { passive: false, signal }
  )
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 && e.button !== 1) return
      stage.setPointerCapture(e.pointerId)
      pts.set(e.pointerId, local(e))
      interacting = true
      stage.classList.add('cad-drag')
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
      }
      e.preventDefault()
    },
    { signal }
  )
  stage.addEventListener(
    'pointermove',
    (e) => {
      const p = local(e)
      showXY(p)
      const prev = pts.get(e.pointerId)
      if (!prev) return
      pts.set(e.pointerId, p)
      if (pts.size === 1) {
        tx += p.x - prev.x
        ty += p.y - prev.y
        draw(true)
      } else if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        tx += mx - pinch.mx
        ty += my - pinch.my
        if (pinch.d > 0 && d > 0) zoomAt(d / pinch.d, mx, my)
        pinch = { d, mx, my }
        draw(true)
      }
    },
    { signal }
  )
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId)
    if (pts.size < 2) pinch = null
    if (pts.size === 0) {
      interacting = false
      stage.classList.remove('cad-drag')
      draw()
    }
  }
  stage.addEventListener('pointerup', up, { signal })
  stage.addEventListener('pointercancel', up, { signal })
  stage.addEventListener('pointerleave', () => (xy.textContent = ''), { signal })
  stage.addEventListener('dblclick', () => zoom.fit!(), { signal })
  stage.addEventListener(
    'keydown',
    (e) => {
      const step = 60 * dpr
      if (e.key === '+' || e.key === '=') zoomAt(1.25, W / 2, H / 2)
      else if (e.key === '-' || e.key === '_') zoomAt(0.8, W / 2, H / 2)
      else if (e.key === '0' || e.key === 'f' || e.key === 'Home') return zoom.fit!()
      else if (e.key === 'ArrowLeft') tx += step
      else if (e.key === 'ArrowRight') tx -= step
      else if (e.key === 'ArrowUp') ty += step
      else if (e.key === 'ArrowDown') ty -= step
      else return
      e.preventDefault()
      draw()
    },
    { signal }
  )

  // ---- toolbar ------------------------------------------------------------------------------
  let sel: HTMLSelectElement | null = null
  if (scene.views.length > 1) {
    sel = toolbar.select(
      tr('보기 선택 (모형/배치/시트)', 'View (model, layouts, sheets)'),
      scene.views.map((v, i) => ({
        value: String(i),
        label: v.kind === 'model' ? tr('모형', 'Model') : v.kind === 'layout' ? `${tr('배치', 'Layout')}: ${v.name}` : v.name
      })),
      (v) => setView(Number(v))
    )
    sel.classList.add('cad-view-select')
  }
  const layersBtn = scene.layers.length
    ? toolbar.button({
        label: tr('레이어', 'Layers'),
        title: tr(`레이어 목록 (${scene.layers.length})`, `Layer list (${scene.layers.length})`),
        onClick: () => {
          const open = panel.classList.toggle('cad-open')
          layersBtn!.setAttribute('aria-pressed', String(open))
          if (open && !panel.childElementCount) buildPanel()
          resize()
        }
      })
    : null
  layersBtn?.setAttribute('aria-pressed', 'false')
  const bgBtn = toolbar.button({
    label: '◐',
    title: tr('배경 밝게/어둡게', 'Light / dark background'),
    onClick: () => {
      bgMode = bgMode === 'dark' ? 'light' : 'dark'
      bgBtn.setAttribute('aria-pressed', String(bgMode === 'light'))
      snapM = null
      draw()
    }
  })
  bgBtn.setAttribute('aria-pressed', String(bgMode === 'light'))
  const lwBtn = toolbar.button({
    label: 'LW',
    title: tr('선 가중치 표시', 'Show lineweights'),
    onClick: () => {
      lineweights = !lineweights
      lwBtn.setAttribute('aria-pressed', String(lineweights))
      snapM = null
      draw()
    }
  })
  lwBtn.setAttribute('aria-pressed', 'true')
  lwBtn.classList.add('fp-hide-compact')
  toolbar.info(opts.summary)
  toolbar.zoom(zoom)

  // ---- layers panel -------------------------------------------------------------------------
  const boxes: HTMLInputElement[] = []
  function buildPanel(): void {
    const head = h('header')
    const title = h('strong', undefined, tr('레이어', 'Layers'))
    const allOn = h('button', undefined, tr('모두 켜기', 'All on'))
    const allOff = h('button', undefined, tr('모두 끄기', 'All off'))
    allOn.type = allOff.type = 'button'
    const setAll = (v: boolean) => {
      layerOn.fill(v)
      boxes.forEach((b) => (b.checked = v))
      snapM = null
      draw()
    }
    allOn.onclick = () => setAll(true)
    allOff.onclick = () => setAll(false)
    head.append(title, allOn, allOff)
    const list = h('ul')
    const rows: HTMLLIElement[] = []
    scene.layers.forEach((l, i) => {
      const li = h('li')
      const lab = h('label')
      const cb = h('input')
      cb.type = 'checkbox'
      cb.checked = layerOn[i]
      cb.addEventListener('change', () => {
        layerOn[i] = cb.checked
        snapM = null
        draw()
      })
      boxes[i] = cb
      const sw = h('span', 'cad-sw')
      sw.style.background = l.color < 0 ? (bgMode === 'dark' ? '#fff' : '#000') : hex(l.color)
      lab.append(cb, sw, h('span', 'cad-name', l.name), h('span', 'cad-n', String(l.count)))
      lab.title = l.name
      li.append(lab)
      li.dataset.name = l.name.toLowerCase()
      rows.push(li)
      list.append(li)
    })
    if (scene.layers.length > 12) {
      const q = h('input')
      q.type = 'search'
      q.placeholder = tr('레이어 찾기', 'Filter layers')
      q.setAttribute('aria-label', q.placeholder)
      q.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase()
        for (const r of rows) r.style.display = !v || r.dataset.name!.includes(v) ? '' : 'none'
      })
      head.append(q)
    }
    panel.append(head, list)
  }

  // ---- view switching -----------------------------------------------------------------------
  function setView(i: number): void {
    viewIndex = i
    if (sel) sel.value = String(i)
    const v = scene.views[i]
    if (v?.background) {
      bgMode = v.background
      bgBtn.setAttribute('aria-pressed', String(bgMode === 'light'))
    }
    notice.textContent = v?.notice ?? ''
    if (v?.notice) stage.append(notice)
    else notice.remove()
    stage.setAttribute('aria-label', `${scene.format} · ${v?.name ?? ''}`)
    snapM = null
    fit()
    zoomListeners.forEach((l) => l(1))
    updateFacts()
    full()
  }

  function updateFacts(): void {
    const v = scene.views[viewIndex]
    const b = v ? viewBox(scene, v) : null
    const parts: string[] = [scene.format]
    if (scene.version) parts.push(scene.version)
    if (scene.units) parts.push(`${tr('단위', 'units')}: ${scene.units}`)
    if (b && !isEmpty(b)) parts.push(`${tr('범위', 'extents')}: ${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)}`)
    const counts = [...scene.counts.entries()].sort((a, c) => c[1] - a[1])
    const total = counts.reduce((a, c) => a + c[1], 0)
    if (total) parts.push(`${total.toLocaleString()} ${tr('개체', 'entities')} (${counts.slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ')}${counts.length > 6 ? ', …' : ''})`)
    if (scene.layers.length) parts.push(`${scene.layers.length} ${tr('레이어', 'layers')}`)
    parts.push(...scene.info)
    if (v?.info) parts.push(...v.info)
    const skipped = [...scene.skipped.entries()]
    if (skipped.length) parts.push(`${tr('표시 안 함', 'not shown')}: ${skipped.map(([k, n]) => `${k} ${n}`).join(', ')}`)
    facts.textContent = parts.join(' · ')
    facts.title = parts.join('\n')
  }

  const onTheme = () => {
    // Follow Orca's theme unless the user picked a background or the sheet is paper.
    if (!scene.views[viewIndex]?.background) {
      bgMode = ctx.theme()
      bgBtn.setAttribute('aria-pressed', String(bgMode === 'light'))
      snapM = null
      draw()
    }
  }
  ctx.onTheme(onTheme)

  setView(0)
  requestAnimationFrame(() => resize())
  // Expose a tiny hook for tests/harness: current view, scale and paint time.
  ;(window as unknown as { __cad2d?: unknown }).__cad2d = {
    scene,
    setView,
    setLayer: (i: number, on: boolean) => {
      layerOn[i] = on
      if (boxes[i]) boxes[i].checked = on
      snapM = null
      full()
    },
    zoom,
    world: (px: number, py: number) => invert(matrix()) && [(px - tx) / s, (ty - py) / s]
  }
  return () => {
    ro.disconnect()
    cancelAnimationFrame(raf)
    clearTimeout(idle)
    delete (window as unknown as { __cad2d?: unknown }).__cad2d
  }
}

function hex(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0')
}

export function fmt(v: number): string {
  const a = Math.abs(v)
  if (!Number.isFinite(v)) return '—'
  if (a >= 1e6 || (a > 0 && a < 1e-3)) return v.toExponential(3)
  return Number(v.toFixed(a >= 1000 ? 1 : a >= 1 ? 3 : 4)).toLocaleString()
}
