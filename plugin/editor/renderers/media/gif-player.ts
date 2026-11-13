/** Pause/play for animated GIFs. An <img> animates natively but cannot pause, and drawing it to a
 *  canvas only ever yields the first frame. So on the first pause this takes over with WebCodecs'
 *  ImageDecoder (composited frames) and plays on a canvas laid over the image with the GIF's own
 *  frame delays. Returns null where ImageDecoder is missing; the GIF then just animates. */
import type { PreviewContext } from '../../core/types.ts'
import { h } from '../../core/ui.ts'
import { styleLayer } from './image-view.ts'

interface DecodedFrame {
  image: CanvasImageSource & { close(): void }
}
interface Decoder {
  decode(opts: { frameIndex: number }): Promise<DecodedFrame>
  close(): void
}
interface DecoderClass {
  new (init: { data: BufferSource; type: string }): Decoder
  isTypeSupported(type: string): Promise<boolean>
}

export interface GifPlayer {
  /** Toggles; resolves to the new playing state. */
  toggle(): Promise<boolean>
  frame(): number
}

export async function createGifPlayer(
  ctx: PreviewContext,
  img: HTMLImageElement,
  box: HTMLElement,
  delays: number[],
  size: { width: number; height: number }
): Promise<GifPlayer | null> {
  const Impl = (globalThis as { ImageDecoder?: DecoderClass }).ImageDecoder
  if (!Impl || delays.length < 2) return null
  if (!(await Impl.isTypeSupported('image/gif').catch(() => false))) return null
  if (ctx.signal.aborted) return null
  const { signal, bytes } = ctx
  const started = performance.now()
  const total = delays.reduce((a, b) => a + b, 0)
  const canvas = h('canvas')
  canvas.width = size.width
  canvas.height = size.height
  styleLayer(canvas, true)
  canvas.style.display = 'none'
  box.append(canvas)
  const g = canvas.getContext('2d')
  let decoder: Decoder | null = null
  let frame = 0
  let playing = true
  let ours = false
  let timer = 0

  const draw = async (i: number) => {
    decoder ??= new Impl({ data: bytes as Uint8Array<ArrayBuffer>, type: 'image/gif' })
    const r = await decoder.decode({ frameIndex: i })
    if (signal.aborted) return r.image.close()
    g?.clearRect(0, 0, size.width, size.height)
    g?.drawImage(r.image, 0, 0)
    r.image.close()
  }
  const tick = async () => {
    if (!playing || signal.aborted) return
    frame = (frame + 1) % delays.length
    try {
      await draw(frame)
    } catch {
      return
    }
    if (playing && !signal.aborted) timer = window.setTimeout(tick, delays[frame])
  }
  signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer)
      decoder?.close()
    },
    { once: true }
  )

  return {
    frame: () => frame,
    async toggle() {
      if (playing) {
        playing = false
        clearTimeout(timer)
        if (!ours) {
          // Where is the native animation now? Estimate from the elapsed time and the delays.
          let t = total > 0 ? (performance.now() - started) % total : 0
          frame = 0
          while (frame < delays.length - 1 && t >= delays[frame]) t -= delays[frame++]
          await draw(frame)
          ours = true
          canvas.style.display = 'block'
          img.style.visibility = 'hidden'
        }
      } else {
        playing = true
        timer = window.setTimeout(tick, delays[frame])
      }
      return playing
    }
  }
}
