/** .kicad_sch (KiCad 6–10): symbols with units and body styles, pins, wires, buses, junctions,
 *  labels, power symbols, hierarchical sheets, text, graphics, fields, title block. */
import { apply, effects, fill, placeText, readable, SCH_LINE, stroke, symbolXf, type Effects } from './common.ts'
import { plainText, textExtent, wrapText, type Pt } from './font.ts'
import { Box, circleD, fmt, Scene, type Layer } from './scene.ts'
import { child, children, flag, head, isList, num, nums, points, str, val, type SList } from './sexpr.ts'
import { drawSheet, paperOf, titleBlockOf } from './sheet.ts'
import { bezier, drawSymbol, layersFor, parseLibSymbol, type LibSymbol, type PinHit } from './symbol.ts'
import type { Hit } from './view.ts'

export const SCH_ORDER = [
  'sheetfill',
  'bodyfill',
  'dim-bodyfill',
  'image',
  'border',
  'note',
  'sheet',
  'wire',
  'bus',
  'junction',
  'nc',
  'body',
  'dim-body',
  'pin',
  'dim-pin',
  'pinnum',
  'pinname',
  'dim-pinnum',
  'dim-pinname',
  'ref',
  'value',
  'field',
  'label',
  'glabel',
  'hlabel',
  'netclass',
  'sheetpin',
  'sheetname',
  'sheetfile'
]

interface Item {
  box: Box
  hit: Hit
  /** Lower draws first in hit priority (pins before symbols). */
  prio: number
  seg?: [number, number, number, number, number]
  netKey?: string
}

export interface SchModel {
  scene: Scene
  bounds: Box
  hit(x: number, y: number, tol: number): Hit | null
  info: { version: string; symbols: number; sheets: { name: string; file: string; box: Box }[]; paper: string; title: string; wires: number; labels: number }
}

const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`

class Nets {
  parent = new Map<string, string>()
  find(a: string): string {
    let p = this.parent.get(a)
    if (p === undefined) {
      this.parent.set(a, a)
      return a
    }
    while (p !== a) {
      const g = this.parent.get(p)!
      this.parent.set(a, g)
      a = p
      p = this.parent.get(a)!
    }
    return a
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

export function buildSchematic(root: SList, tr: (ko: string, en: string) => string): SchModel {
  const scene = new Scene()
  const L = layersFor(scene)
  const items: Item[] = []
  const libs = new Map<string, LibSymbol>()
  for (const s of children(child(root, 'lib_symbols'), 'symbol')) {
    const ls = parseLibSymbol(s)
    libs.set(ls.name, ls)
  }

  const paper = paperOf(root)
  const tb = titleBlockOf(root)
  drawSheet(scene.layer('border'), paper, tb)

  // Connectivity (for hover): wire segments, and named points.
  const nets = new Nets()
  const wires: [number, number, number, number][] = []
  const netNames = new Map<string, { name: string; rank: number }>()
  const points2: string[] = []
  const nameAt = (x: number, y: number, name: string, rank: number) => {
    const k = key(x, y)
    points2.push(k)
    const r = nets.find(k)
    const cur = netNames.get(r)
    if (!cur || rank > cur.rank) netNames.set(r, { name, rank })
  }
  const pinPoints: { k: string; item: Item; base: Hit }[] = []

  let symbols = 0
  let labels = 0
  const sheets: { name: string; file: string; box: Box }[] = []

  for (const it of root) {
    if (!isList(it)) continue
    switch (head(it)) {
      case 'wire':
      case 'bus': {
        const isBus = head(it) === 'bus'
        const st = stroke(it, isBus ? SCH_LINE * 2 : SCH_LINE)
        const pts = points(it)
        if (pts.length < 2) break
        L.layer(isBus ? 'bus' : 'wire', st.color, st.dash).line(pts, st.width)
        for (let i = 0; i + 1 < pts.length; i++) {
          const [a, b] = [pts[i], pts[i + 1]]
          if (!isBus) {
            nets.union(key(a[0], a[1]), key(b[0], b[1]))
            wires.push([a[0], a[1], b[0], b[1]])
            points2.push(key(a[0], a[1]), key(b[0], b[1]))
          }
          const box = new Box()
          box.add(a[0], a[1])
          box.add(b[0], b[1])
          items.push({
            box,
            prio: 5,
            seg: [a[0], a[1], b[0], b[1], st.width],
            netKey: isBus ? undefined : key(a[0], a[1]),
            hit: { title: isBus ? tr('버스', 'Bus') : tr('배선', 'Wire'), d: `M${fmt(a[0])} ${fmt(a[1])}L${fmt(b[0])} ${fmt(b[1])}` }
          })
        }
        break
      }
      case 'polyline': {
        const st = stroke(it, SCH_LINE)
        const pts = points(it)
        const f = fill(it)
        if (f.kind !== 'none') L.layer('note', f.color).fill(pts)
        L.layer('note', st.color, st.dash).line(pts, st.width)
        break
      }
      case 'rectangle':
      case 'circle':
      case 'arc':
      case 'bezier': {
        drawGraphicTop(L, it)
        break
      }
      case 'bus_entry': {
        const at = nums(it, 'at', 2) ?? [0, 0]
        const sz = nums(it, 'size', 2) ?? [2.54, 2.54]
        const st = stroke(it, SCH_LINE)
        L.layer('wire', st.color, st.dash).seg(at[0], at[1], at[0] + sz[0], at[1] + sz[1], st.width)
        break
      }
      case 'junction': {
        const at = nums(it, 'at', 2) ?? [0, 0]
        const d = num(child(it, 'diameter')?.[1]) || 0.9144
        const c = nums(it, 'color', 4)
        const col = c && (c[0] || c[1] || c[2] || c[3]) ? `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` : undefined
        L.layer('junction', col).fillCircle(at[0], at[1], d / 2)
        points2.push(key(at[0], at[1]))
        break
      }
      case 'no_connect': {
        const at = nums(it, 'at', 2) ?? [0, 0]
        const r = 0.635
        const l = L.layer('nc')
        l.seg(at[0] - r, at[1] - r, at[0] + r, at[1] + r, SCH_LINE)
        l.seg(at[0] - r, at[1] + r, at[0] + r, at[1] - r, SCH_LINE)
        break
      }
      case 'text': {
        const at = nums(it, 'at', 3) ?? [0, 0, 0]
        const e = effects(child(it, 'effects'))
        if (e.hide) break
        const r = readable(at[2], e.h)
        L.layer('note').text(str(it[1]), at[0], at[1], { size: e.size, thickness: e.thickness, angle: r.angle, h: r.h, v: e.v, italic: e.italic, lineSpacing: e.lineSpacing })
        break
      }
      case 'text_box':
      case 'table': {
        if (head(it) === 'table') {
          for (const cell of children(child(it, 'cells'), 'table_cell')) textBox(L, cell)
        } else textBox(L, it)
        break
      }
      case 'label':
      case 'global_label':
      case 'hierarchical_label':
      case 'netclass_flag':
      case 'directive_label': {
        labels++
        const lab = drawLabel(scene, L, it, tr)
        if (lab) {
          items.push({ box: lab.box, prio: 2, hit: lab.hit, netKey: lab.k })
          if (head(it) !== 'netclass_flag' && head(it) !== 'directive_label') nameAt(lab.at[0], lab.at[1], lab.name, head(it) === 'label' ? 2 : 3)
          else points2.push(key(lab.at[0], lab.at[1]))
        }
        break
      }
      case 'symbol': {
        symbols++
        drawPlacedSymbol(it)
        break
      }
      case 'sheet': {
        const s = drawSheetBox(scene, L, it, tr)
        sheets.push({ name: s.name, file: s.file, box: s.box })
        items.push({ box: s.box, prio: 8, hit: s.hit })
        for (const p of s.pins) {
          items.push({ box: p.box, prio: 2, hit: p.hit, netKey: key(p.at[0], p.at[1]) })
          nameAt(p.at[0], p.at[1], p.name, 1)
        }
        break
      }
      case 'image': {
        drawImage(scene.layer('image'), it)
        break
      }
    }
  }

  function drawPlacedSymbol(it: SList): void {
    const libId = val(it, 'lib_name') ?? val(it, 'lib_id') ?? ''
    const lib = libs.get(libId) ?? libs.get(val(it, 'lib_id') ?? '')
    const at = nums(it, 'at', 3) ?? [0, 0, 0]
    const mirror = val(it, 'mirror')
    const xf = symbolXf(at[0], at[1], at[2], mirror)
    const unit = num(child(it, 'unit')?.[1], 1) || 1
    const style = num(child(it, 'body_style')?.[1] ?? child(it, 'convert')?.[1], 1) || 1
    const dnp = flag(it, 'dnp')
    const props = new Map<string, string>()
    for (const p of children(it, 'property')) props.set(str(p[1]), str(p[2]))
    const ref = props.get('Reference') ?? ''
    const value = props.get('Value') ?? ''
    const box = new Box()
    const pins: PinHit[] = []
    if (lib) {
      const base = lib.extendsName ? (libs.get(lib.extendsName) ?? lib) : lib
      scene.probe = box
      drawSymbol(L, lib, base, xf, unit, style, pins, dnp)
      scene.probe = undefined
    } else {
      // Unknown symbol: a placeholder box so the reference stays visible.
      const l = scene.layer('body')
      l.line(
        [
          [at[0] - 2.54, at[1] - 2.54],
          [at[0] + 2.54, at[1] - 2.54],
          [at[0] + 2.54, at[1] + 2.54],
          [at[0] - 2.54, at[1] + 2.54]
        ],
        SCH_LINE,
        true
      )
      box.add(at[0], at[1], 2.54)
    }
    // Fields.
    const isPower = !!lib?.power || ref.startsWith('#')
    for (const p of children(it, 'property')) {
      const name = str(p[1])
      let text = str(p[2])
      const e = effects(child(p, 'effects'))
      if (e.hide || flag(p, 'hide') || !text || text === '~') continue
      const pa = nums(p, 'at', 3) ?? [at[0], at[1], 0]
      const layer = name === 'Reference' ? 'ref' : name === 'Value' ? 'value' : 'field'
      if (name === 'Reference' && lib && lib.unitCount > 1 && !isPower) text += unitSuffix(unit)
      placeText(L.layer((dnp ? 'dim-' : '') + layer, colorOf(p)), text, [pa[0], pa[1]], e, pa[2], xf)
    }
    if (dnp && !box.empty) {
      const l = scene.layer('glabel')
      l.seg(box.x0, box.y0, box.x1, box.y1, 0.3)
      l.seg(box.x0, box.y1, box.x1, box.y0, 0.3)
    }
    const lines: string[] = []
    if (value) lines.push(`${tr('값', 'Value')}: ${plainText(value)}`)
    lines.push(`${tr('심볼', 'Symbol')}: ${libId}${lib && lib.unitCount > 1 ? ` · ${tr('유닛', 'unit')} ${unitSuffix(unit)}` : ''}${style > 1 ? ' · De Morgan' : ''}`)
    const fp = props.get('Footprint')
    if (fp) lines.push(`${tr('풋프린트', 'Footprint')}: ${fp}`)
    const ds = props.get('Datasheet')
    if (ds && ds !== '~') lines.push(`${tr('데이터시트', 'Datasheet')}: ${ds}`)
    if (dnp) lines.push(tr('실장 안 함 (DNP)', 'Do not populate (DNP)'))
    if (!lib) lines.push(tr('라이브러리 심볼이 파일에 없습니다', 'Library symbol missing from the file'))
    if (!box.empty)
      items.push({
        box,
        prio: 6,
        hit: { title: isPower ? `${tr('전원', 'Power')} ${plainText(value)}` : `${plainText(ref)}${value ? ' · ' + plainText(value) : ''}`, lines, d: rectD(box) }
      })
    for (const p of pins) {
      const pb = new Box()
      pb.add(p.x0, p.y0)
      pb.add(p.x1, p.y1)
      const base: Hit = {
        title: `${tr('핀', 'Pin')} ${p.number}${p.name && p.name !== '~' ? ` (${plainText(p.name)})` : ''} · ${plainText(ref)}`,
        lines: [`${tr('종류', 'Type')}: ${p.type}`],
        d: `M${fmt(p.x0)} ${fmt(p.y0)}L${fmt(p.x1)} ${fmt(p.y1)}${circleD(p.x0, p.y0, 0.3)}`
      }
      const item: Item = { box: pb, prio: 1, seg: [p.x0, p.y0, p.x1, p.y1, 0.3], hit: base, netKey: key(p.x0, p.y0) }
      if (!p.hidden) items.push(item)
      pinPoints.push({ k: key(p.x0, p.y0), item, base })
      if (isPower && lib?.power) nameAt(p.x0, p.y0, value, 4)
      else points2.push(key(p.x0, p.y0))
    }
  }

  // Points lying on a wire's interior join that wire (T connections, labels mid-wire).
  if (wires.length && points2.length) {
    const uniq = [...new Set(points2)]
    for (const k of uniq) {
      const [xs, ys] = k.split(',')
      const x = Number(xs) / 1000
      const y = Number(ys) / 1000
      for (const w of wires) {
        if (onSegment(x, y, w)) nets.union(k, key(w[0], w[1]))
      }
    }
  }
  // Re-resolve names after unions (a name recorded before a union sits on the old root).
  const names = new Map<string, { name: string; rank: number }>()
  for (const [k, v] of netNames) {
    const r = nets.find(k)
    const cur = names.get(r)
    if (!cur || v.rank > cur.rank) names.set(r, v)
  }
  const netOf = (k: string | undefined) => (k ? names.get(nets.find(k))?.name : undefined)
  for (const it of items) {
    const n = netOf(it.netKey)
    if (n) it.hit = { ...it.hit, lines: [...(it.hit.lines ?? []), `${tr('넷', 'Net')}: ${plainText(n)}`] }
  }

  // Bounds: the page when the drawing fits on it, else everything.
  const content = scene.bounds((l) => l.base !== 'border')
  const page = new Box()
  page.add(0, 0)
  page.add(paper.w, paper.h)
  const bounds = new Box()
  bounds.addBox(page)
  bounds.addBox(content)

  items.sort((a, b) => a.prio - b.prio)
  return {
    scene,
    bounds,
    info: { version: str(child(root, 'version')?.[1]), symbols, sheets, paper: paper.name, title: titleBlockOf(root).title, wires: wires.length, labels },
    hit(x, y, tol) {
      for (const it of items) {
        if (!it.box.contains(x, y, tol)) continue
        if (it.seg) {
          const [x0, y0, x1, y1, w] = it.seg
          if (distSeg(x, y, x0, y0, x1, y1) > tol + w / 2) continue
        }
        return it.hit
      }
      return null
    }
  }
}

function unitSuffix(unit: number): string {
  let s = ''
  let n = unit
  while (n > 0) {
    n--
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

function colorOf(p: SList): string | undefined {
  const c = nums(child(child(child(p, 'effects'), 'font'), 'color') ? child(child(p, 'effects'), 'font') : undefined, 'color', 4)
  return c && (c[0] || c[1] || c[2] || c[3]) ? `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` : undefined
}

function onSegment(x: number, y: number, w: [number, number, number, number]): boolean {
  const [x0, y0, x1, y1] = w
  if (x < Math.min(x0, x1) - 1e-3 || x > Math.max(x0, x1) + 1e-3 || y < Math.min(y0, y1) - 1e-3 || y > Math.max(y0, y1) + 1e-3) return false
  return distSeg(x, y, x0, y0, x1, y1) < 1e-3
}

export function distSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

export function rectD(b: Box): string {
  return `M${fmt(b.x0)} ${fmt(b.y0)}H${fmt(b.x1)}V${fmt(b.y1)}H${fmt(b.x0)}Z`
}

function drawGraphicTop(L: ReturnType<typeof layersFor>, it: SList): void {
  const st = stroke(it, SCH_LINE)
  const f = fill(it)
  const line = L.layer('note', st.color, st.dash)
  const fl = f.kind === 'color' ? L.layer('note', f.color) : f.kind !== 'none' ? L.layer('note', st.color) : null
  const k = head(it)
  if (k === 'rectangle') {
    const s = nums(it, 'start', 2)
    const e = nums(it, 'end', 2)
    if (!s || !e) return
    const pts: Pt[] = [
      [s[0], s[1]],
      [e[0], s[1]],
      [e[0], e[1]],
      [s[0], e[1]]
    ]
    if (fl) fl.fill(pts)
    line.line(pts, st.width, true)
  } else if (k === 'circle') {
    const c = nums(it, 'center', 2)
    if (!c) return
    const r = num(child(it, 'radius')?.[1])
    if (fl) fl.fillCircle(c[0], c[1], r)
    line.circle(c[0], c[1], r, st.width)
  } else if (k === 'arc') {
    const s = nums(it, 'start', 2)
    const m = nums(it, 'mid', 2)
    const e = nums(it, 'end', 2)
    if (s && m && e) line.arc(s as Pt, m as Pt, e as Pt, st.width)
  } else if (k === 'bezier') {
    const pts = points(it)
    if (pts.length === 4) line.line(bezier(pts), st.width)
  }
}

function textBox(L: ReturnType<typeof layersFor>, it: SList): void {
  const at = nums(it, 'at', 3) ?? nums(it, 'start', 2)
  const size = nums(it, 'size', 2)
  const end = nums(it, 'end', 2)
  if (!at) return
  const w = size ? size[0] : end ? end[0] - at[0] : 0
  const hh = size ? size[1] : end ? end[1] - at[1] : 0
  const st = stroke(it, SCH_LINE)
  const f = fill(it)
  const pts: Pt[] = [
    [at[0], at[1]],
    [at[0] + w, at[1]],
    [at[0] + w, at[1] + hh],
    [at[0], at[1] + hh]
  ]
  if (f.kind === 'color') L.layer('note', f.color).fill(pts)
  const sw = child(child(it, 'stroke'), 'width')
  if (!(sw && num(sw[1]) < 0)) L.layer('note', st.color, st.dash).line(pts, st.width, true)
  const e = effects(child(it, 'effects'))
  if (e.hide) return
  const mg = nums(it, 'margins', 4) ?? [e.size[1] * 0.75, e.size[1] * 0.75, e.size[1] * 0.75, e.size[1] * 0.75]
  const x = e.h === 'left' ? at[0] + mg[0] : e.h === 'right' ? at[0] + w - mg[2] : at[0] + w / 2
  const y = e.v === 'top' ? at[1] + mg[1] : e.v === 'bottom' ? at[1] + hh - mg[3] : at[1] + hh / 2
  L.layer('note').text(wrapText(str(it[1]), e.size, Math.abs(w) - mg[0] - mg[2]), x, y, { size: e.size, thickness: e.thickness, h: e.h, v: e.v, italic: e.italic, lineSpacing: e.lineSpacing })
}

/** Direction the label body extends from its connection point, by angle (0 → right). */
function dirOf(angle: number): Pt {
  const a = ((Math.round(angle) % 360) + 360) % 360
  return a === 90 ? [0, -1] : a === 180 ? [-1, 0] : a === 270 ? [0, 1] : [1, 0]
}

function drawLabel(
  scene: Scene,
  L: ReturnType<typeof layersFor>,
  it: SList,
  tr: (ko: string, en: string) => string
): { box: Box; hit: Hit; at: Pt; name: string; k: string } | null {
  const kind = head(it)
  const at = nums(it, 'at', 3) ?? [0, 0, 0]
  const e = effects(child(it, 'effects'))
  const name = str(it[1])
  const shape = val(it, 'shape') ?? 'passive'
  const d = dirOf(at[2])
  const vertical = d[0] === 0
  const angle = vertical ? 90 : 0
  // Text "forward" along the body: for vertical text (angle 90) forward is up.
  const along = vertical ? -d[1] : d[0]
  const h = along > 0 ? 'left' : 'right'
  const box = new Box()
  scene.probe = box
  const txt = { size: e.size, thickness: e.thickness, angle, italic: e.italic }
  const P: Pt = [at[0], at[1]]
  let layerName = 'label'
  if (kind === 'label') {
    const dist = 0.15 * e.size[1] + SCH_LINE
    const ox = vertical ? -dist : 0
    const oy = vertical ? 0 : -dist
    if (!e.hide) L.layer('label').text(name, P[0] + ox, P[1] + oy, { ...txt, h, v: 'bottom' })
  } else if (kind === 'global_label' || kind === 'hierarchical_label') {
    layerName = kind === 'global_label' ? 'glabel' : 'hlabel'
    const layer = L.layer(layerName)
    const th = e.size[1]
    const w = textExtent(name, e.size).w
    const n: Pt = [-d[1], d[0]]
    const pt = (u: number, v: number): Pt => [P[0] + d[0] * u + n[0] * v, P[1] + d[1] * u + n[1] * v]
    let textStart: number
    if (kind === 'global_label') {
      const margin = 0.375 * th
      const half = th / 2 + margin
      const len = w + 2 * margin + SCH_LINE
      const y = half + SCH_LINE
      const tipIn = shape === 'input' || shape === 'bidirectional' || shape === 'tri_state'
      const tipOut = shape === 'output' || shape === 'bidirectional' || shape === 'tri_state'
      const x0 = tipIn ? half : 0
      const x1 = x0 + len
      const poly: Pt[] = [tipIn ? pt(0, 0) : pt(0, -y), ...(tipIn ? [pt(x0, -y)] : []), pt(x1, -y), ...(tipOut ? [pt(x1 + half, 0)] : []), pt(x1, y), pt(x0, y)]
      if (!tipIn) poly.push(pt(0, y))
      layer.line(poly, SCH_LINE, true)
      textStart = x0 + margin
    } else {
      const s = th / 2
      let poly: Pt[]
      if (shape === 'input') poly = [pt(0, 0), pt(s, -s), pt(2 * s, -s), pt(2 * s, s), pt(s, s)]
      else if (shape === 'output') poly = [pt(0, -s), pt(s, -s), pt(2 * s, 0), pt(s, s), pt(0, s)]
      else if (shape === 'bidirectional' || shape === 'tri_state') poly = [pt(0, 0), pt(s, -s), pt(2 * s, 0), pt(s, s)]
      else poly = [pt(0, -s), pt(2 * s, -s), pt(2 * s, s), pt(0, s)]
      layer.line(poly, SCH_LINE, true)
      textStart = 2 * s + 0.15 * th + SCH_LINE
    }
    const tp = pt(textStart, 0)
    if (!e.hide) layer.text(name, tp[0], tp[1], { ...txt, h, v: 'center' })
    // Fields (Intersheet references etc.) when shown.
    for (const p of children(it, 'property')) {
      const pe = effects(child(p, 'effects'))
      if (pe.hide || flag(p, 'hide') || !str(p[2])) continue
      const pa = nums(p, 'at', 3) ?? [P[0], P[1], 0]
      const r = readable(pa[2], pe.h)
      L.layer('field').text(str(p[2]), pa[0], pa[1], { size: pe.size, thickness: pe.thickness, angle: r.angle, h: r.h, v: pe.v })
    }
  } else {
    // Net class flag / directive label: a stem with a small marker, then its fields.
    layerName = 'netclass'
    const layer = L.layer('netclass')
    const len = num(child(it, 'length')?.[1], 2.54)
    const up: Pt = [d[0] === 0 ? 0 : 0, -1]
    const dd: Pt = vertical || at[2] === 0 ? up : [d[0], d[1]]
    const end: Pt = [P[0] + dd[0] * len, P[1] + dd[1] * len]
    layer.line([P, end], SCH_LINE)
    const r = 0.5
    if (shape === 'round') layer.circle(end[0] + dd[0] * r, end[1] + dd[1] * r, r, SCH_LINE)
    else if (shape === 'diamond')
      layer.line(
        [
          [end[0], end[1]],
          [end[0] + r, end[1] + dd[1] * r],
          [end[0], end[1] + dd[1] * 2 * r],
          [end[0] - r, end[1] + dd[1] * r]
        ],
        SCH_LINE,
        true
      )
    else layer.line([end, [end[0] + 2 * r, end[1]], [end[0] + 2 * r, end[1] + dd[1] * 2 * r], [end[0] - 2 * r, end[1] + dd[1] * 2 * r], [end[0] - 2 * r, end[1]], end], SCH_LINE)
    for (const p of children(it, 'property')) {
      const pe = effects(child(p, 'effects'))
      if (pe.hide || flag(p, 'hide') || !str(p[2])) continue
      const pa = nums(p, 'at', 3) ?? [P[0], P[1], 0]
      const rr = readable(pa[2], pe.h)
      L.layer('field').text(str(p[2]), pa[0], pa[1], { size: pe.size, thickness: pe.thickness, angle: rr.angle, h: rr.h, v: pe.v, italic: pe.italic })
    }
  }
  scene.probe = undefined
  box.add(P[0], P[1], 0.3)
  const title =
    kind === 'label'
      ? tr('로컬 레이블', 'Local label')
      : kind === 'global_label'
        ? tr('글로벌 레이블', 'Global label')
        : kind === 'hierarchical_label'
          ? tr('계층 레이블', 'Hierarchical label')
          : tr('넷 클래스 지시자', 'Net class directive')
  const lines = [plainText(name) || plainText(children(it, 'property').map((p) => str(p[2])).join(' '))]
  if (kind !== 'label' && kind !== 'netclass_flag' && kind !== 'directive_label') lines.push(`${tr('형태', 'Shape')}: ${shape}`)
  void layerName
  return { box, hit: { title, lines, d: rectD(box) }, at: P, name, k: key(P[0], P[1]) }
}

function drawSheetBox(
  scene: Scene,
  L: ReturnType<typeof layersFor>,
  it: SList,
  tr: (ko: string, en: string) => string
): { name: string; file: string; box: Box; hit: Hit; pins: { at: Pt; name: string; box: Box; hit: Hit }[] } {
  const at = nums(it, 'at', 2) ?? [0, 0]
  const size = nums(it, 'size', 2) ?? [10, 10]
  const st = stroke(it, SCH_LINE)
  const f = fill(it)
  const pts: Pt[] = [
    [at[0], at[1]],
    [at[0] + size[0], at[1]],
    [at[0] + size[0], at[1] + size[1]],
    [at[0], at[1] + size[1]]
  ]
  if (f.kind === 'color') L.layer('sheetfill', f.color).fill(pts)
  L.layer('sheet', st.color, st.dash).line(pts, st.width, true)
  let name = ''
  let file = ''
  for (const p of children(it, 'property')) {
    const pn = str(p[1])
    const isName = pn === 'Sheetname' || pn === 'Sheet name'
    const isFile = pn === 'Sheetfile' || pn === 'Sheet file'
    if (isName) name = str(p[2])
    if (isFile) file = str(p[2])
    const e = effects(child(p, 'effects'))
    if (e.hide || flag(p, 'hide')) continue
    const pa = nums(p, 'at', 3) ?? [at[0], at[1], 0]
    const text = isFile ? `${tr('파일', 'File')}: ${str(p[2])}` : isName ? str(p[2]) : str(p[2])
    const r = readable(pa[2], e.h)
    L.layer(isFile ? 'sheetfile' : isName ? 'sheetname' : 'field').text(text, pa[0], pa[1], {
      size: e.size,
      thickness: e.thickness,
      angle: r.angle,
      h: r.h,
      v: e.v,
      italic: e.italic
    })
  }
  const pins: { at: Pt; name: string; box: Box; hit: Hit }[] = []
  for (const p of children(it, 'pin')) {
    const pa = nums(p, 'at', 3) ?? [at[0], at[1], 0]
    const pname = str(p[1])
    const shape = str(p[2])
    const e = effects(child(p, 'effects'))
    // Sheet pin angle points out of the sheet: 0 = right edge, 180 = left edge.
    const out = dirOf(pa[2])
    const inward: Pt = [-out[0], -out[1]]
    const n: Pt = [-inward[1], inward[0]]
    const P: Pt = [pa[0], pa[1]]
    const pt = (u: number, v: number): Pt => [P[0] + inward[0] * u + n[0] * v, P[1] + inward[1] * u + n[1] * v]
    const s = e.size[1] / 2
    let poly: Pt[]
    // Arrow direction reversed compared with hierarchical labels (input points into the sheet).
    if (shape === 'output') poly = [pt(0, 0), pt(s, -s), pt(2 * s, -s), pt(2 * s, s), pt(s, s)]
    else if (shape === 'input') poly = [pt(0, -s), pt(s, -s), pt(2 * s, 0), pt(s, s), pt(0, s)]
    else if (shape === 'bidirectional' || shape === 'tri_state') poly = [pt(0, 0), pt(s, -s), pt(2 * s, 0), pt(s, s)]
    else poly = [pt(0, -s), pt(2 * s, -s), pt(2 * s, s), pt(0, s)]
    const layer = L.layer('sheetpin')
    const box = new Box()
    for (const q of poly) box.add(q[0], q[1])
    layer.line(poly, SCH_LINE, true)
    const vertical = inward[0] === 0
    const fwd = vertical ? -inward[1] : inward[0]
    const tp = pt(2 * s + 0.15 * e.size[1] + SCH_LINE, 0)
    if (!e.hide) layer.text(pname, tp[0], tp[1], { size: e.size, thickness: e.thickness, angle: vertical ? 90 : 0, h: fwd > 0 ? 'left' : 'right', v: 'center' })
    const tw = textExtent(pname, e.size).w
    const tend = pt(2 * s + tw + 0.5, 0)
    box.add(tend[0], tend[1], s)
    pins.push({ at: P, name: pname, box, hit: { title: `${tr('시트 핀', 'Sheet pin')} ${plainText(pname)}`, lines: [`${tr('형태', 'Shape')}: ${shape}`], d: rectD(box) } })
  }
  const box = new Box()
  box.add(at[0], at[1])
  box.add(at[0] + size[0], at[1] + size[1])
  void scene
  return {
    name,
    file,
    box,
    pins,
    hit: {
      title: `${tr('계층 시트', 'Hierarchical sheet')} ${name}`,
      lines: [`${tr('파일', 'File')}: ${file}`, tr('하위 시트 파일은 별도로 엽니다.', 'Open the sheet file separately to see it.')],
      d: rectD(box)
    }
  }
}

/** Embedded bitmap `(image (at x y) (scale s) (data "base64…"))`, drawn as <image> (PNG at 300 ppi). */
function drawImage(L: Layer, it: SList): void {
  const at = nums(it, 'at', 2)
  const data = child(it, 'data')
  if (!at || !data) return
  const b64 = data
    .slice(1)
    .filter((x) => typeof x === 'string')
    .join('')
    .replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 40) return
  let bin: string
  try {
    bin = atob(b64.slice(0, 64))
  } catch {
    return
  }
  // PNG IHDR width/height at bytes 16..23.
  if (!bin.startsWith('\x89PNG')) return
  const rd = (o: number) => ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0
  const pw = rd(16)
  const ph = rd(20)
  const scale = num(child(it, 'scale')?.[1], 1) || 1
  const w = (pw / 300) * 25.4 * scale
  const h = (ph / 300) * 25.4 * scale
  if (!(w > 0 && h > 0)) return
  L.box.add(at[0] - w / 2, at[1] - h / 2)
  L.box.add(at[0] + w / 2, at[1] + h / 2)
  L.raw.push(`<image x="${fmt(at[0] - w / 2)}" y="${fmt(at[1] - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="none" href="data:image/png;base64,${b64}"/>`)
}

export type { Effects }
