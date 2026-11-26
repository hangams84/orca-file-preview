/** AutoCAD drawings (.dwg, .dwt): LibreDWG (WebAssembly, in a worker) reads the file, scene.ts turns
 *  it into layered primitives, view.ts draws them on a canvas with pan/zoom, layouts and layers.
 *  When LibreDWG cannot read a file, the preview image stored in the file is shown instead. */
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext, type ZoomController } from '../core/types.ts'
import { bindZoomGestures, h, objectUrl, stepZoom } from '../core/ui.ts'
import { buildScene, type Ent, type RawColor, type Scene } from './dwg/scene.ts'
import { dwgVersion, extractThumbnail, type Thumbnail, VERSION_LABELS } from './dwg/thumbnail.ts'
import { DwgView } from './dwg/view.ts'

const CSS = `
.dwg-stage { position: absolute; inset: 0; overflow: hidden; }
.dwg-layers { position: absolute; top: 8px; right: 8px; bottom: 8px; width: min(280px, calc(100% - 16px)); z-index: 2;
  display: flex; flex-direction: column; background: var(--orca-popover, #fff); color: var(--orca-popover-foreground, #111);
  border: 1px solid var(--orca-border, #ddd); border-radius: var(--orca-radius, 6px); box-shadow: 0 4px 16px rgba(0,0,0,.25); }
.dwg-layers[hidden] { display: none; }
.dwg-layers header { display: flex; gap: 4px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--orca-border, #ddd); font-weight: 600; }
.dwg-layers header span { flex: 1; }
.dwg-layers header button { font: inherit; font-weight: 400; font-size: 12px; min-height: 24px; padding: 0 6px; cursor: pointer;
  color: var(--orca-secondary-foreground, inherit); background: var(--orca-secondary, #eee); border: 1px solid var(--orca-input, #ccc); border-radius: 4px; }
.dwg-layers ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1; }
.dwg-layers li label { display: flex; align-items: center; gap: 8px; padding: 3px 10px; cursor: pointer; }
.dwg-layers li label:hover { background: var(--orca-accent, #eee); }
.dwg-layers .sw { width: 12px; height: 12px; border-radius: 2px; flex: none; border: 1px solid rgba(128,128,128,.6); }
.dwg-layers .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dwg-layers .ct { color: var(--orca-muted-foreground, #777); font-size: 11px; font-variant-numeric: tabular-nums; }
.dwg-note { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px); z-index: 1; font-size: 12px; padding: 4px 8px;
  border-radius: 4px; background: var(--orca-card, rgba(255,255,255,.9)); color: var(--orca-muted-foreground, #555); border: 1px solid var(--orca-border, #ddd); }
.dwg-empty { position: absolute; inset: 0; pointer-events: none; }
.dwg-thumb { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 100%; padding: 16px; box-sizing: border-box; text-align: center; }
.dwg-thumb img { max-width: min(100%, 640px); image-rendering: auto; background: #fff; border: 1px solid var(--orca-border, #ddd); box-shadow: 0 1px 4px rgba(0,0,0,.2); }
.dwg-thumb p { margin: 0; max-width: 560px; color: var(--orca-muted-foreground, #666); }
.dwg-thumb strong { color: var(--orca-foreground, inherit); }
`

const UNITS: Record<number, [string, string]> = {
  1: ['인치', 'inches'],
  2: ['피트', 'feet'],
  3: ['마일', 'miles'],
  4: ['mm', 'mm'],
  5: ['cm', 'cm'],
  6: ['m', 'm'],
  7: ['km', 'km'],
  8: ['마이크로인치', 'microinches'],
  9: ['밀', 'mils'],
  10: ['야드', 'yards'],
  11: ['옹스트롬', 'Å'],
  12: ['nm', 'nm'],
  13: ['µm', 'µm'],
  14: ['dm', 'dm']
}

interface WorkerResult {
  ok: boolean
  db?: Ent
  version?: { type?: string; hdr?: string; description?: string } | null
  error?: number
  message?: string
  thumbnail?: { type: number; data: Uint8Array } | null
  layerColors?: Record<string, RawColor>
  unknownEntities?: number
  ms?: { engine: number; read: number; convert: number }
}

export async function render(ctx: PreviewContext): Promise<() => void> {
  const { tr, signal, bytes } = ctx
  const ver = dwgVersion(bytes)
  if (!ver) {
    throw new PreviewError(
      'dwg-not-dwg',
      tr('DWG 파일이 아니거나 손상되었습니다 (파일 머리글이 AC10xx로 시작하지 않습니다).', 'This is not a DWG file or it is damaged (the header does not start with AC10xx).')
    )
  }
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)
  signal.addEventListener('abort', () => style.remove(), { once: true })

  const result = await readInWorker(ctx)
  if (signal.aborted) return () => {}
  const label = `${VERSION_LABELS[ver.code] ?? ver.code} (${ver.code})`

  if (!result.ok || !result.db) {
    console.warn('dwg: LibreDWG could not read the file:', result.message)
    const thumb = extractThumbnail(bytes) ?? thumbFromWorker(result.thumbnail)
    if (thumb) return showThumbnail(ctx, thumb, label, result.message ?? '')
    throw new PreviewError(
      'dwg-read',
      tr(
        `이 도면(${label})을 LibreDWG가 읽지 못했고, 파일 안에 미리보기 이미지도 없습니다. 파일이 손상되었거나 아직 지원하지 않는 변형일 수 있습니다.`,
        `LibreDWG could not read this drawing (${label}) and the file has no stored preview image. The file may be damaged or use a variant that is not supported yet.`
      )
    )
  }

  const scene = buildScene(result.db, { measure: textMeasure(), layerColors: result.layerColors })
  const drawable = scene.spaces.some((s) => s.prims.length > 0)
  if (!drawable) {
    const thumb = extractThumbnail(bytes) ?? thumbFromWorker(result.thumbnail)
    if (thumb) return showThumbnail(ctx, thumb, label, tr('그릴 수 있는 객체가 없습니다', 'no drawable entities'), true)
  }
  return showScene(ctx, scene, result, label)
}

function thumbFromWorker(t: WorkerResult['thumbnail']): Thumbnail | null {
  if (!t?.data?.length) return null
  if (t.type === 6) return { mime: 'image/png', bytes: t.data }
  if (t.type === 2) {
    // LibreDWG hands the DIB without the file header
    const dib = t.data
    const out = new Uint8Array(14 + dib.length)
    const dv = new DataView(out.buffer)
    out[0] = 0x42
    out[1] = 0x4d
    dv.setUint32(2, out.length, true)
    const hdr = new DataView(dib.buffer, dib.byteOffset, dib.byteLength)
    const bits = dib.length >= 16 ? hdr.getUint16(14, true) : 8
    let colours = dib.length >= 36 ? hdr.getUint32(32, true) : 0
    if (!colours && bits <= 8) colours = 1 << bits
    dv.setUint32(10, 14 + (dib.length >= 4 ? hdr.getUint32(0, true) : 40) + colours * 4, true)
    out.set(dib, 14)
    return { mime: 'image/bmp', bytes: out }
  }
  return null
}

function textMeasure(): (s: string) => number {
  const c = document.createElement('canvas').getContext('2d')
  if (!c) return (s) => s.length * 0.62
  c.font = '100px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif'
  // drawn at 1/0.72 em per unit of cap height (see view.ts)
  return (s) => c.measureText(s).width / 72
}

function readInWorker(ctx: PreviewContext): Promise<WorkerResult> {
  const { tr, signal } = ctx
  let worker: Worker
  try {
    worker = new Worker(new URL('./dwg/worker.js', import.meta.url), { type: 'module' })
  } catch (err) {
    console.warn('dwg: worker unavailable', err)
    return Promise.reject(new PreviewError('dwg-engine', tr('DWG 엔진(LibreDWG)을 시작할 수 없습니다.', 'The DWG engine (LibreDWG) could not be started.')))
  }
  const started = Date.now()
  let phase = tr('DWG 엔진(LibreDWG) 불러오는 중', 'Loading the DWG engine (LibreDWG)')
  const status = () => {
    const line = ctx.root.querySelector('.fp-state[role="status"] > div:last-child')
    if (line) line.textContent = `${phase}… ${Math.round((Date.now() - started) / 1000)} s`
  }
  status()
  const ticker = setInterval(status, 1000)
  const limit = 60_000 + (ctx.bytes.byteLength / (1024 * 1024)) * 6000
  return new Promise<WorkerResult>((resolve, reject) => {
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearInterval(ticker)
      signal.removeEventListener('abort', onAbort)
      worker.terminate()
      fn()
    }
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new PreviewError(
              'dwg-timeout',
              tr(`이 도면은 ${Math.round(limit / 1000)}초 안에 읽지 못했습니다. 너무 크거나 손상되었을 수 있습니다.`, `This drawing could not be read within ${Math.round(limit / 1000)} s. It may be too large or damaged.`)
            )
          )
        ),
      limit
    )
    const onAbort = () => finish(() => reject(new DOMException('aborted', 'AbortError')))
    signal.addEventListener('abort', onAbort, { once: true })
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d.progress) {
        phase =
          d.progress === 'reading'
            ? tr('도면을 읽는 중', 'Reading the drawing')
            : d.progress === 'converting'
              ? tr('객체를 변환하는 중', 'Converting entities')
              : phase
        status()
        return
      }
      finish(() => resolve(d as WorkerResult))
    }
    worker.onerror = (e) => {
      e.preventDefault?.()
      console.warn('dwg: worker error', e.message)
      // a crash inside the engine (out of memory, an abort in the C code) ends here
      finish(() => resolve({ ok: false, message: e.message || 'worker error' }))
    }
    const buffer = ctx.bytes.slice().buffer
    worker.postMessage({ buffer }, [buffer])
  })
}

function showThumbnail(ctx: PreviewContext, thumb: Thumbnail, label: string, reason: string, empty = false): () => void {
  const { tr, root, toolbar, signal } = ctx
  const box = h('div', 'dwg-thumb')
  const img = h('img')
  img.alt = tr('DWG 파일에 저장된 미리보기 이미지', 'Preview image stored in the DWG file')
  img.src = objectUrl(thumb.bytes, thumb.mime, signal)
  // the stored preview is tiny (often 180 × 120 or so): show it larger, smoothly
  img.addEventListener('load', () => {
    const k = Math.max(1, Math.min(4, Math.floor(480 / Math.max(1, img.naturalWidth))))
    img.style.width = `${img.naturalWidth * k}px`
  })
  const p = h('p')
  p.append(
    h('strong', undefined, tr('도면 대신 파일에 저장된 미리보기 이미지를 보여 줍니다.', 'Showing the preview image stored in the file instead of the drawing.')),
    document.createElement('br'),
    empty
      ? tr(
          `이 도면(${label})에는 이 미리보기가 그릴 수 있는 객체가 없습니다 (예: 3D 솔리드, 나선). 이미지는 AutoCAD가 마지막으로 저장할 때 만든 작은 그림입니다.`,
          `This drawing (${label}) has no entities this preview can draw (for example 3D solids or helixes). The image is the small picture AutoCAD made when the file was last saved.`
        )
      : tr(
          `LibreDWG가 이 도면(${label})을 읽지 못했습니다. 이미지는 AutoCAD가 마지막으로 저장할 때 만든 작은 그림이며 확대·레이어 기능은 쓸 수 없습니다.`,
          `LibreDWG could not read this drawing (${label}). The image is the small picture AutoCAD made when the file was last saved; zoom and layers are not available.`
        )
  )
  box.append(img, p)
  if (reason) {
    const more = h('details', 'fp-details')
    more.append(h('summary', undefined, tr('자세히', 'Details')), h('pre', undefined, reason))
    box.append(more)
  }
  root.replaceChildren(box)
  toolbar.info(`${label} · ${tr('미리보기 이미지', 'preview image')} · ${formatBytes(ctx.bytes.byteLength)}`)
  return () => {}
}

function showScene(ctx: PreviewContext, scene: Scene, result: WorkerResult, label: string): () => void {
  const { tr, root, toolbar, signal } = ctx
  root.style.overflow = 'hidden'
  const stage = h('div', 'dwg-stage')
  root.replaceChildren(stage)
  const view = new DwgView(stage, scene, ctx.theme() === 'dark')
  view.canvas.setAttribute('role', 'img')
  let bgOverride = false

  // ---- toolbar ----
  if (scene.spaces.length > 1) {
    const sel = toolbar.select(
      tr('모형/배치', 'Model / layout'),
      scene.spaces.map((s, i) => ({ value: String(i), label: s.paper ? s.name : tr('모형', 'Model') })),
      (v) => {
        view.setSpace(Number(v))
        updateInfo()
      }
    )
    sel.classList.add('dwg-space')
    sel.value = String(scene.spaces.indexOf(view.current))
  }
  const layersBtn = toolbar.button({ label: tr('레이어', 'Layers'), title: tr('레이어 표시/숨김', 'Show or hide layers'), onClick: () => togglePanel() })
  layersBtn.setAttribute('aria-pressed', 'false')
  const bgBtn = toolbar.button({
    label: '◐',
    title: tr('배경 어둡게/밝게', 'Dark / light background'),
    onClick: () => {
      bgOverride = true
      view.dark = !view.dark
      bgBtn.setAttribute('aria-pressed', String(view.dark))
      view.redraw()
    }
  })
  bgBtn.setAttribute('aria-pressed', String(view.dark))
  const lwBtn = toolbar.button({
    label: tr('선 두께', 'LW'),
    title: tr('선 두께 표시', 'Show line weights'),
    onClick: () => {
      view.lineweights = !view.lineweights
      lwBtn.setAttribute('aria-pressed', String(view.lineweights))
      view.redraw()
    }
  })
  lwBtn.setAttribute('aria-pressed', 'true')

  // ---- zoom controller relative to fit ----
  const zl: ((s: number) => void)[] = []
  const zoom: ZoomController = {
    get: () => view.zoom,
    set: (z) => view.setZoom(z),
    fit: () => view.fit(),
    onChange: (l) => {
      zl.push(l)
    }
  }
  view.onChange(() => {
    for (const l of zl) l(view.zoom)
  })
  toolbar.zoom(zoom)

  // ---- layers panel ----
  const panel = h('div', 'dwg-layers')
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', tr('레이어', 'Layers'))
  const head = h('header')
  const all = (on: boolean) => {
    scene.layers.forEach((_, i) => (view.layerOn[i] = on))
    for (const cb of panel.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) cb.checked = on
    view.redraw()
  }
  const allOn = h('button', undefined, tr('모두 켜기', 'All on'))
  allOn.type = 'button'
  allOn.onclick = () => all(true)
  const allOff = h('button', undefined, tr('모두 끄기', 'All off'))
  allOff.type = 'button'
  allOff.onclick = () => all(false)
  const close = h('button', undefined, '✕')
  close.type = 'button'
  close.title = tr('닫기', 'Close')
  close.setAttribute('aria-label', close.title)
  close.onclick = () => togglePanel(false)
  head.append(h('span', undefined, `${tr('레이어', 'Layers')} (${scene.layers.filter((l) => l.count > 0).length})`), allOn, allOff, close)
  const list = h('ul')
  const order = scene.layers.map((l, i) => ({ l, i })).filter(({ l }) => l.count > 0 || l.name === '0')
  order.sort((a, b) => a.l.name.localeCompare(b.l.name, undefined, { numeric: true }))
  for (const { l, i } of order) {
    const li = h('li')
    const lab = h('label')
    const cb = h('input')
    cb.type = 'checkbox'
    cb.checked = view.layerOn[i]
    cb.onchange = () => {
      view.layerOn[i] = cb.checked
      view.redraw()
    }
    const sw = h('span', 'sw')
    sw.style.background = view.css(l.color)
    lab.append(cb, sw, h('span', 'nm', l.name + (l.frozen ? ` (${tr('동결', 'frozen')})` : '')), h('span', 'ct', String(l.count)))
    li.append(lab)
    list.append(li)
  }
  panel.append(head, list)
  stage.append(panel)
  const togglePanel = (show = panel.hidden) => {
    panel.hidden = !show
    layersBtn.setAttribute('aria-pressed', String(show))
  }

  // ---- notes ----
  const skipped = Object.entries(scene.stats.skipped).filter(([k]) => k !== 'VIEWPORT')
  const notes: string[] = []
  if (scene.stats.truncated) notes.push(tr('도면이 너무 커서 일부만 표시합니다.', 'The drawing is very large: only part of it is shown.'))
  if (skipped.length) {
    notes.push(
      tr('표시하지 않은 객체: ', 'Not drawn: ') +
        skipped
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([k, n]) => `${k} ×${n}`)
          .join(', ')
    )
  }
  if (!scene.spaces.some((sp) => sp.prims.length > 0)) {
    const empty = h('div', 'fp-state dwg-empty')
    empty.append(
      h('h2', undefined, tr('표시할 객체가 없습니다', 'Nothing to show')),
      h('div', undefined, tr('LibreDWG가 파일을 읽었지만 이 미리보기가 그릴 수 있는 객체가 없고, 저장된 미리보기 이미지도 없습니다.', 'LibreDWG read the file, but it has no entities this preview can draw and no stored preview image.'))
    )
    stage.append(empty)
  }
  if ((result.error ?? 0) > 0) notes.push(tr(`LibreDWG 경고 코드 ${result.error}`, `LibreDWG warning code ${result.error}`))
  if (notes.length) {
    const note = h('div', 'dwg-note', notes.join(' · '))
    note.title = notes.join('\n')
    stage.append(note)
  }

  // ---- info ----
  const header: Ent = result.db?.header ?? {}
  const units = UNITS[header.INSUNITS as number]
  function updateInfo() {
    const b = view.current.box
    const w = b.empty ? 0 : b.maxX - b.minX
    const hh = b.empty ? 0 : b.maxY - b.minY
    const unitText = view.current.paper ? tr('용지', 'paper') : units ? tr(units[0], units[1]) : tr('단위 없음', 'unitless')
    const text = `${label} · ${unitText} · ${fmtNum(w)} × ${fmtNum(hh)} · ${scene.stats.entities.toLocaleString()} ${tr('객체', 'entities')} · ${formatBytes(ctx.bytes.byteLength)}`
    toolbar.info(text)
    view.canvas.setAttribute(
      'aria-label',
      tr(`DWG 도면: ${view.current.paper ? view.current.name : '모형'}, ${label}`, `DWG drawing: ${view.current.paper ? view.current.name : 'model space'}, ${label}`)
    )
    view.canvas.title = `${tr('범위', 'Extents')}: (${fmtNum(b.minX)}, ${fmtNum(b.minY)}) – (${fmtNum(b.maxX)}, ${fmtNum(b.maxY)})`
  }
  updateInfo()

  // ---- interaction ----
  const ro = new ResizeObserver(() => view.resize())
  ro.observe(stage)
  view.resize()
  bindInteraction(view, stage, signal)
  bindZoomGestures(stage, zoom, signal)
  ctx.onTheme((t) => {
    if (bgOverride) return
    view.dark = t === 'dark'
    bgBtn.setAttribute('aria-pressed', String(view.dark))
    view.redraw()
  })
  ;(window as unknown as { __dwgView?: DwgView }).__dwgView = view
  if (result.ms) console.info(`dwg: engine ${result.ms.engine} ms, read ${result.ms.read} ms, convert ${result.ms.convert} ms, ${scene.stats.prims} primitives`)
  return () => {
    ro.disconnect()
    view.destroy()
    delete (window as unknown as { __dwgView?: DwgView }).__dwgView
  }
}

function bindInteraction(view: DwgView, stage: HTMLElement, signal: AbortSignal): void {
  const c = view.canvas
  const pts = new Map<number, { x: number; y: number }>()
  let last: { x: number; y: number } | null = null
  c.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 && e.button !== 1) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) {
        last = { x: e.clientX, y: e.clientY }
        c.setPointerCapture?.(e.pointerId)
        c.style.cursor = 'grabbing'
      } else last = null
      e.preventDefault()
    },
    { signal }
  )
  c.addEventListener(
    'pointermove',
    (e) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1 && last) {
        view.pan(e.clientX - last.x, e.clientY - last.y)
        last = { x: e.clientX, y: e.clientY }
      }
    },
    { signal }
  )
  const up = (e: PointerEvent) => {
    pts.delete(e.pointerId)
    last = null
    c.style.cursor = 'grab'
  }
  c.addEventListener('pointerup', up, { signal })
  c.addEventListener('pointercancel', up, { signal })
  c.addEventListener('dblclick', () => view.fit(), { signal })
  // CAD-style: the wheel zooms about the cursor without a modifier (Ctrl + wheel is handled by bindZoomGestures)
  stage.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
      const r = c.getBoundingClientRect()
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015))
      view.setZoom(view.zoom * k, { x: e.clientX - r.left, y: e.clientY - r.top })
    },
    { passive: false, signal }
  )
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      const step = 60
      if (e.key === 'ArrowLeft') view.pan(step, 0)
      else if (e.key === 'ArrowRight') view.pan(-step, 0)
      else if (e.key === 'ArrowUp') view.pan(0, step)
      else if (e.key === 'ArrowDown') view.pan(0, -step)
      else if (e.key === '+' || e.key === '=') view.setZoom(stepZoom(view.zoom, 1))
      else if (e.key === '-') view.setZoom(stepZoom(view.zoom, -1))
      else if (e.key === 'f' || e.key === 'F' || e.key === 'Home') view.fit()
      else return
      e.preventDefault()
    },
    { signal }
  )
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '–'
  const a = Math.abs(n)
  return a >= 1000 ? Math.round(n).toLocaleString() : a >= 10 ? n.toFixed(1) : n.toFixed(2)
}
