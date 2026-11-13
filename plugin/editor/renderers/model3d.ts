/** 3D models (.stl .obj .ply .glb .gltf .3mf .off .fbx .dae): three.js (MIT) loaders, WebGL, orbit
 *  controls (mouse and touch). Geometry-only formats parse in a Web Worker; glTF/3MF/FBX/COLLADA
 *  parse on the main thread after a yield. Draws only when something changes, and once without
 *  requestAnimationFrame so a hidden window still shows the model. The frame has no network: only
 *  data:/blob: resources load; external textures, .mtl and .bin files are reported, not fetched. */
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { h } from '../core/ui.ts'
import * as THREE from '../../vendor/three.js'
import {
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
}

export async function render(ctx: PreviewContext): Promise<() => void> {
  const { bytes, tr, signal, toolbar } = ctx
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
    const loaded = await load(kind, ctx)
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

async function load(kind: ModelKind, ctx: PreviewContext): Promise<Loaded> {
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
  stage.append(h('style', undefined, STYLE), renderer.domElement)
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute('role', 'img')
  renderer.domElement.setAttribute('aria-label', tr(`3D 모델 미리보기 (${KIND_LABEL[kind]})`, `3D model preview (${KIND_LABEL[kind]})`))
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

  let zUp = defaultZUp(kind)
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
  }

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
  disposers.push(() => controls.dispose())

  // Size
  let width = 0
  let height = 0
  const resize = () => {
    const w = Math.max(1, root.clientWidth || 300)
    const hgt = Math.max(1, root.clientHeight || 300)
    if (w === width && hgt === height) return false
    width = w
    height = hgt
    // Huge meshes: cap the pixel ratio so a phone's 3× screen does not triple the fill cost.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, counts.triangles > 2_000_000 ? 1.5 : 2))
    renderer.setSize(w, hgt, false)
    camera.aspect = w / hgt
    camera.updateProjectionMatrix()
    return true
  }
  const ro = new ResizeObserver(() => {
    if (resize()) draw()
  })
  ro.observe(root)
  disposers.push(() => ro.disconnect())

  const fit = () => {
    const vfov = THREE.MathUtils.degToRad(camera.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect)
    // the bounding sphere is loose for most shapes: a slightly closer camera still keeps everything in view
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.95
    const dir = new THREE.Vector3(0.9, 0.62, 1.25).normalize()
    camera.position.copy(dir.multiplyScalar(dist))
    camera.near = Math.max(dist / 1000, radius / 1000)
    camera.far = dist * 100
    camera.updateProjectionMatrix()
    controls.target.set(0, 0, 0)
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
    KIND_LABEL[kind],
    counts.triangles ? tr(`삼각형 ${formatCount(counts.triangles)}`, `${formatCount(counts.triangles)} triangles`) : tr('점·선만 있음', 'points/lines only'),
    tr(`정점 ${formatCount(counts.vertices)}`, `${formatCount(counts.vertices)} vertices`),
    tr(`${formatBox(storedSize)} (저장된 단위)`, `${formatBox(storedSize)} (units as stored)`),
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
