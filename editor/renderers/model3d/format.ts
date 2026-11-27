/** Pure helpers for the 3D preview: what a file really is (by its bytes, not only its suffix),
 *  cheap size estimates read from headers before anything is parsed, and number formatting for the
 *  toolbar. No three.js and no DOM here, so they run in unit tests. */

export type ModelKind =
  | 'stl-binary'
  | 'stl-ascii'
  | 'obj'
  | 'ply'
  | 'glb'
  | 'gltf'
  | '3mf'
  | 'off'
  | 'fbx-binary'
  | 'fbx-ascii'
  | 'dae'
  | 'step'
  | 'iges'
  | 'brep'

/** Formats parsed in the worker (geometry only, no DOM needed). The rest parse on the main thread. */
export const WORKER_KINDS: ReadonlySet<ModelKind> = new Set(['stl-binary', 'stl-ascii', 'obj', 'ply', 'off'])

export const KIND_LABEL: Record<ModelKind, string> = {
  'stl-binary': 'STL (binary)',
  'stl-ascii': 'STL (ASCII)',
  obj: 'OBJ',
  ply: 'PLY',
  glb: 'glTF (GLB)',
  gltf: 'glTF (JSON)',
  '3mf': '3MF',
  off: 'OFF',
  'fbx-binary': 'FBX (binary)',
  'fbx-ascii': 'FBX (ASCII)',
  dae: 'COLLADA',
  step: 'STEP',
  iges: 'IGES',
  brep: 'BREP (OpenCascade)'
}

/** B-rep CAD formats read by OpenCascade (occt-import-js) in vendor/occt/. */
export const CAD_KINDS: ReadonlySet<ModelKind> = new Set(['step', 'iges', 'brep'])

/** Suffixes registered for the 3D preview (keep in step with orca-plugin.json and main.ts). */
export const MODEL_EXTENSIONS = ['stl', 'obj', 'ply', 'glb', 'gltf', '3mf', 'off', 'fbx', 'dae', 'step', 'stp', 'stpz', 'iges', 'igs', 'brep'] as const

/** CAD and 3D-printing formats store Z as up; the preview turns them so Z points up on screen. */
export function defaultZUp(kind: ModelKind): boolean {
  return kind === 'stl-binary' || kind === 'stl-ascii' || kind === '3mf' || kind === 'off' || CAD_KINDS.has(kind)
}

const ascii = (b: Uint8Array, start: number, end: number): string => {
  let s = ''
  for (let i = start; i < Math.min(end, b.length); i++) s += String.fromCharCode(b[i])
  return s
}

/** The first `n` bytes as Latin-1 text with a UTF-8 BOM and leading white space removed. */
function head(b: Uint8Array, n = 4096): string {
  let s = ascii(b, 0, n)
  if (s.startsWith('\xef\xbb\xbf')) s = s.slice(3)
  return s.replace(/^\s+/, '')
}

function looksText(b: Uint8Array, n = 4096): boolean {
  const end = Math.min(n, b.length)
  for (let i = 0; i < end; i++) if (b[i] === 0) return false
  return true
}

/** Binary STL: 80-byte header, uint32 triangle count, 50 bytes per triangle. */
export function stlBinaryCount(b: Uint8Array): number | null {
  if (b.length < 84) return null
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true)
}

/**
 * The model format by content. `ext` (lower case, no dot) breaks ties for formats without a
 * signature (OBJ). Returns null when the bytes are not a model this preview reads (or are cut off).
 */
export function detectModel(b: Uint8Array, ext: string): ModelKind | null {
  if (b.length < 4) return null
  if (b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) return 'glb' // "glTF"
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return '3mf' // zip
  if (ascii(b, 0, 18) === 'Kaydara FBX Binary') return 'fbx-binary'
  const text = looksText(b)
  const h = head(b)
  if (/^ply\r?\n/.test(h)) return 'ply'
  if (text) {
    if (/^(ST)?C?N?OFF(\s|$)/.test(h)) return 'off'
    if (/<COLLADA[\s>]/.test(h)) return 'dae'
    if (/^ISO-10303-21\s*;/.test(h)) return 'step'
    if (/^(DBRep_DrawableShape|CASCADE Topology V\d)/.test(h)) return 'brep'
    if (isIges(ascii(b, 0, 4096).replace(/^\xef\xbb\xbf/, ''))) return 'iges' // columns matter: no trimming
    if (h.startsWith('{') && (ext === 'gltf' || /"asset"\s*:/.test(h))) return 'gltf'
    if (/^;\s*FBX/.test(h) || /\bFBXHeaderExtension\s*:/.test(h)) return 'fbx-ascii'
  }
  // STL: a binary file whose size matches its triangle count wins even when its header starts
  // with "solid" (many CAD exporters write that), then ASCII, then a binary file with trailing bytes.
  const n = stlBinaryCount(b)
  const binaryExact = n !== null && 84 + n * 50 === b.length
  if (binaryExact && (ext === 'stl' || n > 0)) return 'stl-binary'
  if (text && /^solid\b/i.test(h) && /\bfacet\b|\bendsolid\b/i.test(h + ascii(b, Math.max(0, b.length - 256), b.length)))
    return 'stl-ascii'
  if (ext === 'stl' && n !== null && n > 0 && 84 + n * 50 <= b.length && !/^solid\b/i.test(h)) return 'stl-binary'
  if (ext === 'obj' && text && /^(v|vn|vt|f|o|g|mtllib|usemtl|#)\s/m.test(h)) return 'obj'
  return null
}

/** IGES: fixed 80-column records; the first is a Start ('S') record, sequence number 1, and a
 *  Global ('G') record follows. */
export function isIges(text: string): boolean {
  const lines = text.split(/\r?\n/, 4)
  const first = lines[0] ?? ''
  if (first.length < 73 || first[72] !== 'S' || !/^\s*0*1\s*$/.test(first.slice(73, 80))) return false
  return lines.slice(1).some((l) => l.length >= 73 && (l[72] === 'G' || l[72] === 'S'))
}

/** Tessellation presets for CAD files: OpenCascade's linear deflection as a ratio of the model's
 *  bounding box (so the same setting suits a screw and a building) and its angular deflection. */
export type CadQuality = 'coarse' | 'normal' | 'fine'
export const CAD_QUALITY: Record<CadQuality, { linearDeflection: number; angularDeflection: number }> = {
  coarse: { linearDeflection: 0.004, angularDeflection: 0.8 },
  normal: { linearDeflection: 0.001, angularDeflection: 0.5 },
  fine: { linearDeflection: 0.0003, angularDeflection: 0.25 }
}
export function cadParams(q: CadQuality): Record<string, string | number> {
  return { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', ...CAD_QUALITY[q] }
}

/** Time allowed to read and tessellate a CAD file: 20 s plus 5 s per MB, at most 30 minutes (progress is shown). */
export function cadTimeLimitMs(bytes: number): number {
  return Math.min(1_800_000, 20_000 + Math.ceil(bytes / (1024 * 1024)) * 5_000)
}

/** gzip (RFC 1952) magic: .stpz files and gzip-compressed models. */
export function isGzip(b: Uint8Array): boolean {
  return b.length >= 18 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08
}

export interface SizeEstimate {
  triangles: number | null
  vertices: number | null
}

/** Counts declared in the header, available before parsing (null when the format has none). */
export function estimateSize(kind: ModelKind, b: Uint8Array): SizeEstimate {
  if (kind === 'stl-binary') {
    const n = stlBinaryCount(b) ?? 0
    return { triangles: n, vertices: n * 3 }
  }
  if (kind === 'ply') {
    const h = ascii(b, 0, Math.min(b.length, 64 * 1024))
    const end = h.indexOf('end_header')
    const header = end >= 0 ? h.slice(0, end) : h
    const v = /^element\s+vertex\s+(\d+)/m.exec(header)
    const f = /^element\s+face\s+(\d+)/m.exec(header)
    // Faces are usually triangles or quads; count a quad as two triangles only after parsing.
    return { triangles: f ? Number(f[1]) : 0, vertices: v ? Number(v[1]) : null }
  }
  if (kind === 'off') {
    const nums = offHeaderCounts(head(b, 64 * 1024))
    return nums ? { triangles: nums.faces, vertices: nums.vertices } : { triangles: null, vertices: null }
  }
  return { triangles: null, vertices: null }
}

/** `OFF` header counts (vertices, faces) after the keyword, skipping `#` comments. */
export function offHeaderCounts(text: string): { vertices: number; faces: number } | null {
  const tokens: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.replace(/#.*/, '').trim()
    if (!t) continue
    tokens.push(...t.split(/\s+/))
    if (tokens.length >= 4) break
  }
  if (!tokens.length || !/^(ST)?C?N?OFF$/.test(tokens[0])) return null
  const v = Number(tokens[1])
  const f = Number(tokens[2])
  if (!Number.isInteger(v) || !Number.isInteger(f) || v < 0 || f < 0) return null
  return { vertices: v, faces: f }
}

/** One length for the toolbar: about four significant digits, no exponent for ordinary sizes. */
export function formatLength(n: number): string {
  if (!Number.isFinite(n)) return '?'
  const a = Math.abs(n)
  if (a === 0) return '0'
  if (a >= 1e9 || a < 1e-4) return n.toExponential(2)
  if (a >= 1000) return Math.round(n).toLocaleString('en-US')
  const digits = a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : Math.min(8, 3 - Math.floor(Math.log10(a)))
  return n.toFixed(digits).replace(/\.?0+$/, '')
}

/** Bounding-box size `x × y × z` in the file's own units. */
export function formatBox(size: { x: number; y: number; z: number }): string {
  return `${formatLength(size.x)} × ${formatLength(size.y)} × ${formatLength(size.z)}`
}

/** 1234567 → "1,234,567"; ≥ 10 million → "12.3M". */
export function formatCount(n: number): string {
  if (n >= 1e7) return `${(n / 1e6).toFixed(1)}M`
  return Math.round(n).toLocaleString('en-US')
}

/** Largest model the preview builds on the GPU (triangles). Phones get a lower ceiling. */
export function triangleLimit(compact: boolean): number {
  return compact ? 4_000_000 : 12_000_000
}
/** Files above this are refused before parsing (also the most a gzip-compressed model may expand to).
 *  Orca itself delivers at most 50 MB to a plugin editor (1.4.263); compress larger STEP files (.stpz). */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024

/** glTF JSON facts needed before parsing: required extensions and whether all resources are embedded. */
export interface GltfFacts {
  required: string[]
  used: string[]
  externalUris: string[]
  /** The external URIs of buffers (geometry: without them nothing can be drawn). */
  externalBuffers: string[]
}

export function gltfFacts(json: unknown): GltfFacts {
  const j = (json ?? {}) as {
    extensionsRequired?: unknown
    extensionsUsed?: unknown
    buffers?: { uri?: unknown }[]
    images?: { uri?: unknown }[]
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const external: string[] = []
  const buffers: string[] = []
  const uris = (v: unknown, into: string[]) => {
    for (const r of Array.isArray(v) ? (v as { uri?: unknown }[]) : []) {
      const uri = r && typeof r.uri === 'string' ? r.uri : null
      if (uri && !/^data:/i.test(uri)) into.push(uri)
    }
  }
  uris(j.buffers, buffers)
  external.push(...buffers)
  uris(j.images, external)
  return { required: list(j.extensionsRequired), used: list(j.extensionsUsed), externalUris: external, externalBuffers: buffers }
}

/** The JSON chunk of a GLB container (null when the container is damaged). */
export function glbJson(b: Uint8Array): unknown | null {
  if (b.length < 20) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const len = dv.getUint32(12, true)
  const type = dv.getUint32(16, true)
  if (type !== 0x4e4f534a || 20 + len > b.length) return null // "JSON"
  try {
    return JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + len)))
  } catch {
    return null
  }
}

/** Extensions three.js' GLTFLoader understands in this bundle (Draco and meshopt via decoders). */
export const GLTF_SUPPORTED_EXTENSIONS = new Set([
  'KHR_materials_unlit',
  'KHR_materials_emissive_strength',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_materials_anisotropy',
  'KHR_materials_bump',
  'KHR_lights_punctual',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'EXT_mesh_gpu_instancing',
  'EXT_texture_webp',
  'EXT_texture_avif',
  'EXT_materials_bump'
])
