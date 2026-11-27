/** Architecture diagram: an NN-SVG / PlotNeuralNet-style block diagram inferred from module types,
 *  names and weight shapes (no execution): conv layers as 3-D boxes sized by channels, linear layers
 *  as bars, embeddings, norms and attention as blocks; repeated identical blocks fold into "×N". */
import type { ModuleNode } from '../ir.ts'
import { el, fmtCount, shortType, svg, type App, type View } from './common.ts'
import { moduleDetail } from './detail.ts'

export interface Block {
  kind: 'conv' | 'linear' | 'embed' | 'norm' | 'attn' | 'pool' | 'act' | 'group' | 'other'
  label: string
  /** Width-ish size (channels / features) for scaling. */
  size: number
  /** Kernel / extra text. */
  detail: string
  path: string
  repeat?: number
  children?: Block[]
}

const LAYER_TYPES = /conv|linear|dense|embedding|norm|attention|pool|lstm|gru|rnn|relu|gelu|silu|sigmoid|tanh|softmax|dropout|flatten|upsample|mlp/i

function kindOf(type: string, name: string): Block['kind'] {
  const t = `${type} ${name}`.toLowerCase()
  if (/conv/.test(t)) return 'conv'
  if (/attention|attn/.test(t)) return 'attn'
  if (/embedding|wte|wpe|embed/.test(t)) return 'embed'
  if (/norm/.test(t)) return 'norm'
  if (/pool|upsample/.test(t)) return 'pool'
  if (/relu|gelu|silu|sigmoid|tanh|softmax|dropout|flatten|activation/.test(t)) return 'act'
  if (/linear|dense|lm_head|fc|proj/.test(t)) return 'linear'
  return 'other'
}

/** Structural signature for folding repeated blocks. */
function signature(m: ModuleNode, app: App): string {
  const t = m.tensors.map((n) => app.tensorsByName.get(n)).map((x) => `${x?.name.slice(m.path.length)}:${x?.shape.join('x')}`).join(',')
  return `${shortType(m.type)}[${t}](${m.children.map((c) => `${c.name}=${signature(c, app)}`).join(';')})`
}

/** Leaf-ish layer list of the model with repeats folded. */
export function inferBlocks(app: App, root: ModuleNode, depth = 0): Block[] {
  const out: Block[] = []
  const leafBlock = (m: ModuleNode): Block | null => {
    const w = m.tensors.map((n) => app.tensorsByName.get(n)).find((t) => t && /weight|kernel|in_proj_weight/.test(t.name.split('.').pop() ?? ''))
    const type = shortType(m.type) || ''
    const kind = kindOf(type, m.name)
    if (kind === 'other' && !w && !m.tensors.length) return null
    let size = 1
    let detail = ''
    if (w) {
      const s = w.shape
      if (kind === 'conv' && s.length >= 3) {
        size = s[0]
        detail = `${s[1]}→${s[0]} · ${s.slice(2).join('×')}`
      } else if (s.length === 2) {
        size = kind === 'embed' ? s[1] : s[0]
        detail = kind === 'embed' ? `${s[0]} × ${s[1]}` : `${s[1]}→${s[0]}`
      } else if (s.length === 1) {
        size = s[0]
        detail = String(s[0])
      } else detail = s.join('×')
    }
    return { kind, label: type || m.name, size, detail, path: m.path }
  }
  const kids = root.children
  let i = 0
  while (i < kids.length) {
    const c = kids[i]
    const isLeaf = !c.children.length
    if (isLeaf) {
      const b = leafBlock(c)
      if (b) out.push(b)
      i++
      continue
    }
    // Fold runs of structurally identical siblings (transformer blocks, ResNet blocks).
    const sig = signature(c, app)
    let j = i + 1
    while (j < kids.length && kids[j].children.length && signature(kids[j], app) === sig) j++
    const inner = depth < 3 ? inferBlocks(app, c, depth + 1) : []
    const st = app.stats.get(c.path)
    const isBlock = j - i > 1 || /block|layer|stage|encoder|decoder|bottleneck|basicblock/i.test(`${c.type} ${c.name}`)
    if (isBlock || inner.length > 6) out.push({ kind: 'group', label: shortType(c.type) || c.name, size: st?.params ?? 0, detail: `${c.path}${j - i > 1 ? ` … ${kids[j - 1].name}` : ''}`, path: c.path, repeat: j - i, children: inner })
    else out.push(...inner)
    i = j
  }
  // Leaf modules at the root (e.g. inferred trees where tensors sit at the top).
  if (!kids.length && root.tensors.length) {
    const b = leafBlock(root)
    if (b) out.push(b)
  }
  return out
}

const COLORS: Record<Block['kind'], [string, string]> = {
  conv: ['#5d9cec', '#2a5ea8'],
  linear: ['#a3d977', '#4f8a2a'],
  embed: ['#f2b950', '#9a6a10'],
  norm: ['#9ad0c2', '#3b7d6e'],
  attn: ['#b993e6', '#6b3fa0'],
  pool: ['#d0d0d0', '#808080'],
  act: ['#f6c0a8', '#b5523b'],
  group: ['#e8eef9', '#4c8bf5'],
  other: ['#e0e0e0', '#888']
}

export const view: View = {
  mount(host, app) {
    const { tr } = app
    const bar = el('div', 'am-bar')
    const note = el('span', 'am-inferred', tr('⚠ 모듈 형식·이름·가중치 모양에서 추론한 도식입니다 (실행하지 않음, 실제 데이터 흐름과 다를 수 있음).', '⚠ Inferred from module types, names and weight shapes (nothing executed; may differ from the real data flow).'))
    bar.append(note)
    const area = el('div', 'am-scroll')
    host.append(bar, area)
    let current: SVGSVGElement | null = null
    app.setExportSvg(() => current)
    const blocks = inferBlocks(app, app.modules)
    if (!blocks.length) {
      area.append(el('div', 'am-empty', tr('도식으로 그릴 층을 찾지 못했습니다.', 'No layers to draw were found.')))
      return
    }
    const dark = app.theme() === 'dark'
    const maxSize = Math.max(...blocks.flatMap((b) => [b.size, ...(b.children ?? []).map((c) => c.size)]).filter((x) => x > 0), 2)
    const hOf = (size: number) => 30 + 110 * (Math.log2(Math.max(1, size)) / Math.log2(Math.max(2, maxSize)))
    const H = 260
    const base = 190
    const parts: { draw: (g: SVGGElement, x: number) => number }[] = []
    const text = (g: SVGElement, x: number, y: number, s: string, size = 10, anchor = 'middle', fill = dark ? '#ddd' : '#333', rotate = false) => {
      const t = svg('text', { x, y, 'font-size': size, 'text-anchor': anchor, fill, 'font-family': 'system-ui, sans-serif' })
      if (rotate) t.setAttribute('transform', `rotate(-60 ${x} ${y})`)
      t.textContent = s
      g.append(t)
    }
    const drawBlock = (g: SVGGElement, b: Block, x: number, scale = 1): number => {
      const [fill, stroke] = COLORS[b.kind]
      const h = hOf(b.size) * scale
      const top = base - h
      let w = 14
      const grp = svg('g', { cursor: 'pointer' })
      grp.dataset.path = b.path
      grp.addEventListener('click', () => app.detail(moduleDetail(app, b.path)))
      const title = svg('title')
      title.textContent = `${b.path} · ${b.label} ${b.detail}`
      if (b.kind === 'conv') {
        w = 10 + Math.min(30, Math.log2(Math.max(2, b.size)) * 3)
        const d = 14
        grp.append(svg('path', { d: `M${x} ${top} l${d} ${-d} h${w} v${h} l${-d} ${d} z`, fill, stroke, 'stroke-width': 1 }))
        grp.append(svg('path', { d: `M${x} ${top} h${w} v${h} h${-w} z`, fill, stroke, 'stroke-width': 1, 'fill-opacity': 0.9 }))
        grp.append(svg('path', { d: `M${x + w} ${top} l${d} ${-d} M${x + w} ${top + h} l${d} ${-d}`, stroke, fill: 'none' }))
        w += d
      } else if (b.kind === 'linear') {
        w = 12
        grp.append(svg('rect', { x, y: top, width: w, height: h, fill, stroke, rx: 2 }))
      } else if (b.kind === 'norm' || b.kind === 'act') {
        w = 6
        grp.append(svg('rect', { x, y: base - 60 * scale, width: w, height: 60 * scale, fill, stroke, rx: 2 }))
      } else if (b.kind === 'pool') {
        w = 10
        grp.append(svg('path', { d: `M${x} ${base - 70 * scale} l${w} 15 v${40 * scale} l${-w} 15 z`, fill, stroke }))
      } else {
        w = 26
        grp.append(svg('rect', { x, y: top, width: w, height: h, fill, stroke, rx: 4 }))
      }
      grp.append(title)
      g.append(grp)
      text(g, x + w / 2, base + 14, b.label.slice(0, 14), 9.5, 'end', undefined, true)
      return w
    }
    for (const b of blocks.slice(0, 80)) {
      parts.push({
        draw: (g, x) => {
          if (b.kind !== 'group') return drawBlock(g, b, x)
          // A folded group: its inner layers small, framed, with ×N.
          const inner = (b.children ?? []).slice(0, 12)
          const start = x
          let cx = x + 8
          for (const c of inner) cx += drawBlock(g, c, cx, 0.7) + 4
          if (!inner.length) cx += 30
          const w = cx - start + 4
          const [fill, stroke] = COLORS.group
          g.insertBefore(svg('rect', { x: start, y: 34, width: w, height: base - 22, fill: dark ? '#26303f' : fill, stroke, 'stroke-dasharray': '5 3', rx: 6 }), g.firstChild)
          text(g, start + 6, 48, `${b.label}${b.repeat && b.repeat > 1 ? `  ×${b.repeat}` : ''}`, 11, 'start', dark ? '#9cf' : '#2a5ea8')
          text(g, start + 6, 61, fmtCount(b.size), 9.5, 'start')
          const hit = svg('rect', { x: start, y: 34, width: w, height: 30, fill: 'transparent', cursor: 'pointer' })
          hit.addEventListener('click', () => app.detail(moduleDetail(app, b.path)))
          g.append(hit)
          return w
        }
      })
    }
    // Measure by drawing into a group, then size the SVG.
    const g = svg('g')
    let x = 16
    const arrows: number[] = []
    for (const p of parts) {
      x += p.draw(g, x)
      arrows.push(x + 2)
      x += 14
    }
    arrows.pop()
    for (const ax of arrows) g.append(svg('path', { d: `M${ax} ${base - 20} h8`, stroke: dark ? '#888' : '#999', 'marker-end': 'url(#am-arr2)', fill: 'none' }))
    const W = x + 16
    const s = svg('svg', { xmlns: 'http://www.w3.org/2000/svg', width: W, height: H, viewBox: `0 0 ${W} ${H}` })
    const defs = svg('defs')
    const mk = svg('marker', { id: 'am-arr2', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' })
    mk.append(svg('path', { d: 'M0 0 L10 5 L0 10 z', fill: dark ? '#888' : '#999' }))
    defs.append(mk)
    s.append(defs, svg('rect', { width: W, height: H, fill: dark ? '#1e1f22' : '#ffffff' }), g)
    text(s, 8, 18, `${app.ir.formatLabel} · ${fmtCount(app.stats.get('')?.params ?? 0)} params · ${tr('추론된 도식', 'inferred diagram')}`, 11, 'start')
    current = s
    area.append(s)
    if (blocks.length > 80) area.append(el('div', 'am-info am-pad', tr(`층 ${blocks.length}개 중 80개만 그렸습니다.`, `Drew 80 of ${blocks.length} layers.`)))
    void LAYER_TYPES
  }
}
