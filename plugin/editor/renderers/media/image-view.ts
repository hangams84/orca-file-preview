/** Shared image stage for GIF, BMP and SVG: centred on a checkerboard, fit to window by default,
 *  zoom (buttons, Ctrl+wheel, pinch) anchored on the view centre, pan by scrolling or dragging. */
import type { PreviewContext, ZoomController } from '../../core/types.ts'
import { createZoom, h } from '../../core/ui.ts'

const STYLE = `
.fp-img-stage { display: grid; place-items: center; min-width: 100%; min-height: 100%; width: max-content;
  padding: 12px; box-sizing: border-box; }
.fp-img-box { position: relative; display: block; line-height: 0; box-shadow: 0 1px 4px rgba(0,0,0,.25);
  --c1: #ffffff; --c2: #d9d9d9;
  background-color: var(--c1);
  background-image: conic-gradient(var(--c2) 25%, var(--c1) 0 50%, var(--c2) 0 75%, var(--c1) 0);
  background-size: 16px 16px; }
.fp-img-box.bg-checker-dark { --c1: #3b3b3b; --c2: #2b2b2b; }
.fp-img-box.bg-white { background: #fff; }
.fp-img-box.bg-black { background: #000; }
.fp-img-box > img, .fp-img-box > canvas { display: block; width: 100%; height: 100%; user-select: none;
  -webkit-user-drag: none; }
.fp-img-box > canvas { position: absolute; inset: 0; }
.fp-img-box.pixelated > img, .fp-img-box.pixelated > canvas { image-rendering: pixelated; }
.fp-img-dragging { cursor: grabbing !important; }
`

export type Backdrop = 'checker-light' | 'checker-dark' | 'white' | 'black'
const BACKDROPS: Backdrop[] = ['checker-light', 'checker-dark', 'white', 'black']

function storedBackdrop(key: string): Backdrop | null {
  try {
    const v = localStorage.getItem(`file-preview.backdrop.${key}`) as Backdrop | null
    return v && BACKDROPS.includes(v) ? v : null
  } catch {
    return null
  }
}
function storeBackdrop(key: string, v: Backdrop): void {
  try {
    localStorage.setItem(`file-preview.backdrop.${key}`, v)
  } catch {
    // storage unavailable (private mode, sandbox): the choice lasts for this view only
  }
}

export interface ImageView {
  zoom: ZoomController
  /** The checkerboard box sized to the zoomed image; extra layers (a paused GIF frame) go inside. */
  box: HTMLElement
  stage: HTMLElement
  /** Re-attaches the stage to ctx.root (after showing another view such as the source). */
  show(): void
}

export function createImageView(
  ctx: PreviewContext,
  img: HTMLImageElement,
  natural: { width: number; height: number },
  opts: {
    pixelate: boolean
    /** Fit small images up to the window too (vectors stay sharp). */
    upscale?: boolean
    /** Remembered backdrop choice key ('image', 'svg'). */
    backdropKey: string
    /** Backdrop until the person picks one; omitted = checkerboard following the theme. */
    defaultBackdrop?: Backdrop
  }
): ImageView {
  const { root, signal, tr, toolbar } = ctx
  const style = h('style', undefined, STYLE)
  const stage = h('div', 'fp-img-stage')
  const box = h('div', 'fp-img-box')
  img.alt = ''
  img.draggable = false
  box.append(img)
  stage.append(box)

  // Backdrop behind transparent pixels: light/dark checkerboard, white or black.
  const themed = (): Backdrop => opts.defaultBackdrop ?? (ctx.theme() === 'light' ? 'checker-light' : 'checker-dark')
  let picked = storedBackdrop(opts.backdropKey)
  const setBackdrop = (b: Backdrop) => {
    for (const x of BACKDROPS) box.classList.toggle(`bg-${x}`, x === b)
  }
  const select = toolbar.select(
    tr('배경', 'Background'),
    [
      { value: 'checker-light', label: tr('▦ 밝은 체크', '▦ Light checker') },
      { value: 'checker-dark', label: tr('▦ 어두운 체크', '▦ Dark checker') },
      { value: 'white', label: tr('□ 흰색', '□ White') },
      { value: 'black', label: tr('■ 검정', '■ Black') }
    ],
    (v) => {
      picked = v as Backdrop
      storeBackdrop(opts.backdropKey, picked)
      setBackdrop(picked)
    }
  )
  select.value = picked ?? themed()
  setBackdrop(picked ?? themed())
  ctx.onTheme(() => {
    if (picked) return
    select.value = themed()
    setBackdrop(themed())
  })

  const W = Math.max(1, natural.width)
  const H = Math.max(1, natural.height)
  const contain = () => {
    const cw = root.clientWidth - 24
    const ch = root.clientHeight - 24
    if (cw <= 0 || ch <= 0) return 1
    return Math.min(cw / W, ch / H)
  }

  let scale = 0
  const apply = (s: number) => {
    // keep the point under the view centre in place
    const fx = root.scrollWidth > root.clientWidth ? (root.scrollLeft + root.clientWidth / 2) / root.scrollWidth : 0.5
    const fy = root.scrollHeight > root.clientHeight ? (root.scrollTop + root.clientHeight / 2) / root.scrollHeight : 0.5
    box.style.width = `${Math.max(1, Math.round(W * s))}px`
    box.style.height = `${Math.max(1, Math.round(H * s))}px`
    box.classList.toggle('pixelated', opts.pixelate && s >= 2.5)
    if (scale && box.isConnected) {
      root.scrollLeft = fx * root.scrollWidth - root.clientWidth / 2
      root.scrollTop = fy * root.scrollHeight - root.clientHeight / 2
    }
    scale = s
  }

  // "Auto" fit follows window resizes until the person zooms by hand.
  let auto = true
  let fitting = false
  const zoom = createZoom(
    1,
    (s) => {
      if (!fitting) auto = false
      apply(s)
    },
    undefined,
    { min: 0.02, max: 32 }
  )
  const autoFit = (allowUpscale: boolean) => {
    fitting = true
    const c = contain()
    zoom.set(allowUpscale ? c : Math.min(1, c))
    fitting = false
    auto = true
    apply(zoom.get())
  }
  zoom.fit = () => autoFit(true)

  const show = () => {
    root.onscroll = null
    root.replaceChildren(style, stage)
  }
  show()
  autoFit(!!opts.upscale)

  let lastW = root.clientWidth
  let lastH = root.clientHeight
  // The first fit above is synchronous. ResizeObserver is paced by rendering (paused while the
  // window is hidden), so window resize events refit too.
  const onResize = () => {
    if (root.clientWidth === lastW && root.clientHeight === lastH) return
    lastW = root.clientWidth
    lastH = root.clientHeight
    if (auto && stage.isConnected) autoFit(!!opts.upscale)
  }
  // Layout work runs after the observer callback (a synchronous re-fit can toggle scrollbars and
  // resize the observed box again in the same frame: "ResizeObserver loop completed with
  // undelivered notifications").
  let roTimer = 0
  const ro = new ResizeObserver(() => {
    if (roTimer) return
    roTimer = window.setTimeout(() => {
      roTimer = 0
      if (!signal.aborted) onResize()
    }, 0)
  })
  ro.observe(root)
  window.addEventListener('resize', onResize, { signal })
  signal.addEventListener(
    'abort',
    () => {
      ro.disconnect()
      clearTimeout(roTimer)
    },
    { once: true }
  )

  // Drag to pan with a mouse (touch already pans natively).
  let drag: { x: number; y: number; l: number; t: number } | null = null
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if (root.scrollWidth <= root.clientWidth && root.scrollHeight <= root.clientHeight) return
      drag = { x: e.clientX, y: e.clientY, l: root.scrollLeft, t: root.scrollTop }
      stage.setPointerCapture(e.pointerId)
      stage.classList.add('fp-img-dragging')
      e.preventDefault()
    },
    { signal }
  )
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (!drag) return
      root.scrollLeft = drag.l - (e.clientX - drag.x)
      root.scrollTop = drag.t - (e.clientY - drag.y)
    },
    { signal }
  )
  const end = () => {
    drag = null
    stage.classList.remove('fp-img-dragging')
  }
  stage.addEventListener('pointerup', end, { signal })
  stage.addEventListener('pointercancel', end, { signal })

  return { zoom, box, stage, show }
}

/** Loads an image URL; resolves once it is decoded (or loaded: decode() can lag while the window
 *  is hidden), rejects when the browser cannot decode it. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'async'
  return new Promise((resolve, reject) => {
    const ok = () => (img.naturalWidth > 0 || img.complete ? resolve(img) : undefined)
    img.addEventListener('load', ok, { once: true })
    img.addEventListener('error', () => reject(new Error('image decode failed')), { once: true })
    img.src = url
    img.decode().then(() => resolve(img), () => {
      // the load/error events decide
    })
  })
}

/** Frame delays of a GIF in milliseconds, one per frame (empty when the bytes are not a GIF).
 *  Walks the block structure only; delays of 0-10 ms count as 100 ms, as browsers play them. */
export function gifFrameDelays(b: Uint8Array): number[] {
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return []
  const skipSub = (i: number) => {
    while (i < b.length) {
      const n = b[i++]
      if (n === 0) break
      i += n
    }
    return i
  }
  let i = 13
  const flags = b[10]
  if (flags & 0x80) i += 3 * (1 << ((flags & 7) + 1))
  const delays: number[] = []
  let pending = 100
  while (i < b.length) {
    const t = b[i]
    if (t === 0x2c) {
      delays.push(pending)
      pending = 100
      const f = b[i + 9]
      i += 10
      if (f & 0x80) i += 3 * (1 << ((f & 7) + 1))
      i = skipSub(i + 1)
    } else if (t === 0x21) {
      if (b[i + 1] === 0xf9 && b[i + 2] >= 4) {
        const d = b[i + 4] | (b[i + 5] << 8)
        pending = d <= 1 ? 100 : d * 10
      }
      i = skipSub(i + 2)
    } else break
  }
  return delays
}
