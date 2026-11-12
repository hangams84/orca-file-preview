/** The preview shell: theme-aware styles, toolbar, loading and error states, zoom with pinch. */
import type { Toolbar, ToolbarButton, ZoomController } from './types.ts'

const CSS = `
:root { color-scheme: light dark; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--orca-background, #fff); color: var(--orca-foreground, #111);
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  display: flex; flex-direction: column; overflow: hidden; -webkit-text-size-adjust: 100%;
}
.fp-toolbar {
  flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: 36px;
  padding: 4px 8px; box-sizing: border-box; border-bottom: 1px solid var(--orca-border, #ddd);
  background: var(--orca-card, #fafafa); color: var(--orca-card-foreground, inherit); user-select: none;
}
.fp-toolbar .fp-group { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.fp-toolbar .fp-spacer { flex: 1 1 auto; }
.fp-toolbar button, .fp-toolbar select {
  font: inherit; color: var(--orca-secondary-foreground, inherit); background: var(--orca-secondary, #eee);
  border: 1px solid var(--orca-input, var(--orca-border, #ccc)); border-radius: var(--orca-radius, 6px);
  min-height: 26px; min-width: 28px; padding: 0 8px; cursor: pointer;
}
.fp-toolbar button:hover { background: var(--orca-accent, #e4e4e4); color: var(--orca-accent-foreground, inherit); }
.fp-toolbar button[aria-pressed="true"] { background: var(--orca-primary, #333); color: var(--orca-primary-foreground, #fff); }
.fp-toolbar button:focus-visible, .fp-toolbar select:focus-visible { outline: 2px solid var(--orca-ring, #48f); outline-offset: 1px; }
.fp-toolbar button:disabled { opacity: .45; cursor: default; }
.fp-toolbar .fp-sep { width: 1px; align-self: stretch; margin: 4px 2px; background: var(--orca-border, #ddd); }
.fp-toolbar .fp-info { color: var(--orca-muted-foreground, #666); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60vw; }
.fp-toolbar .fp-zoom-label { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
.fp-badge { font-weight: 600; letter-spacing: .02em; text-transform: uppercase; font-size: 11px;
  padding: 1px 6px; border-radius: 4px; background: var(--orca-muted, #eee); color: var(--orca-muted-foreground, #555); }
.fp-content { flex: 1 1 auto; overflow: auto; position: relative; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y; outline: none; }
.fp-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  min-height: 100%; padding: 24px; box-sizing: border-box; text-align: center; color: var(--orca-muted-foreground, #666); }
.fp-state h2 { margin: 0; font-size: 15px; color: var(--orca-foreground, inherit); }
.fp-state pre { max-width: 100%; overflow: auto; text-align: left; font-size: 12px; opacity: .8; white-space: pre-wrap; margin: 6px 0 0; }
.fp-details { max-width: min(560px, 100%); font-size: 12px; }
.fp-details summary { cursor: pointer; color: var(--orca-muted-foreground, #666); }
.fp-spinner { width: 22px; height: 22px; border-radius: 50%; border: 3px solid var(--orca-border, #ccc);
  border-top-color: var(--orca-primary, #333); animation: fp-spin .8s linear infinite; }
@keyframes fp-spin { to { transform: rotate(360deg); } }
.fp-page { background: #fff; color: #000; box-shadow: 0 1px 4px rgba(0,0,0,.25); margin: 12px auto; }
.fp-scroll-pad { padding: 12px; box-sizing: border-box; }
@media (max-width: 600px) {
  .fp-toolbar { gap: 3px; padding: 4px; }
  .fp-toolbar button, .fp-toolbar select { min-height: 32px; min-width: 34px; padding: 0 6px; }
  /* File info gets its own full-width row instead of being cut off. */
  .fp-toolbar .fp-info { order: 10; flex: 1 0 100%; max-width: none; white-space: normal; overflow: visible; font-size: 12px; }
  .fp-toolbar .fp-spacer { display: none; }
  .fp-hide-compact { display: none !important; }
}
`

export function installStyles(): void {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  let meta = document.querySelector('meta[name="viewport"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'viewport')
    document.head.append(meta)
  }
  // The preview handles pinch itself; stop the page from zooming the toolbar away on phones.
  meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
}

export interface Shell {
  toolbar: Toolbar
  root: HTMLElement
  /** Removes renderer controls and content before a re-render. */
  reset(): void
  setBadge(text: string): void
}

export function createShell(): Shell {
  const bar = h('div', 'fp-toolbar')
  bar.setAttribute('role', 'toolbar')
  const badge = h('span', 'fp-badge')
  const left = h('div', 'fp-group')
  const info = h('span', 'fp-info')
  const spacer = h('div', 'fp-spacer')
  const right = h('div', 'fp-group')
  bar.append(badge, left, info, spacer, right)

  const root = h('div', 'fp-content')
  root.tabIndex = 0
  document.body.append(bar, root)

  const toolbar: Toolbar = {
    button(spec: ToolbarButton) {
      const b = button(spec.label, spec.title, spec.onClick)
      left.append(b)
      return b
    },
    select(title, options, onChange) {
      const s = h('select')
      s.title = title
      s.setAttribute('aria-label', title)
      for (const o of options) {
        const opt = h('option', undefined, o.label)
        opt.value = o.value
        s.append(opt)
      }
      s.addEventListener('change', () => onChange(s.value))
      left.append(s)
      return s
    },
    info(text) {
      info.textContent = text
      info.title = text
    },
    separator() {
      left.append(h('span', 'fp-sep'))
    },
    zoom(controller) {
      right.replaceChildren(...zoomControls(controller))
    }
  }

  return {
    toolbar,
    root,
    reset() {
      left.replaceChildren()
      right.replaceChildren()
      info.textContent = ''
      root.replaceChildren()
      root.scrollTo(0, 0)
    },
    setBadge(text) {
      badge.textContent = text
    }
  }
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', undefined, label)
  b.type = 'button'
  b.title = title
  b.setAttribute('aria-label', title)
  b.addEventListener('click', onClick)
  return b
}

function zoomControls(z: ZoomController): HTMLElement[] {
  const label = h('span', 'fp-zoom-label')
  const show = (s: number) => (label.textContent = `${Math.round(s * 100)}%`)
  show(z.get())
  z.onChange(show)
  const els: HTMLElement[] = [
    button('−', 'Zoom out (Ctrl -)', () => z.set(stepZoom(z.get(), -1))),
    label,
    button('+', 'Zoom in (Ctrl +)', () => z.set(stepZoom(z.get(), 1))),
    button('1:1', 'Actual size (Ctrl 0)', () => z.set(1))
  ]
  if (z.fit) els.push(button('↔', 'Fit width', () => z.fit!()))
  return els
}

const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8]
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return STEPS.find((s) => s > current + 0.001) ?? STEPS[STEPS.length - 1]
  return [...STEPS].reverse().find((s) => s < current - 0.001) ?? STEPS[0]
}

export function clampZoom(s: number, min = 0.1, max = 8): number {
  return Math.min(max, Math.max(min, s))
}

/** A zoom controller over a plain number; `apply` draws the new scale. */
export function createZoom(
  initial: number,
  apply: (scale: number) => void,
  fit?: () => number,
  limits: { min?: number; max?: number } = {}
): ZoomController {
  let scale = initial
  const listeners: ((s: number) => void)[] = []
  const ctl: ZoomController = {
    get: () => scale,
    set(s) {
      const next = clampZoom(s, limits.min, limits.max)
      if (Math.abs(next - scale) < 0.0001) return
      scale = next
      apply(scale)
      for (const l of listeners) l(scale)
    },
    onChange: (l) => {
      listeners.push(l)
    }
  }
  if (fit) ctl.fit = () => ctl.set(fit())
  return ctl
}

/** CSS-zoom a block (layout reflows, scroll sizes stay right). For HTML-rendered documents. */
export function cssZoom(target: HTMLElement, viewport: HTMLElement, naturalWidth: () => number): ZoomController {
  return createZoom(
    1,
    (s) => {
      target.style.zoom = String(s)
    },
    () => {
      const w = naturalWidth()
      return w > 0 ? clampZoom((viewport.clientWidth - 24) / w, 0.1, 4) : 1
    }
  )
}

/** Ctrl/Cmd + wheel, Ctrl/Cmd + (+, -, 0) and two-finger pinch on `viewport` drive `zoom`. */
export function bindZoomGestures(viewport: HTMLElement, zoom: ZoomController, signal: AbortSignal): void {
  viewport.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoom.set(zoom.get() * Math.exp(-e.deltaY * 0.0025))
    },
    { passive: false, signal }
  )
  window.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === '+' || e.key === '=') zoom.set(stepZoom(zoom.get(), 1))
      else if (e.key === '-' || e.key === '_') zoom.set(stepZoom(zoom.get(), -1))
      else if (e.key === '0') zoom.set(1)
      else return
      e.preventDefault()
    },
    { signal }
  )
  const pts = new Map<number, { x: number; y: number }>()
  let startDist = 0
  let startScale = 1
  const dist = () => {
    const [a, b] = [...pts.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  viewport.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2) {
        startDist = dist()
        startScale = zoom.get()
      }
    },
    { signal }
  )
  viewport.addEventListener(
    'pointermove',
    (e) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 2 && startDist > 0) zoom.set(startScale * (dist() / startDist))
    },
    { signal }
  )
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId)
    if (pts.size < 2) startDist = 0
  }
  viewport.addEventListener('pointerup', up, { signal })
  viewport.addEventListener('pointercancel', up, { signal })
}

export function showLoading(root: HTMLElement, text: string): void {
  const box = h('div', 'fp-state')
  box.setAttribute('role', 'status')
  box.append(h('div', 'fp-spinner'), h('div', undefined, text))
  root.replaceChildren(box)
}

export function showMessage(
  root: HTMLElement,
  title: string,
  detail?: string,
  extra?: string,
  extraLabel = 'Details'
): HTMLElement {
  const box = h('div', 'fp-state')
  box.setAttribute('role', 'alert')
  box.append(h('h2', undefined, title))
  if (detail) box.append(h('div', undefined, detail))
  if (extra) {
    // Diagnostics for bug reports stay out of the way until asked for.
    const more = h('details', 'fp-details')
    more.append(h('summary', undefined, extraLabel), h('pre', undefined, extra))
    box.append(more)
  }
  root.replaceChildren(box)
  return box
}

/** Tiny DOM helper for renderers: an element with a class and optional text. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text != null) e.textContent = text
  return e
}

/** Object URL for bytes, revoked when `signal` aborts. */
export function objectUrl(bytes: Uint8Array | ArrayBuffer | Blob, type: string, signal: AbortSignal): string {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  signal.addEventListener('abort', () => URL.revokeObjectURL(url), { once: true })
  return url
}
