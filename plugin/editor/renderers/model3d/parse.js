// Geometry-only formats (STL, OBJ, PLY, OFF) parsed into plain typed arrays, so the work can run in
// a Web Worker (worker.js) and the result can be transferred to the page without copying. Plain
// JavaScript (module worker, no TypeScript transpile step); the page imports the same module when
// a worker cannot start. Types: parse.d.ts.
import { OBJLoader, PLYLoader, STLLoader } from '../../../vendor/three.js'

/** @typedef {{ type: 'mesh' | 'lines' | 'points', name: string, position: Float32Array, normal?: Float32Array, color?: Float32Array, colorSize?: number, uv?: Float32Array, index?: Uint32Array | Uint16Array }} Part */

/**
 * @param {string} kind  ModelKind from format.ts
 * @param {ArrayBuffer} buffer
 * @returns {{ parts: Part[], notes: string[] }}
 */
export function parseGeometry(kind, buffer) {
  const notes = []
  if (kind === 'stl-binary' || kind === 'stl-ascii') {
    const g = new STLLoader().parse(buffer)
    const part = fromGeometry(g, 'mesh', 'stl')
    // STLLoader marks per-facet colours (Materialise/VisCAM "COLOR=" headers).
    if (!g.hasColors) delete part.color
    return { parts: [part], notes }
  }
  if (kind === 'ply') {
    const g = new PLYLoader().parse(buffer)
    const faces = g.index ? g.index.count : 0
    return { parts: [fromGeometry(g, faces ? 'mesh' : 'points', 'ply')], notes }
  }
  if (kind === 'obj') {
    const text = new TextDecoder().decode(buffer)
    if (/^mtllib\s/m.test(text)) notes.push('mtl')
    // Without "vn" lines OBJLoader gives each face its own normal: mark it for the smooth toggle.
    const noNormals = !/^vn\s/m.test(text)
    const group = new OBJLoader().parse(text)
    const parts = []
    for (const child of group.children) {
      const type = child.isLineSegments ? 'lines' : child.isPoints ? 'points' : 'mesh'
      const part = fromGeometry(child.geometry, type, child.name || '')
      // OBJLoader keeps vertex colours only when the file has them ("v x y z r g b").
      if (!(child.material && (Array.isArray(child.material) ? child.material[0] : child.material).vertexColors)) delete part.color
      if (noNormals && type === 'mesh') part.unshared = true
      if (part.position.length) parts.push(part)
    }
    return { parts, notes }
  }
  if (kind === 'off') return { parts: [parseOFF(new TextDecoder().decode(buffer))], notes }
  throw new Error(`not a worker format: ${kind}`)
}

function fromGeometry(g, type, name) {
  const attr = (n) => {
    const a = g.getAttribute(n)
    if (!a) return undefined
    // Interleaved or non-float attributes (PLY can store uchar colours): copy into a Float32Array.
    if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute && a.array.length === a.count * a.itemSize) return a.array
    const out = new Float32Array(a.count * a.itemSize)
    // getX/getY/getZ/getW undo integer normalisation (uchar colours become 0-1)
    const get = [a.getX, a.getY, a.getZ, a.getW]
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = get[k].call(a, i)
    return out
  }
  const part = { type, name, position: attr('position') ?? new Float32Array(0) }
  const normal = attr('normal')
  if (normal) part.normal = normal
  const color = g.getAttribute('color')
  if (color) {
    part.color = attr('color')
    part.colorSize = color.itemSize
  }
  const uv = attr('uv')
  if (uv) part.uv = uv
  if (g.index) part.index = g.index.array instanceof Uint32Array || g.index.array instanceof Uint16Array ? g.index.array : Uint32Array.from(g.index.array)
  return part
}

/**
 * Object File Format (Geomview): `[ST][C][N]OFF`, counts, vertices (x y z [nx ny nz] [r g b [a]]),
 * then faces `n i1 … in [r g b [a]]` (polygons become triangle fans). Colours may be 0-1 floats or
 * 0-255 integers. Face colours become flat vertex colours (faces are unshared when any face has a colour).
 * @param {string} text
 * @returns {Part}
 */
export function parseOFF(text) {
  // Strip comments, then read tokens lazily line by line (faces carry a variable count).
  const lines = text.split(/\r?\n/)
  let li = 0
  let toks = []
  let ti = 0
  const nextLine = () => {
    while (li < lines.length) {
      const t = lines[li++].replace(/#.*/, '').trim()
      if (t) {
        toks = t.split(/\s+/)
        ti = 0
        return true
      }
    }
    return false
  }
  const token = () => {
    while (ti >= toks.length) if (!nextLine()) throw new Error('OFF: unexpected end of file')
    return toks[ti++]
  }
  const kw = token()
  if (!/^(ST)?C?N?OFF$/.test(kw)) throw new Error('OFF: missing header')
  const hasNormal = kw.includes('N')
  const hasColor = kw.includes('C')
  const hasTex = kw.startsWith('ST')
  const nv = Number(token())
  const nf = Number(token())
  token() // edge count (ignored)
  if (!Number.isInteger(nv) || !Number.isInteger(nf) || nv < 0 || nf < 0) throw new Error('OFF: bad counts')
  const pos = new Float32Array(nv * 3)
  const vcol = hasColor ? new Float32Array(nv * 3) : null
  for (let i = 0; i < nv; i++) {
    if (!nextLine()) throw new Error('OFF: missing vertices')
    // a vertex is one line: position, then optional normal / colour / texture coordinates
    const v = toks.map(Number)
    if (v.length < 3 || !Number.isFinite(v[0] + v[1] + v[2])) throw new Error('OFF: bad vertex')
    pos[i * 3] = v[0]
    pos[i * 3 + 1] = v[1]
    pos[i * 3 + 2] = v[2]
    if (vcol) {
      const c = v.slice(3 + (hasNormal ? 3 : 0), 3 + (hasNormal ? 3 : 0) + 3)
      const scale = c.some((x) => x > 1) ? 1 / 255 : 1
      for (let k = 0; k < 3; k++) vcol[i * 3 + k] = (c[k] ?? 1) * scale
    }
    ti = toks.length
  }
  void hasTex // texture coordinates (STOFF) are read past and not used: OFF has no texture reference
  const tri = []
  const fcol = []
  let anyFaceColor = false
  for (let f = 0; f < nf; f++) {
    if (!nextLine()) throw new Error('OFF: missing faces')
    const v = toks.map(Number)
    const n = v[0]
    if (!Number.isInteger(n) || n < 0 || v.length < 1 + n) throw new Error('OFF: bad face')
    const idx = v.slice(1, 1 + n)
    for (const k of idx) if (!Number.isInteger(k) || k < 0 || k >= nv) throw new Error('OFF: face index out of range')
    const extra = v.slice(1 + n)
    let c = null
    if (extra.length >= 3) {
      const scale = extra.slice(0, 3).some((x) => x > 1) ? 1 / 255 : 1
      c = [extra[0] * scale, extra[1] * scale, extra[2] * scale]
      anyFaceColor = true
    }
    for (let k = 1; k + 1 < n; k++) {
      tri.push(idx[0], idx[k], idx[k + 1])
      fcol.push(c)
    }
    ti = toks.length
  }
  if (anyFaceColor) {
    // unshare vertices so each triangle can carry its face colour
    const p = new Float32Array(tri.length * 3)
    const col = new Float32Array(tri.length * 3)
    for (let i = 0; i < tri.length; i++) {
      const s = tri[i]
      p.set(pos.subarray(s * 3, s * 3 + 3), i * 3)
      const c = fcol[Math.floor(i / 3)]
      if (c) col.set(c, i * 3)
      else if (vcol) col.set(vcol.subarray(s * 3, s * 3 + 3), i * 3)
      else col.fill(0.8, i * 3, i * 3 + 3)
    }
    return { type: 'mesh', name: 'off', position: p, color: col, colorSize: 3 }
  }
  const part = { type: nf ? 'mesh' : 'points', name: 'off', position: pos, index: Uint32Array.from(tri) }
  if (!nf) delete part.index
  if (vcol) {
    part.color = vcol
    part.colorSize = 3
  }
  return part
}

/** Typed-array buffers of the parts, for postMessage transfer lists. */
export function transferables(parts) {
  const out = new Set()
  for (const p of parts) for (const k of ['position', 'normal', 'color', 'uv', 'index']) if (p[k]) out.add(p[k].buffer)
  return [...out]
}
