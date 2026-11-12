/** PDF: pdf.js (Apache-2.0) in a module Web Worker (pdf.js falls back to the main thread when the
 *  worker cannot start). Pages are placeholders sized from the document and drawn lazily into
 *  devicePixelRatio canvases as they scroll near the view; far-away canvases are released. A text
 *  layer makes text selectable. cMaps (Korean/CJK CID fonts), standard fonts and image decoders are
 *  vendored under vendor/pdf-assets because there is no network. */
import {
  getDocument,
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask
} from '../../vendor/pdf.js'
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, clampZoom, createZoom, h, showMessage } from '../core/ui.ts'

const asset = (p: string) => new URL(`../../vendor/${p}`, import.meta.url).href

/** 100% zoom shows a PDF point as 1/72 inch at 96 CSS px per inch. */
const CSS_UNITS = 96 / 72
/** Canvas pixel budget per page (stays under iOS Safari's 16.7 MP canvas limit). */
const MAX_PIXELS = 16_000_000
/** Drawn canvases kept alive; the farthest ones are released beyond this. */
const KEEP = 12

const STYLE = `
/* Pages centre in the view; one wider than the view starts at the left edge and scrolls sideways. */
.fp-pdf { box-sizing: border-box; padding: 0 12px 12px; }
.fp-pdf-page { position: relative; overflow: hidden; margin: 12px auto; }
.fp-pdf-page > canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.fp-pdf-page:not(.drawn)::before { content: attr(data-page); position: absolute; inset: 0; display: grid; place-items: center;
  color: #c4c4c4; font-size: 28px; font-weight: 600; }
.fp-pdf-page .fp-pdf-err { position: absolute; inset: 0; display: grid; place-items: center; color: #b91c1c; padding: 12px; text-align: center; }
.fp-pdf-nav-input { font: inherit; width: 3.4em; min-height: 26px; box-sizing: border-box; text-align: center; padding: 0 4px;
  color: var(--orca-foreground, inherit); background: var(--orca-background, #fff);
  border: 1px solid var(--orca-input, var(--orca-border, #ccc)); border-radius: var(--orca-radius, 6px); }
.fp-pdf-nav-input:focus-visible { outline: 2px solid var(--orca-ring, #48f); outline-offset: 1px; }
.fp-pdf-total { color: var(--orca-muted-foreground, #666); white-space: nowrap; font-variant-numeric: tabular-nums; }
.fp-pdf-pw { display: flex; flex-direction: column; gap: 8px; align-items: stretch; width: min(320px, 100%); }
.fp-pdf-pw input, .fp-pdf-pw button { font: inherit; min-height: 34px; box-sizing: border-box; padding: 0 10px;
  border: 1px solid var(--orca-input, var(--orca-border, #ccc)); border-radius: var(--orca-radius, 6px);
  color: var(--orca-foreground, inherit); background: var(--orca-background, #fff); }
.fp-pdf-pw button { background: var(--orca-primary, #333); color: var(--orca-primary-foreground, #fff); cursor: pointer; }
.fp-pdf-pw .bad { color: var(--orca-destructive, #dc2626); }
@media (max-width: 600px) {
  .fp-pdf { padding: 0 8px 8px; }
  .fp-pdf-page { margin: 8px auto; }
  .fp-pdf-nav-input { min-height: 32px; width: 3em; }
}
.textLayer { position: absolute; text-align: initial; inset: 0; overflow: clip; opacity: 1; line-height: 1;
  letter-spacing: normal; word-spacing: normal; -webkit-text-size-adjust: none; text-size-adjust: none;
  forced-color-adjust: none; transform-origin: 0 0; caret-color: CanvasText; z-index: 0;
  --min-font-size: 1; --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size)); }
.textLayer span, .textLayer br { color: transparent; position: absolute; white-space: pre; cursor: text;
  transform-origin: 0% 0%; -webkit-user-select: text; user-select: text; }
.textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) { z-index: 1; --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height)); --scale-x: 1; --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
.textLayer .markedContent { display: contents; }
.textLayer span[role="img"] { -webkit-user-select: none; user-select: none; cursor: default; }
.textLayer ::selection { background: rgba(0, 0, 255, .25); color: transparent; }
.textLayer br::selection { background: transparent; }
.textLayer .endOfContent { display: block; position: absolute; inset: 100% 0 0; z-index: 0; cursor: default; user-select: none; }
`

/** True when animation frames are being delivered (probe: one rAF within 100 ms). */
function framesRunning(): Promise<boolean> {
  if (document.visibilityState === 'hidden' || typeof requestAnimationFrame !== 'function') return Promise.resolve(false)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => {
      if (done) return
      done = true
      resolve(v)
    }
    try {
      requestAnimationFrame(() => finish(true))
    } catch {
      finish(false)
    }
    setTimeout(() => finish(false), 100)
  })
}

interface Slot {
  n: number
  el: HTMLDivElement
  /** Page size in PDF points (rotation applied). */
  w: number
  h: number
  canvas?: HTMLCanvasElement
  task?: RenderTask
  /** Viewport scale the canvas was drawn at; 0 when not drawn. */
  drawnAt: number
  visible: boolean
  text?: TextLayer
  failed?: boolean
}

function friendly(ctx: PreviewContext, err: unknown): Error {
  const e = err as { name?: string; message?: string }
  if (e?.name === 'PasswordException') {
    return new PreviewError(ctx.tr('암호로 보호된 PDF입니다', 'This PDF is password-protected'), ctx.tr('암호를 입력해야 열 수 있습니다.', 'A password is required to open it.'))
  }
  if (e?.name === 'InvalidPDFException' || e?.name === 'FormatError' || /Invalid PDF|No PDF header/i.test(e?.message ?? '')) {
    return new PreviewError(
      ctx.tr('PDF 파일을 열 수 없습니다', 'Cannot open this PDF'),
      ctx.tr('파일이 손상되었거나 PDF 형식이 아닙니다.', 'The file is damaged or is not a PDF.')
    )
  }
  return err instanceof Error ? err : new Error(String(err))
}

export async function render(ctx: PreviewContext): Promise<() => void> {
  const { bytes, root, tr, signal } = ctx
  GlobalWorkerOptions.workerSrc = asset('pdf.worker.min.js')
  const task: PDFDocumentLoadingTask = getDocument({
    // pdf.js transfers the buffer to its worker; hand it a copy so ctx.bytes stays intact.
    data: bytes.slice(),
    cMapUrl: asset('pdf-assets/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('pdf-assets/standard_fonts/'),
    wasmUrl: asset('pdf-assets/wasm/'),
    isEvalSupported: false,
    enableXfa: false
  })
  const cleanups: (() => void)[] = [() => void task.destroy().catch(() => {})]
  const cleanup = () => {
    for (const c of cleanups.splice(0)) {
      try {
        c()
      } catch {
        // keep cleaning
      }
    }
  }
  signal.addEventListener('abort', cleanup, { once: true })

  // A password prompt lets render() return (the shell leaves the loading state) while the
  // document keeps loading once the person types the password.
  let promptOpened!: () => void
  const prompted = new Promise<null>((resolve) => (promptOpened = () => resolve(null)))
  task.onPassword = (update, reason) => {
    passwordForm(ctx, reason === PasswordResponses.INCORRECT_PASSWORD, update)
    promptOpened()
  }

  let doc: PDFDocumentProxy | null
  try {
    doc = await Promise.race([task.promise, prompted])
  } catch (err) {
    cleanup()
    throw friendly(ctx, err)
  }
  if (signal.aborted) return cleanup
  if (doc) {
    await mount(ctx, doc, cleanups)
    return cleanup
  }
  task.promise.then(
    (d) => {
      if (!signal.aborted) return mount(ctx, d, cleanups)
    },
    (err) => {
      if (signal.aborted) return
      const e = friendly(ctx, err)
      showMessage(root, tr('미리보기를 표시할 수 없습니다', 'Cannot preview this file'), e instanceof PreviewError ? e.hint : e.message)
    }
  ).catch((err) => {
    if (!signal.aborted) showMessage(root, tr('미리보기를 표시할 수 없습니다', 'Cannot preview this file'), String((err as Error)?.message ?? err))
  })
  return cleanup
}

function passwordForm(ctx: PreviewContext, wrong: boolean, submit: (pw: string) => void): void {
  const { root, tr } = ctx
  const box = h('div', 'fp-state')
  const form = h('form', 'fp-pdf-pw')
  const input = h('input')
  input.type = 'password'
  input.autocomplete = 'off'
  input.placeholder = tr('암호', 'Password')
  input.setAttribute('aria-label', input.placeholder)
  const ok = h('button', undefined, tr('열기', 'Open'))
  ok.type = 'submit'
  form.append(input, ok)
  box.append(
    h('style', undefined, STYLE),
    h('h2', undefined, tr('암호로 보호된 PDF입니다', 'This PDF is password-protected')),
    h('div', wrong ? 'bad' : undefined, wrong ? tr('암호가 올바르지 않습니다. 다시 입력하세요.', 'Incorrect password. Try again.') : tr('문서를 열려면 암호를 입력하세요.', 'Enter the password to open the document.')),
    form
  )
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!input.value) return
    ok.disabled = true
    submit(input.value)
  })
  root.replaceChildren(box)
  if (!ctx.compact) input.focus()
}

async function mount(ctx: PreviewContext, doc: PDFDocumentProxy, cleanups: (() => void)[]): Promise<void> {
  const { root, toolbar, tr, signal, bytes } = ctx
  const N = doc.numPages
  const first = await doc.getPage(1)
  if (signal.aborted) return
  const vp1 = first.getViewport({ scale: 1 })

  const style = h('style', undefined, STYLE)
  const container = h('div', 'fp-pdf')
  const slots: Slot[] = []
  for (let n = 1; n <= N; n++) {
    const el = h('div', 'fp-page fp-pdf-page')
    el.dataset.page = String(n)
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', tr(`${n}쪽`, `Page ${n}`))
    slots.push({ n, el, w: vp1.width, h: vp1.height, drawnAt: 0, visible: false })
    container.append(el)
  }

  let scale = 1
  const k = () => scale * CSS_UNITS
  const sizeSlot = (s: Slot) => {
    s.el.style.width = `${Math.round(s.w * k())}px`
    s.el.style.height = `${Math.round(s.h * k())}px`
  }
  const layout = () => {
    container.style.setProperty('--scale-factor', String(k()))
    container.style.setProperty('--total-scale-factor', String(k()))
    container.style.setProperty('--scale-round-x', '1px')
    container.style.setProperty('--scale-round-y', '1px')
    for (const s of slots) sizeSlot(s)
  }

  // ---- current page tracking -------------------------------------------------------------
  let current = 1
  const pageAt = (y: number): number => {
    let lo = 0
    let hi = slots.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (slots[mid].el.offsetTop <= y) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  // ---- drawing -----------------------------------------------------------------------------
  let busy = false
  const draw = async (s: Slot) => {
    const target = k()
    const page = await doc.getPage(s.n)
    if (signal.aborted) return
    const vp = page.getViewport({ scale: target })
    let ratio = window.devicePixelRatio || 1
    if (vp.width * vp.height * ratio * ratio > MAX_PIXELS) ratio = Math.sqrt(MAX_PIXELS / (vp.width * vp.height))
    const canvas = h('canvas')
    canvas.width = Math.max(1, Math.floor(vp.width * ratio))
    canvas.height = Math.max(1, Math.floor(vp.height * ratio))
    // pdf.js paces 'display' renders with requestAnimationFrame, which is paused while Orca's
    // window is hidden or occluded (and during Orca's own window captures). Fall back to the
    // 'print' intent, which renders without rAF, whenever frames are not being delivered.
    const intent = (await framesRunning()) ? 'display' : 'print'
    if (signal.aborted) return
    const t = page.render({ canvas, viewport: vp, intent, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null })
    s.task = t
    try {
      await t.promise
    } catch (err) {
      if ((err as Error)?.name === 'RenderingCancelledException') return
      s.failed = true
      s.drawnAt = target
      s.el.classList.add('drawn')
      s.el.append(h('div', 'fp-pdf-err', tr('이 페이지를 그릴 수 없습니다', 'Cannot draw this page')))
      return
    } finally {
      if (s.task === t) s.task = undefined
    }
    if (signal.aborted) return
    if (s.canvas) s.canvas.replaceWith(canvas)
    else s.el.prepend(canvas)
    s.canvas = canvas
    s.drawnAt = target
    s.el.classList.add('drawn')
    if (!s.text) {
      const layer = h('div', 'textLayer')
      s.el.append(layer)
      s.text = new TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
        container: layer,
        viewport: vp
      })
      s.text.render().catch(() => layer.remove())
    }
    evict()
  }
  const evict = () => {
    const drawn = slots.filter((s) => s.canvas && !s.visible)
    if (drawn.length + slots.filter((s) => s.canvas && s.visible).length <= KEEP) return
    drawn.sort((a, b) => Math.abs(b.n - current) - Math.abs(a.n - current))
    let excess = slots.filter((s) => s.canvas).length - KEEP
    for (const s of drawn) {
      if (excess-- <= 0) break
      s.canvas?.remove()
      s.canvas = undefined
      s.drawnAt = 0
      s.el.classList.remove('drawn')
    }
  }
  const pump = async () => {
    if (busy) return
    busy = true
    try {
      for (;;) {
        if (signal.aborted) return
        const want = slots
          .filter((s) => s.visible && !s.failed && s.drawnAt !== k())
          .sort((a, b) => Math.abs(a.n - current) - Math.abs(b.n - current))[0]
        if (!want) return
        await draw(want)
      }
    } finally {
      busy = false
    }
  }

  // Which pages are in or near the view, from scroll position and page offsets. This does not
  // depend on IntersectionObserver or rAF, which stop while the window is hidden or occluded.
  let visibleNow: Slot[] = []
  const updateVisible = () => {
    for (const s of visibleNow) s.visible = false
    const vh = Math.max(root.clientHeight, 1)
    const top = root.scrollTop - vh * 0.5
    const bottom = root.scrollTop + vh * 1.5
    const next: Slot[] = []
    for (let i = Math.max(0, pageAt(top) - 1); i < slots.length; i++) {
      const s = slots[i]
      if (s.el.offsetTop > bottom) break
      if (s.el.offsetTop + s.el.offsetHeight >= top) next.push(s)
    }
    const cur = slots[current - 1]
    if (cur && !next.includes(cur)) next.push(cur)
    for (const s of next) s.visible = true
    visibleNow = next
  }
  const refresh = () => {
    current = pageAt(root.scrollTop + root.clientHeight * 0.3)
    updateVisible()
    showCurrent()
    void pump()
  }
  // IntersectionObserver stays as an extra trigger only.
  const io = new IntersectionObserver(() => refresh(), { root, rootMargin: '50% 0px 50% 0px' })
  cleanups.push(() => io.disconnect())
  cleanups.push(() => {
    for (const s of slots) {
      s.task?.cancel()
      s.text?.cancel()
    }
  })

  // ---- zoom --------------------------------------------------------------------------------
  // Fit the page in view (mixed portrait/landscape documents fit whichever page is current).
  const fitWidth = () => {
    const avail = root.clientWidth - (ctx.compact ? 18 : 26)
    return avail > 0 ? clampZoom(avail / (slots[current - 1].w * CSS_UNITS), 0.1, 8) : 1
  }
  const autoScale = () => (ctx.compact ? fitWidth() : Math.min(1, fitWidth()))
  let redrawTimer = 0
  let auto = true
  let fitting = false
  const zoom = createZoom(
    1,
    (s) => {
      if (!fitting) auto = false
      // keep the same spot of the current page at the top of the view
      const cur = slots[pageAt(root.scrollTop) - 1]
      const frac = cur.el.offsetHeight ? (root.scrollTop - cur.el.offsetTop) / cur.el.offsetHeight : 0
      const fx = cur.el.offsetWidth ? (root.scrollLeft + root.clientWidth / 2 - cur.el.offsetLeft) / cur.el.offsetWidth : 0.5
      scale = s
      layout()
      root.scrollTop = cur.el.offsetTop + frac * cur.el.offsetHeight
      root.scrollLeft = cur.el.offsetLeft + Math.min(1, Math.max(0, fx)) * cur.el.offsetWidth - root.clientWidth / 2
      for (const sl of slots) if (sl.task) sl.task.cancel()
      clearTimeout(redrawTimer)
      redrawTimer = window.setTimeout(() => {
        updateVisible()
        void pump()
      }, 150)
    },
    undefined,
    { min: 0.1, max: 8 }
  )
  const setAuto = (v: number) => {
    fitting = true
    zoom.set(v)
    fitting = false
    auto = true
  }
  zoom.fit = () => setAuto(fitWidth())
  cleanups.push(() => clearTimeout(redrawTimer))

  // ---- toolbar -----------------------------------------------------------------------------
  const prev = toolbar.button({ label: '‹', title: tr('이전 페이지', 'Previous page'), onClick: () => go(current - 1) })
  const next = toolbar.button({ label: '›', title: tr('다음 페이지', 'Next page'), onClick: () => go(current + 1) })
  const input = h('input', 'fp-pdf-nav-input')
  input.type = 'text'
  input.inputMode = 'numeric'
  input.enterKeyHint = 'go'
  input.title = tr('페이지 번호', 'Page number')
  input.setAttribute('aria-label', input.title)
  const total = h('span', 'fp-pdf-total', `/ ${N}`)
  prev.after(input, total)
  const commit = () => {
    const n = parseInt(input.value, 10)
    if (Number.isFinite(n)) go(n)
    else input.value = String(current)
  }
  input.addEventListener('change', commit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit()
      input.blur()
    }
  })
  input.addEventListener('focus', () => input.select())
  const showCurrent = () => {
    if (document.activeElement !== input) input.value = String(current)
    prev.disabled = current <= 1
    next.disabled = current >= N
  }
  const go = (n: number) => {
    const p = Math.min(N, Math.max(1, n))
    root.scrollTop = slots[p - 1].el.offsetTop - (ctx.compact ? 8 : 12)
    current = p
    showCurrent()
  }
  toolbar.info(formatBytes(bytes.byteLength))
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)

  // Scroll events still arrive while frames are paused; the work per event is a binary search.
  root.onscroll = () => refresh()
  root.addEventListener(
    'keydown',
    (e) => {
      if (e.target !== root || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'n' || e.key === 'j') go(current + 1)
      else if (e.key === 'p' || e.key === 'k') go(current - 1)
      else return
      e.preventDefault()
    },
    { signal }
  )

  // ---- show --------------------------------------------------------------------------------
  root.replaceChildren(style, container)
  layout()
  setAuto(autoScale())
  clearTimeout(redrawTimer)
  showCurrent()
  for (const s of slots) io.observe(s.el)
  updateVisible()
  await pump()

  // ResizeObserver is paced by rendering too; window resize events are the fallback.
  let lastW = root.clientWidth
  let lastH = root.clientHeight
  const onResize = () => {
    if (Math.abs(root.clientWidth - lastW) < 2 && Math.abs(root.clientHeight - lastH) < 2) return
    const widthChanged = Math.abs(root.clientWidth - lastW) >= 2
    lastW = root.clientWidth
    lastH = root.clientHeight
    if (auto && widthChanged) setAuto(autoScale())
    refresh()
  }
  const ro = new ResizeObserver(onResize)
  ro.observe(root)
  window.addEventListener('resize', onResize, { signal })
  cleanups.push(() => ro.disconnect())

  // Real sizes of the other pages, in the background (mixed page sizes and rotations).
  void (async () => {
    for (let n = 2; n <= N; n++) {
      if (signal.aborted) return
      const v = (await doc.getPage(n)).getViewport({ scale: 1 })
      const s = slots[n - 1]
      if (Math.abs(v.width - s.w) > 0.5 || Math.abs(v.height - s.h) > 0.5) {
        s.w = v.width
        s.h = v.height
        sizeSlot(s)
        updateVisible()
        void pump()
      }
      if (n % 50 === 0) await new Promise((r) => setTimeout(r, 0))
    }
  })().catch(() => {})
}
