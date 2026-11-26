/** Robot descriptions (.urdf, .xacro, .urdf.xacro): the kinematic tree drawn in 3D with three.js.
 *  xacro files are expanded by the preview's own processor (urdf/xacro.ts, no eval). Primitive
 *  geometry (box, cylinder, sphere, capsule) is drawn; meshes are external files the preview cannot
 *  read, so each is drawn as a translucent placeholder and listed. A side panel lists links and
 *  joints, moves joints with sliders (mimic joints follow) and shows notes; toolbar toggles show
 *  visual/collision geometry, link frames and joint axes. */
import { formatBytes } from '../core/i18n.ts'
import { decodeText } from '../core/encoding.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { h } from '../core/ui.ts'
import * as THREE from '../../vendor/three.js'
import { BACKDROP_COLOR, type Backdrop, createRenderer, frameCamera, isDark, niceStep, samplePoints } from './model3d.ts'
import { fileLabel, LoadError, loadRobot, type Loaded } from './urdf/load.ts'
import { homePosition, isMovable, jointRange, resolvePositions, type Geometry, type Joint, type Material, type Robot, type Shape } from './urdf/model.ts'
import type { Note } from './urdf/xacro.ts'

const MAX_BYTES = 30 * 1024 * 1024
const BACKDROP_KEY = 'file-preview.backdrop.urdf'
/** Above this many placeholders, labels show only for the selected link. */
const MAX_LABELS = 40

const STYLE = `
.fp-urdf { position: absolute; inset: 0; display: flex; overflow: hidden; }
.fp-urdf-stage { position: relative; flex: 1 1 auto; min-width: 0; overflow: hidden; }
.fp-urdf-stage > canvas { display: block; touch-action: none; outline: none; cursor: grab; }
.fp-urdf-stage > canvas:active { cursor: grabbing; }
.fp-urdf-banner { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px); box-sizing: border-box;
  padding: 4px 8px; border-radius: var(--orca-radius, 6px); font-size: 12px; pointer-events: none;
  background: color-mix(in srgb, var(--orca-card, #fafafa) 88%, transparent); color: var(--orca-muted-foreground, #666);
  border: 1px solid var(--orca-border, #ddd); }
.fp-urdf-label { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); pointer-events: none; white-space: nowrap;
  font-size: 11px; padding: 1px 5px; border-radius: 4px; background: rgba(20, 20, 24, .72); color: #fff; }
.fp-urdf-label.sel { background: #2f6bff; }
.fp-urdf-panel { flex: 0 0 300px; width: 300px; box-sizing: border-box; overflow: auto; border-left: 1px solid var(--orca-border, #ddd);
  background: var(--orca-card, #fafafa); color: var(--orca-card-foreground, inherit); font-size: 12px; padding: 0 0 12px; }
.fp-urdf-panel h3 { font-size: 12px; margin: 0; padding: 8px 10px 4px; position: sticky; top: 0; z-index: 1;
  background: var(--orca-card, #fafafa); color: var(--orca-muted-foreground, #666); font-weight: 600; text-transform: uppercase; letter-spacing: .03em;
  display: flex; align-items: center; gap: 6px; }
.fp-urdf-panel h3 button { margin-left: auto; text-transform: none; font: inherit; font-weight: 400; letter-spacing: 0; cursor: pointer;
  color: var(--orca-secondary-foreground, inherit); background: var(--orca-secondary, #eee); border: 1px solid var(--orca-border, #ccc);
  border-radius: var(--orca-radius, 6px); padding: 1px 8px; }
.fp-urdf-joint { display: grid; grid-template-columns: 1fr auto; gap: 0 6px; padding: 3px 10px; align-items: center; }
.fp-urdf-joint .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-urdf-joint .v { font-variant-numeric: tabular-nums; color: var(--orca-muted-foreground, #666); }
.fp-urdf-joint input { grid-column: 1 / 3; width: 100%; margin: 0; }
.fp-urdf-joint.mimic .n { color: var(--orca-muted-foreground, #666); }
.fp-urdf-joint.sel { background: color-mix(in srgb, #2f6bff 14%, transparent); }
.fp-urdf-tree { list-style: none; margin: 0; padding: 0 0 4px; }
.fp-urdf-tree li { padding: 2px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.fp-urdf-tree li:hover { background: var(--orca-accent, #e4e4e4); }
.fp-urdf-tree li.joint { color: var(--orca-muted-foreground, #666); }
.fp-urdf-tree li.sel { background: #2f6bff; color: #fff; }
.fp-urdf-tree .t { font-size: 10px; opacity: .75; margin-left: 4px; }
.fp-urdf-list { margin: 0; padding: 0 10px 4px 26px; }
.fp-urdf-list li { margin: 2px 0; word-break: break-all; }
.fp-urdf-list li.error { color: var(--orca-destructive, #c62828); }
.fp-urdf-list li .k { color: var(--orca-muted-foreground, #666); }
.fp-urdf-detail { padding: 2px 10px 6px; color: var(--orca-muted-foreground, #666); word-break: break-word; }
.fp-urdf-detail b { color: var(--orca-foreground, inherit); font-weight: 600; }
@media (max-width: 600px) {
  .fp-urdf-panel { position: absolute; right: 0; top: 0; bottom: 0; width: min(320px, 88%); z-index: 2; box-shadow: -2px 0 8px rgba(0,0,0,.25); }
}
`

export async function render(ctx: PreviewContext): Promise<() => void> {
  const { tr } = ctx
  if (ctx.bytes.byteLength > MAX_BYTES) {
    throw new PreviewError('too-large', tr(`파일이 너무 큽니다 (${formatBytes(ctx.bytes.byteLength)}).`, `This file is too large (${formatBytes(ctx.bytes.byteLength)}).`))
  }
  const { text } = decodeText(ctx.bytes)
  let loaded: Loaded
  try {
    loaded = loadRobot(text, ctx.fileType)
  } catch (e) {
    if (e instanceof LoadError) throw new PreviewError(e.code, errorHint(e, ctx))
    throw e
  }
  if (!loaded.robot.links.length) return showLibrary(ctx, loaded)
  return mount(ctx, loaded)
}

/** A xacro file without links of its own (a macro library, or a top-level file whose robot comes
 *  from includes): list what it defines and what it would include, instead of an empty 3D view. */
function showLibrary(ctx: PreviewContext, loaded: Loaded): () => void {
  const { tr, root } = ctx
  const x = loaded.xacro!
  root.replaceChildren()
  const page = h('div', 'fp-urdf-lib')
  page.style.cssText = 'max-width:760px;margin:0 auto;padding:16px;box-sizing:border-box'
  const style = h(
    'style',
    undefined,
    `.fp-urdf-lib h2{font-size:15px;margin:0 0 6px}.fp-urdf-lib h3{font-size:12px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.03em;color:var(--orca-muted-foreground,#666)}
.fp-urdf-lib p{margin:0 0 8px;color:var(--orca-muted-foreground,#666)}.fp-urdf-lib ul{margin:0;padding-left:20px}.fp-urdf-lib li{margin:3px 0;word-break:break-word}
.fp-urdf-lib code{font-family:ui-monospace,Consolas,monospace;font-size:12px}.fp-urdf-lib .k{color:var(--orca-muted-foreground,#666)}.fp-urdf-lib li.error{color:var(--orca-destructive,#c62828)}`
  )
  page.append(style, h('h2', undefined, tr(`xacro: ${loaded.robot.name || '(이름 없음)'}`, `xacro: ${loaded.robot.name || '(unnamed)'}`)))
  page.append(
    h(
      'p',
      undefined,
      x.includes.length
        ? tr(
            '이 파일만으로는 그릴 링크가 없습니다. 로봇은 include하는 다른 파일의 매크로로 만들어지는데, 미리보기는 열린 파일만 받으므로 그 파일들을 읽을 수 없습니다.',
            'This file has no links of its own: the robot is built by macros from the files it includes, and the preview only receives the opened file, so it cannot read them.'
          )
        : tr('이 파일은 링크 없이 매크로만 정의합니다 (다른 xacro 파일이 호출하는 라이브러리).', 'This file defines macros but no links: a library that other xacro files call.')
    )
  )
  const list = (title: string, items: { key?: string; text: string; cls?: string; code?: boolean }[]) => {
    if (!items.length) return
    page.append(h('h3', undefined, title))
    const ul = h('ul')
    for (const it of items) {
      const li = h('li', it.cls)
      if (it.key) li.append(h('span', 'k', it.key + ' '))
      li.append(it.code === false ? document.createTextNode(it.text) : h('code', undefined, it.text))
      ul.append(li)
    }
    page.append(ul)
  }
  list(tr(`정의된 매크로 ${x.macros.length}`, `Macros defined ${x.macros.length}`), x.macros.map((m) => ({ key: tr(`${m.line}행`, `line ${m.line}`), text: `xacro:${m.name}${m.params ? `  ${m.params}` : ''}` })))
  list(tr(`읽지 못한 include ${x.includes.length}`, `Includes not loaded ${x.includes.length}`), x.includes.map((i) => ({ key: tr(`${i.line}행`, `line ${i.line}`), text: i.filename })))
  list(tr('해석하지 못한 매크로 호출', 'Unresolved macro calls'), x.unresolvedMacros.map((m) => ({ text: `xacro:${m}` })))
  list(tr('인자', 'Args'), Object.entries(x.args).map(([k, v]) => ({ text: `${k} = ${v}` })))
  const notes = [...x.notes, ...loaded.robot.notes].filter((n) => !/unresolved macro|<robot> has no name/.test(n.message))
  list(tr(`알림 ${notes.length}`, `Notes ${notes.length}`), notes.map((n) => ({ key: n.line ? tr(`${n.line}행`, `line ${n.line}`) : undefined, text: n.message, cls: n.level, code: false })))
  root.append(page)
  ctx.toolbar.info(['xacro', tr(`매크로 ${x.macros.length}`, `${x.macros.length} macros`), tr(`include ${x.includes.length}`, `${x.includes.length} includes`), tr('링크 없음', 'no links'), formatBytes(ctx.bytes.byteLength)].join(' · '))
  return () => {}
}

function errorHint(e: LoadError, ctx: PreviewContext): string {
  const { tr } = ctx
  const at = e.line ? tr(` (${e.line}행)`, ` (line ${e.line})`) : ''
  switch (e.code) {
    case 'urdf-xml':
    case 'xacro-xml':
      return tr(`XML 형식이 올바르지 않습니다: ${e.message}`, `The XML is not well-formed: ${e.message}`)
    case 'xacro-recursion': {
      const name = /xacro:[\w.-]+/.exec(e.message)?.[0] ?? 'xacro'
      return tr(
        `xacro 매크로 호출이 100단계보다 깊어져 멈췄습니다${at}: ${name} 매크로가 끝없이 자기 자신을 부르는 것 같습니다.`,
        `xacro macro calls nest deeper than 100 levels${at}: ${name} seems to call itself without end.`
      )
    }
    case 'xacro-too-large':
      return tr(`xacro를 펼친 결과가 너무 큽니다${at} (요소 20만 개 초과).`, `The expanded xacro is too large${at}: ${e.message}.`)
    case 'urdf-root':
      return tr(`로봇 설명(URDF)이 아닙니다: ${e.message}.`, `This is not a robot description (URDF): ${e.message}.`)
    case 'urdf-empty':
      return tr('로봇에 링크가 없습니다.', 'The robot has no links.')
  }
  return e.message
}

// ---------------------------------------------------------------------------------------------
// Scene

interface LinkView {
  name: string
  group: THREE.Group
  visual: THREE.Group
  collision: THREE.Group
  axes: THREE.AxesHelper
  /** Materials to tint when selected. */
  materials: THREE.MeshStandardMaterial[]
  labels: { el: HTMLElement; anchor: THREE.Object3D }[]
  treeRow?: HTMLElement
}
interface JointView {
  joint: Joint
  motion: THREE.Group
  axis?: THREE.Group
  slider?: HTMLInputElement
  value?: HTMLElement
  row?: HTMLElement
}

const COLLISION_COLOR = 0xc04cff
const PLACEHOLDER_COLOR = 0x8a94a6

function mount(ctx: PreviewContext, loaded: Loaded): () => void {
  const { root, tr, toolbar, signal } = ctx
  const { robot } = loaded
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

  root.replaceChildren()
  root.style.overflow = 'hidden'
  const wrap = h('div', 'fp-urdf')
  wrap.style.cssText = 'position:absolute;inset:0;display:flex;overflow:hidden'
  const stage = h('div', 'fp-urdf-stage')
  stage.style.cssText = 'position:relative;flex:1 1 auto;min-width:0;overflow:hidden'
  const canvas = renderer.domElement
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none'
  canvas.tabIndex = 0
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', tr(`로봇 3D 미리보기: ${robot.name}`, `3D robot preview: ${robot.name}`))
  const labelLayer = h('div')
  labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'
  stage.append(canvas, labelLayer)
  const panel = h('div', 'fp-urdf-panel')
  panel.setAttribute('role', 'complementary')
  panel.setAttribute('aria-label', tr('링크와 조인트', 'Links and joints'))
  wrap.append(h('style', undefined, STYLE), stage, panel)
  root.append(wrap)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1000)
  scene.add(camera)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = new THREE.RoomEnvironment()
  const env = pmrem.fromScene(room, 0.04).texture
  room.dispose?.()
  pmrem.dispose()
  scene.environment = env
  scene.environmentIntensity = 0.45
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.1))
  const head = new THREE.DirectionalLight(0xffffff, 1.5)
  head.position.set(0.4, 0.6, 1)
  camera.add(head)
  disposers.push(() => env.dispose())

  // ROS is Z-up: turn the robot so its Z points up the screen.
  const world = new THREE.Group()
  world.rotation.x = -Math.PI / 2
  scene.add(world)

  // Sizes for frames, markers and axes come from the robot's own scale.
  const scale = robotScale(robot)
  const frameSize = Math.max(scale * 0.08, 0.01)
  const markerSize = Math.max(scale * 0.05, 0.01)

  const geomCache = new Map<string, THREE.BufferGeometry>()
  const geometryFor = (g: Exclude<Geometry, { type: 'mesh' }>): THREE.BufferGeometry => {
    const key = JSON.stringify(g)
    let geo = geomCache.get(key)
    if (geo) return geo
    switch (g.type) {
      case 'box':
        geo = new THREE.BoxGeometry(g.size[0] || 1e-6, g.size[1] || 1e-6, g.size[2] || 1e-6)
        break
      case 'sphere':
        geo = new THREE.SphereGeometry(g.radius || 1e-6, 32, 16)
        break
      case 'cylinder':
        geo = new THREE.CylinderGeometry(g.radius || 1e-6, g.radius || 1e-6, g.length || 1e-6, 32)
        geo.rotateX(Math.PI / 2)
        break
      case 'capsule':
        geo = new THREE.CapsuleGeometry(g.radius || 1e-6, g.length, 8, 24)
        geo.rotateX(Math.PI / 2)
        break
    }
    geomCache.set(key, geo)
    return geo
  }
  const markerGeo = new THREE.BoxGeometry(markerSize, markerSize, markerSize)
  disposers.push(() => {
    for (const g of geomCache.values()) g.dispose()
    markerGeo.dispose()
  })
  const allMaterials: THREE.Material[] = []
  disposers.push(() => {
    for (const m of allMaterials) m.dispose()
  })
  const surface = (mat: Material | undefined, opts: { placeholder?: boolean; collision?: boolean } = {}): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 })
    if (opts.collision) {
      m.color.setHex(COLLISION_COLOR)
      m.transparent = true
      m.opacity = 0.35
      m.depthWrite = false
    } else if (mat?.rgba) {
      m.color.setRGB(mat.rgba[0], mat.rgba[1], mat.rgba[2], THREE.SRGBColorSpace)
      if (mat.rgba[3] < 1) {
        m.transparent = true
        m.opacity = mat.rgba[3]
        m.depthWrite = mat.rgba[3] > 0.9
      }
    } else {
      m.color.setHex(opts.placeholder ? PLACEHOLDER_COLOR : 0xb8bcc4)
    }
    if (opts.placeholder) {
      m.transparent = true
      m.opacity = Math.min(m.opacity, 0.45)
      m.depthWrite = false
    }
    allMaterials.push(m)
    return m
  }
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x5b6474, transparent: true, opacity: 0.9 })
  allMaterials.push(edgeMat)
  const edgeCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>()
  disposers.push(() => {
    for (const g of edgeCache.values()) g.dispose()
  })
  const edgesOf = (geo: THREE.BufferGeometry) => {
    let e = edgeCache.get(geo)
    if (!e) {
      e = new THREE.EdgesGeometry(geo, 30)
      edgeCache.set(geo, e)
    }
    return e
  }
  const place = (obj: THREE.Object3D, s: Shape) => {
    obj.position.set(s.origin.xyz[0], s.origin.xyz[1], s.origin.xyz[2])
    obj.rotation.set(s.origin.rpy[0], s.origin.rpy[1], s.origin.rpy[2], 'ZYX')
  }

  // Links
  const links: LinkView[] = robot.links.map((l, k) => {
    const group = new THREE.Group()
    group.name = l.name
    group.userData.link = k
    const visual = new THREE.Group()
    const collision = new THREE.Group()
    collision.visible = false
    const axes = new THREE.AxesHelper(frameSize)
    axes.visible = false
    ;(axes.material as THREE.Material).depthTest = false
    axes.renderOrder = 2
    group.add(visual, collision, axes)
    const view: LinkView = { name: l.name, group, visual, collision, axes, materials: [], labels: [] }
    const primitiveCollisions = l.collisions.filter((c) => c.geometry.type !== 'mesh')
    for (const s of l.visuals) {
      if (s.geometry.type === 'mesh') {
        // Placeholder: the link's primitive collision shapes when there are any, else a marker.
        const holder = new THREE.Group()
        const mat = surface(s.material, { placeholder: true })
        view.materials.push(mat)
        const shapes = primitiveCollisions.length ? primitiveCollisions : null
        if (shapes) {
          for (const c of shapes) {
            const geo = geometryFor(c.geometry as Exclude<Geometry, { type: 'mesh' }>)
            const mesh = new THREE.Mesh(geo, mat)
            place(mesh, c)
            mesh.userData.link = k
            const edges = new THREE.LineSegments(edgesOf(geo), edgeMat)
            place(edges, c)
            holder.add(mesh, edges)
          }
        } else {
          const mesh = new THREE.Mesh(markerGeo, mat)
          place(mesh, s)
          mesh.userData.link = k
          const edges = new THREE.LineSegments(edgesOf(markerGeo), edgeMat)
          place(edges, s)
          holder.add(mesh, edges)
        }
        holder.userData.placeholder = true
        visual.add(holder)
        const anchor = new THREE.Object3D()
        place(anchor, shapes ? shapes[0] : s)
        visual.add(anchor)
        const el = h('div', 'fp-urdf-label', fileLabel(s.geometry.filename) || tr('메시', 'mesh'))
        el.title = s.geometry.filename
        labelLayer.append(el)
        view.labels.push({ el, anchor })
        continue
      }
      const mat = surface(s.material)
      view.materials.push(mat)
      const mesh = new THREE.Mesh(geometryFor(s.geometry), mat)
      place(mesh, s)
      mesh.userData.link = k
      visual.add(mesh)
    }
    for (const s of l.collisions) {
      const mat = surface(undefined, { collision: true })
      view.materials.push(mat)
      const geo = s.geometry.type === 'mesh' ? markerGeo : geometryFor(s.geometry)
      const mesh = new THREE.Mesh(geo, mat)
      place(mesh, s)
      mesh.userData.link = k
      collision.add(mesh)
    }
    return view
  })

  let showGrid = true
  let showFrames = false
  let showLabels = true
  let selected = -1
  const labelCount = links.reduce((n, l) => n + l.labels.length, 0)

  // Joints: origin frame → motion → child link
  const jointViews: JointView[] = robot.joints.map((j) => ({ joint: j, motion: new THREE.Group() }))
  const axisMat = new THREE.MeshBasicMaterial({ color: 0xffc400, depthTest: false })
  const axisLineMat = new THREE.LineBasicMaterial({ color: 0xffc400, depthTest: false })
  allMaterials.push(axisMat, axisLineMat)
  const coneGeo = new THREE.ConeGeometry(frameSize * 0.12, frameSize * 0.35, 12)
  coneGeo.translate(0, frameSize * 1.5, 0)
  const shaftGeo = new THREE.BufferGeometry()
  shaftGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, -frameSize * 0.6, 0, 0, frameSize * 1.5, 0], 3))
  disposers.push(() => {
    coneGeo.dispose()
    shaftGeo.dispose()
  })
  const axisGroups: THREE.Group[] = []
  for (const jv of jointViews) {
    const j = jv.joint
    if (!j.inTree) continue
    const parent = links[robot.linkIndex.get(j.parent)!]
    const childView = links[robot.linkIndex.get(j.child)!]
    const frame = new THREE.Group()
    frame.name = j.name
    frame.position.set(j.origin.xyz[0], j.origin.xyz[1], j.origin.xyz[2])
    frame.rotation.set(j.origin.rpy[0], j.origin.rpy[1], j.origin.rpy[2], 'ZYX')
    parent.group.add(frame)
    frame.add(jv.motion)
    jv.motion.add(childView.group)
    if (isMovable(j)) {
      const ag = new THREE.Group()
      const shaft = new THREE.LineSegments(shaftGeo, axisLineMat)
      const cone = new THREE.Mesh(coneGeo, axisMat)
      ag.add(shaft, cone)
      // Arrow along +Y in its own frame → along the joint axis.
      ag.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...j.axis))
      ag.visible = false
      ag.renderOrder = 3
      shaft.renderOrder = 3
      cone.renderOrder = 3
      frame.add(ag)
      jv.axis = ag
      axisGroups.push(ag)
    }
  }
  for (const r of robot.roots) world.add(links[r].group)
  disposers.push(() => {
    world.traverse((o) => {
      if (o instanceof THREE.AxesHelper) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  })

  // Pose
  const values = new Map<string, number>()
  const applyPose = () => {
    const pos = resolvePositions(robot, values)
    for (const jv of jointViews) {
      const j = jv.joint
      if (!j.inTree || !isMovable(j)) continue
      const q = pos.get(j.name) ?? 0
      if (j.type === 'prismatic') {
        jv.motion.position.set(j.axis[0] * q, j.axis[1] * q, j.axis[2] * q)
      } else {
        jv.motion.quaternion.setFromAxisAngle(new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]), q)
      }
      if (jv.slider && j.mimic) {
        jv.slider.value = String(q)
      }
      if (jv.value) jv.value.textContent = formatJointValue(j, q)
    }
  }
  applyPose()

  // Helpers: grid at the robot's lowest point
  const helpers = new THREE.Group()
  scene.add(helpers)
  let radius = 1
  let samples = new Float32Array(0)
  let extents = new THREE.Vector3()
  const measure = () => {
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3()
    for (const l of links) box.expandByObject(l.visual)
    if (box.isEmpty()) for (const l of links) box.expandByPoint(l.group.getWorldPosition(new THREE.Vector3()))
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
    const size = box.getSize(new THREE.Vector3())
    radius = Math.max(size.length() / 2, 0.05)
    // world Y-up: robot extents x (ROS x), z (ROS -y), y (ROS z)
    extents = new THREE.Vector3(size.x, size.z, size.y)
    const pts = samplePoints(world, 20000)
    // Frames of empty links count for framing too.
    const extra: number[] = []
    const v = new THREE.Vector3()
    for (const l of links) {
      l.group.getWorldPosition(v)
      extra.push(v.x, v.y, v.z)
    }
    samples = new Float32Array(pts.length + extra.length)
    samples.set(pts)
    samples.set(extra, pts.length)
    return box
  }
  const rebuildGrid = () => {
    for (const c of [...helpers.children]) {
      helpers.remove(c)
      ;(c as THREE.LineSegments).geometry.dispose()
      ;((c as THREE.LineSegments).material as THREE.Material).dispose()
    }
    const box = measure()
    const size = box.getSize(new THREE.Vector3())
    const extent = Math.max(size.x, size.z, 0.2) * 2
    const step = niceStep(extent / 12)
    const divisions = Math.max(2, Math.min(200, Math.ceil(extent / step)))
    const dark = isDark(background())
    const grid = new THREE.GridHelper(divisions * step, divisions, dark ? 0x6b7280 : 0x9ca3af, dark ? 0x33373e : 0xd8dbe0)
    const c = box.getCenter(new THREE.Vector3())
    grid.position.set(Math.round(c.x / step) * step, Math.min(box.min.y, 0), Math.round(c.z / step) * step)
    grid.visible = showGrid
    helpers.add(grid)
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
  const v3 = new THREE.Vector3()
  const updateLabels = () => {
    const w = canvas.clientWidth
    const hgt = canvas.clientHeight
    for (const l of links) {
      for (const lab of l.labels) {
        const shown = showLabels && l.visual.visible && (labelCount <= MAX_LABELS || selected === links.indexOf(l))
        if (!shown) {
          lab.el.style.display = 'none'
          continue
        }
        lab.anchor.getWorldPosition(v3).project(camera)
        if (v3.z > 1 || v3.z < -1) {
          lab.el.style.display = 'none'
          continue
        }
        lab.el.style.display = ''
        lab.el.style.transform = `translate(${Math.round(((v3.x + 1) / 2) * w)}px, ${Math.round(((1 - v3.y) / 2) * hgt)}px) translate(-50%, -130%)`
      }
    }
  }
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
    updateLabels()
  }
  const requestDraw = () => {
    if (drawing || frame || fallback) return
    frame = requestAnimationFrame(draw)
    fallback = window.setTimeout(draw, 120)
  }
  disposers.push(() => {
    cancelAnimationFrame(frame)
    clearTimeout(fallback)
  })

  const controls = new THREE.OrbitControls(camera, canvas)
  controls.enableDamping = false
  controls.screenSpacePanning = true
  controls.zoomToCursor = true
  controls.addEventListener('change', requestDraw)
  let userMoved = false
  controls.addEventListener('start', () => (userMoved = true))
  disposers.push(() => controls.dispose())
  // Front-right, slightly above (ROS +X forward, +Z up).
  const fit = () => frameCamera(camera, controls, samples, radius, new THREE.Vector3(1.0, 0.75, 0.95))

  let width = 0
  let height = 0
  const resize = () => {
    const r = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width) || stage.clientWidth || 300)
    const hgt = Math.max(1, Math.round(r.height) || stage.clientHeight || 300)
    const pr = Math.min(window.devicePixelRatio || 1, 2)
    if (w === width && hgt === height && pr === renderer.getPixelRatio()) return false
    width = w
    height = hgt
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
  ro.observe(stage)
  ro.observe(canvas)
  disposers.push(() => ro.disconnect())

  // Background
  let picked: Backdrop = 'theme'
  try {
    const v = localStorage.getItem(BACKDROP_KEY)
    if (v === 'light' || v === 'dark' || v === 'theme') picked = v
  } catch {
    // storage unavailable
  }
  function background(): THREE.Color {
    if (picked !== 'theme') return new THREE.Color(BACKDROP_COLOR[picked])
    const css = getComputedStyle(document.body).backgroundColor
    const c = new THREE.Color()
    const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(css)
    if (m) c.setRGB(+m[1] / 255, +m[2] / 255, +m[3] / 255, THREE.SRGBColorSpace)
    else c.set(ctx.theme() === 'light' ? '#ffffff' : '#0a0a0a')
    return c
  }
  const applyBackground = () => {
    scene.background = background()
    rebuildGrid()
  }

  // Selection
  const highlight = new THREE.Color(0x2f6bff)
  const select = (k: number, from: 'scene' | 'panel') => {
    if (selected >= 0) {
      const old = links[selected]
      for (const m of old.materials) m.emissive.setHex(0)
      old.axes.visible = showFrames
      old.axes.scale.setScalar(1)
      old.treeRow?.classList.remove('sel')
      for (const l of old.labels) l.el.classList.remove('sel')
    }
    for (const jv of jointViews) jv.row?.classList.remove('sel')
    selected = selected === k && from === 'scene' ? -1 : k
    if (selected >= 0) {
      const v = links[selected]
      for (const m of v.materials) m.emissive.copy(highlight).multiplyScalar(0.45)
      v.axes.visible = true
      v.axes.scale.setScalar(1.6)
      v.treeRow?.classList.add('sel')
      for (const l of v.labels) l.el.classList.add('sel')
      if (from === 'scene') v.treeRow?.scrollIntoView({ block: 'nearest' })
      const pj = robot.links[selected].parentJoint
      if (pj >= 0) jointViews[pj].row?.classList.add('sel')
    }
    renderDetail()
    draw()
  }

  // Picking: a click (not a drag) on the canvas selects the link under the pointer.
  const raycaster = new THREE.Raycaster()
  let down: { x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }), { signal })
  canvas.addEventListener(
    'pointerup',
    (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return
      down = null
      const r = canvas.getBoundingClientRect()
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const targets: THREE.Object3D[] = []
      for (const l of links) {
        if (l.visual.visible) targets.push(l.visual)
        if (l.collision.visible) targets.push(l.collision)
      }
      const hit = raycaster.intersectObjects(targets, true).find((x) => x.object instanceof THREE.Mesh && x.object.userData.link != null)
      if (hit) select(hit.object.userData.link as number, 'scene')
      else if (selected >= 0) select(selected, 'scene')
    },
    { signal }
  )

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
  toolbar.button({ label: '⤢', title: tr('화면에 맞추기 (F)', 'Fit to view (F)'), onClick: () => (fit(), draw()) })
  toolbar.button({ label: '⟲', title: tr('자세 초기화 (모든 조인트를 0으로)', 'Reset pose (all joints to zero)'), onClick: () => resetPose() })
  toolbar.separator()
  toggle(tr('외형', 'Visual'), tr('외형(visual) 형상 표시', 'Show visual geometry'), true, (on) => {
    for (const l of links) l.visual.visible = on
  })
  toggle(tr('충돌', 'Collision'), tr('충돌(collision) 형상 표시', 'Show collision geometry'), false, (on) => {
    for (const l of links) l.collision.visible = on
  })
  toggle(tr('좌표계', 'Frames'), tr('링크마다 좌표축 표시 (X 빨강, Y 초록, Z 파랑)', 'Link frames (X red, Y green, Z blue)'), false, (on) => {
    showFrames = on
    links.forEach((l, k) => (l.axes.visible = on || k === selected))
  })
  toggle(tr('축', 'Axes'), tr('조인트 회전·이동 축 표시', 'Joint axes'), false, (on) => {
    for (const a of axisGroups) a.visible = on
  })
  if (labelCount) {
    toggle(tr('이름표', 'Labels'), tr('메시 자리표시에 파일 이름 표시', 'File names on mesh placeholders'), true, (on) => (showLabels = on), true)
  }
  toggle('#', tr('바닥 격자', 'Ground grid'), true, (on) => {
    showGrid = on
    for (const c of helpers.children) c.visible = on
  }, true)
  const panelToggle = toggle('☰', tr('링크·조인트 패널', 'Links and joints panel'), !ctx.compact, (on) => {
    panel.style.display = on ? '' : 'none'
  })
  panelToggle.setAttribute('aria-controls', 'fp-urdf-panel')
  panel.id = 'fp-urdf-panel'
  if (ctx.compact) panel.style.display = 'none'
  const bg = toolbar.select(
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
  bg.value = picked
  bg.classList.add('fp-hide-compact')
  ctx.onTheme(() => {
    if (picked !== 'theme') return
    applyBackground()
    draw()
  })

  // Panel
  const movable = jointViews.filter((jv) => jv.joint.inTree && isMovable(jv.joint))
  const resetPose = () => {
    values.clear()
    for (const jv of movable) if (jv.slider) jv.slider.value = String(homePosition(jv.joint))
    applyPose()
    draw()
  }
  const section = (title: string, extra?: HTMLElement) => {
    const hd = h('h3', undefined, title)
    if (extra) hd.append(extra)
    panel.append(hd)
  }
  const detail = h('div', 'fp-urdf-detail')
  const renderDetail = () => {
    detail.replaceChildren()
    if (selected < 0) {
      detail.textContent = tr('3D 화면이나 목록에서 링크를 누르면 선택됩니다.', 'Click a link in the view or in the list to select it.')
      return
    }
    const l = robot.links[selected]
    const pj = l.parentJoint >= 0 ? robot.joints[l.parentJoint] : null
    const add = (k: string, v: string) => {
      const row = h('div')
      row.append(h('b', undefined, k + ' '), document.createTextNode(v))
      detail.append(row)
    }
    add(tr('링크', 'Link'), l.name)
    add(tr('형상', 'Geometry'), `${l.visuals.length} ${tr('외형', 'visual')} · ${l.collisions.length} ${tr('충돌', 'collision')}${l.mass != null ? ` · ${l.mass} kg` : ''}`)
    if (pj) {
      add(tr('부모 조인트', 'Parent joint'), `${pj.name} (${pj.type}) ← ${pj.parent}`)
      add('xyz / rpy', `${pj.origin.xyz.map(fmt).join(' ')} / ${pj.origin.rpy.map(fmt).join(' ')}`)
      if (isMovable(pj)) add(tr('축', 'Axis'), `${pj.axis.map(fmt).join(' ')}${pj.limit ? ` · ${tr('범위', 'limits')} ${fmt(pj.limit.lower)} … ${fmt(pj.limit.upper)}` : ''}`)
    } else add(tr('부모 조인트', 'Parent joint'), tr('없음 (루트 링크)', 'none (root link)'))
    const kids = l.childJoints.map((jk) => robot.joints[jk].child)
    if (kids.length) add(tr('자식 링크', 'Child links'), kids.join(', '))
  }

  // Summary
  {
    const s = h('div', 'fp-urdf-detail')
    const add = (k: string, v: string) => {
      const row = h('div')
      row.append(h('b', undefined, k + ' '), document.createTextNode(v))
      s.append(row)
    }
    add(tr('로봇', 'Robot'), robot.name || tr('(이름 없음)', '(unnamed)'))
    add(tr('구성', 'Contents'), tr(`링크 ${robot.links.length} · 조인트 ${robot.joints.length} · 자유도 ${loaded.dof}`, `${robot.links.length} links · ${robot.joints.length} joints · ${loaded.dof} DOF`))
    if (loaded.xacro) {
      const args = Object.entries(loaded.xacro.args)
      add('xacro', args.length ? tr(`인자: ${args.map(([k, v]) => `${k}=${v}`).join(', ')}`, `args: ${args.map(([k, v]) => `${k}=${v}`).join(', ')}`) : tr('펼침', 'expanded'))
    }
    section(tr('로봇', 'Robot'))
    panel.append(s)
  }
  section(tr('선택', 'Selection'))
  panel.append(detail)
  renderDetail()

  if (movable.length) {
    const reset = h('button', undefined, tr('자세 초기화', 'Reset pose'))
    reset.addEventListener('click', resetPose, { signal })
    section(tr(`조인트 (${movable.length})`, `Joints (${movable.length})`), reset)
    const holder = h('div')
    for (const jv of movable) {
      const j = jv.joint
      const row = h('div', 'fp-urdf-joint' + (j.mimic ? ' mimic' : ''))
      const name = h('span', 'n', j.name)
      name.title = `${j.name} (${j.type})${j.mimic ? ` — ${tr('따라 움직임', 'mimics')} ${j.mimic.joint} × ${j.mimic.multiplier}${j.mimic.offset ? ` + ${j.mimic.offset}` : ''}` : ''}`
      const val = h('span', 'v')
      const [lo, hi] = jointRange(j)
      const input = h('input')
      input.type = 'range'
      input.min = String(lo)
      input.max = String(hi)
      input.step = String((hi - lo) / 1000 || 0.001)
      input.value = String(homePosition(j))
      input.setAttribute('aria-label', j.name)
      if (j.mimic) {
        input.disabled = true
        name.textContent = `${j.name} ⇐ ${j.mimic.joint}`
      }
      input.addEventListener(
        'input',
        () => {
          values.set(j.name, Number(input.value))
          applyPose()
          requestDraw()
        },
        { signal }
      )
      row.addEventListener('click', (e) => {
        if (e.target === input) return
        select(robot.linkIndex.get(j.child)!, 'panel')
      }, { signal })
      row.append(name, val, input)
      jv.slider = input
      jv.value = val
      jv.row = row
      holder.append(row)
    }
    panel.append(holder)
    applyPose()
  }

  // Tree (iterative depth-first, joints between links)
  {
    section(tr(`링크와 조인트 (${robot.links.length} / ${robot.joints.length})`, `Links and joints (${robot.links.length} / ${robot.joints.length})`))
    const ul = h('ul', 'fp-urdf-tree')
    const stack: { link: number; depth: number; via?: Joint }[] = [...robot.roots].reverse().map((r) => ({ link: r, depth: 0 }))
    const pad = (d: number) => `${10 + Math.min(d, 14) * 12}px`
    while (stack.length) {
      const { link, depth, via } = stack.pop()!
      if (via) {
        const jl = h('li', 'joint')
        jl.style.paddingLeft = pad(depth - 1)
        jl.append(document.createTextNode(`↳ ${via.name}`), h('span', 't', via.type + (via.mimic ? ' · mimic' : '')))
        jl.title = `${via.name} (${via.type})`
        jl.addEventListener('click', () => select(link, 'panel'), { signal })
        ul.append(jl)
      }
      const l = robot.links[link]
      const li = h('li')
      li.style.paddingLeft = pad(depth)
      const meshes = l.visuals.filter((v) => v.geometry.type === 'mesh').length
      li.append(document.createTextNode(l.name))
      if (meshes) li.append(h('span', 't', tr(`메시 ${meshes}`, `${meshes} mesh`)))
      li.title = l.name
      li.addEventListener('click', () => select(link, 'panel'), { signal })
      links[link].treeRow = li
      ul.append(li)
      const kids = l.childJoints.map((jk) => robot.joints[jk])
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ link: robot.linkIndex.get(kids[i].child)!, depth: depth + 1, via: kids[i] })
    }
    panel.append(ul)
  }

  // External files and notes
  const list = (title: string, items: { text: string; key?: string; cls?: string }[]) => {
    if (!items.length) return
    section(title)
    const ul = h('ul', 'fp-urdf-list')
    for (const it of items.slice(0, 500)) {
      const li = h('li', it.cls)
      if (it.key) li.append(h('span', 'k', it.key + ' '))
      li.append(document.createTextNode(it.text))
      ul.append(li)
    }
    if (items.length > 500) ul.append(h('li', undefined, tr(`… 외 ${items.length - 500}개`, `… and ${items.length - 500} more`)))
    panel.append(ul)
  }
  list(
    tr(`불러오지 않음 (외부 파일) ${loaded.meshes.length + loaded.textures.length}`, `Not loaded (external file) ${loaded.meshes.length + loaded.textures.length}`),
    [...loaded.meshes.map((m) => ({ key: `${m.link}${m.kind === 'collision' ? ` (${tr('충돌', 'collision')})` : ''}:`, text: m.filename })), ...loaded.textures.map((t) => ({ key: `${t.link} (${tr('텍스처', 'texture')}):`, text: t.filename }))]
  )
  if (loaded.xacro) {
    list(
      tr(`읽지 못한 include ${loaded.xacro.includes.length}`, `Includes not loaded ${loaded.xacro.includes.length}`),
      loaded.xacro.includes.map((i) => ({ text: i.filename + (i.optional ? tr(' (선택)', ' (optional)') : ''), key: tr(`${i.line}행`, `line ${i.line}`) }))
    )
    list(
      tr('해석하지 못한 매크로', 'Unresolved macros'),
      loaded.xacro.unresolvedMacros.map((m) => ({ text: `xacro:${m}` }))
    )
  }
  const notes: Note[] = [...(loaded.xacro?.notes ?? []), ...robot.notes]
  list(
    tr(`알림 ${notes.length}`, `Notes ${notes.length}`),
    notes.map((n) => ({ text: n.message, key: n.line ? tr(`${n.line}행`, `line ${n.line}`) : undefined, cls: n.level }))
  )
  {
    const help = h('div', 'fp-urdf-detail', tr('끌기: 회전 · 오른쪽 끌기/Shift: 이동 · 휠: 확대 · F: 맞추기 · 클릭: 링크 선택', 'Drag: orbit · right-drag/Shift: pan · wheel: zoom · F: fit · click: select a link'))
    help.style.paddingTop = '10px'
    panel.append(help)
  }

  // Banner for meshes that are not drawn
  const nMesh = loaded.meshes.filter((m) => m.kind === 'visual').length
  const missingIncludes = loaded.xacro?.includes.length ?? 0
  const bannerText = [
    nMesh ? tr(`메시 ${nMesh}개는 외부 파일이라 불러올 수 없어 반투명 자리표시로 그렸습니다.`, `${nMesh} mesh${nMesh === 1 ? ' is an external file' : 'es are external files'} and cannot be loaded here; drawn as translucent placeholders.`) : '',
    missingIncludes ? tr(`include ${missingIncludes}개를 읽지 못했습니다.`, `${missingIncludes} included file${missingIncludes === 1 ? '' : 's'} not loaded.`) : '',
    notes.some((n) => n.level === 'error') ? tr('문제가 있어 일부를 건너뛰었습니다 — 패널의 알림을 보세요.', 'Some parts were skipped because of problems: see Notes in the panel.') : ''
  ].filter(Boolean)
  if (bannerText.length) stage.append(h('div', 'fp-urdf-banner', bannerText.join(' ')))

  // Info
  scene.background = background()
  rebuildGrid()
  // With mesh placeholders the extents are only an estimate.
  const ext = `${nMesh ? '≈ ' : ''}${fmtLen(extents.x)} × ${fmtLen(extents.y)} × ${fmtLen(extents.z)} m`
  toolbar.info(
    [
      loaded.xacro ? 'xacro' : 'URDF',
      robot.name || tr('(이름 없음)', '(unnamed)'),
      tr(`링크 ${robot.links.length}`, `${robot.links.length} links`),
      tr(`조인트 ${robot.joints.length}`, `${robot.joints.length} joints`),
      tr(`자유도 ${loaded.dof}`, `${loaded.dof} DOF`),
      ext,
      formatBytes(ctx.bytes.byteLength)
    ].join(' · ')
  )

  controls.listenToKeyEvents(canvas)
  canvas.addEventListener(
    'keydown',
    (e) => {
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        fit()
        draw()
      }
    },
    { signal }
  )
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault(), { signal })

  resize()
  fit()
  draw()
  return dispose
}

/** A length scale for helpers: the spread of link origins and primitive sizes at the home pose. */
function robotScale(robot: Robot): number {
  let maxDim = 0
  for (const l of robot.links) {
    for (const s of [...l.visuals, ...l.collisions]) {
      const g = s.geometry
      const d = g.type === 'box' ? Math.max(...g.size) : g.type === 'sphere' ? 2 * g.radius : g.type === 'mesh' ? 0 : Math.max(2 * g.radius, g.length)
      maxDim = Math.max(maxDim, d + Math.hypot(...s.origin.xyz))
    }
  }
  // Accumulate joint offsets along each chain.
  const reach = new Map<number, number>()
  let maxReach = 0
  const stack = robot.roots.map((r) => [r, 0] as [number, number])
  while (stack.length) {
    const [k, d] = stack.pop()!
    reach.set(k, d)
    maxReach = Math.max(maxReach, d)
    for (const jk of robot.links[k].childJoints) {
      const j = robot.joints[jk]
      stack.push([robot.linkIndex.get(j.child)!, d + Math.hypot(...j.origin.xyz)])
    }
  }
  const s = Math.max(maxDim, maxReach)
  return s > 0 && Number.isFinite(s) ? s : 0.5
}

function fmt(x: number): string {
  if (Number.isInteger(x)) return String(x)
  return String(Number(x.toFixed(4)))
}
function fmtLen(x: number): string {
  return x >= 10 ? x.toFixed(1) : x >= 1 ? x.toFixed(2) : x.toFixed(3)
}
function formatJointValue(j: Joint, q: number): string {
  if (j.type === 'prismatic') return `${q.toFixed(3)} m`
  return `${((q * 180) / Math.PI).toFixed(1)}°`
}
