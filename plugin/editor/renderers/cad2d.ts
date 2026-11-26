/** 2D CAD drawings: DXF (ASCII and binary), DWF (6.x packages and single-stream W2D) and DWFx
 *  (XPS pages). Each format is read into the shared `Scene` model (renderers/cad2d/scene.ts) and
 *  shown by the canvas viewer (renderers/cad2d/viewer.ts). */
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { DxfError } from './cad2d/dxf/reader.ts'
import { isEmpty, viewBox, type Scene } from './cad2d/scene.ts'
import { showScene } from './cad2d/viewer.ts'

export async function render(ctx: PreviewContext): Promise<void | (() => void)> {
  const { bytes, fileType, tr, signal } = ctx
  // Let the spinner paint before parsing large files on this thread.
  await new Promise((r) => setTimeout(r, 0))
  let scene: Scene
  try {
    if (fileType === 'dxf') {
      const { readDxf } = await import('./cad2d/dxf/index.ts')
      scene = readDxf(bytes)
    } else if (fileType === 'dwfx') {
      const { readDwfx } = await import('./cad2d/dwfx.ts')
      scene = await readDwfx(bytes, tr)
    } else {
      const { readDwf } = await import('./cad2d/dwf/package.ts')
      scene = await readDwf(bytes, tr)
    }
  } catch (err) {
    if (err instanceof PreviewError) throw err
    if (err instanceof DxfError || (err as Error)?.name === 'FormatError')
      throw new PreviewError(
        `${fileType}-format`,
        tr(`.${fileType} 도면을 읽을 수 없습니다. 파일이 손상되었거나 다른 형식입니다. (${(err as Error).message})`, `Cannot read this .${fileType} drawing: it is damaged or not a ${fileType.toUpperCase()} file. (${(err as Error).message})`)
      )
    throw err
  }
  if (signal.aborted) return
  if (!scene.views.length || scene.views.every((v) => isEmpty(viewBox(scene, v)) && !v.notice)) {
    throw new PreviewError('cad-empty', tr('도면에 표시할 내용이 없습니다.', 'The drawing has nothing to show.'))
  }
  const parts = [scene.format]
  if (scene.version) parts.push(scene.version)
  if (scene.views.length > 1) parts.push(tr(`보기 ${scene.views.length}개`, `${scene.views.length} views`))
  parts.push(formatBytes(bytes.byteLength))
  return showScene(ctx, scene, { summary: parts.join(' · ') })
}
