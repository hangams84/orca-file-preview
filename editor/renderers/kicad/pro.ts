/** .kicad_pro (JSON): a tidy project summary — sheets, text variables, net classes, board rules,
 *  track/via presets, schematic settings, pinned libraries — plus the raw JSON on demand. */
import { formatBytes } from '../../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../../core/types.ts'
import { cssZoom, h } from '../../core/ui.ts'

const CSS = `
.kp { max-width: 980px; margin: 0 auto; padding: 16px 20px 40px; box-sizing: border-box; }
.kp h1 { font-size: 18px; margin: 0 0 4px; }
.kp .kp-sub { color: var(--orca-muted-foreground, #666); margin-bottom: 14px; }
.kp section { margin: 18px 0; }
.kp h2 { font-size: 14px; margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--orca-border, #ddd); }
.kp .kp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.kp .kp-card { border: 1px solid var(--orca-border, #ddd); border-radius: 8px; padding: 8px 10px; background: var(--orca-card, transparent); }
.kp .kp-card b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.kp .kp-card span { color: var(--orca-muted-foreground, #666); font-size: 12px; }
.kp .kp-scroll { overflow-x: auto; }
.kp table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
.kp th, .kp td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--orca-border, #e4e4e4); white-space: nowrap; }
.kp th { font-weight: 600; color: var(--orca-muted-foreground, #555); background: var(--orca-muted, rgba(127,127,127,.08)); position: sticky; top: 0; }
.kp td.num { text-align: right; font-variant-numeric: tabular-nums; }
.kp dl { display: grid; grid-template-columns: minmax(160px, max-content) 1fr; gap: 3px 16px; margin: 0; font-size: 12px; }
.kp dt { color: var(--orca-muted-foreground, #666); }
.kp dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.kp .kp-sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -2px; border: 1px solid rgba(127,127,127,.5); }
.kp .kp-empty { color: var(--orca-muted-foreground, #777); font-style: italic; font-size: 12px; }
.kp details pre { max-height: 60vh; overflow: auto; font-size: 11px; padding: 8px; border-radius: 6px; background: var(--orca-muted, rgba(127,127,127,.1)); }
@media (max-width: 600px) { .kp { padding: 10px 12px 30px; } .kp dl { grid-template-columns: 1fr; } .kp dt { margin-top: 4px; } }
`

type J = Record<string, unknown>
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const mm = (v: unknown) => (isNum(v) ? `${+v.toFixed(4)} mm` : '—')
const mil = (v: unknown) => (isNum(v) ? `${+v.toFixed(2)} mil` : '—')

/** "min_track_width" → "Min track width". */
const pretty = (k: string) => {
  const s = k.replace(/_/g, ' ').replace(/\buvia\b/g, 'µvia')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function table(headers: string[], rows: (string | Node)[][], numeric: boolean[] = []): HTMLElement {
  const wrap = h('div', 'kp-scroll')
  const t = h('table')
  const tr = h('tr')
  for (const x of headers) tr.append(h('th', undefined, x))
  const thead = h('thead')
  thead.append(tr)
  const tb = h('tbody')
  for (const r of rows) {
    const row = h('tr')
    r.forEach((c, i) => {
      const td = h('td', numeric[i] ? 'num' : undefined)
      if (typeof c === 'string') td.textContent = c
      else td.append(c)
      row.append(td)
    })
    tb.append(row)
  }
  t.append(thead, tb)
  wrap.append(t)
  return wrap
}

function dl(pairs: [string, string][]): HTMLElement {
  const d = h('dl')
  for (const [k, v] of pairs) d.append(h('dt', undefined, k), h('dd', undefined, v))
  return d
}

function swatch(color: unknown): Node {
  const span = h('span')
  if (typeof color !== 'string' || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(\.0+)?\s*\)/.test(color)) {
    span.textContent = '—'
    return span
  }
  const sw = h('span', 'kp-sw')
  // Only plain rgb()/rgba()/#hex values reach style.
  if (/^(rgba?\([\d.,\s]+\)|#[0-9a-f]{3,8})$/i.test(color.trim())) sw.style.background = color
  span.append(sw, ` ${color}`)
  return span
}

export function renderProject(ctx: PreviewContext, text: string): void {
  const { tr, root, toolbar } = ctx
  let data: J
  try {
    data = obj(JSON.parse(text))
  } catch (e) {
    throw new PreviewError('kicad-pro', tr(`프로젝트 파일(JSON)을 읽을 수 없습니다: ${(e as Error).message}`, `Cannot read the project file (JSON): ${(e as Error).message}`))
  }
  if (!data.meta && !data.board && !data.schematic && !data.net_settings)
    throw new PreviewError('kicad-pro', tr('KiCad 프로젝트 파일이 아닙니다.', 'This is not a KiCad project file.'))

  const style = h('style')
  style.textContent = CSS
  const page = h('div', 'kp')
  const meta = obj(data.meta)
  const board = obj(data.board)
  const ds = obj(board.design_settings)
  const rules = obj(ds.rules)
  const net = obj(data.net_settings)
  const sch = obj(data.schematic)
  const classes = arr(net.classes).map(obj)
  const patterns = arr(net.netclass_patterns).map(obj)
  const sheets = arr(data.sheets)
  const vars = obj(data.text_variables)
  const trackWidths = arr(ds.track_widths).filter(isNum)
  const vias = arr(ds.via_dimensions).map(obj)
  const diffPairs = arr(ds.diff_pair_dimensions).map(obj)

  page.append(h('h1', undefined, String(meta.filename ?? tr('KiCad 프로젝트', 'KiCad project'))))
  page.append(h('div', 'kp-sub', `${tr('KiCad 프로젝트 설정', 'KiCad project settings')} · ${tr('형식 버전', 'format version')} ${meta.version ?? '?'} · ${formatBytes(ctx.bytes.byteLength)}`))

  const cards = h('div', 'kp-cards')
  const card = (n: number, label: string) => {
    const c = h('div', 'kp-card')
    c.append(h('b', undefined, String(n)), h('span', undefined, label))
    cards.append(c)
  }
  card(sheets.length, tr('시트', 'Sheets'))
  card(classes.length, tr('넷 클래스', 'Net classes'))
  card(Object.keys(vars).length, tr('텍스트 변수', 'Text variables'))
  card(trackWidths.filter((w) => w > 0).length, tr('트랙 폭 프리셋', 'Track width presets'))
  card(vias.filter((v) => isNum(v.diameter) && (v.diameter as number) > 0).length, tr('비아 프리셋', 'Via presets'))
  page.append(cards)

  const section = (title: string, ...body: Node[]) => {
    const s = h('section')
    s.append(h('h2', undefined, title), ...body)
    page.append(s)
  }
  const empty = (t: string) => h('div', 'kp-empty', t)

  // Sheets.
  section(
    tr('시트', 'Sheets'),
    sheets.length
      ? table(
          [tr('이름', 'Name'), 'UUID'],
          sheets.map((s) => {
            const a = arr(s)
            return [String(a[1] ?? ''), String(a[0] ?? '')]
          })
        )
      : empty(tr('시트 정보 없음', 'No sheet list'))
  )

  // Text variables.
  const vk = Object.keys(vars)
  section(
    tr('텍스트 변수', 'Text variables'),
    vk.length ? table([tr('이름', 'Name'), tr('값', 'Value')], vk.map((k) => [`\${${k}}`, String(vars[k])])) : empty(tr('정의된 변수 없음', 'None defined'))
  )

  // Net classes.
  section(
    tr('넷 클래스', 'Net classes'),
    classes.length
      ? table(
          [
            tr('이름', 'Name'),
            tr('간격', 'Clearance'),
            tr('트랙 폭', 'Track'),
            tr('비아 ⌀', 'Via ⌀'),
            tr('비아 드릴', 'Via drill'),
            tr('µ비아 ⌀/드릴', 'µVia ⌀/drill'),
            tr('차동쌍 폭/간격', 'Diff pair width/gap'),
            tr('배선/버스 폭', 'Wire/bus width'),
            tr('PCB 색', 'PCB colour'),
            tr('회로도 색', 'Schematic colour')
          ],
          classes.map((c) => [
            String(c.name ?? ''),
            mm(c.clearance),
            mm(c.track_width),
            mm(c.via_diameter),
            mm(c.via_drill),
            `${mm(c.microvia_diameter)} / ${mm(c.microvia_drill)}`,
            `${mm(c.diff_pair_width)} / ${mm(c.diff_pair_gap)}`,
            `${mil(c.wire_width)} / ${mil(c.bus_width)}`,
            swatch(c.pcb_color),
            swatch(c.schematic_color)
          ]),
          [false, true, true, true, true, true, true, true]
        )
      : empty(tr('넷 클래스 없음', 'No net classes')),
    ...(patterns.length
      ? [h('div', 'kp-sub', tr('넷 클래스 패턴', 'Net class patterns')), table([tr('패턴', 'Pattern'), tr('넷 클래스', 'Net class')], patterns.map((p) => [String(p.pattern ?? ''), String(p.netclass ?? '')]))]
      : [])
  )

  // Board rules.
  const ruleKeys = Object.keys(rules).filter((k) => isNum(rules[k]) || typeof rules[k] === 'boolean')
  section(
    tr('보드 설계 규칙', 'Board design rules'),
    ruleKeys.length
      ? dl(ruleKeys.map((k) => [pretty(k), typeof rules[k] === 'boolean' ? String(rules[k]) : /width|clearance|diameter|drill|hole|size|annular|edge|height|gap|length|thickness|spacing/.test(k) ? mm(rules[k]) : String(rules[k])]))
      : empty(tr('규칙 없음', 'No rules')),
    ...(trackWidths.length || vias.length || diffPairs.length
      ? [
          h('div', 'kp-sub', tr('프리셋 (첫 항목 0 = 넷 클래스 값 사용)', 'Presets (a leading 0 means “use the net class value”)')),
          dl([
            [tr('트랙 폭', 'Track widths'), trackWidths.map((w) => (w ? mm(w) : tr('넷 클래스', 'net class'))).join(', ') || '—'],
            [tr('비아 (⌀ / 드릴)', 'Vias (⌀ / drill)'), vias.map((v) => (isNum(v.diameter) && v.diameter ? `${mm(v.diameter)} / ${mm(v.drill)}` : tr('넷 클래스', 'net class'))).join(', ') || '—'],
            [tr('차동쌍 (폭 / 간격 / 비아 간격)', 'Diff pairs (width / gap / via gap)'), diffPairs.map((d) => (isNum(d.width) && d.width ? `${mm(d.width)} / ${mm(d.gap)} / ${mm(d.via_gap)}` : tr('넷 클래스', 'net class'))).join(', ') || '—']
          ])
        ]
      : [])
  )

  // Board defaults (text sizes, line widths).
  const defs = obj(ds.defaults)
  const defKeys = Object.keys(defs).filter((k) => isNum(defs[k]) || typeof defs[k] === 'boolean' || typeof defs[k] === 'string')
  if (defKeys.length)
    section(
      tr('보드 기본값', 'Board defaults'),
      dl(defKeys.map((k) => [pretty(k), isNum(defs[k]) && /size|width|thickness|offset|clearance/.test(k) ? mm(defs[k]) : String(defs[k])]))
    )

  // Schematic settings.
  const drawing = obj(sch.drawing)
  const schPairs: [string, string][] = []
  const pick = (o: J, k: string, label: string, fmt: (v: unknown) => string = String) => {
    if (o[k] !== undefined && o[k] !== null && typeof o[k] !== 'object') schPairs.push([label, fmt(o[k])])
  }
  pick(drawing, 'default_text_size', tr('기본 텍스트 크기', 'Default text size'), mil)
  pick(drawing, 'default_line_thickness', tr('기본 선 두께', 'Default line thickness'), mil)
  pick(drawing, 'pin_symbol_size', tr('핀 기호 크기', 'Pin symbol size'), mil)
  pick(drawing, 'junction_size_choice', tr('접합점 크기 선택', 'Junction size choice'))
  pick(drawing, 'label_size_ratio', tr('레이블 크기 비율', 'Label size ratio'))
  pick(drawing, 'text_offset_ratio', tr('텍스트 오프셋 비율', 'Text offset ratio'))
  pick(drawing, 'intersheets_ref_show', tr('시트 간 참조 표시', 'Show inter-sheet references'))
  pick(drawing, 'dashed_lines_dash_length_ratio', tr('대시 길이 비율', 'Dash length ratio'))
  pick(sch, 'annotate_start_num', tr('주석 시작 번호', 'Annotation start number'))
  pick(sch, 'subpart_first_id', tr('유닛 첫 ID', 'Unit first ID'), (v) => (isNum(v) ? `${v} (${String.fromCharCode(v)})` : String(v)))
  pick(sch, 'page_layout_descr_file', tr('도면 틀 파일', 'Drawing sheet file'), (v) => String(v) || '—')
  pick(sch, 'net_format_name', tr('넷리스트 형식', 'Netlist format'), (v) => String(v) || '—')
  pick(sch, 'plot_directory', tr('플롯 폴더', 'Plot directory'), (v) => String(v) || '—')
  const fieldNames = arr(drawing.field_names).map((f) => String(obj(f).name ?? '')).filter(Boolean)
  if (fieldNames.length) schPairs.push([tr('템플릿 필드', 'Template fields'), fieldNames.join(', ')])
  section(tr('회로도 설정', 'Schematic settings'), schPairs.length ? dl(schPairs) : empty(tr('설정 없음', 'No settings')))

  // ERC / DRC severity overrides.
  const sev = (o: J) => {
    const c: Record<string, number> = {}
    for (const v of Object.values(o)) if (typeof v === 'string') c[v] = (c[v] ?? 0) + 1
    return Object.entries(c)
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ')
  }
  const erc = obj(obj(data.erc).rule_severities)
  const drc = obj(ds.rule_severities)
  if (Object.keys(erc).length || Object.keys(drc).length)
    section(tr('검사 심각도', 'Check severities'), dl([['ERC', sev(erc) || '—'], ['DRC', sev(drc) || '—']]))

  // Libraries.
  const libs = obj(data.libraries)
  const ps = arr(libs.pinned_symbol_libs).map(String)
  const pf = arr(libs.pinned_footprint_libs).map(String)
  section(
    tr('고정된 라이브러리', 'Pinned libraries'),
    dl([
      [tr('심볼', 'Symbol'), ps.join(', ') || '—'],
      [tr('풋프린트', 'Footprint'), pf.join(', ') || '—']
    ])
  )

  const raw = h('details')
  raw.append(h('summary', undefined, tr('원본 JSON', 'Raw JSON')), h('pre', undefined, JSON.stringify(data, null, 2)))
  section(tr('원본', 'Source'), raw)

  root.replaceChildren(style, page)
  toolbar.info(
    [
      String(meta.filename ?? 'kicad_pro'),
      tr(`시트 ${sheets.length}개`, `${sheets.length} sheets`),
      tr(`넷 클래스 ${classes.length}개`, `${classes.length} net classes`),
      formatBytes(ctx.bytes.byteLength)
    ].join(' · ')
  )
  toolbar.zoom(cssZoom(page, root, () => page.scrollWidth))
}
