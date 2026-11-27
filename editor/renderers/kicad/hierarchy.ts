/** Hierarchical schematics: the sheet tree under a root .kicad_sch (sub-sheet files come from the companion
 *  files the user gives), instance paths, page numbers and the instance-specific reference designators.
 *
 *  KiCad 6 keeps every instance's reference in the root file (`symbol_instances`, paths `/<sheet uuid>…/<symbol
 *  uuid>`, page numbers in `sheet_instances`). KiCad 7 and later keep them on each placed symbol (`instances
 *  (project … (path "/<root uuid>/<sheet uuid>…" (reference …) (unit …)))`) and the page on each sheet. Both are
 *  read; a symbol with no entry keeps the reference written in its own file. */
import { child, children, head, isList, num, str, type SList } from './sexpr.ts'

export interface SheetEntry {
  name: string
  file: string
  uuid: string
  /** Page number as KiCad shows it, when stored. */
  page: string
}

export interface HierNode {
  name: string
  file: string
  /** Sheet uuids from the root, `/a/b` (empty for the root): the KiCad 6 instance path. */
  chain: string
  /** `/<root uuid>/a/b`: the KiCad 7+ instance path. */
  path: string
  /** Human path `/Power/Regulator/`. */
  sheetPath: string
  page: string
  depth: number
  parent?: HierNode
  children: HierNode[]
  root?: SList
  /** Where the file was found among the companions. */
  source?: string
  missing: boolean
  /** Why it could not be opened (parse error, recursion). */
  error?: string
}

const sheetProp = (s: SList, a: string, b: string): string => {
  for (const p of children(s, 'property')) {
    const n = str(p[1])
    if (n === a || n === b) return str(p[2])
  }
  return ''
}

/** The sheet boxes of one schematic file. `parentPath` (KiCad 7+ path of this file's instance) picks the
 *  page number stored on each sheet; `rootPages` holds KiCad 6 `sheet_instances` by chain. */
export function sheetEntries(sch: SList, parentPath = '', parentChain = '', rootPages?: Map<string, string>): SheetEntry[] {
  const out: SheetEntry[] = []
  for (const it of sch) {
    if (!isList(it) || head(it) !== 'sheet') continue
    const uuid = str(child(it, 'uuid')?.[1])
    let page = ''
    for (const proj of children(child(it, 'instances'), 'project'))
      for (const p of children(proj, 'path')) if (str(p[1]) === parentPath) page = str(child(p, 'page')?.[1])
    if (!page && rootPages) page = rootPages.get(`${parentChain}/${uuid}`) ?? ''
    out.push({ name: sheetProp(it, 'Sheetname', 'Sheet name'), file: sheetProp(it, 'Sheetfile', 'Sheet file'), uuid, page })
  }
  return out
}

/** KiCad 6 root data: sheet pages and symbol references by instance path. */
export function rootTables(root: SList): { pages: Map<string, string>; refs: Map<string, { ref: string; unit?: number }> } {
  const pages = new Map<string, string>()
  for (const p of children(child(root, 'sheet_instances'), 'path')) pages.set(str(p[1]).replace(/\/$/, ''), str(child(p, 'page')?.[1]))
  const refs = new Map<string, { ref: string; unit?: number }>()
  for (const p of children(child(root, 'symbol_instances'), 'path')) {
    const ref = str(child(p, 'reference')?.[1])
    const unit = child(p, 'unit')
    if (ref) refs.set(str(p[1]), { ref, unit: unit ? num(unit[1], 1) : undefined })
  }
  return { pages, refs }
}

/** Resolves the instance-specific reference of a placed symbol inside `node`. */
export function refLookup(root: SList, node: HierNode): (symbol: SList) => { ref: string; unit?: number } | null {
  const v6 = rootTables(root).refs
  return (sym) => {
    for (const proj of children(child(sym, 'instances'), 'project')) {
      for (const p of children(proj, 'path')) {
        const path = str(p[1])
        if (path === node.path || (node.chain && path.endsWith(node.chain) && path.split('/').length === node.path.split('/').length)) {
          const ref = str(child(p, 'reference')?.[1])
          const unit = child(p, 'unit')
          if (ref) return { ref, unit: unit ? num(unit[1], 1) : undefined }
        }
      }
    }
    const uuid = str(child(sym, 'uuid')?.[1])
    return (uuid && v6.get(`${node.chain}/${uuid}`)) || null
  }
}

/** Directory part of a sheet file path, for resolving the files a sub-sheet references. */
export function joinSheetPath(parentFile: string, file: string): string {
  if (/^([a-z]:)?[\\/]/i.test(file) || file.startsWith('${')) return file
  const i = Math.max(parentFile.lastIndexOf('/'), parentFile.lastIndexOf('\\'))
  return i >= 0 ? parentFile.slice(0, i + 1) + file : file
}

export type SheetLoader = (file: string) => Promise<{ root: SList; source: string } | { error: string } | null>

/** Builds the tree under `root` (depth ≤ 32, at most 2000 sheet instances; a file inside its own chain is
 *  reported as recursive). `load` returns the parsed sub-sheet, an error, or null when it is not given. */
export async function buildHierarchy(root: SList, rootFile: string, load: SheetLoader): Promise<HierNode> {
  const rootUuid = str(child(root, 'uuid')?.[1])
  const pages = rootTables(root).pages
  const top: HierNode = {
    name: '',
    file: rootFile,
    chain: '',
    path: `/${rootUuid}`,
    sheetPath: '/',
    page: pages.get('') ?? pages.get('/') ?? '1',
    depth: 0,
    children: [],
    root,
    missing: false
  }
  let count = 0
  const cache = new Map<string, Awaited<ReturnType<SheetLoader>>>()
  const walk = async (node: HierNode, ancestors: string[]): Promise<void> => {
    if (!node.root || node.depth >= 32) return
    for (const s of sheetEntries(node.root, node.path, node.chain, pages)) {
      if (++count > 2000) return
      const file = joinSheetPath(node.file, s.file)
      const kid: HierNode = {
        name: s.name || s.file,
        file,
        chain: `${node.chain}/${s.uuid}`,
        path: `${node.path}/${s.uuid}`,
        sheetPath: `${node.sheetPath}${s.name || s.file}/`,
        page: s.page,
        depth: node.depth + 1,
        parent: node,
        children: [],
        missing: false
      }
      node.children.push(kid)
      const key = file.replace(/\\/g, '/').toLowerCase()
      if (ancestors.includes(key)) {
        kid.error = 'recursive'
        continue
      }
      if (!cache.has(key)) cache.set(key, await load(file))
      const got = cache.get(key)
      if (!got) kid.missing = true
      else if ('error' in got) kid.error = got.error
      else {
        kid.root = got.root
        kid.source = got.source
        await walk(kid, [...ancestors, key])
      }
    }
  }
  await walk(top, [rootFile.replace(/\\/g, '/').toLowerCase()])
  return top
}

export function flatten(node: HierNode, out: HierNode[] = []): HierNode[] {
  out.push(node)
  for (const c of node.children) flatten(c, out)
  return out
}

export function missingSheets(node: HierNode): HierNode[] {
  return flatten(node).filter((n) => n.missing || n.error)
}

/** `page_layout_descr_file` of a .kicad_pro for the schematic or the board (`${KIPRJMOD}/` removed). */
export function projectWorksheet(proJson: string, kind: 'sch' | 'pcb'): string {
  try {
    const j = JSON.parse(proJson) as Record<string, Record<string, unknown>>
    const v = (kind === 'sch' ? j.schematic : j.pcbnew)?.page_layout_descr_file
    return typeof v === 'string' ? v.replace(/^\$\{KIPRJMOD\}[\\/]/, '') : ''
  } catch {
    return ''
  }
}

export function projectTextVars(proJson: string): Record<string, string> {
  try {
    const j = JSON.parse(proJson) as { text_variables?: Record<string, unknown> }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(j.text_variables ?? {})) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return {}
  }
}
