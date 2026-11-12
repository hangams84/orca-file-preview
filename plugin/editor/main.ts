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
  ods: () => import('./renderers/sheet.ts')
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
    cleanup = await mod.render(ctx)
    if (gen === generation) document.body.dataset.state = 'ready'
  } catch (err) {
    if (gen !== generation) return
    document.body.dataset.state = 'error'
    console.error(err)
    const e = err as Error
    showMessage(
      shell.root,
      tr('미리보기를 표시할 수 없습니다', 'Cannot preview this file'),
      e instanceof PreviewError ? (e.hint ?? e.message) : tr('파일이 손상되었거나 지원하지 않는 변형일 수 있습니다.', 'The file may be damaged or use an unsupported variant.'),
      `${e?.name ?? 'Error'}: ${e?.message ?? String(err)} · ${formatBytes(bytes.byteLength)}`
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
  let last: unknown = null
  api.onDidChange((doc) => {
    if (doc.content === last) return
    last = doc.content
    void show(toBytes(doc.content), (doc.fileType ?? '').replace(/^\./, '').toLowerCase())
  })
}
