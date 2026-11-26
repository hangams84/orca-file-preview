/** KiCad Preview: .kicad_sch, .kicad_pcb, .kicad_mod, .kicad_sym (S-expressions, drawn as SVG
 *  with KiCad's stroke font) and .kicad_pro (JSON project summary). */
import { decodeText } from '../core/encoding.ts'
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext, type ThemeName } from '../core/types.ts'
import { h } from '../core/ui.ts'
import { buildBoard, type BoardModel } from './kicad/pcb.ts'
import { renderProject } from './kicad/pro.ts'
import { buildSchematic, SCH_ORDER } from './kicad/sch.ts'
import { Box, Scene } from './kicad/scene.ts'
import { head, parseSexpr, SexprError, str, child, type SList } from './kicad/sexpr.ts'
import { buildSymbolView } from './kicad/symlib.ts'
import { layerClass, pcbColor, pcbOpacity, SCH_COLORS } from './kicad/theme.ts'
import { createView } from './kicad/view.ts'

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
    return
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
  if (kind === 'eeschema' || kind === 'kicad_wks' || kind === 'page_layout')
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

function renderSchematic(ctx: PreviewContext, root: SList): void {
  const { tr, toolbar } = ctx
  const model = buildSchematic(root, tr)
  const view = createView(ctx, {
    css: schCss,
    background: (t) => SCH_COLORS[t].background,
    hit: (x, y, tol) => model.hit(x, y, tol)
  })
  view.setContent(model.scene.toSvg(SCH_ORDER, layerClass), model.bounds)
  const { info } = model
  if (info.sheets.length) {
    const sel = toolbar.select(
      tr('하위 시트', 'Sheets'),
      [
        { value: '', label: tr(`하위 시트 ${info.sheets.length}개`, `${info.sheets.length} sheet${info.sheets.length > 1 ? 's' : ''}`) },
        ...info.sheets.map((s, i) => ({ value: String(i), label: `${s.name} — ${s.file}` }))
      ],
      (v) => {
        if (v === '') view.fit()
        else {
          const b = info.sheets[Number(v)].box
          const bb = new Box()
          bb.addBox(b)
          bb.add(b.x0, b.y0, Math.max(b.w, b.h) * 0.3)
          bb.add(b.x1, b.y1, Math.max(b.w, b.h) * 0.3)
          view.focus(bb)
        }
      }
    )
    sel.classList.add('fp-hide-compact')
  }
  const major = kicadMajor(info.version, 'sch')
  toolbar.info(
    [
      `${tr('회로도', 'Schematic')}${major ? ` · KiCad ${major}` : ''}`,
      tr(`심볼 ${info.symbols}개`, `${info.symbols} symbols`),
      info.paper,
      info.title,
      formatBytes(ctx.bytes.byteLength)
    ]
      .filter(Boolean)
      .join(' · ')
  )
}

function renderBoard(ctx: PreviewContext, root: SList): void {
  const { tr, toolbar, root: host } = ctx
  const model: BoardModel = buildBoard(root, tr)
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
