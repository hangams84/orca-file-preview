/** AI Model Preview: PyTorch (.pt .pth .ckpt .chkpt .pt2 .ptl .bin .pkl), safetensors, ONNX, TFLite,
 *  GGUF, Keras/HDF5 and NumPy files, read without running any code (see aimodel/ir.ts). Views: graph,
 *  module tree, layer table, parameter map, architecture diagram, tensor inspector, checkpoint info,
 *  plus export. In the File Preview panel the file is read by range (any size); editors get the bytes
 *  Orca hands over (at most 50 MB). */
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bytesSource } from './aimodel/bytes.ts'
import type { ByteSource, ModelIR, ModuleNode } from './aimodel/ir.ts'
import { moduleStats, moduleTree, totals, walk } from './aimodel/tree.ts'
import { CSS, dtypeColor, el, fmtBytes, fmtCount, fmtInt, type App, type View, type ViewName } from './aimodel/views/common.ts'
import { isZip, openZip } from './aimodel/zip.ts'

type Reader = (src: ByteSource) => Promise<ModelIR>

/** Formats read by the second worker's modules (aimodel/formats/<name>.ts); until a module exists
 *  the preview says the parser is coming. */
const EXTERNAL = new Set(['onnx', 'tflite', 'gguf', 'keras', 'numpy'])

async function loadReader(name: string): Promise<Reader> {
  switch (name) {
    case 'pytorch':
      return (await import('./aimodel/formats/pytorch.ts')).read
    case 'pt2':
      return (await import('./aimodel/formats/pt2.ts')).read
    case 'safetensors':
      return (await import('./aimodel/formats/safetensors.ts')).read
  }
  if (!EXTERNAL.has(name)) throw new PreviewError('aimodel-unknown', 'This file is not a model format this preview reads.')
  try {
    const mod = await import(/* @vite-ignore */ `./aimodel/formats/${name}.ts`)
    if (typeof mod.read !== 'function') throw new Error('no read()')
    return mod.read as Reader
  } catch {
    throw new PreviewError('aimodel-parser-pending', `The ${name.toUpperCase()} parser is not part of this build yet.`)
  }
}

/** Picks the reader from the content first, the suffix second. */
export async function sniff(src: ByteSource, fileType: string): Promise<string> {
  const head = await src.read(0, 16)
  const ascii = String.fromCharCode(...head.subarray(0, 8))
  if (ascii.startsWith('GGUF')) return 'gguf'
  if (String.fromCharCode(...head.subarray(4, 8)) === 'TFL3') return 'tflite'
  if (head[0] === 0x89 && ascii.startsWith('\x89HDF')) return 'keras'
  if (head[0] === 0x93 && ascii.startsWith('\x93NUMPY')) return 'numpy'
  if (await isZip(src)) {
    const zip = await openZip(src)
    const names = zip.entries.map((e) => e.name)
    if (names.some((n) => /(^|\/)models\/[^/]+\.json$/.test(n) || /serialized_exported_program\.json$/.test(n))) return 'pt2'
    if (names.some((n) => /(^|\/)data\.pkl$/.test(n))) return 'pytorch'
    if (names.includes('config.json') && names.some((n) => n.endsWith('.weights.h5') || n === 'model.weights.h5')) return 'keras'
    if (names.length && names.every((n) => n.endsWith('.npy'))) return 'numpy'
    if (fileType === 'keras') return 'keras'
    if (fileType === 'npz') return 'numpy'
    throw new PreviewError('aimodel-zip-unknown', 'This ZIP archive is not a PyTorch, torch.export, Keras or NumPy file.')
  }
  if (head[0] === 0x80 && head[1] >= 2 && head[1] <= 5) return 'pytorch'
  // safetensors: 8-byte little-endian header length, then '{'.
  if (head.length >= 9 && head[8] === 0x7b && head[6] === 0 && head[7] === 0) return 'safetensors'
  const bySuffix: Record<string, string> = { onnx: 'onnx', tflite: 'tflite', gguf: 'gguf', keras: 'keras', h5: 'keras', hdf5: 'keras', npy: 'numpy', npz: 'numpy', safetensors: 'safetensors', pt2: 'pt2' }
  if (bySuffix[fileType]) return bySuffix[fileType]
  if (['pt', 'pth', 'ckpt', 'chkpt', 'ptl', 'bin', 'pkl'].includes(fileType)) {
    if (head[0] === 0x80) return 'pytorch'
    throw new PreviewError('aimodel-not-pytorch', 'This file does not start like a PyTorch archive, a pickle, safetensors or GGUF.')
  }
  throw new PreviewError('aimodel-unknown', 'This file is not a model format this preview reads.')
}

const VIEWS: { name: ViewName; ko: string; en: string; tipKo: string; tipEn: string }[] = [
  { name: 'graph', ko: '그래프', en: 'Graph', tipKo: '연산 그래프', tipEn: 'Operator graph' },
  { name: 'tree', ko: '트리', en: 'Tree', tipKo: '모듈 트리', tipEn: 'Module tree' },
  { name: 'table', ko: '표', en: 'Table', tipKo: '레이어 표', tipEn: 'Layer table' },
  { name: 'map', ko: '맵', en: 'Map', tipKo: '파라미터 맵 (트리맵·선버스트)', tipEn: 'Parameter map (treemap, sunburst)' },
  { name: 'arch', ko: '도식', en: 'Diagram', tipKo: '아키텍처 도식 (추론)', tipEn: 'Architecture diagram (inferred)' },
  { name: 'tensor', ko: '텐서', en: 'Tensor', tipKo: '텐서 검사기', tipEn: 'Tensor inspector' },
  { name: 'info', ko: '정보', en: 'Info', tipKo: '체크포인트·메타데이터', tipEn: 'Checkpoint and metadata' }
]

async function loadView(name: ViewName): Promise<View> {
  switch (name) {
    case 'graph':
      return (await import('./aimodel/views/graph.ts')).view
    case 'tree':
      return (await import('./aimodel/views/modules.ts')).view
    case 'table':
      return (await import('./aimodel/views/table.ts')).view
    case 'map':
      return (await import('./aimodel/views/map.ts')).view
    case 'arch':
      return (await import('./aimodel/views/arch.ts')).view
    case 'tensor':
      return (await import('./aimodel/views/tensor.ts')).view
    case 'info':
      return (await import('./aimodel/views/info.ts')).view
  }
}

export async function render(ctx: PreviewContext): Promise<() => void> {
  const { tr } = ctx
  const src: ByteSource = ctx.source ?? bytesSource(ctx.bytes)
  const inEditor = !ctx.source
  let ir: ModelIR
  try {
    const kind = await sniff(src, ctx.fileType)
    ir = await (await loadReader(kind))(src)
  } catch (e) {
    if (e instanceof PreviewError) {
      if (e.message === 'aimodel-parser-pending')
        throw new PreviewError(e.message, tr(`${ctx.fileType.toUpperCase()} 파서는 아직 이 빌드에 포함되지 않았습니다 (준비 중). PyTorch·safetensors 파일은 지금 볼 수 있습니다.`, `The ${ctx.fileType.toUpperCase()} parser is coming and not part of this build yet. PyTorch and safetensors files work now.`))
      const near50 = inEditor && ctx.bytes.byteLength >= 49 * 1024 * 1024
      throw new PreviewError(e.message, (e.hint ?? e.message) + (near50 ? tr(' Orca는 편집기에 최대 50 MB만 넘겨 줍니다. 큰 모델은 File Preview 패널에서 여세요(범위 읽기, 크기 제한 없음).', ' Orca hands editors at most 50 MB: open large models in the File Preview panel (ranged reads, no size limit).') : ''))
    }
    if (e instanceof RangeError) throw new PreviewError('aimodel-truncated', tr('파일이 잘렸거나 손상되었습니다.', 'The file is truncated or damaged.'))
    throw e
  }
  ctx.signal.throwIfAborted?.()
  installCss()

  const modules = moduleTree(ir)
  const stats = moduleStats(modules, ir.tensors)
  const tensorsByName = new Map(ir.tensors.map((t) => [t.name, t]))
  const moduleByPath = new Map<string, ModuleNode>()
  const owner = new Map<string, string>()
  walk(modules, (m) => {
    moduleByPath.set(m.path, m)
    for (const t of m.tensors) owner.set(t, m.path)
  })
  const total = totals(ir.tensors)

  // Layout: summary, notes, body (view + side panel).
  const wrap = el('div', 'am-wrap')
  const summary = el('div', 'am-summary')
  const add = (label: string, value: string, title?: string) => {
    const s = el('span')
    s.append(`${label} `, el('b', undefined, value))
    if (title) s.title = title
    summary.append(s)
  }
  add(tr('형식', 'Format'), ir.formatLabel)
  if (ir.framework) add(tr('프레임워크', 'Framework'), ir.framework)
  add(tr('파라미터', 'Parameters'), fmtCount(total.params), fmtInt(total.params) + (total.buffers ? tr(` (+ 버퍼 ${fmtInt(total.buffers)})`, ` (+ ${fmtInt(total.buffers)} buffer elements)`) : ''))
  add(tr('텐서', 'Tensors'), fmtInt(ir.tensors.length))
  add(tr('크기', 'Size'), fmtBytes(total.bytes), tr(`파일 ${fmtBytes(src.size)}`, `file ${fmtBytes(src.size)}`))
  if (ir.graph) add(tr('연산', 'Ops'), fmtInt(ir.graph.nodes.length))
  if (total.dtypes.size) {
    const bar = el('span', 'am-dtbar')
    const s = el('span')
    s.append('dtype ', bar)
    const sum = [...total.dtypes.values()].reduce((a, b) => a + b, 0) || 1
    const parts: string[] = []
    for (const [d, b] of [...total.dtypes].sort((a, b) => b[1] - a[1])) {
      const seg = el('span')
      seg.style.width = `${(b / sum) * 100}%`
      seg.style.background = dtypeColor(d)
      bar.append(seg)
      parts.push(`${d} ${((b / sum) * 100).toFixed(1)}%`)
    }
    s.title = parts.join(' · ')
    s.append(' ', el('b', undefined, parts.slice(0, 2).map((p) => p.split(' ')[0]).join(', ')))
    summary.append(s)
  }
  wrap.append(summary)
  const notes = [...ir.notes]
  if (inEditor && ctx.bytes.byteLength >= 49 * 1024 * 1024)
    notes.push({ level: 'warn', en: 'Orca hands editors at most 50 MB: open large models in the File Preview panel.', ko: 'Orca는 편집기에 최대 50 MB만 넘겨 줍니다. 큰 모델은 File Preview 패널에서 여세요.' })
  if (notes.length) {
    const d = el('details', 'am-notes')
    const warn = notes.filter((n) => n.level === 'warn').length
    d.append(el('summary', undefined, tr(`노트 ${notes.length}개${warn ? ` (경고 ${warn})` : ''}`, `${notes.length} note${notes.length === 1 ? '' : 's'}${warn ? ` (${warn} warning${warn === 1 ? '' : 's'})` : ''}`)))
    const ul = el('ul')
    for (const n of notes) ul.append(el('li', n.level, (n.level === 'warn' ? '⚠ ' : '') + tr(n.ko ?? n.en, n.en)))
    d.append(ul)
    if (warn) d.open = true
    wrap.append(d)
  }
  const body = el('div', 'am-body')
  const viewEl = el('div', 'am-view')
  const side = el('aside', 'am-side')
  side.hidden = true
  body.append(viewEl, side)
  wrap.append(body)
  ctx.root.replaceChildren(wrap)
  ctx.root.style.overflow = 'hidden'

  let exportSvg: (() => SVGSVGElement | null) | null = null
  let current: ViewName = 'tree'
  let viewAbort: AbortController | null = null
  let cleanupView: void | (() => void)
  const buttons = new Map<ViewName, HTMLButtonElement>()

  const app: App = {
    ir,
    tr,
    compact: ctx.compact,
    theme: ctx.theme,
    signal: ctx.signal,
    modules,
    stats,
    tensorsByName,
    moduleByPath,
    ownerOf: (t) => owner.get(t) ?? '',
    detail(content) {
      if (!content) {
        side.hidden = true
        side.replaceChildren()
        return
      }
      const close = el('button', 'am-close', '×')
      close.type = 'button'
      close.title = tr('닫기', 'Close')
      close.addEventListener('click', () => app.detail(null))
      side.replaceChildren(el('div', 'am-sheet-handle'), close, content)
      side.hidden = false
      side.scrollTop = 0
    },
    show: (v, arg) => void switchTo(v, arg),
    setExportSvg(get) {
      exportSvg = get
    }
  }

  async function switchTo(name: ViewName, arg?: string): Promise<void> {
    current = name
    for (const [n, b] of buttons) b.setAttribute('aria-pressed', String(n === name))
    viewAbort?.abort()
    try {
      cleanupView?.()
    } catch {
      // keep going
    }
    cleanupView = undefined
    exportSvg = null
    viewAbort = new AbortController()
    const signal = viewAbort.signal
    ctx.signal.addEventListener('abort', () => viewAbort?.abort(), { once: true })
    viewEl.replaceChildren(el('div', 'am-empty', tr('불러오는 중…', 'Loading…')))
    const view = await loadView(name)
    if (signal.aborted) return
    viewEl.replaceChildren()
    cleanupView = view.mount(viewEl, { ...app, signal }, arg)
    document.body.dataset.amView = name
  }

  // Toolbar: view buttons, export.
  for (const v of VIEWS) {
    const b = ctx.toolbar.button({ label: tr(v.ko, v.en), title: tr(v.tipKo, v.tipEn), onClick: () => void switchTo(v.name) })
    b.dataset.amView = v.name
    if (v.name === 'graph' && !ir.graph) {
      b.disabled = true
      b.title = tr('이 파일에는 연산 그래프가 저장되어 있지 않습니다 (state_dict·safetensors·통째 pickle).', 'This file stores no operator graph (state_dict, safetensors, pickled module).')
    }
    if (v.name === 'tensor' && !ir.tensors.length) b.disabled = true
    buttons.set(v.name, b)
  }
  ctx.toolbar.separator()
  const exp = ctx.toolbar.select(tr('내보내기', 'Export'), [
    { value: '', label: tr('내보내기…', 'Export…') },
    { value: 'svg', label: tr('현재 보기 SVG', 'Current view as SVG') },
    { value: 'png', label: tr('현재 보기 PNG', 'Current view as PNG') },
    { value: 'json', label: tr('요약 JSON', 'Summary as JSON') },
    { value: 'md', label: tr('요약 Markdown', 'Summary as Markdown') }
  ], (value) => {
    exp.value = ''
    if (!value) return
    void import('./aimodel/views/export.ts').then((m) => m.exportAs(value as 'svg' | 'png' | 'json' | 'md', app, exportSvg, current))
  })
  exp.dataset.amExport = '1'
  ctx.toolbar.info(`${ir.formatLabel} · ${fmtCount(total.params)} params · ${fmtBytes(src.size)}`)

  await switchTo(ir.graph ? 'graph' : 'tree')
  return () => {
    viewAbort?.abort()
    try {
      cleanupView?.()
    } catch {
      // ignore
    }
    delete document.body.dataset.amView
  }
}

let cssInstalled = false
function installCss(): void {
  if (cssInstalled) return
  cssInstalled = true
  const s = document.createElement('style')
  s.textContent = CSS
  document.head.append(s)
}
