/** Files for the File Preview panel: the type of a file from its name, which of several files can be
 *  opened, and the files of a drop (folders read recursively, keeping their relative paths). */
import type { CompanionFile } from '../editor/core/companions.ts'

/** The panel reads files itself, so the renderers' own limits apply; this caps the read. */
export const PANEL_MAX_BYTES = 1024 * 1024 * 1024

/** The renderer key for a file name: its longest known suffix (`a.kicad_sch` → `kicad_sch`,
 *  `robot.urdf.xacro` → `xacro`), or '' when none is known. */
export function fileTypeOf(path: string, known: Iterable<string>): string {
  const name = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  let best = ''
  for (const k of known) if (name.endsWith(`.${k}`) && k.length > best.length) best = k
  return best
}

/** Files that can be previewed, the least nested first, then by path. */
export function openCandidates(files: readonly CompanionFile[], known: Iterable<string>): CompanionFile[] {
  const keys = [...known]
  const depth = (p: string) => p.replace(/\\/g, '/').split('/').length
  return files
    .filter((f) => fileTypeOf(f.path, keys) !== '')
    .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
}

/** The files of a drop: folders are walked (entries API) so files keep paths like `pkg/meshes/a.stl`. */
export async function filesFromDrop(dt: DataTransfer): Promise<CompanionFile[]> {
  const entries = Array.from(dt.items ?? [])
    .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null)
    .filter((x): x is FileSystemEntry => x !== null)
  const out: CompanionFile[] = []
  if (entries.length) for (const e of entries) await walk(e, '', out)
  else for (const f of Array.from(dt.files)) out.push({ path: f.name, file: f })
  return out
}

async function walk(entry: FileSystemEntry, prefix: string, out: CompanionFile[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isFile) {
    const file = await new Promise<File | null>((res) => (entry as FileSystemFileEntry).file(res, () => res(null)))
    if (file) out.push({ path, file })
    return
  }
  if (!entry.isDirectory) return
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])))
    if (!batch.length) break
    for (const child of batch) await walk(child, path, out)
  }
}
