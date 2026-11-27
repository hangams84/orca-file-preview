/** Companion files the user hands to the preview: the meshes of a URDF, the includes of a xacro file, the .mtl
 *  and textures of an OBJ, the .bin of a glTF, the xrefs of a DXF, the sub-sheets of a KiCad schematic, the
 *  parts of a SolidWorks assembly …
 *
 *  Why: Orca gives an editor only the file it opens (no path, no file system, no network). The sandboxed frame
 *  can still read files the user picks (a file input, a folder input) or drops onto it; nothing leaves the
 *  frame. The store lives as long as the frame, so a re-render after a file change keeps what was given.
 *
 *  Resolution matches references by path suffix: `package://robot_description/meshes/base.stl`,
 *  `file:///opt/ros/…/base.stl`, `../meshes/base.stl` and `base.stl` all find a picked file whose relative
 *  path ends with the longest matching tail (`robot_description/meshes/base.stl`, then `meshes/base.stl`,
 *  then `base.stl`). Case-insensitive; backslashes count as slashes. */

export interface CompanionFile {
  /** Path relative to the picked folder (webkitRelativePath), or the bare name for single files and drops. */
  path: string
  file: File
}

type Listener = (added: CompanionFile[]) => void

const files: CompanionFile[] = []
const listeners = new Set<Listener>()

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()

/** Splits a reference into its path segments, dropping a scheme, a drive letter and `.`/`..` steps. */
export function referenceSegments(ref: string): string[] {
  let p = ref.trim().replace(/\\/g, '/')
  p = p.replace(/^package:\/\//i, '').replace(/^file:\/\/\/?/i, '').replace(/^model:\/\//i, '')
  p = p.replace(/^[a-z]:\//i, '').replace(/[?#].*$/, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    // keep as is
  }
  return p.split('/').filter((s) => s && s !== '.' && s !== '..').map((s) => s.toLowerCase())
}

/** The given file that best matches `ref` (longest common path tail; ties: the shortest path), or null. */
export function findCompanion(ref: string): CompanionFile | null {
  const want = referenceSegments(ref)
  if (want.length === 0) return null
  let best: CompanionFile | null = null
  let bestLen = 0
  for (const c of files) {
    const have = norm(c.path).split('/')
    let n = 0
    while (n < want.length && n < have.length && want[want.length - 1 - n] === have[have.length - 1 - n]) n++
    if (n === 0) continue
    if (n > bestLen || (n === bestLen && best && c.path.length < best.path.length)) {
      best = c
      bestLen = n
    }
  }
  return best
}

/** Bytes of the best match for `ref`, or null when nothing matches or it cannot be read. */
export async function readCompanion(ref: string): Promise<Uint8Array | null> {
  const c = findCompanion(ref)
  if (!c) return null
  try {
    return new Uint8Array(await c.file.arrayBuffer())
  } catch {
    return null
  }
}

export function companionFiles(): readonly CompanionFile[] {
  return files
}

/** Adds files (replacing ones with the same path) and tells listeners. */
export function addCompanions(list: Iterable<File | CompanionFile>): CompanionFile[] {
  const added: CompanionFile[] = []
  for (const item of list) {
    const c: CompanionFile = item instanceof File ? { path: (item as File & { webkitRelativePath?: string }).webkitRelativePath || item.name, file: item } : item
    const i = files.findIndex((f) => norm(f.path) === norm(c.path))
    if (i >= 0) files[i] = c
    else files.push(c)
    added.push(c)
  }
  if (added.length) for (const l of listeners) l(added)
  return added
}

export function clearCompanions(): void {
  files.length = 0
}

/** Called after files are added (by a picker or a drop); returns an unsubscribe function. */
export function onCompanions(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Opens a file picker; `folder` picks a whole folder (its files keep their relative paths). */
export function pickCompanions(opts: { folder?: boolean; accept?: string; multiple?: boolean } = {}): Promise<CompanionFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (opts.folder) input.setAttribute('webkitdirectory', '')
    if (opts.accept) input.accept = opts.accept
    input.multiple = opts.multiple ?? true
    input.style.display = 'none'
    input.addEventListener('change', () => {
      const added = addCompanions(Array.from(input.files ?? []))
      input.remove()
      resolve(added)
    })
    input.addEventListener('cancel', () => {
      input.remove()
      resolve([])
    })
    document.body.append(input)
    input.click()
  })
}

/** Reads dropped files and folders (folders recursively, keeping relative paths) into the store. */
export function installCompanionDrop(target: HTMLElement, onDropped?: (added: CompanionFile[]) => void): () => void {
  const over = (e: DragEvent): void => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    target.classList.add('fp-drop-over')
  }
  const leave = (): void => target.classList.remove('fp-drop-over')
  const drop = async (e: DragEvent): Promise<void> => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    leave()
    const entries = Array.from(e.dataTransfer.items ?? [])
      .map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.() ?? null)
      .filter((x): x is FileSystemEntry => x !== null)
    const out: CompanionFile[] = []
    if (entries.length) for (const entry of entries) await walk(entry, '', out)
    else for (const f of Array.from(e.dataTransfer.files)) out.push({ path: f.name, file: f })
    const added = addCompanions(out)
    onDropped?.(added)
  }
  target.addEventListener('dragover', over)
  target.addEventListener('dragleave', leave)
  target.addEventListener('drop', drop)
  return () => {
    target.removeEventListener('dragover', over)
    target.removeEventListener('dragleave', leave)
    target.removeEventListener('drop', drop)
  }
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
    if (batch.length === 0) break
    for (const child of batch) await walk(child, path, out)
  }
}

/** The standard controls every viewer uses for companion files: a toolbar button that picks a folder
 *  (shift-click: single files) and a drop target on the preview root. `onAdded` runs after files arrive,
 *  typically to re-render with them. Returns a cleanup that removes the drop handlers. */
export function companionControls(
  ctx: { root: HTMLElement; toolbar: { button(spec: { label: string; title: string; onClick: () => void }): HTMLButtonElement }; tr(ko: string, en: string): string },
  onAdded: (added: CompanionFile[]) => void,
  opts: { accept?: string; what?: { ko: string; en: string } } = {}
): () => void {
  const what = opts.what ?? { ko: '참조 파일', en: 'referenced files' }
  const button = ctx.toolbar.button({
    label: '📁',
    title: ctx.tr(
      `${what.ko}이 있는 폴더 선택 (Shift: 파일 선택) · 파일/폴더를 끌어다 놓아도 됩니다`,
      `Pick the folder with the ${what.en} (Shift: pick files) · or drop files/folders here`
    ),
    onClick: () => {
      void pickCompanions({ folder: !shiftDown, accept: opts.accept }).then((added) => {
        if (added.length) onAdded(added)
      })
    }
  })
  let shiftDown = false
  button.addEventListener('pointerdown', (e) => (shiftDown = e.shiftKey))
  const n = companionFiles().length
  if (n) button.textContent = `📁 ${n}`
  const off = onCompanions(() => (button.textContent = `📁 ${companionFiles().length}`))
  const undrop = installCompanionDrop(ctx.root, (added) => {
    if (added.length) onAdded(added)
  })
  return () => {
    off()
    undrop()
  }
}
