/** Text → robot model: XML, xacro expansion when the file uses xacro, then the URDF reader. Shared by
 *  the renderer and the tests; no DOM, no three.js. */
import { dof, parseRobot, type Robot, UrdfError } from './model.ts'
import { processXacro, usesXacro, XacroFatal, type XacroResult } from './xacro.ts'
import { parseXml, XmlError } from './xml.ts'

export interface Loaded {
  robot: Robot
  /** Present when the file went through the xacro processor. */
  xacro?: XacroResult
  /** Mesh references that cannot be loaded (every mesh: the preview has no file access). */
  meshes: { link: string; filename: string; kind: 'visual' | 'collision' }[]
  textures: { link: string; filename: string }[]
  dof: number
}

/** Why loading failed, with a stable code for the error screen. */
export class LoadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly line?: number
  ) {
    super(message)
    this.name = 'LoadError'
  }
}

export function loadRobot(text: string, fileType: string): Loaded {
  let root
  try {
    root = parseXml(text)
  } catch (e) {
    if (e instanceof XmlError) throw new LoadError(fileType === 'xacro' ? 'xacro-xml' : 'urdf-xml', e.message, e.line)
    throw e
  }
  let xacro: XacroResult | undefined
  if (fileType === 'xacro' || usesXacro(root)) {
    try {
      xacro = processXacro(root)
    } catch (e) {
      if (e instanceof XacroFatal) throw new LoadError(e.code, e.message, e.line)
      throw e
    }
    root = xacro.root
  }
  let robot: Robot
  try {
    // A xacro file may only define macros (a library) or get all its links from includes: that
    // is not an error, the preview lists what the file defines instead.
    robot = parseRobot(root, !!xacro)
  } catch (e) {
    if (e instanceof UrdfError) throw new LoadError(e.code, e.message)
    throw e
  }
  if (xacro && fileType !== 'xacro') robot.notes.unshift({ level: 'info', message: 'this .urdf file uses xacro; it was expanded first' })
  const meshes: Loaded['meshes'] = []
  const textures: Loaded['textures'] = []
  for (const l of robot.links) {
    for (const s of l.visuals) {
      if (s.geometry.type === 'mesh') meshes.push({ link: l.name, filename: s.geometry.filename, kind: 'visual' })
      if (s.material?.texture) textures.push({ link: l.name, filename: s.material.texture })
    }
    for (const s of l.collisions) if (s.geometry.type === 'mesh') meshes.push({ link: l.name, filename: s.geometry.filename, kind: 'collision' })
  }
  return { robot, xacro, meshes, textures, dof: dof(robot) }
}

/** The last path segment of a mesh reference: `package://p/meshes/a.stl` → `a.stl`. */
export function fileLabel(filename: string): string {
  return filename.replace(/[?#].*$/, '').split(/[\\/]/).filter(Boolean).pop() ?? filename
}
