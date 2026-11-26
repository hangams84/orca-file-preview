/** Format-neutral 2D drawing scene shared by the DXF, DWF and DWFx readers (and reusable by other
 *  CAD readers such as a DWG plugin): layers, named blocks, and views (model space, paper-space
 *  layouts, sheets) holding flat lists of drawable items in world coordinates (y up).
 *
 *  A reader builds a `Scene`; `paint.ts` draws any view of it on a 2D canvas, and `viewer.ts` adds
 *  pan/zoom, the layer list, the view selector and the info bar. Nothing here touches the DOM, so a
 *  scene can be built and inspected in tests or a worker.
 *
 *  Path data is a flat number array of commands (see `P`), so it is cheap to build and to turn into
 *  a `Path2D`. Colours are 0xRRGGBB numbers or one of the special values in `C`. */

/** Path commands inside `PathItem.d`: the opcode then its operands. */
export const P = {
  /** move x y */
  M: 0,
  /** line x y */
  L: 1,
  /** cubic bezier x1 y1 x2 y2 x y */
  C: 2,
  /** quadratic bezier x1 y1 x y */
  Q: 3,
  /** elliptical arc cx cy rx ry rotation a0 a1 ccw(1)/cw(0); a circle arc has rx = ry, rotation 0.
   *  Angles are radians in the item's own coordinates; ccw means increasing angle. Starts a line
   *  from the current point when there is one, like `CanvasPath.ellipse`. */
  E: 4,
  /** close subpath */
  Z: 5
} as const

/** Special colour values. */
export const C = {
  /** Foreground: white on a dark background, black on a light one (AutoCAD colour 7). */
  FG: -1,
  /** Inherit the colour of the enclosing block reference. */
  BYBLOCK: -2,
  /** Inherit the colour of the layer of the enclosing block reference (entities on layer 0). */
  BYLAYER_INHERIT: -3,
  /** The background colour (wipeouts). */
  BG: -4
} as const

/** Affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (canvas order). */
export type Mat = [number, number, number, number, number, number]

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface SceneLayer {
  name: string
  /** 0xRRGGBB or C.FG. */
  color: number
  /** Shown at start (on and thawed). The viewer lets the user toggle it. */
  visible: boolean
  /** Number of items placed on this layer (for the layer list). */
  count: number
}

interface ItemBase {
  /** Index into `Scene.layers`; -1 = inherit the enclosing reference's layer (layer 0 in blocks). */
  layer: number
  /** 0xRRGGBB or one of `C`. */
  color: number
  /** Display line weight in millimetres (zoom independent); 0 = thinnest. Negative = BYBLOCK. */
  lw: number
  /** Opacity 0..1 (default 1). */
  alpha?: number
  /** Not counted in the extents (construction lines, rays). */
  noExtents?: boolean
}

export interface PathItem extends ItemBase {
  k: 'path'
  d: number[]
  stroke: boolean
  fill: boolean
  /** Fill colour when it differs from the stroke colour. */
  fillColor?: number
  evenOdd?: boolean
  /** Stroke width in world units (wide polylines, DWF weights, XPS thickness); added to `lw`. */
  width?: number
  /** Dash pattern in world units (dash, gap, dash, ...); dots are 0-length dashes. */
  dash?: number[]
  cap?: CanvasLineCap
  join?: CanvasLineJoin
}

/** A hatch: the boundary is a clip, then a solid fill and/or pattern line segments are drawn. */
export interface HatchItem extends ItemBase {
  k: 'hatch'
  boundary: number[]
  solid: boolean
  /** Pattern line segments x0 y0 x1 y1 ... in world units, clipped by the boundary at draw time. */
  lines?: Float64Array
}

export interface TextRun {
  text: string
  /** Cap height in item units (MTEXT \H); default = item height. */
  h?: number
  family?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  overline?: boolean
  strike?: boolean
  color?: number
  /** Width factor (MTEXT \W). */
  wf?: number
}

export interface TextItem extends ItemBase {
  k: 'text'
  x: number
  y: number
  /** Cap height (CAD) or em size (when `emScale` = 1) in world units. */
  h: number
  /** Font em size = h × emScale. CAD text heights are cap heights (default 1/0.7). */
  emScale?: number
  /** Rotation in radians (counter-clockwise). */
  rot: number
  /** Width factor (x stretch). */
  wf?: number
  /** Oblique angle in radians. */
  obl?: number
  /** Mirrored in x / y (DXF text generation flags). */
  mx?: boolean
  my?: boolean
  family?: string
  bold?: boolean
  italic?: boolean
  /** Single line content; for MTEXT see `paras`. */
  text: string
  /** Horizontal alignment: 0 left, 1 centre, 2 right. */
  ha?: 0 | 1 | 2
  /** Vertical: 0 baseline, 1 bottom, 2 middle, 3 top. */
  va?: 0 | 1 | 2 | 3
  /** Stretch to this width in world units (DXF "fit"/"aligned"); overrides `wf`. */
  fitWidth?: number
  underline?: boolean
  overline?: boolean
  /** Glyph x positions in em units from the origin (XPS Indices advances), one per character. */
  advances?: number[]
  /** Multi-line text (MTEXT): paragraphs of runs, wrapped at `wrap` (world units, 0 = none). */
  paras?: TextRun[][]
  wrap?: number
  /** MTEXT attachment 1..9 (top-left .. bottom-right). */
  attach?: number
  /** Line spacing factor (MTEXT 44). */
  spacing?: number
  /** Background fill colour behind MTEXT (C.BG for the drawing background). */
  bgFill?: number
}

/** Reference to a named block: drawn with `m` (block space → parent space). */
export interface RefItem extends ItemBase {
  k: 'ref'
  block: string
  m: Mat
}

export interface ImageItem extends ItemBase {
  k: 'image'
  /** A decoded image, or null when the picture is external / could not be decoded (a frame is drawn). */
  src: CanvasImageSource | null
  /** Maps the unit square (0,0)-(1,1) (image bottom-left .. top-right) into world units. */
  m: Mat
  /** Pixel size of the source, for the info bar. */
  pw?: number
  ph?: number
  label?: string
}

export interface PointItem extends ItemBase {
  k: 'point'
  x: number
  y: number
}

/** Paper-space viewport: shows another view (model space) through a window. */
export interface ViewportItem extends ItemBase {
  k: 'viewport'
  /** Window in this view's units. */
  cx: number
  cy: number
  w: number
  h: number
  /** Index of the view shown. */
  view: number
  /** Maps the source view's coordinates into this view. */
  m: Mat
  /** Layers frozen in this viewport. */
  frozen?: number[]
  /** Optional non-rectangular clip in this view's units. */
  clip?: number[]
}

export type Item = PathItem | HatchItem | TextItem | RefItem | ImageItem | PointItem | ViewportItem

export interface SceneBlock {
  name: string
  items: Item[]
  /** Cached extents in block coordinates (computed lazily). */
  box?: Box | null
}

export interface SceneView {
  name: string
  kind: 'model' | 'layout' | 'sheet'
  items: Item[]
  /** Paper sheet outline in view units (layouts, DWF sheets). */
  paper?: Box
  /** Preferred background (DWF/DWFx sheets are paper: light). */
  background?: 'light' | 'dark'
  /** Pre-computed extents; computed lazily otherwise. */
  box?: Box | null
  /** A note shown above the drawing (e.g. "thumbnail only"). */
  notice?: string
  /** Extra info-bar text for this view. */
  info?: string[]
}

export interface Scene {
  /** e.g. "DXF", "DWF", "DWFx". */
  format: string
  /** e.g. "AutoCAD 2018 (AC1032)". */
  version?: string
  /** Drawing units, e.g. "mm". */
  units?: string
  layers: SceneLayer[]
  blocks: Map<string, SceneBlock>
  views: SceneView[]
  /** Entity counts by type for the info bar. */
  counts: Map<string, number>
  /** Things the reader skipped (unsupported entity types, external images). */
  skipped: Map<string, number>
  /** Free-form facts for the info bar. */
  info: string[]
}

export function emptyScene(format: string): Scene {
  return { format, layers: [], blocks: new Map(), views: [], counts: new Map(), skipped: new Map(), info: [] }
}

export function bump(map: Map<string, number>, key: string, n = 1): void {
  map.set(key, (map.get(key) ?? 0) + n)
}

// ---- matrices ---------------------------------------------------------------------------------

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** a × b: apply b first, then a. */
export function mul(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ]
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y]
}

export function rotate(r: number): Mat {
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c, s, -s, c, 0, 0]
}

export function scale(x: number, y = x): Mat {
  return [x, 0, 0, y, 0, 0]
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det || !Number.isFinite(det)) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

// ---- extents ----------------------------------------------------------------------------------

export function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
}

export function isEmpty(b: Box | null | undefined): boolean {
  return !b || !(b.x1 >= b.x0) || !(b.y1 >= b.y0)
}

export function addPoint(b: Box, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  if (x < b.x0) b.x0 = x
  if (x > b.x1) b.x1 = x
  if (y < b.y0) b.y0 = y
  if (y > b.y1) b.y1 = y
}

export function addBox(b: Box, o: Box | null | undefined, m?: Mat): void {
  if (isEmpty(o)) return
  if (!m) {
    addPoint(b, o!.x0, o!.y0)
    addPoint(b, o!.x1, o!.y1)
    return
  }
  for (const [x, y] of [
    [o!.x0, o!.y0],
    [o!.x1, o!.y0],
    [o!.x0, o!.y1],
    [o!.x1, o!.y1]
  ])
    addPoint(b, ...apply(m, x, y))
}

/** Points on an elliptical arc (for extents and flattening). */
export function arcPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
  a0: number,
  a1: number,
  ccw: boolean,
  n?: number
): number[] {
  let sweep = ccw ? a1 - a0 : a0 - a1
  const TAU = Math.PI * 2
  if (sweep < 0 || sweep > TAU) sweep = ((sweep % TAU) + TAU) % TAU
  if (sweep === 0 && a0 !== a1) sweep = TAU
  const steps = n ?? Math.max(4, Math.ceil((sweep / TAU) * 64))
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  const out: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = a0 + (ccw ? 1 : -1) * (sweep * i) / steps
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    out.push(cx + ex * cr - ey * sr, cy + ex * sr + ey * cr)
  }
  return out
}

export function pathBox(d: number[], b: Box = emptyBox(), m?: Mat): Box {
  const add = m ? (x: number, y: number) => addPoint(b, ...apply(m, x, y)) : (x: number, y: number) => addPoint(b, x, y)
  for (let i = 0; i < d.length; ) {
    switch (d[i]) {
      case P.M:
      case P.L:
        add(d[i + 1], d[i + 2])
        i += 3
        break
      case P.C:
        add(d[i + 1], d[i + 2])
        add(d[i + 3], d[i + 4])
        add(d[i + 5], d[i + 6])
        i += 7
        break
      case P.Q:
        add(d[i + 1], d[i + 2])
        add(d[i + 3], d[i + 4])
        i += 5
        break
      case P.E: {
        const pts = arcPoints(d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5], d[i + 6], d[i + 7], d[i + 8] === 1, 16)
        for (let j = 0; j < pts.length; j += 2) add(pts[j], pts[j + 1])
        i += 9
        break
      }
      case P.Z:
        i += 1
        break
      default:
        return b // malformed: stop
    }
  }
  return b
}

/** Rough extents of a text item (for culling and fit): its baseline box grown by its height. */
export function textBox(t: TextItem, b: Box = emptyBox(), m?: Mat): Box {
  const em = t.h * (t.emScale ?? 1 / 0.7)
  let len = 0
  if (t.paras) {
    let lines = 0
    for (const p of t.paras) {
      lines++
      let n = 0
      for (const r of p) n += r.text.length
      len = Math.max(len, n)
    }
    const w = t.wrap && t.wrap > 0 ? Math.min(t.wrap, len * em * 0.9) || t.wrap : len * em * 0.9
    const hh = Math.max(1, lines) * t.h * 1.7 * (t.spacing ?? 1)
    const a = t.attach ?? 1
    const col = (a - 1) % 3
    const row = Math.floor((a - 1) / 3)
    const x0 = -w * (col / 2)
    const y1 = row === 0 ? 0 : row === 1 ? hh / 2 : hh
    corners(t, [x0, x0 + w], [y1 - hh, y1], b, m)
    return b
  }
  len = t.text.length
  const w = t.fitWidth ?? len * em * 0.9 * (t.wf ?? 1)
  const ha = t.ha ?? 0
  const x0 = ha === 1 ? -w / 2 : ha === 2 ? -w : 0
  corners(t, [x0, x0 + w], [-em * 0.3, em], b, m)
  return b
}

function corners(t: TextItem, xs: number[], ys: number[], b: Box, m?: Mat): void {
  const c = Math.cos(t.rot)
  const s = Math.sin(t.rot)
  for (const x of xs)
    for (const y of ys) {
      const wx = t.x + x * c - y * s
      const wy = t.y + x * s + y * c
      if (m) addPoint(b, ...apply(m, wx, wy))
      else addPoint(b, wx, wy)
    }
}

/** Extents of a list of items, resolving block references (with a depth guard). */
export function itemsBox(scene: Scene, items: Item[], depth = 0): Box {
  const b = emptyBox()
  for (const it of items) {
    if (it.noExtents) continue
    itemBox(scene, it, b, undefined, depth)
  }
  return b
}

export function itemBox(scene: Scene, it: Item, b: Box, m: Mat | undefined, depth: number): void {
  switch (it.k) {
    case 'path':
      pathBox(it.d, b, m)
      break
    case 'hatch':
      pathBox(it.boundary, b, m)
      break
    case 'text':
      textBox(it, b, m)
      break
    case 'point':
      if (m) addPoint(b, ...apply(m, it.x, it.y))
      else addPoint(b, it.x, it.y)
      break
    case 'image': {
      const mm = m ? mul(m, it.m) : it.m
      addBox(b, { x0: 0, y0: 0, x1: 1, y1: 1 }, mm)
      break
    }
    case 'viewport':
      addBox(b, { x0: it.cx - it.w / 2, y0: it.cy - it.h / 2, x1: it.cx + it.w / 2, y1: it.cy + it.h / 2 }, m)
      break
    case 'ref': {
      if (depth > 32) return
      const blk = scene.blocks.get(it.block)
      if (!blk) return
      if (blk.box === undefined) blk.box = itemsBox(scene, blk.items, depth + 1)
      addBox(b, blk.box, m ? mul(m, it.m) : it.m)
      break
    }
  }
}

export function viewBox(scene: Scene, v: SceneView): Box {
  if (v.box === undefined || v.box === null) {
    const b = itemsBox(scene, v.items)
    if (v.paper) addBox(b, v.paper)
    v.box = b
  }
  return v.box
}

/** Joins stroke-only paths of identical style into shared paths (far fewer draw calls). Strokes
 *  can move past other strokes, text and references, which never hide anything; a fill, hatch,
 *  image or wipeout closes all open groups so the draw order around opaque items is kept. Groups
 *  stay small enough for culling to help when zoomed in. */
export function mergePaths(items: Item[]): Item[] {
  const out: Item[] = []
  const open = new Map<string, PathItem>()
  const dashIds = new Map<number[], number>()
  const dashId = (d: number[] | undefined) => {
    if (!d) return 0
    let v = dashIds.get(d)
    if (v === undefined) dashIds.set(d, (v = dashIds.size + 1))
    return v
  }
  for (const it of items) {
    if (it.k === 'path' && !it.fill && it.stroke && !it.noExtents) {
      const key = `${it.layer}|${it.color}|${it.lw}|${dashId(it.dash)}|${it.width ?? ''}|${it.alpha ?? ''}|${it.cap ?? ''}|${it.join ?? ''}`
      const g = open.get(key)
      if (g && g.d.length + it.d.length < 20000) {
        for (const v of it.d) g.d.push(v)
        continue
      }
      const copy: PathItem = { ...it, d: it.d.slice() }
      open.set(key, copy)
      out.push(copy)
      continue
    }
    if (it.k === 'path' || it.k === 'hatch' || it.k === 'image' || it.k === 'viewport') open.clear()
    out.push(it)
  }
  return out
}
