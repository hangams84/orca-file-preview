/** EPLAN Electric P8 files: project link files (.elk .ell .elr .els .ela), archived or packed
 *  projects (.zw1 .elp .elx, and .zx1 when it is an archive) and EPLAN Data Portal part packages
 *  (.edz). Schematic pages and macros are EPLAN's own binary and PXF graphics, which cannot be
 *  drawn here: the viewer shows the project properties, page descriptions, pictures, part data and
 *  the archive contents, opens embedded pictures and PDF documents, and says what it cannot show. */
import { formatBytes } from '../core/i18n.ts'
import type { PreviewContext } from '../core/types.ts'
import { h } from '../core/ui.ts'
import {
  findByBasename,
  formatUnixTime,
  isZipBytes,
  openArchive,
  parseAddressXml,
  parseLinkFile,
  parseManifest,
  parsePartXml,
  parseProjectInfo,
  parseXml,
  pickLang,
  PART_FIELDS,
  PROJECT_FIELDS,
  resolveItem,
  scanMultiLangStrings,
  walkXml,
  xmlText,
  type Archive,
  type ArchiveEntry,
  type EdzPackage
} from './prop/eplan.ts'
import { renderInspector } from './prop/inspect.ts'
import { is7z, SevenZipError } from './prop/sevenzip.ts'
import { button, canEmbed, collapsible, createPage, gallery, heading, imageMime, kvTable, list, note, tree, type PropPage, type Tab, type TreeEntry } from './prop/view.ts'

const LINK_EXT = new Set(['elk', 'ell', 'elr', 'els', 'ela'])

const KIND_TEXT: Record<string, [string, string]> = {
  elk: ['EPLAN 프로젝트', 'EPLAN project'],
  ell: ['변경 추적 EPLAN 프로젝트', 'EPLAN project with change tracking'],
  elr: ['완료된 EPLAN 프로젝트 (읽기 전용)', 'Completed EPLAN project (read-only)'],
  els: ['분리된 EPLAN 프로젝트', 'Filed-off EPLAN project'],
  ela: ['보관된 EPLAN 프로젝트', 'Archived EPLAN project'],
  elp: ['압축된 EPLAN 프로젝트', 'Packed EPLAN project'],
  elx: ['압축된 분리 EPLAN 프로젝트', 'Packed filed-off EPLAN project'],
  zw1: ['EPLAN 프로젝트 백업', 'EPLAN project backup'],
  zx1: ['EPLAN 백업 (추정)', 'EPLAN backup (assumed)'],
  edz: ['EPLAN Data Portal 부품 패키지', 'EPLAN Data Portal part package']
}

export async function render(ctx: PreviewContext): Promise<void | (() => void)> {
  const { bytes, tr, fileType } = ctx
  const [ko, en] = KIND_TEXT[fileType] ?? ['EPLAN 파일', 'EPLAN file']
  const kindText = tr(ko, en)
  // Archives first: a packed or archived project can carry any of these suffixes.
  if (is7z(bytes) || isZipBytes(bytes)) {
    let archive: Archive
    try {
      archive = openArchive(bytes)
    } catch (err) {
      const e = err as Error
      const reason =
        err instanceof SevenZipError && err.code === 'encrypted'
          ? tr('암호로 보호된 압축 파일입니다.', 'The archive is password-protected.')
          : e.message
      return renderInspector(ctx, kindText, reason)
    }
    const manifest = archive.entries.find((e) => !e.dir && e.path.toLowerCase() === 'manifest.xml')
    if (manifest) return renderEdz(ctx, archive, manifest, kindText)
    return renderProjectArchive(ctx, archive, kindText)
  }
  if (LINK_EXT.has(fileType)) {
    const link = parseLinkFile(bytes)
    if (link) return renderLink(ctx, link, kindText)
  }
  return renderInspector(ctx, kindText, fileType === 'edz' || fileType === 'zw1' ? tr('7z나 ZIP 압축 파일이 아닙니다.', 'It is not a 7z or ZIP archive.') : undefined)
}

// ---------------------------------------------------------------------------------------------
// Link files

function renderLink(ctx: PreviewContext, link: NonNullable<ReturnType<typeof parseLinkFile>>, kindText: string): void {
  const { tr, fileType } = ctx
  ctx.toolbar.info([kindText, link.dbVersion ? tr(`DB ${link.dbVersion}`, `database ${link.dbVersion}`) : '', formatBytes(ctx.bytes.byteLength)].filter(Boolean).join(' · '))
  createPage(ctx, [
    {
      id: 'link',
      label: kindText,
      build(panel) {
        panel.append(
          note(
            tr(
              `이 .${fileType} 파일은 프로젝트를 가리키는 링크 파일입니다. 프로젝트 데이터(페이지, 장치, 부품)는 같은 폴더의 "${link.dataDir}" 디렉터리에 있어 이 미리보기에서 볼 수 없습니다. 프로젝트 내용을 보려면 백업(.zw1)을 열어 보세요.`,
              `This .${fileType} file is a link to a project. The project data (pages, devices, parts) lives in the "${link.dataDir}" directory next to it, which this preview cannot see. Open a backup (.zw1) of the project to see its contents.`
            )
          ),
          kvTable([
            [tr('종류', 'Kind'), kindText],
            [tr('데이터 디렉터리', 'Data directory'), link.dataDir],
            [tr('데이터베이스 버전', 'Database version'), link.dbVersion],
            [tr('인코딩', 'Encoding'), link.encoding],
            [tr('파일 크기', 'File size'), formatBytes(ctx.bytes.byteLength)]
          ])
        )
        if (link.lines.length > 2) panel.append(heading(tr('나머지 줄', 'Other lines')), list(link.lines.slice(2)))
      }
    }
  ])
}

// ---------------------------------------------------------------------------------------------
// Shared helpers

function contentsTab(archive: Archive, page: PropPage, panel: HTMLElement): void {
  const { tr } = page.ctx
  const rows: TreeEntry[] = archive.entries.map((e) => {
    const ext = (e.path.split('.').pop() ?? '').toLowerCase()
    const openable = !e.dir && e.size > 0 && (canEmbed(ext) || ext === 'jpeg')
    return {
      path: e.path,
      size: e.size,
      dir: e.dir,
      open: openable ? () => void openEntry(page, e) : undefined
    }
  })
  const files = archive.entries.filter((e) => !e.dir)
  const total = files.reduce((a, e) => a + e.size, 0)
  panel.append(
    kvTable([
      [tr('압축 형식', 'Archive'), `${archive.format === '7z' ? '7z' : 'ZIP'} · ${archive.methods.join(', ')}${archive.solid ? tr(' · 솔리드', ' · solid') : ''}`],
      [tr('파일', 'Files'), `${files.length.toLocaleString()} · ${formatBytes(total)} ${tr('(압축 해제 시)', '(unpacked)')}`]
    ]),
    heading(tr('내용', 'Contents')),
    tree(rows, tr, 1)
  )
}

async function openEntry(page: PropPage, e: ArchiveEntry): Promise<void> {
  const ext = (e.path.split('.').pop() ?? '').toLowerCase()
  const bytes = await e.read()
  const img = imageMime(e.path, bytes)
  await page.open({ title: e.path, bytes, ext: img?.ext ?? (ext === 'jpeg' ? 'jpg' : ext) })
}

async function readText(e: ArchiveEntry | undefined): Promise<string | null> {
  if (!e) return null
  return xmlText(await e.read())
}

const korean = (ctx: PreviewContext) => ctx.tr('ko', 'en') === 'ko'

// ---------------------------------------------------------------------------------------------
// EDZ part packages

async function renderEdz(ctx: PreviewContext, archive: Archive, manifestEntry: ArchiveEntry, kindText: string): Promise<void> {
  const { tr } = ctx
  const text = await readText(manifestEntry)
  let manifest: ReturnType<typeof parseManifest>
  try {
    manifest = parseManifest(text ?? '')
  } catch (err) {
    return renderInspector(ctx, kindText, (err as Error).message)
  }
  const parts = manifest.packages.filter((p) => p.type === 'part')
  const nested = findByBasename(archive, /\.edz$/i)
  const counts = new Map<string, number>()
  for (const p of manifest.packages) counts.set(p.type, (counts.get(p.type) ?? 0) + 1)
  ctx.toolbar.info([kindText, tr(`부품 ${parts.length}개`, `${parts.length} parts`), formatBytes(ctx.bytes.byteLength)].join(' · '))
  const tabs: Tab[] = [
    {
      id: 'overview',
      label: tr('개요', 'Overview'),
      async build(panel) {
        panel.append(
          note(
            tr(
              '부품 데이터와 그림, PDF 문서는 그대로 보여 줍니다. 매크로(.ema)는 EPLAN의 PXF 그래픽이라 여기서 그릴 수 없어 이름과 변형만 나열합니다.',
              'Part data, pictures and PDF documents are shown as stored. Macros (.ema) are EPLAN PXF graphics that cannot be drawn here; only their names and variants are listed.'
            )
          ),
          kvTable([
            [tr('종류', 'Kind'), kindText],
            [tr('매니페스트 버전', 'Manifest version'), manifest.version],
            [tr('패키지', 'Packages'), [...counts].map(([k, n]) => `${k} ${n}`).join(', ')],
            [tr('압축 내 파일', 'Files in the archive'), archive.entries.filter((e) => !e.dir).length.toLocaleString()],
            [tr('파일 크기', 'File size'), formatBytes(ctx.bytes.byteLength)]
          ])
        )
        const manuItem = parts[0]?.items.find((i) => i.name === 'manufacturer')
        if (manuItem) {
          const entry = resolveItem(archive, manuItem)
          const t = await readText(entry)
          if (t) {
            try {
              const addr = parseAddressXml(t)[0]
              if (addr) {
                panel.append(
                  heading(tr('제조사', 'Manufacturer')),
                  kvTable(
                    Object.entries(addr)
                      .filter(([, v]) => v)
                      .map(([k, v]) => [k.replace(/^P_PART_ADDRESS_/, '').replace(/_/g, ' ').toLowerCase(), pickLang(v, korean(ctx))])
                  )
                )
              }
            } catch {
              // optional
            }
          }
        }
        if (nested.length) panel.append(note(tr(`이 패키지에는 EDZ 파일 ${nested.length}개가 들어 있습니다. "내용" 탭에서 열 수 있습니다.`, `This package contains ${nested.length} EDZ files; open them from the Contents tab.`)))
        if (!parts.length && !nested.length) panel.append(note(tr('매니페스트에 부품 패키지가 없습니다.', 'The manifest lists no part packages.'), 'warn'))
      }
    }
  ]
  if (parts.length) tabs.push({ id: 'parts', label: tr(`부품 (${parts.length})`, `Parts (${parts.length})`), build: (panel, page) => partsTab(panel, page, archive, parts) })
  const others = manifest.packages.filter((p) => p.type !== 'part')
  if (others.length) {
    tabs.push({
      id: 'packages',
      label: tr('기타 패키지', 'Other packages'),
      build(panel) {
        panel.append(list(others.map((p) => [p.name || p.key, `${p.type} · ${p.items.map((i) => i.name).join(', ')}`] as [string, string])))
      }
    })
  }
  tabs.push({ id: 'contents', label: tr('내용', 'Contents'), build: (panel, page) => contentsTab(archive, page, panel) })
  createPage(ctx, tabs, parts.length ? 'parts' : 'overview')
}

function partsTab(panel: HTMLElement, page: PropPage, archive: Archive, parts: EdzPackage[]): void {
  const { ctx } = page
  const { tr } = ctx
  const split = h('div', 'fp-prop-split')
  const side = h('div', 'side')
  const detail = h('div')
  split.append(side, detail)
  panel.append(split)
  const search = h('input', 'fp-prop-search')
  search.type = 'search'
  search.placeholder = tr('부품 검색', 'Search parts')
  search.setAttribute('aria-label', search.placeholder)
  const listEl = h('div')
  side.append(search, listEl)
  let current: HTMLButtonElement | null = null
  let token = 0
  const show = async (pkg: EdzPackage, btn: HTMLButtonElement) => {
    current?.removeAttribute('aria-current')
    btn.setAttribute('aria-current', 'true')
    current = btn
    const my = ++token
    detail.replaceChildren(h('div', 'fp-state', tr('부품 데이터를 읽는 중…', 'Reading part data…')))
    const content = await partDetail(page, archive, pkg)
    if (my !== token || ctx.signal.aborted) return
    detail.replaceChildren(content)
  }
  const draw = () => {
    const q = search.value.trim().toLowerCase()
    const match = parts.filter((p) => !q || p.key.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    listEl.replaceChildren()
    for (const p of match.slice(0, 1000)) {
      const b = h('button', 'fp-prop-pick')
      b.type = 'button'
      b.append(document.createTextNode(p.key || p.name), h('small', undefined, p.items.filter((i) => i.type !== 'partxml').map((i) => i.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')))
      b.addEventListener('click', () => void show(p, b))
      listEl.append(b)
    }
    if (match.length > 1000) listEl.append(h('div', 'fp-prop-pick', `… +${match.length - 1000}`))
    if (!match.length) listEl.append(h('div', 'fp-prop-pick', tr('일치하는 부품 없음', 'No matching parts')))
  }
  search.addEventListener('input', draw)
  draw()
  const first = listEl.querySelector('button')
  if (first && parts[0]) void show(parts[0], first as HTMLButtonElement)
}

async function partDetail(page: PropPage, archive: Archive, pkg: EdzPackage): Promise<HTMLElement> {
  const { ctx } = page
  const { tr } = ctx
  const ko = korean(ctx)
  const el = h('div')
  el.append(h('h3', undefined, pkg.key || pkg.name))
  const partItem = pkg.items.find((i) => i.name === 'part' && i.type === 'partxml')
  const entry = partItem ? resolveItem(archive, partItem) : undefined
  // Picture first: it is the closest thing to a preview of the part.
  const pics = pkg.items.filter((i) => i.type === 'picture')
  const images: { name: string; bytes: Uint8Array; mime: string; ext: string }[] = []
  for (const p of pics) {
    const e = resolveItem(archive, p)
    if (!e) continue
    try {
      const bytes = await e.read()
      const m = imageMime(e.path, bytes)
      if (m) images.push({ name: e.path.split('/').pop() ?? e.path, bytes, mime: m.mime, ext: m.ext })
    } catch (err) {
      el.append(note(tr(`그림을 읽지 못했습니다: ${(err as Error).message}`, `The picture could not be read: ${(err as Error).message}`), 'warn'))
    }
  }
  if (images.length) el.append(gallery(page, images))
  if (!entry) {
    el.append(note(tr('부품 XML을 찾지 못했습니다.', 'The part XML was not found.'), 'warn'))
  } else {
    try {
      const part = parsePartXml((await readText(entry)) ?? '')[0]
      if (!part) throw new Error('no <part>')
      const a = part.attrs
      const shown = new Set<string>()
      const rows: [string, string][] = []
      for (const [key, k, e] of PART_FIELDS) {
        const v = a[key]
        if (v == null || v === '') continue
        shown.add(key)
        let text = pickLang(v, ko)
        if (/^P_ARTICLE_(WIDTH|HEIGHT|DEPTH|WEIGHT)$/.test(key)) text = tidyNumber(text)
        if (/^P_ARTICLE_(WIDTH|HEIGHT|DEPTH)$/.test(key) && part.units.length) text += ` ${part.units.length}`
        if (key === 'P_ARTICLE_WEIGHT' && part.units.weight) text += ` ${part.units.weight}`
        if (/^P_ARTICLE_(CERTIFICATE_CE|DISCONTINUED)$/.test(key) && /^[01]$/.test(text)) text = text === '1' ? tr('예', 'Yes') : tr('아니요', 'No')
        rows.push([tr(k, e), text])
      }
      el.append(heading(tr('부품 데이터', 'Part data')), kvTable(rows))
      if (part.free.length) {
        el.append(heading(tr('기술 데이터 (자유 속성)', 'Technical data (free properties)')), kvTable(part.free.map(([d, v]) => [pickLang(d, ko), pickLang(v, ko)])))
      }
      if (part.functionTemplates) el.append(note(tr(`기능 템플릿 ${part.functionTemplates}개 (변형 ${part.variants}개)`, `${part.functionTemplates} function templates in ${part.variants} variant(s)`)))
      const rest = Object.entries(a).filter(([k, v]) => !shown.has(k) && v !== '' && v !== '0')
      if (rest.length) el.append(collapsible(tr(`모든 속성 (${rest.length})`, `All attributes (${rest.length})`), kvTable(rest.map(([k, v]) => [k, pickLang(v, ko)]))))
    } catch (err) {
      el.append(note(tr(`부품 XML을 읽지 못했습니다: ${(err as Error).message}`, `The part XML could not be read: ${(err as Error).message}`), 'warn'))
    }
  }
  const docs = pkg.items.filter((i) => i.type === 'document')
  if (docs.length) {
    el.append(heading(tr('문서', 'Documents')))
    const ul = h('ul', 'fp-prop-list')
    for (const d of docs) {
      const e = resolveItem(archive, d)
      const li = h('li')
      li.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between'
      li.append(h('span', undefined, `${d.locator}${e ? ` · ${formatBytes(e.size)}` : tr(' · 패키지에 없음', ' · not in the package')}`))
      const ext = (d.locator.split('.').pop() ?? '').toLowerCase()
      if (e && canEmbed(ext)) li.append(button(tr('열기', 'Open'), tr('미리보기에서 열기', 'Open in the preview'), () => void openEntry(page, e)))
      ul.append(li)
    }
    el.append(ul)
  }
  const macros = pkg.items.filter((i) => i.type === 'macro')
  if (macros.length) {
    el.append(heading(tr('매크로', 'Macros')), note(tr('EPLAN 매크로 그래픽은 여기서 그릴 수 없습니다. 이름, 종류와 변형만 보여 줍니다.', 'EPLAN macro graphics cannot be drawn here; their name, type and variants are listed.')))
    const seen = new Set<string>()
    const rows: [string, string][] = []
    for (const m of macros) {
      const e = resolveItem(archive, m)
      const label = m.name === 'graphicmacro' ? tr('그래픽 매크로', 'graphic macro') : m.name === 'groupsymbolmacro' ? tr('그룹 심볼 매크로', 'group symbol macro') : m.name
      if (seen.has(m.locator)) {
        const row = rows.find((r) => r[0] === m.locator)
        if (row) row[1] = `${label}, ${row[1]}`
        continue
      }
      seen.add(m.locator)
      let info = e ? formatBytes(e.size) : tr('패키지에 없음', 'not in the package')
      if (e && e.size < 8 * 1024 * 1024) {
        try {
          info += ` · ${macroSummary(xmlHead(await e.read()), tr)}`
        } catch {
          // keep the size only
        }
      }
      rows.push([m.locator, `${label} · ${info}`])
    }
    el.append(kvTable(rows))
  }
  return el
}

/** "0.0275099999999999" → "0.02751": float noise from the parts database. */
function tidyNumber(s: string): string {
  const n = Number(s)
  if (!s || !Number.isFinite(n)) return s
  return String(Number(n.toPrecision(6)))
}

/** The first 64 KB of a macro: enough for the root and its variant directory. */
function xmlHead(b: Uint8Array): string {
  return new TextDecoder('utf-8').decode(b.subarray(0, 64 * 1024))
}

function macroSummary(head: string, tr: PreviewContext['tr']): string {
  const root = /<EplanPxfRoot\b([^>]*)>/.exec(head)
  if (!root) return tr('EPLAN PXF 아님', 'not EPLAN PXF')
  const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(root[1])?.[1] ?? ''
  const variants = (head.match(/<EplPxfDirEntry\b/g) ?? []).length
  return [attr('Type'), attr('Version') ? `EPLAN ${attr('Version')}` : '', variants ? tr(`변형 ${variants}개`, `${variants} variants`) : ''].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------------------------------------
// Archived / packed projects

async function renderProjectArchive(ctx: PreviewContext, archive: Archive, kindText: string): Promise<void> {
  const { tr } = ctx
  const ko = korean(ctx)
  const info = archive.entries.find((e) => !e.dir && /(^|\/)ProjectInfo\.xml$/i.test(e.path))
  const bak = archive.entries.find((e) => !e.dir && /(^|\/)A?_BAKINFO\.XML$/i.test(e.path))
  const comment = archive.entries.find((e) => !e.dir && /(^|\/)_COMMENT\.TXT$/i.test(e.path))
  const pageDb = archive.entries.find((e) => !e.dir && /(^|\/)Page\.eod$/i.test(e.path))
  const images = archive.entries.filter((e) => !e.dir && imageMime(e.path) && e.size > 0)
  const pdfs = archive.entries.filter((e) => !e.dir && /\.pdf$/i.test(e.path))
  const isProject = !!(info || bak || pageDb)
  let props: ReturnType<typeof parseProjectInfo> = []
  let propsError = ''
  if (info) {
    try {
      props = parseProjectInfo((await readText(info)) ?? '')
    } catch (err) {
      propsError = (err as Error).message
    }
  }
  const byId = (id: number) => props.find((p) => p.id === id)?.value ?? ''
  const version = byId(10043)
  ctx.toolbar.info([kindText, version ? `EPLAN ${version}` : '', formatBytes(ctx.bytes.byteLength)].filter(Boolean).join(' · '))

  const tabs: Tab[] = [
    {
      id: 'overview',
      label: tr('개요', 'Overview'),
      async build(panel) {
        panel.append(
          note(
            isProject
              ? tr(
                  '회로도 페이지는 EPLAN 고유의 바이너리 데이터베이스에 저장되어 있어 그릴 수 없습니다. 프로젝트 속성, 페이지 설명, 그림과 압축 내용을 보여 줍니다.',
                  'Schematic pages are stored in EPLAN’s own binary databases and cannot be drawn. The project properties, page descriptions, pictures and the archive contents are shown.'
                )
              : tr('이 압축 파일에서 EPLAN 프로젝트 정보(ProjectInfo.xml)를 찾지 못했습니다. 압축 내용만 보여 줍니다.', 'No EPLAN project information (ProjectInfo.xml) was found in this archive; only its contents are shown.'),
            isProject ? 'info' : 'warn'
          )
        )
        const rows: [string, string][] = [[tr('종류', 'Kind'), kindText]]
        for (const [id, k, e, type] of PROJECT_FIELDS) {
          const v = byId(id)
          if (!v) continue
          rows.push([tr(k, e), type === 'time' ? formatUnixTime(v) : pickLang(v, ko)])
        }
        if (propsError) panel.append(note(tr(`ProjectInfo.xml을 읽지 못했습니다: ${propsError}`, `ProjectInfo.xml could not be read: ${propsError}`), 'warn'))
        panel.append(kvTable(rows))
        if (bak) {
          try {
            const root = parseXml((await readText(bak)) ?? '')
            const bakRows: [string, string][] = []
            for (const el of walkXml(root)) if (!el.children.length && el.text.trim()) bakRows.push([el.name, el.text.trim()])
            if (bakRows.length) panel.append(heading(tr('백업 정보', 'Backup information')), kvTable(bakRows))
          } catch {
            // optional
          }
        }
        if (comment && comment.size > 0) {
          const t = (await readText(comment))?.trim()
          if (t) panel.append(heading(tr('백업 설명', 'Backup comment')), h('p', undefined, t))
        }
      }
    }
  ]
  if (pageDb) {
    tabs.push({
      id: 'pages',
      label: tr('페이지', 'Pages'),
      async build(panel) {
        panel.append(
          note(
            tr(
              'Page.eod에 저장된 페이지 설명을 저장 순서대로 보여 줍니다. 페이지 번호와 회로도 내용은 해석하지 않으며, 설명이 없는 페이지는 나타나지 않습니다.',
              'Page descriptions found in Page.eod, in stored order. Page numbers and the schematic content are not decoded, and pages without a description do not appear.'
            )
          )
        )
        if (pageDb.size > 64 * 1024 * 1024) {
          panel.append(note(tr('페이지 데이터베이스가 너무 커서 읽지 않았습니다.', 'The page database is too large to scan.'), 'warn'))
          return
        }
        const strings = scanMultiLangStrings(await pageDb.read())
        const texts = strings.map((s) => pickLang(s, ko)).filter(Boolean)
        panel.append(texts.length ? orderedList(texts) : note(tr('페이지 설명을 찾지 못했습니다.', 'No page descriptions were found.'), 'warn'))
      }
    })
  }
  if (images.length || pdfs.length) {
    tabs.push({
      id: 'images',
      label: tr(`그림·문서 (${images.length + pdfs.length})`, `Pictures & documents (${images.length + pdfs.length})`),
      async build(panel, page) {
        const shown: { name: string; bytes: Uint8Array; mime: string; ext: string }[] = []
        let total = 0
        for (const e of images.slice(0, 60)) {
          if (total > 64 * 1024 * 1024) break
          try {
            const bytes = await e.read()
            const m = imageMime(e.path, bytes)
            if (!m) continue
            total += bytes.length
            shown.push({ name: e.path, bytes, mime: m.mime, ext: m.ext })
          } catch {
            // skip unreadable pictures
          }
        }
        if (shown.length) panel.append(gallery(page, shown))
        if (images.length > shown.length) panel.append(note(tr(`그림 ${images.length - shown.length}개는 "내용" 탭에서 열 수 있습니다.`, `${images.length - shown.length} more pictures can be opened from the Contents tab.`)))
        if (pdfs.length) {
          panel.append(heading(tr('PDF 문서', 'PDF documents')))
          const ul = h('ul', 'fp-prop-list')
          for (const e of pdfs) {
            const li = h('li')
            li.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between'
            li.append(h('span', undefined, `${e.path} · ${formatBytes(e.size)}`), button(tr('열기', 'Open'), tr('미리보기에서 열기', 'Open in the preview'), () => void openEntry(page, e)))
            ul.append(li)
          }
          panel.append(ul)
        }
      }
    })
  }
  if (props.length) {
    tabs.push({
      id: 'props',
      label: tr(`프로젝트 속성 (${props.length})`, `Project properties (${props.length})`),
      build(panel) {
        panel.append(
          note(tr('ProjectInfo.xml의 모든 값입니다. 속성 이름은 프로젝트를 저장한 EPLAN의 언어로 되어 있습니다.', 'Every value in ProjectInfo.xml. Property names are in the language of the EPLAN that saved the project.')),
          kvTable(props.map((p) => [`${p.name} [${p.id}]`, pickLang(p.value, ko).replace(/\t/g, ' ')]))
        )
      }
    })
  }
  tabs.push({ id: 'contents', label: tr('내용', 'Contents'), build: (panel, page) => contentsTab(archive, page, panel) })
  createPage(ctx, tabs)
}

function orderedList(items: string[]): HTMLElement {
  const ol = h('ol', 'fp-prop-list')
  ol.style.listStyle = 'decimal'
  ol.style.paddingLeft = '28px'
  for (const t of items.slice(0, 5000)) ol.append(h('li', undefined, t))
  return ol
}
