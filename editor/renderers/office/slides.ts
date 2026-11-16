/** PresentationML → DOM. Each slide becomes an absolutely positioned box at its natural pixel size
 *  (96 dpi; 1 px = 9525 EMU) holding master/layout decorations and the slide's own shapes: text
 *  bodies, pictures, simple tables, preset geometry (rect, ellipse, round rect, a few polygons,
 *  lines) and solid/gradient fills. Anything else degrades to its text. */
import { h } from '../../core/ui.ts'
import { withFallback } from './fonts.ts'
import { colorChild, fillCss, hexOf, parseClrMap, parseTheme, resolveColor, type ColorCtx, type Theme } from './drawing.ts'
import type { OoxmlPackage } from './package.ts'
import { attr, bool, find, findAll, kid, kids, num, path, relAttr } from './xml.ts'

export const EMU_PER_PX = 9525
const px = (emu: number) => emu / EMU_PER_PX
const PT_PX = 96 / 72

export interface SlideRef {
  index: number
  part: string
  hidden: boolean
}

export interface Deck {
  width: number
  height: number
  slides: SlideRef[]
  defaultTextStyle: Element | null
}

export function readDeck(pkg: OoxmlPackage): Deck | null {
  const main = findMainPart(pkg)
  const doc = main ? pkg.xml(main) : null
  const root = doc?.documentElement
  if (!main || !root || root.localName !== 'presentation') return null
  const sz = kid(root, 'sldSz')
  const rels = pkg.rels(main)
  const slides: SlideRef[] = []
  for (const id of kids(kid(root, 'sldIdLst'), 'sldId')) {
    const rel = rels.get(relAttr(id, 'id') ?? '')
    if (!rel || rel.external || !pkg.has(rel.target)) continue
    const sdoc = pkg.xml(rel.target)
    slides.push({ index: slides.length, part: rel.target, hidden: attr(sdoc?.documentElement, 'show') === '0' })
  }
  return {
    width: px(num(sz, 'cx', 9144000)!),
    height: px(num(sz, 'cy', 6858000)!),
    slides,
    defaultTextStyle: kid(root, 'defaultTextStyle')
  }
}

function findMainPart(pkg: OoxmlPackage): string | null {
  for (const r of pkg.rels('').values()) if (r.type === 'officeDocument') return r.target
  return pkg.has('ppt/presentation.xml') ? 'ppt/presentation.xml' : null
}

/** One layer of the inheritance chain: slide, layout or master. */
interface Layer {
  part: string
  root: Element | null
  tree: Element | null
}

interface SlideEnv {
  pkg: OoxmlPackage
  deck: Deck
  cc: ColorCtx
  theme: Theme
  slide: Layer
  layout: Layer
  master: Layer
  txStyles: Element | null
}

function layer(pkg: OoxmlPackage, part: string | undefined): Layer {
  const root = part ? (pkg.xml(part)?.documentElement ?? null) : null
  return { part: part ?? '', root, tree: path(root, 'cSld', 'spTree') }
}

function envFor(pkg: OoxmlPackage, deck: Deck, ref: SlideRef): SlideEnv {
  const slide = layer(pkg, ref.part)
  const layout = layer(pkg, pkg.relOfType(ref.part, 'slideLayout')?.target)
  const master = layer(pkg, layout.part ? pkg.relOfType(layout.part, 'slideMaster')?.target : undefined)
  const theme = parseTheme(master.part ? pkg.xml(pkg.relOfType(master.part, 'theme')?.target ?? '') : null)
  let map = parseClrMap(kid(master.root, 'clrMap'))
  for (const l of [layout, slide]) {
    const ovr = path(l.root, 'clrMapOvr', 'overrideClrMapping')
    if (ovr) map = parseClrMap(ovr)
  }
  return { pkg, deck, theme, cc: { theme, map }, slide, layout, master, txStyles: kid(master.root, 'txStyles') }
}

/** Builds the DOM for a slide at natural size. */
export function renderSlide(pkg: OoxmlPackage, deck: Deck, ref: SlideRef): HTMLElement {
  const env = envFor(pkg, deck, ref)
  const box = h('div', 'fp-slide fp-page')
  box.style.width = `${deck.width}px`
  box.style.height = `${deck.height}px`
  applyBackground(box, env)
  // Master and layout decorations (logos, bars) unless the slide or layout hides them.
  const showMaster = attr(env.slide.root, 'showMasterSp') !== '0' && attr(env.layout.root, 'showMasterSp') !== '0'
  if (showMaster) drawTree(box, env, env.master, true)
  if (attr(env.slide.root, 'showMasterSp') !== '0') drawTree(box, env, env.layout, true)
  drawTree(box, env, env.slide, false)
  return box
}

function applyBackground(box: HTMLElement, env: SlideEnv): void {
  for (const l of [env.slide, env.layout, env.master]) {
    const bg = path(l.root, 'cSld', 'bg')
    if (!bg) continue
    const pr = kid(bg, 'bgPr')
    if (pr) {
      const blip = path(pr, 'blipFill', 'blip')
      if (blip) {
        const url = mediaFor(env, l.part, blip)
        if (url) {
          box.style.background = `#fff url("${url}") center / cover no-repeat`
          return
        }
      }
      const css = fillCss(pr, env.cc)
      if (css && css !== 'none') {
        box.style.background = css
        return
      }
    }
    const ref = kid(bg, 'bgRef')
    if (ref) {
      const color = resolveColor(colorChild(ref), env.cc)
      const idx = num(ref, 'idx', 0)!
      const style = idx >= 1001 ? env.theme.bgFillStyles[idx - 1001] : env.theme.fillStyles[idx - 1]
      const css = style ? fillCss(wrapFill(style), { ...env.cc, phClr: hexOf(color) }) : color
      if (css && css !== 'none') {
        box.style.background = css
        return
      }
      if (color) {
        box.style.background = color
        return
      }
    }
  }
  box.style.background = resolveColor(schemeEl('bg1'), env.cc) ?? '#fff'
}

/** A theme style-list entry (e.g. `<a:solidFill>`) wrapped so fillCss can read it as a child. */
function wrapFill(fill: Element): Element {
  const w = fill.ownerDocument.createElementNS(fill.namespaceURI, 'wrap')
  w.append(fill.cloneNode(true))
  return w
}

function schemeEl(val: string): Element {
  const el = document.implementation.createDocument(null, 'schemeClr', null).documentElement
  el.setAttribute('val', val)
  return el
}

function mediaFor(env: SlideEnv, part: string, blip: Element): string | null {
  const id = relAttr(blip, 'embed') ?? relAttr(blip, 'link')
  if (!id) return null
  const rel = env.pkg.rels(part).get(id)
  return rel && !rel.external ? env.pkg.mediaUrl(rel.target) : null
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Maps child coordinates of a group into slide pixels. */
type Mapper = (r: Rect) => Rect
const identity: Mapper = (r) => r

function drawTree(box: HTMLElement, env: SlideEnv, l: Layer, decorationsOnly: boolean): void {
  if (!l.tree) return
  drawChildren(box, env, l, l.tree, identity, decorationsOnly)
}

function drawChildren(box: HTMLElement, env: SlideEnv, l: Layer, parent: Element, map: Mapper, decorationsOnly: boolean): void {
  for (const el of kids(parent)) {
    try {
      drawElement(box, env, l, el, map, decorationsOnly)
    } catch (err) {
      // One odd shape must not lose the slide.
      console.warn('pptx: shape skipped', err)
    }
  }
}

function drawElement(box: HTMLElement, env: SlideEnv, l: Layer, el: Element, map: Mapper, decorationsOnly: boolean): void {
  switch (el.localName) {
    case 'sp':
    case 'cxnSp': {
      const ph = placeholderOf(el)
      if (decorationsOnly && ph) return
      drawShape(box, env, l, el, map, ph)
      return
    }
    case 'pic': {
      if (decorationsOnly && placeholderOf(el)) return
      drawPicture(box, env, l, el, map)
      return
    }
    case 'graphicFrame':
      if (decorationsOnly && placeholderOf(el)) return
      drawFrame(box, env, l, el, map)
      return
    case 'grpSp': {
      const xfrm = path(el, 'grpSpPr', 'xfrm')
      const outer = xfrmRect(xfrm)
      const chOff = kid(xfrm, 'chOff')
      const chExt = kid(xfrm, 'chExt')
      let inner = map
      if (outer && chOff && chExt) {
        const cx = px(num(chOff, 'x', 0)!)
        const cy = px(num(chOff, 'y', 0)!)
        const sx = num(chExt, 'cx', 0)! ? outer.w / px(num(chExt, 'cx', 1)!) : 1
        const sy = num(chExt, 'cy', 0)! ? outer.h / px(num(chExt, 'cy', 1)!) : 1
        inner = (r) => map({ x: outer.x + (r.x - cx) * sx, y: outer.y + (r.y - cy) * sy, w: r.w * sx, h: r.h * sy })
      }
      drawChildren(box, env, l, el, inner, decorationsOnly)
      return
    }
    case 'AlternateContent': {
      const pick = kid(el, 'Fallback') ?? kid(el, 'Choice')
      if (pick) drawChildren(box, env, l, pick, map, decorationsOnly)
      return
    }
  }
}

interface Ph {
  type: string
  idx: string | null
}

function placeholderOf(el: Element): Ph | null {
  const nv = kids(el).find((c) => c.localName.startsWith('nv'))
  const ph = path(nv, 'nvPr', 'ph')
  if (!ph) return null
  return { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') }
}

/** The matching placeholder shape on a layout or master. */
function findPh(l: Layer, ph: Ph, byTypeOnly: boolean): Element | null {
  if (!l.tree) return null
  const all = [...findAll(l.tree, 'sp'), ...findAll(l.tree, 'pic'), ...findAll(l.tree, 'graphicFrame')]
  const norm = (t: string) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' || t === 'obj' ? 'body' : t)
  if (!byTypeOnly && ph.idx != null) {
    const hit = all.find((s) => placeholderOf(s)?.idx === ph.idx)
    if (hit) return hit
  }
  const exact = all.find((s) => placeholderOf(s)?.type === ph.type)
  if (exact) return exact
  return all.find((s) => {
    const p = placeholderOf(s)
    return p && norm(p.type) === norm(ph.type)
  }) ?? null
}

function xfrmRect(xfrm: Element | null): Rect | null {
  const off = kid(xfrm, 'off')
  const ext = kid(xfrm, 'ext')
  if (!off || !ext) return null
  return { x: px(num(off, 'x', 0)!), y: px(num(off, 'y', 0)!), w: px(num(ext, 'cx', 0)!), h: px(num(ext, 'cy', 0)!) }
}

/** The shapes this shape inherits from (layout placeholder, master placeholder). */
function inheritance(env: SlideEnv, l: Layer, ph: Ph | null): Element[] {
  if (!ph) return []
  const out: Element[] = []
  if (l === env.slide) {
    const lp = findPh(env.layout, ph, false)
    if (lp) out.push(lp)
    const mp = findPh(env.master, lp ? placeholderOf(lp) ?? ph : ph, true)
    if (mp) out.push(mp)
  } else if (l === env.layout) {
    const mp = findPh(env.master, ph, true)
    if (mp) out.push(mp)
  }
  return out
}

function shapeXfrm(el: Element): Element | null {
  return path(el, 'spPr', 'xfrm') ?? kid(el, 'xfrm') ?? path(el, 'grpSpPr', 'xfrm')
}

function place(node: HTMLElement, r: Rect, xfrm: Element | null): void {
  node.style.left = `${r.x}px`
  node.style.top = `${r.y}px`
  node.style.width = `${Math.max(0, r.w)}px`
  node.style.height = `${Math.max(0, r.h)}px`
  const rot = (num(xfrm, 'rot', 0) ?? 0) / 60000
  if (rot) node.style.transform = `rotate(${rot}deg)`
}

// ---------------------------------------------------------------- shapes

function drawShape(box: HTMLElement, env: SlideEnv, l: Layer, el: Element, map: Mapper, ph: Ph | null): void {
  const chain = inheritance(env, l, ph)
  let xfrm = shapeXfrm(el)
  let rect = xfrmRect(xfrm)
  for (const s of chain) {
    if (rect) break
    xfrm = shapeXfrm(s)
    rect = xfrmRect(xfrm)
  }
  if (!rect) return
  rect = map(rect)
  const spPr = kid(el, 'spPr')
  const style = kid(el, 'style')
  const node = h('div', 'fp-shape')
  place(node, rect, xfrm)

  // Fill and outline: own spPr, then the placeholder chain, then the style references.
  let fill = fillCss(spPr, env.cc)
  for (const s of chain) if (fill == null) fill = fillCss(kid(s, 'spPr'), env.cc)
  if (fill == null && style) fill = styleFill(env, kid(style, 'fillRef'))
  const ln = kid(spPr, 'ln') ?? chain.map((s) => path(s, 'spPr', 'ln')).find(Boolean) ?? null
  const stroke = lineCss(env, ln, style ? kid(style, 'lnRef') : null)
  const geom = attr(path(spPr, 'prstGeom'), 'prst') ?? (kid(spPr, 'custGeom') ? 'rect' : 'rect')
  if (el.localName === 'cxnSp' || geom.includes('line') || geom.includes('Connector')) {
    drawLine(node, rect, xfrm, stroke ?? { color: '#000', width: 1, dash: '' }, ln)
  } else if ((fill && fill !== 'none') || stroke) {
    node.append(geometry(geom, rect, fill && fill !== 'none' ? fill : null, stroke, path(spPr, 'prstGeom', 'avLst')))
  }
  const txBody = kid(el, 'txBody')
  if (txBody && hasText(txBody)) {
    const fontRef = style ? kid(style, 'fontRef') : null
    const tb = textBody(env, l, txBody, chain, ph, fontRef ? resolveColor(colorChild(fontRef), env.cc) : null, rect)
    // Text sits in the preset's text rectangle (inside the triangle, between a chevron's notches).
    const ins = textInsets(geom, rect.w, rect.h, path(spPr, 'prstGeom', 'avLst'))
    if (ins) {
      tb.style.inset = 'auto'
      tb.style.left = `${ins.l}px`
      tb.style.top = `${ins.t}px`
      tb.style.right = `${ins.r}px`
      tb.style.bottom = `${ins.b}px`
    }
    node.append(tb)
  }
  box.append(node)
}

function styleFill(env: SlideEnv, ref: Element | null): string | null {
  if (!ref) return null
  const idx = num(ref, 'idx', 0)!
  const color = resolveColor(colorChild(ref), env.cc)
  if (idx <= 0) return null
  const st = env.theme.fillStyles[idx - 1]
  return (st ? fillCss(wrapFill(st), { ...env.cc, phClr: hexOf(color) }) : null) ?? color
}

interface Stroke {
  color: string
  width: number
  dash: string
}

function lineCss(env: SlideEnv, ln: Element | null, ref: Element | null): Stroke | null {
  if (ln && kid(ln, 'noFill')) return null
  let color = ln ? resolveColor(colorChild(kid(ln, 'solidFill')), env.cc) : null
  let width = ln ? num(ln, 'w') : undefined
  if (!color && ref && num(ref, 'idx', 0)! > 0) {
    color = resolveColor(colorChild(ref), env.cc)
    const st = env.theme.lnStyles[num(ref, 'idx', 1)! - 1]
    if (width == null) width = num(st, 'w')
    if (st && kid(st, 'solidFill') && !colorChild(ref)) {
      color = resolveColor(colorChild(kid(st, 'solidFill')), env.cc)
    }
  }
  if (!color) return null
  const dashVal = attr(kid(ln, 'prstDash'), 'val')
  const w = Math.max(0.75, px(width ?? 9525))
  return { color, width: w, dash: dashVal && dashVal !== 'solid' ? `${w * 3} ${w * 2}` : '' }
}

const SVG = 'http://www.w3.org/2000/svg'
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

function drawLine(node: HTMLElement, r: Rect, xfrm: Element | null, s: Stroke, ln: Element | null): void {
  const flipH = bool(xfrm, 'flipH')
  const flipV = bool(xfrm, 'flipV')
  const svg = svgEl('svg', { width: Math.max(1, r.w), height: Math.max(1, r.h), class: 'fp-geom' })
  svg.style.overflow = 'visible'
  const [x1, x2] = flipH ? [r.w, 0] : [0, r.w]
  const [y1, y2] = flipV ? [r.h, 0] : [0, r.h]
  const line = svgEl('line', { x1, y1, x2, y2, stroke: s.color, 'stroke-width': s.width })
  if (s.dash) line.setAttribute('stroke-dasharray', s.dash)
  svg.append(line)
  if (kid(ln, 'tailEnd') && attr(kid(ln, 'tailEnd'), 'type') !== 'none') {
    const a = Math.atan2(y2 - y1, x2 - x1)
    const len = s.width * 4 + 4
    const pts = [
      [x2, y2],
      [x2 - len * Math.cos(a - 0.4), y2 - len * Math.sin(a - 0.4)],
      [x2 - len * Math.cos(a + 0.4), y2 - len * Math.sin(a + 0.4)]
    ]
    svg.append(svgEl('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: s.color }))
  }
  node.append(svg)
}

/** Preset geometry as SVG. Unknown presets draw as rectangles. */
function geometry(prst: string, r: Rect, fill: string | null, s: Stroke | null, avLst: Element | null): Element {
  const w = Math.max(1, r.w)
  const hh = Math.max(1, r.h)
  // Gradients cannot be SVG fills directly; paint them as a CSS background on a clipped div.
  if (fill && fill.includes('gradient(')) {
    const d = h('div', 'fp-geom')
    d.style.cssText = `position:absolute;inset:0;background:${fill}`
    if (prst === 'ellipse') d.style.borderRadius = '50%'
    else if (prst === 'roundRect') d.style.borderRadius = `${Math.min(w, hh) * adj(avLst, 16667)}px`
    if (s) d.style.border = `${s.width}px solid ${s.color}`
    d.style.boxSizing = 'border-box'
    return d
  }
  const svg = svgEl('svg', { width: w, height: hh, viewBox: `0 0 ${w} ${hh}`, class: 'fp-geom' })
  svg.style.overflow = 'visible'
  const paint: Record<string, string | number> = { fill: fill ?? 'none' }
  if (s) {
    paint.stroke = s.color
    paint['stroke-width'] = s.width
    if (s.dash) paint['stroke-dasharray'] = s.dash
  }
  const poly = (pts: number[][]) => svgEl('polygon', { points: pts.map((p) => p.join(',')).join(' '), ...paint })
  const m = Math.min(w, hh)
  let shape: SVGElement
  switch (prst) {
    case 'ellipse':
    case 'circle':
      shape = svgEl('ellipse', { cx: w / 2, cy: hh / 2, rx: w / 2, ry: hh / 2, ...paint })
      break
    case 'roundRect': {
      const rr = m * adj(avLst, 16667)
      shape = svgEl('rect', { x: 0, y: 0, width: w, height: hh, rx: rr, ry: rr, ...paint })
      break
    }
    case 'triangle':
      shape = poly([[w * adj(avLst, 50000), 0], [w, hh], [0, hh]])
      break
    case 'rtTriangle':
      shape = poly([[0, 0], [w, hh], [0, hh]])
      break
    case 'diamond':
      shape = poly([[w / 2, 0], [w, hh / 2], [w / 2, hh], [0, hh / 2]])
      break
    case 'parallelogram': {
      const o = m * adj(avLst, 25000)
      shape = poly([[o, 0], [w, 0], [w - o, hh], [0, hh]])
      break
    }
    case 'hexagon': {
      const o = m * adj(avLst, 25000)
      shape = poly([[o, 0], [w - o, 0], [w, hh / 2], [w - o, hh], [o, hh], [0, hh / 2]])
      break
    }
    case 'homePlate': {
      const o = m * adj(avLst, 50000)
      shape = poly([[0, 0], [w - o, 0], [w, hh / 2], [w - o, hh], [0, hh]])
      break
    }
    case 'chevron': {
      const o = m * adj(avLst, 50000)
      shape = poly([[0, 0], [w - o, 0], [w, hh / 2], [w - o, hh], [0, hh], [o, hh / 2]])
      break
    }
    case 'rightArrow': {
      const t = hh * adj(avLst, 50000, 0)
      const head = m * adj(avLst, 50000, 1)
      const y0 = (hh - t) / 2
      shape = poly([[0, y0], [w - head, y0], [w - head, 0], [w, hh / 2], [w - head, hh], [w - head, hh - y0], [0, hh - y0]])
      break
    }
    case 'leftArrow': {
      const t = hh * adj(avLst, 50000, 0)
      const head = m * adj(avLst, 50000, 1)
      const y0 = (hh - t) / 2
      shape = poly([[w, y0], [head, y0], [head, 0], [0, hh / 2], [head, hh], [head, hh - y0], [w, hh - y0]])
      break
    }
    default:
      shape = svgEl('rect', { x: 0, y: 0, width: w, height: hh, ...paint })
  }
  svg.append(shape)
  return svg
}

/** An adjust value (`<a:gd fmla="val 16667"/>`) as a fraction, by position. */
/** Insets of a preset shape's text rectangle (ECMA-376 presetShapeDefinitions `<a:rect>`), in px. */
function textInsets(prst: string, w: number, hh: number, avLst: Element | null): { l: number; t: number; r: number; b: number } | null {
  const ss = Math.min(w, hh)
  switch (prst) {
    case 'ellipse':
    case 'circle': {
      // idx = wd2 * cos(45°): the inscribed rectangle
      const k = (1 - Math.SQRT1_2) / 2
      return { l: w * k, t: hh * k, r: w * k, b: hh * k }
    }
    case 'roundRect': {
      const x1 = ss * adj(avLst, 16667) * 0.29289
      return { l: x1, t: x1, r: x1, b: x1 }
    }
    case 'triangle': {
      const a = adj(avLst, 50000)
      const x1 = (w * a) / 2
      const x3 = x1 + w / 2
      return { l: x1, t: hh / 2, r: w - x3, b: 0 }
    }
    case 'rtTriangle':
      return { l: w / 12, t: (hh * 7) / 12, r: (w * 5) / 12, b: 0 }
    case 'diamond':
      return { l: w / 4, t: hh / 4, r: w / 4, b: hh / 4 }
    case 'parallelogram': {
      const a = Math.min(adj(avLst, 25000), w / ss)
      const x2 = ss * a
      // il = wd2 * a / maxAdj (approximately half the slant), it = hd2 * …: keep the slanted parts free
      const il = (x2 * 5) / 12
      return { l: il + x2 / 2, t: (hh * x2) / (w * 4), r: il + x2 / 2, b: (hh * x2) / (w * 4) }
    }
    case 'hexagon': {
      const x1 = ss * adj(avLst, 25000)
      return { l: x1 / 2, t: hh / 8, r: x1 / 2, b: hh / 8 }
    }
    case 'homePlate': {
      const dx = ss * adj(avLst, 50000)
      return { l: 0, t: 0, r: dx / 2, b: 0 }
    }
    case 'chevron': {
      const x1 = ss * adj(avLst, 50000)
      return x1 < w - x1 ? { l: x1, t: 0, r: x1, b: 0 } : { l: 0, t: 0, r: 0, b: 0 }
    }
    case 'rightArrow':
    case 'leftArrow': {
      const a1 = adj(avLst, 50000, 0)
      const dx2 = ss * adj(avLst, 50000, 1)
      const dy1 = (hh * a1) / 2
      const y1 = hh / 2 - dy1
      const dx1 = (y1 * dx2) / (hh / 2)
      const head = dx2 - dx1 // part of the head that the text may still use
      return prst === 'rightArrow'
        ? { l: 0, t: y1, r: Math.max(0, head), b: y1 }
        : { l: Math.max(0, head), t: y1, r: 0, b: y1 }
    }
  }
  return null
}

function adj(avLst: Element | null, fallback: number, index = 0): number {
  const gd = kids(avLst, 'gd')[index]
  const m = /val\s+(-?\d+)/.exec(attr(gd, 'fmla') ?? '')
  return (m ? Number(m[1]) : fallback) / 100000
}

// ---------------------------------------------------------------- pictures

function drawPicture(box: HTMLElement, env: SlideEnv, l: Layer, el: Element, map: Mapper): void {
  const ph = placeholderOf(el)
  const chain = inheritance(env, l, ph)
  let xfrm = shapeXfrm(el)
  let rect = xfrmRect(xfrm)
  for (const s of chain) {
    if (rect) break
    xfrm = shapeXfrm(s)
    rect = xfrmRect(xfrm)
  }
  if (!rect) return
  rect = map(rect)
  const node = h('div', 'fp-shape fp-pic')
  place(node, rect, xfrm)
  const blipFill = kid(el, 'blipFill')
  const blip = kid(blipFill, 'blip')
  const url = blip ? mediaFor(env, l.part, blip) : null
  if (url) {
    const img = h('img')
    img.alt = attr(path(el, 'nvPicPr', 'cNvPr'), 'descr') ?? ''
    img.decoding = 'async'
    img.draggable = false
    img.src = url
    // srcRect crops in 1/1000 %: scale the image up and shift it so the kept part fills the box.
    const src = kid(blipFill, 'srcRect')
    const cl = (num(src, 'l', 0) ?? 0) / 100000
    const ct = (num(src, 't', 0) ?? 0) / 100000
    const cr = (num(src, 'r', 0) ?? 0) / 100000
    const cb = (num(src, 'b', 0) ?? 0) / 100000
    if (cl || ct || cr || cb) {
      const fw = rect.w / Math.max(0.01, 1 - cl - cr)
      const fh = rect.h / Math.max(0.01, 1 - ct - cb)
      img.style.cssText = `position:absolute;width:${fw}px;height:${fh}px;left:${-cl * fw}px;top:${-ct * fh}px;max-width:none`
      node.style.overflow = 'hidden'
    }
    const flips = [bool(xfrm, 'flipH') ? 'scaleX(-1)' : '', bool(xfrm, 'flipV') ? 'scaleY(-1)' : ''].join(' ').trim()
    if (flips) img.style.transform = flips
    node.append(img)
  } else {
    node.classList.add('fp-missing')
    node.append(h('span', undefined, attr(path(el, 'nvPicPr', 'cNvPr'), 'descr') || '🖼'))
  }
  const ln = path(el, 'spPr', 'ln')
  const s = ln ? lineCss(env, ln, null) : null
  if (s) node.style.outline = `${s.width}px solid ${s.color}`
  box.append(node)
}

// ---------------------------------------------------------------- tables and other frames

function drawFrame(box: HTMLElement, env: SlideEnv, l: Layer, el: Element, map: Mapper): void {
  const xfrm = kid(el, 'xfrm')
  const r0 = xfrmRect(xfrm)
  if (!r0) return
  const rect = map(r0)
  const node = h('div', 'fp-shape')
  place(node, rect, xfrm)
  const data = path(el, 'graphic', 'graphicData')
  const tbl = kid(data, 'tbl')
  if (tbl) {
    node.append(table(env, l, tbl))
    box.append(node)
    return
  }
  // Charts, SmartArt, OLE objects: show a labelled frame with any text they carry.
  const uri = attr(data, 'uri') ?? ''
  const label = uri.includes('chart') ? '📊' : uri.includes('diagram') ? '◇' : '▣'
  node.classList.add('fp-frame')
  const fallbackPic = find(data, 'pic')
  if (fallbackPic) {
    const blip = find(fallbackPic, 'blip')
    const url = blip ? mediaFor(env, l.part, blip) : null
    if (url) {
      const img = h('img')
      img.src = url
      img.alt = ''
      node.append(img)
      box.append(node)
      return
    }
  }
  node.append(h('span', 'fp-frame-label', label))
  box.append(node)
}

function table(env: SlideEnv, l: Layer, tbl: Element): HTMLElement {
  const t = h('table', 'fp-tbl')
  const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => px(num(g, 'w', 0)!))
  const cg = h('colgroup')
  for (const w of grid) {
    const c = h('col')
    c.style.width = `${w}px`
    cg.append(c)
  }
  t.append(cg)
  const pr = kid(tbl, 'tblPr')
  const firstRow = bool(pr, 'firstRow')
  const bandRow = bool(pr, 'bandRow')
  const styled = !!attr(kid(pr, 'tableStyleId'), 'val') || !!kid(pr, 'tableStyleId')?.textContent
  const accent = resolveColor(schemeEl('accent1'), env.cc) ?? '#4472C4'
  const accentHex = hexOf(accent) ?? '4472C4'
  const tint = (f: number) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(accentHex.slice(i, i + 2), 16))
    return `rgb(${Math.round(r + (255 - r) * f)},${Math.round(g + (255 - g) * f)},${Math.round(b + (255 - b) * f)})`
  }
  kids(tbl, 'tr').forEach((row, ri) => {
    const tr = h('tr')
    tr.style.height = `${px(num(row, 'h', 0)!)}px`
    for (const tc of kids(row, 'tc')) {
      if (bool(tc, 'hMerge') || bool(tc, 'vMerge')) continue
      const td = h('td')
      const span = num(tc, 'gridSpan', 1)!
      const rspan = num(tc, 'rowSpan', 1)!
      if (span > 1) td.colSpan = span
      if (rspan > 1) td.rowSpan = rspan
      const tcPr = kid(tc, 'tcPr')
      let bg = fillCss(tcPr, env.cc)
      let color: string | null = null
      // Approximation of the default "Medium Style 2 – Accent 1" when the cell has no own fill.
      if (bg == null && styled) {
        if (firstRow && ri === 0) {
          bg = accent
          color = '#fff'
        } else bg = bandRow && (ri - (firstRow ? 1 : 0)) % 2 === 0 ? tint(0.6) : tint(0.8)
      }
      if (bg && bg !== 'none') td.style.background = bg
      td.style.padding = `${px(num(tcPr, 'marT', 45720)!)}px ${px(num(tcPr, 'marR', 91440)!)}px ${px(num(tcPr, 'marB', 45720)!)}px ${px(num(tcPr, 'marL', 91440)!)}px`
      const anchor = attr(tcPr, 'anchor')
      td.style.verticalAlign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top'
      for (const side of ['lnL', 'lnR', 'lnT', 'lnB'] as const) {
        const s = lineCss(env, kid(tcPr, side), null)
        const prop = { lnL: 'borderLeft', lnR: 'borderRight', lnT: 'borderTop', lnB: 'borderBottom' }[side]
        if (s) (td.style as unknown as Record<string, string>)[prop] = `${s.width}px solid ${s.color}`
      }
      const body = kid(tc, 'txBody')
      if (body) {
        const tb = paragraphs(env, l, body, [], null, color, styled && !!firstRow && ri === 0, 1)
        td.append(tb)
      }
      tr.append(td)
    }
    t.append(tr)
  })
  return t
}

// ---------------------------------------------------------------- text

function hasText(txBody: Element): boolean {
  return findAll(txBody, 't').some((t) => t.textContent) || findAll(txBody, 'fld').length > 0
}

/** Which master text style applies to a placeholder type. */
function masterStyleFor(env: SlideEnv, ph: Ph | null): Element | null {
  if (!ph) return kid(env.txStyles, 'otherStyle')
  if (ph.type === 'title' || ph.type === 'ctrTitle') return kid(env.txStyles, 'titleStyle')
  if (['body', 'subTitle', 'obj'].includes(ph.type)) return kid(env.txStyles, 'bodyStyle')
  return kid(env.txStyles, 'otherStyle')
}

function textBody(
  env: SlideEnv,
  l: Layer,
  txBody: Element,
  chain: Element[],
  ph: Ph | null,
  fontRefColor: string | null,
  rect: Rect
): HTMLElement {
  const bodies = [txBody, ...chain.map((s) => kid(s, 'txBody'))].map((b) => kid(b, 'bodyPr'))
  const bp = (name: string) => {
    for (const b of bodies) {
      const v = attr(b, name)
      if (v != null) return v
    }
    return null
  }
  const bpNum = (name: string, fb: number) => {
    const v = bp(name)
    return v == null ? fb : Number(v)
  }
  const wrapper = h('div', 'fp-txt')
  const anchor = bp('anchor') ?? 't'
  wrapper.style.justifyContent = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start'
  wrapper.style.padding = `${px(bpNum('tIns', 45720))}px ${px(bpNum('rIns', 91440))}px ${px(bpNum('bIns', 45720))}px ${px(bpNum('lIns', 91440))}px`
  if (bp('wrap') === 'none') wrapper.classList.add('nowrap')
  const vert = bp('vert')
  if (vert === 'vert' || vert === 'eaVert') wrapper.style.writingMode = 'vertical-rl'
  const autofit = bodies.map((b) => kid(b, 'normAutofit')).find(Boolean)
  const scale = autofit ? (num(autofit, 'fontScale', 100000) ?? 100000) / 100000 : 1
  const lstStyles = [kid(txBody, 'lstStyle'), ...chain.map((s) => path(s, 'txBody', 'lstStyle')), masterStyleFor(env, ph)]
  wrapper.append(paragraphs(env, l, txBody, lstStyles, fontRefColor, null, false, scale))
  void rect
  return wrapper
}

/** Paragraph-level property lookup across the style chain for one level. */
function levelChain(lstStyles: (Element | null)[], env: SlideEnv, level: number): Element[] {
  const name = `lvl${level + 1}pPr`
  const out: Element[] = []
  for (const s of lstStyles) {
    const e = kid(s, name)
    if (e) out.push(e)
  }
  const d = kid(env.deck.defaultTextStyle, name)
  if (d) out.push(d)
  return out
}

function paragraphs(
  env: SlideEnv,
  _l: Layer,
  txBody: Element,
  lstStyles: (Element | null)[],
  fontRefColor: string | null,
  forceColor: string | null,
  forceBold: boolean,
  fontScale: number
): HTMLElement {
  const frag = h('div', 'fp-paras')
  const counters: number[] = []
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr')
    const level = Math.min(8, num(pPr, 'lvl', 0) ?? 0)
    const lvls = levelChain(lstStyles, env, level)
    const pp = [pPr, ...lvls]
    const pAttr = (name: string) => {
      for (const e of pp) {
        const v = attr(e, name)
        if (v != null) return v
      }
      return null
    }
    const pKid = (name: string) => {
      for (const e of pp) {
        const k = kid(e, name)
        if (k) return k
      }
      return null
    }
    const defRPrs = pp.map((e) => kid(e, 'defRPr')).filter(Boolean) as Element[]
    const para = h('p')
    const algn = pAttr('algn')
    para.style.textAlign = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'dist' ? 'justify' : 'left'
    const marL = px(Number(pAttr('marL') ?? 0))
    const indent = px(Number(pAttr('indent') ?? 0))
    para.style.paddingLeft = `${marL}px`
    para.style.textIndent = `${indent}px`
    const spacing = (name: string) => {
      const k = pKid(name)
      const pts = num(kid(k, 'spcPts'), 'val')
      if (pts != null) return { px: (pts / 100) * PT_PX, pct: null as number | null }
      const pct = num(kid(k, 'spcPct'), 'val')
      return pct != null ? { px: null as number | null, pct: pct / 100000 } : null
    }

    // Runs.
    const runs = kids(p).filter((c) => c.localName === 'r' || c.localName === 'br' || c.localName === 'fld')
    const endSz = num(kid(p, 'endParaRPr'), 'sz')
    let firstSize: number | null = null
    const runProps = (rPr: Element | null) => {
      const list = [rPr, ...defRPrs]
      const ra = (name: string) => {
        for (const e of list) {
          const v = attr(e, name)
          if (v != null) return v
        }
        return null
      }
      const rk = (name: string) => {
        for (const e of list) {
          const k = kid(e, name)
          if (k) return k
        }
        return null
      }
      return { ra, rk }
    }
    for (const r of runs) {
      if (r.localName === 'br') {
        para.append(h('br'))
        continue
      }
      const rPr = kid(r, 'rPr')
      const { ra, rk } = runProps(rPr)
      const text = kid(r, 't')?.textContent ?? ''
      const span = h('span', undefined, text)
      const sz = Number(ra('sz') ?? 1800) / 100
      firstSize ??= sz
      span.style.fontSize = `${sz * PT_PX * fontScale}px`
      if (forceBold || ra('b') === '1' || ra('b') === 'true') span.style.fontWeight = '700'
      if (ra('i') === '1' || ra('i') === 'true') span.style.fontStyle = 'italic'
      const u = ra('u')
      const strike = ra('strike')
      const deco = [u && u !== 'none' ? 'underline' : '', strike && strike !== 'noStrike' ? 'line-through' : ''].filter(Boolean)
      if (deco.length) span.style.textDecoration = deco.join(' ')
      const baseline = Number(ra('baseline') ?? 0)
      if (baseline) {
        span.style.verticalAlign = baseline > 0 ? 'super' : 'sub'
        span.style.fontSize = `${sz * PT_PX * fontScale * 0.7}px`
      }
      const color =
        forceColor ?? (rPr && kid(rPr, 'solidFill') ? resolveColor(colorChild(kid(rPr, 'solidFill')), env.cc) : null) ?? fontRefColor ?? resolveColor(colorChild(rk('solidFill')), env.cc)
      span.style.color = color ?? resolveColor(schemeEl('tx1'), env.cc) ?? '#000'
      const hl = rk('highlight')
      if (hl) span.style.background = resolveColor(colorChild(hl), env.cc) ?? ''
      span.style.fontFamily = fontFamily(env, attr(rk('latin'), 'typeface'), attr(rk('ea'), 'typeface'))
      const spc = Number(ra('spc') ?? 0)
      if (spc) span.style.letterSpacing = `${(spc / 100) * PT_PX}px`
      if (ra('cap') === 'all') span.style.textTransform = 'uppercase'
      para.append(span)
    }
    const sizePt = firstSize ?? (endSz != null ? endSz / 100 : Number(runProps(null).ra('sz') ?? 1800) / 100)
    const sizePx = sizePt * PT_PX * fontScale
    if (!runs.some((r) => r.localName !== 'br')) {
      // Empty paragraph: keep its line height.
      para.style.fontSize = `${sizePx}px`
      para.append('​')
    }
    para.style.fontSize ||= `${sizePx}px`
    const ln = spacing('lnSpc')
    if (ln?.pct != null) para.style.lineHeight = String(1.2 * ln.pct)
    else if (ln?.px != null) para.style.lineHeight = `${ln.px}px`
    const before = spacing('spcBef')
    const after = spacing('spcAft')
    if (before) para.style.marginTop = `${before.px ?? (before.pct ?? 0) * sizePx}px`
    if (after) para.style.marginBottom = `${after.px ?? (after.pct ?? 0) * sizePx}px`

    // Bullets.
    const hasRunText = runs.some((r) => r.localName !== 'br' && (kid(r, 't')?.textContent ?? '') !== '')
    let bullet: string | null = null
    const bulletEl = pp.map((e) => kids(e).find((c) => ['buNone', 'buChar', 'buAutoNum', 'buBlip'].includes(c.localName))).find(Boolean)
    if (bulletEl && hasRunText) {
      if (bulletEl.localName === 'buChar') bullet = attr(bulletEl, 'char') ?? '•'
      else if (bulletEl.localName === 'buBlip') bullet = '•'
      else if (bulletEl.localName === 'buAutoNum') {
        counters[level] = (counters[level] ?? (num(bulletEl, 'startAt', 1)! - 1)) + 1
        bullet = autoNum(attr(bulletEl, 'type') ?? 'arabicPeriod', counters[level])
      }
    }
    if (!bulletEl || bulletEl.localName !== 'buAutoNum') counters.length = level
    if (bullet) {
      const b = h('span', 'fp-bu', bullet)
      const buFont = attr(pKid('buFont'), 'typeface')
      // Symbol fonts map private-use glyphs; show common ones as plain bullets.
      if (buFont && /wingdings|symbol/i.test(buFont)) b.textContent = mapSymbolBullet(bullet)
      const buClr = resolveColor(colorChild(pKid('buClr')), env.cc)
      const firstSpan = para.querySelector('span')
      b.style.color = buClr ?? firstSpan?.style.color ?? ''
      const pct = num(kid(pKid('buSzPct'), 'buSzPct') ?? pKid('buSzPct'), 'val')
      b.style.fontSize = `${sizePx * (pct ? pct / 100000 : 1)}px`
      b.style.minWidth = `${Math.max(0, -indent) || sizePx * 0.8}px`
      b.style.paddingRight = `${sizePx * 0.25}px`
      b.style.boxSizing = 'border-box'
      para.prepend(b)
    }
    frag.append(para)
  }
  return frag
}

function mapSymbolBullet(ch: string): string {
  const map: Record<string, string> = { '§': '▪', 'Ø': '➢', 'ü': '✓', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'o': '○', 'p': '◆', 'Ü': '➔' }
  return map[ch] ?? '•'
}

function autoNum(type: string, n: number): string {
  const alpha = (k: number) => {
    let s = ''
    while (k > 0) {
      k--
      s = String.fromCharCode(97 + (k % 26)) + s
      k = Math.floor(k / 26)
    }
    return s
  }
  const roman = (k: number) => {
    const t: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]
    let s = ''
    for (const [v, r] of t) while (k >= v) {
      s += r
      k -= v
    }
    return s
  }
  let core = String(n)
  if (type.startsWith('alphaLc')) core = alpha(n)
  else if (type.startsWith('alphaUc')) core = alpha(n).toUpperCase()
  else if (type.startsWith('romanLc')) core = roman(n)
  else if (type.startsWith('romanUc')) core = roman(n).toUpperCase()
  else if (type.startsWith('circleNum')) core = n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n)
  if (type.endsWith('ParenBoth')) return `(${core})`
  if (type.endsWith('ParenR')) return `${core})`
  if (type.endsWith('Plain') || type.startsWith('circleNum')) return core
  return `${core}.`
}

function fontFamily(env: SlideEnv, latin: string | null, ea: string | null): string {
  const resolve = (f: string | null) => {
    if (!f) return null
    if (f === '+mj-lt') return env.theme.majorLatin
    if (f === '+mn-lt') return env.theme.minorLatin
    if (f === '+mj-ea') return env.theme.majorEa
    if (f === '+mn-ea') return env.theme.minorEa
    return f.startsWith('+') ? null : f
  }
  const faces = [resolve(latin) ?? env.theme.minorLatin, resolve(ea) ?? env.theme.minorEa]
    .filter((f): f is string => !!f)
    .map((f) => `"${f.replace(/"/g, '')}"`)
  return withFallback(faces.join(', '))
}

/** Speaker notes text for a slide (the notes page body placeholder). */
export function notesText(pkg: OoxmlPackage, ref: SlideRef): string {
  const rel = pkg.relOfType(ref.part, 'notesSlide')
  const root = rel ? pkg.xml(rel.target)?.documentElement : null
  if (!root) return ''
  const out: string[] = []
  for (const sp of findAll(root, 'sp')) {
    const ph = placeholderOf(sp)
    if (!ph || ph.type !== 'body') continue
    for (const p of findAll(sp, 'p')) {
      out.push(
        kids(p)
          .map((c) => (c.localName === 'br' ? '\n' : c.localName === 'r' || c.localName === 'fld' ? (kid(c, 't')?.textContent ?? '') : ''))
          .join('')
      )
    }
  }
  return out.join('\n').trim()
}

/** All text on a slide (for unknown-shape fallbacks and accessibility). */
export function slideTitle(pkg: OoxmlPackage, ref: SlideRef): string {
  const root = pkg.xml(ref.part)?.documentElement
  for (const sp of findAll(root, 'sp')) {
    const ph = placeholderOf(sp)
    if (ph && (ph.type === 'title' || ph.type === 'ctrTitle')) return findAll(sp, 't').map((t) => t.textContent).join('').trim()
  }
  return ''
}
