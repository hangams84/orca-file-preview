/** File Preview panel (right sidebar): previews a file the user opens here ("Open file…", "Open
 *  folder…" or drag and drop) with the same renderers as the custom editors. Orca hands an editor at
 *  most 50 MB and only files inside a workspace; here the file is read by the frame itself, so the
 *  renderers' own limits apply (up to 1 GB) and any file on the machine can be shown. Files opened
 *  together (a folder, several files) are companions of the shown file (meshes, includes, xrefs …).
 *  Nothing is written and nothing leaves the frame. */
import { createPreview, RANGED_TYPES, RENDERERS } from '../editor/app.ts'
import { addCompanions, type CompanionFile } from '../editor/core/companions.ts'
import { formatBytes, makeTr } from '../editor/core/i18n.ts'
import { createShell, h, installStyles, showMessage } from '../editor/core/ui.ts'
import { filesFromDrop, fileTypeOf, openCandidates, PANEL_MAX_BYTES } from './files.ts'

const CSS = `
.fp-panel-head { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; box-sizing: border-box;
  border-bottom: 1px solid var(--orca-border, #ddd); background: var(--orca-background, #fff); }
.fp-panel-head button { font: inherit; color: var(--orca-primary-foreground, #fff); background: var(--orca-primary, #333);
  border: 1px solid transparent; border-radius: var(--orca-radius, 6px); min-height: 28px; padding: 0 10px; cursor: pointer; }
.fp-panel-head button.secondary { color: var(--orca-secondary-foreground, inherit); background: var(--orca-secondary, #eee); border-color: var(--orca-input, var(--orca-border, #ccc)); }
.fp-panel-head button:focus-visible { outline: 2px solid var(--orca-ring, #48f); outline-offset: 1px; }
.fp-panel-name { flex: 1 1 120px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--orca-muted-foreground, #666); font-size: 12px; }
.fp-panel-drop { margin: 16px; padding: 24px 16px; border: 2px dashed var(--orca-border, #ccc); border-radius: 10px; text-align: center;
  color: var(--orca-muted-foreground, #666); display: flex; flex-direction: column; gap: 8px; align-items: center; }
.fp-panel-drop b { color: var(--orca-foreground, inherit); font-size: 14px; }
body.fp-panel-idle .fp-toolbar { display: none; }
body.fp-drop-over .fp-panel-drop, .fp-content.fp-drop-over { outline: 2px dashed var(--orca-ring, #48f); outline-offset: -6px; }
.fp-panel-list { list-style: none; margin: 0; padding: 8px; }
.fp-panel-list li { margin: 0 0 4px; }
.fp-panel-list button { width: 100%; text-align: left; font: inherit; cursor: pointer; padding: 6px 8px; border-radius: var(--orca-radius, 6px);
  border: 1px solid var(--orca-border, #ddd); background: var(--orca-card, #fafafa); color: var(--orca-card-foreground, inherit);
  display: flex; gap: 8px; align-items: baseline; }
.fp-panel-list button:hover { background: var(--orca-accent, #e4e4e4); }
.fp-panel-list .p { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-panel-list .s { color: var(--orca-muted-foreground, #666); font-size: 11px; white-space: nowrap; }
`

installStyles()
document.getElementById('root')?.remove()
const tr = makeTr(orca.locale)
const shell = createShell()
const { show } = createPreview(shell, tr)

// Header: open a file / a folder, and the name of what is shown.
const head = h('div', 'fp-panel-head')
const openBtn = h('button', undefined, tr('파일 열기…', 'Open file…'))
openBtn.type = 'button'
const folderBtn = h('button', 'secondary', tr('폴더 열기…', 'Open folder…'))
folderBtn.type = 'button'
folderBtn.title = tr('폴더를 열면 그 안의 파일을 고를 수 있고, 나머지는 참조 파일(메시·include·xref)로 쓰입니다.', 'Open a folder to pick a file in it; the other files serve as its references (meshes, includes, xrefs).')
const nameEl = h('span', 'fp-panel-name')
// Persistent inputs (tests drive them with setInputFiles).
const fileInput = h('input')
fileInput.type = 'file'
fileInput.multiple = true
fileInput.id = 'fp-panel-open'
fileInput.hidden = true
const folderInput = h('input')
folderInput.type = 'file'
folderInput.multiple = true
folderInput.setAttribute('webkitdirectory', '')
folderInput.id = 'fp-panel-folder'
folderInput.hidden = true
head.append(openBtn, folderBtn, nameEl, fileInput, folderInput)
document.body.prepend(h('style', undefined, CSS), head)
openBtn.addEventListener('click', () => fileInput.click())
folderBtn.addEventListener('click', () => folderInput.click())

let shown: CompanionFile | null = null

function welcome(): void {
  document.body.classList.add('fp-panel-idle')
  shell.reset()
  shell.setBadge('')
  const box = h('div', 'fp-panel-drop')
  box.append(
    h('b', undefined, tr('미리 볼 파일을 여세요', 'Open a file to preview')),
    h(
      'div',
      undefined,
      tr(
        '"파일 열기…"를 누르거나 파일·폴더를 여기에 끌어다 놓으세요. 워크스페이스 밖의 파일과 50 MB가 넘는 파일(최대 1 GB, AI 모델은 크기 제한 없음)도 볼 수 있습니다.',
        'Click "Open file…" or drop files or a folder here. Files outside a workspace and files over 50 MB (up to 1 GB; AI models of any size) work too.'
      )
    ),
    h('div', undefined, tr('파일을 함께 열면(폴더 등) 메시·include·xref 같은 참조 파일로 쓰입니다.', 'Files opened together (a folder) serve as references: meshes, includes, xrefs.'))
  )
  shell.root.replaceChildren(box)
  document.body.dataset.state = 'ready'
}

async function open(c: CompanionFile): Promise<void> {
  document.body.classList.remove('fp-panel-idle')
  const type = fileTypeOf(c.path, Object.keys(RENDERERS))
  shown = c
  nameEl.textContent = c.path
  nameEl.title = `${c.path} · ${formatBytes(c.file.size)}`
  if (!type || !RENDERERS[type]) {
    shell.reset()
    shell.setBadge(type || '?')
    showMessage(shell.root, tr('지원하지 않는 형식입니다', 'Unsupported format'), c.path)
    document.body.dataset.state = 'error'
    return
  }
  if (RANGED_TYPES.has(type)) {
    // AI models: read by range (zip directory, headers, the tensors being viewed), so any size opens.
    const file = c.file
    await show(new Uint8Array(0), type, {
      size: file.size,
      name: c.path,
      read: async (offset, length) => {
        const end = Math.min(file.size, offset + Math.max(0, length))
        return end <= offset ? new Uint8Array(0) : new Uint8Array(await file.slice(offset, end).arrayBuffer())
      }
    })
    return
  }
  if (c.file.size > PANEL_MAX_BYTES) {
    shell.reset()
    shell.setBadge(type)
    showMessage(shell.root, tr('파일이 너무 큽니다', 'This file is too large'), tr(`${formatBytes(c.file.size)}: 미리보기는 ${formatBytes(PANEL_MAX_BYTES)}까지 읽습니다.`, `${formatBytes(c.file.size)}: the preview reads up to ${formatBytes(PANEL_MAX_BYTES)}.`))
    document.body.dataset.state = 'error'
    return
  }
  document.body.dataset.state = 'loading'
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await c.file.arrayBuffer())
  } catch (e) {
    shell.reset()
    showMessage(shell.root, tr('파일을 읽을 수 없습니다', 'Cannot read this file'), String((e as Error)?.message ?? e))
    document.body.dataset.state = 'error'
    return
  }
  if (shown !== c) return
  await show(bytes, type)
}

/** Files arrived (picked or dropped): they all become companions; one previewable file opens, several
 *  are listed to choose from. */
function received(files: CompanionFile[]): void {
  if (!files.length) return
  addCompanions(files)
  const cands = openCandidates(files, Object.keys(RENDERERS))
  if (cands.length === 1) void open(cands[0])
  else if (cands.length > 1) chooser(cands)
  else if (!shown) {
    shell.reset()
    showMessage(shell.root, tr('미리 볼 수 있는 파일이 없습니다', 'No file to preview'), tr(`${files.length}개 파일을 참조 파일로 추가했습니다.`, `${files.length} file${files.length === 1 ? '' : 's'} added as references.`))
  }
}

function chooser(cands: CompanionFile[]): void {
  document.body.classList.add('fp-panel-idle')
  shell.reset()
  shell.setBadge('')
  nameEl.textContent = tr(`파일 ${cands.length}개 — 하나를 고르세요`, `${cands.length} files — pick one`)
  const ul = h('ul', 'fp-panel-list')
  for (const c of cands.slice(0, 500)) {
    const li = h('li')
    const b = h('button')
    b.type = 'button'
    b.append(h('span', 'p', c.path), h('span', 's', formatBytes(c.file.size)))
    b.title = c.path
    b.addEventListener('click', () => void open(c))
    li.append(b)
    ul.append(li)
  }
  shell.root.replaceChildren(ul)
  document.body.dataset.state = 'ready'
}

const fromInput = (input: HTMLInputElement): CompanionFile[] =>
  Array.from(input.files ?? []).map((f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, file: f }))
fileInput.addEventListener('change', () => {
  const files = fromInput(fileInput)
  fileInput.value = ''
  // Several files: the first previewable one opens, the rest are its references.
  const cands = openCandidates(files, Object.keys(RENDERERS))
  addCompanions(files)
  if (cands.length) void open(cands[0])
  else received(files)
})
folderInput.addEventListener('change', () => {
  const files = fromInput(folderInput)
  folderInput.value = ''
  received(files)
})

// Drops: on the preview, a renderer that takes references handles them (its drop target calls
// preventDefault); anywhere else they open. Dropped files must never navigate the frame.
document.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  document.body.classList.add('fp-drop-over')
})
document.addEventListener('dragleave', (e) => {
  if (e.target === document.documentElement || e.target === document.body) document.body.classList.remove('fp-drop-over')
})
document.addEventListener('drop', (e) => {
  document.body.classList.remove('fp-drop-over')
  if (!e.dataTransfer?.types.includes('Files')) return
  if (e.defaultPrevented) return
  e.preventDefault()
  void filesFromDrop(e.dataTransfer).then(received)
})

welcome()
