/** Outlines of draw.io's built-in shapes in a w×h box (origin top-left), and their perimeters. */
import { fmt, type P } from './svg.ts'
import type { Terminal } from './edges.ts'

export interface ShapeGeometry {
  /** Filled and stroked outline. */
  fill?: string
  /** Stroke-only details drawn over the fill (cylinder rim, process bars, note fold). */
  lines?: string
  /** Filled detail drawn last (e.g. the folded corner of a note). */
  fillLines?: string
  /** Filled but not stroked (partial rectangles stroke only some sides). */
  fillOnly?: string
  /** Swimlane title band and body. */
  band?: string
  body?: string
  /** Honours `direction=north|south|west` by rotating the box. */
  directional?: boolean
}

type Style = Record<string, string>

const n = (st: Style, k: string, d: number): number => {
  const v = parseFloat(st[k])
  return Number.isFinite(v) ? v : d
}

const poly = (pts: [number, number][]): string => `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}Z`

function roundRect(w: number, h: number, r: number): string {
  if (r <= 0) return poly([[0, 0], [w, 0], [w, h], [0, h]])
  r = Math.min(r, w / 2, h / 2)
  return `M${fmt(r)} 0H${fmt(w - r)}Q${fmt(w)} 0 ${fmt(w)} ${fmt(r)}V${fmt(h - r)}Q${fmt(w)} ${fmt(h)} ${fmt(w - r)} ${fmt(h)}H${fmt(r)}Q0 ${fmt(h)} 0 ${fmt(h - r)}V${fmt(r)}Q0 0 ${fmt(r)} 0Z`
}

function ellipse(x: number, y: number, w: number, h: number): string {
  const rx = w / 2
  const ry = h / 2
  return `M${fmt(x)} ${fmt(y + ry)}A${fmt(rx)} ${fmt(ry)} 0 1 1 ${fmt(x + w)} ${fmt(y + ry)}A${fmt(rx)} ${fmt(ry)} 0 1 1 ${fmt(x)} ${fmt(y + ry)}Z`
}

/** Corner radius of a `rounded=1` rectangle (arcSize is a percentage unless absoluteArcSize=1). */
export function arcRadius(st: Style, w: number, h: number): number {
  if (st.rounded !== '1') return 0
  if (st.absoluteArcSize === '1') return Math.min(w / 2, h / 2, n(st, 'arcSize', 20) / 2)
  return (Math.min(w, h) * n(st, 'arcSize', 15)) / 100
}

/** Common draw.io stencil names that map onto a built-in outline. */
const ALIASES: Record<string, string> = {
  rectangle: 'rect',
  square: 'rect',
  circle: 'ellipse',
  'mxgraph.basic.rect': 'rect',
  'mxgraph.flowchart.process': 'rect',
  'mxgraph.flowchart.decision': 'rhombus',
  'mxgraph.flowchart.terminator': 'terminator',
  'mxgraph.flowchart.start_1': 'ellipse',
  'mxgraph.flowchart.start_2': 'ellipse',
  'mxgraph.flowchart.on-page_reference': 'ellipse',
  'mxgraph.flowchart.document': 'document',
  'mxgraph.flowchart.data': 'parallelogram',
  'mxgraph.flowchart.database': 'cylinder3',
  'mxgraph.flowchart.predefined_process': 'process',
  'mxgraph.flowchart.manual_input': 'manualInput',
  'mxgraph.flowchart.extract_or_measurement': 'triangleUp',
  'mxgraph.flowchart.merge_or_storage': 'triangleDown',
  'mxgraph.flowchart.delay': 'delay',
  'mxgraph.flowchart.preparation': 'hexagon',
  'mxgraph.flowchart.stored_data': 'dataStorage',
  'mxgraph.flowchart.annotation_1': 'annotation',
  'mxgraph.flowchart.card': 'card',
  'mxgraph.flowchart.paper_tape': 'tape',
  'mxgraph.basic.triangle_isosceles': 'triangleUp',
  'mxgraph.basic.oval': 'ellipse',
  cylinder: 'cylinder3',
  datastore: 'cylinder3',
  orEllipse: 'ellipse',
  sumEllipse: 'ellipse'
}

export function aliasShape(name: string): string {
  return ALIASES[name] ?? name
}

export const KNOWN_SHAPES = new Set([
  'rect', 'label', 'ellipse', 'doubleEllipse', 'rhombus', 'triangle', 'triangleUp', 'triangleDown', 'hexagon', 'cylinder3', 'cloud',
  'document', 'process', 'parallelogram', 'trapezoid', 'step', 'note', 'card', 'internalStorage', 'actor', 'umlActor', 'swimlane',
  'image', 'text', 'line', 'partialRectangle', 'terminator', 'manualInput', 'delay', 'dataStorage', 'annotation', 'tape', 'cube',
  'callout', 'tee', 'corner', 'cross', 'plus', 'waypoint', 'singleArrow', 'doubleArrow', 'mxgraph.basic.star', 'star', 'offPageConnector',
  'or', 'xor', 'loopLimit', 'display', 'lineEllipse', 'filledEdge', 'connector'
])

export function shapeGeometry(name: string, w: number, h: number, st: Style): ShapeGeometry {
  const fixed = st.fixedSize === '1'
  const rel = (k: string, d: number, dim: number, fixedDefault = 20): number => (fixed ? n(st, k, fixedDefault) : dim * n(st, k, d))
  switch (name) {
    case 'text':
      return {}
    case 'rect':
    case 'label':
      return { fill: roundRect(w, h, arcRadius(st, w, h)) }
    case 'ellipse':
      return { fill: ellipse(0, 0, w, h) }
    case 'doubleEllipse': {
      const m = Math.min(4 + n(st, 'strokeWidth', 1), w / 4, h / 4)
      return { fill: ellipse(0, 0, w, h), lines: ellipse(m, m, w - 2 * m, h - 2 * m) }
    }
    case 'rhombus':
      return { fill: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) }
    case 'triangle':
      return { fill: poly([[0, 0], [w, h / 2], [0, h]]), directional: true }
    case 'triangleUp':
      return { fill: poly([[w / 2, 0], [w, h], [0, h]]) }
    case 'triangleDown':
      return { fill: poly([[0, 0], [w, 0], [w / 2, h]]) }
    case 'hexagon': {
      const s = fixed ? n(st, 'size', 20) : w * n(st, 'size', 0.25)
      return { fill: poly([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]]), directional: true }
    }
    case 'cylinder3': {
      const dy = Math.max(0, Math.min(h / 2, n(st, 'size', 15)))
      const rx = w / 2
      return {
        fill: `M0 ${fmt(dy)}A${fmt(rx)} ${fmt(dy)} 0 0 1 ${fmt(w)} ${fmt(dy)}V${fmt(h - dy)}A${fmt(rx)} ${fmt(dy)} 0 0 1 0 ${fmt(h - dy)}Z`,
        lines: `M0 ${fmt(dy)}A${fmt(rx)} ${fmt(dy)} 0 0 0 ${fmt(w)} ${fmt(dy)}`,
        directional: true
      }
    }
    case 'cloud': {
      const X = (k: number) => fmt(k * w)
      const Y = (k: number) => fmt(k * h)
      return {
        fill:
          `M${X(0.25)} ${Y(0.25)}C${X(0.05)} ${Y(0.25)} 0 ${Y(0.5)} ${X(0.16)} ${Y(0.55)}C0 ${Y(0.66)} ${X(0.18)} ${Y(0.9)} ${X(0.31)} ${Y(0.8)}` +
          `C${X(0.4)} ${Y(1)} ${X(0.7)} ${Y(1)} ${X(0.8)} ${Y(0.8)}C${X(1)} ${Y(0.8)} ${X(1)} ${Y(0.6)} ${X(0.875)} ${Y(0.5)}` +
          `C${X(1)} ${Y(0.3)} ${X(0.8)} ${Y(0.1)} ${X(0.625)} ${Y(0.2)}C${X(0.5)} ${Y(0.05)} ${X(0.3)} ${Y(0.05)} ${X(0.25)} ${Y(0.25)}Z`
      }
    }
    case 'document': {
      const dy = h * n(st, 'size', 0.3)
      const fy = 1.4
      return {
        fill: `M0 0H${fmt(w)}V${fmt(h - dy / 2)}Q${fmt((3 * w) / 4)} ${fmt(h - dy * fy)} ${fmt(w / 2)} ${fmt(h - dy / 2)}T0 ${fmt(h - dy / 2)}Z`,
        directional: true
      }
    }
    case 'tape': {
      const dy = h * n(st, 'size', 0.4) / 2
      return { fill: `M0 ${fmt(dy / 2)}Q${fmt(w / 4)} ${fmt(dy * 1.4)} ${fmt(w / 2)} ${fmt(dy / 2)}T${fmt(w)} ${fmt(dy / 2)}V${fmt(h - dy / 2)}Q${fmt((3 * w) / 4)} ${fmt(h - dy * 1.4)} ${fmt(w / 2)} ${fmt(h - dy / 2)}T0 ${fmt(h - dy / 2)}Z` }
    }
    case 'process': {
      const s = rel('size', 0.1, w)
      return { fill: roundRect(w, h, arcRadius(st, w, h)), lines: `M${fmt(s)} 0V${fmt(h)}M${fmt(w - s)} 0V${fmt(h)}`, directional: true }
    }
    case 'parallelogram': {
      const s = Math.min(w / 2, rel('size', 0.2, w))
      return { fill: poly([[0, h], [s, 0], [w, 0], [w - s, h]]), directional: true }
    }
    case 'trapezoid': {
      const s = Math.min(w / 2, rel('size', 0.2, w))
      return { fill: poly([[0, h], [s, 0], [w - s, 0], [w, h]]), directional: true }
    }
    case 'manualInput': {
      const s = Math.min(h, n(st, 'size', 30))
      return { fill: poly([[0, s / 2], [w, 0], [w, h], [0, h]]) }
    }
    case 'step': {
      const s = Math.min(w / 2, rel('size', 0.2, w))
      return { fill: poly([[0, 0], [w - s, 0], [w, h / 2], [w - s, h], [0, h], [s, h / 2]]), directional: true }
    }
    case 'note': {
      const s = Math.min(w, h, n(st, 'size', 30))
      return { fill: poly([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]]), lines: `M${fmt(w - s)} 0V${fmt(s)}H${fmt(w)}` }
    }
    case 'card': {
      const s = Math.min(w, h, n(st, 'size', 15))
      return { fill: poly([[s, 0], [w, 0], [w, h], [0, h], [0, s]]), directional: true }
    }
    case 'internalStorage': {
      const dx = n(st, 'dx', 10)
      const dy = n(st, 'dy', 10)
      return { fill: roundRect(w, h, arcRadius(st, w, h)), lines: `M${fmt(dx)} 0V${fmt(h)}M0 ${fmt(dy)}H${fmt(w)}` }
    }
    case 'actor': {
      const k = w / 3
      return {
        fill:
          `M0 ${fmt(h)}C0 ${fmt((3 * h) / 5)} 0 ${fmt((2 * h) / 5)} ${fmt(w / 2)} ${fmt((2 * h) / 5)}` +
          `C${fmt(w / 2 - k)} ${fmt((2 * h) / 5)} ${fmt(w / 2 - k)} 0 ${fmt(w / 2)} 0` +
          `C${fmt(w / 2 + k)} 0 ${fmt(w / 2 + k)} ${fmt((2 * h) / 5)} ${fmt(w / 2)} ${fmt((2 * h) / 5)}` +
          `C${fmt(w)} ${fmt((2 * h) / 5)} ${fmt(w)} ${fmt((3 * h) / 5)} ${fmt(w)} ${fmt(h)}Z`
      }
    }
    case 'umlActor': {
      const hh = h / 4
      return {
        fill: ellipse(w / 4, 0, w / 2, hh),
        lines: `M${fmt(w / 2)} ${fmt(hh)}V${fmt((2 * h) / 3)}M0 ${fmt(h / 3)}H${fmt(w)}M${fmt(w / 2)} ${fmt((2 * h) / 3)}L0 ${fmt(h)}M${fmt(w / 2)} ${fmt((2 * h) / 3)}L${fmt(w)} ${fmt(h)}`
      }
    }
    case 'swimlane': {
      const ss = Math.min(n(st, 'startSize', 23), st.horizontal === '0' ? w : h)
      const r = arcRadius(st, w, h) ? Math.min(n(st, 'arcSize', 15) / 2, ss / 2) : 0
      if (st.horizontal === '0') {
        return {
          band: r ? `M${fmt(ss)} 0H${fmt(r)}Q0 0 0 ${fmt(r)}V${fmt(h - r)}Q0 ${fmt(h)} ${fmt(r)} ${fmt(h)}H${fmt(ss)}Z` : poly([[0, 0], [ss, 0], [ss, h], [0, h]]),
          body: `M${fmt(ss)} 0H${fmt(w - r)}${r ? `Q${fmt(w)} 0 ${fmt(w)} ${fmt(r)}` : ''}V${fmt(h - r)}${r ? `Q${fmt(w)} ${fmt(h)} ${fmt(w - r)} ${fmt(h)}` : ''}H${fmt(ss)}`
        }
      }
      return {
        band: r ? `M0 ${fmt(ss)}V${fmt(r)}Q0 0 ${fmt(r)} 0H${fmt(w - r)}Q${fmt(w)} 0 ${fmt(w)} ${fmt(r)}V${fmt(ss)}Z` : poly([[0, 0], [w, 0], [w, ss], [0, ss]]),
        body: `M0 ${fmt(ss)}V${fmt(h - r)}${r ? `Q0 ${fmt(h)} ${fmt(r)} ${fmt(h)}` : ''}H${fmt(w - r)}${r ? `Q${fmt(w)} ${fmt(h)} ${fmt(w)} ${fmt(h - r)}` : ''}V${fmt(ss)}`
      }
    }
    case 'line':
      return { lines: `M0 ${fmt(h / 2)}H${fmt(w)}`, directional: true }
    case 'partialRectangle': {
      const on = (k: string) => st[k] !== '0'
      let d = ''
      if (on('top')) d += `M0 0H${fmt(w)}`
      if (on('right')) d += `M${fmt(w)} 0V${fmt(h)}`
      if (on('bottom')) d += `M0 ${fmt(h)}H${fmt(w)}`
      if (on('left')) d += `M0 0V${fmt(h)}`
      return { fillOnly: poly([[0, 0], [w, 0], [w, h], [0, h]]), lines: d || undefined }
    }
    case 'terminator': {
      const r = Math.min(w, h) / 2
      return { fill: roundRect(w, h, r) }
    }
    case 'delay':
      return { fill: `M0 0H${fmt(w / 2)}A${fmt(w / 2)} ${fmt(h / 2)} 0 0 1 ${fmt(w / 2)} ${fmt(h)}H0Z` }
    case 'dataStorage': {
      const s = w * 0.1
      return { fill: `M${fmt(s)} 0H${fmt(w)}A${fmt(s)} ${fmt(h / 2)} 0 0 0 ${fmt(w)} ${fmt(h)}H${fmt(s)}A${fmt(s)} ${fmt(h / 2)} 0 0 1 ${fmt(s)} 0Z` }
    }
    case 'annotation':
      return { lines: `M${fmt(w / 2)} 0H0V${fmt(h)}H${fmt(w / 2)}` }
    case 'cube': {
      const s = Math.min(w, h, n(st, 'size', 20))
      return {
        fill: poly([[0, 0], [w - s, 0], [w, s], [w, h], [s, h], [0, h - s]]),
        lines: `M${fmt(s)} ${fmt(h)}V${fmt(s)}H${fmt(w)}M${fmt(s)} ${fmt(s)}L0 0`
      }
    }
    case 'callout': {
      const s = n(st, 'size', 30)
      const p = w * n(st, 'position', 0.5)
      const base = n(st, 'base', 20)
      const bh = Math.max(0, h - s)
      return { fill: poly([[0, 0], [w, 0], [w, bh], [Math.min(w, p + base), bh], [p, h], [p, bh], [0, bh]]) }
    }
    case 'cross':
    case 'plus': {
      const s = Math.min(w, h) * (name === 'cross' ? n(st, 'size', 0.2) : 0.25)
      const x1 = (w - s) / 2
      const y1 = (h - s) / 2
      if (name === 'plus') return { fill: poly([[0, 0], [w, 0], [w, h], [0, h]]), lines: `M${fmt(w / 2)} 0V${fmt(h)}M0 ${fmt(h / 2)}H${fmt(w)}` }
      return { fill: poly([[x1, 0], [x1 + s, 0], [x1 + s, y1], [w, y1], [w, y1 + s], [x1 + s, y1 + s], [x1 + s, h], [x1, h], [x1, y1 + s], [0, y1 + s], [0, y1], [x1, y1]]) }
    }
    case 'tee': {
      const dx = w * 0.4
      const dy = h * 0.4
      return { fill: poly([[0, 0], [w, 0], [w, dy], [(w + dx) / 2, dy], [(w + dx) / 2, h], [(w - dx) / 2, h], [(w - dx) / 2, dy], [0, dy]]) }
    }
    case 'corner': {
      const dx = w * 0.3
      const dy = h * 0.3
      return { fill: poly([[0, 0], [w, 0], [w, dy], [dx, dy], [dx, h], [0, h]]) }
    }
    case 'singleArrow':
    case 'doubleArrow': {
      const aw = h * n(st, 'arrowWidth', 0.3)
      const as = w * n(st, 'arrowSize', 0.2)
      const y1 = (h - aw) / 2
      const y2 = y1 + aw
      if (name === 'singleArrow') return { fill: poly([[0, y1], [w - as, y1], [w - as, 0], [w, h / 2], [w - as, h], [w - as, y2], [0, y2]]), directional: true }
      return { fill: poly([[0, h / 2], [as, 0], [as, y1], [w - as, y1], [w - as, 0], [w, h / 2], [w - as, h], [w - as, y2], [as, y2], [as, h]]), directional: true }
    }
    case 'star':
    case 'mxgraph.basic.star': {
      const pts: [number, number][] = []
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 ? 0.4 : 1
        pts.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + ((Math.sin(a) * r * h) / 2) * 1.05 + h * 0.03])
      }
      return { fill: poly(pts) }
    }
    case 'offPageConnector': {
      const s = h * n(st, 'size', 0.375)
      return { fill: poly([[0, 0], [w, 0], [w, h - s], [w / 2, h], [0, h - s]]), directional: true }
    }
    case 'or':
      return { fill: `M0 0Q${fmt(w)} 0 ${fmt(w)} ${fmt(h / 2)}Q${fmt(w)} ${fmt(h)} 0 ${fmt(h)}Z`, directional: true }
    case 'xor':
      return { fill: `M0 0Q${fmt(w)} 0 ${fmt(w)} ${fmt(h / 2)}Q${fmt(w)} ${fmt(h)} 0 ${fmt(h)}Q${fmt(w / 2)} ${fmt(h / 2)} 0 0Z`, directional: true }
    case 'loopLimit': {
      const s = Math.min(w / 2, n(st, 'size', 20))
      return { fill: poly([[s, 0], [w - s, 0], [w, s], [w, h], [0, h], [0, s]]), directional: true }
    }
    case 'display': {
      const s = w * 0.25
      return { fill: `M${fmt(s)} 0H${fmt(w - s / 2)}A${fmt(s / 2)} ${fmt(h / 2)} 0 0 1 ${fmt(w - s / 2)} ${fmt(h)}H${fmt(s)}L0 ${fmt(h / 2)}Z`, directional: true }
    }
    case 'waypoint':
      return { fill: ellipse(w / 2 - 3, h / 2 - 3, 6, 6) }
    case 'lineEllipse':
      return { fill: ellipse(0, 0, w, h), lines: `M0 ${fmt(h / 2)}H${fmt(w)}` }
    default:
      return { fill: roundRect(w, h, arcRadius(st, w, h)) }
  }
}

/** Insets of the label box for shapes whose text avoids decorations (`boundedLbl=1`, callouts). */
export function labelMargins(name: string, w: number, h: number, st: Style): { l: number; t: number; r: number; b: number } | null {
  const bounded = st.boundedLbl === '1'
  switch (name) {
    case 'callout':
      return { l: 0, t: 0, r: 0, b: Math.min(h, n(st, 'size', 30)) }
    case 'cylinder3': {
      if (!bounded) return null
      const s = Math.min(h / 2, n(st, 'size', 15))
      return { l: 0, t: 2 * s, r: 0, b: s / 2 }
    }
    case 'document':
      return bounded ? { l: 0, t: 0, r: 0, b: h * n(st, 'size', 0.3) } : null
    case 'cube': {
      if (!bounded) return null
      const s = Math.min(w, h, n(st, 'size', 20))
      return { l: s, t: s, r: 0, b: 0 }
    }
    default:
      return null
  }
}

/** Where the line from the terminal's centre toward `toward` leaves its outline. */
export function perimeterPoint(t: Terminal, toward: P): P {
  const r = t.rect
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (t.shape === 'point' || (!r.w && !r.h) || (!dx && !dy)) return { x: cx, y: cy }
  const a = r.w / 2
  const b = r.h / 2
  if (t.shape === 'ellipse' || t.shape === 'doubleEllipse' || t.shape === 'lineEllipse') {
    const k = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b))
    return { x: cx + dx * k, y: cy + dy * k }
  }
  if (t.shape === 'rhombus') {
    const k = 1 / (Math.abs(dx) / a + Math.abs(dy) / b)
    return { x: cx + dx * k, y: cy + dy * k }
  }
  const k = Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity)
  return { x: cx + dx * k, y: cy + dy * k }
}
