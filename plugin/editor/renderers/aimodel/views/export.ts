/** Export: the current view as SVG/PNG, the model summary as JSON/Markdown. Downloads where the frame
 *  allows them; the result is also shown in a dialog with Copy (sandboxed frames may block downloads). */
import { numel } from '../dtype.ts'
import type { Value } from '../ir.ts'
import { totals } from '../tree.ts'
import { copyText, download, el, fmtBytes, fmtInt, fmtShape, fmtValue, shortType, type App, type ViewName } from './common.ts'

export function summaryJson(app: App): Record<string, unknown> {
  const { ir } = app
  const t = totals(ir.tensors)
  const modules: Record<string, unknown>[] = []
  for (const [path, s] of app.stats) {
    if (modules.length >= 5000) break
    const m = app.moduleByPath.get(path)
    modules.push({ path, type: m?.type, inferred: m?.inferred || undefined, params: s.params, bytes: s.bytes })
  }
  return {
    format: ir.format,
    formatLabel: ir.formatLabel,
    framework: ir.framework,
    producer: ir.producer,
    parameters: t.params,
    bufferElements: t.buffers,
    bytes: t.bytes,
    dtypes: Object.fromEntries(t.dtypes),
    tensors: ir.tensors.slice(0, 100000).map((x) => ({ name: x.name, shape: x.shape, dtype: x.dtype, bytes: x.byteLength, kind: x.kind })),
    modules,
    graph: ir.graph ? { nodes: ir.graph.nodes.length, inputs: ir.graph.inputs, outputs: ir.graph.outputs, ops: countOps(ir.graph.nodes.map((n) => n.op)) } : undefined,
    checkpoint: ir.checkpoint,
    metadata: ir.metadata,
    notes: ir.notes.map((n) => n.en)
  }
}

function countOps(ops: string[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const o of ops) m[o] = (m[o] ?? 0) + 1
  return m
}

export function summaryMarkdown(app: App): string {
  const { ir, tr } = app
  const t = totals(ir.tensors)
  const lines = [`# ${ir.formatLabel}`, '', `| ${tr('항목', 'Item')} | ${tr('값', 'Value')} |`, '|---|---|']
  lines.push(`| ${tr('형식', 'Format')} | ${ir.formatLabel} |`)
  if (ir.framework) lines.push(`| ${tr('프레임워크', 'Framework')} | ${ir.framework} |`)
  lines.push(`| ${tr('파라미터', 'Parameters')} | ${fmtInt(t.params)} |`)
  lines.push(`| ${tr('크기', 'Size')} | ${fmtBytes(t.bytes)} |`)
  lines.push(`| ${tr('텐서', 'Tensors')} | ${fmtInt(ir.tensors.length)} |`)
  if (ir.graph) lines.push(`| ${tr('연산', 'Ops')} | ${fmtInt(ir.graph.nodes.length)} |`)
  if (ir.checkpoint?.epoch !== undefined) lines.push(`| epoch | ${ir.checkpoint.epoch} |`)
  if (ir.checkpoint?.step !== undefined) lines.push(`| step | ${ir.checkpoint.step} |`)
  lines.push('', `## ${tr('모듈', 'Modules')}`, '', `| ${tr('경로', 'Path')} | ${tr('형식', 'Type')} | ${tr('파라미터', 'Params')} | ${tr('크기', 'Size')} |`, '|---|---|---:|---:|')
  let n = 0
  for (const [path, s] of app.stats) {
    if (path.split('.').length > 3) continue
    if (++n > 400) break
    lines.push(`| \`${path || '(root)'}\` | ${shortType(app.moduleByPath.get(path)?.type)} | ${fmtInt(s.params)} | ${fmtBytes(s.bytes)} |`)
  }
  lines.push('', `## ${tr('텐서', 'Tensors')}`, '', `| ${tr('이름', 'Name')} | ${tr('모양', 'Shape')} | dtype | #params |`, '|---|---|---|---:|')
  for (const x of ir.tensors.slice(0, 2000)) lines.push(`| \`${x.name}\` | ${fmtShape(x.shape)} | ${x.dtype} | ${fmtInt(numel(x.shape))} |`)
  if (ir.tensors.length > 2000) lines.push(`| … | | | ${ir.tensors.length - 2000} more |`)
  const hp = ir.checkpoint?.hyperParameters
  if (hp) {
    lines.push('', `## ${tr('하이퍼파라미터', 'Hyper-parameters')}`, '')
    for (const [k, v] of Object.entries(hp)) lines.push(`- \`${k}\`: ${fmtValue(v as Value)}`)
  }
  if (ir.notes.length) {
    lines.push('', `## ${tr('노트', 'Notes')}`, '')
    for (const x of ir.notes) lines.push(`- ${tr(x.ko ?? x.en, x.en)}`)
  }
  return lines.join('\n') + '\n'
}

function dialog(app: App, title: string, body: Node, copy?: () => Promise<boolean>): void {
  const box = el('div')
  box.dataset.amExportResult = '1'
  box.append(el('h3', undefined, title), body)
  if (copy) {
    const b = el('button', 'am-link', app.tr('클립보드에 복사', 'Copy to clipboard'))
    b.type = 'button'
    b.addEventListener('click', () => void copy().then((ok) => (b.textContent = ok ? app.tr('복사됨 ✓', 'Copied ✓') : app.tr('복사 실패', 'Copy failed'))))
    box.append(el('br'), b)
  }
  app.detail(box)
}

export async function exportAs(kind: 'svg' | 'png' | 'json' | 'md', app: App, getSvg: (() => SVGSVGElement | null) | null, current: ViewName): Promise<void> {
  const { tr } = app
  const base = (app.ir.formatLabel.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'model').toLowerCase()
  if (kind === 'json' || kind === 'md') {
    const text = kind === 'json' ? JSON.stringify(summaryJson(app), (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 1) : summaryMarkdown(app)
    const ok = download(`${base}-summary.${kind}`, new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/markdown' }))
    const pre = el('pre', 'am-mono', text.length > 20000 ? text.slice(0, 20000) + '\n…' : text)
    pre.style.whiteSpace = 'pre-wrap'
    pre.style.maxHeight = '50vh'
    pre.style.overflow = 'auto'
    dialog(app, tr(`요약 ${kind.toUpperCase()}${ok ? ' (내려받기 시작)' : ''}`, `Summary ${kind.toUpperCase()}${ok ? ' (download started)' : ''}`), pre, () => copyText(text))
    return
  }
  const s = getSvg?.()
  if (!s) {
    dialog(app, tr('내보낼 그림이 없습니다', 'Nothing to export'), el('p', undefined, tr(`"${current}" 보기에는 SVG 그림이 없습니다. 그래프·맵·도식·텐서 보기에서 내보내거나 요약(JSON/Markdown)을 쓰세요.`, `The "${current}" view has no picture. Export from the graph, map, diagram or tensor view, or use the summary (JSON/Markdown).`)))
    return
  }
  const clone = s.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const text = new XMLSerializer().serializeToString(clone)
  if (kind === 'svg') {
    const ok = download(`${base}-${current}.svg`, new Blob([text], { type: 'image/svg+xml' }))
    const img = el('img')
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
    img.style.maxWidth = '100%'
    img.style.background = '#fff'
    dialog(app, tr(`SVG ${fmtBytes(text.length)}${ok ? ' (내려받기 시작)' : ''}`, `SVG ${fmtBytes(text.length)}${ok ? ' (download started)' : ''}`), img, () => copyText(text))
    return
  }
  // PNG: rasterise the SVG through an <img> (data: URL is allowed by the frame CSP).
  const w = Number(clone.getAttribute('width')) || 800
  const h = Number(clone.getAttribute('height')) || 600
  const scale = Math.min(2, 8192 / Math.max(w, h))
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  await img.decode().catch(() => undefined)
  const cv = el('canvas')
  cv.width = Math.max(1, Math.round(w * scale))
  cv.height = Math.max(1, Math.round(h * scale))
  const c = cv.getContext('2d')!
  c.drawImage(img, 0, 0, cv.width, cv.height)
  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'))
  const ok = blob ? download(`${base}-${current}.png`, blob) : false
  const preview = el('img')
  preview.src = cv.toDataURL('image/png')
  preview.style.maxWidth = '100%'
  preview.dataset.amPng = String(cv.width)
  dialog(app, tr(`PNG ${cv.width}×${cv.height}${ok ? ' (내려받기 시작)' : ''}`, `PNG ${cv.width}×${cv.height}${ok ? ' (download started)' : ''}`), preview)
}
