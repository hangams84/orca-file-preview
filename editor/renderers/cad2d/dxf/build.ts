/** DXF document → `Scene`: model space, paper-space layouts with viewports, blocks as references,
 *  layers, linetypes, ACI/true colours and lineweights. */
import {
  apply,
  arcPoints,
  bump,
  C,
  emptyScene,
  invert,
  isEmpty,
  itemsBox,
  mul,
  P,
  rotate,
  scale,
  translate,
  type HatchItem,
  type Item,
  type Mat,
  type PathItem,
  type Scene,
  type SceneView,
  type TextItem
} from '../scene.ts'
import { mergePaths } from '../scene.ts'
import { PathB } from '../path.ts'
import { aciColor } from './aci.ts'
import { parseMText, plainText } from './mtext.ts'
import { hdr, num, str, tag, unescapeDxf, UNITS, VERSIONS, type DxfDoc, type Ent, type StyleRec } from './reader.ts'

const D2R = Math.PI / 180
const MAX_REFS = 1_000_000
const MAX_HATCH_SEGMENTS = 30000

/** OCS → WCS (projected on the XY plane) for an extrusion direction and elevation. */
export function ocsMatrix(nx: number, ny: number, nz: number, elevation = 0): Mat | undefined {
  const len = Math.hypot(nx, ny, nz)
  if (!(len > 0)) return undefined
  nx /= len
  ny /= len
  nz /= len
  // Extrusion +Z: OCS = WCS (the elevation only moves along Z, which the plan view drops).
  if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12 && nz > 0) return undefined
  let ax: number, ay: number, az: number
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) {
    // Wy × N
    ax = nz
    ay = 0
    az = -nx
  } else {
    // Wz × N
    ax = -ny
    ay = nx
    az = 0
  }
  const al = Math.hypot(ax, ay, az)
  ax /= al
  ay /= al
  az /= al
  // Ay = N × Ax
  const bx = ny * az - nz * ay
  const by = nz * ax - nx * az
  return [ax, ay, bx, by, nx * elevation, ny * elevation]
}

/** Font family for a text style (TrueType name, or undefined for SHX fonts → default stack). */
export function styleFamily(st: StyleRec | undefined): string | undefined {
  if (!st) return undefined
  if (st.family) return st.family
  const f = st.font.trim().toLowerCase()
  if (!f || /\.shx$/.test(f) || !/\./.test(f)) {
    if (f && !/\.shx$/.test(f) && !/^(txt|simplex|romans|romand|isocp|iso|gdt|monotxt)$/.test(f)) return st.font.trim()
    return undefined
  }
  const base = f.replace(/\.(ttf|ttc|otf)$/, '')
  const known: Record<string, string> = {
    arial: 'Arial',
    arialn: 'Arial Narrow',
    times: 'Times New Roman',
    cour: 'Courier New',
    calibri: 'Calibri',
    malgun: 'Malgun Gothic',
    malgunbd: 'Malgun Gothic',
    gulim: 'Gulim',
    batang: 'Batang',
    dotum: 'Dotum',
    gungsuh: 'Gungsuh',
    simsun: 'SimSun',
    msgothic: 'MS Gothic',
    msmincho: 'MS Mincho',
    isocpeur: 'ISOCPEUR',
    romantic: 'Times New Roman',
    tahoma: 'Tahoma',
    verdana: 'Verdana',
    segoeui: 'Segoe UI'
  }
  return known[base] ?? base
}

interface Common {
  layer: number
  color: number
  lw: number
  dash?: number[]
  alpha?: number
}

export function buildScene(doc: DxfDoc): Scene {
  return new Builder(doc).build()
}

class Builder {
  scene: Scene = emptyScene('DXF')
  private t: DxfDoc['t']
  private layerIdx = new Map<string, number>()
  private layerByHandle = new Map<string, number>()
  private layerLtype: string[] = []
  private layerLw: number[] = []
  private ltscale: number
  private dashCache = new Map<string, number[] | undefined>()
  private asz: number
  private rays: { item: PathItem; x: number; y: number; dx: number; dy: number; ray: boolean }[] = []
  private refCount = 0
  private pdsize: number

  constructor(private doc: DxfDoc) {
    this.t = doc.t
    this.ltscale = Number(hdr(doc, '$LTSCALE') ?? 1) || 1
    const dimscale = Number(hdr(doc, '$DIMSCALE') ?? 1) || 1
    this.asz = (Number(hdr(doc, '$DIMASZ') ?? 0.18) || 0.18) * dimscale
    this.pdsize = Number(hdr(doc, '$PDSIZE') ?? 0) || 0
  }

  build(): Scene {
    const { doc, scene } = this
    const ver = String(hdr(doc, '$ACADVER') ?? '')
    scene.version = ver ? `${VERSIONS[ver] ?? ver} (${ver})` : 'R12 or older'
    const u = Number(hdr(doc, '$INSUNITS') ?? 0)
    scene.units = UNITS[u] || (Number(hdr(doc, '$MEASUREMENT') ?? -1) === 0 ? 'in' : Number(hdr(doc, '$MEASUREMENT') ?? -1) === 1 ? 'mm' : '')
    scene.info.push(`${this.t.binary ? 'binary' : 'ASCII'} DXF`)
    if (this.t.encoding !== 'utf-8') scene.info.push(this.t.encoding)

    for (const l of doc.layers) this.addLayer(l.name, l.trueColor !== undefined ? l.trueColor & 0xffffff : Math.abs(l.color) === 7 ? C.FG : aciColor(l.color), l.color >= 0 && !l.frozen, l.ltype, l.lw, l.handle)
    if (!this.layerIdx.has('0')) this.addLayer('0', C.FG, true, 'CONTINUOUS', -3, '')

    // Blocks (layout blocks become views below).
    for (const [key, b] of doc.blocks) {
      if (/^\*(MODEL|PAPER)_SPACE/.test(key)) continue
      const items: Item[] = []
      if (b.flags & 4) bump(scene.skipped, 'external reference (xref)')
      else this.entities(b.ents, items, true)
      scene.blocks.set(key, { name: b.name, items: mergePaths(items) })
    }

    // Model space and the active paper space from ENTITIES.
    const t = this.t
    const model: Ent[] = []
    const paper: Ent[] = []
    for (const e of doc.entities) (num(t, e.s, e.e, 67) === 1 ? paper : model).push(e)
    for (const e of [...model, ...paper]) bump(scene.counts, e.type)
    const modelItems: Item[] = []
    this.entities(model, modelItems, false)
    const modelView: SceneView = { name: 'Model', kind: 'model', items: mergePaths(modelItems) }
    scene.views.push(modelView)
    this.fixRays(modelView)

    // Layouts: *Paper_Space (active, from ENTITIES) and *Paper_SpaceN blocks.
    const layoutInfo = this.layouts()
    const sheets: { name: string; order: number; ents: Ent[]; limits?: [number, number, number, number] }[] = []
    for (const [key, b] of doc.blocks) {
      if (!/^\*PAPER_SPACE/.test(key)) continue
      const info = layoutInfo.get(key)
      const ents = key === '*PAPER_SPACE' ? paper : b.ents
      if (key !== '*PAPER_SPACE') for (const e of ents) bump(scene.counts, e.type)
      sheets.push({ name: info?.name ?? (key === '*PAPER_SPACE' ? 'Layout1' : b.name.replace(/^\*/, '')), order: info?.order ?? 99, ents, limits: info?.limits })
    }
    if (!doc.blocks.has('*PAPER_SPACE') && paper.length) sheets.push({ name: 'Paper space', order: 1, ents: paper })
    sheets.sort((a, b) => a.order - b.order)
    for (const s of sheets) {
      const items: Item[] = []
      this.entities(s.ents, items, false)
      const view: SceneView = { name: s.name, kind: 'layout', items: mergePaths(items) }
      if (s.limits) {
        const [x0, y0, x1, y1] = s.limits
        if (x1 > x0 && y1 > y0 && !(x0 === 0 && y0 === 0 && x1 === 12 && y1 === 9)) view.paper = { x0, y0, x1, y1 }
      }
      if (!view.items.length) continue // an empty sheet adds nothing
      if (!view.paper) {
        const b = itemsBox(scene, view.items)
        if (!isEmpty(b)) {
          const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.03
          view.paper = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }
        }
      }
      scene.views.push(view)
    }
    scene.info.push(`${scene.blocks.size} blocks`)
    return scene
  }

  private addLayer(name: string, color: number, visible: boolean, ltype: string, lw: number, handle: string): number {
    const key = name.toUpperCase()
    const ex = this.layerIdx.get(key)
    if (ex !== undefined) return ex
    const i = this.scene.layers.length
    this.scene.layers.push({ name, color, visible, count: 0 })
    this.layerIdx.set(key, i)
    if (handle) this.layerByHandle.set(handle.toUpperCase(), i)
    this.layerLtype[i] = ltype
    this.layerLw[i] = lw
    return i
  }

  private layouts(): Map<string, { name: string; order: number; limits?: [number, number, number, number] }> {
    const t = this.t
    const out = new Map<string, { name: string; order: number; limits?: [number, number, number, number] }>()
    const byHandle = new Map<string, Ent>()
    for (const l of this.doc.layouts) byHandle.set(str(t, l.s, l.e, 5).toUpperCase(), l)
    const info = (l: Ent) => {
      let k = l.s
      for (let i = l.s; i < l.e; i++)
        if (t.codes[i] === 100 && t.vals[i] === 'AcDbLayout') {
          k = i
          break
        }
      const limits: [number, number, number, number] = [num(t, k, l.e, 10), num(t, k, l.e, 20), num(t, k, l.e, 11), num(t, k, l.e, 21)]
      let rec = ''
      for (let i = k; i < l.e; i++) if (t.codes[i] === 330) rec = String(t.vals[i]).toUpperCase()
      return { name: str(t, k, l.e, 1, str(t, l.s, l.e, 1)), order: num(t, k, l.e, 71, 99), limits, rec }
    }
    for (const [recName, h] of this.doc.layoutOfRecord) {
      const l = byHandle.get(h)
      if (l) out.set(recName, info(l))
    }
    for (const l of this.doc.layouts) {
      const i = info(l)
      const recName = this.doc.recordByHandle.get(i.rec)?.toUpperCase()
      if (recName && !out.has(recName)) out.set(recName, i)
    }
    return out
  }

  // ---- common properties ----------------------------------------------------------------

  private layerOf(name: string, inBlock: boolean): number {
    if (inBlock && name === '0') return -1
    const i = this.layerIdx.get(name.toUpperCase())
    return i ?? this.addLayer(name, C.FG, true, 'CONTINUOUS', -3, '')
  }

  private common(e: Ent, inBlock: boolean): Common | null {
    const t = this.t
    let layerName = '0'
    let c62: number | undefined
    let tc: number | undefined
    let lt = 'BYLAYER'
    let lts = 1
    let lw370 = -1
    let alpha: number | undefined
    // Common properties live in the AcDbEntity subclass (or anywhere in R12 files without markers).
    let inEntity = false
    for (let i = e.s + 1; i < e.e; i++) {
      const c = t.codes[i]
      if (c === 100) {
        if (t.vals[i] === 'AcDbEntity') inEntity = true
        else if (inEntity) break
        continue
      }
      if (c === 8) layerName = String(t.vals[i])
      else if (c === 62) c62 = Number(t.vals[i])
      else if (c === 420) tc = Number(t.vals[i])
      else if (c === 6) lt = String(t.vals[i])
      else if (c === 48) lts = Number(t.vals[i]) || 1
      else if (c === 370) lw370 = Number(t.vals[i])
      else if (c === 60 && Number(t.vals[i]) === 1) return null
      else if (c === 440) {
        const v = Number(t.vals[i])
        if (v & 0x02000000) alpha = (v & 255) / 255
      }
    }
    const layer = this.layerOf(layerName, inBlock)
    if (layer >= 0) this.scene.layers[layer].count++
    let color: number
    if (tc !== undefined) color = tc & 0xffffff
    else if (c62 === undefined || c62 === 256) color = layer === -1 ? C.BYLAYER_INHERIT : this.scene.layers[layer].color
    else if (c62 === 0) color = C.BYBLOCK
    else if (Math.abs(c62) === 7) color = C.FG
    else color = aciColor(c62)
    let lw: number
    if (lw370 === -1) {
      const l = layer >= 0 ? this.layerLw[layer] : -2
      lw = l === -2 ? -1 : l <= 0 ? 0 : l / 100
    } else if (lw370 === -2) lw = -1
    else lw = lw370 <= 0 ? 0 : lw370 / 100
    let ltName = lt.toUpperCase()
    if (ltName === 'BYLAYER') ltName = layer >= 0 ? (this.layerLtype[layer] ?? 'CONTINUOUS').toUpperCase() : 'CONTINUOUS'
    const dash = ltName === 'BYBLOCK' || ltName === 'CONTINUOUS' ? undefined : this.dash(ltName, lts * this.ltscale)
    return { layer, color, lw, dash, alpha }
  }

  private dash(name: string, s: number): number[] | undefined {
    const key = `${name}\u0000${s}`
    if (this.dashCache.has(key)) return this.dashCache.get(key)
    const els = this.doc.ltypes.get(name)
    let out: number[] | undefined
    if (els && els.length && els.some((v) => v !== 0)) {
      out = []
      // Canvas dash arrays alternate dash, gap: merge same-sign runs.
      for (const v of els) {
        const isDash = v >= 0
        const len = Math.abs(v) * s
        const wantDash = out.length % 2 === 0
        if (isDash === wantDash) out.push(len)
        else if (out.length) out[out.length - 1] += len
        else out.push(0, len) // starts with a gap
      }
      if (out.length % 2) out.push(0)
    }
    this.dashCache.set(key, out)
    return out
  }

  private path(cm: Common, d: number[], extra: Partial<PathItem> = {}): PathItem {
    return { k: 'path', layer: cm.layer, color: cm.color, lw: cm.lw, alpha: cm.alpha, d, stroke: true, fill: false, dash: cm.dash, ...extra }
  }

  private ocs(e: Ent, elevCode = 38): Mat | undefined {
    const t = this.t
    const nz = num(t, e.s, e.e, 230, 1)
    const nx = num(t, e.s, e.e, 210, 0)
    const ny = num(t, e.s, e.e, 220, 0)
    if (nx === 0 && ny === 0 && nz > 0) return undefined
    return ocsMatrix(nx, ny, nz, num(t, e.s, e.e, elevCode))
  }

  // ---- entities ----------------------------------------------------------------------------

  /** Block contents stay in block coordinates: the base point is folded into each reference. */
  entities(ents: Ent[], out: Item[], inBlock: boolean): void {
    for (const e of ents) {
      try {
        this.entity(e, out, inBlock)
      } catch {
        bump(this.scene.skipped, `${e.type} (damaged)`)
      }
    }
  }

  private entity(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const S = e.s
    const E = e.e
    switch (e.type) {
      case 'LINE': {
        const cm = this.common(e, inBlock)
        if (!cm) return
        const p = new PathB().M(num(t, S, E, 10), num(t, S, E, 20)).L(num(t, S, E, 11), num(t, S, E, 21))
        out.push(this.path(cm, p.d))
        return
      }
      case 'POINT': {
        const cm = this.common(e, inBlock)
        if (!cm) return
        out.push({ k: 'point', layer: cm.layer, color: cm.color, lw: 0, x: num(t, S, E, 10), y: num(t, S, E, 20) })
        return
      }
      case 'CIRCLE': {
        const cm = this.common(e, inBlock)
        if (!cm) return
        const p = new PathB(this.ocs(e, 30)).circle(num(t, S, E, 10), num(t, S, E, 20), num(t, S, E, 40))
        out.push(this.path(cm, p.d))
        return
      }
      case 'ARC': {
        const cm = this.common(e, inBlock)
        if (!cm) return
        const r = num(t, S, E, 40)
        const a0 = num(t, S, E, 50) * D2R
        let a1 = num(t, S, E, 51) * D2R
        if (a1 <= a0) a1 += Math.PI * 2
        const p = new PathB(this.ocs(e, 30)).E(num(t, S, E, 10), num(t, S, E, 20), r, r, 0, a0, a1, true)
        out.push(this.path(cm, p.d))
        return
      }
      case 'ELLIPSE': {
        const cm = this.common(e, inBlock)
        if (!cm) return
        const mx = num(t, S, E, 11)
        const my = num(t, S, E, 21)
        const rx = Math.hypot(mx, my)
        const ry = rx * num(t, S, E, 40, 1)
        let a0 = num(t, S, E, 41, 0)
        let a1 = num(t, S, E, 42, Math.PI * 2)
        if (a1 <= a0) a1 += Math.PI * 2
        const rot = Math.atan2(my, mx)
        const nz = num(t, S, E, 230, 1)
        const p = new PathB()
        if (nz < 0) p.E(num(t, S, E, 10), num(t, S, E, 20), rx, ry, rot, -a0, -a1, false)
        else p.E(num(t, S, E, 10), num(t, S, E, 20), rx, ry, rot, a0, a1, true)
        if (Math.abs(a1 - a0 - Math.PI * 2) < 1e-9) p.Z()
        out.push(this.path(cm, p.d))
        return
      }
      case 'LWPOLYLINE':
        return this.lwpolyline(e, out, inBlock)
      case 'POLYLINE':
        return this.polyline(e, out, inBlock)
      case 'SPLINE':
        return this.spline(e, out, inBlock)
      case 'TEXT':
      case 'ATTDEF':
        if (e.type === 'ATTDEF' && inBlock) return
        return this.text(e, out, inBlock, e.type === 'ATTDEF')
      case 'MTEXT':
        return this.mtext(e, out, inBlock)
      case 'INSERT':
      case 'MINSERT':
        return this.insert(e, out, inBlock)
      case 'DIMENSION':
      case 'ARC_DIMENSION':
      case 'LARGE_RADIAL_DIMENSION':
      case 'ACAD_TABLE':
        return this.blockRef(e, out, inBlock)
      case 'HATCH':
      case 'MPOLYGON':
        return this.hatch(e, out, inBlock)
      case 'SOLID':
      case 'TRACE': {
        const cm = this.common(e, inBlock)
        if (!cm) return
        const p = new PathB(this.ocs(e))
        p.M(num(t, S, E, 10), num(t, S, E, 20)).L(num(t, S, E, 11), num(t, S, E, 21))
        const x3 = tag(t, S, E, 13)
        if (x3 !== undefined) p.L(num(t, S, E, 13), num(t, S, E, 23))
        p.L(num(t, S, E, 12), num(t, S, E, 22)).Z()
        out.push(this.path(cm, p.d, { fill: true, stroke: true, dash: undefined }))
        return
      }
      case '3DFACE': {
        const cm = this.common(e, inBlock)
        if (!cm) return
        const pts = [10, 11, 12, 13].map((c) => [num(t, S, E, c), num(t, S, E, c + 10)] as [number, number])
        const hidden = num(t, S, E, 70)
        const p = new PathB()
        for (let i = 0; i < 4; i++) {
          if (hidden & (1 << i)) continue
          const a = pts[i]
          const b = pts[(i + 1) % 4]
          p.M(a[0], a[1]).L(b[0], b[1])
        }
        out.push(this.path(cm, p.d))
        return
      }
      case 'LEADER':
        return this.leader(e, out, inBlock)
      case 'MULTILEADER':
      case 'MLEADER':
        return this.mleader(e, out, inBlock)
      case 'RAY':
      case 'XLINE': {
        const cm = this.common(e, inBlock)
        if (!cm) return
        const it = this.path(cm, [], { noExtents: true })
        this.rays.push({ item: it, x: num(t, S, E, 10), y: num(t, S, E, 20), dx: num(t, S, E, 11), dy: num(t, S, E, 21), ray: e.type === 'RAY' })
        out.push(it)
        return
      }
      case 'WIPEOUT':
      case 'IMAGE':
        return this.image(e, out, inBlock)
      case 'VIEWPORT':
        return this.viewport(e, out)
      case 'ATTRIB':
      case 'SEQEND':
      case 'VERTEX':
        return
      default:
        bump(this.scene.skipped, e.type)
    }
  }

  private lwpolyline(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const cm = this.common(e, inBlock)
    if (!cm) return
    const verts: { x: number; y: number; b: number; w: number }[] = []
    let cur: { x: number; y: number; b: number; w: number } | null = null
    for (let i = e.s + 1; i < e.e; i++) {
      const c = t.codes[i]
      if (c === 10) {
        cur = { x: Number(t.vals[i]), y: 0, b: 0, w: 0 }
        verts.push(cur)
      } else if (cur && c === 20) cur.y = Number(t.vals[i])
      else if (cur && c === 42) cur.b = Number(t.vals[i])
      else if (cur && (c === 40 || c === 41)) cur.w = Math.max(cur.w, Number(t.vals[i]))
    }
    const closed = (num(t, e.s, e.e, 70) & 1) === 1
    const width = Math.max(num(t, e.s, e.e, 43), ...verts.map((v) => v.w))
    this.polyPath(cm, verts, closed, width, this.ocs(e), out)
  }

  private polyPath(cm: Common, verts: { x: number; y: number; b: number }[], closed: boolean, width: number, m: Mat | undefined, out: Item[]): void {
    if (!verts.length) return
    const p = new PathB(m)
    p.M(verts[0].x, verts[0].y)
    const n = verts.length
    const segs = closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const a = verts[i]
      const b = verts[(i + 1) % n]
      p.bulge(a.x, a.y, b.x, b.y, a.b)
    }
    if (closed) p.Z()
    if (n === 1) p.L(verts[0].x, verts[0].y)
    out.push(this.path(cm, p.d, width > 0 ? { width, cap: 'butt', join: 'miter' } : {}))
  }

  private polyline(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const cm = this.common(e, inBlock)
    if (!cm) return
    const flags = num(t, e.s, e.e, 70)
    const vs = (e.children ?? []).map((v) => ({
      x: num(t, v.s, v.e, 10),
      y: num(t, v.s, v.e, 20),
      b: num(t, v.s, v.e, 42),
      f: num(t, v.s, v.e, 70),
      w: Math.max(num(t, v.s, v.e, 40), num(t, v.s, v.e, 41)),
      i: [71, 72, 73, 74].map((c) => num(t, v.s, v.e, c))
    }))
    if (flags & 64) {
      // Polyface mesh: vertices then face records with 1-based (negative = invisible) indices.
      const coords = vs.filter((v) => (v.f & 192) === 192)
      const faces = vs.filter((v) => (v.f & 192) === 128)
      const p = new PathB()
      for (const f of faces) {
        const idx = f.i.filter((k) => k !== 0)
        for (let i = 0; i < idx.length; i++) {
          if (idx[i] < 0) continue
          const a = coords[Math.abs(idx[i]) - 1]
          const b = coords[Math.abs(idx[(i + 1) % idx.length]) - 1]
          if (a && b) p.M(a.x, a.y).L(b.x, b.y)
        }
      }
      out.push(this.path(cm, p.d))
      return
    }
    if (flags & 16) {
      // Polygon mesh M × N: draw the grid.
      const m = num(t, e.s, e.e, 71)
      const n = num(t, e.s, e.e, 72)
      const p = new PathB()
      for (let i = 0; i < m; i++)
        for (let j = 0; j < n; j++) {
          const a = vs[i * n + j]
          if (!a) continue
          const r = vs[i * n + j + 1]
          const d = vs[(i + 1) * n + j]
          if (r && j + 1 < n) p.M(a.x, a.y).L(r.x, r.y)
          if (d && i + 1 < m) p.M(a.x, a.y).L(d.x, d.y)
        }
      out.push(this.path(cm, p.d))
      return
    }
    // Spline-fit polylines keep only the curve vertices (flag 8), not the frame (16).
    const verts = vs.filter((v) => !(v.f & 16))
    const width = Math.max(num(t, e.s, e.e, 40), num(t, e.s, e.e, 41), ...verts.map((v) => v.w))
    this.polyPath(cm, verts, (flags & 1) === 1, width, flags & 8 ? undefined : this.ocs(e, 30), out)
  }

  private spline(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const cm = this.common(e, inBlock)
    if (!cm) return
    const deg = num(t, e.s, e.e, 71, 3)
    const knots: number[] = []
    const weights: number[] = []
    const ctrl: [number, number][] = []
    const fit: [number, number][] = []
    for (let i = e.s + 1; i < e.e; i++) {
      const c = t.codes[i]
      const v = Number(t.vals[i])
      if (c === 40) knots.push(v)
      else if (c === 41) weights.push(v)
      else if (c === 10) ctrl.push([v, 0])
      else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = v
      else if (c === 11) fit.push([v, 0])
      else if (c === 21 && fit.length) fit[fit.length - 1][1] = v
    }
    const pts = ctrl.length > deg ? nurbs(deg, knots, ctrl, weights) : fit.length > 1 ? catmull(fit) : ctrl
    if (pts.length < 2) return
    const p = new PathB()
    p.M(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) p.L(pts[i][0], pts[i][1])
    if (num(t, e.s, e.e, 70) & 1) p.Z()
    out.push(this.path(cm, p.d))
  }

  // ---- text ----------------------------------------------------------------------------------

  private style(name: string): StyleRec | undefined {
    return this.doc.styles.get((name || 'STANDARD').toUpperCase())
  }

  private text(e: Ent, out: Item[], inBlock: boolean, isAttdef = false, cmOverride?: Common): void {
    const t = this.t
    const S = e.s
    const E = e.e
    const cm = cmOverride ?? this.common(e, inBlock)
    if (!cm) return
    if ((e.type === 'ATTRIB' || e.type === 'ATTDEF') && num(t, S, E, 70) & 1) return
    const st = this.style(str(t, S, E, 7, 'STANDARD'))
    let raw = isAttdef ? str(t, S, E, 2) || str(t, S, E, 1) : str(t, S, E, 1)
    raw = unescapeDxf(raw)
    if (!raw) return
    const { text, underline, overline } = plainText(raw)
    let h = num(t, S, E, 40, st?.height || 2.5)
    if (!(h > 0)) h = st?.height || 2.5
    const rot = num(t, S, E, 50) * D2R
    const wf = num(t, S, E, 41, st?.width || 1) || 1
    const obl = num(t, S, E, 51, st?.oblique ?? 0) * D2R
    const gen = num(t, S, E, 71, st?.flags ?? 0)
    let ha = num(t, S, E, 72)
    let va = e.type === 'ATTRIB' || e.type === 'ATTDEF' ? num(t, S, E, 74) : num(t, S, E, 73)
    const x10 = num(t, S, E, 10)
    const y10 = num(t, S, E, 20)
    const has11 = tag(t, S, E, 11) !== undefined
    const x11 = has11 ? num(t, S, E, 11) : x10
    const y11 = has11 ? num(t, S, E, 21) : y10
    let x = x10
    let y = y10
    let r = rot
    let fitWidth: number | undefined
    if (ha === 3 || ha === 5) {
      // Aligned / fit: the baseline runs from the first to the second point.
      fitWidth = Math.hypot(x11 - x10, y11 - y10)
      r = Math.atan2(y11 - y10, x11 - x10)
      if (!(fitWidth > 0)) {
        fitWidth = undefined
        r = rot
      }
      ha = 0
      va = 0
    } else if (ha === 4) {
      x = x11
      y = y11
      ha = 1
      va = 2
    } else if (ha !== 0 || va !== 0) {
      x = x11
      y = y11
    }
    // OCS and generation flags → world frame.
    const ocs = this.ocs(e, 30)
    let lin: Mat = mul(rotate(r), scale(gen & 2 ? -1 : 1, gen & 4 ? -1 : 1))
    if (ocs) {
      ;[x, y] = apply(ocs, x, y)
      lin = mul([ocs[0], ocs[1], ocs[2], ocs[3], 0, 0], lin)
      if (fitWidth !== undefined) fitWidth *= Math.hypot(ocs[0], ocs[1])
    }
    const item: TextItem = {
      k: 'text',
      layer: cm.layer,
      color: cm.color,
      lw: 0,
      alpha: cm.alpha,
      x,
      y,
      h,
      rot: Math.atan2(lin[1], lin[0]),
      my: lin[0] * lin[3] - lin[1] * lin[2] < 0 || undefined,
      wf,
      obl: obl || undefined,
      family: styleFamily(st),
      text,
      ha: Math.min(2, Math.max(0, ha)) as 0 | 1 | 2,
      va: Math.min(3, Math.max(0, va)) as 0 | 1 | 2 | 3,
      fitWidth,
      underline: underline || undefined,
      overline: overline || undefined
    }
    out.push(item)
  }

  private mtext(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const S = e.s
    const E = e.e
    const cm = this.common(e, inBlock)
    if (!cm) return
    let raw = ''
    let last = ''
    for (let i = S + 1; i < E; i++) {
      if (t.codes[i] === 3) raw += String(t.vals[i])
      else if (t.codes[i] === 1) last = String(t.vals[i])
    }
    raw = unescapeDxf(raw + last)
    if (!raw.trim()) return
    const st = this.style(str(t, S, E, 7, 'STANDARD'))
    const h = num(t, S, E, 40, st?.height || 2.5) || 2.5
    const family = styleFamily(st)
    const paras = parseMText(raw, { h, family })
    let rot = num(t, S, E, 50) * D2R
    if (tag(t, S, E, 11) !== undefined) {
      const dx = num(t, S, E, 11)
      const dy = num(t, S, E, 21)
      if (dx || dy) rot = Math.atan2(dy, dx)
    }
    const bg = num(t, S, E, 90)
    const item: TextItem = {
      k: 'text',
      layer: cm.layer,
      color: cm.color,
      lw: 0,
      alpha: cm.alpha,
      x: num(t, S, E, 10),
      y: num(t, S, E, 20),
      h,
      rot,
      family,
      text: '',
      paras,
      wrap: num(t, S, E, 41),
      attach: num(t, S, E, 71, 1) || 1,
      spacing: num(t, S, E, 44, 1) || 1
    }
    if (bg & 1) {
      const tc = tag(t, S, E, 421)
      const ci = num(t, S, E, 63, 256)
      item.bgFill = bg & 2 ? C.BG : tc !== undefined ? Number(tc) & 0xffffff : ci > 0 && ci < 256 ? aciColor(ci) : C.BG
    } else if (bg & 2) item.bgFill = C.BG
    out.push(item)
  }

  // ---- blocks ------------------------------------------------------------------------------

  private insert(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const S = e.s
    const E = e.e
    const cm = this.common(e, inBlock)
    if (!cm) return
    const name = str(t, S, E, 2)
    const blk = this.doc.blocks.get(name.toUpperCase())
    if (blk) {
      const sx = num(t, S, E, 41, 1) || 1
      const sy = num(t, S, E, 42, 1) || 1
      const rot = num(t, S, E, 50) * D2R
      const cols = Math.max(1, num(t, S, E, 70, 1))
      const rows = Math.max(1, num(t, S, E, 71, 1))
      const cs = num(t, S, E, 44)
      const rs = num(t, S, E, 45)
      const ocs = this.ocs(e, 30)
      const base = mul(scale(sx, sy), translate(-blk.base[0], -blk.base[1]))
      let at: Mat = mul(translate(num(t, S, E, 10), num(t, S, E, 20)), rotate(rot))
      if (ocs) at = mul(ocs, at)
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          if (this.refCount++ > MAX_REFS) {
            bump(this.scene.skipped, 'array references over the limit')
            return
          }
          out.push({ k: 'ref', layer: cm.layer, color: cm.color, lw: cm.lw, block: name.toUpperCase(), m: mul(mul(at, translate(c * cs, r * rs)), base) })
        }
    } else bump(this.scene.skipped, 'missing block')
    for (const a of e.children ?? []) this.text(a, out, inBlock)
  }

  private blockRef(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const cm = this.common(e, inBlock)
    if (!cm) return
    const name = str(t, e.s, e.e, 2).toUpperCase()
    if (name && this.doc.blocks.has(name)) {
      out.push({ k: 'ref', layer: cm.layer, color: cm.color, lw: cm.lw, block: name, m: [1, 0, 0, 1, 0, 0] })
      return
    }
    if (e.type === 'DIMENSION') {
      // No geometry block: at least show the measurement text.
      const txt = str(t, e.s, e.e, 1)
      if (txt && txt !== '<>' && tag(t, e.s, e.e, 11) !== undefined)
        out.push({ k: 'text', layer: cm.layer, color: cm.color, lw: 0, x: num(t, e.s, e.e, 11), y: num(t, e.s, e.e, 21), h: 2.5, rot: 0, text: plainText(txt).text, ha: 1, va: 2 })
      bump(this.scene.skipped, 'DIMENSION without block')
    } else bump(this.scene.skipped, e.type)
  }

  // ---- hatch -------------------------------------------------------------------------------

  private hatch(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const cm = this.common(e, inBlock)
    if (!cm) return
    const S = e.s
    const E = e.e
    let i = S + 1
    const find = (code: number): number => {
      while (i < E && t.codes[i] !== code) i++
      return i < E ? Number(t.vals[i++]) : NaN
    }
    const peek = (code: number): boolean => i < E && t.codes[i] === code
    // Start of the boundary data is the 91 tag.
    while (i < E && t.codes[i] !== 91) i++
    const nPaths = find(91)
    const pb = new PathB(this.ocs(e, 30))
    for (let p = 0; p < nPaths && i < E; p++) {
      const flags = find(92)
      if (flags & 2) {
        // Polyline path.
        let hasBulge = 0
        let closed = 1
        while (i < E && t.codes[i] !== 93) {
          if (t.codes[i] === 72) hasBulge = Number(t.vals[i])
          if (t.codes[i] === 73) closed = Number(t.vals[i])
          i++
        }
        const n = find(93)
        const vs: { x: number; y: number; b: number }[] = []
        for (let k = 0; k < n && i < E; k++) {
          const x = find(10)
          const y = find(20)
          let b = 0
          if (hasBulge && peek(42)) b = Number(t.vals[i++])
          vs.push({ x, y, b })
        }
        if (vs.length) {
          pb.M(vs[0].x, vs[0].y)
          for (let k = 0; k < vs.length; k++) {
            const a = vs[k]
            const b = vs[(k + 1) % vs.length]
            if (k === vs.length - 1 && !closed && !(a.b !== 0)) break
            pb.bulge(a.x, a.y, b.x, b.y, a.b)
          }
          pb.Z()
        }
      } else {
        const nEdges = find(93)
        let started = false
        for (let k = 0; k < nEdges && i < E; k++) {
          const type = find(72)
          if (type === 1) {
            const x0 = find(10)
            const y0 = find(20)
            const x1 = find(11)
            const y1 = find(21)
            if (!started) pb.M(x0, y0)
            else pb.L(x0, y0)
            pb.L(x1, y1)
          } else if (type === 2) {
            const cx = find(10)
            const cy = find(20)
            const r = find(40)
            const s = find(50) * D2R
            const en = find(51) * D2R
            const ccw = find(73)
            if (ccw) {
              let a1 = en
              if (a1 <= s) a1 += Math.PI * 2
              pb.E(cx, cy, r, r, 0, s, a1, true)
            } else {
              let a1 = -en
              if (a1 >= -s) a1 -= Math.PI * 2
              pb.E(cx, cy, r, r, 0, -s, a1, false)
            }
          } else if (type === 3) {
            const cx = find(10)
            const cy = find(20)
            const mx = find(11)
            const my = find(21)
            const ratio = find(40)
            const s = find(50) * D2R
            const en = find(51) * D2R
            const ccw = find(73)
            const rx = Math.hypot(mx, my)
            const rot = Math.atan2(my, mx)
            if (ccw) {
              let a1 = en
              if (a1 <= s) a1 += Math.PI * 2
              pb.E(cx, cy, rx, rx * ratio, rot, s, a1, true)
            } else {
              let a1 = -en
              if (a1 >= -s) a1 -= Math.PI * 2
              pb.E(cx, cy, rx, rx * ratio, rot, -s, a1, false)
            }
          } else if (type === 4) {
            const deg = find(94)
            let rational = 0
            while (i < E && t.codes[i] !== 95) {
              if (t.codes[i] === 73) rational = Number(t.vals[i])
              i++
            }
            const nk = find(95)
            const nc = find(96)
            const knots: number[] = []
            for (let q = 0; q < nk; q++) knots.push(find(40))
            const ctrl: [number, number][] = []
            const w: number[] = []
            for (let q = 0; q < nc; q++) {
              ctrl.push([find(10), find(20)])
              if (rational && peek(42)) w.push(Number(t.vals[i++]))
            }
            const fit: [number, number][] = []
            if (peek(97)) {
              const nf = Number(t.vals[i++])
              for (let q = 0; q < nf; q++) fit.push([find(11), find(21)])
            }
            const pts = ctrl.length > deg ? nurbs(deg, knots, ctrl, w) : fit.length > 1 ? catmull(fit) : ctrl
            for (let q = 0; q < pts.length; q++) {
              if (!started && q === 0) pb.M(pts[0][0], pts[0][1])
              else pb.L(pts[q][0], pts[q][1])
            }
          }
          started = true
        }
        pb.Z()
      }
      // Source boundary objects.
      if (peek(97)) {
        const ns = Number(t.vals[i++])
        for (let k = 0; k < ns && peek(330); k++) i++
      }
    }
    if (!pb.d.length) return
    const solid = num(t, S, E, 70) === 1 || num(t, S, E, 450) !== 0
    let color = cm.color
    if (num(t, S, E, 450) !== 0) {
      // Gradient: use the first gradient colour as a flat fill.
      for (let k = S; k < E; k++)
        if (t.codes[k] === 421) {
          color = Number(t.vals[k]) & 0xffffff
          break
        }
    }
    const item: HatchItem = { k: 'hatch', layer: cm.layer, color, lw: 0, alpha: cm.alpha, boundary: pb.d, solid }
    if (!solid) {
      const lines = this.patternLines(e, i, pb.d)
      if (lines === 'too-dense') {
        item.solid = true
        item.alpha = (cm.alpha ?? 1) * 0.35
      } else item.lines = lines
    }
    out.push(item)
  }

  /** Pattern line segments over the boundary's extents (clipped to the boundary when drawn). */
  private patternLines(e: Ent, from: number, boundaryWcs: number[]): Float64Array | 'too-dense' {
    const t = this.t
    const E = e.e
    let i = from
    while (i < E && t.codes[i] !== 78) i++
    if (i >= E) return new Float64Array(0)
    const n = Number(t.vals[i++])
    const ocs = this.ocs(e, 30)
    const inv = ocs ? invert(ocs) : null
    // Work in OCS: map the WCS boundary box back.
    const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    const pts = arcPointsOf(boundaryWcs)
    for (let k = 0; k < pts.length; k += 2) {
      const [x, y] = inv ? apply(inv, pts[k], pts[k + 1]) : [pts[k], pts[k + 1]]
      bb.x0 = Math.min(bb.x0, x)
      bb.y0 = Math.min(bb.y0, y)
      bb.x1 = Math.max(bb.x1, x)
      bb.y1 = Math.max(bb.y1, y)
    }
    if (!(bb.x1 > bb.x0) && !(bb.y1 > bb.y0)) return new Float64Array(0)
    const segs: number[] = []
    for (let l = 0; l < n && i < E; l++) {
      const read = (code: number) => {
        while (i < E && t.codes[i] !== code) i++
        return i < E ? Number(t.vals[i++]) : 0
      }
      const ang = read(53) * D2R
      const bx = read(43)
      const by = read(44)
      const ox = read(45)
      const oy = read(46)
      const nd = read(79)
      const dashes: number[] = []
      for (let k = 0; k < nd; k++) dashes.push(read(49))
      const ux = Math.cos(ang)
      const uy = Math.sin(ang)
      const nx = -uy
      const ny = ux
      const spacing = ox * nx + oy * ny
      if (!(Math.abs(spacing) > 1e-9)) continue
      // Range of line indices covering the box.
      const corners = [
        [bb.x0, bb.y0],
        [bb.x1, bb.y0],
        [bb.x0, bb.y1],
        [bb.x1, bb.y1]
      ]
      let kmin = Infinity
      let kmax = -Infinity
      let smin = Infinity
      let smax = -Infinity
      for (const [cx, cy] of corners) {
        const kk = ((cx - bx) * nx + (cy - by) * ny) / spacing
        kmin = Math.min(kmin, kk)
        kmax = Math.max(kmax, kk)
      }
      const k0 = Math.floor(kmin)
      const k1 = Math.ceil(kmax)
      if (k1 - k0 > MAX_HATCH_SEGMENTS) return 'too-dense'
      const patLen = dashes.reduce((a, d) => a + Math.abs(d), 0)
      for (let k = k0; k <= k1; k++) {
        const px = bx + k * ox
        const py = by + k * oy
        smin = Infinity
        smax = -Infinity
        for (const [cx, cy] of corners) {
          const s = (cx - px) * ux + (cy - py) * uy
          smin = Math.min(smin, s)
          smax = Math.max(smax, s)
        }
        if (!dashes.length || !(patLen > 0)) {
          segs.push(px + ux * smin, py + uy * smin, px + ux * smax, py + uy * smax)
        } else {
          let s = Math.floor(smin / patLen) * patLen
          if ((smax - s) / patLen * dashes.length > MAX_HATCH_SEGMENTS * 4) return 'too-dense'
          while (s < smax) {
            for (const d of dashes) {
              const len = Math.abs(d)
              if (d >= 0 && s + len >= smin) {
                const a = s
                const b = d === 0 ? s + patLen * 0.002 : s + len
                segs.push(px + ux * a, py + uy * a, px + ux * b, py + uy * b)
              }
              s += len
              if (s >= smax) break
            }
          }
        }
        if (segs.length / 4 > MAX_HATCH_SEGMENTS) return 'too-dense'
      }
    }
    if (ocs) for (let k = 0; k < segs.length; k += 2) [segs[k], segs[k + 1]] = apply(ocs, segs[k], segs[k + 1])
    return Float64Array.from(segs)
  }

  // ---- other -------------------------------------------------------------------------------

  private leader(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const cm = this.common(e, inBlock)
    if (!cm) return
    const v: [number, number][] = []
    for (let i = e.s + 1; i < e.e; i++) {
      if (t.codes[i] === 10) v.push([Number(t.vals[i]), 0])
      else if (t.codes[i] === 20 && v.length) v[v.length - 1][1] = Number(t.vals[i])
    }
    if (v.length < 2) return
    const p = new PathB()
    p.M(v[0][0], v[0][1])
    for (let i = 1; i < v.length; i++) p.L(v[i][0], v[i][1])
    out.push(this.path(cm, p.d))
    if (num(t, e.s, e.e, 71, 1)) this.arrow(cm, v[0], v[1], this.asz, out)
  }

  private arrow(cm: Common, tip: [number, number], from: [number, number], size: number, out: Item[]): void {
    const dx = from[0] - tip[0]
    const dy = from[1] - tip[1]
    const l = Math.hypot(dx, dy)
    if (!(l > 0) || !(size > 0)) return
    const ux = dx / l
    const uy = dy / l
    const w = size / 6
    const p = new PathB()
      .M(tip[0], tip[1])
      .L(tip[0] + ux * size - uy * w, tip[1] + uy * size + ux * w)
      .L(tip[0] + ux * size + uy * w, tip[1] + uy * size - ux * w)
      .Z()
    out.push(this.path(cm, p.d, { fill: true, dash: undefined }))
  }

  private mleader(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const cm = this.common(e, inBlock)
    if (!cm) return
    let depth = 0
    let inLine = false
    let lines: [number, number][][] = []
    let cur: [number, number][] = []
    let lastPt: [number, number] | null = null
    let dogDir: [number, number] = [1, 0]
    let dogLen = 0
    let text = ''
    let tx = 0
    let ty = 0
    let th = 2.5
    let asz = this.asz
    let pending: 'line' | 'last' | 'text' | 'dog' | null = null
    const leaders: { last: [number, number] | null; lines: [number, number][][]; dir: [number, number]; len: number }[] = []
    for (let i = e.s + 1; i < e.e; i++) {
      const c = t.codes[i]
      const v = t.vals[i]
      if (c === 300) depth = 1
      else if (c === 302 && String(v).startsWith('LEADER{')) {
        depth = 2
        lines = []
        lastPt = null
        dogLen = 0
      } else if (c === 304 && String(v).startsWith('LEADER_LINE{')) {
        inLine = true
        cur = []
      } else if (c === 305 && inLine) {
        inLine = false
        lines.push(cur)
      } else if (c === 303 && depth === 2) {
        leaders.push({ last: lastPt, lines, dir: dogDir, len: dogLen })
        depth = 1
      } else if (c === 304 && depth >= 1 && !inLine) text = String(v)
      else if (c === 10) {
        pending = inLine ? 'line' : depth === 2 ? 'last' : null
        if (pending === 'line') cur.push([Number(v), 0])
        else if (pending === 'last') lastPt = [Number(v), 0]
      } else if (c === 20) {
        if (pending === 'line' && cur.length) cur[cur.length - 1][1] = Number(v)
        else if (pending === 'last' && lastPt) lastPt[1] = Number(v)
        pending = null
      } else if (c === 11 && depth === 2 && !inLine) {
        dogDir = [Number(v), dogDir[1]]
        pending = 'dog'
      } else if (c === 21 && pending === 'dog') {
        dogDir = [dogDir[0], Number(v)]
        pending = null
      } else if (c === 40 && depth === 2 && !inLine) dogLen = Number(v)
      else if (c === 12 && depth === 1) {
        tx = Number(v)
        pending = 'text'
      } else if (c === 22 && pending === 'text') {
        ty = Number(v)
        pending = null
      } else if (c === 41 && depth === 1) th = Number(v) || th
      else if (c === 140 && depth === 1) asz = Number(v) || asz
      else if (c === 301) depth = 0
    }
    for (const L of leaders) {
      for (const ln of L.lines) {
        const pts = L.last ? [...ln, L.last] : ln
        if (pts.length < 2) continue
        const p = new PathB().M(pts[0][0], pts[0][1])
        for (let i = 1; i < pts.length; i++) p.L(pts[i][0], pts[i][1])
        out.push(this.path(cm, p.d))
        this.arrow(cm, pts[0], pts[1], asz, out)
      }
      if (L.last && L.len > 0) {
        const p = new PathB().M(L.last[0], L.last[1]).L(L.last[0] + L.dir[0] * L.len, L.last[1] + L.dir[1] * L.len)
        out.push(this.path(cm, p.d))
      }
    }
    if (text) {
      const raw = unescapeDxf(text)
      out.push({ k: 'text', layer: cm.layer, color: cm.color, lw: 0, x: tx, y: ty, h: th, rot: 0, text: '', paras: parseMText(raw, { h: th }), attach: 1 })
    }
  }

  private image(e: Ent, out: Item[], inBlock: boolean): void {
    const t = this.t
    const cm = this.common(e, inBlock)
    if (!cm) return
    const S = e.s
    const E = e.e
    const ix = num(t, S, E, 10)
    const iy = num(t, S, E, 20)
    const ux = num(t, S, E, 11)
    const uy = num(t, S, E, 21)
    const vx = num(t, S, E, 12)
    const vy = num(t, S, E, 22)
    const W = num(t, S, E, 13, 1)
    const H = num(t, S, E, 23, 1)
    const clip: [number, number][] = []
    for (let i = S + 1; i < E; i++) {
      if (t.codes[i] === 14) clip.push([Number(t.vals[i]), 0])
      else if (t.codes[i] === 24 && clip.length) clip[clip.length - 1][1] = Number(t.vals[i])
    }
    if (clip.length === 2) {
      const [a, b] = clip
      clip.splice(0, 2, a, [b[0], a[1]], b, [a[0], b[1]])
    }
    if (e.type === 'WIPEOUT') {
      if (clip.length < 3) return
      const ox = ix + ux * 0.5 - vx * 0.5
      const oy = iy + uy * 0.5 - vy * 0.5
      const p = new PathB()
      clip.forEach(([px, py], k) => {
        const x = ox + ux * px + vx * (H - py)
        const y = oy + uy * px + vy * (H - py)
        if (k === 0) p.M(x, y)
        else p.L(x, y)
      })
      p.Z()
      out.push(this.path(cm, p.d, { fill: true, fillColor: C.BG, stroke: false }))
      return
    }
    bump(this.scene.skipped, 'external image (frame only)')
    out.push({ k: 'image', layer: cm.layer, color: cm.color, lw: 0, src: null, m: [ux * W, uy * W, vx * H, vy * H, ix, iy] })
  }

  private viewport(e: Ent, out: Item[]): void {
    const t = this.t
    const S = e.s
    const E = e.e
    if (num(t, S, E, 69) === 1) return // the paper-space "viewport" itself
    if (num(t, S, E, 68, 1) === 0) return // off
    const vh = num(t, S, E, 45)
    const h = num(t, S, E, 41)
    if (!(vh > 0) || !(h > 0)) return
    const cm = this.common(e, false)
    if (!cm) return
    const cx = num(t, S, E, 10)
    const cy = num(t, S, E, 20)
    const w = num(t, S, E, 40)
    const s = h / vh
    const twist = num(t, S, E, 51) * D2R
    const vcx = num(t, S, E, 12) + num(t, S, E, 17)
    const vcy = num(t, S, E, 22) + num(t, S, E, 27)
    const m = mul(mul(translate(cx, cy), mul(scale(s), rotate(-twist))), translate(-vcx, -vcy))
    const frozen: number[] = []
    for (let i = S + 1; i < E; i++)
      if (t.codes[i] === 331) {
        const l = this.layerByHandle.get(String(t.vals[i]).toUpperCase())
        if (l !== undefined) frozen.push(l)
      }
    out.push({ k: 'viewport', layer: cm.layer, color: cm.color, lw: 0, cx, cy, w, h, view: 0, m, frozen: frozen.length ? frozen : undefined })
  }

  private fixRays(view: SceneView): void {
    if (!this.rays.length) return
    const b = itemsBox(this.scene, view.items)
    const diag = isEmpty(b) ? 1000 : Math.hypot(b.x1 - b.x0, b.y1 - b.y0) * 4 + 1
    for (const r of this.rays) {
      const l = Math.hypot(r.dx, r.dy) || 1
      const ux = r.dx / l
      const uy = r.dy / l
      const x0 = r.ray ? r.x : r.x - ux * diag
      const y0 = r.ray ? r.y : r.y - uy * diag
      r.item.d = [P.M, x0, y0, P.L, r.x + ux * diag, r.y + uy * diag]
    }
  }
}

/** Points along a path (arcs sampled) for extents. */
function arcPointsOf(d: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < d.length; ) {
    const op = d[i]
    if (op === P.M || op === P.L) {
      out.push(d[i + 1], d[i + 2])
      i += 3
    } else if (op === P.E) {
      out.push(...arcPoints(d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5], d[i + 6], d[i + 7], d[i + 8] === 1, 12))
      i += 9
    } else if (op === P.C) i += 7
    else if (op === P.Q) i += 5
    else i += 1
  }
  return out
}

/** Evaluates a (rational) B-spline at enough parameters for a smooth polyline. */
export function nurbs(deg: number, knots: number[], ctrl: [number, number][], weights: number[]): [number, number][] {
  const n = ctrl.length
  if (knots.length !== n + deg + 1) {
    // Uniform clamped knots as a fallback.
    knots = []
    for (let i = 0; i <= n + deg; i++) knots.push(i <= deg ? 0 : i >= n ? n - deg : i - deg)
  }
  const w = weights.length === n ? weights : ctrl.map(() => 1)
  const t0 = knots[deg]
  const t1 = knots[n]
  if (!(t1 > t0)) return ctrl
  const samples = Math.min(4000, Math.max(24, n * 12))
  const out: [number, number][] = []
  for (let s = 0; s <= samples; s++) {
    const u = s === samples ? t1 - 1e-12 * (t1 - t0) : t0 + ((t1 - t0) * s) / samples
    let k = deg
    while (k < n - 1 && !(u >= knots[k] && u < knots[k + 1])) k++
    const dx: number[] = []
    const dy: number[] = []
    const dw: number[] = []
    for (let j = 0; j <= deg; j++) {
      const idx = k - deg + j
      const ww = w[idx] ?? 1
      dx.push(ctrl[idx][0] * ww)
      dy.push(ctrl[idx][1] * ww)
      dw.push(ww)
    }
    for (let r = 1; r <= deg; r++)
      for (let j = deg; j >= r; j--) {
        const i = k - deg + j
        const den = knots[i + deg - r + 1] - knots[i]
        const a = den ? (u - knots[i]) / den : 0
        dx[j] = (1 - a) * dx[j - 1] + a * dx[j]
        dy[j] = (1 - a) * dy[j - 1] + a * dy[j]
        dw[j] = (1 - a) * dw[j - 1] + a * dw[j]
      }
    out.push([dx[deg] / dw[deg], dy[deg] / dw[deg]])
  }
  return out
}

/** Smooth curve through fit points (centripetal-free Catmull-Rom). */
export function catmull(p: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  const n = p.length
  for (let i = 0; i < n - 1; i++) {
    const a = p[Math.max(0, i - 1)]
    const b = p[i]
    const c = p[i + 1]
    const d = p[Math.min(n - 1, i + 2)]
    for (let s = 0; s < 12; s++) {
      const t = s / 12
      const t2 = t * t
      const t3 = t2 * t
      const f = (q: number, r: number, u: number, v: number) => 0.5 * (2 * r + (-q + u) * t + (2 * q - 5 * r + 4 * u - v) * t2 + (-q + 3 * r - 3 * u + v) * t3)
      out.push([f(a[0], b[0], c[0], d[0]), f(a[1], b[1], c[1], d[1])])
    }
  }
  out.push(p[n - 1])
  return out
}
