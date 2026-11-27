/** The 3D view of a SolidWorks assembly: each component's mesh placed with its stored transform. Meshes come
 *  from the assembly's own tessellations (what SolidWorks drew it with) or, when it has none (old files, or
 *  saved without display data), from the part files the user gives (📁 or drop). Without a component tree the
 *  given parts are laid out side by side, labelled, with a note saying so. */
import { companionFiles, findCompanion, type CompanionFile } from '../../core/companions.ts'
import type { PreviewContext } from '../../core/types.ts'
import { h } from '../../core/ui.ts'
import { readMeshes, readSwDocument, type SwContainer, type SwMesh } from './sw.ts'
import { baseName, flattenComponents, IDENTITY, leafComponents, meshBox, mulMat, placeMesh, readCompTree, readInstanceMeshes, type Mat4, type SwAssemblyTree, type SwComponent } from './swasm.ts'
import { collapsible, embed, list, note, type EmbedHandle, type PropPage } from './view.ts'

const PALETTE = ['#6f8fb5', '#b98a5e', '#78a872', '#a877a0', '#b3a95c', '#5fa8a2', '#8b8bb8', '#b86f6f', '#7f9f80', '#9a82bf']

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export type MeshSource = 'stored' | 'given' | 'missing' | 'empty'

export interface PlacedComponent {
  comp: SwComponent
  world: Mat4
  source: MeshSource
  mesh?: SwMesh
  /** Companion file that supplied the mesh. */
  from?: string
}

export function readTree(c: SwContainer): SwAssemblyTree | null {
  const x = c.get('swXmlContents/COMPINSTANCETREE')
  return x ? readCompTree(new TextDecoder('utf-8').decode(x)) : null
}

/** The companion file for a component: its saved file name, else `<configuration>.<ext>` (Toolbox copies). */
export function companionFor(comp: SwComponent): CompanionFile | null {
  const name = baseName(comp.file)
  if (name) {
    const c = findCompanion(name)
    if (c && baseName(c.path).toLowerCase() === name.toLowerCase()) return c
  }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '.SLDPRT'
  if (comp.config) {
    const c = findCompanion(`${comp.config}${ext}`)
    if (c && baseName(c.path).toLowerCase() === `${comp.config}${ext}`.toLowerCase()) return c
  }
  return null
}

const partCache = new Map<string, Promise<{ meshes: SwMesh[]; tree: SwAssemblyTree | null; stored: Map<string, SwMesh> } | null>>()

async function readCompanionModel(c: CompanionFile): Promise<{ meshes: SwMesh[]; tree: SwAssemblyTree | null; stored: Map<string, SwMesh> } | null> {
  const key = `${c.path}|${c.file.size}|${c.file.lastModified}`
  let p = partCache.get(key)
  if (!p) {
    p = (async () => {
      try {
        const bytes = new Uint8Array(await c.file.arrayBuffer())
        const ext = baseName(c.path).split('.').pop()?.toLowerCase() ?? ''
        const doc = readSwDocument(bytes, ext)
        if (doc.docType === 'assembly') return { meshes: [], tree: readTree(doc.container), stored: readInstanceMeshes(doc.container) }
        return { meshes: readMeshes(doc.container).meshes, tree: null, stored: new Map() }
      } catch (err) {
        console.warn('solidworks companion:', c.path, err)
        return null
      }
    })()
    partCache.set(key, p)
  }
  return p
}

/** Resolves a mesh for every leaf component (recursing into given sub-assembly files, depth ≤ 4). */
export async function placeComponents(tree: SwAssemblyTree, stored: Map<string, SwMesh>, parent: Mat4 = IDENTITY, prefix = '', depth = 0): Promise<PlacedComponent[]> {
  const out: PlacedComponent[] = []
  for (const comp of leafComponents(tree.components)) {
    const world = mulMat(parent, comp.world)
    const key = (prefix ? `${prefix}/${comp.path}` : comp.path).toLowerCase()
    const mine = stored.get(comp.path.toLowerCase()) ?? stored.get(key)
    if (mine) {
      out.push({ comp, world, source: 'stored', mesh: mine })
      continue
    }
    const c = companionFor(comp)
    const model = c ? await readCompanionModel(c) : null
    if (c && model?.tree && depth < 4) {
      // A sub-assembly file: its own components, placed inside this one.
      const inner = await placeComponents(model.tree, model.stored, world, '', depth + 1)
      for (const x of inner) out.push({ ...x, comp: { ...x.comp, path: `${comp.path}/${x.comp.path}` }, from: x.from ?? c.path })
      if (inner.length) continue
    }
    if (c && model?.meshes.length) {
      out.push({ comp, world, source: 'given', mesh: merge(model.meshes), from: c.path })
      continue
    }
    out.push({ comp, world, source: c && model ? 'empty' : 'missing', from: c?.path })
  }
  return out
}

function merge(list: SwMesh[]): SwMesh {
  if (list.length === 1) return list[0]
  const nv = list.reduce((a, m) => a + m.position.length, 0)
  const ni = list.reduce((a, m) => a + m.index.length, 0)
  const position = new Float32Array(nv)
  const normal = new Float32Array(nv)
  const index = new Uint32Array(ni)
  let v = 0
  let i = 0
  for (const m of list) {
    position.set(m.position, v)
    normal.set(m.normal, v)
    for (let k = 0; k < m.index.length; k++) index[i + k] = m.index[k] + v / 3
    v += m.position.length
    i += m.index.length
  }
  return { name: list[0].name, position, normal, index, faces: list.reduce((a, m) => a + m.faces, 0) }
}

/** Builds (and on companion changes rebuilds) the 3D panel of an assembly. */
export async function assembly3d(panel: HTMLElement, page: PropPage, container: SwContainer, referenced: { path: string; type: string }[]): Promise<{ rebuild: () => Promise<void>; close: () => void }> {
  const { ctx } = page
  const { tr } = ctx
  let handle: EmbedHandle | null = null
  let generation = 0
  const build = async () => {
    const gen = ++generation
    handle?.close()
    handle = null
    panel.replaceChildren(h('div', 'fp-state', tr('구성 요소를 배치하는 중…', 'Placing the components…')))
    await new Promise((r) => setTimeout(r, 0))
    const tree = readTree(container)
    const stored = readInstanceMeshes(container)
    const notes: HTMLElement[] = []
    let parts: { type: 'mesh'; name: string; position: Float32Array; normal: Float32Array; index: Uint32Array; color: Float32Array }[] = []
    const colorOf = new Map<string, string>()
    const paint = (key: string, n: number) => {
      if (!colorOf.has(key)) colorOf.set(key, PALETTE[colorOf.size % PALETTE.length])
      const [r, g, b] = rgb(colorOf.get(key)!)
      const c = new Float32Array(n)
      for (let i = 0; i < n; i += 3) {
        c[i] = r
        c[i + 1] = g
        c[i + 2] = b
      }
      return c
    }
    if (tree) {
      const placed = await placeComponents(tree, stored)
      if (gen !== generation) return
      const all = flattenComponents(tree.components)
      const off = all.filter((c) => c.suppressed || c.hidden)
      const shown = placed.filter((p) => p.mesh && !p.comp.suppressed && !p.comp.hidden && !ancestorOff(p.comp, all))
      for (const p of shown) {
        const m = placeMesh(p.mesh!, p.world)
        parts.push({ type: 'mesh', name: `${p.comp.name}-${p.comp.number}${p.source === 'given' ? ` (${baseName(p.from ?? '')})` : ''}`, ...m, index: p.mesh!.index, color: paint(p.comp.file || p.comp.name, m.position.length) })
      }
      const nStored = shown.filter((p) => p.source === 'stored').length
      const nGiven = shown.filter((p) => p.source === 'given').length
      const missing = placed.filter((p) => !p.mesh && !p.comp.suppressed && !p.comp.hidden && !ancestorOff(p.comp, all))
      notes.push(
        note(
          tr(
            `구성 요소 ${placed.length}개 중 ${shown.length}개를 저장된 위치에 배치했습니다 (어셈블리에 저장된 표시 메시 ${nStored}개, 주어진 파트 파일 ${nGiven}개). 구성: ${tree.config}. 색은 파일별로 구분하며 실제 재질이 아닙니다.`,
            `${shown.length} of ${placed.length} components placed at their stored positions (${nStored} from the display meshes stored in the assembly, ${nGiven} from given part files). Configuration: ${tree.config}. Colours tell files apart; they are not the real materials.`
          )
        )
      )
      if (missing.length) {
        notes.push(
          note(
            tr(
              `메시가 없는 구성 요소 ${missing.length}개: 파트 파일이 있는 폴더를 고르거나(📁) 끌어다 놓으면 채웁니다.`,
              `${missing.length} component${missing.length > 1 ? 's have' : ' has'} no mesh: pick the folder with the part files (📁) or drop them here to fill ${missing.length > 1 ? 'them' : 'it'} in.`
            ),
            'warn'
          ),
          collapsible(
            tr(`메시 없는 구성 요소 (${missing.length})`, `Components without a mesh (${missing.length})`),
            list(missing.map((p) => [p.comp.path, `${baseName(p.comp.file)}${p.source === 'empty' ? tr(' · 파일에 표시 메시 없음', ' · the file has no display mesh') : tr(' · 파일 없음', ' · file not given')}`] as [string, string]))
          )
        )
      }
      if (off.length)
        notes.push(
          collapsible(
            tr(`숨김/억제된 구성 요소 (${off.length}, 그리지 않음)`, `Hidden or suppressed components (${off.length}, not drawn)`),
            list(off.map((c) => [c.path, [c.suppressed ? tr('억제됨', 'suppressed') : '', c.hidden ? tr('숨김', 'hidden') : ''].filter(Boolean).join(' · ')] as [string, string]))
          )
        )
    } else {
      // No component tree: lay the given parts out side by side.
      const given: { name: string; mesh: SwMesh }[] = []
      for (const f of referenced) {
        const c = findCompanion(baseName(f.path))
        if (!c) continue
        const m = await readCompanionModel(c)
        if (m?.meshes.length) given.push({ name: baseName(c.path), mesh: merge(m.meshes) })
      }
      if (gen !== generation) return
      notes.push(
        note(
          tr(
            '이 어셈블리에는 구성 요소 배치(COMPINSTANCETREE)가 저장되어 있지 않습니다. 주어진 파트를 나란히 놓아 보여 주며, 실제 위치가 아닙니다.',
            'This assembly stores no component placement (COMPINSTANCETREE). The given parts are shown side by side, labelled; these are not their real positions.'
          ),
          'warn'
        )
      )
      let x = 0
      for (const g of given) {
        const b = meshBox(g.mesh.position)
        const dx = x - b[0]
        const t: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx / 1000, -b[1] / 1000, -b[2] / 1000, 1]
        const m = placeMesh(g.mesh, t)
        parts.push({ type: 'mesh', name: g.name, ...m, index: g.mesh.index, color: paint(g.name, m.position.length) })
        x += b[3] - b[0] + Math.max(10, (b[3] - b[0]) * 0.25)
      }
    }
    panel.replaceChildren(...notes)
    if (!parts.length) {
      panel.append(
        note(
          companionFiles().length
            ? tr('주어진 파일에서 그릴 메시를 찾지 못했습니다.', 'No mesh to draw was found in the given files.')
            : tr('그릴 메시가 없습니다. 파트 파일이 있는 폴더를 고르거나(📁) 끌어다 놓으세요.', 'Nothing to draw yet: pick the folder with the part files (📁) or drop them here.'),
          'warn'
        )
      )
      return
    }
    if (parts.length > 2000) parts = parts.slice(0, 2000)
    const box = h('div')
    box.style.cssText = 'position:relative;height:max(320px, calc(100vh - 230px));border:1px solid var(--orca-border,#ddd);border-radius:var(--orca-radius,6px);overflow:hidden;margin-top:8px'
    panel.append(box)
    handle = embed(
      ctx,
      box,
      {
        title: tr('어셈블리 3D', 'Assembly 3D'),
        bytes: ctx.bytes,
        ext: 'mesh',
        render: async (sub: PreviewContext) => {
          const { renderMeshes } = await import('../model3d.ts')
          return renderMeshes(sub, parts, { label: 'SolidWorks assembly', units: 'mm', zUp: false })
        }
      },
      false
    )
    await handle.ready
  }
  await build()
  return {
    rebuild: build,
    close: () => {
      generation++
      handle?.close()
    }
  }
  function ancestorOff(c: SwComponent, all: SwComponent[]): boolean {
    for (const a of all) if ((a.suppressed || a.hidden) && c.path.startsWith(`${a.path}/`)) return true
    return false
  }
}
