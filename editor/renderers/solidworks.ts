/** SolidWorks documents (.sldprt, .sldasm, .slddrw, .slddrt and the .prtdot/.asmdot/.drwdot
 *  templates). SolidWorks geometry is a Parasolid B-rep that only SolidWorks or a licensed kernel
 *  can rebuild, so this viewer shows what the file itself carries: the preview pictures SolidWorks
 *  saved, the display mesh it drew a part with (in 3D, parts only), properties, configurations,
 *  referenced files, the feature names and the save history. The page says which is which. */
import { formatBytes } from '../core/i18n.ts'
import type { PreviewContext } from '../core/types.ts'
import { h } from '../core/ui.ts'
import { renderInspector } from './prop/inspect.ts'
import { readMeshes, readSwDocument, releaseName, type SwDocument } from './prop/sw.ts'
import { collapsible, createPage, embed, gallery, heading, kvTable, list, note, tree, type PropPage, type Tab } from './prop/view.ts'

const TYPE_LABEL: Record<SwDocument['docType'], [string, string]> = {
  part: ['파트', 'Part'],
  assembly: ['어셈블리', 'Assembly'],
  drawing: ['도면', 'Drawing'],
  'sheet-format': ['시트 형식', 'Sheet format'],
  unknown: ['SolidWorks 문서', 'SolidWorks document']
}

const TEMPLATE_EXT = new Set(['prtdot', 'asmdot', 'drwdot'])

export async function render(ctx: PreviewContext): Promise<void | (() => void)> {
  const { bytes, tr, fileType } = ctx
  let doc: SwDocument
  try {
    doc = readSwDocument(bytes, fileType)
  } catch (err) {
    console.warn('solidworks:', err)
    return renderInspector(ctx, 'SolidWorks', (err as Error).message)
  }
  const [typeKo, typeEn] = TYPE_LABEL[doc.docType]
  const template = TEMPLATE_EXT.has(fileType)
  const typeText = tr(`${typeKo}${template ? ' 템플릿' : ''}`, `${typeEn}${template ? ' template' : ''}`)
  const release = doc.versionCode ? `SolidWorks ${releaseName(doc.versionCode)}` : ''
  ctx.toolbar.info([`SolidWorks ${typeText}`, release, formatBytes(bytes.byteLength)].filter(Boolean).join(' · '))

  // The mesh is decoded on demand (the 3D tab); the stream list says whether there is one.
  const display = doc.container.streams.filter((s) => /^(Contents\/)?DisplayLists$/i.test(s.name))
  const show3d = doc.docType === 'part' && display.some((s) => s.encoding !== 'implode')
  const imploded = doc.docType === 'part' && !show3d && display.some((s) => s.encoding === 'implode')

  const tabs: Tab[] = [
    { id: 'overview', label: tr('개요', 'Overview'), build: (panel, page) => overview(panel, page.ctx, doc, typeText, release, show3d, imploded, (id) => page.select(id), (b) => gallery(page, b)) }
  ]
  if (show3d) tabs.push({ id: '3d', label: tr('3D 표시 메시', '3D display mesh'), build: (panel, page) => mesh3d(panel, page, doc) })
  tabs.push({ id: 'props', label: tr('속성', 'Properties'), build: (panel) => properties(panel, ctx, doc) })
  if (doc.xml.files.length || doc.xml.features.length || doc.xml.components.length || doc.xml.configurations.length) {
    tabs.push({ id: 'refs', label: doc.docType === 'part' ? tr('구성·피처', 'Configurations & features') : tr('참조·구성', 'References & configurations'), build: (panel) => references(panel, ctx, doc) })
  }
  tabs.push({ id: 'contents', label: tr('파일 구조', 'File structure'), build: (panel) => contents(panel, ctx, doc) })
  createPage(ctx, tabs)
}

function overview(
  panel: HTMLElement,
  ctx: PreviewContext,
  doc: SwDocument,
  typeText: string,
  release: string,
  show3d: boolean,
  imploded: boolean,
  select: (id: string) => void,
  makeGallery: (images: { name: string; bytes: Uint8Array; mime: string; ext: string }[]) => HTMLElement
): void {
  const { tr } = ctx
  const parts: string[] = [
    tr(
      'SolidWorks 형상(Parasolid B-rep)은 SolidWorks 없이 다시 만들 수 없습니다. 이 미리보기는 파일에 저장된 그림, 속성과 구조 정보를 보여 줍니다.',
      'SolidWorks geometry (a Parasolid B-rep) cannot be rebuilt without SolidWorks. This preview shows the pictures, properties and structure stored in the file.'
    )
  ]
  if (show3d) parts.push(tr('3D 탭은 SolidWorks가 저장한 표시용 메시(삼각형)를 그립니다. 정확한 곡면이 아니며, 표시 데이터 없이 저장된 바디는 빠질 수 있습니다.', 'The 3D tab draws the display mesh (triangles) SolidWorks saved: not exact surfaces, and bodies saved without display data are missing.'))
  else if (imploded) parts.push(tr('이 파일(SolidWorks 2001 이전 형식)의 표시 메시는 오래된 PKWARE implode 압축으로 저장되어 있어 3D 보기를 제공하지 않습니다.', 'This file (SolidWorks 2001 or older) stores its display mesh with the old PKWARE implode compression, so there is no 3D view.'))
  else if (doc.docType === 'assembly') parts.push(tr('어셈블리의 3D 보기는 제공하지 않습니다: 파일에 저장된 부품 메시에는 배치 정보가 없습니다.', 'There is no 3D view for assemblies: the component meshes stored in the file carry no placement.'))
  else if (doc.docType === 'drawing' || doc.docType === 'sheet-format') parts.push(tr('도면 시트는 SolidWorks가 저장한 시트 그림으로만 보여 줄 수 있습니다. 치수와 주석은 다시 그리지 않습니다.', 'Drawing sheets are shown only as the sheet pictures SolidWorks saved; views, dimensions and notes are not redrawn.'))
  panel.append(note(parts.join(' ')))

  const images = doc.images.map((im) => ({
    name: im.name === 'PreviewPNG' ? tr('미리보기 (PNG)', 'Preview (PNG)') : im.name === 'Preview' ? tr('미리보기 (비트맵)', 'Preview (bitmap)') : im.name.replace(/^Images\//, ''),
    bytes: im.bytes,
    mime: im.mime,
    ext: im.mime === 'image/png' ? 'png' : 'bmp'
  }))
  // The PNG and the bitmap usually show the same picture: show the bitmap only without a PNG.
  const shown = images.filter((im, i) => doc.images[i].name !== 'Preview' || !doc.images.some((x) => x.name === 'PreviewPNG'))
  if (shown.length) {
    panel.append(heading(tr('저장된 미리보기 그림', 'Saved preview pictures')), makeGallery(shown))
  } else {
    panel.append(note(tr('이 파일에는 미리보기 그림이 저장되어 있지 않습니다.', 'This file has no saved preview picture.'), 'warn'))
  }
  if (show3d) {
    const b = h('button', 'fp-prop-btn', tr('3D 표시 메시 보기', 'View the 3D display mesh'))
    b.type = 'button'
    b.style.marginTop = '8px'
    b.addEventListener('click', () => select('3d'))
    panel.append(b)
  }

  const p = doc.props
  const get = (k: string) => p.summary.find(([n]) => n === k)?.[1]
  const created = doc.saves.find((s) => s.created)
  const recent = doc.xml.configurations.find((c) => c.recent)
  panel.append(
    heading(tr('문서', 'Document')),
    kvTable([
      [tr('종류', 'Type'), typeText],
      [tr('마지막 저장 버전', 'Last saved with'), release],
      [tr('만든 버전', 'Created with'), created ? `SolidWorks ${created.release}` : ''],
      [tr('컨테이너', 'Container'), doc.container.kind === 'modern' ? tr('SolidWorks 2015 이후 형식', 'SolidWorks 2015+ format') : tr('OLE 복합 파일 (SolidWorks 2014 이전)', 'OLE compound file (SolidWorks 2014 or older)')],
      [tr('제목', 'Title'), get('Title')],
      [tr('작성자', 'Author'), get('Author')],
      [tr('만든 날짜', 'Created'), get('Created')],
      [tr('마지막 저장', 'Last saved'), get('Last saved')],
      [tr('마지막 저장한 사람', 'Last saved by'), get('Last saved by')],
      [tr('구성', 'Configurations'), doc.xml.configurations.length ? `${doc.xml.configurations.length}${recent ? tr(` (활성: ${recent.name})`, ` (active: ${recent.name})`) : ''}` : ''],
      [tr('참조 파일', 'Referenced files'), doc.docType !== 'part' && doc.xml.files.length > 1 ? String(doc.xml.files.length - 1) : ''],
      [tr('도면 시트', 'Drawing sheets'), doc.xml.sheets.join(', ')],
      [tr('파일 크기', 'File size'), formatBytes(ctx.bytes.byteLength)]
    ])
  )
}

async function mesh3d(panel: HTMLElement, page: PropPage, doc: SwDocument): Promise<void> {
  const { ctx } = page
  const { tr } = ctx
  panel.append(h('div', 'fp-state', tr('표시 메시를 읽는 중…', 'Reading the display mesh…')))
  await new Promise((r) => setTimeout(r, 0))
  const res = readMeshes(doc.container)
  panel.replaceChildren()
  if (!res.meshes.length) {
    panel.append(
      note(
        res.imploded
          ? tr('이 파일의 표시 메시는 오래된 PKWARE implode 압축으로 저장되어 있어 읽지 않습니다.', 'This file stores its display mesh with the old PKWARE implode compression, which is not read here.')
          : tr('이 파일에는 표시 메시가 저장되어 있지 않습니다 (표시 데이터 없이 저장된 파일).', 'This file holds no display mesh (it was saved without display data).'),
        'warn'
      )
    )
    return
  }
  const faces = res.meshes.reduce((a, m) => a + m.faces, 0)
  const box = h('div')
  box.style.cssText = 'position:relative;height:max(320px, calc(100vh - 190px));border:1px solid var(--orca-border,#ddd);border-radius:var(--orca-radius,6px);overflow:hidden'
  panel.append(
    note(
      tr(
        `SolidWorks가 저장한 표시 메시입니다 (면 ${faces.toLocaleString()}개). 곡면은 삼각형으로 근사되어 있고, 색상·재질은 적용하지 않습니다.`,
        `The display mesh SolidWorks saved (${faces.toLocaleString()} faces). Curved surfaces are approximated by triangles; colours and materials are not applied.`
      )
    ),
    box
  )
  await embed(ctx, box, {
    title: tr('3D 표시 메시', '3D display mesh'),
    bytes: ctx.bytes,
    ext: 'mesh',
    render: async (sub) => {
      const { renderMeshes } = await import('./model3d.ts')
      const parts = res.meshes.map((m) => ({ type: 'mesh' as const, name: m.name, position: m.position, normal: m.normal, index: m.index }))
      return renderMeshes(sub, parts, { label: 'SolidWorks display mesh', units: 'mm', zUp: false })
    }
  }, false).ready
}

function properties(panel: HTMLElement, ctx: PreviewContext, doc: SwDocument): void {
  const { tr } = ctx
  const p = doc.props
  if (!p.summary.length && !p.custom.length && !p.configs.length && !p.info.length) {
    panel.append(note(tr('이 파일에서 속성을 찾지 못했습니다.', 'No properties were found in this file.')))
    return
  }
  if (p.summary.length) panel.append(heading(tr('요약 정보', 'Summary')), kvTable(p.summary))
  panel.append(heading(tr('사용자 정의 속성', 'Custom properties')))
  panel.append(p.custom.length ? kvTable(p.custom) : note(tr('없음', 'None')))
  for (const c of p.configs) panel.append(heading(tr(`구성별 속성: ${c.name}`, `Configuration properties: ${c.name}`)), kvTable(c.props))
  if (p.info.length) panel.append(collapsible(tr(`SolidWorks 문서 정보 (${p.info.length})`, `SolidWorks document information (${p.info.length})`), kvTable(p.info)))
  if (doc.saves.length) {
    panel.append(
      heading(tr('저장 기록', 'Save history')),
      list(doc.saves.map((s) => [`SolidWorks ${s.release}`, [s.build ? tr(`빌드 ${s.build}`, `build ${s.build}`) : '', s.created ? tr('이 버전에서 생성', 'created with this release') : ''].filter(Boolean).join(' · ')] as [string, string]))
    )
  }
}

function references(panel: HTMLElement, ctx: PreviewContext, doc: SwDocument): void {
  const { tr } = ctx
  const x = doc.xml
  if (x.configurations.length) {
    panel.append(
      heading(tr(`구성 (${x.configurations.length})`, `Configurations (${x.configurations.length})`)),
      list(x.configurations.map((c) => [c.name, c.recent ? tr('마지막 활성', 'last active') : ''] as [string, string]))
    )
  }
  const others = doc.docType === 'part' ? [] : x.files.slice(1)
  if (x.files.length && doc.docType !== 'part') {
    const label = doc.docType === 'assembly' ? tr('어셈블리가 참조하는 파일', 'Files the assembly references') : tr('도면 뷰가 참조하는 모델', 'Models the drawing views reference')
    panel.append(
      heading(`${label} (${others.length})`),
      note(tr('경로는 파일을 저장한 컴퓨터 기준입니다.', 'Paths are as they were on the computer that saved the file.')),
      list(others.map((f) => [f.path, [f.type, f.imported ? tr(`가져옴: ${f.imported}`, `imported from ${f.imported}`) : ''].filter(Boolean).join(' · ')] as [string, string]))
    )
  }
  if (x.components.length) {
    panel.append(heading(tr(`구성 요소 인스턴스 (${x.components.length})`, `Component instances (${x.components.length})`)), list(x.components.slice().sort()))
  }
  if (x.features.length) {
    panel.append(
      heading(tr(`피처 (${x.features.length})`, `Features (${x.features.length})`)),
      note(tr('피처 이름과 종류만 저장 순서와 무관하게 나열합니다. 피처 정의는 해석하지 않습니다.', 'Feature names and types only, not in tree order; feature definitions are not interpreted.')),
      list(x.features.map((f) => [f.name || '—', f.type] as [string, string]))
    )
  }
}

function contents(panel: HTMLElement, ctx: PreviewContext, doc: SwDocument): void {
  const { tr } = ctx
  const enc: Record<string, string> = { zlb: 'zlib', deflate: 'deflate', implode: tr('implode (읽지 않음)', 'implode (not read)'), plain: '' }
  const rows = doc.container.streams.map((s) => ({
    path: s.name,
    size: s.size >= 0 ? s.size : s.stored,
    dir: s.name.endsWith('/'),
    tag: enc[s.encoding] || undefined
  }))
  panel.append(
    note(
      doc.container.kind === 'modern'
        ? tr('SolidWorks 2015 이후 형식: 이름이 감춰진 ZIP 비슷한 컨테이너이며 각 스트림은 deflate로 압축되어 있습니다.', 'SolidWorks 2015+ format: a ZIP-like container with disguised names; each stream is deflate-compressed.')
        : tr('OLE 복합 파일입니다. 이름이 __ZLB로 끝나는 스트림은 zlib 프레임으로 압축되어 있습니다.', 'An OLE compound file; streams named …__ZLB are zlib-framed.')
    ),
    heading(tr(`스트림 (${rows.filter((r) => !r.dir).length})`, `Streams (${rows.filter((r) => !r.dir).length})`)),
    tree(rows, tr, 1)
  )
}
