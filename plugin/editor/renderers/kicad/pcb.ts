/** .kicad_pcb and .kicad_mod (KiCad 6–10): footprints with pads and drills, tracks, arcs, vias,
 *  filled zones, board graphics and text, per layer. */
import { effects, fill, rot, stroke, upright } from './common.ts'
import { plainText, wrapText, type Pt } from './font.ts'
import { arcD, Box, circleD, clockwise, fmt, Scene, type Layer } from './scene.ts'
import { arcPoints, child, children, flag, head, isList, num, nums, points, str, val, type SList } from './sexpr.ts'
import { drawSheet, paperOf, titleBlockOf } from './sheet.ts'
import { bezier } from './symbol.ts'
import type { Hit } from './view.ts'

export interface LayerInfo {
  name: string
  /** User-visible name (KiCad's user name or the canonical one). */
  label: string
  copper: boolean
}

interface HitItem {
  box: Box
  prio: number
  layers: string[]
  test(x: number, y: number, tol: number): boolean
  hit: Hit
}

export interface BoardModel {
  scene: Scene
  /** Board layers present in the drawing, in KiCad's stack order (front first). */
  layers: LayerInfo[]
  bounds: Box
  hit(x: number, y: number, tol: number, visible: (layer: string) => boolean): Hit | null
  order(flipped: boolean): string[]
  info: { version: string; footprints: number; tracks: number; vias: number; zones: number; copper: number; pads: number; name?: string; nets: number }
}

const DEFAULT_LAYERS = [
  'F.Cu',
  'B.Cu',
  'F.Adhes',
  'B.Adhes',
  'F.Paste',
  'B.Paste',
  'F.SilkS',
  'B.SilkS',
  'F.Mask',
  'B.Mask',
  'Dwgs.User',
  'Cmts.User',
  'Eco1.User',
  'Eco2.User',
  'Edge.Cuts',
  'Margin',
  'F.CrtYd',
  'B.CrtYd',
  'F.Fab',
  'B.Fab'
]

const HOLES = 'Holes'

export function buildBoard(root: SList, tr: (ko: string, en: string) => string): BoardModel {
  const isFootprint = head(root) === 'footprint' || head(root) === 'module'
  const scene = new Scene()
  const items: HitItem[] = []

  // Layer table.
  const table: LayerInfo[] = []
  const lt = child(root, 'layers')
  if (lt) {
    for (const l of lt.slice(1)) {
      if (!isList(l)) continue
      const name = str(l[1])
      const user = typeof l[3] === 'string' ? l[3] : undefined
      table.push({ name, label: user && user !== name ? `${name} (${user})` : name, copper: /\.Cu$/.test(name) })
    }
  }
  if (!table.length) for (const n of DEFAULT_LAYERS) table.push({ name: n, label: n, copper: /\.Cu$/.test(n) })
  const copper = copperOrder(table.filter((l) => l.copper).map((l) => l.name))
  const expand = (spec: string): string[] => {
    if (spec === '*.Cu') return copper
    if (spec === 'F&B.Cu') return ['F.Cu', 'B.Cu']
    const m = /^\*\.(.+)$/.exec(spec)
    if (m) return [`F.${m[1]}`, `B.${m[1]}`]
    const fb = /^F&B\.(.+)$/.exec(spec)
    if (fb) return [`F.${fb[1]}`, `B.${fb[1]}`]
    return [spec]
  }

  // Net table (KiCad ≤ 9 numbers nets; KiCad 10 names them directly).
  const netNames = new Map<string, string>()
  for (const n of children(root, 'net')) netNames.set(str(n[1]), str(n[2]))
  const netOf = (it: SList): string => {
    const n = child(it, 'net')
    if (!n) return ''
    if (n.length >= 3) return str(n[2])
    const v = str(n[1])
    return netNames.get(v) ?? (/^\d+$/.test(v) ? '' : v)
  }
  const nets = new Set<string>()

  // Zone fills draw under the tracks and pads of their layer.
  for (const c of copper) {
    scene.layer(`${c}|zonefill`).opacity = 0.6
    scene.layer(c)
  }

  if (!isFootprint) {
    const paper = paperOf(root)
    drawSheet(scene.layer('border'), paper, titleBlockOf(root))
  }

  let tracks = 0
  let vias = 0
  let zones = 0
  let pads = 0
  let footprints = 0

  const T = (x: number, y: number): Pt => [x, y]

  const addHit = (it: HitItem) => items.push(it)

  // --- graphics shared by gr_* and fp_* -----------------------------------------------------
  const graphic = (it: SList, xf: (x: number, y: number) => Pt, fpAngle: number, ctx: { ref?: string; value?: string; inFootprint: boolean }) => {
    const k = head(it).replace(/^(gr|fp)_/, '')
    const layerName = val(it, 'layer')
    if (!layerName && k !== 'text' && k !== 'text_box') return
    const layers = layerName ? expand(layerName) : []
    const st = stroke(it, 0.1)
    const f = fill(it)
    const filled = f.kind !== 'none'
    for (const ln of layers) {
      const L = scene.layer(ln)
      if (k === 'line') {
        const s = nums(it, 'start', 2)
        const e = nums(it, 'end', 2)
        if (s && e) L.line([xf(s[0], s[1]), xf(e[0], e[1])], st.width)
      } else if (k === 'rect') {
        const s = nums(it, 'start', 2)
        const e = nums(it, 'end', 2)
        if (!s || !e) continue
        const pts = [xf(s[0], s[1]), xf(e[0], s[1]), xf(e[0], e[1]), xf(s[0], e[1])]
        if (filled) L.fill(pts)
        L.line(pts, st.width, true)
      } else if (k === 'circle') {
        const c = nums(it, 'center', 2)
        const e = nums(it, 'end', 2)
        if (!c || !e) continue
        const cc = xf(c[0], c[1])
        const r = Math.hypot(e[0] - c[0], e[1] - c[1])
        if (filled) L.fillCircle(cc[0], cc[1], r + st.width / 2)
        else L.circle(cc[0], cc[1], r, st.width)
      } else if (k === 'arc') {
        const s = nums(it, 'start', 2)
        const m = nums(it, 'mid', 2)
        const e = nums(it, 'end', 2)
        if (s && m && e) L.arc(xf(s[0], s[1]), xf(m[0], m[1]), xf(e[0], e[1]), st.width)
        else if (s && e && child(it, 'angle')) {
          // KiCad 5: start = centre, end = arc start, angle = sweep.
          const ang = num(child(it, 'angle')![1])
          const pts: Pt[] = []
          const r = Math.hypot(e[0] - s[0], e[1] - s[1])
          const a0 = Math.atan2(e[1] - s[1], e[0] - s[0])
          for (let i = 0; i <= 32; i++) {
            const t = a0 + (((ang * Math.PI) / 180) * i) / 32
            pts.push(xf(s[0] + r * Math.cos(t), s[1] + r * Math.sin(t)))
          }
          L.line(pts, st.width)
        }
      } else if (k === 'poly') {
        const pts = points(it).map(([x, y]) => xf(x, y))
        if (filled) L.fill(pts)
        if (st.width > 0 && child(child(it, 'stroke'), 'width') ? num(child(child(it, 'stroke'), 'width')![1]) > 0 : true) L.line(pts, st.width, true)
      } else if (k === 'curve') {
        const pts = points(it)
        if (pts.length === 4) L.line(bezier(pts.map(([x, y]) => xf(x, y))), st.width)
      }
    }
    if (k === 'text' || k === 'text_box' || head(it) === 'property') {
      for (const ln of layers) drawText(scene.layer(ln), it, xf, fpAngle, ctx)
    }
  }

  const drawText = (L: Layer, it: SList, xf: (x: number, y: number) => Pt, fpAngle: number, ctx: { ref?: string; value?: string; inFootprint: boolean }) => {
    const isProp = head(it) === 'property'
    const kind = head(it)
    let text = isProp ? str(it[2]) : kind === 'fp_text' ? str(it[2]) : str(it[1])
    const e = effects(child(it, 'effects'), 1, 0.15)
    if (e.hide || flag(it, 'hide')) return
    if (isProp && !child(it, 'layer')) return
    text = text
      .replace(/\$\{REFERENCE\}/g, ctx.ref ?? '')
      .replace(/\$\{VALUE\}/g, ctx.value ?? '')
    if (!text) return
    if (kind === 'gr_text_box' || kind === 'fp_text_box') {
      const s = nums(it, 'start', 2)
      const en = nums(it, 'end', 2)
      if (!s || !en) return
      const m = e.size[1] * 0.4 + e.thickness
      const x = e.h === 'left' ? Math.min(s[0], en[0]) + m : e.h === 'right' ? Math.max(s[0], en[0]) - m : (s[0] + en[0]) / 2
      const y = Math.min(s[1], en[1]) + m
      const p = xf(x, y)
      const st = stroke(it, 0.1)
      const bw = child(child(it, 'stroke'), 'width')
      if (!bw || num(bw[1]) > 0) L.line([xf(s[0], s[1]), xf(en[0], s[1]), xf(en[0], en[1]), xf(s[0], en[1])], st.width, true)
      L.text(wrapText(text, e.size, Math.abs(en[0] - s[0]) - 2 * m), p[0], p[1], { size: e.size, thickness: e.thickness, angle: 0, h: e.h, v: 'top', mirror: e.mirror, italic: e.italic, lineSpacing: e.lineSpacing })
      return
    }
    const at = nums(it, 'at', 3) ?? [0, 0, 0]
    const p = xf(at[0], at[1])
    let angle = at[2]
    let h = e.h
    let v = e.v
    if (ctx.inFootprint && !flag(it, 'unlocked')) {
      void fpAngle
      const u = upright(angle, h, v)
      angle = u.angle
      h = u.h
      v = u.v
    }
    L.text(text, p[0], p[1], { size: e.size, thickness: e.thickness, angle, h, v, mirror: e.mirror, italic: e.italic, lineSpacing: e.lineSpacing })
  }

  // --- pads -----------------------------------------------------------------------------------
  const pad = (pd: SList, fx: number, fy: number, fa: number, fpRef: string, fpLayer: string) => {
    pads++
    const at = nums(pd, 'at', 3) ?? [0, 0, 0]
    const [rx, ry] = rot(at[0], at[1], fa)
    const pa = at[2]
    // The pad position is the hole; a drill offset moves the copper shape away from it.
    const dOff = nums(child(pd, 'drill'), 'offset', 2) ?? [0, 0]
    const [sox, soy] = rot(dOff[0], dOff[1], pa)
    const hx0 = fx + rx
    const hy0 = fy + ry
    const cx = hx0 + sox
    const cy = hy0 + soy
    const number = str(pd[1])
    const type = str(pd[2])
    const shape = str(pd[3])
    const size = nums(pd, 'size', 2) ?? [1, 1]
    const layers = (child(pd, 'layers')?.slice(1) ?? []).filter((x): x is string => typeof x === 'string').flatMap(expand)
    const net = netOf(pd)
    if (net) nets.add(net)
    const local = padShape(pd, shape, size)
    const map = (x: number, y: number): Pt => {
      const [a, b] = rot(x, y, pa)
      return [cx + a, cy + b]
    }
    const d = local.path(map)
    const box = new Box()
    const ext = Math.hypot(size[0], size[1]) / 2 + local.extra
    box.add(cx, cy, ext)
    for (const ln of layers) {
      if (type === 'np_thru_hole' && /\.Cu$/.test(ln) && local.noCopper) continue
      const L = scene.layer(ln)
      L.fillD(d, box)
      for (const s of local.strokes) L.line(s.pts.map(([x, y]) => map(x, y)), s.w)
    }
    // Drill.
    const dr = child(pd, 'drill')
    let drillText = ''
    if (dr) {
      const oval = dr[1] === 'oval'
      const dw = num(oval ? dr[2] : dr[1])
      const dh = oval ? num(dr[3], dw) : dw
      if (dw > 0) {
        const hx = hx0
        const hy = hy0
        const hd = oval ? stadium(dw, dh, (x, y) => {
          const [a, b] = rot(x, y, pa)
          return [hx + a, hy + b]
        }) : circleD(hx, hy, dw / 2)
        const hb = new Box()
        hb.add(hx, hy, Math.max(dw, dh) / 2)
        scene.layer(HOLES).fillD(hd, hb)
        drillText = oval ? `${fmt(dw)} × ${fmt(dh)} mm` : `⌀${fmt(dw)} mm`
      }
    }
    const lines = [
      `${tr('종류', 'Type')}: ${type} · ${shape} · ${fmt(size[0])} × ${fmt(size[1])} mm`,
      ...(drillText ? [`${tr('드릴', 'Drill')}: ${drillText}`] : []),
      ...(net ? [`${tr('넷', 'Net')}: ${net}`] : []),
      `${tr('레이어', 'Layers')}: ${compactLayers(layers, copper)}`
    ]
    addHit({
      box,
      prio: 1,
      layers: layers.length ? layers : [fpLayer],
      test: (x, y, tol) => {
        const [lx, ly] = rot(x - cx, y - cy, -pa)
        return local.contains(lx, ly, tol)
      },
      hit: { title: `${tr('패드', 'Pad')} ${number || '—'}${fpRef ? ` · ${fpRef}` : ''}`, lines, d }
    })
  }

  // --- footprint ------------------------------------------------------------------------------
  const footprint = (fp: SList) => {
    footprints++
    const at = isFootprint ? [0, 0, 0] : (nums(fp, 'at', 3) ?? [0, 0, 0])
    const [fx, fy, fa] = at
    const xf = (x: number, y: number): Pt => {
      const [a, b] = rot(x, y, fa)
      return [fx + a, fy + b]
    }
    const props = new Map<string, string>()
    for (const p of children(fp, 'property')) props.set(str(p[1]), str(p[2]))
    for (const t of children(fp, 'fp_text')) {
      if (t[1] === 'reference') props.set('Reference', str(t[2]))
      if (t[1] === 'value') props.set('Value', str(t[2]))
    }
    const ref = props.get('Reference') ?? ''
    const value = props.get('Value') ?? ''
    const fpLayer = val(fp, 'layer') ?? 'F.Cu'
    const box = new Box()
    scene.probe = box
    for (const it of fp) {
      if (!isList(it)) continue
      const k = head(it)
      if (k === 'pad') pad(it, fx, fy, fa, ref, fpLayer)
      else if (k.startsWith('fp_') && k !== 'fp_text' && k !== 'fp_text_box') graphic(it, xf, fa, { ref, value, inFootprint: true })
      else if (k === 'zone') zone(it)
    }
    scene.probe = undefined
    // Texts last (not part of the footprint's hover box).
    for (const it of fp) {
      if (!isList(it)) continue
      const k = head(it)
      if (k === 'fp_text' || k === 'fp_text_box' || k === 'property') graphic(it, xf, fa, { ref, value, inFootprint: true })
    }
    if (!box.empty && !isFootprint) {
      const lines = [
        ...(value ? [`${tr('값', 'Value')}: ${plainText(value)}`] : []),
        `${tr('풋프린트', 'Footprint')}: ${str(fp[1])}`,
        `${tr('면', 'Side')}: ${fpLayer.startsWith('B.') ? tr('뒷면', 'back') : tr('앞면', 'front')} · ${fmt(fa)}°`
      ]
      if (flag(fp, 'dnp') || (child(fp, 'attr') ?? []).includes('dnp')) lines.push('DNP')
      addHit({
        box,
        prio: 5,
        layers: [fpLayer.startsWith('B.') ? 'B.Cu' : 'F.Cu', fpLayer.startsWith('B.') ? 'B.Fab' : 'F.Fab', fpLayer.startsWith('B.') ? 'B.SilkS' : 'F.SilkS'],
        test: () => true,
        hit: { title: `${plainText(ref) || tr('풋프린트', 'Footprint')}`, lines, d: `M${fmt(box.x0)} ${fmt(box.y0)}H${fmt(box.x1)}V${fmt(box.y1)}H${fmt(box.x0)}Z` }
      })
    }
  }

  // --- zones ----------------------------------------------------------------------------------
  const zone = (z: SList) => {
    zones++
    const net = val(z, 'net_name') ?? netOf(z)
    if (net) nets.add(net)
    for (const fpoly of children(z, 'filled_polygon')) {
      const ln = val(fpoly, 'layer') ?? val(z, 'layer') ?? 'F.Cu'
      const pts = points(fpoly)
      if (pts.length < 3) continue
      // Zone fills are translucent like KiCad's default zone opacity, so tracks under them show.
      const L = scene.layer(`${ln}|zonefill`)
      L.opacity = 0.6
      L.fill(pts)
      const box = new Box()
      for (const p of pts) box.add(p[0], p[1])
      addHit({
        box,
        prio: 7,
        layers: [ln],
        test: (x, y) => pointInPoly(x, y, pts),
        hit: { title: tr('채움 영역', 'Filled zone'), lines: [...(net ? [`${tr('넷', 'Net')}: ${net}`] : []), `${tr('레이어', 'Layer')}: ${ln}`] }
      })
    }
    // Rule areas (keepouts) and unfilled zones: dashed outline.
    if (!children(z, 'filled_polygon').length) {
      const poly = child(z, 'polygon')
      const pts = points(poly)
      const lnames = (child(z, 'layers')?.slice(1).filter((x): x is string => typeof x === 'string') ?? [val(z, 'layer') ?? 'F.Cu']).flatMap(expand)
      for (const ln of lnames) {
        const L = scene.layer(`${ln}|zone`)
        L.dash = '0.5 0.5'
        L.line(pts, 0.05, true)
      }
    }
  }

  // --- walk -----------------------------------------------------------------------------------
  if (isFootprint) footprint(root)
  else {
    for (const it of root) {
      if (!isList(it)) continue
      const k = head(it)
      if (k === 'footprint' || k === 'module') footprint(it)
      else if (k === 'segment') {
        tracks++
        const s = nums(it, 'start', 2)
        const e = nums(it, 'end', 2)
        const w = num(child(it, 'width')?.[1], 0.25)
        const ln = val(it, 'layer') ?? 'F.Cu'
        if (!s || !e) continue
        scene.layer(ln).seg(s[0], s[1], e[0], e[1], w)
        const net = netOf(it)
        if (net) nets.add(net)
        const box = new Box()
        box.add(s[0], s[1], w / 2)
        box.add(e[0], e[1], w / 2)
        addHit({
          box,
          prio: 3,
          layers: [ln],
          test: (x, y, tol) => distSeg(x, y, s[0], s[1], e[0], e[1]) <= w / 2 + tol,
          hit: { title: tr('트랙', 'Track'), lines: [...(net ? [`${tr('넷', 'Net')}: ${net}`] : []), `${tr('폭', 'Width')}: ${fmt(w)} mm · ${ln}`], d: `M${fmt(s[0])} ${fmt(s[1])}L${fmt(e[0])} ${fmt(e[1])}` }
        })
      } else if (k === 'arc') {
        tracks++
        const s = nums(it, 'start', 2)
        const m = nums(it, 'mid', 2)
        const e = nums(it, 'end', 2)
        const w = num(child(it, 'width')?.[1], 0.25)
        const ln = val(it, 'layer') ?? 'F.Cu'
        if (!s || !m || !e) continue
        scene.layer(ln).arc(s as Pt, m as Pt, e as Pt, w)
        const net = netOf(it)
        const box = new Box()
        for (const p of [s, m, e]) box.add(p[0], p[1], w)
        addHit({
          box,
          prio: 3,
          layers: [ln],
          test: () => true,
          hit: { title: tr('트랙 (호)', 'Track (arc)'), lines: [...(net ? [`${tr('넷', 'Net')}: ${net}`] : []), `${tr('폭', 'Width')}: ${fmt(w)} mm · ${ln}`], d: arcD(s as Pt, m as Pt, e as Pt) }
        })
      } else if (k === 'via') {
        vias++
        const at = nums(it, 'at', 2) ?? [0, 0]
        const size = num(child(it, 'size')?.[1], 0.8)
        const drill = num(child(it, 'drill')?.[1], 0.4)
        const vl = (child(it, 'layers')?.slice(1) ?? ['F.Cu', 'B.Cu']).filter((x): x is string => typeof x === 'string')
        const i0 = copper.indexOf(vl[0])
        const i1 = copper.indexOf(vl[vl.length - 1])
        const span = i0 >= 0 && i1 >= 0 ? copper.slice(Math.min(i0, i1), Math.max(i0, i1) + 1) : vl
        const box = new Box()
        box.add(at[0], at[1], size / 2)
        for (const ln of span) scene.layer(ln).fillD(circleD(at[0], at[1], size / 2), box)
        const hb = new Box()
        hb.add(at[0], at[1], drill / 2)
        scene.layer(HOLES).fillD(circleD(at[0], at[1], drill / 2), hb)
        const net = netOf(it)
        const kind = it.includes('micro') ? tr('마이크로 비아', 'Micro via') : it.includes('blind') ? tr('블라인드 비아', 'Blind via') : tr('비아', 'Via')
        addHit({
          box,
          prio: 2,
          layers: span,
          test: (x, y, tol) => Math.hypot(x - at[0], y - at[1]) <= size / 2 + tol,
          hit: {
            title: kind,
            lines: [...(net ? [`${tr('넷', 'Net')}: ${net}`] : []), `⌀${fmt(size)} / ${tr('드릴', 'drill')} ${fmt(drill)} mm`, `${vl[0]} → ${vl[vl.length - 1]}`],
            d: circleD(at[0], at[1], size / 2)
          }
        })
      } else if (k === 'zone') zone(it)
      else if (k.startsWith('gr_')) graphic(it, T, 0, { inFootprint: false })
      else if (k === 'dimension') dimension(it)
      else if (k === 'group' || k === 'generated') {
        // Grouping only.
      }
    }
  }

  function dimension(it: SList): void {
    const ln = val(it, 'layer') ?? 'Dwgs.User'
    const L = scene.layer(ln)
    const pts = points(it)
    const st = child(it, 'style')
    const w = num(child(st, 'thickness')?.[1], 0.1)
    const type = val(it, 'type') ?? 'aligned'
    if (pts.length >= 2 && (type === 'aligned' || type === 'orthogonal')) {
      const [a, b] = pts
      const hgt = num(child(it, 'height')?.[1])
      let dx = b[0] - a[0]
      let dy = b[1] - a[1]
      if (type === 'orthogonal') {
        if (val(it, 'orientation') === '1') dx = 0
        else dy = 0
      }
      const len = Math.hypot(dx, dy) || 1
      const n: Pt = [dy / len, -dx / len]
      const a2: Pt = [a[0] + n[0] * hgt, a[1] + n[1] * hgt]
      const b2: Pt = [a[0] + dx + n[0] * hgt, a[1] + dy + n[1] * hgt]
      L.line([a, a2], w)
      L.line([[a[0] + dx, a[1] + dy], b2], w)
      L.line([a2, b2], w)
    } else if (pts.length >= 2) L.line(pts, w)
    const t = child(it, 'gr_text')
    if (t) drawText(L, t, T, 0, { inFootprint: false })
  }

  // Bounds: the board outline when present, else everything but the page frame.
  const edge = scene.layers.get('Edge.Cuts')?.box
  const bounds = new Box()
  if (edge && !edge.empty) bounds.addBox(edge)
  else bounds.addBox(scene.bounds((l) => l.base !== 'border'))
  if (isFootprint) bounds.addBox(scene.bounds((l) => l.base !== 'border'))
  bounds.add(bounds.x0, bounds.y0, Math.max(bounds.w, bounds.h) * 0.02)
  bounds.add(bounds.x1, bounds.y1, Math.max(bounds.w, bounds.h) * 0.02)

  // Present layers in stack order.
  const present = new Set([...scene.layers.values()].filter((l) => l.strokes.size || l.fills.length || l.texts.length).map((l) => l.base))
  const tableNames = new Map(table.map((l) => [l.name, l]))
  const stack = stackOrder([...present].filter((n) => n !== HOLES && n !== 'border'), copper)
  const layerInfos: LayerInfo[] = stack.map((n) => tableNames.get(n) ?? { name: n, label: n, copper: /\.Cu$/.test(n) })

  const grid = new Grid(bounds.empty ? scene.bounds() : bounds, items)

  return {
    scene,
    layers: layerInfos,
    bounds,
    info: {
      version: str(child(root, 'version')?.[1]),
      footprints,
      tracks,
      vias,
      zones,
      copper: copper.length,
      pads,
      name: isFootprint ? str(root[1]) : undefined,
      nets: nets.size
    },
    order(flipped) {
      // Back to front for the front view; mirrored for the back view.
      const front = stack.filter((n) => n.startsWith('F.'))
      const back = stack.filter((n) => n.startsWith('B.'))
      const inner = stack.filter((n) => /^In\d+\.Cu$/.test(n))
      const other = stack.filter((n) => !n.startsWith('F.') && !n.startsWith('B.') && !/^In\d+\.Cu$/.test(n))
      const frontOrder = (arr: string[]) => {
        // Copper below mask/paste/silk/fab on each side.
        const rank = (n: string) => ['Cu', 'Adhes', 'Paste', 'Mask', 'SilkS', 'Fab', 'CrtYd'].indexOf(n.split('.')[1] ?? '')
        return [...arr].sort((a, b) => rank(a) - rank(b))
      }
      const b = frontOrder(back)
      const f = frontOrder(front)
      const innerTop = flipped ? inner : [...inner].reverse()
      const sideLow = flipped ? f : b
      const sideHigh = flipped ? b : f
      // Drawn farthest first.
      return ['border', ...[...sideLow].reverse().filter((n) => !n.endsWith('.Cu')), ...sideLow.filter((n) => n.endsWith('.Cu')), ...innerTop, ...sideHigh, ...other, HOLES]
    },
    hit(x, y, tol, visible) {
      let best: HitItem | null = null
      for (const it of grid.query(x, y)) {
        if (best && it.prio >= best.prio) continue
        if (!it.box.contains(x, y, tol)) continue
        if (!it.layers.some(visible)) continue
        if (!it.test(x, y, tol)) continue
        best = it
      }
      return best?.hit ?? null
    }
  }
}

function copperOrder(names: string[]): string[] {
  const inner = names.filter((n) => /^In\d+\.Cu$/.test(n)).sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)))
  return [...(names.includes('F.Cu') ? ['F.Cu'] : []), ...inner, ...(names.includes('B.Cu') ? ['B.Cu'] : [])]
}

/** KiCad's layer-manager order: copper (front to back), then technical layers. */
function stackOrder(names: string[], copper: string[]): string[] {
  const order = [
    ...copper,
    'F.Adhes',
    'B.Adhes',
    'F.Paste',
    'B.Paste',
    'F.SilkS',
    'B.SilkS',
    'F.Mask',
    'B.Mask',
    'Dwgs.User',
    'Cmts.User',
    'Eco1.User',
    'Eco2.User',
    'Edge.Cuts',
    'Margin',
    'F.CrtYd',
    'B.CrtYd',
    'F.Fab',
    'B.Fab'
  ]
  const rank = (n: string) => {
    const i = order.indexOf(n)
    if (i >= 0) return i
    const u = /^User\.(\d+)$/.exec(n)
    if (u) return order.length + Number(u[1])
    if (/^In\d+\.Cu$/.test(n)) return copper.length - 1
    return order.length + 100
  }
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

function compactLayers(layers: string[], copper: string[]): string {
  const cu = layers.filter((l) => l.endsWith('.Cu'))
  const rest = layers.filter((l) => !l.endsWith('.Cu'))
  const cuText = cu.length > 2 && cu.length === copper.length ? '*.Cu' : cu.join(' ')
  return [cuText, ...rest].filter(Boolean).join(' ')
}

interface PadShape {
  path(map: (x: number, y: number) => Pt): string
  contains(x: number, y: number, tol: number): boolean
  strokes: { pts: Pt[]; w: number }[]
  extra: number
  noCopper?: boolean
}

function stadium(w: number, h: number, map: (x: number, y: number) => Pt): string {
  if (Math.abs(w - h) < 1e-9) {
    const c = map(0, 0)
    return circleD(c[0], c[1], w / 2)
  }
  const P = (x: number, y: number) => {
    const p = map(x, y)
    return `${fmt(p[0])} ${fmt(p[1])}`
  }
  if (w > h) {
    const r = h / 2
    const dx = w / 2 - r
    return `M${P(-dx, -r)}L${P(dx, -r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${P(dx, r)}L${P(-dx, r)}A${fmt(r)} ${fmt(r)} 0 0 1 ${P(-dx, -r)}Z`
  }
  const r = w / 2
  const dy = h / 2 - r
  return `M${P(r, -dy)}L${P(r, dy)}A${fmt(r)} ${fmt(r)} 0 0 1 ${P(-r, dy)}L${P(-r, -dy)}A${fmt(r)} ${fmt(r)} 0 0 1 ${P(r, -dy)}Z`
}

function polyPath(pts: Pt[], map: (x: number, y: number) => Pt): string {
  return (
    clockwise(pts.map(([x, y]) => map(x, y)))
      .map((p, i) => {
        return `${i ? 'L' : 'M'}${fmt(p[0])} ${fmt(p[1])}`
      })
      .join('') + 'Z'
  )
}

function roundRect(w: number, h: number, r: number, map: (x: number, y: number) => Pt): string {
  r = Math.min(r, w / 2, h / 2)
  if (r <= 1e-9) return polyPath(rectPts(w, h), map)
  const P = (x: number, y: number) => {
    const p = map(x, y)
    return `${fmt(p[0])} ${fmt(p[1])}`
  }
  const x = w / 2
  const y = h / 2
  const A = `A${fmt(r)} ${fmt(r)} 0 0 1 `
  return `M${P(-x + r, -y)}L${P(x - r, -y)}${A}${P(x, -y + r)}L${P(x, y - r)}${A}${P(x - r, y)}L${P(-x + r, y)}${A}${P(-x, y - r)}L${P(-x, -y + r)}${A}${P(-x + r, -y)}Z`
}

const rectPts = (w: number, h: number): Pt[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2]
]

function inRect(x: number, y: number, w: number, h: number, tol: number): boolean {
  return Math.abs(x) <= w / 2 + tol && Math.abs(y) <= h / 2 + tol
}

function padShape(pd: SList, shape: string, size: number[]): PadShape {
  const [w, h] = size
  const strokes: { pts: Pt[]; w: number }[] = []
  if (shape === 'circle') {
    return { path: (m) => stadium(w, w, m), contains: (x, y, t) => Math.hypot(x, y) <= w / 2 + t, strokes, extra: 0 }
  }
  if (shape === 'oval') {
    return {
      path: (m) => stadium(w, h, m),
      contains: (x, y, t) => {
        const r = Math.min(w, h) / 2
        const dx = Math.max(0, Math.abs(x) - (w / 2 - r))
        const dy = Math.max(0, Math.abs(y) - (h / 2 - r))
        return Math.hypot(dx, dy) <= r + t
      },
      strokes,
      extra: 0
    }
  }
  if (shape === 'roundrect' || shape === 'chamfered_rect') {
    const ratio = num(child(pd, 'roundrect_rratio')?.[1], shape === 'roundrect' ? 0.25 : 0)
    const r = ratio * Math.min(w, h)
    const cr = num(child(pd, 'chamfer_ratio')?.[1], 0) * Math.min(w, h)
    const corners = child(pd, 'chamfer')?.slice(1) ?? []
    if (cr > 0 && corners.length) {
      const x = w / 2
      const y = h / 2
      const pts: Pt[] = []
      const tl = corners.includes('top_left')
      const tr = corners.includes('top_right')
      const br = corners.includes('bottom_right')
      const bl = corners.includes('bottom_left')
      if (tl) pts.push([-x, -y + cr], [-x + cr, -y])
      else pts.push([-x, -y])
      if (tr) pts.push([x - cr, -y], [x, -y + cr])
      else pts.push([x, -y])
      if (br) pts.push([x, y - cr], [x - cr, y])
      else pts.push([x, y])
      if (bl) pts.push([-x + cr, y], [-x, y - cr])
      else pts.push([-x, y])
      return { path: (m) => polyPath(pts, m), contains: (px, py, t) => inRect(px, py, w, h, t), strokes, extra: 0 }
    }
    return { path: (m) => roundRect(w, h, r, m), contains: (x, y, t) => inRect(x, y, w, h, t), strokes, extra: 0 }
  }
  if (shape === 'trapezoid') {
    const dd = nums(pd, 'rect_delta', 2) ?? [0, 0]
    const dx = dd[0] / 2
    const dy = dd[1] / 2
    const hx = w / 2
    const hy = h / 2
    const pts: Pt[] = [
      [-hx - dy, hy + dx],
      [-hx + dy, -hy - dx],
      [hx - dy, -hy + dx],
      [hx + dy, hy - dx]
    ]
    return { path: (m) => polyPath(pts, m), contains: (x, y, t) => pointInPoly(x, y, pts) || inRect(x, y, w, h, t * 0), strokes, extra: Math.abs(dx) + Math.abs(dy) }
  }
  if (shape === 'custom') {
    const anchor = val(child(pd, 'options'), 'anchor') ?? 'rect'
    const prims = child(pd, 'primitives')
    const parts: ((m: (x: number, y: number) => Pt) => string)[] = []
    const polys: Pt[][] = []
    let extra = 0
    parts.push((m) => (anchor === 'circle' ? stadium(w, w, m) : polyPath(rectPts(w, h), m)))
    for (const g of prims?.slice(1) ?? []) {
      if (!isList(g)) continue
      const k = head(g)
      const gw = num(child(g, 'width')?.[1] ?? child(child(g, 'stroke'), 'width')?.[1], 0)
      const filled = fill(g).kind !== 'none' || k === 'gr_poly'
      if (k === 'gr_poly') {
        const pts = points(g)
        polys.push(pts)
        for (const p of pts) extra = Math.max(extra, Math.hypot(p[0], p[1]))
        parts.push((m) => polyPath(pts, m))
        if (gw > 0) strokes.push({ pts: [...pts, pts[0]], w: gw })
      } else if (k === 'gr_circle') {
        const c = nums(g, 'center', 2) ?? [0, 0]
        const e = nums(g, 'end', 2) ?? [0, 0]
        const r = Math.hypot(e[0] - c[0], e[1] - c[1])
        extra = Math.max(extra, Math.hypot(c[0], c[1]) + r)
        if (filled || gw === 0)
          parts.push((m) => {
            const p = m(c[0], c[1])
            return circleD(p[0], p[1], r + gw / 2)
          })
        else {
          const pts: Pt[] = []
          for (let i = 0; i <= 48; i++) pts.push([c[0] + r * Math.cos((i / 48) * 2 * Math.PI), c[1] + r * Math.sin((i / 48) * 2 * Math.PI)])
          strokes.push({ pts, w: gw })
        }
      } else if (k === 'gr_line') {
        const s = nums(g, 'start', 2) ?? [0, 0]
        const e = nums(g, 'end', 2) ?? [0, 0]
        extra = Math.max(extra, Math.hypot(s[0], s[1]), Math.hypot(e[0], e[1]))
        strokes.push({ pts: [s as Pt, e as Pt], w: gw })
      } else if (k === 'gr_rect') {
        const s = nums(g, 'start', 2) ?? [0, 0]
        const e = nums(g, 'end', 2) ?? [0, 0]
        const pts: Pt[] = [
          [s[0], s[1]],
          [e[0], s[1]],
          [e[0], e[1]],
          [s[0], e[1]]
        ]
        extra = Math.max(extra, ...pts.map((p) => Math.hypot(p[0], p[1])))
        if (filled) {
          polys.push(pts)
          parts.push((m) => polyPath(pts, m))
        }
        if (gw > 0) strokes.push({ pts: [...pts, pts[0]], w: gw })
      } else if (k === 'gr_arc') {
        const s = nums(g, 'start', 2)
        const mm = nums(g, 'mid', 2)
        const e = nums(g, 'end', 2)
        if (s && mm && e) {
          const pts = arcPts(s as Pt, mm as Pt, e as Pt)
          strokes.push({ pts, w: gw })
          extra = Math.max(extra, ...pts.map((p) => Math.hypot(p[0], p[1])))
        }
      }
    }
    return {
      path: (m) => parts.map((p) => p(m)).join(''),
      contains: (x, y, t) => inRect(x, y, w, h, t) || polys.some((p) => pointInPoly(x, y, p)),
      strokes,
      extra
    }
  }
  // rect and unknown shapes
  return { path: (m) => polyPath(rectPts(w, h), m), contains: (x, y, t) => inRect(x, y, w, h, t), strokes, extra: 0 }
}

const arcPts = (s: Pt, m: Pt, e: Pt) => arcPoints(s, m, e, 24)

export function pointInPoly(x: number, y: number, pts: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distSeg(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

/** Uniform grid over hit items; items spanning many cells go to a shared list. */
class Grid {
  private cells = new Map<number, HitItem[]>()
  private big: HitItem[] = []
  private x0: number
  private y0: number
  private cs: number
  private n = 128
  constructor(b: Box, items: HitItem[]) {
    this.x0 = b.empty ? 0 : b.x0
    this.y0 = b.empty ? 0 : b.y0
    this.cs = Math.max(1, (b.empty ? 100 : Math.max(b.w, b.h)) / this.n)
    for (const it of items) {
      const i0 = this.ix(it.box.x0)
      const i1 = this.ix(it.box.x1)
      const j0 = this.ix(it.box.y0, true)
      const j1 = this.ix(it.box.y1, true)
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) {
        this.big.push(it)
        continue
      }
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const k = i * 100003 + j
          let a = this.cells.get(k)
          if (!a) this.cells.set(k, (a = []))
          a.push(it)
        }
    }
  }
  private ix(v: number, y = false): number {
    return Math.floor((v - (y ? this.y0 : this.x0)) / this.cs)
  }
  query(x: number, y: number): HitItem[] {
    const out: HitItem[] = [...this.big]
    const i = this.ix(x)
    const j = this.ix(y, true)
    for (let a = i - 1; a <= i + 1; a++)
      for (let b = j - 1; b <= j + 1; b++) {
        const c = this.cells.get(a * 100003 + b)
        if (c) out.push(...c)
      }
    return out
  }
}
