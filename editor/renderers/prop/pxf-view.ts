/** Draws an EPLAN macro (.ema / .emp, PXF) on the pan/zoom stage the KiCad viewer uses: one variant at a time,
 *  a picker for the others, and a note on what is not drawn (library symbols, layers, colours). */
import { formatBytes } from '../../core/i18n.ts'
import { PreviewError, type PreviewContext, type ThemeName } from '../../core/types.ts'
import { h } from '../../core/ui.ts'
import { Box } from '../kicad/scene.ts'
import { createView } from '../kicad/view.ts'
import { parsePxf, pxfBounds, pxfSvg, variantLabel, type PxfMacro } from './pxf.ts'

const COLORS: Record<ThemeName, { fg: string; dim: string; bg: string }> = {
  light: { fg: '#1d2330', dim: '#6b7280', bg: '#ffffff' },
  dark: { fg: '#d9dee7', dim: '#9aa3b2', bg: '#1c1f24' }
}

const CSS = `
.pxf-wrap { position: absolute; inset: 0; display: flex; }
.pxf-note { position: absolute; left: 8px; bottom: 8px; z-index: 4; max-width: min(520px, calc(100% - 16px)); font-size: 12px; line-height: 1.45;
  background: var(--orca-popover, var(--orca-card, #fff)); color: var(--orca-popover-foreground, inherit); border: 1px solid var(--orca-border, #ccc);
  border-radius: 8px; padding: 6px 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18); }
.pxf-note button { font: inherit; font-size: 11px; margin-left: 6px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--orca-border, #ccc); background: var(--orca-secondary, #eee); color: inherit; cursor: pointer; }
`

export async function renderPxf(ctx: PreviewContext, text: string): Promise<void> {
  const { tr, toolbar, root } = ctx
  const ko = tr('ko', 'en') === 'ko'
  let macro: PxfMacro
  try {
    macro = parsePxf(text, ko)
  } catch (e) {
    throw new PreviewError(tr('EPLAN 매크로를 읽을 수 없습니다.', 'Cannot read this EPLAN macro.'), (e as Error).message)
  }
  const drawable = macro.variants.filter((v) => v.prims.length)
  if (!drawable.length) throw new PreviewError(tr('이 매크로에는 그릴 그래픽이 없습니다.', 'This macro has no graphics to draw.'), tr('장치 심볼은 EPLAN 심볼 라이브러리에 있습니다.', 'Device symbols live in EPLAN symbol libraries.'))
  await new Promise((r) => setTimeout(r, 0))
  const wrap = h('div', 'pxf-wrap')
  const style = h('style')
  style.textContent = CSS
  const stage = h('div')
  stage.style.cssText = 'position:relative;flex:1 1 auto;min-width:0'
  const noteEl = h('div', 'pxf-note')
  wrap.append(stage, noteEl)
  root.replaceChildren(style, wrap)
  const view = createView(
    ctx,
    {
      css: (t) => {
        const c = COLORS[t]
        return `.px{fill:none;stroke:${c.fg};stroke-linecap:round;stroke-linejoin:round}.pd{fill:none;stroke:${c.dim}}.pt{fill:${c.fg};stroke:none;font-family:system-ui,"Segoe UI","Malgun Gothic",sans-serif}`
      },
      background: (t) => COLORS[t].bg
    },
    stage
  )
  stage.append(noteEl)
  let index = 0
  const draw = () => {
    const v = drawable[index]
    const b = pxfBounds(v)
    const box = new Box()
    if (b) {
      box.add(b.x0, -b.y1)
      box.add(b.x1, -b.y0)
    }
    view.setContent(pxfSvg(v), box)
    const counts = { line: 0, arc: 0, bez: 0, text: 0, rect: 0 }
    for (const p of v.prims) counts[p.k]++
    toolbar.info(
      [
        `EPLAN ${macro.type || tr('매크로', 'macro')}`,
        macro.name,
        macro.version ? `EPLAN ${macro.version}` : '',
        variantLabel(v, tr),
        tr(`선 ${counts.line + counts.rect} · 호 ${counts.arc} · 곡선 ${counts.bez} · 문자 ${counts.text}`, `${counts.line + counts.rect} lines · ${counts.arc} arcs · ${counts.bez} curves · ${counts.text} texts`),
        formatBytes(ctx.bytes.byteLength)
      ]
        .filter(Boolean)
        .join(' · ')
    )
    const parts = [
      tr(
        '매크로에 저장된 선·호·곡선·문자를 그립니다. 레이어 색, 글꼴과 줄 모양은 적용하지 않습니다.',
        'The lines, arcs, curves and texts stored in the macro are drawn; layer colours, fonts and line types are not applied.'
      )
    ]
    if (v.symbols)
      parts.push(
        tr(
          `심볼 라이브러리에서 배치된 장치 ${v.symbols}개의 심볼 그래픽은 매크로에 없어 그리지 않습니다 (점선: 블랙박스 윤곽).`,
          `${v.symbols} device${v.symbols > 1 ? 's are' : ' is'} placed from symbol libraries; their symbol graphics are not in the macro and are not drawn (dashed: black box outlines).`
        )
      )
    noteEl.replaceChildren(document.createTextNode(parts.join(' ')))
    const close = h('button', undefined, '×')
    close.type = 'button'
    close.title = tr('닫기', 'Close')
    close.addEventListener('click', () => (noteEl.hidden = true))
    noteEl.append(close)
    noteEl.hidden = false
  }
  if (drawable.length > 1) {
    toolbar.select(
      tr('변형', 'Variant'),
      drawable.map((v, i) => ({ value: String(i), label: variantLabel(v, tr) })),
      (val) => {
        index = Number(val)
        draw()
      }
    )
  }
  draw()
}
