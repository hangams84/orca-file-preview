/** PowerPoint (.pptx): a custom renderer (fflate unzip + DOMParser, see office/slides.ts). Slides
 *  stack vertically, each scaled to the viewport width; they are built lazily as they scroll into
 *  view. Toolbar: slide counter, previous/next, speaker notes toggle, zoom. */
import { PreviewError, type PreviewContext } from '../core/types.ts'
import { bindZoomGestures, clampZoom, createZoom, h } from '../core/ui.ts'
import { installOfficeFonts } from './office/fonts.ts'
import { OoxmlPackage } from './office/package.ts'
import { notesText, readDeck, renderSlide, slideTitle } from './office/slides.ts'

const STYLE = `
.fp-deck { padding: 12px 12px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.fp-slide-item { display: flex; flex-direction: column; align-items: stretch; max-width: none; }
.fp-slide-frame { position: relative; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.3); background: #fff; }
.fp-slide-frame.current { outline: 2px solid var(--orca-ring, #48f); outline-offset: 2px; }
.fp-slide { position: absolute !important; left: 0; top: 0; margin: 0 !important; transform-origin: 0 0; overflow: hidden;
  font-family: system-ui, -apple-system, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  box-shadow: none !important; }
.fp-shape { position: absolute; box-sizing: border-box; }
.fp-shape > .fp-geom { position: absolute; left: 0; top: 0; }
.fp-pic img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; user-select: none; }
.fp-missing, .fp-frame { display: flex; align-items: center; justify-content: center; border: 1px dashed #bbb;
  color: #888; font-size: 14px; background: rgba(127,127,127,.06); }
.fp-frame img { max-width: 100%; max-height: 100%; }
.fp-frame-label { font-size: 28px; opacity: .6; }
.fp-txt { position: absolute; inset: 0; display: flex; flex-direction: column; box-sizing: border-box; overflow: visible;
  line-height: 1.2; overflow-wrap: break-word; }
.fp-txt.nowrap { white-space: nowrap; }
.fp-txt.nowrap .fp-paras p { white-space: pre; }
.fp-paras p { margin: 0; white-space: pre-wrap; }
.fp-bu { display: inline-block; text-indent: 0; }
.fp-tbl { border-collapse: collapse; table-layout: fixed; width: 100%; color: #000; }
.fp-tbl td { border: 1px solid #fff; overflow: hidden; }
.fp-slide-meta { display: flex; gap: 8px; align-items: baseline; padding: 4px 2px 0; font-size: 12px;
  color: var(--orca-muted-foreground, #888); }
.fp-slide-meta .hidden-tag { border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; font-size: 11px; }
.fp-notes { margin-top: 6px; padding: 8px 10px; border-radius: var(--orca-radius, 6px); white-space: pre-wrap;
  background: var(--orca-card, #f6f6f6); color: var(--orca-card-foreground, inherit); border: 1px solid var(--orca-border, #ddd);
  font-size: 13px; line-height: 1.5; box-sizing: border-box; }
.fp-notes.empty { color: var(--orca-muted-foreground, #888); font-style: italic; }
.fp-deck:not(.show-notes) .fp-notes { display: none; }
`

export async function render(ctx: PreviewContext): Promise<() => void> {
  const { bytes, root, toolbar, tr, signal } = ctx
  let pkg: OoxmlPackage
  try {
    pkg = OoxmlPackage.open(bytes, signal)
  } catch (err) {
    console.error(err)
    throw new PreviewError('pptx', tr('올바른 PowerPoint(.pptx) 파일이 아닙니다. 파일이 손상되었을 수 있습니다.', 'This is not a valid PowerPoint (.pptx) file. It may be damaged.'))
  }
  const parsed = readDeck(pkg)
  if (!parsed) throw new PreviewError('pptx', tr('프레젠테이션 정보를 찾을 수 없습니다.', 'No presentation found in this file.'))
  const deck = parsed
  if (!deck.slides.length) throw new PreviewError('pptx', tr('슬라이드가 없습니다.', 'This presentation has no slides.'))

  installOfficeFonts()
  const style = h('style', undefined, STYLE)
  const list = h('div', 'fp-deck')
  list.setAttribute('role', 'list')

  let scale = fitScale()
  function fitScale(): number {
    const avail = Math.max(120, root.clientWidth - 24)
    return clampZoom(avail / deck.width, 0.05, ctx.compact ? 4 : 1.5)
  }

  interface Item {
    el: HTMLElement
    frame: HTMLElement
    built: boolean
    notes: HTMLElement
  }
  const items: Item[] = deck.slides.map((ref) => {
    const el = h('div', 'fp-slide-item')
    el.setAttribute('role', 'listitem')
    const frame = h('div', 'fp-slide-frame')
    frame.dataset.index = String(ref.index)
    const meta = h('div', 'fp-slide-meta')
    meta.append(h('span', undefined, `${ref.index + 1}`))
    if (ref.hidden) meta.append(h('span', 'hidden-tag', tr('숨김', 'hidden')))
    const title = slideTitle(pkg, ref)
    if (title) {
      frame.setAttribute('aria-label', title)
      meta.append(h('span', undefined, title))
    }
    const text = notesText(pkg, ref)
    const notes = h('div', text ? 'fp-notes' : 'fp-notes empty', text || tr('발표자 노트 없음', 'No speaker notes'))
    el.append(frame, meta, notes)
    return { el, frame, built: false, notes }
  })

  const sizeItem = (it: Item) => {
    const w = Math.round(deck.width * scale)
    it.el.style.width = `${w}px`
    it.frame.style.width = `${w}px`
    it.frame.style.height = `${Math.round(deck.height * scale)}px`
    const slide = it.frame.firstElementChild as HTMLElement | null
    if (slide) slide.style.transform = `scale(${scale})`
  }
  const build = (i: number) => {
    const it = items[i]
    if (it.built) return
    it.built = true
    try {
      const slide = renderSlide(pkg, deck, deck.slides[i])
      slide.style.transform = `scale(${scale})`
      it.frame.replaceChildren(slide)
    } catch (err) {
      console.error(err)
      it.frame.replaceChildren(h('div', 'fp-missing', tr('이 슬라이드를 표시할 수 없습니다', 'Cannot show this slide')))
      ;(it.frame.firstElementChild as HTMLElement).style.cssText = 'position:absolute;inset:0'
    }
  }
  for (const it of items) {
    sizeItem(it)
    list.append(it.el)
  }
  root.replaceChildren(style, list)

  // Build slides near the viewport; the first one right away so there is something to see.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) build(Number((e.target as HTMLElement).dataset.index))
    },
    { root, rootMargin: '600px 0px' }
  )
  for (const it of items) io.observe(it.frame)
  build(0)

  // Slide counter and navigation.
  let current = 0
  const info = () => toolbar.info(`${current + 1} / ${items.length}`)
  const prev = toolbar.button({ label: '‹', title: tr('이전 슬라이드', 'Previous slide'), onClick: () => go(current - 1) })
  const next = toolbar.button({ label: '›', title: tr('다음 슬라이드', 'Next slide'), onClick: () => go(current + 1) })
  let showNotes = false
  const notesBtn = toolbar.button({
    label: tr('노트', 'Notes'),
    title: tr('발표자 노트 표시', 'Show speaker notes'),
    onClick: () => {
      showNotes = !showNotes
      list.classList.toggle('show-notes', showNotes)
      notesBtn.setAttribute('aria-pressed', String(showNotes))
    }
  })
  notesBtn.setAttribute('aria-pressed', 'false')
  const syncNav = () => {
    prev.disabled = current <= 0
    next.disabled = current >= items.length - 1
    items.forEach((it, i) => it.frame.classList.toggle('current', i === current && items.length > 1))
    info()
  }
  const go = (i: number) => {
    const target = Math.max(0, Math.min(items.length - 1, i))
    current = target
    build(target)
    root.scrollTo({ top: items[target].el.offsetTop - 12, behavior: 'auto' })
    syncNav()
  }
  let raf = 0
  const onScroll = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const mid = root.scrollTop + root.clientHeight * 0.35
      let best = 0
      for (let i = 0; i < items.length; i++) {
        if (items[i].el.offsetTop <= mid) best = i
        else break
      }
      // At the very bottom the last slides cannot reach the reading line; count the last as current.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2 && root.scrollTop > 0) best = items.length - 1
      if (best !== current) {
        current = best
        syncNav()
      }
    })
  }
  root.addEventListener('scroll', onScroll, { passive: true, signal })
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.tagName === 'SELECT') return
      if (e.key === 'PageDown' || e.key === 'ArrowRight') go(current + 1)
      else if (e.key === 'PageUp' || e.key === 'ArrowLeft') go(current - 1)
      else if (e.key === 'Home') go(0)
      else if (e.key === 'End') go(items.length - 1)
      else return
      e.preventDefault()
    },
    { signal }
  )
  syncNav()

  // Zoom: starts fitted to the width and keeps fitting on resize until the person zooms.
  let fitting = true
  const zoom = createZoom(
    scale,
    (s) => {
      const anchor = items[current]?.el
      const offset = anchor ? root.scrollTop - anchor.offsetTop : 0
      const ratio = s / scale
      scale = s
      fitting = Math.abs(s - fitScale()) < 0.002
      for (const it of items) sizeItem(it)
      if (anchor) root.scrollTop = anchor.offsetTop + offset * ratio
    },
    fitScale,
    { min: 0.05, max: 4 }
  )
  toolbar.zoom(zoom)
  bindZoomGestures(root, zoom, signal)
  const ro = new ResizeObserver(() => {
    if (fitting) zoom.set(fitScale())
  })
  ro.observe(root)

  return () => {
    io.disconnect()
    ro.disconnect()
    cancelAnimationFrame(raf)
  }
}
