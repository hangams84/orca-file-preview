/** 2D CAD drawings: DXF (ASCII and binary), DWF (6.x packages and single-stream W2D) and DWFx
 *  (XPS pages). Each format is read into the shared `Scene` model (renderers/cad2d/scene.ts) and
 *  shown by the canvas viewer (renderers/cad2d/viewer.ts). A DXF's external references (xref
 *  drawings, raster images) come from files the user hands over (📁 or drop, core/companions.ts). */
import { companionControls, companionFiles } from '../core/companions.ts'
import { formatBytes } from '../core/i18n.ts'
import { locateSelf, readRef } from '../core/refs.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { DxfError } from './cad2d/dxf/reader.ts'
import { isEmpty, viewBox, type Scene } from './cad2d/scene.ts'
import { showScene } from './cad2d/viewer.ts'

export async function render(ctx: PreviewContext): Promise<void | (() => void)> {
  const { bytes, fileType, tr, signal } = ctx
  // Let the spinner paint before parsing large files on this thread.
  await new Promise((r) => setTimeout(r, 0))
  let scene: Scene
  let notice = ''
  try {
    if (fileType === 'dxf') {
      ;({ scene, notice } = await readDxfWithRefs(ctx))
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
  if (!scene.views.length || scene.views.every((v) => isEmpty(viewBox(scene, v)) && !v.notice && !notice)) {
    throw new PreviewError('cad-empty', tr('도면에 표시할 내용이 없습니다.', 'The drawing has nothing to show.'))
  }
  if (notice) for (const v of scene.views) v.notice = v.notice ? `${v.notice} ${notice}` : notice
  const parts = [scene.format]
  if (scene.version) parts.push(scene.version)
  if (scene.views.length > 1) parts.push(tr(`보기 ${scene.views.length}개`, `${scene.views.length} views`))
  parts.push(formatBytes(bytes.byteLength))
  return showScene(ctx, scene, { summary: parts.join(' · ') })
}

/** DXF with its xrefs and images resolved from companion files; `notice` lists what is still missing. */
async function readDxfWithRefs(ctx: PreviewContext): Promise<{ scene: Scene; notice: string }> {
  const { bytes, tr } = ctx
  const { readDxf } = await import('./cad2d/dxf/index.ts')
  const { buildScene, dxfReferences } = await import('./cad2d/dxf/build.ts')
  const { readDxfDoc, resolveDxf } = await import('./cad2d/dxf/resolve.ts')
  // readDxf refuses DWG/DWF/PDF signatures with a clear message; a DXF goes on below.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64))
  if (/^\s*\(DWF V|^PK\x03\x04|^%PDF|^AC10\d\d/.test(head)) return { scene: readDxf(bytes), notice: '' }
  const doc = readDxfDoc(bytes)
  const refs = dxfReferences(doc)
  if (!refs.xrefs.length && !refs.images.length) return { scene: buildScene(doc), notice: '' }

  const off = companionControls(ctx, () => ctx.rerender?.(), { what: { ko: '외부 참조(xref)·이미지 파일', en: 'xref drawings and images' } })
  ctx.signal.addEventListener('abort', off, { once: true })
  const self = companionFiles().length ? await locateSelf(bytes, /\.dxf$/i) : undefined
  const res = await resolveDxf(doc, self, {
    read: readRef,
    image: async (b, path) => {
      try {
        const bmp = await createImageBitmap(new Blob([b as BlobPart], { type: mimeOf(path) }))
        return { src: bmp, w: bmp.width, h: bmp.height }
      } catch {
        return null
      }
    }
  })
  const scene = buildScene(doc, res.resolved)
  const lines: string[] = []
  const name = (p: string) => p.split(/[\\/]/).pop() ?? p
  const xm = res.missing.filter((m) => m.kind === 'xref').map((m) => name(m.path))
  const im = res.missing.filter((m) => m.kind === 'image').map((m) => name(m.path))
  if (xm.length) lines.push(tr(`외부 참조 없음: ${xm.join(', ')}.`, `Xrefs not supplied: ${xm.join(', ')}.`))
  if (im.length) lines.push(tr(`이미지 없음: ${im.join(', ')}.`, `Images not supplied: ${im.join(', ')}.`))
  for (const f of res.failed) lines.push(tr(`${name(f.path)}: 사용할 수 없음 (${f.why}).`, `${name(f.path)}: not usable (${f.why}).`))
  if (xm.length || im.length) lines.push(tr('📁로 도면 폴더를 고르거나 파일을 끌어다 놓으세요.', 'Pick the drawing folder with 📁 or drop the files here.'))
  const used = res.used.length
  if (used) scene.info.push(tr(`참조 파일 ${used}개`, `${used} referenced file${used === 1 ? '' : 's'}`))
  return { scene, notice: lines.join(' ') }
}

function mimeOf(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' } as Record<string, string>)[ext] ?? ''
}
