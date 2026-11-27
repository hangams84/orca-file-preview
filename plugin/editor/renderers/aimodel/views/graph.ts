/** Graph view: the operator DAG with collapsible module groups, top-down / left-right layout,
 *  pan/zoom (wheel, drag, pinch), minimap, search and node details. Weights are shown inside their
 *  consumer node (not as nodes). Large graphs start collapsed to module groups and only nodes in view
 *  are put in the DOM. */
import type { Graph, GraphNode } from '../ir.ts'
import { layout, type LayoutResult } from '../layout.ts'
import { CATEGORY_COLORS, el, fmtCount, fmtInt, fmtShape, fmtValue, kvTable, opCategory, shortType, svg, type App, type View } from './common.ts'
import { tensorLink } from './detail.ts'

const CSS = `
.am-graph { flex: 1 1 auto; position: relative; overflow: hidden; touch-action: none; cursor: grab; min-height: 0; }
.am-graph.drag { cursor: grabbing; }
.am-graph svg.main { position: absolute; inset: 0; width: 100%; height: 100%; }
.am-graph .nd { cursor: pointer; }
.am-graph .nd text { pointer-events: none; }
.am-graph .nd.sel rect { stroke: var(--orca-ring, #2563eb); stroke-width: 2.5; }
.am-graph .nd.hit rect { stroke: #e5a50a; stroke-width: 2.5; }
.am-mini { position: absolute; right: 8px; bottom: 8px; width: 160px; height: 120px; border: 1px solid var(--orca-border, #ccc); border-radius: 6px;
  background: var(--orca-card, #fafafa); opacity: .92; cursor: pointer; }
@media (max-width: 600px) { .am-mini { width: 100px; height: 80px; } }
`

interface Item {
  id: string
  kind: 'op' | 'group' | 'input' | 'output'
  label: string
  sub: string
  width: number
  height: number
  node?: GraphNode
  group?: string
  count?: number
}

const NODE_H = 38
const CHAR_W = 6.6

export const view: View = {
  mount(host, app) {
    const { tr } = app
    const g = app.ir.graph as Graph
    const style = el('style', undefined, CSS)
    const bar = el('div', 'am-bar')
    const search = el('input')
    search.type = 'search'
    search.placeholder = tr('노드·연산·모듈 검색', 'Search nodes, ops, modules')
    const dirBtn = el('button', undefined, '↕ TB')
    dirBtn.title = tr('위→아래 / 왼쪽→오른쪽', 'Top-down / left-right')
    const fitBtn = el('button', undefined, tr('맞춤', 'Fit'))
    const zoomIn = el('button', undefined, '+')
    const zoomOut = el('button', undefined, '−')
    const expandBtn = el('button', undefined, tr('펼치기 +', 'Expand +'))
    expandBtn.title = tr('그룹을 한 단계 더 펼칩니다', 'Expand groups one level')
    const collapseBtn = el('button', undefined, tr('접기 −', 'Collapse −'))
    const info = el('span', 'am-info')
    bar.append(search, dirBtn, zoomOut, zoomIn, fitBtn, collapseBtn, expandBtn, info)
    const area = el('div', 'am-graph')
    const main = svg('svg', { class: 'main' })
    const defs = svg('defs')
    const marker = svg('marker', { id: 'am-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' })
    marker.append(svg('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'context-stroke' }))
    defs.append(marker)
    const scene = svg('g')
    const edgeLayer = svg('g')
    const nodeLayer = svg('g')
    scene.append(edgeLayer, nodeLayer)
    main.append(defs, scene)
    const mini = el('canvas', 'am-mini')
    area.append(main, mini)
    host.append(style, bar, area)

    // Values: producer node per value; weight values stay inside nodes.
    const producer = new Map<string, string>()
    for (const n of g.nodes) for (const o of n.outputs) producer.set(o, n.id)
    const valueById = new Map(g.values.map((v) => [v.id, v]))
    const nodeById = new Map(g.nodes.map((n) => [n.id, n]))

    // Module groups: each module path that owns nodes, and its ancestors.
    const groupCount = new Map<string, number>()
    for (const n of g.nodes) {
      if (!n.module) continue
      const parts = n.module.split('.')
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('.')
        groupCount.set(p, (groupCount.get(p) ?? 0) + 1)
      }
    }
    const expanded = new Set<string>()
    // Expand level by level while the visible graph stays readable.
    const visibleCount = () => buildItems().items.length
    const levels = [...new Set([...groupCount.keys()].map((p) => p.split('.').length))].sort((a, b) => a - b)
    const budget = app.compact ? 120 : 400
    for (const lvl of levels) {
      const add = [...groupCount.keys()].filter((p) => p.split('.').length === lvl)
      add.forEach((p) => expanded.add(p))
      if (visibleCount() > budget) {
        add.forEach((p) => expanded.delete(p))
        break
      }
    }
    let dir: 'TB' | 'LR' = 'TB'
    let selected = ''
    let res: LayoutResult | null = null
    let items: Item[] = []
    let itemById = new Map<string, Item>()
    let edges: { from: string; to: string }[] = []
    let view = { x: 0, y: 0, k: 1 }
    const dark = () => app.theme() === 'dark'

    /** The visible item an op node collapses into: its outermost collapsed group, or itself. */
    function visibleOf(n: GraphNode): string {
      if (!n.module) return n.id
      const parts = n.module.split('.')
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('.')
        if (!expanded.has(p) && groupCount.has(p) && (groupCount.get(p) ?? 0) > 1) return `g:${p}`
      }
      return n.id
    }

    function weightLabel(n: GraphNode): string {
      const w = n.inputs.map((i) => valueById.get(i)).filter((v) => v?.tensor)
      if (!w.length) return ''
      const first = w[0]!
      return `W ${fmtShape(first.shape ?? [])}${w.length > 1 ? ` +${w.length - 1}` : ''}`
    }

    function buildItems(): { items: Item[]; edges: { from: string; to: string }[] } {
      const out: Item[] = []
      const seen = new Map<string, Item>()
      const vis = new Map<string, string>()
      for (const n of g.nodes) {
        const v = visibleOf(n)
        vis.set(n.id, v)
        if (seen.has(v)) {
          seen.get(v)!.count!++
          continue
        }
        let it: Item
        if (v.startsWith('g:')) {
          const p = v.slice(2)
          const m = app.moduleByPath.get(p)
          const st = app.stats.get(p)
          const label = `▸ ${p}`
          const sub = `${shortType(m?.type) || tr('그룹', 'group')} · ${st ? fmtCount(st.params) : '0'}`
          it = { id: v, kind: 'group', label, sub, width: Math.max(label.length, sub.length) * CHAR_W + 24, height: NODE_H + 6, group: p, count: 1 }
        } else {
          const sub = [n.module ? n.module.split('.').slice(-2).join('.') : '', weightLabel(n)].filter(Boolean).join(' · ')
          it = { id: v, kind: 'op', label: n.op, sub, width: Math.max(n.op.length * (CHAR_W + 0.6), sub.length * (CHAR_W - 0.6)) + 24, height: NODE_H, node: n, count: 1 }
        }
        it.width = Math.min(Math.max(it.width, 72), 260)
        seen.set(v, it)
        out.push(it)
      }
      const es = new Set<string>()
      const edgesOut: { from: string; to: string }[] = []
      const addEdge = (a: string, b: string) => {
        if (a === b) return
        const k = `${a}\u0000${b}`
        if (es.has(k)) return
        es.add(k)
        edgesOut.push({ from: a, to: b })
      }
      for (const inp of g.inputs) {
        const v = valueById.get(inp)
        if (v?.tensor) continue
        const it: Item = { id: `in:${inp}`, kind: 'input', label: inp.replace(/^%/, ''), sub: v?.shape ? fmtShape(v.shape) : tr('입력', 'input'), width: 0, height: 30 }
        it.width = Math.min(220, Math.max(70, Math.max(it.label.length, it.sub.length) * CHAR_W + 20))
        out.push(it)
        seen.set(it.id, it)
      }
      for (const outp of g.outputs) {
        const v = valueById.get(outp)
        const it: Item = { id: `out:${outp}`, kind: 'output', label: tr('출력', 'output'), sub: v?.shape ? fmtShape(v.shape) : outp, width: 0, height: 30 }
        it.width = Math.min(220, Math.max(70, Math.max(it.label.length, it.sub.length) * CHAR_W + 20))
        out.push(it)
        seen.set(it.id, it)
        const p = producer.get(outp)
        if (p) addEdge(vis.get(p)!, it.id)
      }
      const inputSet = new Set(g.inputs)
      for (const n of g.nodes) {
        const to = vis.get(n.id)!
        for (const i of n.inputs) {
          const p = producer.get(i)
          if (p) addEdge(vis.get(p)!, to)
          else if (inputSet.has(i) && seen.has(`in:${i}`)) addEdge(`in:${i}`, to)
        }
      }
      for (const it of out) if (it.kind === 'group' && it.count) it.sub += ` · ${it.count} ops`
      return { items: out, edges: edgesOut }
    }

    function relayout(keepView = false) {
      const built = buildItems()
      items = built.items
      edges = built.edges
      itemById = new Map(items.map((i) => [i.id, i]))
      res = layout(items.map((i) => ({ id: i.id, width: i.width, height: i.height })), edges, { direction: dir, rankGap: dir === 'TB' ? 34 : 48, nodeGap: 16 })
      info.textContent = tr(`연산 ${fmtInt(g.nodes.length)} · 표시 ${fmtInt(items.length)}`, `${fmtInt(g.nodes.length)} ops · ${fmtInt(items.length)} shown`)
      collapseBtn.disabled = ![...expanded].some((p) => (groupCount.get(p) ?? 0) > 1)
      expandBtn.disabled = [...groupCount.keys()].every((p) => expanded.has(p) || (groupCount.get(p) ?? 0) <= 1)
      if (!keepView) fit()
      else draw()
      drawMini()
    }

    function fit() {
      if (!res) return
      const W = area.clientWidth || 600
      const H = area.clientHeight || 400
      const k = Math.min(1.2, Math.max(0.05, Math.min((W - 40) / Math.max(1, res.width), (H - 40) / Math.max(1, res.height))))
      // Tall graphs: fit the width and start at the top rather than shrinking to dots.
      const kk = res.height * k < H * 0.5 && dir === 'TB' ? k : Math.max(k, Math.min(1, (W - 40) / Math.max(1, res.width)))
      view = { k: kk, x: (W - res.width * kk) / 2, y: res.height * kk < H ? (H - res.height * kk) / 2 : 20 }
      draw()
    }

    const NODE_TEXT = () => (dark() ? '#eee' : '#111')
    const SUB_TEXT = () => (dark() ? '#aab' : '#555')

    function nodeEl(it: Item, pos: { x: number; y: number; width: number; height: number }): SVGGElement {
      const gEl = svg('g', { class: 'nd' + (it.id === selected ? ' sel' : ''), transform: `translate(${pos.x},${pos.y})` })
      gEl.dataset.id = it.id
      const cat = it.kind === 'op' ? opCategory(it.node!.op) : it.kind === 'group' ? 'other' : 'io'
      const col = CATEGORY_COLORS[cat]
      const fill = it.kind === 'group' ? (dark() ? '#26303f' : '#eef3fb') : dark() ? col.dark : col.light
      const stroke = it.kind === 'group' ? '#4c8bf5' : dark() ? '#666' : '#999'
      const rect = svg('rect', { width: pos.width, height: pos.height, rx: it.kind === 'input' || it.kind === 'output' ? pos.height / 2 : 6, fill, stroke, 'stroke-width': 1 })
      if (it.kind === 'group') rect.setAttribute('stroke-dasharray', '5 3')
      gEl.append(rect)
      const t1 = svg('text', { x: 10, y: it.sub ? 15 : pos.height / 2 + 4, 'font-size': 12, 'font-weight': 600, fill: NODE_TEXT(), 'font-family': 'system-ui, sans-serif' })
      t1.textContent = clip(it.label, (pos.width - 18) / (CHAR_W + 0.4))
      gEl.append(t1)
      if (it.sub) {
        const t2 = svg('text', { x: 10, y: 29, 'font-size': 10, fill: SUB_TEXT(), 'font-family': 'system-ui, sans-serif' })
        t2.textContent = clip(it.sub, (pos.width - 18) / (CHAR_W - 1))
        gEl.append(t2)
      }
      if (it.kind === 'op' && col.label) {
        const b = svg('text', { x: pos.width - 6, y: 12, 'font-size': 9, 'text-anchor': 'end', fill: SUB_TEXT(), 'font-family': 'monospace' })
        b.textContent = col.label
        gEl.append(b)
      }
      const title = svg('title')
      title.textContent = it.kind === 'op' ? `${it.node!.op}${it.node!.name ? ` (${it.node!.name})` : ''}` : it.kind === 'group' ? tr(`${it.group}: 눌러서 펼치기`, `${it.group}: click to expand`) : it.label
      gEl.append(title)
      return gEl
    }

    let drawRaf = 0
    function draw() {
      drawRaf = 0
      if (!res) return
      scene.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`)
      const W = area.clientWidth
      const H = area.clientHeight
      const pad = 200
      const vx0 = (-view.x - pad) / view.k
      const vy0 = (-view.y - pad) / view.k
      const vx1 = (W - view.x + pad) / view.k
      const vy1 = (H - view.y + pad) / view.k
      const inView = (x: number, y: number, w: number, h: number) => x + w >= vx0 && x <= vx1 && y + h >= vy0 && y <= vy1
      const nodesFrag = document.createDocumentFragment()
      for (const it of items) {
        const p = res.nodes.get(it.id)!
        if (inView(p.x, p.y, p.width, p.height)) nodesFrag.append(nodeEl(it, p))
      }
      const edgesFrag = document.createDocumentFragment()
      const ec = dark() ? '#888' : '#8a8a8a'
      for (const e of res.edges) {
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const q of e.points) {
          minX = Math.min(minX, q.x)
          maxX = Math.max(maxX, q.x)
          minY = Math.min(minY, q.y)
          maxY = Math.max(maxY, q.y)
        }
        if (!inView(minX, minY, maxX - minX, maxY - minY)) continue
        edgesFrag.append(svg('path', { d: pathOf(e.points, dir), fill: 'none', stroke: ec, 'stroke-width': 1.2, 'marker-end': 'url(#am-arrow)' }))
      }
      nodeLayer.replaceChildren(nodesFrag)
      edgeLayer.replaceChildren(edgesFrag)
      drawMiniViewport()
    }
    const schedule = () => {
      if (!drawRaf) drawRaf = requestAnimationFrame(draw)
    }

    // Minimap.
    let miniScale = 1
    let miniBase: ImageData | null = null
    function drawMini() {
      if (!res) return
      const w = (mini.width = mini.clientWidth * devicePixelRatio || 160)
      const h = (mini.height = mini.clientHeight * devicePixelRatio || 120)
      const c = mini.getContext('2d')!
      miniScale = Math.min(w / Math.max(1, res.width), h / Math.max(1, res.height))
      c.clearRect(0, 0, w, h)
      for (const it of items) {
        const p = res.nodes.get(it.id)!
        c.fillStyle = it.kind === 'group' ? '#4c8bf5' : it.kind === 'op' ? (dark() ? CATEGORY_COLORS[opCategory(it.node!.op)].dark : '#8aa4cf') : '#999'
        c.fillRect(p.x * miniScale, p.y * miniScale, Math.max(1, p.width * miniScale), Math.max(1, p.height * miniScale))
      }
      miniBase = c.getImageData(0, 0, w, h)
      drawMiniViewport()
    }
    function drawMiniViewport() {
      if (!miniBase || !res) return
      const c = mini.getContext('2d')!
      c.putImageData(miniBase, 0, 0)
      c.strokeStyle = dark() ? '#fff' : '#d33'
      c.lineWidth = Math.max(1, devicePixelRatio)
      c.strokeRect((-view.x / view.k) * miniScale, (-view.y / view.k) * miniScale, (area.clientWidth / view.k) * miniScale, (area.clientHeight / view.k) * miniScale)
    }
    const miniMove = (e: PointerEvent) => {
      const r = mini.getBoundingClientRect()
      const gx = ((e.clientX - r.left) * devicePixelRatio) / miniScale
      const gy = ((e.clientY - r.top) * devicePixelRatio) / miniScale
      view.x = area.clientWidth / 2 - gx * view.k
      view.y = area.clientHeight / 2 - gy * view.k
      schedule()
    }
    mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      mini.setPointerCapture(e.pointerId)
      miniMove(e)
      const mv = (ev: PointerEvent) => miniMove(ev)
      const up = () => {
        mini.removeEventListener('pointermove', mv)
        mini.removeEventListener('pointerup', up)
      }
      mini.addEventListener('pointermove', mv)
      mini.addEventListener('pointerup', up)
    }, { signal: app.signal })

    // Pan / zoom / pinch / click.
    const pointers = new Map<number, { x: number; y: number }>()
    let moved = false
    let pinch0 = 0
    area.addEventListener('pointerdown', (e) => {
      if (e.target === mini) return
      area.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      moved = false
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y)
      }
      area.classList.add('drag')
    }, { signal: app.signal })
    area.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const cur = { x: e.clientX, y: e.clientY }
      if (pointers.size === 2) {
        pointers.set(e.pointerId, cur)
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch0 > 0) {
          const r = area.getBoundingClientRect()
          zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinch0)
          pinch0 = d
        }
        moved = true
        return
      }
      const dx = cur.x - prev.x
      const dy = cur.y - prev.y
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
      view.x += dx
      view.y += dy
      pointers.set(e.pointerId, cur)
      schedule()
    }, { signal: app.signal })
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (!pointers.size) area.classList.remove('drag')
      if (!moved && e.type === 'pointerup') {
        const target = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest?.('.nd') as SVGGElement | null
        if (target?.dataset.id) select(target.dataset.id, true)
      }
    }
    area.addEventListener('pointerup', end, { signal: app.signal })
    area.addEventListener('pointercancel', end, { signal: app.signal })
    area.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = area.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
      else {
        view.x -= e.deltaX
        view.y -= e.deltaY
        schedule()
      }
    }, { passive: false, signal: app.signal })
    function zoomAt(px: number, py: number, f: number) {
      const k = Math.max(0.02, Math.min(4, view.k * f))
      view.x = px - ((px - view.x) * k) / view.k
      view.y = py - ((py - view.y) * k) / view.k
      view.k = k
      schedule()
    }
    zoomIn.addEventListener('click', () => zoomAt(area.clientWidth / 2, area.clientHeight / 2, 1.25), { signal: app.signal })
    zoomOut.addEventListener('click', () => zoomAt(area.clientWidth / 2, area.clientHeight / 2, 0.8), { signal: app.signal })
    fitBtn.addEventListener('click', fit, { signal: app.signal })
    dirBtn.addEventListener('click', () => {
      dir = dir === 'TB' ? 'LR' : 'TB'
      dirBtn.textContent = dir === 'TB' ? '↕ TB' : '↔ LR'
      relayout()
    }, { signal: app.signal })
    expandBtn.addEventListener('click', () => {
      const cand = [...groupCount.keys()].filter((p) => !expanded.has(p) && (groupCount.get(p) ?? 0) > 1)
      if (!cand.length) return
      const lvl = Math.min(...cand.map((p) => p.split('.').length))
      cand.filter((p) => p.split('.').length === lvl).forEach((p) => expanded.add(p))
      relayout()
    }, { signal: app.signal })
    collapseBtn.addEventListener('click', () => {
      // Fold the deepest level of groups that hold more than one op (single-op groups do not fold).
      const foldable = [...expanded].filter((p) => (groupCount.get(p) ?? 0) > 1)
      if (!foldable.length) return
      const lvl = Math.max(...foldable.map((p) => p.split('.').length))
      ;[...expanded].filter((p) => p.split('.').length >= lvl).forEach((p) => expanded.delete(p))
      relayout()
    }, { signal: app.signal })

    function centerOn(id: string) {
      const p = res?.nodes.get(id)
      if (!p) return
      view.x = area.clientWidth / 2 - (p.x + p.width / 2) * view.k
      view.y = area.clientHeight / 2 - (p.y + p.height / 2) * view.k
      schedule()
    }

    function select(id: string, fromClick = false) {
      const it = itemById.get(id)
      if (!it) return
      if (it.kind === 'group' && fromClick && selected === id) {
        // Second click on a group expands it.
        expanded.add(it.group!)
        selected = ''
        relayout(true)
        return
      }
      selected = id
      schedule()
      app.detail(detailOf(it))
    }

    function detailOf(it: Item): HTMLElement {
      const box = el('div')
      if (it.kind === 'group') {
        box.append(el('h3', undefined, it.group!), el('div', 'sub', `${app.moduleByPath.get(it.group!)?.type ?? tr('모듈 그룹', 'module group')} · ${it.count} ops`))
        const b = el('button', 'am-link', tr('이 그룹 펼치기', 'Expand this group'))
        b.type = 'button'
        b.addEventListener('click', () => {
          expanded.add(it.group!)
          relayout(true)
        })
        const t = el('button', 'am-link', tr('모듈 트리에서 보기', 'Show in the module tree'))
        t.type = 'button'
        t.addEventListener('click', () => app.show('tree', it.group!))
        box.append(b, el('br'), t)
        return box
      }
      if (it.kind !== 'op') {
        box.append(el('h3', undefined, it.label), el('div', 'sub', it.sub))
        return box
      }
      const n = it.node!
      box.append(el('h3', undefined, n.op), el('div', 'sub', [n.domain, n.name].filter(Boolean).join(' · ')))
      if (n.module) {
        const m = app.moduleByPath.get(n.module)
        const b = el('button', 'am-link', `${n.module}${m?.type ? ` (${shortType(m.type)})` : ''}`)
        b.type = 'button'
        b.addEventListener('click', () => app.show('tree', n.module!))
        const parts = n.module.split('.')
        const coll = el('button', 'am-link', tr('이 모듈 접기', 'Collapse this module'))
        coll.type = 'button'
        coll.addEventListener('click', () => {
          for (let i = parts.length; i >= 1; i--) {
            const p = parts.slice(0, i).join('.')
            if ((groupCount.get(p) ?? 0) > 1) {
              expanded.delete(p)
              ;[...expanded].filter((x) => x.startsWith(p + '.')).forEach((x) => expanded.delete(x))
              break
            }
          }
          relayout(true)
        })
        box.append(el('h4', undefined, tr('모듈', 'Module')), b, el('br'), coll)
      }
      if (n.attrs && Object.keys(n.attrs).length) {
        box.append(el('h4', undefined, tr('속성', 'Attributes')))
        box.append(kvTable(Object.entries(n.attrs).map(([k, v]) => [k, fmtValue(v)])))
      }
      const ioTable = (ids: string[]) => {
        const t = el('table', 'am-kv')
        ids.forEach((id, i) => {
          const v = valueById.get(id)
          const r = el('tr')
          const a = el('td', 'am-mono', String(i))
          const b = el('td', 'am-mono')
          if (v?.tensor) b.append(tensorLink(app, v.tensor), ` ${v.dtype ?? ''} ${v.shape ? fmtShape(v.shape) : ''}`)
          else {
            const p = producer.get(id)
            const name = p ? `${nodeById.get(p)?.op ?? ''} → ${id}` : id
            b.append(name, v?.shape ? ` ${fmtShape(v.shape)}` : '', v?.dtype ? ` ${v.dtype}` : '')
          }
          r.append(a, b)
          t.append(r)
        })
        return t
      }
      if (n.inputs.length) box.append(el('h4', undefined, tr('입력', 'Inputs')), ioTable(n.inputs))
      if (n.outputs.length) box.append(el('h4', undefined, tr('출력', 'Outputs')), ioTable(n.outputs))
      return box
    }

    // Search: highlight matches, Enter jumps to the next one (expanding its groups).
    let hits: string[] = []
    let hitIdx = 0
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase()
      hits = q ? g.nodes.filter((n) => n.op.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q) || (n.module ?? '').toLowerCase().includes(q)).map((n) => n.id) : []
      hitIdx = 0
      info.textContent = q ? tr(`${hits.length}개 일치 · Enter로 이동`, `${hits.length} match${hits.length === 1 ? '' : 'es'} · Enter to jump`) : tr(`연산 ${fmtInt(g.nodes.length)} · 표시 ${fmtInt(items.length)}`, `${fmtInt(g.nodes.length)} ops · ${fmtInt(items.length)} shown`)
    }, { signal: app.signal })
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !hits.length) return
      const id = hits[hitIdx++ % hits.length]
      const n = nodeById.get(id)!
      if (n.module) {
        const parts = n.module.split('.')
        for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('.'))
      }
      relayout(true)
      centerOn(visibleOf(n))
      select(visibleOf(n))
    }, { signal: app.signal })

    app.setExportSvg(() => {
      if (!res) return null
      const out = svg('svg', { xmlns: 'http://www.w3.org/2000/svg', width: Math.ceil(res.width + 40), height: Math.ceil(res.height + 40), viewBox: `-20 -20 ${Math.ceil(res.width + 40)} ${Math.ceil(res.height + 40)}` })
      out.append(svg('rect', { x: -20, y: -20, width: res.width + 40, height: res.height + 40, fill: dark() ? '#1e1f22' : '#ffffff' }))
      out.append(defs.cloneNode(true))
      const eg = svg('g')
      for (const e of res.edges) eg.append(svg('path', { d: pathOf(e.points, dir), fill: 'none', stroke: '#8a8a8a', 'stroke-width': 1.2, 'marker-end': 'url(#am-arrow)' }))
      const ng = svg('g')
      for (const it of items) ng.append(nodeEl(it, res.nodes.get(it.id)!))
      out.append(eg, ng)
      return out
    })

    const ro = new ResizeObserver(() => {
      drawMini()
      schedule()
    })
    ro.observe(area)
    relayout()
    return () => {
      ro.disconnect()
      cancelAnimationFrame(drawRaf)
    }
  }
}

function clip(s: string, n: number): string {
  const m = Math.max(4, Math.floor(n))
  return s.length > m ? s.slice(0, m - 1) + '…' : s
}

/** Smooth path through layout points (vertical/horizontal tangents by direction). */
function pathOf(pts: { x: number; y: number }[], dir: 'TB' | 'LR'): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    if (dir === 'TB') {
      const my = (a.y + b.y) / 2
      d += ` C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`
    } else {
      const mx = (a.x + b.x) / 2
      d += ` C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`
    }
  }
  return d
}
