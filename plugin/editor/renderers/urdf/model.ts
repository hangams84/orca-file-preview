/** URDF → a robot model: links with visual/collision geometry and materials, joints with origins,
 *  axes, limits and mimic relations, and the kinematic tree. Problems (missing links, cycles,
 *  several parents, bad numbers, unknown geometry) become notes; the model keeps everything that
 *  is usable. No three.js here, so the unit tests run in Node. */
import { attr, child, elements, type XElement } from './xml.ts'
import type { Note } from './xacro.ts'

export type Vec3 = [number, number, number]
export interface Origin {
  xyz: Vec3
  rpy: Vec3
}
export type Geometry =
  | { type: 'box'; size: Vec3 }
  | { type: 'cylinder'; radius: number; length: number }
  | { type: 'sphere'; radius: number }
  | { type: 'capsule'; radius: number; length: number }
  | { type: 'mesh'; filename: string; scale: Vec3 }

export interface Material {
  name?: string
  /** Linear 0–1 RGBA as written in the file (URDF colours are not gamma-encoded by convention). */
  rgba?: [number, number, number, number]
  texture?: string
}
export interface Shape {
  name?: string
  origin: Origin
  geometry: Geometry
  material?: Material
}
export interface Link {
  name: string
  visuals: Shape[]
  collisions: Shape[]
  mass?: number
  /** Index of the joint whose child this link is; -1 for a root. */
  parentJoint: number
  childJoints: number[]
}
export const JOINT_TYPES = ['fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar'] as const
export type JointType = (typeof JOINT_TYPES)[number]
export interface Joint {
  name: string
  type: JointType
  parent: string
  child: string
  origin: Origin
  axis: Vec3
  limit?: { lower: number; upper: number; effort?: number; velocity?: number }
  mimic?: { joint: string; multiplier: number; offset: number }
  /** False when the joint is not part of the tree (missing link, second parent, cycle). */
  inTree: boolean
}
export interface Robot {
  name: string
  links: Link[]
  joints: Joint[]
  linkIndex: Map<string, number>
  jointIndex: Map<string, number>
  /** Link indices without a parent joint. */
  roots: number[]
  materials: Map<string, Material>
  notes: Note[]
}

export class UrdfError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'UrdfError'
  }
}

const ZERO: Vec3 = [0, 0, 0]

/** Movable single-axis joints: these get a slider. */
export const isMovable = (j: Joint) => j.type === 'revolute' || j.type === 'continuous' || j.type === 'prismatic'

/** Degrees of freedom: independent (non-mimic) joint coordinates. */
export function dof(robot: Robot): number {
  let n = 0
  for (const j of robot.joints) {
    if (!j.inTree || j.mimic) continue
    if (isMovable(j)) n++
    else if (j.type === 'floating') n += 6
    else if (j.type === 'planar') n += 3
  }
  return n
}

/** `allowEmpty`: a robot without links is returned (a xacro macro library) instead of refused. */
export function parseRobot(root: XElement, allowEmpty = false): Robot {
  if (root.name !== 'robot') {
    throw new UrdfError('urdf-root', `the root element is <${root.name}>, not <robot>`)
  }
  const notes: Note[] = []
  const seen = new Set<string>()
  const note = (level: Note['level'], message: string, line?: number) => {
    const key = level + message
    if (seen.has(key) || notes.length >= 300) return
    seen.add(key)
    notes.push({ level, message, line })
  }
  const num = (s: string | undefined, dflt: number, where: string, line?: number): number => {
    if (s == null || s.trim() === '') return dflt
    const v = Number(s.trim())
    if (!Number.isFinite(v)) {
      if (s.includes('${')) note('warning', `${where}: "${s}" is an unevaluated xacro expression; ${dflt} used`, line)
      else note('error', `${where}: "${s}" is not a number`, line)
      return dflt
    }
    return v
  }
  const vec = (s: string | undefined, dflt: Vec3, where: string, line?: number): Vec3 => {
    if (s == null || s.trim() === '') return [...dflt] as Vec3
    const parts = s.trim().split(/\s+/).map(Number)
    if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) {
      if (s.includes('${')) note('warning', `${where}: "${s}" is an unevaluated xacro expression; ${dflt.join(' ')} used`, line)
      else note('error', `${where}: "${s}" is not three numbers`, line)
      return [...dflt] as Vec3
    }
    return parts as Vec3
  }
  const origin = (el: XElement | undefined, where: string): Origin => {
    if (!el) return { xyz: [0, 0, 0], rpy: [0, 0, 0] }
    return { xyz: vec(attr(el, 'xyz'), ZERO, `${where} origin xyz`, el.line), rpy: vec(attr(el, 'rpy'), ZERO, `${where} origin rpy`, el.line) }
  }
  const material = (el: XElement | undefined, where: string): Material | undefined => {
    if (!el) return undefined
    const m: Material = { name: attr(el, 'name') || undefined }
    const c = child(el, 'color')
    if (c) {
      const parts = (attr(c, 'rgba') ?? '').trim().split(/\s+/).map(Number)
      if (parts.length === 4 && parts.every(Number.isFinite)) m.rgba = parts.map((x) => Math.min(1, Math.max(0, x))) as Material['rgba']
      else if (parts.length === 3 && parts.every(Number.isFinite)) m.rgba = [...parts.map((x) => Math.min(1, Math.max(0, x))), 1] as Material['rgba']
      else note('error', `${where} material color: "${attr(c, 'rgba')}" is not four numbers`, c.line)
    }
    const t = child(el, 'texture')
    if (t) m.texture = attr(t, 'filename')
    return m
  }
  const geometry = (el: XElement | undefined, where: string): Geometry | null => {
    if (!el) {
      note('error', `${where}: no <geometry>`)
      return null
    }
    const g = elements(el)[0]
    if (!g) {
      note('error', `${where}: empty <geometry>`, el.line)
      return null
    }
    const pos = (v: number) => (v > 0 ? v : 0)
    switch (g.name) {
      case 'box':
        return { type: 'box', size: vec(attr(g, 'size'), [0.1, 0.1, 0.1], `${where} box size`, g.line).map(pos) as Vec3 }
      case 'cylinder':
        return { type: 'cylinder', radius: pos(num(attr(g, 'radius'), 0.05, `${where} cylinder radius`, g.line)), length: pos(num(attr(g, 'length'), 0.1, `${where} cylinder length`, g.line)) }
      case 'sphere':
        return { type: 'sphere', radius: pos(num(attr(g, 'radius'), 0.05, `${where} sphere radius`, g.line)) }
      case 'capsule':
        return { type: 'capsule', radius: pos(num(attr(g, 'radius'), 0.05, `${where} capsule radius`, g.line)), length: pos(num(attr(g, 'length'), 0.1, `${where} capsule length`, g.line)) }
      case 'mesh': {
        const filename = attr(g, 'filename') ?? ''
        if (!filename) note('error', `${where}: mesh without a filename`, g.line)
        const sc = attr(g, 'scale')
        // A single number is accepted by some loaders; URDF says three.
        const scale: Vec3 = sc && /^\s*\S+\s*$/.test(sc) && Number.isFinite(Number(sc)) ? [Number(sc), Number(sc), Number(sc)] : vec(sc, [1, 1, 1], `${where} mesh scale`, g.line)
        return { type: 'mesh', filename, scale }
      }
    }
    note('warning', `${where}: unknown geometry <${g.name}> skipped`, g.line)
    return null
  }

  const robot: Robot = {
    name: attr(root, 'name') ?? '',
    links: [],
    joints: [],
    linkIndex: new Map(),
    jointIndex: new Map(),
    roots: [],
    materials: new Map(),
    notes
  }
  if (!robot.name) note('warning', '<robot> has no name')

  // Robot-level materials first (links may refer to them before or after their definition).
  for (const el of elements(root, 'material')) {
    const m = material(el, 'robot')
    if (!m?.name) {
      note('warning', 'a robot-level <material> has no name', el.line)
      continue
    }
    robot.materials.set(m.name, m)
  }

  const KNOWN = new Set(['link', 'joint', 'material', 'transmission', 'gazebo', 'ros2_control', 'sensor', 'plugin'])
  const unknown = new Set<string>()
  for (const el of elements(root)) if (!KNOWN.has(el.name)) unknown.add(el.name)
  if (unknown.size) note('info', `ignored elements: ${[...unknown].map((n) => `<${n}>`).join(', ')}`)

  for (const el of elements(root, 'link')) {
    const name = attr(el, 'name')
    if (!name) {
      note('error', 'a <link> has no name; skipped', el.line)
      continue
    }
    if (robot.linkIndex.has(name)) {
      note('error', `link "${name}" is defined twice; the second one is skipped`, el.line)
      continue
    }
    const shapes = (tag: 'visual' | 'collision') => {
      const out: Shape[] = []
      for (const v of elements(el, tag)) {
        const where = `link "${name}" ${tag}`
        const g = geometry(child(v, 'geometry'), where)
        if (!g) continue
        let mat: Material | undefined
        if (tag === 'visual') {
          const mEl = child(v, 'material')
          if (mEl) {
            const inline = material(mEl, where)
            const named = inline?.name ? robot.materials.get(inline.name) : undefined
            if (inline && !inline.rgba && !inline.texture && inline.name && !named) note('warning', `${where}: material "${inline.name}" is not defined`, mEl.line)
            mat = inline?.rgba || inline?.texture ? inline : (named ?? inline)
          }
        }
        out.push({ name: attr(v, 'name') || undefined, origin: origin(child(v, 'origin'), where), geometry: g, material: mat })
      }
      return out
    }
    const inertial = child(el, 'inertial')
    const massEl = inertial && child(inertial, 'mass')
    const link: Link = {
      name,
      visuals: shapes('visual'),
      collisions: shapes('collision'),
      mass: massEl ? num(attr(massEl, 'value'), 0, `link "${name}" mass`, massEl.line) : undefined,
      parentJoint: -1,
      childJoints: []
    }
    robot.linkIndex.set(name, robot.links.length)
    robot.links.push(link)
  }
  if (!robot.links.length) {
    if (allowEmpty) return robot
    throw new UrdfError('urdf-empty', 'the robot has no links')
  }

  for (const el of elements(root, 'joint')) {
    const name = attr(el, 'name')
    if (!name) {
      note('error', 'a <joint> has no name; skipped', el.line)
      continue
    }
    if (robot.jointIndex.has(name)) {
      note('error', `joint "${name}" is defined twice; the second one is skipped`, el.line)
      continue
    }
    const where = `joint "${name}"`
    let type = (attr(el, 'type') ?? '') as JointType
    if (!JOINT_TYPES.includes(type)) {
      note('error', `${where}: unknown type "${type}", treated as fixed`, el.line)
      type = 'fixed'
    }
    const parent = attr(child(el, 'parent') ?? el, 'link') ?? ''
    const childName = attr(child(el, 'child') ?? el, 'link') ?? ''
    let axis = vec(attr(child(el, 'axis') ?? el, 'xyz'), [1, 0, 0], `${where} axis`, el.line)
    const len = Math.hypot(...axis)
    if (len < 1e-12) {
      if (isMovable({ type } as Joint)) note('error', `${where}: zero axis, using 1 0 0`, el.line)
      axis = [1, 0, 0]
    } else axis = axis.map((x) => x / len) as Vec3
    const lim = child(el, 'limit')
    let limit: Joint['limit']
    if (lim) {
      limit = {
        lower: num(attr(lim, 'lower'), 0, `${where} limit lower`, lim.line),
        upper: num(attr(lim, 'upper'), 0, `${where} limit upper`, lim.line),
        effort: attr(lim, 'effort') != null ? num(attr(lim, 'effort'), 0, `${where} limit effort`, lim.line) : undefined,
        velocity: attr(lim, 'velocity') != null ? num(attr(lim, 'velocity'), 0, `${where} limit velocity`, lim.line) : undefined
      }
      if (limit.lower > limit.upper) {
        note('warning', `${where}: lower limit ${limit.lower} is above upper limit ${limit.upper}`, lim.line)
        ;[limit.lower, limit.upper] = [limit.upper, limit.lower]
      }
    } else if (type === 'revolute' || type === 'prismatic') {
      note('warning', `${where}: ${type} joint without <limit>`, el.line)
    }
    const mm = child(el, 'mimic')
    const mimic = mm
      ? { joint: attr(mm, 'joint') ?? '', multiplier: num(attr(mm, 'multiplier'), 1, `${where} mimic multiplier`, mm.line), offset: num(attr(mm, 'offset'), 0, `${where} mimic offset`, mm.line) }
      : undefined
    const joint: Joint = { name, type, parent, child: childName, origin: origin(child(el, 'origin'), where), axis, limit, mimic, inTree: false }
    robot.jointIndex.set(name, robot.joints.length)
    robot.joints.push(joint)
  }

  // Tree: each link has at most one parent joint; joints must name existing links.
  robot.joints.forEach((j, k) => {
    const p = robot.linkIndex.get(j.parent)
    const c = robot.linkIndex.get(j.child)
    if (p == null || c == null) {
      const missing = [p == null ? `parent "${j.parent}"` : '', c == null ? `child "${j.child}"` : ''].filter(Boolean).join(' and ')
      note('error', `joint "${j.name}": ${missing} link not found; joint skipped`)
      return
    }
    if (p === c) {
      note('error', `joint "${j.name}": the link "${j.parent}" is its own parent; joint skipped`)
      return
    }
    const cl = robot.links[c]
    if (cl.parentJoint >= 0) {
      note('error', `link "${cl.name}" has two parent joints ("${robot.joints[cl.parentJoint].name}" and "${j.name}"); "${j.name}" skipped`)
      return
    }
    cl.parentJoint = k
    robot.links[p].childJoints.push(k)
    j.inTree = true
  })
  // Cycles: links that cannot be reached from a root. Each loop is broken at its first link.
  const reached = new Set<number>()
  const roots = robot.links.map((l, k) => (l.parentJoint < 0 ? k : -1)).filter((k) => k >= 0)
  const walk = (from: number[]) => {
    const stack = [...from]
    while (stack.length) {
      const k = stack.pop()!
      if (reached.has(k)) continue
      reached.add(k)
      for (const jk of robot.links[k].childJoints) stack.push(robot.linkIndex.get(robot.joints[jk].child)!)
    }
  }
  walk(roots)
  for (let guard = 0; reached.size < robot.links.length && guard < robot.links.length; guard++) {
    const k = robot.links.findIndex((_, x) => !reached.has(x))
    const first = robot.links[k]
    const jk = first.parentJoint
    const pj = robot.joints[jk]
    note('error', `kinematic loop through link "${first.name}": it cannot be reached from a root link; joint "${pj.name}" is skipped`)
    const pl = robot.links[robot.linkIndex.get(pj.parent)!]
    pl.childJoints = pl.childJoints.filter((x) => x !== jk)
    pj.inTree = false
    first.parentJoint = -1
    roots.push(k)
    walk([k])
  }
  robot.roots = roots
  if (roots.length > 1) {
    note('warning', `${roots.length} root links (${roots.slice(0, 5).map((k) => `"${robot.links[k].name}"`).join(', ')}${roots.length > 5 ? ', …' : ''}): URDF expects one; each is drawn at the origin`)
  }
  for (const j of robot.joints) {
    if (!j.mimic) continue
    const m = robot.jointIndex.get(j.mimic.joint)
    if (m == null) {
      note('error', `joint "${j.name}" mimics "${j.mimic.joint}", which does not exist`)
      j.mimic = undefined
    } else if (!isMovable(robot.joints[m])) {
      note('warning', `joint "${j.name}" mimics the ${robot.joints[m].type} joint "${j.mimic.joint}"`)
    }
  }
  // Mimic loops
  for (const j of robot.joints) {
    const seenM = new Set<string>([j.name])
    let cur = j
    while (cur.mimic) {
      const next = robot.joints[robot.jointIndex.get(cur.mimic.joint)!]
      if (seenM.has(next.name)) {
        note('error', `mimic loop through joint "${j.name}"; its mimic is ignored`)
        j.mimic = undefined
        break
      }
      seenM.add(next.name)
      cur = next
    }
  }
  return robot
}

/** Slider range of a movable joint. Continuous joints and unlimited ones get ±π (prismatic ±1). */
export function jointRange(j: Joint): [number, number] {
  if (j.type === 'continuous') return [-Math.PI, Math.PI]
  if (j.limit && j.limit.upper > j.limit.lower) return [j.limit.lower, j.limit.upper]
  return j.type === 'prismatic' ? [-1, 1] : [-Math.PI, Math.PI]
}

/** Resolves joint positions: independent values from `values`, mimic joints follow their master
 *  (value = multiplier · master + offset, through chains). Missing values are 0, clamped into
 *  the slider range when 0 lies outside it. */
export function resolvePositions(robot: Robot, values: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  const get = (j: Joint, depth: number): number => {
    const done = out.get(j.name)
    if (done != null) return done
    let v: number
    if (j.mimic && depth < 64) {
      const m = robot.joints[robot.jointIndex.get(j.mimic.joint)!]
      v = j.mimic.multiplier * get(m, depth + 1) + j.mimic.offset
    } else {
      v = values.get(j.name) ?? homePosition(j)
    }
    out.set(j.name, v)
    return v
  }
  for (const j of robot.joints) if (isMovable(j)) get(j, 0)
  return out
}

/** The pose a joint starts in: 0, or the nearest limit when 0 is outside the limits. */
export function homePosition(j: Joint): number {
  const [lo, hi] = jointRange(j)
  return Math.min(hi, Math.max(lo, 0))
}
