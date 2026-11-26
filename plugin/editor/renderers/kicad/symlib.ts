/** .kicad_sym: the library's symbols, one drawn at a time (unit and body style selectable). */
import { effects, placeText, type Xf } from './common.ts'
import { plainText } from './font.ts'
import { Box, circleD, fmt, Scene } from './scene.ts'
import { child, children, flag, nums, str, type SList } from './sexpr.ts'
import { SCH_ORDER, distSeg } from './sch.ts'
import { drawSymbol, layersFor, parseLibSymbol, type LibSymbol, type PinHit } from './symbol.ts'
import { layerClass } from './theme.ts'
import type { Hit } from './view.ts'

export interface SymbolView {
  symbols: LibSymbol[]
  draw(index: number, unit: number, style: number): { svg: string; bounds: Box; hit(x: number, y: number, tol: number): Hit | null }
}

const LIB_XF: Xf = { a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0 }

export function buildSymbolView(root: SList): SymbolView {
  const symbols = children(root, 'symbol').map(parseLibSymbol)
  const byName = new Map(symbols.map((s) => [s.name, s]))
  return {
    symbols,
    draw(index, unit, style) {
      const sym = symbols[index]
      // A derived symbol takes its graphics and pins from its parent.
      let base = sym
      for (let i = 0; i < 8 && base.extendsName && byName.has(base.extendsName); i++) base = byName.get(base.extendsName)!
      const scene = new Scene()
      const L = layersFor(scene)
      const pins: PinHit[] = []
      drawSymbol(L, { ...sym, pinNamesHide: base.pinNamesHide, pinNumbersHide: base.pinNumbersHide, pinNameOffset: base.pinNameOffset }, base, LIB_XF, unit, style, pins)
      // Fields at their library positions (Reference shown as "R?").
      const fieldsNode = sym.node
      for (const p of children(fieldsNode, 'property')) {
        const name = str(p[1])
        let text = str(p[2])
        const e = effects(child(p, 'effects'))
        if (e.hide || flag(p, 'hide') || !text) continue
        const at = nums(p, 'at', 3) ?? [0, 0, 0]
        if (name === 'Reference' && !sym.power) text += '?' + (base.unitCount > 1 ? String.fromCharCode(64 + Math.min(unit, 26)) : '')
        const layer = name === 'Reference' ? 'ref' : name === 'Value' ? 'value' : 'field'
        placeText(L.layer(layer), text, [at[0], -at[1]], e, at[2], LIB_XF)
      }
      // Origin marker.
      const o = scene.layer('note')
      o.seg(-0.5, 0, 0.5, 0, 0.05)
      o.seg(0, -0.5, 0, 0.5, 0.05)
      const bounds = new Box()
      bounds.addBox(scene.bounds())
      if (bounds.empty) bounds.add(0, 0, 5)
      const pad = Math.max(bounds.w, bounds.h) * 0.08 + 1
      bounds.add(bounds.x0, bounds.y0, pad)
      bounds.add(bounds.x1, bounds.y1, pad)
      return {
        svg: scene.toSvg(SCH_ORDER, layerClass),
        bounds,
        hit(x, y, tol) {
          for (const p of pins) {
            if (p.hidden) continue
            if (distSeg(x, y, p.x0, p.y0, p.x1, p.y1) <= tol + 0.3)
              return {
                title: `Pin ${p.number}${p.name && p.name !== '~' ? ` (${plainText(p.name)})` : ''}`,
                lines: [`Type: ${p.type}`, `(${fmt(p.x0)}, ${fmt(-p.y0)}) mm`],
                d: `M${fmt(p.x0)} ${fmt(p.y0)}L${fmt(p.x1)} ${fmt(p.y1)}${circleD(p.x0, p.y0, 0.3)}`
              }
          }
          return null
        }
      }
    }
  }
}
