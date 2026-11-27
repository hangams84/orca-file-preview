/** SolidWorks assemblies: where each component sits.
 *
 *  Evidence (docs/evidence/companions-eng/README.md): `swXmlContents/COMPINSTANCETREE` (an XML stream in both
 *  the 2015+ container and the old OLE files, zlib-framed there) lists every configuration's model and, under it,
 *  one `swReference` per component instance with `swTransform` — 16 numbers, a 4×4 matrix stored column by
 *  column (the first three groups of four are the images of the x, y, z axes, the fourth the translation in
 *  metres) — plus `swSuppressed`, `swHidden`, the referenced model (`swModelRef` → `swModel` → `swFileRef` →
 *  `swFile swPath`). A sub-assembly's model carries its own `swReference`s, placed relative to it. Checked on 5
 *  public assemblies: the stored top-level bounding box equals the union of the transformed part boxes.
 *
 *  `FaceTessellations/Directory` names each component instance (`slider-1@jaw`, nested
 *  `caster-1@tether/wheel-1@caster`) with the hash of the tessellation block it was drawn with; copies point at
 *  the first instance's block by hash. Blocks in `FaceTessellations/<stream>` start with `[u32][8-byte hash]`
 *  and hold the same face records as a part's DisplayLists, in the part's own coordinates. */
import { parseXml, walkXml, type XmlEl } from './eplan.ts'
import { readDisplayMesh, type SwContainer, type SwMesh } from './sw.ts'

/** Column-major 4×4 as stored (metres). */
export type Mat4 = number[]

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

export function mulMat(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

export function applyMat(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]]
}

export interface SwComponent {
  /** Component name (`slider`), instance number (`2`) and the Directory-style segment `slider-2@jaw`. */
  name: string
  number: string
  segment: string
  /** Full instance path from the top: `caster-1@tether/wheel-1@caster`. */
  path: string
  /** Referenced file as saved (`C:\…\slider.SLDPRT`) and its type. */
  file: string
  docType: string
  config: string
  local: Mat4
  /** Placement in the top assembly (metres). */
  world: Mat4
  suppressed: boolean
  hidden: boolean
  virtual: boolean
  depth: number
  children: SwComponent[]
  /** Model bounding box in its own coordinates (metres), when stored. */
  box?: number[]
}

export interface SwAssemblyTree {
  configs: { name: string; active: boolean }[]
  config: string
  components: SwComponent[]
}

const parseNums = (s: string | undefined): number[] => (s ?? '').trim().split(/\s+/).filter(Boolean).map(Number)

/** Reads COMPINSTANCETREE for one configuration (default: the most recent one). Null when there is none. */
export function readCompTree(xml: string, configName?: string): SwAssemblyTree | null {
  let root: XmlEl
  try {
    root = parseXml(xml)
  } catch {
    return null
  }
  const files = new Map<string, XmlEl>()
  const models = new Map<string, XmlEl>()
  const configs: XmlEl[] = []
  for (const el of walkXml(root)) {
    const n = el.name.replace(/^.*:/, '')
    if (n === 'swFile') files.set(el.attrs.id, el)
    else if (n === 'swModel') models.set(el.attrs.id, el)
    else if (n === 'swConfiguration') configs.push(el)
  }
  if (!configs.length || !models.size) return null
  const cfg = configs.find((c) => c.attrs.swName === configName) ?? configs.find((c) => c.attrs.swMostRecentConfiguration === 'YES') ?? configs[0]
  const top = models.get(cfg.attrs.swModelRef)
  if (!top) return null
  // Hidden by the configuration's display state: swCompNameList (component swIDs) ↔ swShowState.
  const hiddenIds = new Set<string>()
  const ds = cfg.children.find((c) => c.name.endsWith('swDisplayStateList'))
  const state = ds?.children.find((c) => c.name.endsWith('swDisplayState'))
  if (ds && state) {
    const ids = (ds.attrs.swCompNameList ?? '').split(',')
    const show = (state.attrs.swShowState ?? '').split(',')
    ids.forEach((id, i) => {
      if (id && /^no$/i.test(show[i] ?? '')) hiddenIds.add(id)
    })
  }
  let count = 0
  const build = (model: XmlEl, parent: Mat4, parentPath: string, depth: number, seen: Set<string>): SwComponent[] => {
    const out: SwComponent[] = []
    if (depth > 16) return out
    for (const ref of model.children) {
      if (!ref.name.endsWith('swReference') || ++count > 20000) continue
      const sub = models.get(ref.attrs.swModelRef)
      const file = sub ? files.get(sub.attrs.swFileRef) : undefined
      const t = parseNums(ref.attrs.swTransform)
      const local = t.length === 16 && t.every(Number.isFinite) ? t : IDENTITY
      const world = mulMat(parent, local)
      const name = ref.attrs.swName ?? sub?.attrs.swName ?? '?'
      const number = ref.attrs.swReferenceNumber ?? '1'
      const segment = `${name}-${number}@${model.attrs.swName ?? ''}`
      const path = parentPath ? `${parentPath}/${segment}` : segment
      const c: SwComponent = {
        name,
        number,
        segment,
        path,
        file: file?.attrs.swPath ?? '',
        docType: file?.attrs.swDocType ?? '',
        config: ref.attrs.swConfigurationName ?? '',
        local,
        world,
        suppressed: /^yes$/i.test(ref.attrs.swSuppressed ?? ''),
        hidden: /^yes$/i.test(ref.attrs.swHidden ?? '') || hiddenIds.has(ref.attrs.swID ?? '\0'),
        virtual: /^yes$/i.test(ref.attrs.swIsVirtualComponent ?? ''),
        depth,
        children: [],
        box: sub?.attrs.swBoundingBox ? parseNums(sub.attrs.swBoundingBox) : undefined
      }
      if (sub && !seen.has(sub.attrs.id)) c.children = build(sub, world, path, depth + 1, new Set([...seen, sub.attrs.id]))
      out.push(c)
    }
    return out
  }
  return {
    configs: configs.map((c) => ({ name: c.attrs.swName ?? '', active: c.attrs.swMostRecentConfiguration === 'YES' })),
    config: cfg.attrs.swName ?? '',
    components: build(top, IDENTITY, '', 0, new Set([top.attrs.id]))
  }
}

export function flattenComponents(list: SwComponent[], out: SwComponent[] = []): SwComponent[] {
  for (const c of list) {
    out.push(c)
    flattenComponents(c.children, out)
  }
  return out
}

/** The components drawn as meshes: parts, and sub-assemblies whose contents the tree does not list. */
export function leafComponents(list: SwComponent[]): SwComponent[] {
  return flattenComponents(list).filter((c) => !c.children.length)
}

// ---------------------------------------------------------------------------------------------
// FaceTessellations

export interface TessEntry {
  path: string
  stamp: number
  /** Hash of the instance whose block this one reuses (all zero for an owner). */
  source: string
  hash: string
  stream: string
  block: number
}

const hex = (b: Uint8Array, o: number, n: number) => Array.from(b.subarray(o, o + n), (x) => x.toString(16).padStart(2, '0')).join('')

/** An MFC CString at `p` (ff fe ff, a length byte or ff + u16, UTF-16LE). */
function cstring(b: Uint8Array, p: number): { text: string; end: number } | null {
  if (b[p] !== 0xff || b[p + 1] !== 0xfe || b[p + 2] !== 0xff) return null
  let n = b[p + 3]
  let q = p + 4
  if (n === 0xff) {
    n = b[q] | (b[q + 1] << 8)
    q += 2
  }
  if (q + 2 * n > b.length) return null
  let text = ''
  for (let i = 0; i < n; i++) text += String.fromCharCode(b[q + 2 * i] | (b[q + 2 * i + 1] << 8))
  return { text, end: q + 2 * n }
}

export function readTessDirectory(b: Uint8Array): TessEntry[] {
  const out: TessEntry[] = []
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  for (let p = 0; p + 4 < b.length; p++) {
    const name = cstring(b, p)
    if (!name || !name.text.includes('@')) continue
    const q = name.end
    if (q + 28 > b.length) break
    const stream = cstring(b, q + 28)
    if (!stream) continue
    const blockAt = stream.end
    out.push({
      path: name.text,
      stamp: dv.getUint32(q, true),
      source: hex(b, q + 12, 8),
      hash: hex(b, q + 20, 8),
      stream: stream.text,
      block: blockAt + 4 <= b.length ? dv.getInt32(blockAt, true) : -1
    })
    p = blockAt + 3
  }
  return out
}

const ZERO_HASH = '0000000000000000'

function findHash(b: Uint8Array, h: Uint8Array, from = 0): number {
  outer: for (let i = from; i + h.length <= b.length; i++) {
    for (let k = 0; k < h.length; k++) if (b[i + k] !== h[k]) continue outer
    return i
  }
  return -1
}

/** One mesh per component instance path (lower-case), from the assembly's own tessellation blocks. */
export function readInstanceMeshes(c: SwContainer): Map<string, SwMesh> {
  const out = new Map<string, SwMesh>()
  const dir = c.get('FaceTessellations/Directory')
  if (!dir) return out
  const entries = readTessDirectory(dir)
  const byHash = new Map<string, TessEntry>()
  for (const e of entries) if (e.stream) byHash.set(e.hash, e)
  // Segment each stream at the owner blocks' hashes.
  const meshes = new Map<string, SwMesh | null>()
  const streams = new Set([...byHash.values()].map((e) => e.stream))
  for (const name of streams) {
    const data = c.get(`FaceTessellations/${name}`)
    if (!data) continue
    const owners = [...byHash.values()].filter((e) => e.stream === name)
    const starts: { e: TessEntry; at: number }[] = []
    for (const e of owners) {
      const h = new Uint8Array(e.hash.match(/../g)!.map((x) => parseInt(x, 16)))
      const at = findHash(data, h)
      if (at >= 0) starts.push({ e, at })
    }
    starts.sort((a, b) => a.at - b.at)
    starts.forEach((s, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].at - 4 : data.length
      let mesh: SwMesh | null = null
      try {
        mesh = readDisplayMesh(data.subarray(s.at + 8, end), s.e.path)
      } catch {
        mesh = null
      }
      meshes.set(s.e.hash, mesh)
    })
  }
  for (const e of entries) {
    const m = meshes.get(e.stream ? e.hash : e.source !== ZERO_HASH ? e.source : e.hash)
    if (m) out.set(e.path.toLowerCase(), m)
  }
  return out
}

/** Places a part mesh (millimetres, part coordinates) with a transform in metres. */
export function placeMesh(m: SwMesh, world: Mat4): { position: Float32Array; normal: Float32Array } {
  const n = m.position.length
  const position = new Float32Array(n)
  const normal = new Float32Array(n)
  const t = [world[12] * 1000, world[13] * 1000, world[14] * 1000]
  for (let i = 0; i < n; i += 3) {
    const x = m.position[i]
    const y = m.position[i + 1]
    const z = m.position[i + 2]
    position[i] = x * world[0] + y * world[4] + z * world[8] + t[0]
    position[i + 1] = x * world[1] + y * world[5] + z * world[9] + t[1]
    position[i + 2] = x * world[2] + y * world[6] + z * world[10] + t[2]
    const a = m.normal[i]
    const b = m.normal[i + 1]
    const cc = m.normal[i + 2]
    normal[i] = a * world[0] + b * world[4] + cc * world[8]
    normal[i + 1] = a * world[1] + b * world[5] + cc * world[9]
    normal[i + 2] = a * world[2] + b * world[6] + cc * world[10]
  }
  return { position, normal }
}

/** Bounding box of a mesh (any units). */
export function meshBox(position: Float32Array): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < position.length; i += 3)
    for (let k = 0; k < 3; k++) {
      if (position[i + k] < b[k]) b[k] = position[i + k]
      if (position[i + k] > b[k + 3]) b[k + 3] = position[i + k]
    }
  return b
}

/** Base name of a saved path (`C:\a\b.SLDPRT` → `b.SLDPRT`). */
export const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
