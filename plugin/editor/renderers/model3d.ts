/** 3D models (.stl .obj .ply .glb .gltf .3mf .off .fbx .dae, and CAD B-rep .step .stp .iges .igs
 *  .brep read by OpenCascade/occt-import-js in a Web Worker): three.js (MIT) loaders, WebGL, orbit
 *  controls (mouse and touch). Geometry-only formats parse in a Web Worker; glTF/3MF/FBX/COLLADA
 *  parse on the main thread after a yield. Draws only when something changes, and once without
 *  requestAnimationFrame so a hidden window still shows the model. The frame has no network: only
 *  data:/blob: resources load; external textures, .mtl and .bin files are reported, not fetched. */
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { h, showLoading, showMessage } from '../core/ui.ts'
import * as THREE from '../../vendor/three.js'
import {
  CAD_KINDS,
  cadParams,
  cadTimeLimitMs,
  type CadQuality,
  defaultZUp,
  detectModel,
  estimateSize,
  formatBox,
  formatCount,
  GLTF_SUPPORTED_EXTENSIONS,
  gltfFacts,
  glbJson,
  KIND_LABEL,
  MAX_FILE_BYTES,
  isGzip,
  triangleLimit,
  WORKER_KINDS,
  type ModelKind
} from './model3d/format.ts'
import type { Part } from './model3d/parse.js'

const STYLE = `
.fp-3d-stage { position: absolute; inset: 0; overflow: hidden; }
.fp-3d-stage > canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; cursor: grab; }
.fp-3d-stage > canvas:active { cursor: grabbing; }
.fp-3d-note { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px); box-sizing: border-box;
  padding: 4px 8px; border-radius: var(--orca-radius, 6px); font-size: 12px; pointer-events: none;
  background: color-mix(in srgb, var(--orca-card, #fafafa) 85%, transparent); color: var(--orca-muted-foreground, #666);
  border: 1px solid var(--orca-border, #ddd); }
`

type Backdrop = 'theme' | 'light' | 'dark'
const BACKDROP_KEY = 'file-preview.backdrop.model3d'
const BACKDROP_COLOR: Record<Exclude<Backdrop, 'theme'>, string> = { light: '#eef0f3', dark: '#1d1f23' }
/** 1×1 white PNG used in place of an external texture (the material keeps its colour). */
const WHITE_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
/** Above this many triangles, smooth shading for unshared (STL) meshes is not recomputed. */
const SMOOTH_LIMIT = 3_000_000
const PARSE_TIMEOUT_MS = 60_000

interface Loaded {
  object: THREE.Object3D
  notes: string[]
  /** Unit of the coordinates when the loader converted them (CAD: millimetres). */
  units?: string
  /** Named parts for the parts list (CAD assemblies). */
  parts?: { name: string; object: THREE.Object3D }[]
  /** Format label and up axis when the model does not come from a file of `kind` (SolidWorks meshes). */
  label?: string
  zUp?: boolean
}

export async function render(ctx: PreviewContext): Promise<() => void> {
  const { tr } = ctx
  // .stpz (and any gzip-compressed model): unpack first. Orca hands a plugin at most 50 MB, and STEP
  // text compresses well, so this is how large STEP files reach the preview.
  if (isGzip(ctx.bytes)) ctx = { ...ctx, bytes: await gunzip(ctx.bytes, ctx) }
  const { bytes } = ctx
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new PreviewError(
      'too-large',
      tr(`파일이 너무 큽니다 (${formatBytes(bytes.byteLength)}). 미리보기는 ${formatBytes(MAX_FILE_BYTES)}까지 지원합니다.`, `This file is too large (${formatBytes(bytes.byteLength)}). The preview handles up to ${formatBytes(MAX_FILE_BYTES)}.`)
    )
  }
  const kind = detectModel(bytes, ctx.fileType)
  if (!kind) {
    throw new PreviewError(
      'model-format',
      tr(`.${ctx.fileType} 파일의 내용이 3D 모델이 아니거나 잘려 있거나 손상되었습니다.`, `This .${ctx.fileType} file is not a 3D model, or it is cut off or damaged.`)
    )
  }
  if (CAD_KINDS.has(kind)) return renderCad(ctx, kind)
  return mount(ctx, kind, null)
}

/** Shows meshes decoded by another renderer (SolidWorks display meshes) in this viewer. Positions
 *  are in `units`; `label` names the source in the toolbar. */
export async function renderMeshes(
  ctx: PreviewContext,
  parts: Part[],
  opts: { label: string; units?: string; zUp?: boolean; notes?: string[] }
): Promise<() => void> {
  const { tr, signal } = ctx
  const renderer = createRenderer(tr)
  const disposers: (() => void)[] = [
    () => {
      renderer.dispose()
      renderer.forceContextLoss()
    }
  ]
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const d of disposers.reverse()) {
      try {
        d()
      } catch {
        // keep releasing the rest
      }
    }
  }
  signal.addEventListener('abort', dispose, { once: true })
  try {
    const object = buildParts(parts, 'obj')
    disposers.push(() => disposeObject(object))
    const counts = countModel(object)
    const limit = triangleLimit(ctx.compact)
    if (counts.triangles > limit) {
      throw new PreviewError(
        'too-many-triangles',
        tr(`삼각형이 너무 많습니다 (${formatCount(counts.triangles)}개).`, `This model has too many triangles (${formatCount(counts.triangles)}).`)
      )
    }
    const named = parts.length > 1 ? object.children.map((o) => ({ name: o.name, object: o })) : undefined
    mountViewer(ctx, renderer, 'obj', { object, notes: opts.notes ?? [], units: opts.units, parts: named, label: opts.label, zUp: opts.zUp ?? false }, counts, disposers)
    return dispose
  } catch (err) {
    dispose()
    throw err
  }
}

/** Inflates gzip with the browser's DecompressionStream, refusing output above MAX_FILE_BYTES (bombs). */
async function gunzip(src: Uint8Array, ctx: PreviewContext): Promise<Uint8Array> {
  const { tr } = ctx
  const tooLarge = () =>
    new PreviewError(
      'too-large',
      tr(`압축을 풀면 ${formatBytes(MAX_FILE_BYTES)}를 넘습니다.`, `This file expands to more than ${formatBytes(MAX_FILE_BYTES)}.`)
    )
  setProgress(ctx.root, tr('압축 푸는 중…', 'Decompressing…'))
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    const reader = new Blob([src as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_FILE_BYTES) {
        await reader.cancel()
        throw tooLarge()
      }
      chunks.push(value)
      if (ctx.signal.aborted) {
        await reader.cancel()
        throw new DOMException('aborted', 'AbortError')
      }
    }
  } catch (err) {
    if (err instanceof PreviewError || (err as Error)?.name === 'AbortError') throw err
    throw new PreviewError('model-format', tr('압축 파일(gzip)이 손상되었습니다.', 'The gzip-compressed file is damaged.'))
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.byteLength
  }
  return out
}

/** Loads the model and mounts the viewer; returns its cleanup (also run when ctx.signal aborts). */
async function mount(ctx: PreviewContext, kind: ModelKind, quality: CadQuality | null): Promise<() => void> {
  const { bytes, tr, signal } = ctx
  const limit = triangleLimit(ctx.compact)
  const tooMany = (n: number) =>
    new PreviewError(
      'too-many-triangles',
      tr(
        `삼각형이 너무 많습니다 (${formatCount(n)}개). 이 기기에서는 ${formatCount(limit)}개까지 미리 볼 수 있습니다.`,
        `This model has too many triangles (${formatCount(n)}). This device previews up to ${formatCount(limit)}.`
      )
    )
  const est = estimateSize(kind, bytes)
  if (est.triangles != null && est.triangles > limit) throw tooMany(est.triangles)

  // WebGL first: without it there is nothing to parse for.
  const renderer = createRenderer(tr)
  const disposers: (() => void)[] = [
    () => {
      renderer.dispose()
      renderer.forceContextLoss()
    }
  ]
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const d of disposers.reverse()) {
      try {
        d()
      } catch {
        // keep releasing the rest
      }
    }
  }
  signal.addEventListener('abort', dispose, { once: true })

  try {
    const loaded = await load(kind, ctx, quality ?? 'normal')
    if (signal.aborted) {
      disposeObject(loaded.object)
      return dispose
    }
    disposers.push(() => disposeObject(loaded.object))
    const counts = countModel(loaded.object)
    if (counts.triangles > limit) throw tooMany(counts.triangles)
    if (counts.triangles === 0 && counts.vertices === 0) {
      throw new PreviewError('model-empty', tr('모델에 표시할 도형이 없습니다.', 'The model contains no geometry to show.'))
    }
    mountViewer(ctx, renderer, kind, loaded, counts, disposers)
    return dispose
  } catch (err) {
    dispose()
    if (err instanceof PreviewError || (err as Error)?.name === 'AbortError') throw err
    console.warn('model3d:', err)
    throw new PreviewError(
      'model-parse',
      tr(`${KIND_LABEL[kind]} 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 변형입니다.`, `Cannot read this ${KIND_LABEL[kind]} file. It is damaged or uses an unsupported variant.`)
    )
  }
}

function createRenderer(tr: PreviewContext['tr']): THREE.WebGLRenderer {
  const fail = () =>
    new PreviewError(
      'webgl',
      tr(
        '이 환경에서는 WebGL을 사용할 수 없어 3D 미리보기를 표시할 수 없습니다. 그래픽 가속이 꺼져 있거나 브라우저가 지원하지 않습니다.',
        'WebGL is not available here, so the 3D preview cannot be shown. Graphics acceleration may be turned off or unsupported by this browser.'
      )
    )
  const probe = document.createElement('canvas')
  if (!probe.getContext('webgl2') && !probe.getContext('webgl')) throw fail()
  try {
    // three r17x needs WebGL 2; it throws when the context cannot be created.
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false })
    r.outputColorSpace = THREE.SRGBColorSpace
    return r
  } catch (e) {
    console.warn('model3d: WebGL renderer', e)
    throw fail()
  }
}

// ---------------------------------------------------------------------------------------------
// Loading

async function load(kind: ModelKind, ctx: PreviewContext, quality: CadQuality): Promise<Loaded> {
  if (CAD_KINDS.has(kind)) return loadCad(kind, ctx, quality)
  if (WORKER_KINDS.has(kind)) {
    const { parts, notes } = await parseOffThread(kind, ctx)
    return { object: buildParts(parts, kind), notes: notes.map((n) => noteText(n, ctx.tr)) }
  }
  // Main-thread loaders: let the spinner paint first.
  await new Promise((r) => setTimeout(r, 0))
  if (ctx.signal.aborted) throw new DOMException('aborted', 'AbortError')
  const buffer = copyBuffer(ctx.bytes)
  const external: string[] = []
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url
    external.push(url)
    return WHITE_PIXEL
  })
  const finish = (object: THREE.Object3D, notes: string[] = []): Loaded => {
    if (external.length) notes.push(noteText('textures', ctx.tr, external.length))
    return { object, notes }
  }
  if (kind === 'glb' || kind === 'gltf') return finish(...(await loadGltf(kind, buffer, manager, ctx)))
  if (kind === '3mf') return finish(new THREE.ThreeMFLoader(manager).parse(buffer))
  if (kind === 'fbx-binary' || kind === 'fbx-ascii') return finish(new THREE.FBXLoader(manager).parse(buffer, ''))
  if (kind === 'dae') {
    const text = new TextDecoder().decode(buffer)
    const res = new THREE.ColladaLoader(manager).parse(text, '')
    if (!res?.scene) throw new Error('COLLADA: no scene')
    return finish(res.scene)
  }
  throw new Error(`unhandled kind ${kind}`)
}

function copyBuffer(b: Uint8Array): ArrayBuffer {
  return b.slice().buffer as ArrayBuffer
}

function noteText(note: string, tr: PreviewContext['tr'], n = 0): string {
  if (note === 'mtl')
    return tr('재질(.mtl)·텍스처 파일은 별도 파일이라 불러오지 않았습니다. 기본 재질로 표시합니다.', 'Material (.mtl) and texture files are separate files and were not loaded; shown with a neutral material.')
  if (note === 'textures')
    return tr(`외부 텍스처 ${n}개는 별도 파일이라 불러오지 않았습니다.`, `${n} external texture${n === 1 ? '' : 's'} not loaded (separate files).`)
  return note
}

/** STL/OBJ/PLY/OFF in a module Worker; on the main thread only when no worker can start. */
async function parseOffThread(kind: ModelKind, ctx: PreviewContext): Promise<{ parts: Part[]; notes: string[] }> {
  const { signal } = ctx
  const buffer = copyBuffer(ctx.bytes)
  let worker: Worker
  try {
    worker = new Worker(new URL('./model3d/worker.js', import.meta.url), { type: 'module' })
  } catch (err) {
    console.warn('model3d: worker unavailable, parsing on the main thread', err)
    return parseHere(kind, buffer)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let loaded = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      worker.terminate()
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('parse timed out'))), PARSE_TIMEOUT_MS)
    const onAbort = () => finish(() => reject(new DOMException('aborted', 'AbortError')))
    signal.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = (e: MessageEvent<{ loaded?: boolean; ok?: boolean; parts?: Part[]; notes?: string[]; message?: string }>) => {
      if (e.data.loaded) {
        loaded = true
        worker.postMessage({ kind, buffer }, [buffer])
        return
      }
      finish(() => (e.data.ok && e.data.parts ? resolve({ parts: e.data.parts, notes: e.data.notes ?? [] }) : reject(new Error(e.data.message ?? 'parse failed'))))
    }
    worker.onerror = (e) => {
      e.preventDefault()
      // The script failed to load (module workers unsupported): parse here instead. A crash after
      // it loaded (out of memory) is a failure of this file, not retried on the main thread.
      if (!loaded) finish(() => parseHere(kind, buffer).then(resolve, reject))
      else finish(() => reject(new Error(e.message || 'worker crashed')))
    }
  })
}

async function parseHere(kind: ModelKind, buffer: ArrayBuffer): Promise<{ parts: Part[]; notes: string[] }> {
  await new Promise((r) => setTimeout(r, 0))
  const { parseGeometry } = await import('./model3d/parse.js')
  return parseGeometry(kind, buffer)
}

function buildParts(parts: Part[], kind: ModelKind): THREE.Object3D {
  const group = new THREE.Group()
  for (const p of parts) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p.position, 3))
    if (p.normal) g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3))
    if (p.color) g.setAttribute('color', new THREE.BufferAttribute(p.color, p.colorSize ?? 3))
    if (p.uv) g.setAttribute('uv', new THREE.BufferAttribute(p.uv, 2))
    if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1))
    const vertexColors = !!p.color
    let obj: THREE.Object3D
    if (p.type === 'points') {
      obj = new THREE.Points(g, new THREE.PointsMaterial({ color: vertexColors ? 0xffffff : 0x9aa3ad, vertexColors, size: 2, sizeAttenuation: false }))
    } else if (p.type === 'lines') {
      obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: vertexColors ? 0xffffff : 0x9aa3ad, vertexColors }))
    } else {
      if (!p.normal) g.computeVertexNormals()
      obj = new THREE.Mesh(g, neutralMaterial(vertexColors))
      // STL stores one normal per facet: shown flat until the person asks for smooth shading.
      obj.userData.unshared = kind === 'stl-binary' || kind === 'stl-ascii' || !!p.unshared
    }
    obj.name = p.name
    group.add(obj)
  }
  return group
}

function neutralMaterial(vertexColors: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: vertexColors ? 0xffffff : 0xb4bac4,
    vertexColors,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide
  })
}

async function loadGltf(kind: 'glb' | 'gltf', buffer: ArrayBuffer, manager: THREE.LoadingManager, ctx: PreviewContext): Promise<[THREE.Object3D, string[]]> {
  const { tr } = ctx
  let json: unknown
  if (kind === 'glb') json = glbJson(new Uint8Array(buffer))
  else {
    try {
      json = JSON.parse(new TextDecoder().decode(buffer))
    } catch {
      json = null
    }
  }
  if (!json) throw new Error('glTF: damaged JSON')
  const facts = gltfFacts(json)
  if (facts.externalUris.length) {
    throw new PreviewError(
      'gltf-external',
      tr(
        `이 glTF는 별도 파일(${facts.externalUris.slice(0, 3).join(', ')})을 참조합니다. 미리보기는 파일 하나만 읽을 수 있으니 모든 데이터가 포함된 .glb로 내보내 주세요.`,
        `This glTF refers to separate files (${facts.externalUris.slice(0, 3).join(', ')}). The preview can read only this one file: export a self-contained .glb instead.`
      )
    )
  }
  const unsupported = facts.required.filter((x) => !GLTF_SUPPORTED_EXTENSIONS.has(x))
  if (unsupported.length) {
    throw new PreviewError(
      'gltf-extension',
      tr(`이 glTF에 필요한 확장(${unsupported.join(', ')})은 미리보기에서 지원하지 않습니다.`, `This glTF needs extensions the preview does not support: ${unsupported.join(', ')}.`)
    )
  }
  const loader = new THREE.GLTFLoader(manager)
  const all = new Set([...facts.used, ...facts.required])
  let draco: THREE.DRACOLoader | null = null
  if (all.has('KHR_draco_mesh_compression')) {
    // Pure-JS (asm.js) decoder copied to vendor/draco/: no WebAssembly, so no 'wasm-unsafe-eval'.
    draco = new THREE.DRACOLoader()
    draco.setDecoderPath(new URL('../../vendor/draco/', import.meta.url).href)
    draco.setDecoderConfig({ type: 'js' })
    draco.setWorkerLimit(1)
    loader.setDRACOLoader(draco)
  }
  if (all.has('EXT_meshopt_compression')) {
    try {
      const { MeshoptDecoder } = await import('../../vendor/meshopt.js')
      await MeshoptDecoder.ready
      loader.setMeshoptDecoder(MeshoptDecoder)
    } catch (e) {
      console.warn('model3d: meshopt decoder', e)
      if (facts.required.includes('EXT_meshopt_compression')) {
        throw new PreviewError(
          'meshopt',
          tr(
            '이 glTF는 meshopt로 압축되어 있습니다. 압축 해제기(WebAssembly)를 이 화면에서 실행할 수 없어 표시할 수 없습니다.',
            'This glTF is meshopt-compressed, and its decoder (WebAssembly) cannot run in this view.'
          )
        )
      }
    }
  }
  try {
    const gltf = await loader.parseAsync(kind === 'glb' ? buffer : new TextDecoder().decode(buffer), '')
    const scene = gltf.scene ?? gltf.scenes?.[0]
    if (!scene) throw new Error('glTF: no scene')
    return [scene, []]
  } catch (e) {
    if (draco && /draco/i.test(String((e as Error)?.message ?? e))) {
      console.warn('model3d: draco', e)
      throw new PreviewError('draco', tr('Draco로 압축된 도형을 풀 수 없습니다.', 'The Draco-compressed geometry could not be decoded.'))
    }
    throw e
  } finally {
    draco?.dispose()
  }
}

// ---------------------------------------------------------------------------------------------
// Counting and cleanup

function countModel(root: THREE.Object3D): { triangles: number; vertices: number } {
  let triangles = 0
  let vertices = 0
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (!g?.getAttribute) return
    const pos = g.getAttribute('position')
    if (!pos) return
    vertices += pos.count
    if ((o as THREE.Mesh).isMesh) triangles += Math.floor((g.index ? g.index.count : pos.count) / 3)
  })
  return { triangles, vertices }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose?.()
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const mat of mats) disposeMaterial(mat)
    for (const k of ['smoothGeometry', 'storedGeometry'] as const) (m.userData?.[k] as THREE.BufferGeometry | undefined)?.dispose()
  })
}

function disposeMaterial(mat: THREE.Material): void {
  for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose()
  mat.dispose()
}

// ---------------------------------------------------------------------------------------------
// Viewer

function mountViewer(
  ctx: PreviewContext,
  renderer: THREE.WebGLRenderer,
  kind: ModelKind,
  loaded: Loaded,
  counts: { triangles: number; vertices: number },
  disposers: (() => void)[]
): void {
  const { root, tr, toolbar, signal } = ctx
  root.replaceChildren()
  root.style.overflow = 'hidden'
  const stage = h('div', 'fp-3d-stage')
  const canvas = renderer.domElement
  // Sizes are pinned inline as well as in the stylesheet: the canvas must always be displayed at
  // exactly the pane's size. If a host stylesheet wins over ours, a canvas falls back to its
  // drawing-buffer size, which is devicePixelRatio times larger, and the model shows up cropped
  // towards the bottom-right (seen in Orca at 125 % display scaling).
  stage.style.cssText = 'position:absolute;inset:0;overflow:hidden'
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none'
  stage.append(h('style', undefined, STYLE), canvas)
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute('role', 'img')
  renderer.domElement.setAttribute('aria-label', tr(`3D 모델 미리보기 (${loaded.label ?? KIND_LABEL[kind]})`, `3D model preview (${loaded.label ?? KIND_LABEL[kind]})`))
  root.append(stage)
  if (loaded.notes.length) stage.append(h('div', 'fp-3d-note', loaded.notes.join(' ')))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
  scene.add(camera)

  // Lighting: soft image-based light for PBR materials, a sky/ground fill and a headlight that
  // follows the camera so the side facing the viewer is always lit.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new THREE.RoomEnvironment()
  const env = pmrem.fromScene(room, 0.04).texture
  room.dispose?.()
  pmrem.dispose()
  scene.environment = env
  scene.environmentIntensity = 0.45
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.1))
  const head = new THREE.DirectionalLight(0xffffff, 1.6)
  head.position.set(0.4, 0.6, 1)
  camera.add(head)
  disposers.push(() => env.dispose())

  // model → turn (Z-up) → centre at the origin
  const model = loaded.object
  const turn = new THREE.Group()
  const centre = new THREE.Group()
  turn.add(model)
  centre.add(turn)
  scene.add(centre)

  model.updateMatrixWorld(true)
  const storedBox = new THREE.Box3().setFromObject(model)
  const storedSize = storedBox.getSize(new THREE.Vector3())

  let zUp = loaded.zUp ?? defaultZUp(kind)
  let radius = 1
  let floorY = 0
  const helpers = new THREE.Group()
  helpers.visible = false
  scene.add(helpers)
  const layout = () => {
    turn.rotation.set(zUp ? -Math.PI / 2 : 0, 0, 0)
    centre.position.set(0, 0, 0)
    centre.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(centre)
    const c = box.getCenter(new THREE.Vector3())
    centre.position.copy(c).negate()
    const size = box.getSize(new THREE.Vector3())
    radius = Math.max(1e-9, size.length() / 2)
    floorY = -size.y / 2
    rebuildHelpers(size)
    centre.updateMatrixWorld(true)
    samples = samplePoints(model, 20000)
  }
  let samples: Float32Array = new Float32Array(0)

  const rebuildHelpers = (size: THREE.Vector3) => {
    for (const c of [...helpers.children]) {
      helpers.remove(c)
      ;(c as THREE.LineSegments).geometry.dispose()
      disposeMaterial((c as THREE.LineSegments).material as THREE.Material)
    }
    const extent = Math.max(size.x, size.z, size.y * 0.5) * 1.6
    const step = niceStep(extent / 10)
    const divisions = Math.max(2, Math.min(200, Math.ceil(extent / step)))
    const dark = isDark(background())
    const grid = new THREE.GridHelper(divisions * step, divisions, dark ? 0x6b7280 : 0x9ca3af, dark ? 0x3a3f47 : 0xd1d5db)
    grid.position.y = floorY
    const axes = new THREE.AxesHelper(Math.max(size.x, size.y, size.z) * 0.6 || 1)
    axes.position.y = floorY
    helpers.add(grid, axes)
  }
  disposers.push(() =>
    helpers.traverse((o) => {
      ;(o as THREE.LineSegments).geometry?.dispose()
    })
  )

  // Drawing on demand
  let frame = 0
  let fallback = 0
  let drawing = false
  const draw = () => {
    if (signal.aborted) return
    cancelAnimationFrame(frame)
    clearTimeout(fallback)
    frame = 0
    fallback = 0
    drawing = true
    controls.update()
    drawing = false
    renderer.render(scene, camera)
  }
  const requestDraw = () => {
    if (drawing || frame || fallback) return
    frame = requestAnimationFrame(draw)
    // A hidden or occluded window may never run animation frames: draw anyway shortly after.
    fallback = window.setTimeout(draw, 120)
  }
  disposers.push(() => {
    cancelAnimationFrame(frame)
    clearTimeout(fallback)
  })

  const controls = new THREE.OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  controls.screenSpacePanning = true
  controls.zoomToCursor = true
  controls.autoRotateSpeed = 1.5
  controls.addEventListener('change', requestDraw)
  // Until the person moves the camera, a pane resize fits the model again.
  let userMoved = false
  controls.addEventListener('start', () => (userMoved = true))
  disposers.push(() => controls.dispose())

  // Size
  let width = 0
  let height = 0
  const resize = () => {
    // The size the canvas is really displayed at (its CSS box), not a container's.
    const r = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width) || root.clientWidth || 300)
    const hgt = Math.max(1, Math.round(r.height) || root.clientHeight || 300)
    const pr = Math.min(window.devicePixelRatio || 1, counts.triangles > 2_000_000 ? 1.5 : 2)
    if (w === width && hgt === height && pr === renderer.getPixelRatio()) return false
    width = w
    height = hgt
    // Huge meshes: cap the pixel ratio so a phone's 3× screen does not triple the fill cost.
    renderer.setPixelRatio(pr)
    renderer.setSize(w, hgt, false)
    camera.aspect = w / hgt
    camera.updateProjectionMatrix()
    return true
  }
  const ro = new ResizeObserver(() => {
    if (!resize()) return
    if (!userMoved) fit()
    draw()
  })
  ro.observe(root)
  ro.observe(canvas)
  disposers.push(() => ro.disconnect())

  /** Frames the model: the camera looks from a fixed three-quarter direction, and the model's own
   *  projected outline (sampled vertices, not its bounding sphere) is centred in the view and fills
   *  about three quarters of the shorter side. A few iterations settle the perspective. */
  const fit = () => {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const tanH = tanV * camera.aspect
    const dir = new THREE.Vector3(0.9, 0.62, 1.25).normalize()
    const target = new THREE.Vector3()
    let dist = radius / Math.min(tanV, tanH) / Math.cos(Math.atan(Math.min(tanV, tanH)))
    camera.near = radius / 500
    const p = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    for (let it = 0; it < 6 && samples.length; it++) {
      camera.position.copy(target).addScaledVector(dir, dist)
      camera.lookAt(target)
      camera.updateMatrixWorld(true)
      const inv = camera.matrixWorldInverse
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      let behind = false
      for (let i = 0; i < samples.length; i += 3) {
        p.set(samples[i], samples[i + 1], samples[i + 2]).applyMatrix4(inv)
        const z = -p.z
        if (z <= camera.near) {
          behind = true
          break
        }
        const x = p.x / z / tanH
        const y = p.y / z / tanV
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      if (behind) {
        dist *= 1.5
        continue
      }
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const extent = Math.max((x1 - x0) / 2, (y1 - y0) / 2)
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      up.setFromMatrixColumn(camera.matrixWorld, 1)
      target.addScaledVector(right, cx * tanH * dist).addScaledVector(up, cy * tanV * dist)
      if (extent > 0) dist *= Math.min(4, Math.max(0.25, extent / 0.75))
    }
    camera.position.copy(target).addScaledVector(dir, dist)
    camera.far = dist * 25 + radius * 4
    camera.updateProjectionMatrix()
    controls.target.copy(target)
    controls.minDistance = radius * 0.02
    controls.maxDistance = dist * 20
    controls.update()
  }

  // Background
  let picked: Backdrop = 'theme'
  try {
    const v = localStorage.getItem(BACKDROP_KEY)
    if (v === 'light' || v === 'dark' || v === 'theme') picked = v
  } catch {
    // storage unavailable: the choice lasts for this view only
  }
  function background(): THREE.Color {
    if (picked !== 'theme') return new THREE.Color(BACKDROP_COLOR[picked])
    const css = getComputedStyle(document.body).backgroundColor
    const c = new THREE.Color()
    try {
      const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(css)
      if (m) c.setRGB(+m[1] / 255, +m[2] / 255, +m[3] / 255, THREE.SRGBColorSpace)
      else c.set(ctx.theme() === 'light' ? '#ffffff' : '#0a0a0a')
    } catch {
      c.set(ctx.theme() === 'light' ? '#ffffff' : '#0a0a0a')
    }
    return c
  }
  const applyBackground = () => {
    scene.background = background()
    layoutHelpersOnly()
  }
  const layoutHelpersOnly = () => {
    centre.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(centre)
    rebuildHelpers(box.getSize(new THREE.Vector3()))
  }

  // Shading, wireframe
  const meshes: THREE.Mesh[] = []
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  const materials = () => {
    const out = new Set<THREE.Material>()
    for (const m of meshes) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) out.add(mat)
    return out
  }
  // Some exporters write no normals (FBX/COLLADA/3MF without them light as black): derive them.
  for (const m of meshes) {
    const g = m.geometry
    if (g?.getAttribute && g.getAttribute('position') && !g.getAttribute('normal')) {
      g.computeVertexNormals()
      if (!g.index) m.userData.unshared = true
    }
  }
  const hasUnshared = meshes.some((m) => m.userData.unshared)
  let flat = hasUnshared
  const setFlat = (on: boolean) => {
    flat = on
    for (const m of meshes) {
      if (m.userData.unshared && counts.triangles <= SMOOTH_LIMIT) {
        if (!on && !m.userData.smoothGeometry) {
          // Weld the facets' shared corners, then average normals across them.
          const stored = m.geometry
          const g = stored.clone()
          g.deleteAttribute('normal')
          const welded = THREE.mergeVertices(g, Math.max(1e-6, radius * 1e-6))
          g.dispose()
          welded.computeVertexNormals()
          m.userData.storedGeometry = stored
          m.userData.smoothGeometry = welded
        }
        if (m.userData.smoothGeometry) m.geometry = (on ? m.userData.storedGeometry : m.userData.smoothGeometry) as THREE.BufferGeometry
      }
    }
    for (const mat of materials()) {
      if ('flatShading' in mat) {
        ;(mat as THREE.MeshStandardMaterial).flatShading = on
        mat.needsUpdate = true
      }
    }
  }
  if (flat) setFlat(true)

  // Toolbar
  const toggle = (label: string, title: string, initial: boolean, onChange: (on: boolean) => void, compactHide = false) => {
    let on = initial
    const b = toolbar.button({
      label,
      title,
      onClick: () => {
        on = !on
        b.setAttribute('aria-pressed', String(on))
        onChange(on)
        draw()
      }
    })
    b.setAttribute('aria-pressed', String(on))
    if (compactHide) b.classList.add('fp-hide-compact')
    return b
  }
  toolbar.button({ label: '⤢', title: tr('화면에 맞추기 (카메라 초기화, F)', 'Fit to view (reset camera, F)'), onClick: () => (fit(), draw()) })
  toggle('▦', tr('와이어프레임', 'Wireframe'), false, (on) => {
    for (const mat of materials()) if ('wireframe' in mat) (mat as THREE.MeshStandardMaterial).wireframe = on
  })
  if (meshes.length) {
    toggle('◆', tr('평면 셰이딩 (끄면 부드럽게)', 'Flat shading (off = smooth)'), flat, (on) => setFlat(on))
  }
  toggle('#', tr('바닥 격자와 축', 'Grid and axes'), false, (on) => (helpers.visible = on))
  toggle('Z↑', tr('Z축을 위로 (CAD·3D 프린팅 좌표)', 'Z axis up (CAD / 3D printing coordinates)'), zUp, (on) => {
    zUp = on
    layout()
    fit()
  })
  let spinning = 0
  const spin = () => {
    drawing = true
    controls.update()
    drawing = false
    renderer.render(scene, camera)
    spinning = requestAnimationFrame(spin)
  }
  toggle('⟳', tr('자동 회전', 'Auto-rotate'), false, (on) => {
    controls.autoRotate = on
    cancelAnimationFrame(spinning)
    spinning = on ? requestAnimationFrame(spin) : 0
  }, true)
  disposers.push(() => cancelAnimationFrame(spinning))
  if (loaded.parts && loaded.parts.length > 1) {
    const panel = partsPanel(loaded.parts, tr, () => draw())
    stage.append(panel)
    toggle('☰', tr('부품 목록 (표시/숨기기)', 'Parts list (show/hide parts)'), false, (on) => {
      panel.style.display = on ? 'block' : 'none'
    })
  }
  {
    const help = helpPanel(kind, tr)
    stage.append(help)
    toggle('?', tr('도움말: 조작 방법', 'Help: controls'), false, (on) => {
      help.style.display = on ? 'block' : 'none'
    })
  }
  const select = toolbar.select(
    tr('배경', 'Background'),
    [
      { value: 'theme', label: tr('◐ 테마', '◐ Theme') },
      { value: 'light', label: tr('□ 밝게', '□ Light') },
      { value: 'dark', label: tr('■ 어둡게', '■ Dark') }
    ],
    (v) => {
      picked = v as Backdrop
      try {
        localStorage.setItem(BACKDROP_KEY, picked)
      } catch {
        // ignore
      }
      applyBackground()
      draw()
    }
  )
  select.value = picked
  ctx.onTheme(() => {
    if (picked !== 'theme') return
    // the shell's colours change with the theme class; read them after the style recalculates
    applyBackground()
    draw()
  })

  const info = [
    loaded.label ?? KIND_LABEL[kind],
    counts.triangles ? tr(`삼각형 ${formatCount(counts.triangles)}`, `${formatCount(counts.triangles)} triangles`) : tr('점·선만 있음', 'points/lines only'),
    tr(`정점 ${formatCount(counts.vertices)}`, `${formatCount(counts.vertices)} vertices`),
    ...(loaded.parts && loaded.parts.length > 1 ? [tr(`부품 ${formatCount(loaded.parts.length)}`, `${formatCount(loaded.parts.length)} parts`)] : []),
    loaded.units
      ? `${formatBox(storedSize)} ${loaded.units}`
      : tr(`${formatBox(storedSize)} (저장된 단위)`, `${formatBox(storedSize)} (units as stored)`),
    formatBytes(ctx.bytes.byteLength)
  ]
  toolbar.info(info.join(' · '))

  // Keyboard: F fits, arrow keys orbit (OrbitControls listens once the canvas has focus).
  controls.listenToKeyEvents(renderer.domElement)
  renderer.domElement.addEventListener(
    'keydown',
    (e) => {
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        fit()
        draw()
      }
    },
    { signal }
  )
  renderer.domElement.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault()
      console.warn('model3d: WebGL context lost')
    },
    { signal }
  )

  layout()
  resize()
  scene.background = background()
  fit()
  // First frame now, without waiting for an animation frame (hidden windows never get one).
  draw()
}

/** Up to `max` vertex positions of the model in world space, evenly strided, for framing. */
function samplePoints(root: THREE.Object3D, max: number): Float32Array {
  const objs: THREE.Object3D[] = []
  let total = 0
  root.traverse((o) => {
    const pos = ((o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined)?.getAttribute?.('position')
    if (pos && o.visible) {
      objs.push(o)
      total += pos.count
    }
  })
  const stride = Math.max(1, Math.ceil(total / max))
  const out: number[] = []
  const v = new THREE.Vector3()
  for (const o of objs) {
    const pos = ((o as THREE.Mesh).geometry as THREE.BufferGeometry).getAttribute('position')
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)
      if (Number.isFinite(v.x + v.y + v.z)) out.push(v.x, v.y, v.z)
    }
  }
  return Float32Array.from(out)
}

function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(x)))
  const m = x / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

/** Colours are stored linear: a relative luminance of 0.2 is about mid-grey on screen. */
function isDark(c: THREE.Color): boolean {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.2
}

// ---------------------------------------------------------------------------------------------
// CAD (STEP / IGES / BREP) through OpenCascade (occt-import-js) in a worker

const QUALITY_KEY = 'file-preview.model3d.cad-quality'

interface CadMesh {
  name: string
  position: Float32Array
  normal?: Float32Array
  index: Uint32Array
  color: [number, number, number] | null
  vcolor?: Float32Array
}
interface CadNode {
  name: string
  meshes: number[]
  children: CadNode[]
}

/** CAD files get a tessellation-quality picker; changing it tessellates again in place. */
async function renderCad(ctx: PreviewContext, kind: ModelKind): Promise<() => void> {
  const { tr } = ctx
  let quality: CadQuality = 'normal'
  try {
    const v = localStorage.getItem(QUALITY_KEY)
    if (v === 'coarse' || v === 'normal' || v === 'fine') quality = v
  } catch {
    // storage unavailable
  }
  let current: (() => void) | null = null
  let busy = false
  const select = ctx.toolbar.select(
    tr('테셀레이션 품질 (곡면을 삼각형으로 나누는 정밀도)', 'Tessellation quality (how finely curved faces are triangulated)'),
    [
      { value: 'coarse', label: tr('◇ 거칠게', '◇ Coarse') },
      { value: 'normal', label: tr('◈ 보통', '◈ Normal') },
      { value: 'fine', label: tr('◆ 정밀', '◆ Fine') }
    ],
    (v) => {
      if (busy) {
        select.value = quality
        return
      }
      quality = v as CadQuality
      try {
        localStorage.setItem(QUALITY_KEY, quality)
      } catch {
        // ignore
      }
      busy = true
      current?.()
      current = null
      showLoading(ctx.root, tr('다시 테셀레이션하는 중…', 'Tessellating again…'))
      mountChild(quality)
        .then((d) => {
          current = d
        })
        .catch((err: Error) => {
          if (ctx.signal.aborted) return
          showMessage(
            ctx.root,
            tr('미리보기를 표시할 수 없습니다', 'Cannot preview this file'),
            err instanceof PreviewError ? (err.hint ?? err.message) : String(err?.message ?? err)
          )
        })
        .finally(() => {
          busy = false
        })
    }
  )
  select.value = quality

  /** One viewer with its own abort signal and toolbar buttons, removed again on re-tessellation. */
  async function mountChild(q: CadQuality): Promise<() => void> {
    const child = new AbortController()
    const onParent = () => child.abort()
    ctx.signal.addEventListener('abort', onParent, { once: true })
    const created: HTMLElement[] = []
    const toolbar: PreviewContext['toolbar'] = {
      ...ctx.toolbar,
      button: (spec) => {
        const b = ctx.toolbar.button(spec)
        created.push(b)
        return b
      },
      select: (title, options, onChange) => {
        const e = ctx.toolbar.select(title, options, onChange)
        created.push(e)
        return e
      }
    }
    const c: PreviewContext = {
      ...ctx,
      toolbar,
      signal: child.signal,
      onTheme: (l) =>
        ctx.onTheme((t) => {
          if (!child.signal.aborted) l(t)
        })
    }
    const cleanup = () => {
      child.abort()
      for (const e of created) e.remove()
      ctx.signal.removeEventListener('abort', onParent)
    }
    try {
      const dispose = await mount(c, kind, q)
      return () => {
        dispose()
        cleanup()
      }
    } catch (err) {
      cleanup()
      throw err
    }
  }

  current = await mountChild(quality)
  return () => current?.()
}

function setProgress(root: HTMLElement, text: string): void {
  const line = root.querySelector('.fp-state[role="status"] > div:last-child')
  if (line) line.textContent = text
}

async function loadCad(kind: ModelKind, ctx: PreviewContext, quality: CadQuality): Promise<Loaded> {
  const { tr, signal } = ctx
  const buffer = copyBuffer(ctx.bytes)
  const format = kind === 'step' ? 'step' : kind === 'iges' ? 'iges' : 'brep'
  const base = new URL('../../vendor/occt/', import.meta.url).href
  const limit = cadTimeLimitMs(ctx.bytes.byteLength)
  const engineError = () =>
    new PreviewError('cad-engine', tr('CAD 엔진(OpenCascade)을 시작할 수 없습니다.', 'The CAD engine (OpenCascade) could not be started.'))
  let worker: Worker
  try {
    worker = new Worker(new URL('./model3d/occt-worker.js', import.meta.url))
  } catch (err) {
    console.warn('model3d: CAD worker unavailable', err)
    throw engineError()
  }
  const started = Date.now()
  let phase = tr('CAD 엔진(OpenCascade) 불러오는 중', 'Loading the CAD engine (OpenCascade)')
  const show = () => setProgress(ctx.root, `${phase}… ${Math.round((Date.now() - started) / 1000)} s`)
  show()
  const ticker = setInterval(show, 1000)
  const result = await new Promise<{ meshes: CadMesh[]; root: CadNode; stats: { engineMs: number; readMs: number } }>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(ticker)
      signal.removeEventListener('abort', onAbort)
      worker.terminate()
      fn()
    }
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new PreviewError(
              'cad-timeout',
              tr(
                `이 CAD 파일은 ${Math.round(limit / 1000)}초 안에 읽지 못했습니다. 너무 복잡하거나 손상되었을 수 있습니다. 품질을 '거칠게'로 바꾸면 더 빨라질 수 있습니다.`,
                `This CAD file could not be read within ${Math.round(limit / 1000)} s. It may be too complex or damaged; the Coarse quality setting is faster.`
              )
            )
          )
        ),
      limit
    )
    const onAbort = () => finish(() => reject(new DOMException('aborted', 'AbortError')))
    signal.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d.progress) {
        phase =
          d.progress === 'reading'
            ? tr('B-rep을 읽고 삼각형으로 나누는 중 (큰 파일은 시간이 걸립니다)', 'Reading the B-rep and triangulating it (large files take a while)')
            : d.progress === 'converting'
              ? tr('화면에 올리는 중', 'Preparing the view')
              : phase
        show()
        return
      }
      finish(() => {
        if (d.ok) resolve(d)
        else {
          console.warn('model3d: CAD', d.message)
          const msg = String(d.message)
          reject(
            // OpenCascade runs in 32-bit WebAssembly (at most 4 GB): very large STEP files run out of it.
            // OpenCascade catches its own allocation failures and only reports that it could not read
            // the file, so a read failure on a very large file is taken as memory exhaustion.
            /out of memory|OOM|memory access out of bounds|allocation failed|Cannot enlarge memory|Aborted\(/i.test(msg) ||
              (/could not read/i.test(msg) && ctx.bytes.byteLength > 150 * 1024 * 1024)
              ? new PreviewError(
                  'cad-memory',
                  tr(
                    `이 ${KIND_LABEL[kind]} 파일은 CAD 엔진(OpenCascade, WebAssembly 최대 4 GB)의 메모리에 다 올라가지 않습니다 (${formatBytes(ctx.bytes.byteLength)}). 대략 200 MB 이하의 STEP 파일까지 실용적으로 열 수 있습니다. 어셈블리를 나누거나 단순화해서 내보내 보세요.`,
                    `This ${KIND_LABEL[kind]} file does not fit in the CAD engine's memory (OpenCascade, WebAssembly, 4 GB at most; ${formatBytes(ctx.bytes.byteLength)}). STEP files up to roughly 200 MB open; try exporting the assembly in parts or simplified.`
                  )
                )
              : /engine|wasm|WebAssembly|importScripts|fetch/i.test(msg)
              ? engineError()
              : new PreviewError(
                  'cad-read',
                  tr(
                    `${KIND_LABEL[kind]} 파일을 읽을 수 없습니다. 손상되었거나 지원하지 않는 변형입니다 (도형이 없는 파일일 수도 있습니다).`,
                    `Cannot read this ${KIND_LABEL[kind]} file. It is damaged, uses an unsupported variant, or holds no shapes.`
                  )
                )
          )
        }
      })
    }
    worker.onerror = (e) => {
      e.preventDefault()
      console.warn('model3d: CAD worker error', e.message)
      // out of memory, or the engine failed to load
      finish(() => reject(engineError()))
    }
    worker.postMessage({ format, buffer, params: cadParams(quality), base }, [buffer])
  })
  console.info(`model3d: ${KIND_LABEL[kind]} engine ${result.stats.engineMs} ms, read+tessellate ${result.stats.readMs} ms (${quality})`)
  const built = buildCad(result.meshes, result.root, tr)
  return { object: built.object, notes: [], units: kind === 'brep' ? undefined : 'mm', parts: built.parts }
}

function buildCad(
  meshes: CadMesh[],
  root: CadNode,
  tr: PreviewContext['tr']
): { object: THREE.Object3D; parts: { name: string; object: THREE.Object3D }[] } {
  const made = meshes.map((m) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3))
    if (m.normal) g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3))
    if (m.vcolor) g.setAttribute('color', new THREE.BufferAttribute(m.vcolor, 3))
    g.setIndex(new THREE.BufferAttribute(m.index, 1))
    if (!m.normal) g.computeVertexNormals()
    const color = new THREE.Color(0xb4bac4)
    if (m.vcolor) color.set(0xffffff)
    else if (m.color) color.setRGB(m.color[0], m.color[1], m.color[2], THREE.SRGBColorSpace)
    const mat = new THREE.MeshStandardMaterial({ color, vertexColors: !!m.vcolor, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(g, mat)
    mesh.name = m.name
    return mesh
  })
  const used = new Set<number>()
  const parts: { name: string; object: THREE.Object3D }[] = []
  const partName = (n: string) => n || tr(`부품 ${parts.length + 1}`, `Part ${parts.length + 1}`)
  const build = (n: CadNode, depth: number): THREE.Object3D => {
    const group = new THREE.Group()
    group.name = n.name
    for (const i of n.meshes) {
      const src = made[i]
      if (!src) continue
      // a mesh referenced twice gets a second object that shares its geometry and material
      const obj = used.has(i) ? new THREE.Mesh(src.geometry, src.material) : src
      used.add(i)
      group.add(obj)
    }
    if (n.meshes.length) parts.push({ name: partName(n.name || made[n.meshes[0]]?.name || ''), object: group })
    if (depth < 64) for (const c of n.children) group.add(build(c, depth + 1))
    return group
  }
  const object = build(root, 0)
  // meshes no node referenced still belong to the model
  made.forEach((m, i) => {
    if (!used.has(i)) {
      object.add(m)
      parts.push({ name: partName(m.name), object: m })
    }
  })
  return { object, parts }
}

const PANEL_CSS =
  'position:absolute;top:8px;right:8px;display:none;max-width:min(320px,calc(100% - 16px));max-height:calc(100% - 16px);overflow:auto;box-sizing:border-box;' +
  'padding:6px 8px;border-radius:var(--orca-radius,6px);font-size:12px;line-height:1.5;z-index:2;' +
  'background:var(--orca-popover,var(--orca-card,#fff));color:var(--orca-popover-foreground,var(--orca-foreground,#111));' +
  'border:1px solid var(--orca-border,#ddd);box-shadow:0 2px 8px rgba(0,0,0,.25)'

/** A list of the model's parts with a visibility checkbox each (and one for all). */
function partsPanel(parts: { name: string; object: THREE.Object3D }[], tr: PreviewContext['tr'], redraw: () => void): HTMLElement {
  const MAX = 500
  const panel = h('div', 'fp-3d-parts')
  panel.style.cssText = PANEL_CSS
  panel.setAttribute('role', 'group')
  panel.setAttribute('aria-label', tr('부품 목록', 'Parts'))
  const row = (label: string, checked: boolean, onChange: (on: boolean) => void) => {
    const l = h('label')
    l.style.cssText = 'display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer'
    const box = h('input')
    box.type = 'checkbox'
    box.checked = checked
    box.addEventListener('change', () => onChange(box.checked))
    l.append(box, h('span', undefined, label))
    l.title = label
    return { l, box }
  }
  const boxes: HTMLInputElement[] = []
  const all = row(tr(`전체 (${parts.length})`, `All (${parts.length})`), true, (on) => {
    for (const p of parts) p.object.visible = on
    for (const b of boxes) b.checked = on
    redraw()
  })
  all.l.style.fontWeight = '600'
  panel.append(all.l)
  for (const p of parts.slice(0, MAX)) {
    const r = row(p.name, true, (on) => {
      p.object.visible = on
      redraw()
    })
    boxes.push(r.box)
    panel.append(r.l)
  }
  if (parts.length > MAX) panel.append(h('div', undefined, tr(`… 외 ${parts.length - MAX}개`, `… and ${parts.length - MAX} more`)))
  return panel
}

/** Controls and the Source-view note (Orca opens text-looking files in its Source view first). */
function helpPanel(kind: ModelKind, tr: PreviewContext['tr']): HTMLElement {
  const panel = h('div', 'fp-3d-help')
  panel.style.cssText = PANEL_CSS
  const lines = [
    tr('왼쪽 드래그 / 한 손가락: 회전', 'Left drag / one finger: orbit'),
    tr('오른쪽 드래그 · Shift+드래그 / 두 손가락: 이동', 'Right drag, Shift+drag / two fingers: pan'),
    tr('휠 / 핀치: 확대·축소 (커서 쪽으로)', 'Wheel / pinch: zoom (towards the cursor)'),
    tr('F: 화면에 맞추기 · 화살표 키: 회전', 'F: fit to view · arrow keys: orbit'),
    CAD_KINDS.has(kind) && kind !== 'brep'
      ? tr('크기는 mm로 변환해 표시합니다', 'Sizes are converted to millimetres')
      : tr('크기는 파일에 저장된 단위 그대로입니다', 'Sizes are in the units stored in the file')
  ]
  const textLike = CAD_KINDS.has(kind) || ['obj', 'stl-ascii', 'off', 'gltf', 'dae', 'fbx-ascii'].includes(kind)
  if (textLike) {
    lines.push(
      tr(
        'Orca는 텍스트로 된 파일(STEP·IGES·BREP 등)을 먼저 소스 보기로 엽니다. 탭 오른쪽 위의 보기 전환 버튼으로 이 미리보기로 바꿀 수 있습니다.',
        "Orca opens text-based files (STEP, IGES, BREP, …) in its Source view first: switch to this preview with the view toggle at the tab's top right."
      )
    )
  }
  for (const t of lines) panel.append(h('div', undefined, '• ' + t))
  return panel
}
