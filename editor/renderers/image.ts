/** Raster images (.gif, .bmp): an <img> from a blob URL (GIFs animate natively) on a checkerboard,
 *  fit to window, zoom and pan; GIFs with several frames get a play/pause toggle. */
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, objectUrl } from '../core/ui.ts'
import { createGifPlayer } from './media/gif-player.ts'
import { createImageView, gifFrameDelays, loadImage } from './media/image-view.ts'

function sniff(b: Uint8Array): { mime: string; label: string } | null {
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { mime: 'image/gif', label: 'GIF' }
  if (b[0] === 0x42 && b[1] === 0x4d) return { mime: 'image/bmp', label: 'BMP' }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', label: 'PNG' }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', label: 'JPEG' }
  return null
}

export async function render(ctx: PreviewContext): Promise<void> {
  const { bytes, toolbar, tr, signal } = ctx
  const kind = sniff(bytes)
  if (!kind) {
    throw new PreviewError(
      tr('이미지 형식을 인식할 수 없습니다', 'Unrecognized image format'),
      tr(`.${ctx.fileType} 파일의 내용이 이미지가 아니거나 손상되었습니다.`, `This .${ctx.fileType} file is not an image or is damaged.`)
    )
  }
  const url = objectUrl(bytes, kind.mime, signal)
  let img: HTMLImageElement
  try {
    img = await loadImage(url)
  } catch {
    throw new PreviewError(
      tr('이미지를 표시할 수 없습니다', 'Cannot display this image'),
      tr('파일이 손상되었거나 이 브라우저가 지원하지 않는 변형입니다.', 'The file is damaged or uses a variant this browser cannot decode.')
    )
  }
  if (signal.aborted) return
  const width = img.naturalWidth
  const height = img.naturalHeight
  const view = createImageView(ctx, img, { width, height }, { pixelate: true })

  const delays = kind.mime === 'image/gif' ? gifFrameDelays(bytes) : []
  const frames = delays.length
  const player = frames > 1 ? await createGifPlayer(ctx, img, view.box, delays, { width, height }) : null
  if (player) {
    const label = (playing: boolean) => {
      btn.textContent = playing ? '❚❚' : '▶'
      btn.title = playing ? tr('일시정지', 'Pause') : tr(`재생 (${player.frame() + 1}/${frames}프레임)`, `Play (frame ${player.frame() + 1}/${frames})`)
      btn.setAttribute('aria-label', btn.title)
    }
    const btn = toolbar.button({
      label: '❚❚',
      title: tr('일시정지', 'Pause'),
      onClick: () => void player.toggle().then(label)
    })
  }

  const parts = [`${width} × ${height}`, formatBytes(bytes.byteLength), kind.label]
  if (frames > 1) parts.push(tr(`${frames}프레임`, `${frames} frames`))
  toolbar.info(parts.join(' · '))
  toolbar.zoom(view.zoom)
  bindZoomGestures(ctx.root, view.zoom, signal)
}
