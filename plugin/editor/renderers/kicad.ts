/** KiCad Preview: .kicad_sch, .kicad_pcb, .kicad_mod, .kicad_sym (S-expressions, drawn as SVG
 *  with KiCad's stroke font) and .kicad_pro (JSON project summary). */
import { companionControls, companionFiles, findCompanion, type CompanionFile } from '../core/companions.ts'
import { decodeText } from '../core/encoding.ts'
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext, type ThemeName } from '../core/types.ts'
import { h } from '../core/ui.ts'
import { buildBoard, type BoardModel } from './kicad/pcb.ts'
import { renderProject } from './kicad/pro.ts'
import { buildHierarchy, flatten, missingSheets, projectTextVars, projectWorksheet, refLookup, type HierNode } from './kicad/hierarchy.ts'
import { buildSchematic, SCH_ORDER } from './kicad/sch.ts'
import { drawWorksheet, isWorksheet } from './kicad/wks.ts'
import { Box, Scene } from './kicad/scene.ts'
import { head, parseSexpr, SexprError, str, child, type SList } from './kicad/sexpr.ts'
import { buildSymbolView } from './kicad/symlib.ts'
import { layerClass, pcbColor, pcbOpacity, SCH_COLORS } from './kicad/theme.ts'
import { createView } from './kicad/view.ts'
import { adoptPropStyles, embed } from './prop/view.ts'

const PANEL_CSS = `
.kc-wrap { position: absolute; inset: 0; display: flex; }
.kc-main { position: relative; flex: 1 1 auto; min-width: 0; }
.kc-side { flex: none; width: 240px; display: flex; flex-direction: column; border-right: 1px solid var(--orca-border, #ddd);
  background: var(--orca-card, #fafafa); color: var(--orca-card-foreground, inherit); min-height: 0; }
.kc-side input { margin: 6px; padding: 4px 6px; font: inherit; border-radius: 6px; border: 1px solid var(--orca-input, #ccc);
  background: var(--orca-background, #fff); color: inherit; }
.kc-list { flex: 1 1 auto; overflow: auto; margin: 0; padding: 0 0 6px; list-style: none; }
.kc-list li { padding: 3px 10px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.kc-list li:hover { background: var(--orca-accent, #e8e8e8); }
.kc-list li[aria-selected="true"] { background: var(--orca-primary, #333); color: var(--orca-primary-foreground, #fff); }
.kc-list li small { opacity: .65; margin-left: 6px; }
.kc-layers { position: absolute; top: 8px; right: 8px; z-index: 4; max-height: calc(100% - 16px); overflow: auto; min-width: 190px;
  background: var(--orca-popover, var(--orca-card, #fff)); color: var(--orca-popover-foreground, inherit);
  border: 1px solid var(--orca-border, #ccc); border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.25); padding: 6px 0; font-size: 12px; }
.kc-layers label { display: flex; align-items: center; gap: 6px; padding: 2px 10px; cursor: pointer; white-space: nowrap; }
.kc-layers label:hover { background: var(--orca-accent, #eee); }
.kc-layers .kc-sw { width: 12px; height: 12px; border-radius: 3px; flex: none; border: 1px solid rgba(127,127,127,.5); }
.kc-layers .kc-row { display: flex; gap: 4px; padding: 2px 8px 6px; flex-wrap: wrap; }
.kc-layers .kc-row button { font: inherit; font-size: 11px; padding: 1px 6px; border-radius: 5px; border: 1px solid var(--orca-border, #ccc);
  background: var(--orca-secondary, #eee); color: inherit; cursor: pointer; }
.kc-layers h3 { margin: 4px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; font-weight: 600; }
@media (max-width: 600px) {
  .kc-side { display: none; }
  .kc-layers { left: 8px; right: 8px; min-width: 0; }
}
`

export function kicadMajor(version: string, kind: 'sch' | 'pcb'): string {
  const v = Number(version)
  if (!v) return ''
  if (v >= 20251001) return '10'
  if (v >= (kind === 'pcb' ? 20241229 : 20250114)) return '9'
  if (v >= (kind === 'pcb' ? 20240108 : 20231120)) return '8'
  if (v >= 20221018) return '7'
  if (v >= 20211014) return '6'
  return '5'
}

export async function render(ctx: PreviewContext): Promise<void | (() => void)> {
  const { bytes, tr, fileType } = ctx
  const { text } = decodeText(bytes)
  if (fileType === 'kicad_pro') {
    renderProject(ctx, text)
    return projectFiles(ctx, text)
  }
  let root: SList
  try {
    root = parseSexpr(text)
  } catch (e) {
    if (e instanceof SexprError)
      throw new PreviewError('kicad-parse', tr(`KiCad 파일을 읽을 수 없습니다 (${e.message}).`, `Cannot read this KiCad file (${e.message}).`))
    throw e
  }
  const kind = head(root)
  // Let the stall settle before the heavy work on big boards.
  await new Promise((r) => setTimeout(r, 0))
  if (ctx.signal.aborted) return
  if (kind === 'kicad_sch') return renderSchematic(ctx, root)
  if (kind === 'kicad_pcb' || kind === 'footprint' || kind === 'module') return renderBoard(ctx, root)
  if (kind === 'kicad_symbol_lib') return renderSymbolLib(ctx, root)
  if (kind === 'kicad_wks' || kind === 'page_layout') return renderWorksheet(ctx, root)
  if (kind === 'eeschema')
    throw new PreviewError('kicad-kind', tr(`이 KiCad 파일 종류(${kind})는 지원하지 않습니다.`, `This KiCad file kind (${kind}) is not supported.`))
  throw new PreviewError('kicad-kind', tr(`KiCad 파일이 아닙니다 (최상위: ${kind || '?'}).`, `Not a KiCad file (top level: ${kind || '?'}).`))
}

function schCss(theme: ThemeName): string {
  const c = SCH_COLORS[theme]
  let css = ''
  for (const [k, v] of Object.entries(c)) {
    if (k === 'background' || k === 'hl') continue
    const fillOnly = k === 'bodyfill' || k === 'sheetfill'
    css += `.${layerClass(k)}{stroke:${fillOnly ? 'none' : v};fill:${v}}`
    css += `.${layerClass('dim-' + k)}{stroke:${fillOnly ? 'none' : v};fill:${v};opacity:.45}`
  }
  css += `.${layerClass('image')}{opacity:1}`
  // File-defined fill colours are chosen for a light page; tone them down on a dark one.
  if (theme === 'dark') css += `.${layerClass('sheetfill')}{opacity:.16}`
  css += `.kc-hl{stroke:${c.hl}}`
  return css
}

const SCH_EXTRA_CSS = `
.kc-note { position: absolute; left: 8px; bottom: 8px; z-index: 4; max-width: min(460px, calc(100% - 16px)); max-height: 40%; overflow: auto;
  background: var(--orca-popover, var(--orca-card, #fff)); color: var(--orca-popover-foreground, inherit); border: 1px solid var(--orca-border, #ccc);
  border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.2); padding: 6px 10px; font-size: 12px; line-height: 1.45; }
.kc-note b { font-weight: 600; }
.kc-note ul { margin: 4px 0 0; padding-left: 18px; }
.kc-note button { font: inherit; font-size: 11px; margin-left: 6px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--orca-border, #ccc);
  background: var(--orca-secondary, #eee); color: inherit; cursor: pointer; }
.fp-drop-over .kc-main { outline: 2px dashed var(--orca-primary, #48f); outline-offset: -6px; }
`

/** Reads a companion KiCad S-expression file. */
async function loadSexpr(ref: string): Promise<{ root: SList; source: string } | { error: string } | null> {
  const c = findCompanion(ref)
  if (!c) return null
  try {
    const bytes = new Uint8Array(await c.file.arrayBuffer())
    return { root: parseSexpr(decodeText(bytes).text), source: c.path }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** The .kicad_pro among the companions that belongs to the opened file: the only one, or the one whose
 *  `<name>.<ext>` companion has the opened file's size. */
async function findProjectFile(size: number, ext: 'kicad_sch' | 'kicad_pcb'): Promise<string | null> {
  const pros = companionFiles().filter((c) => /\.kicad_pro$/i.test(c.path))
  let pick = pros.length === 1 ? pros[0] : null
  if (!pick)
    pick =
      pros.find((p) => {
        const twin = findCompanion(p.path.replace(/\.kicad_pro$/i, `.${ext}`))
        return twin && twin.file.size === size
      }) ?? null
  if (!pick) return null
  try {
    return await pick.file.text()
  } catch {
    return null
  }
}

export async function projectContext(size: number, ext: 'kicad_sch' | 'kicad_pcb'): Promise<{ wks?: SList; wksName?: string; wksError?: string; vars: Record<string, string> }> {
  const pro = await findProjectFile(size, ext)
  if (!pro) return { vars: {} }
  const vars = projectTextVars(pro)
  const name = projectWorksheet(pro, ext === 'kicad_sch' ? 'sch' : 'pcb')
  if (!name) return { vars }
  const got = await loadSexpr(name)
  if (!got) return { vars, wksName: name }
  if ('error' in got) return { vars, wksName: name, wksError: got.error }
  return isWorksheet(got.root) ? { vars, wks: got.root, wksName: name } : { vars, wksName: name, wksError: 'not a drawing sheet' }
}

async function renderSchematic(ctx: PreviewContext, root: SList): Promise<() => void> {
  const { tr, toolbar, root: host } = ctx
  const wrap = h('div', 'kc-wrap')
  const main = h('div', 'kc-main')
  const style = h('style')
  style.textContent = PANEL_CSS + SCH_EXTRA_CSS
  const notice = h('div', 'kc-note')
  notice.hidden = true
  wrap.append(main)
  host.replaceChildren(style, wrap)
  let model = buildSchematic(root, tr)
  let lastWorld: [number, number] | null = null
  const view = createView(
    ctx,
    {
      css: schCss,
      background: (t) => SCH_COLORS[t].background,
      hit: (x, y, tol) => {
        lastWorld = [x, y]
        return model.hit(x, y, tol)
      }
    },
    main
  )
  main.append(notice)
  view.setContent(model.scene.toSvg(SCH_ORDER, layerClass), model.bounds)

  // Hierarchy state: built from the companion files (none: only this file).
  let top: HierNode | null = null
  let current: HierNode | null = null
  let project: Awaited<ReturnType<typeof projectContext>> = { vars: {} }
  const upBtn = toolbar.button({
    label: '↑',
    title: tr('상위 시트로', 'Up to the parent sheet'),
    onClick: () => {
      if (current?.parent) open(current.parent)
    }
  })
  upBtn.hidden = true
  const focusBox = (b: Box) => {
    const bb = new Box()
    bb.addBox(b)
    bb.add(b.x0, b.y0, Math.max(b.w, b.h) * 0.3)
    bb.add(b.x1, b.y1, Math.max(b.w, b.h) * 0.3)
    view.focus(bb)
  }
  const sel = toolbar.select(tr('하위 시트', 'Sheets'), [], (v) => {
    if (top) {
      const n = flatten(top)[Number(v)]
      if (n) open(n)
      return
    }
    if (v === '') view.fit()
    else focusBox(model.info.sheets[Number(v)].box)
  })
  sel.classList.add('fp-hide-compact')
  const setOptions = (opts: { value: string; label: string }[], value: string) => {
    sel.replaceChildren(
      ...opts.map((o) => {
        const e = h('option', undefined, o.label)
        e.value = o.value
        return e
      })
    )
    sel.value = value
    sel.hidden = opts.length < 2
  }
  const crumbs = (n: HierNode): string => {
    const names: string[] = []
    for (let x: HierNode | undefined = n; x; x = x.parent) names.unshift(x.parent ? x.name : tr('루트', 'Root'))
    return names.join(' › ')
  }
  const info = () => {
    const i = model.info
    const major = kicadMajor(i.version, 'sch')
    toolbar.info(
      [
        `${tr('회로도', 'Schematic')}${major ? ` · KiCad ${major}` : ''}`,
        top && current ? `${crumbs(current)}${current.page ? ` (${tr('페이지', 'page')} ${current.page})` : ''}` : '',
        tr(`심볼 ${i.symbols}개`, `${i.symbols} symbols`),
        i.paper,
        i.title,
        formatBytes(ctx.bytes.byteLength)
      ]
        .filter(Boolean)
        .join(' · ')
    )
  }
  const showNotice = () => {
    notice.replaceChildren()
    const lines: HTMLElement[] = []
    if (!top) {
      const n = model.info.sheets.length
      if (n)
        lines.push(
          h(
            'div',
            undefined,
            tr(
              `하위 시트 ${n}개: 프로젝트 폴더를 고르거나(📁) 여기에 끌어다 놓으면 하위 시트를 열 수 있습니다.`,
              `${n} sub-sheet${n > 1 ? 's' : ''}: pick the project folder (📁) or drop it here to open them.`
            )
          )
        )
    } else {
      const miss = missingSheets(top)
      if (miss.length) {
        const ul = h('ul')
        for (const m of miss.slice(0, 20)) {
          const why =
            m.error === 'recursive'
              ? tr('자기 자신을 포함함', 'includes itself')
              : m.error
                ? tr(`읽기 오류 (${m.error})`, `cannot read (${m.error})`)
                : tr('주어진 파일에 없음', 'not among the given files')
          ul.append(h('li', undefined, `${m.sheetPath} — ${m.file}: ${why}`))
        }
        lines.push(
          h('div', undefined, tr(`열 수 없는 시트 ${miss.length}개`, `${miss.length} sheet${miss.length > 1 ? 's' : ''} not available`)),
          ul,
          h('div', undefined, tr('힌트: 프로젝트 폴더 전체(.kicad_pro가 있는 폴더)를 고르세요.', 'Hint: pick the whole project folder (the one with the .kicad_pro).'))
        )
        lines[0].style.fontWeight = '600'
      }
    }
    if (project.wksName && !project.wks)
      lines.push(
        h(
          'div',
          undefined,
          project.wksError
            ? tr(`도면 틀 ${project.wksName}을 읽지 못했습니다 (${project.wksError}). 기본 틀을 씁니다.`, `Drawing sheet ${project.wksName} could not be read (${project.wksError}); the default is drawn.`)
            : tr(`프로젝트가 도면 틀 ${project.wksName}을 씁니다. 그 파일을 주면 그대로 그립니다.`, `The project uses the drawing sheet ${project.wksName}; give that file to draw it.`)
        )
      )
    if (lines.length) {
      const close = h('button', undefined, '×')
      close.type = 'button'
      close.title = tr('닫기', 'Close')
      close.addEventListener('click', () => (notice.hidden = true))
      lines[0].append(close)
    }
    notice.append(...lines)
    notice.hidden = lines.length === 0
  }
  const draw = (n: HierNode | null) => {
    model = buildSchematic(n?.root ?? root, tr, {
      wks: project.wks,
      projectVars: project.vars,
      sheetName: n?.parent ? n.name : '',
      sheetPath: n?.sheetPath ?? '/',
      file: n?.file ?? '',
      page: n?.page || (n && !n.parent ? '1' : undefined),
      pages: top ? String(flatten(top).length) : '1',
      refFor: top && n ? refLookup(root, n) : undefined
    })
    view.setContent(model.scene.toSvg(SCH_ORDER, layerClass), model.bounds)
  }
  const label = (x: HierNode) =>
    `${' '.repeat(x.depth)}${x.parent ? x.name : tr('루트', 'Root')}${x.page ? ` [${x.page}]` : ''}${x.missing ? tr(' (없음)', ' (missing)') : x.error ? ' (!)' : ''}`
  function open(n: HierNode): void {
    if (!n.root) {
      showNotice()
      notice.hidden = false
      if (top && current) sel.value = String(flatten(top).indexOf(current))
      return
    }
    current = n
    draw(n)
    upBtn.hidden = !n.parent
    if (top) {
      const all = flatten(top)
      setOptions(
        all.map((x, i) => ({ value: String(i), label: label(x) })),
        String(all.indexOf(n))
      )
    }
    info()
  }
  const initial = () => {
    const sheets = model.info.sheets
    setOptions(
      sheets.length
        ? [
            { value: '', label: tr(`하위 시트 ${sheets.length}개`, `${sheets.length} sheet${sheets.length > 1 ? 's' : ''}`) },
            ...sheets.map((s, i) => ({ value: String(i), label: `${s.name} — ${s.file}` }))
          ]
        : [],
      ''
    )
    info()
    showNotice()
  }
  initial()

  let generation = 0
  const rebuild = async () => {
    const gen = ++generation
    project = await projectContext(ctx.bytes.byteLength, 'kicad_sch')
    const t = await buildHierarchy(root, '', loadSexpr)
    if (gen !== generation || ctx.signal.aborted) return
    top = t.children.length || project.wks ? t : null
    const was = current
    const keep = was && top ? flatten(top).find((x) => x.chain === was.chain && x.root) : null
    if (top) open(keep ?? top)
    else {
      draw(null)
      initial()
    }
    showNotice()
  }
  const undo = companionControls(ctx, () => void rebuild(), { accept: '.kicad_sch,.kicad_pro,.kicad_wks', what: { ko: 'KiCad 프로젝트 파일', en: 'KiCad project files' } })
  if (companionFiles().length) void rebuild()
  // Double-click a sheet box to open it.
  const dbl = () => {
    if (!top || !current || !lastWorld) return
    const [x, y] = lastWorld
    const i = model.info.sheets.findIndex((s) => s.box.contains(x, y, 0.5))
    const kid = i >= 0 ? current.children[i] : undefined
    if (kid) open(kid)
  }
  main.addEventListener('dblclick', dbl)
  return () => {
    undo()
    main.removeEventListener('dblclick', dbl)
  }
}

function renderBoard(ctx: PreviewContext, root: SList): void | (() => void) {
  const { tr, toolbar, root: host } = ctx
  let model: BoardModel = buildBoard(root, tr)
  const hidden = new Set<string>()
  // KiCad hides these by default in a fresh board view; keep the rest on.
  for (const n of ['Margin', 'Eco1.User', 'Eco2.User', 'F.Adhes', 'B.Adhes', 'F.Paste', 'B.Paste']) hidden.add(n)
  if (head(root) !== 'kicad_pcb') hidden.delete('F.Paste')
  let flipped = false
  const css = (t: ThemeName) => {
    let s = ''
    for (const l of model.layers) {
      const op = pcbOpacity(l.name)
      s += `.${layerClass(l.name)}{stroke:${pcbColor(t, l.name)};fill:${pcbColor(t, l.name)}${op != null ? `;opacity:${op}` : ''}${hidden.has(l.name) ? ';display:none' : ''}}`
    }
    const bg = pcbColor(t, 'background')
    s += `.${layerClass('Holes')}{fill:${bg};stroke:none}`
    s += `.${layerClass('border')}{stroke:${t === 'light' ? '#9a3a7a' : '#c87fab'};fill:${t === 'light' ? '#9a3a7a' : '#c87fab'}${hidden.has('border') ? ';display:none' : ''}}`
    s += `.kc-hl{stroke:${pcbColor(t, 'hl')}}`
    return s
  }
  const wrap = h('div', 'kc-wrap')
  const main = h('div', 'kc-main')
  const style = h('style')
  style.textContent = PANEL_CSS
  wrap.append(main)
  host.replaceChildren(style, wrap)
  const view = createView(
    ctx,
    {
      css,
      background: (t) => pcbColor(t, 'background'),
      hit: (x, y, tol) => model.hit(x, y, tol, (l) => !hidden.has(l) && (model.layers.some((i) => i.name === l) || l === 'F.Cu'))
    },
    main
  )
  const draw = (keep: boolean) => view.setContent(model.scene.toSvg(model.order(flipped), layerClass), model.bounds, keep)
  draw(false)

  // Layer panel.
  const panel = h('div', 'kc-layers')
  panel.hidden = true
  const boxes = new Map<string, HTMLInputElement>()
  const sync = () => {
    for (const [n, b] of boxes) b.checked = !hidden.has(n)
    view.restyle()
  }
  const quick = h('div', 'kc-row')
  const qb = (label: string, fn: () => void) => {
    const b = h('button', undefined, label)
    b.type = 'button'
    b.addEventListener('click', () => {
      fn()
      sync()
    })
    quick.append(b)
  }
  const all = [...model.layers.map((l) => l.name), 'border']
  qb(tr('모두', 'All'), () => hidden.clear())
  qb(tr('없음', 'None'), () => all.forEach((n) => hidden.add(n)))
  qb(tr('앞면', 'Front'), () => {
    hidden.clear()
    for (const n of all) if (n.startsWith('B.') || /^In\d/.test(n)) hidden.add(n)
  })
  qb(tr('뒷면', 'Back'), () => {
    hidden.clear()
    for (const n of all) if (n.startsWith('F.') || /^In\d/.test(n)) hidden.add(n)
  })
  qb(tr('구리', 'Copper'), () => {
    hidden.clear()
    for (const n of all) if (!n.endsWith('.Cu') && n !== 'Edge.Cuts') hidden.add(n)
  })
  panel.append(h('h3', undefined, tr('레이어', 'Layers')), quick)
  const swatches: [HTMLElement, string][] = []
  const addRow = (name: string, label: string) => {
    const row = h('label')
    const cb = h('input')
    cb.type = 'checkbox'
    cb.checked = !hidden.has(name)
    cb.addEventListener('change', () => {
      if (cb.checked) hidden.delete(name)
      else hidden.add(name)
      view.restyle()
    })
    const sw = h('span', 'kc-sw')
    swatches.push([sw, name])
    row.append(cb, sw, h('span', undefined, label))
    panel.append(row)
    boxes.set(name, cb)
  }
  for (const l of model.layers) addRow(l.name, l.label)
  if (head(root) === 'kicad_pcb') addRow('border', tr('도면 틀', 'Drawing sheet'))
  const paint = () => {
    for (const [sw, n] of swatches) sw.style.background = n === 'border' ? (ctx.theme() === 'light' ? '#9a3a7a' : '#c87fab') : pcbColor(ctx.theme(), n)
  }
  paint()
  ctx.onTheme(paint)
  main.append(panel)

  const layersBtn = toolbar.button({
    label: tr('레이어', 'Layers'),
    title: tr('레이어 표시/숨김', 'Show or hide layers'),
    onClick: () => {
      panel.hidden = !panel.hidden
      layersBtn.setAttribute('aria-pressed', String(!panel.hidden))
    }
  })
  layersBtn.setAttribute('aria-pressed', 'false')
  if (head(root) === 'kicad_pcb' || model.layers.some((l) => l.name.startsWith('B.'))) {
    const flipBtn = toolbar.button({
      label: tr('뒤집기', 'Flip'),
      title: tr('뒷면에서 보기 (좌우 반전)', 'View from the back (mirrored)'),
      onClick: () => {
        flipped = !flipped
        flipBtn.setAttribute('aria-pressed', String(flipped))
        view.setFlip(flipped)
        draw(true)
      }
    })
    flipBtn.setAttribute('aria-pressed', 'false')
  }
  let undo: (() => void) | undefined
  if (head(root) === 'kicad_pcb') {
    // A custom drawing sheet named by the project (.kicad_pro) among the given files.
    const apply = async () => {
      const pc = await projectContext(ctx.bytes.byteLength, 'kicad_pcb')
      if (!pc.wks || ctx.signal.aborted) return
      model = buildBoard(root, tr, { wks: pc.wks, projectVars: pc.vars })
      draw(true)
    }
    undo = companionControls(ctx, () => void apply(), { accept: '.kicad_pro,.kicad_wks', what: { ko: 'KiCad 프로젝트 폴더', en: 'KiCad project folder' } })
    if (companionFiles().length) void apply()
  }
  const { info } = model
  if (head(root) === 'kicad_pcb') {
    const major = kicadMajor(info.version, 'pcb')
    toolbar.info(
      [
        `${tr('PCB', 'PCB')}${major ? ` · KiCad ${major}` : ''}`,
        tr(`구리 ${info.copper}층`, `${info.copper} copper layers`),
        tr(`풋프린트 ${info.footprints}개`, `${info.footprints} footprints`),
        tr(`트랙 ${info.tracks} · 비아 ${info.vias}`, `${info.tracks} tracks · ${info.vias} vias`),
        info.nets ? tr(`넷 ${info.nets}개`, `${info.nets} nets`) : '',
        formatBytes(ctx.bytes.byteLength)
      ]
        .filter(Boolean)
        .join(' · ')
    )
  } else {
    toolbar.info([`${tr('풋프린트', 'Footprint')} ${info.name ?? ''}`, tr(`패드 ${info.pads}개`, `${info.pads} pads`), formatBytes(ctx.bytes.byteLength)].join(' · '))
  }
  return undo
}

function renderSymbolLib(ctx: PreviewContext, root: SList): void {
  const { tr, toolbar, root: host } = ctx
  const lib = buildSymbolView(root)
  if (!lib.symbols.length) throw new PreviewError('kicad-empty', tr('라이브러리에 심볼이 없습니다.', 'The library has no symbols.'))
  const wrap = h('div', 'kc-wrap')
  const side = h('div', 'kc-side')
  const main = h('div', 'kc-main')
  const style = h('style')
  style.textContent = PANEL_CSS
  wrap.append(side, main)
  host.replaceChildren(style, wrap)
  const view = createView(ctx, {
    css: schCss,
    background: (t) => SCH_COLORS[t].background,
    hit: (x, y, tol) => current?.hit(x, y, tol) ?? null
  }, main)
  let current: ReturnType<typeof lib.draw> | null = null
  let index = 0
  let unit = 1
  let style2 = 1
  const filter = h('input')
  filter.type = 'search'
  filter.placeholder = tr('심볼 검색', 'Filter symbols')
  filter.setAttribute('aria-label', filter.placeholder)
  const list = h('ul', 'kc-list')
  list.setAttribute('role', 'listbox')
  side.append(filter, list)
  const items: HTMLLIElement[] = []
  lib.symbols.forEach((s, i) => {
    const li = h('li', undefined, s.name)
    li.setAttribute('role', 'option')
    li.title = s.name
    if (s.unitCount > 1) li.append(h('small', undefined, `×${s.unitCount}`))
    if (s.power) li.append(h('small', undefined, tr('전원', 'power')))
    li.addEventListener('click', () => select(i))
    list.append(li)
    items.push(li)
  })
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase()
    items.forEach((li, i) => (li.hidden = !!q && !lib.symbols[i].name.toLowerCase().includes(q)))
  })
  const symSel = toolbar.select(
    tr('심볼', 'Symbol'),
    lib.symbols.map((s, i) => ({ value: String(i), label: s.name })),
    (v) => select(Number(v))
  )
  // The side list covers desktop; the select is for phones.
  if (!ctx.compact) symSel.style.display = 'none'
  let unitSel: HTMLSelectElement | null = null
  const unitHost = h('span')
  const styleBtn = toolbar.button({
    label: 'De Morgan',
    title: tr('대체 바디 스타일 (De Morgan)', 'Alternate body style (De Morgan)'),
    onClick: () => {
      style2 = style2 === 1 ? 2 : 1
      draw()
    }
  })
  styleBtn.after(unitHost)
  const draw = () => {
    const s = lib.symbols[index]
    current = lib.draw(index, unit, style2)
    view.setContent(current.svg, current.bounds)
    styleBtn.hidden = !s.hasAltStyle
    styleBtn.setAttribute('aria-pressed', String(style2 === 2))
    toolbar.info(
      [
        s.name,
        s.unitCount > 1 ? tr(`유닛 ${s.unitCount}개`, `${s.unitCount} units`) : '',
        s.extendsName ? tr(`${s.extendsName} 파생`, `derived from ${s.extendsName}`) : '',
        s.props.get('Description') ?? '',
        tr(`라이브러리 ${lib.symbols.length}개 심볼`, `${lib.symbols.length} symbols in library`)
      ]
        .filter(Boolean)
        .join(' · ')
    )
  }
  const select = (i: number) => {
    index = i
    unit = 1
    style2 = 1
    items.forEach((li, j) => li.setAttribute('aria-selected', String(j === i)))
    symSel.value = String(i)
    items[i].scrollIntoView({ block: 'nearest' })
    const s = lib.symbols[i]
    unitSel?.remove()
    unitSel = null
    if (s.unitCount > 1) {
      unitSel = h('select')
      unitSel.title = tr('유닛', 'Unit')
      unitSel.setAttribute('aria-label', unitSel.title)
      for (let u = 1; u <= s.unitCount; u++) {
        const o = h('option', undefined, `${tr('유닛', 'Unit')} ${String.fromCharCode(64 + Math.min(u, 26))}${s.unitNames.get(u) ? ` (${s.unitNames.get(u)})` : ''}`)
        o.value = String(u)
        unitSel.append(o)
      }
      unitSel.addEventListener('change', () => {
        unit = Number(unitSel!.value)
        draw()
      })
      unitHost.append(unitSel)
    }
    draw()
  }
  select(0)
}

// Re-exported for tests.
export { Scene, child, str }

/** .kicad_pro with the project folder given: buttons that open the root schematic and the board. */
function projectFiles(ctx: PreviewContext, text: string): () => void {
  const { tr, root } = ctx
  let stem = ''
  try {
    const meta = (JSON.parse(text) as { meta?: { filename?: unknown } }).meta
    if (typeof meta?.filename === 'string') stem = meta.filename.replace(/\.kicad_pro$/i, '')
  } catch {
    // renderProject already refused bad JSON
  }
  const page = root.querySelector('.kp')
  const box = h('section', 'kp-files')
  page?.querySelector('.kp-sub')?.after(box)
  let closeOpen: (() => void) | null = null
  const openFile = (kind: 'kicad_sch' | 'kicad_pcb', c: CompanionFile) => {
    closeOpen?.()
    adoptPropStyles()
    const layer = h('div', 'fp-prop-embed')
    layer.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;z-index:5;background:var(--orca-background,#fff)'
    root.style.position = 'relative'
    const scroll = root.scrollTop
    root.scrollTop = 0
    root.style.overflow = 'hidden'
    root.append(layer)
    void c.file.arrayBuffer().then((buf) => {
      const handle = embed(ctx, layer, { title: c.path, bytes: new Uint8Array(buf), ext: kind, render: (sub) => render(sub) }, true)
      const close = () => {
        handle.close()
        layer.remove()
        root.style.overflow = 'auto'
        root.scrollTop = scroll
        closeOpen = null
      }
      closeOpen = close
      handle.onBack(close)
    })
  }
  const fill = () => {
    box.replaceChildren(h('h2', undefined, tr('프로젝트 파일', 'Project files')))
    const row = h('div')
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center'
    const files: [string, 'kicad_sch' | 'kicad_pcb', string][] = [
      [tr('루트 회로도', 'Root schematic'), 'kicad_sch', `${stem}.kicad_sch`],
      [tr('보드', 'Board'), 'kicad_pcb', `${stem}.kicad_pcb`]
    ]
    let found = 0
    for (const [label, kind, name] of files) {
      const c = stem ? findCompanion(name) : null
      const b = h('button', 'fp-prop-btn', c ? `${label}: ${c.path}` : `${label}: ${name}`)
      b.type = 'button'
      b.disabled = !c
      b.title = c ? tr('미리보기에서 열기', 'Open in the preview') : tr('폴더를 주면 열 수 있습니다', 'Give the project folder to open it')
      if (c) {
        found++
        b.addEventListener('click', () => openFile(kind, c))
      }
      row.append(b)
    }
    box.append(row)
    if (!found)
      box.append(
        h(
          'p',
          'kp-empty',
          tr('프로젝트 폴더를 고르거나(📁) 여기에 끌어다 놓으면 루트 회로도와 보드를 열 수 있습니다.', 'Pick the project folder (📁) or drop it here to open the root schematic and the board.')
        )
      )
  }
  fill()
  const undo = companionControls(ctx, fill, { accept: '.kicad_sch,.kicad_pcb,.kicad_wks', what: { ko: 'KiCad 프로젝트 폴더', en: 'KiCad project folder' } })
  return () => {
    closeOpen?.()
    undo()
  }
}

/** A drawing sheet on its own (.kicad_wks): drawn on A4 landscape with the variables left as names, like a template. */
function renderWorksheet(ctx: PreviewContext, root: SList): void {
  const { tr, toolbar } = ctx
  const scene = new Scene()
  const paper = { name: 'A4', w: 297, h: 210 }
  const names = { title: '${TITLE}', date: '${ISSUE_DATE}', rev: '${REVISION}', company: '${COMPANY}', comments: Array.from({ length: 9 }, (_, i) => `\${COMMENT${i + 1}}`) }
  const count = drawWorksheet(scene.layer('border'), root, { paper, tb: names, sheetName: '${SHEETNAME}', sheetPath: '${SHEETPATH}', file: '${FILENAME}', page: '${#}', pages: '${##}' }, true)
  const bounds = new Box()
  bounds.add(0, 0)
  bounds.add(paper.w, paper.h)
  const view = createView(ctx, { css: schCss, background: (t) => SCH_COLORS[t].background })
  view.setContent(`<rect x="0" y="0" width="${paper.w}" height="${paper.h}" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width=".3"/>` + scene.toSvg(SCH_ORDER, layerClass), bounds)
  toolbar.info([tr('KiCad 도면 틀', 'KiCad drawing sheet'), tr(`항목 ${count}개`, `${count} items`), tr('A4 가로에 표시', 'shown on A4 landscape'), formatBytes(ctx.bytes.byteLength)].join(' · '))
}
