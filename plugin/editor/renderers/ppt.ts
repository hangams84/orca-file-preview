/** PowerPoint 97-2003 (.ppt): read with legacy/pptbin.ts (no library) and drawn as one card per
 *  slide with shapes at their positions, scaled to the viewport width. Cards are built lazily as
 *  they scroll into view. A ".ppt" that is really a .pptx is handed to the PPTX renderer. */
import { formatBytes } from '../core/i18n.ts'
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, clampZoom, createZoom, h, objectUrl } from '../core/ui.ts'
import { delegate } from './legacy/delegate.ts'
import { isCfb, readCfb, type Cfb } from './legacy/cfb.ts'
import { listZip, readZipText, isZip } from './legacy/zip.ts'
import { PptError, readPpt, type PptDoc, type PptShape, type PptSlide } from './legacy/pptbin.ts'

/** Master units (576 per inch) to CSS px (96 per inch). */
const MU = 96 / 576
/** Points to CSS px. */
const PT = 96 / 72

/** Latin UI fonts, then Korean fonts with similar metrics, then generic. */
export const KOREAN_STACK = '"Segoe UI", "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", NanumGothic, "나눔고딕", system-ui, sans-serif'

const STYLE = `
.fp-ppt { padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 16px; box-sizing: border-box; }
.fp-ppt.compact { padding: 8px; gap: 10px; }
.fp-ppt .item { flex: none; display: flex; flex-direction: column; align-items: flex-start; }
.fp-ppt .card { position: relative; flex: none; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.fp-ppt .slide { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; background: #fff; color: #000;
  font-family: "Calibri", ${KOREAN_STACK}; }
.fp-ppt .num { margin-top: 4px; font-size: 11px; line-height: 16px; color: var(--orca-muted-foreground, #888);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.fp-ppt .note { padding: 6px 10px; border-radius: var(--orca-radius, 6px); box-sizing: border-box; max-width: 100%;
  background: var(--orca-muted, #f4f4f5); color: var(--orca-muted-foreground, #555); font-size: 12px; }
.fp-ppt .sh { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; overflow: visible; }
.fp-ppt .sh.middle { justify-content: center; } .fp-ppt .sh.bottom { justify-content: flex-end; }
.fp-ppt .sh p { margin: 0; line-height: 1.2; white-space: pre-wrap; overflow-wrap: anywhere; }
.fp-ppt .sh p.bl { position: relative; }
.fp-ppt .sh p.bl::before { content: attr(data-b); position: absolute; left: -.9em; }
.fp-ppt .sh img { width: 100%; height: 100%; object-fit: fill; display: block; }
.fp-ppt .ph { width: 100%; height: 100%; border: 2px dashed #bbb; box-sizing: border-box; display: flex; align-items: center; justify-content: center; color: #888; font-size: 28px; }
.fp-ppt .notes { margin-top: 4px; padding: 6px 10px; box-sizing: border-box; font-size: 12px; white-space: pre-wrap; border-radius: var(--orca-radius, 6px);
  background: var(--orca-muted, #f4f4f5); color: var(--orca-muted-foreground, #555); }
`

export async function render(ctx: PreviewContext): Promise<void | (() => void)> {
  const { bytes, tr } = ctx
  if (isZip(bytes)) {
    return delegate(
      ctx,
      () => import('./pptx.ts'),
      () => pptxTextFallback(ctx),
      tr('이 .ppt 파일은 실제로 PPTX(PowerPoint 2007+) 형식입니다.', 'This .ppt file is actually a PPTX (PowerPoint 2007+) presentation.')
    )
  }
  if (!isCfb(bytes)) throw new PreviewError('format', tr('PowerPoint 프레젠테이션 형식이 아닙니다.', 'This is not a PowerPoint presentation.'))
  let cfb: Cfb
  try {
    cfb = readCfb(bytes)
  } catch {
    throw new PreviewError('cfb', tr('OLE 복합 문서 구조가 손상되었습니다.', 'The OLE compound file structure is damaged.'))
  }
  const names = cfb.rootNames().map((n) => n.toLowerCase())
  if (names.includes('encryptedpackage') || names.includes('encryptioninfo')) throw encrypted(ctx)
  if (!names.includes('powerpoint document')) {
    if (names.includes('worddocument'))
      throw new PreviewError('notppt', tr('PowerPoint가 아니라 Word 문서입니다. 확장자를 .doc로 바꿔 열어 보세요.', 'This is a Word document, not a presentation. Rename it to .doc to preview it.'))
    if (names.includes('workbook') || names.includes('book'))
      throw new PreviewError('notppt', tr('PowerPoint가 아니라 Excel 통합 문서입니다. 확장자를 .xls로 바꿔 열어 보세요.', 'This is an Excel workbook, not a presentation. Rename it to .xls to preview it.'))
    throw new PreviewError('notppt', tr('PowerPoint 프레젠테이션이 아닌 OLE 복합 파일입니다.', 'This is an OLE compound file but not a PowerPoint presentation.'))
  }
  let doc: PptDoc
  try {
    doc = readPpt(cfb)
  } catch (e) {
    if (e instanceof PptError && e.code === 'encrypted') throw encrypted(ctx)
    console.error(e)
    throw new PreviewError('ppt', tr('프레젠테이션 구조를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.', 'Could not read the presentation structure; the file may be damaged.'))
  }
  if (!doc.slides.length) throw new PreviewError('empty', tr('슬라이드가 없습니다.', 'This presentation has no slides.'))
  return drawDeck(ctx, doc)
}

function encrypted(ctx: PreviewContext): PreviewError {
  return new PreviewError('encrypted', ctx.tr('암호로 보호된 프레젠테이션입니다. 미리보기를 지원하지 않습니다.', 'This presentation is password-protected and cannot be previewed.'))
}

function drawDeck(ctx: PreviewContext, doc: PptDoc, note?: string): () => void {
  const { root, toolbar, tr, signal } = ctx
  const natW = Math.max(100, doc.width * MU)
  const natH = Math.max(60, doc.height * MU)
  const wrap = h('div', 'fp-ppt' + (ctx.compact ? ' compact' : ''))
  if (note) wrap.append(h('div', 'note', note))
  const urls = new Map<number, string>()
  const picUrl = (id: number): string | null => {
    const p = doc.pictures[id - 1]
    if (!p) return null
    let u = urls.get(id)
    if (!u) {
      u = objectUrl(p.bytes, p.mime, signal)
      urls.set(id, u)
    }
    return u
  }

  let scale = 1
  const cards: { item: HTMLElement; card: HTMLElement; slide: PptSlide; built: HTMLElement | null; notes: HTMLElement | null }[] = []
  doc.slides.forEach((slide, i) => {
    const item = h('div', 'item')
    const card = h('div', 'card')
    card.dataset.index = String(i)
    card.setAttribute('role', 'img')
    const title = slideTitle(slide)
    card.setAttribute('aria-label', `${tr('슬라이드', 'Slide')} ${i + 1}${title ? ` · ${title}` : ''}`)
    const caption = h('div', 'num', title ? `${i + 1} · ${title}` : String(i + 1))
    item.append(card, caption)
    const entry = { item, card, slide, built: null as HTMLElement | null, notes: null as HTMLElement | null }
    cards.push(entry)
    wrap.append(item)
    if (slide.notes) {
      const n = h('div', 'notes', `${tr('메모', 'Notes')}: ${slide.notes}`)
      entry.notes = n
      item.append(n)
    }
  })
  const layout = () => {
    for (const c of cards) {
      c.card.style.width = `${natW * scale}px`
      c.card.style.height = `${natH * scale}px`
      if (c.built) c.built.style.transform = `scale(${scale})`
      c.item.style.width = `${natW * scale}px`
    }
    refresh()
  }
  const build = (c: (typeof cards)[number]) => {
    if (c.built) return
    const el = slideEl(c.slide, natW, natH, picUrl, tr)
    el.style.transform = `scale(${scale})`
    c.card.append(el)
    c.built = el
  }

  // Build slides in or near the view and track the current one from scroll geometry. This works
  // without IntersectionObserver or requestAnimationFrame, which stop while the window is hidden
  // or occluded; the observer only adds an extra trigger.
  let current = 0
  const counter = () => toolbar.info(`${current + 1} / ${cards.length} · ${formatBytes(ctx.bytes.byteLength)}`)
  function refresh(): void {
    if (!cards.length) return
    const vh = Math.max(root.clientHeight, 1)
    const top = root.scrollTop - vh
    const bottom = root.scrollTop + vh * 2
    const viewTop = root.scrollTop
    const viewBottom = viewTop + vh
    let best = 0
    let bestArea = -1
    for (let i = 0; i < cards.length; i++) {
      const it = cards[i].item
      const y = it.offsetTop
      if (y > bottom) break
      const area = Math.min(y + it.offsetHeight, viewBottom) - Math.max(y, viewTop)
      if (area > bestArea + 1) [best, bestArea] = [i, area]
      if (y + it.offsetHeight >= top) build(cards[i])
    }
    build(cards[best])
    if (best !== current) {
      current = best
      counter()
      sync()
    }
  }
  const io = new IntersectionObserver(() => refresh(), { root, rootMargin: '100% 0px' })
  for (const c of cards) io.observe(c.card)
  root.addEventListener('scroll', refresh, { passive: true, signal })

  const go = (i: number) => {
    const target = Math.max(0, Math.min(cards.length - 1, i))
    build(cards[target])
    root.scrollTo({ top: cards[target].item.offsetTop - (ctx.compact ? 8 : 12) })
    refresh()
    current = target
    counter()
    sync()
  }
  const prev = toolbar.button({ label: '‹', title: tr('이전 슬라이드', 'Previous slide'), onClick: () => go(current - 1) })
  const next = toolbar.button({ label: '›', title: tr('다음 슬라이드', 'Next slide'), onClick: () => go(current + 1) })
  const sync = () => {
    prev.disabled = current <= 0
    next.disabled = current >= cards.length - 1
  }
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'PageDown' || e.key === 'ArrowRight') go(current + 1)
      else if (e.key === 'PageUp' || e.key === 'ArrowLeft') go(current - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(cards.length - 1)
      else return
      e.preventDefault()
    },
    { signal }
  )

  let fitted = true
  // Phones fit the width; larger screens fit the whole slide unless that makes it much narrower.
  const fitScale = () => {
    const wFit = (root.clientWidth - (ctx.compact ? 16 : 24)) / natW
    const hFit = (root.clientHeight - 24) / natH
    return clampZoom(ctx.compact || hFit < wFit * 0.5 ? wFit : Math.min(wFit, hFit), 0.05, ctx.compact ? 4 : 2)
  }
  const zoom = createZoom(
    1,
    (s) => {
      scale = s
      layout()
    },
    () => {
      fitted = true
      return fitScale()
    },
    { min: 0.05, max: 6 }
  )
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)
  zoom.onChange(() => {
    if (Math.abs(zoom.get() - fitScale()) > 0.001) fitted = false
  })
  root.replaceChildren(h('style', undefined, STYLE), wrap)
  scale = fitScale()
  zoom.set(scale)
  layout()
  counter()
  sync()
  refresh()
  const onResize = () => {
    if (fitted) zoom.set(fitScale())
    refresh()
  }
  const ro = new ResizeObserver(onResize)
  ro.observe(root)
  window.addEventListener('resize', onResize, { signal })
  // Layout may settle after the first paint (fonts, toolbar wrap): re-check on timers too.
  const timers = [setTimeout(onResize, 50), setTimeout(onResize, 400)]
  return () => {
    io.disconnect()
    ro.disconnect()
    for (const t of timers) clearTimeout(t)
  }
}

function slideTitle(slide: PptSlide): string {
  const t = slide.shapes.find((s) => (s.textType === 0 || s.textType === 6) && s.paras?.length)
  const text = t?.paras?.map((p) => p.runs.map((r) => r.text).join('')).join(' ').replace(/\s+/g, ' ').trim() ?? ''
  return text.length > 60 ? text.slice(0, 59) + '…' : text
}

function slideEl(
  slide: PptSlide,
  natW: number,
  natH: number,
  picUrl: (id: number) => string | null,
  tr: (ko: string, en: string) => string
): HTMLElement {
  const el = h('div', 'slide')
  el.style.width = `${natW}px`
  el.style.height = `${natH}px`
  if (slide.background && slide.background !== '#000000') el.style.background = slide.background
  for (const s of slide.shapes) el.append(shapeEl(s, natW, natH, picUrl, tr))
  return el
}

function shapeEl(s: PptShape, natW: number, natH: number, picUrl: (id: number) => string | null, tr: (ko: string, en: string) => string): HTMLElement {
  const el = h('div', 'sh')
  let { x, y, w, h: hh } = s
  if (s.noAnchor) {
    // Placeholder that inherits its position from the master: put it where masters usually do.
    const title = s.textType === 0 || s.textType === 6
    const W = natW / MU
    const H = natH / MU
    ;[x, y, w, hh] = title ? [W * 0.05, H * 0.04, W * 0.9, H * 0.17] : [W * 0.05, H * 0.24, W * 0.9, H * 0.7]
  }
  const st = el.style
  st.left = `${x * MU}px`
  st.top = `${y * MU}px`
  st.width = `${Math.max(1, w * MU)}px`
  st.height = `${Math.max(1, hh * MU)}px`
  if (s.fill) st.background = s.fill
  if (s.line) {
    if (w === 0 || hh === 0) {
      st.background = s.line
      if (w === 0) st.width = '1px'
      if (hh === 0) st.height = '1px'
    } else st.border = `1px solid ${s.line}`
  }
  if (s.picture) {
    const u = picUrl(s.picture)
    if (u) {
      const img = h('img')
      img.src = u
      img.alt = ''
      img.decoding = 'async'
      el.append(img)
    } else el.append(h('div', 'ph', tr('그림', 'Picture')))
  }
  if (s.paras) {
    if (s.valign === 'middle') el.classList.add('middle')
    else if (s.valign === 'bottom') el.classList.add('bottom')
    st.padding = `${0.1 * 96}px ${0.1 * 96}px`
    const title = s.textType === 0 || s.textType === 6
    const def = title ? 40 : s.textType === 1 || s.textType === 5 || s.textType === 7 ? 24 : s.textType === 8 ? 18 : 18
    for (const p of s.paras) {
      const pe = h('p')
      const lead = p.bullet ? 1 : 0
      const indent = p.level * 0.5 * 96 + (lead ? 0.35 * 96 : 0)
      if (indent) pe.style.marginLeft = `${indent}px`
      if (p.bullet) {
        pe.classList.add('bl')
        pe.dataset.b = p.bullet
      }
      if (p.align && p.align !== 'left') pe.style.textAlign = p.align
      const sizes = p.runs.map((r) => r.size ?? def)
      const base = Math.max(...sizes, 1)
      pe.style.fontSize = `${base * PT}px`
      // PowerPoint's single spacing is about 1.2 font heights; mixed Latin/Hangul needs that room.
      pe.style.lineHeight = String(Math.max(0.8, Math.min(3, 1.2 * (p.lineSpacing ?? 1))))
      if (p.spaceBefore) pe.style.marginTop = `${Math.min(2, p.spaceBefore) * 1.2}em`
      if (title && p.runs.every((r) => r.b == null)) pe.style.fontWeight = '600'
      const font = p.runs.find((r) => r.font)?.font
      if (font) pe.style.fontFamily = fontStack(font)
      for (const r of p.runs) {
        const span = h('span', undefined, r.text)
        const rs = span.style
        if (r.size && r.size !== base) rs.fontSize = `${r.size * PT}px`
        if (r.font && r.font !== font) rs.fontFamily = fontStack(r.font)
        if (r.b) rs.fontWeight = '700'
        if (r.i) rs.fontStyle = 'italic'
        if (r.u) rs.textDecoration = 'underline'
        if (r.color) rs.color = r.color
        pe.append(span)
      }
      if (!p.runs.length) pe.append(document.createTextNode('​'))
      el.append(pe)
    }
  }
  return el
}

/** The slide's own font first, then fonts with matching Hangul so mixed text stays even. */
export function fontStack(font: string): string {
  const name = font.replace(/["\\]/g, '')
  return `"${name}", ${KOREAN_STACK}`
}

/** A .ppt that is really .pptx, when the PPTX renderer cannot run: slide texts from the XML. */
async function pptxTextFallback(ctx: PreviewContext): Promise<() => void> {
  const entries = listZip(ctx.bytes)
  const slideNames = entries
    .map((e) => e.name)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  if (!slideNames.length) throw new Error('no slides')
  const slides: PptSlide[] = []
  for (const name of slideNames) {
    const xml = (await readZipText(ctx.bytes, entries, name)) ?? ''
    const d = new DOMParser().parseFromString(xml, 'application/xml')
    const shapes: PptShape[] = []
    const H = 4320
    let first = true
    for (const sp of d.getElementsByTagNameNS('*', 'sp')) {
      const paras = [...sp.getElementsByTagNameNS('*', 'p')].map((p) => ({
        runs: [{ text: [...p.getElementsByTagNameNS('*', 't')].map((t) => t.textContent ?? '').join('') }],
        level: 0
      }))
      if (!paras.some((p) => p.runs[0].text)) continue
      shapes.push({ x: 288, y: 0, w: 5184, h: 0, textType: first ? 0 : 1, paras })
      first = false
    }
    // Stack the boxes: title band on top, the rest share the remaining height.
    const body = shapes.length - 1
    shapes.forEach((s, k) => {
      if (k === 0) [s.y, s.h] = [170, 720]
      else [s.y, s.h] = [1000 + ((k - 1) * (H - 1200)) / body, (H - 1200) / body]
    })
    slides.push({ shapes, notes: '' })
  }
  const note = ctx.tr('이 .ppt 파일은 실제로 PPTX(PowerPoint 2007+) 형식입니다. 텍스트만 표시합니다.', 'This .ppt file is actually a PPTX (PowerPoint 2007+) presentation. Showing text only.')
  return drawDeck(ctx, { width: 5760, height: 4320, slides, pictures: [] }, note)
}
