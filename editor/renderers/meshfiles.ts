/** Mesh files the user handed to the preview (core/companions.ts), parsed with three.js for the robot
 *  preview: STL (binary/ASCII), COLLADA (.dae, with its textures), OBJ (with .mtl and textures) and
 *  glTF/GLB (with external buffers and images). Side files resolve relative to the mesh's own path;
 *  they load from blob: URLs (images and buffers only, never scripts), so no network is used. */
import * as THREE from '../../vendor/three.js'
import { CompanionUrls, readRef } from '../core/refs.ts'

export type MeshKind = 'stl' | 'dae' | 'obj' | 'glb' | 'gltf'

export interface MeshFile {
  object: THREE.Object3D
  /** True when the file brings its own colours (materials, vertex colours): the URDF material is not applied. */
  ownMaterials: boolean
  /** Side files (textures, .mtl, .bin) that were referenced but not supplied. */
  missing: string[]
}

/** 1×1 white PNG used in place of a missing texture (the material keeps its colour). */
export const WHITE_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|tga|tiff?|ktx2?|dds)$/i

/** The mesh format from the file name, else from the content. */
export function meshKind(path: string, bytes: Uint8Array): MeshKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path.replace(/[?#].*$/, ''))?.[1]?.toLowerCase()
  if (ext === 'stl' || ext === 'dae' || ext === 'obj' || ext === 'glb' || ext === 'gltf') return ext
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512))
  if (head.startsWith('glTF')) return 'glb'
  if (/<COLLADA[\s>]/.test(head)) return 'dae'
  if (/^\s*solid\b/i.test(head) || bytes.byteLength >= 84) return 'stl'
  return null
}

/** `mtllib` names in an OBJ file (a name may contain spaces). */
export function objMaterialLibs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** A loading manager that serves side files from companions relative to `base` (a companion path). */
export function companionManager(urls: CompanionUrls, base: string | undefined, onDone?: () => void): THREE.LoadingManager {
  const manager = new THREE.LoadingManager(onDone)
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url
    const found = urls.url(url, base)
    if (found) return found
    // A missing image becomes a white pixel (the material keeps its colour); a missing buffer
    // stays unresolvable and fails that load.
    return IMAGE_EXT.test(url.replace(/[?#].*$/, '')) ? WHITE_PIXEL : `data:application/octet-stream;base64,`
  })
  return manager
}

/** Parses one mesh file. `path` is its companion path (side files resolve from there). For URDF,
 *  `rosFrame` keeps a COLLADA file's own axes as rviz does (no Z-up → Y-up turn). */
export async function parseMeshFile(
  bytes: Uint8Array,
  path: string,
  urls: CompanionUrls,
  opts: { rosFrame?: boolean; onTextures?: () => void } = {}
): Promise<MeshFile> {
  const kind = meshKind(path, bytes)
  if (!kind) throw new Error(`unknown mesh format: ${path}`)
  const before = urls.missing.length
  const manager = companionManager(urls, path, opts.onTextures)
  const buffer = bytes.slice().buffer as ArrayBuffer
  const missing = () => urls.missing.slice(before)
  switch (kind) {
    case 'stl': {
      const geo = new THREE.STLLoader().parse(buffer)
      const colors = !!(geo as THREE.BufferGeometry & { hasColors?: boolean }).hasColors
      if (!geo.getAttribute('normal')) geo.computeVertexNormals()
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: colors, roughness: 0.55, metalness: 0.1 })
      return { object: new THREE.Mesh(geo, mat), ownMaterials: colors, missing: [] }
    }
    case 'obj': {
      const text = new TextDecoder().decode(bytes)
      const loader = new THREE.OBJLoader(manager)
      let own = false
      for (const lib of objMaterialLibs(text)) {
        const got = await readRef(lib, path)
        if (!got) {
          urls.missing.push(lib)
          continue
        }
        const mtl = new THREE.MTLLoader(companionManager(urls, got.path, opts.onTextures)).parse(new TextDecoder().decode(got.bytes), '')
        mtl.preload()
        loader.setMaterials(mtl)
        own = true
      }
      return { object: loader.parse(text), ownMaterials: own, missing: missing() }
    }
    case 'dae': {
      const text = new TextDecoder().decode(bytes)
      const res = quietly(() => new THREE.ColladaLoader(manager).parse(text, ''))
      if (!res?.scene) throw new Error(`COLLADA without a scene: ${path}`)
      // rviz skips the root node's up-axis conversion (rviz mesh_loader.cpp); the unit scale stays.
      if (opts.rosFrame) res.scene.rotation.set(0, 0, 0)
      const own = /<library_materials[\s>][\s\S]*?<material[\s>]/.test(text)
      return { object: res.scene, ownMaterials: own, missing: missing() }
    }
    case 'glb':
    case 'gltf': {
      const loader = new THREE.GLTFLoader(manager)
      const gltf = await loader.parseAsync(kind === 'glb' ? buffer : new TextDecoder().decode(bytes), '')
      const scene = gltf.scene ?? gltf.scenes?.[0]
      if (!scene) throw new Error(`glTF without a scene: ${path}`)
      return { object: scene, ownMaterials: true, missing: missing() }
    }
  }
}

/** Runs `fn` without ColladaLoader's console warning about Z-up assets (expected here). */
export function quietly<T>(fn: () => T): T {
  const warn = console.warn
  console.warn = (...a: unknown[]) => {
    if (typeof a[0] === 'string' && a[0].includes('Z-UP')) return
    warn(...a)
  }
  try {
    return fn()
  } finally {
    console.warn = warn
  }
}
