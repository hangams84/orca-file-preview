/** Parameter map: squarified treemap or sunburst of parameter (or byte) share per module; click to
 *  zoom into a module, breadcrumb to go back up. */
import type { ModuleNode } from '../ir.ts'
import { el, fmtBytes, fmtCount, fmtInt, shortType, svg, type App, type View } from './common.ts'
import { moduleDetail } from './detail.ts'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Squarified treemap (Bruls et al.) of positive weights into a rectangle. */
export function squarify(weights: number[], r: Rect): Rect[] {
  const out: Rect[] = new Array(weights.length)
  const idx = weights.map((w, i) => [w, i] as const).filter(([w]) => w > 0).sort((a, b) => b[0] - a[0])
  const total = idx.reduce((s, [w]) => s + w, 0)
  if (!total) return weights.map(() => ({ x: r.x, y: r.y, w: 0, h: 0 }))
  const scale = (r.w * r.h) / total
  let rect = { ...r }
  let row: (readonly [number, number])[] = []
  const worst = (row: (readonly [number, number])[], side: number) => {
    const s = row.reduce((a, [w]) => a + w * scale, 0)
    let max = 0
    let min = Infinity
    for (const [w] of row) {
      max = Math.max(max, w * scale)
      min = Math.min(min, w * scale)
    }
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }
  const layoutRow = (row: (readonly [number, number])[]) => {
    const s = row.reduce((a, [w]) => a + w * scale, 0)
    if (rect.w >= rect.h) {
      const w = s / rect.h
      let y = rect.y
      for (const [v, i] of row) {
        const h = (v * scale) / w
        out[i] = { x: rect.x, y, w, h }
        y += h
      }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h }
    } else {
      const h = s / rect.w
      let x = rect.x
      for (const [v, i] of row) {
        const w = (v * scale) / h
        out[i] = { x, y: rect.y, w, h }
        x += w
      }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h }
    }
  }
  for (const item of idx) {
    const side = Math.min(rect.w, rect.h)
    if (!row.length || worst([...row, item], side) <= worst(row, side)) row.push(item)
    else {
      layoutRow(row)
      row = [item]
    }
  }
  if (row.length) layoutRow(row)
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = { x: r.x, y: r.y, w: 0, h: 0 }
  return out
}

const PALETTE = ['#4c8bf5', '#22a06b', '#e5793a', '#8e5bd8', '#d9a54c', '#c2417a', '#2fa4b8', '#7d8a2e', '#b5523b', '#5b6ee1']

export const view: View = {
  mount(host, app) {
    const { tr } = app
    const bar = el('div', 'am-bar')
    const mode = el('select')
    mode.append(new Option(tr('트리맵', 'Treemap'), 'treemap'), new Option(tr('선버스트', 'Sunburst'), 'sunburst'))
    const metric = el('select')
    metric.append(new Option(tr('파라미터 수', 'Parameters'), 'params'), new Option(tr('바이트', 'Bytes'), 'bytes'))
    const crumbs = el('span', 'am-info')
    bar.append(mode, metric, crumbs)
    const area = el('div', 'am-scroll')
    area.style.overflow = 'hidden'
    host.append(bar, area)
    let focus = ''
    let current: SVGSVGElement | null = null
    app.setExportSvg(() => current)
    const dark = () => app.theme() === 'dark'
    const weight = (m: ModuleNode) => {
      const s = app.stats.get(m.path)
      return s ? (metric.value === 'bytes' ? s.bytes : s.params) : 0
    }
    const fmt = (v: number) => (metric.value === 'bytes' ? fmtBytes(v) : fmtCount(v))

    function renderCrumbs() {
      crumbs.replaceChildren()
      const parts = focus ? focus.split('.') : []
      const mk = (label: string, path: string) => {
        const b = el('button', 'am-link', label)
        b.type = 'button'
        b.addEventListener('click', () => {
          focus = path
          draw()
        })
        return b
      }
      crumbs.append(mk(app.modules.name || 'model', ''))
      parts.forEach((p, i) => crumbs.append(' › ', mk(p, parts.slice(0, i + 1).join('.'))))
    }

    function draw() {
      renderCrumbs()
      const W = Math.max(200, area.clientWidth)
      const H = Math.max(160, area.clientHeight)
      const root = app.moduleByPath.get(focus) ?? app.modules
      const s = svg('svg', { xmlns: 'http://www.w3.org/2000/svg', width: W, height: H, viewBox: `0 0 ${W} ${H}` })
      s.append(svg('rect', { width: W, height: H, fill: dark() ? '#1e1f22' : '#ffffff' }))
      if (mode.value === 'treemap') treemap(s, root, { x: 0, y: 0, w: W, h: H }, 0, 0)
      else sunburst(s, root, W, H)
      current = s
      area.replaceChildren(s)
    }

    function click(m: ModuleNode) {
      app.detail(moduleDetail(app, m.path))
      if (m.children.length) {
        focus = m.path
        draw()
      }
    }

    function label(g: SVGElement, x: number, y: number, text: string, size: number, color: string) {
      const t = svg('text', { x, y, 'font-size': size, fill: color, 'font-family': 'system-ui, sans-serif', 'pointer-events': 'none' })
      t.textContent = text
      g.append(t)
    }

    function treemap(s: SVGSVGElement, node: ModuleNode, r: Rect, depth: number, colorIdx: number) {
      const kids = node.children.filter((c) => weight(c) > 0)
      // Tensors owned directly by this module count as a "(own)" block.
      const own = weight(node) - kids.reduce((a, c) => a + weight(c), 0)
      const ws = [...kids.map(weight), Math.max(0, own)]
      const rects = squarify(ws, r)
      const total = weight(app.moduleByPath.get(focus) ?? app.modules) || 1
      kids.forEach((c, i) => {
        const q = rects[i]
        if (q.w < 1 || q.h < 1) return
        const col = PALETTE[(depth === 0 ? i : colorIdx) % PALETTE.length]
        const g = svg('g', { cursor: 'pointer' })
        g.dataset.path = c.path
        const rect = svg('rect', { x: q.x + 1, y: q.y + 1, width: Math.max(0, q.w - 2), height: Math.max(0, q.h - 2), fill: col, 'fill-opacity': depth === 0 ? 0.85 : 0.55 + 0.1 * Math.min(depth, 3), stroke: dark() ? '#1e1f22' : '#fff', 'stroke-width': 1 })
        const title = svg('title')
        const v = weight(c)
        title.textContent = `${c.path} · ${shortType(c.type)} · ${fmt(v)} (${((v / total) * 100).toFixed(1)}%)`
        rect.append(title)
        g.append(rect)
        g.addEventListener('click', (e) => {
          e.stopPropagation()
          click(c)
        })
        s.append(g)
        if (q.w > 60 && q.h > 30) {
          label(s, q.x + 6, q.y + 16, `${c.name}${c.type ? ` · ${shortType(c.type)}` : ''}`.slice(0, Math.floor(q.w / 6.5)), 11, '#fff')
          label(s, q.x + 6, q.y + 30, `${fmt(v)} · ${((v / total) * 100).toFixed(1)}%`, 10, '#f0f0f0')
        }
        // One nested level inside large blocks.
        if (depth < 1 && c.children.length && q.w > 120 && q.h > 80) treemap(s, c, { x: q.x + 4, y: q.y + 36, w: q.w - 8, h: q.h - 40 }, depth + 1, depth === 0 ? i : colorIdx)
      })
      const o = rects[kids.length]
      if (o && o.w > 1 && o.h > 1) {
        s.append(svg('rect', { x: o.x + 1, y: o.y + 1, width: Math.max(0, o.w - 2), height: Math.max(0, o.h - 2), fill: dark() ? '#555' : '#bbb', 'fill-opacity': 0.6 }))
        if (o.w > 60 && o.h > 20) label(s, o.x + 6, o.y + 16, tr(`(직속) ${fmt(own)}`, `(own) ${fmt(own)}`), 10, dark() ? '#eee' : '#222')
      }
    }

    function sunburst(s: SVGSVGElement, root: ModuleNode, W: number, H: number) {
      const cx = W / 2
      const cy = H / 2
      const R = Math.min(W, H) / 2 - 8
      const levels = 4
      const ring = R / (levels + 0.6)
      const total = weight(root) || 1
      const center = svg('circle', { cx, cy, r: ring * 0.6, fill: dark() ? '#2b2d31' : '#f0f0f0', cursor: 'pointer' })
      center.addEventListener('click', () => {
        if (!focus) return
        focus = focus.includes('.') ? focus.slice(0, focus.lastIndexOf('.')) : ''
        draw()
      })
      s.append(center)
      label(s, cx - 30, cy + 4, fmt(total), 11, dark() ? '#eee' : '#222')
      const arc = (a0: number, a1: number, r0: number, r1: number) => {
        const large = a1 - a0 > Math.PI ? 1 : 0
        const p = (a: number, r: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
        if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4
        return `M${p(a0, r0)} L${p(a0, r1)} A${r1},${r1} 0 ${large} 1 ${p(a1, r1)} L${p(a1, r0)} A${r0},${r0} 0 ${large} 0 ${p(a0, r0)} Z`
      }
      const visit = (m: ModuleNode, a0: number, a1: number, depth: number, colorIdx: number) => {
        if (depth > levels) return
        let a = a0
        m.children.forEach((c, i) => {
          const v = weight(c)
          if (v <= 0) return
          const span = ((a1 - a0) * v) / Math.max(1, weight(m))
          if (span < 0.003) {
            a += span
            return
          }
          const ci = depth === 1 ? i : colorIdx
          const path = svg('path', { d: arc(a, a + span, ring * (depth - 0.4), ring * (depth + 0.6) - 1), fill: PALETTE[ci % PALETTE.length], 'fill-opacity': 0.95 - depth * 0.15, stroke: dark() ? '#1e1f22' : '#fff', 'stroke-width': 1, cursor: 'pointer' })
          const t = svg('title')
          t.textContent = `${c.path} · ${shortType(c.type)} · ${fmt(v)} (${((v / total) * 100).toFixed(1)}%)`
          path.append(t)
          path.dataset.path = c.path
          path.addEventListener('click', () => click(c))
          s.append(path)
          visit(c, a, a + span, depth + 1, ci)
          a += span
        })
      }
      visit(root, -Math.PI / 2, (Math.PI * 3) / 2, 1, 0)
    }

    mode.addEventListener('change', draw, { signal: app.signal })
    metric.addEventListener('change', draw, { signal: app.signal })
    const ro = new ResizeObserver(() => draw())
    ro.observe(area)
    draw()
    void fmtInt
    return () => ro.disconnect()
  }
}
