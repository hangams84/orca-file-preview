/** File Preview: one read-only viewer for every format this plugin registers. It never edits the
 *  file; it re-renders when the file changes on disk. Renderers load lazily per format. */
import { formatBytes, makeTr } from './core/i18n.ts'
import { PreviewError, type PreviewContext, type Renderer, type ThemeName } from './core/types.ts'
import { createShell, installStyles, showLoading, showMessage } from './core/ui.ts'

type Loader = () => Promise<{ render: Renderer }>

/** Suffix (without the dot, lower case) to its renderer module. Keep in step with orca-plugin.json. */
export const RENDERERS: Record<string, Loader> = {
  txt: () => import('./renderers/text.ts'),
  log: () => import('./renderers/text.ts'),
  csv: () => import('./renderers/csv.ts'),
  tsv: () => import('./renderers/csv.ts'),
  html: () => import('./renderers/html.ts'),
  htm: () => import('./renderers/html.ts'),
  xhtml: () => import('./renderers/html.ts'),
  svg: () => import('./renderers/svg.ts'),
  gif: () => import('./renderers/image.ts'),
  bmp: () => import('./renderers/image.ts'),
  pdf: () => import('./renderers/pdf.ts'),
  docx: () => import('./renderers/docx.ts'),
  doc: () => import('./renderers/doc.ts'),
  pptx: () => import('./renderers/pptx.ts'),
  ppt: () => import('./renderers/ppt.ts'),
  xlsx: () => import('./renderers/sheet.ts'),
  xlsm: () => import('./renderers/sheet.ts'),
  xls: () => import('./renderers/sheet.ts'),
  ods: () => import('./renderers/sheet.ts'),
  hwp: () => import('./renderers/hwp.ts'),
  hwpx: () => import('./renderers/hwp.ts')
}

installStyles()
const tr = makeTr(orca.locale)
const shell = createShell()
const themeListeners = new Set<(t: ThemeName) => void>()
const currentTheme = (): ThemeName => (document.documentElement.classList.contains('light') ? 'light' : 'dark')
orca.on('theme', () => {
  for (const l of themeListeners) l(currentTheme())
})

let generation = 0
let abort: AbortController | null = null
let cleanup: (() => void) | void = undefined

async function show(bytes: Uint8Array, fileType: string): Promise<void> {
  const gen = ++generation
  document.body.dataset.state = 'loading'
  abort?.abort()
  try {
    cleanup?.()
  } catch {
    // a renderer's cleanup must not stop the next render
  }
  cleanup = undefined
  themeListeners.clear()
  abort = new AbortController()
  shell.reset()
  shell.setBadge(fileType || '?')
  const load = RENDERERS[fileType]
  if (!load) {
    showMessage(shell.root, tr('지원하지 않는 형식입니다', 'Unsupported format'), `.${fileType}`)
    document.body.dataset.state = 'error'
    return
  }
  if (bytes.byteLength === 0) {
    showMessage(shell.root, tr('빈 파일입니다', 'This file is empty'), formatBytes(0))
    document.body.dataset.state = 'ready'
    return
  }
  showLoading(shell.root, tr('미리보기를 준비하는 중…', 'Preparing preview…'))
  const ctx: PreviewContext = {
    bytes,
    fileType,
    root: shell.root,
    toolbar: shell.toolbar,
    tr,
    signal: abort.signal,
    theme: currentTheme,
    onTheme: (l) => {
      themeListeners.add(l)
    },
    compact: window.matchMedia('(max-width: 600px)').matches
  }
  try {
    const mod = await load()
    if (gen !== generation) return
    const done = await mod.render(ctx)
    if (gen !== generation) {
      // A newer render started while this one ran: release this one's resources, never let it
      // replace the newer render's cleanup.
      try {
        done?.()
      } catch {
        // ignore
      }
      return
    }
    cleanup = done
    document.body.dataset.state = 'ready'
  } catch (err) {
    if (gen !== generation) return
    document.body.dataset.state = 'error'
    const e = err as Error
    // An expected refusal (damaged, encrypted, unsupported) is not a plugin fault.
    if (e instanceof PreviewError) console.warn(`preview refused: ${e.message}`)
    else console.error(err)
    showMessage(
      shell.root,
      tr('미리보기를 표시할 수 없습니다', 'Cannot preview this file'),
      e instanceof PreviewError ? (e.hint ?? e.message) : tr('파일이 손상되었거나 지원하지 않는 변형일 수 있습니다.', 'The file may be damaged or use an unsupported variant.'),
      `${e instanceof PreviewError ? `code: ${e.message}` : `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`} · .${fileType} · ${formatBytes(bytes.byteLength)}`,
      tr('자세히', 'Details')
    )
  }
}

function toBytes(content: { kind: 'text'; text: string } | { kind: 'bytes'; bytes: ArrayBuffer }): Uint8Array {
  return content.kind === 'bytes' ? new Uint8Array(content.bytes) : new TextEncoder().encode(content.text)
}

const api = orca.document
if (!api) {
  showMessage(shell.root, 'File Preview', tr('이 파일은 편집기 탭에서만 열 수 있습니다.', 'This page runs as a custom editor.'))
} else {
  // Orca can deliver the same document more than once (the replay on subscribe, a re-open, a
  // capture): re-render only when the bytes or the file type really changed.
  let lastBytes: Uint8Array | null = null
  let lastType = ''
  api.onDidChange((doc) => {
    const bytes = toBytes(doc.content)
    const type = (doc.fileType ?? '').replace(/^\./, '').toLowerCase()
    if (type === lastType && lastBytes && sameBytes(lastBytes, bytes)) return
    lastBytes = bytes
    lastType = type
    void show(bytes, type)
  })
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.byteLength !== b.byteLength) return false
  // Compare 4 bytes at a time where alignment allows; files are at most tens of MB.
  const n4 = a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0 ? a.byteLength >> 2 : 0
  if (n4) {
    const a4 = new Uint32Array(a.buffer, a.byteOffset, n4)
    const b4 = new Uint32Array(b.buffer, b.byteOffset, n4)
    for (let i = 0; i < n4; i++) if (a4[i] !== b4[i]) return false
  }
  for (let i = n4 << 2; i < a.byteLength; i++) if (a[i] !== b[i]) return false
  return true
}
