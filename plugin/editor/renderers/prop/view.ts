/** Shared page layout for the proprietary-format viewers (SolidWorks, EPLAN, the generic inspector):
 *  a tab strip, notes that say what is (and is not) shown, property tables, a contents tree, image
 *  thumbnails, and an overlay that opens an embedded file (PDF, image, 3D mesh) with this plugin's
 *  own renderers. */
import { formatBytes } from '../../core/i18n.ts'
import type { PreviewContext, Toolbar, ToolbarButton, ZoomController } from '../../core/types.ts'
import { h, objectUrl, showMessage } from '../../core/ui.ts'
import { adoptStyle } from '../media/styles.ts'

const CSS = `
.fp-prop { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.fp-prop-tabs { flex: none; display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid var(--orca-border, #ddd); }
.fp-prop-tabs button { font: inherit; color: var(--orca-muted-foreground, #666); background: none; border: 0; border-bottom: 2px solid transparent;
  padding: 5px 10px 6px; cursor: pointer; border-radius: 0; min-height: 30px; }
.fp-prop-tabs button[aria-selected="true"] { color: var(--orca-foreground, #111); border-bottom-color: var(--orca-primary, #333); font-weight: 600; }
.fp-prop-tabs button:focus-visible { outline: 2px solid var(--orca-ring, #48f); outline-offset: -2px; }
.fp-prop-body { flex: 1 1 auto; min-height: 0; overflow: auto; position: relative; }
.fp-prop-panel { padding: 12px 16px 24px; box-sizing: border-box; max-width: 1100px; }
.fp-prop-panel h3 { font-size: 13px; margin: 18px 0 6px; color: var(--orca-foreground, #111); }
.fp-prop-panel h3:first-child { margin-top: 4px; }
.fp-prop-note { margin: 0 0 10px; padding: 8px 10px; border-radius: var(--orca-radius, 6px); font-size: 12px; line-height: 1.45;
  background: var(--orca-muted, #f4f4f5); color: var(--orca-foreground, #111); border-left: 3px solid var(--orca-primary, #555); }
.fp-prop-note.warn { border-left-color: #d97706; }
.fp-prop-kv { border-collapse: collapse; width: 100%; font-size: 12.5px; table-layout: fixed; }
.fp-prop-kv th, .fp-prop-kv td { text-align: left; vertical-align: top; padding: 4px 8px; border-bottom: 1px solid var(--orca-border, #e5e5e5); overflow-wrap: anywhere; }
.fp-prop-kv th { width: 34%; font-weight: 500; color: var(--orca-muted-foreground, #666); }
.fp-prop-kv td.num { font-variant-numeric: tabular-nums; }
.fp-prop-list { margin: 0; padding: 0; list-style: none; font-size: 12.5px; }
.fp-prop-list li { padding: 4px 8px; border-bottom: 1px solid var(--orca-border, #e5e5e5); overflow-wrap: anywhere; }
.fp-prop-list li small { color: var(--orca-muted-foreground, #666); margin-left: 6px; }
.fp-prop-tree { font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.fp-prop-tree details { margin-left: 14px; }
.fp-prop-tree > details { margin-left: 0; }
.fp-prop-tree summary { cursor: pointer; padding: 2px 0; }
.fp-prop-tree .leaf { display: flex; gap: 8px; margin-left: 28px; padding: 2px 0; align-items: baseline; }
.fp-prop-tree .leaf .name { flex: 1 1 auto; overflow-wrap: anywhere; }
.fp-prop-tree .leaf .size { flex: none; color: var(--orca-muted-foreground, #666); font-variant-numeric: tabular-nums; }
.fp-prop-btn { font: inherit; font-size: 12px; color: var(--orca-secondary-foreground, inherit); background: var(--orca-secondary, #eee);
  border: 1px solid var(--orca-input, var(--orca-border, #ccc)); border-radius: var(--orca-radius, 6px); padding: 1px 8px; min-height: 24px; cursor: pointer; }
.fp-prop-btn:hover { background: var(--orca-accent, #e4e4e4); }
.fp-prop-gallery { display: flex; flex-wrap: wrap; gap: 12px; }
.fp-prop-thumb { margin: 0; display: flex; flex-direction: column; gap: 4px; max-width: min(100%, 420px); }
.fp-prop-thumb button { padding: 0; border: 1px solid var(--orca-border, #ddd); border-radius: var(--orca-radius, 6px); background: #fff; cursor: zoom-in; line-height: 0; overflow: hidden; }
.fp-prop-thumb img { max-width: 100%; max-height: 320px; display: block; }
.fp-prop-thumb figcaption { font-size: 11.5px; color: var(--orca-muted-foreground, #666); overflow-wrap: anywhere; }
.fp-prop-split { display: grid; grid-template-columns: minmax(200px, 320px) 1fr; gap: 16px; align-items: start; }
.fp-prop-split > .side { position: sticky; top: 0; max-height: calc(100vh - 120px); overflow: auto; border: 1px solid var(--orca-border, #ddd); border-radius: var(--orca-radius, 6px); }
.fp-prop-pick { display: block; width: 100%; text-align: left; font: inherit; font-size: 12.5px; padding: 5px 8px; border: 0; border-bottom: 1px solid var(--orca-border, #eee);
  background: none; color: inherit; cursor: pointer; overflow-wrap: anywhere; }
.fp-prop-pick small { display: block; color: var(--orca-muted-foreground, #666); }
.fp-prop-pick[aria-current="true"] { background: var(--orca-accent, #e8e8e8); }
.fp-prop-search { width: 100%; box-sizing: border-box; font: inherit; padding: 5px 8px; border: 0; border-bottom: 1px solid var(--orca-border, #ddd);
  background: var(--orca-background, #fff); color: inherit; position: sticky; top: 0; }
.fp-prop-hex { font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre; overflow: auto; margin: 0; padding: 8px;
  background: var(--orca-muted, #f4f4f5); border-radius: var(--orca-radius, 6px); }
.fp-prop-embed { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--orca-background, #fff); z-index: 2; }
.fp-prop-embed-bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 8px; border-bottom: 1px solid var(--orca-border, #ddd); }
.fp-prop-embed-bar .info { color: var(--orca-muted-foreground, #666); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%; }
.fp-prop-embed-bar .spacer { flex: 1 1 auto; }
.fp-prop-embed-bar select { font: inherit; font-size: 12px; min-height: 26px; }
.fp-prop-embed-host { flex: 1 1 auto; min-height: 0; position: relative; overflow: auto; }
@media (max-width: 600px) {
  .fp-prop-panel { padding: 10px 12px 20px; }
  .fp-prop-split { grid-template-columns: 1fr; }
  .fp-prop-split > .side { position: static; max-height: 40vh; }
  .fp-prop-kv th { width: 42%; }
  .fp-prop-embed-bar .info { max-width: 100%; order: 10; flex: 1 0 100%; }
}
`

export interface Tab {
  id: string
  label: string
  /** Builds the panel the first time the tab is shown; may return a cleanup. */
  build(panel: HTMLElement, page: PropPage): void | Promise<void>
}

export interface PropPage {
  ctx: PreviewContext
  body: HTMLElement
  select(id: string): void
  /** Opens an embedded file over the page; returns when the renderer has drawn. */
  open(spec: EmbedSpec): Promise<void>
}

export interface EmbedSpec {
  title: string
  bytes: Uint8Array
  /** Suffix of the renderer to use (pdf, png, jpg, gif, bmp, svg, edz, ...). */
  ext: string
  /** A renderer function to call instead of looking one up by `ext`. */
  render?: (sub: PreviewContext) => Promise<void | (() => void)>
}

const LOADERS: Record<string, () => Promise<{ render: (c: PreviewContext) => Promise<void | (() => void)> }>> = {
  pdf: () => import('../pdf.ts'),
  png: () => import('../image.ts'),
  jpg: () => import('../image.ts'),
  jpeg: () => import('../image.ts'),
  gif: () => import('../image.ts'),
  bmp: () => import('../image.ts'),
  svg: () => import('../svg.ts'),
  txt: () => import('../text.ts'),
  xml: () => import('../text.ts'),
  edz: () => import('../eplan.ts'),
  ema: () => import('../eplan.ts'),
  emp: () => import('../eplan.ts')
}

/** Adopts the page stylesheet (for `embed` used outside `createPage`). */
export function adoptPropStyles(): void {
  adoptStyle('prop', CSS)
}

export function canEmbed(ext: string): boolean {
  return ext.toLowerCase() in LOADERS
}

/** Builds the tabbed page in ctx.root. The first tab is shown at once. */
export function createPage(ctx: PreviewContext, tabs: Tab[], initial?: string): PropPage {
  adoptStyle('prop', CSS)
  const { root, tr } = ctx
  root.replaceChildren()
  root.style.overflow = 'hidden'
  const wrap = h('div', 'fp-prop')
  wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0'
  const strip = h('div', 'fp-prop-tabs')
  strip.setAttribute('role', 'tablist')
  const body = h('div', 'fp-prop-body')
  body.style.cssText = 'flex:1 1 auto;min-height:0;overflow:auto;position:relative'
  wrap.append(strip, body)
  root.append(wrap)
  const panels = new Map<string, HTMLElement>()
  const buttons = new Map<string, HTMLButtonElement>()
  let embedClose: (() => void) | null = null
  const page: PropPage = {
    ctx,
    body,
    select(id) {
      embedClose?.()
      const tab = tabs.find((t) => t.id === id) ?? tabs[0]
      for (const [k, b] of buttons) b.setAttribute('aria-selected', String(k === tab.id))
      for (const [k, p] of panels) p.hidden = k !== tab.id
      if (!panels.has(tab.id)) {
        const panel = h('div', 'fp-prop-panel')
        panel.setAttribute('role', 'tabpanel')
        panels.set(tab.id, panel)
        body.append(panel)
        Promise.resolve(tab.build(panel, page)).catch((err) => {
          if (ctx.signal.aborted) return
          console.warn('prop tab failed', err)
          panel.replaceChildren(note(tr(`이 부분을 읽지 못했습니다: ${(err as Error).message}`, `This part could not be read: ${(err as Error).message}`), 'warn'))
        })
      }
      body.scrollTop = 0
    },
    async open(spec) {
      embedClose?.()
      const layer = h('div', 'fp-prop-embed')
      layer.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;z-index:2'
      body.append(layer)
      const scroll = body.scrollTop
      body.style.overflow = 'hidden'
      body.scrollTop = 0
      const handle = embed(ctx, layer, spec, true)
      const close = () => {
        if (embedClose !== close) return
        embedClose = null
        handle.close()
        layer.remove()
        body.style.overflow = 'auto'
        body.scrollTop = scroll
      }
      embedClose = close
      handle.onBack(close)
      await handle.ready
    }
  }
  for (const t of tabs) {
    const b = h('button', undefined, t.label)
    b.type = 'button'
    b.setAttribute('role', 'tab')
    b.addEventListener('click', () => page.select(t.id))
    buttons.set(t.id, b)
    strip.append(b)
  }
  if (tabs.length < 2) strip.hidden = true
  page.select(initial ?? tabs[0].id)
  return page
}

export interface EmbedHandle {
  ready: Promise<void>
  close(): void
  onBack(listener: () => void): void
}

/** Mounts a viewer for `spec` in `container` (a bar with the viewer's own controls, then the
 *  viewer). With `back`, the bar starts with a Back button. Closed with the page's signal. */
export function embed(ctx: PreviewContext, container: HTMLElement, spec: EmbedSpec, back: boolean): EmbedHandle {
  const { tr } = ctx
  const ac = new AbortController()
  const onAbort = () => ac.abort()
  ctx.signal.addEventListener('abort', onAbort, { once: true })
  container.style.display = 'flex'
  container.style.flexDirection = 'column'
  const bar = h('div', 'fp-prop-embed-bar')
  const backBtn = h('button', 'fp-prop-btn', tr('← 돌아가기', '← Back'))
  backBtn.type = 'button'
  const info = h('span', 'info', spec.title)
  info.title = spec.title
  const tools = h('span')
  tools.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap'
  const spacer = h('span', 'spacer')
  const zoomBox = h('span')
  zoomBox.style.cssText = 'display:flex;gap:4px;align-items:center'
  if (back) bar.append(backBtn)
  bar.append(info, tools, spacer, zoomBox)
  const host = h('div', 'fp-prop-embed-host')
  host.style.cssText = 'flex:1 1 auto;min-height:0;position:relative;overflow:auto'
  host.tabIndex = 0
  container.replaceChildren(bar, host)
  const backListeners: (() => void)[] = []
  backBtn.addEventListener('click', () => backListeners.forEach((l) => l()))
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && back) backListeners.forEach((l) => l())
  })
  let cleanup: void | (() => void)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    ac.abort()
    ctx.signal.removeEventListener('abort', onAbort)
    try {
      cleanup?.()
    } catch {
      // keep closing
    }
  }
  const sub: PreviewContext = {
    ...ctx,
    bytes: spec.bytes,
    fileType: spec.ext.toLowerCase(),
    root: host,
    toolbar: localToolbar(tools, info, zoomBox),
    signal: ac.signal
  }
  host.replaceChildren(h('div', 'fp-state', tr('여는 중…', 'Opening…')))
  const ready = (async () => {
    try {
      if (spec.render) cleanup = await spec.render(sub)
      else {
        const load = LOADERS[sub.fileType]
        if (!load) throw new Error(`no viewer for .${sub.fileType}`)
        const mod = await load()
        if (ac.signal.aborted) return
        cleanup = await mod.render(sub)
      }
      if (closed) {
        try {
          ;(cleanup as (() => void) | undefined)?.()
        } catch {
          // ignore
        }
        return
      }
      host.focus({ preventScroll: true })
    } catch (err) {
      if (ac.signal.aborted) return
      const e = err as Error & { hint?: string }
      showMessage(host, tr('이 파일을 표시할 수 없습니다', 'Cannot show this file'), e.hint ?? e.message)
    }
  })()
  return { ready, close, onBack: (l) => backListeners.push(l) }
}

/** A toolbar for an embedded viewer, drawn in the overlay's own bar. */
function localToolbar(left: HTMLElement, info: HTMLElement, right: HTMLElement): Toolbar {
  const btn = (label: string, title: string, onClick: () => void) => {
    const b = h('button', 'fp-prop-btn', label)
    b.type = 'button'
    b.title = title
    b.setAttribute('aria-label', title)
    b.addEventListener('click', onClick)
    return b
  }
  const base = info.textContent ?? ''
  return {
    button(spec: ToolbarButton) {
      const b = btn(spec.label, spec.title, spec.onClick)
      left.append(b)
      return b
    },
    select(title, options, onChange) {
      const s = h('select')
      s.title = title
      s.setAttribute('aria-label', title)
      for (const o of options) {
        const opt = h('option', undefined, o.label)
        opt.value = o.value
        s.append(opt)
      }
      s.addEventListener('change', () => onChange(s.value))
      left.append(s)
      return s
    },
    info(text) {
      info.textContent = text ? `${base} · ${text}` : base
      info.title = info.textContent
    },
    separator() {},
    zoom(z: ZoomController) {
      const label = h('span', undefined, `${Math.round(z.get() * 100)}%`)
      label.style.cssText = 'min-width:44px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums'
      z.onChange((s) => (label.textContent = `${Math.round(s * 100)}%`))
      const els: HTMLElement[] = [btn('−', 'Zoom out', () => z.set(z.get() / 1.25)), label, btn('+', 'Zoom in', () => z.set(z.get() * 1.25))]
      if (z.fit) els.push(btn('↔', 'Fit', () => z.fit!()))
      right.replaceChildren(...els)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Building blocks

export function note(text: string, kind: 'info' | 'warn' = 'info'): HTMLElement {
  const el = h('p', `fp-prop-note${kind === 'warn' ? ' warn' : ''}`, text)
  el.setAttribute('role', 'note')
  return el
}

export function heading(text: string): HTMLElement {
  return h('h3', undefined, text)
}

export type KvValue = string | number | HTMLElement | null | undefined

/** A two-column table; empty values are skipped. */
export function kvTable(rows: [string, KvValue][]): HTMLElement {
  const t = h('table', 'fp-prop-kv')
  const tb = h('tbody')
  for (const [k, v] of rows) {
    if (v == null || v === '') continue
    const tr = h('tr')
    const th = h('th', undefined, k)
    th.scope = 'row'
    const td = h('td')
    if (v instanceof HTMLElement) td.append(v)
    else td.textContent = String(v)
    if (typeof v === 'number') td.className = 'num'
    tr.append(th, td)
    tb.append(tr)
  }
  t.append(tb)
  return t
}

export function list(items: (string | [string, string])[], max = 2000): HTMLElement {
  const ul = h('ul', 'fp-prop-list')
  for (const it of items.slice(0, max)) {
    const li = h('li')
    if (Array.isArray(it)) {
      li.append(document.createTextNode(it[0]))
      if (it[1]) li.append(h('small', undefined, it[1]))
    } else li.textContent = it
    ul.append(li)
  }
  if (items.length > max) ul.append(h('li', undefined, `… +${items.length - max}`))
  return ul
}

export function collapsible(summary: string, content: HTMLElement, open = false): HTMLElement {
  const d = h('details')
  d.open = open
  const s = h('summary', undefined, summary)
  s.style.cssText = 'cursor:pointer;font-size:12.5px;padding:4px 0'
  d.append(s, content)
  return d
}

export function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', 'fp-prop-btn', label)
  b.type = 'button'
  b.title = title
  b.addEventListener('click', onClick)
  return b
}

export interface TreeEntry {
  path: string
  size: number
  dir?: boolean
  /** Extra text after the size (e.g. "zlib"). */
  tag?: string
  /** When set, the leaf gets an "Open" button. */
  open?: () => void
}

/** A folder tree from `/`-separated paths. Folders start closed beyond `openDepth`. */
export function tree(entries: TreeEntry[], tr: PreviewContext['tr'], openDepth = 1, max = 5000): HTMLElement {
  interface Node {
    dirs: Map<string, Node>
    files: TreeEntry[]
    count: number
    bytes: number
  }
  const rootNode: Node = { dirs: new Map(), files: [], count: 0, bytes: 0 }
  for (const e of entries.slice(0, max)) {
    const parts = e.path.split('/').filter(Boolean)
    if (!parts.length) continue
    let n = rootNode
    const last = e.dir ? parts.length : parts.length - 1
    for (let i = 0; i < last; i++) {
      n.count++
      n.bytes += e.size
      let next = n.dirs.get(parts[i])
      if (!next) n.dirs.set(parts[i], (next = { dirs: new Map(), files: [], count: 0, bytes: 0 }))
      n = next
    }
    if (!e.dir) {
      n.count++
      n.bytes += e.size
      n.files.push({ ...e, path: parts[parts.length - 1] })
    }
  }
  const draw = (n: Node, depth: number, into: HTMLElement) => {
    for (const [name, child] of [...n.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      const d = h('details')
      d.open = depth < openDepth
      d.append(h('summary', undefined, `📁 ${name}  (${child.count} · ${formatBytes(child.bytes)})`))
      // Children are drawn when opened so large archives stay cheap.
      let drawn = false
      const fill = () => {
        if (drawn) return
        drawn = true
        draw(child, depth + 1, d)
      }
      if (d.open) fill()
      else d.addEventListener('toggle', fill, { once: true })
      into.append(d)
    }
    for (const f of n.files.sort((a, b) => a.path.localeCompare(b.path))) {
      const row = h('div', 'leaf')
      row.append(h('span', 'name', f.path), h('span', 'size', `${formatBytes(f.size)}${f.tag ? ` · ${f.tag}` : ''}`))
      if (f.open) row.append(button(tr('열기', 'Open'), tr('미리보기에서 열기', 'Open in the preview'), f.open))
      into.append(row)
    }
  }
  const el = h('div', 'fp-prop-tree')
  draw(rootNode, 0, el)
  if (entries.length > max) el.append(h('div', undefined, `… +${entries.length - max}`))
  return el
}

/** Thumbnails of images (PNG/JPEG/BMP/GIF bytes); a click opens the full image viewer. */
export function gallery(page: PropPage, images: { name: string; bytes: Uint8Array; mime: string; ext: string }[]): HTMLElement {
  const { ctx } = page
  const g = h('div', 'fp-prop-gallery')
  for (const im of images) {
    const fig = h('figure', 'fp-prop-thumb')
    const b = h('button')
    b.type = 'button'
    b.title = ctx.tr(`${im.name} 크게 보기`, `View ${im.name}`)
    const img = h('img')
    img.alt = im.name
    img.decoding = 'async'
    img.src = objectUrl(im.bytes, im.mime, ctx.signal)
    img.addEventListener('error', () => {
      fig.replaceChildren(h('figcaption', undefined, ctx.tr(`${im.name}: 이 브라우저가 해석할 수 없는 그림`, `${im.name}: this browser cannot decode the image`)))
    })
    b.append(img)
    b.addEventListener('click', () => void page.open({ title: im.name, bytes: im.bytes, ext: im.ext }))
    fig.append(b, h('figcaption', undefined, `${im.name} · ${formatBytes(im.bytes.length)}`))
    g.append(fig)
  }
  return g
}

export function imageMime(path: string, b?: Uint8Array): { mime: string; ext: string } | null {
  if (b && b.length > 8) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' }
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: 'image/gif', ext: 'gif' }
    if (b[0] === 0x42 && b[1] === 0x4d) return { mime: 'image/bmp', ext: 'bmp' }
  }
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  if (ext === 'png') return { mime: 'image/png', ext }
  if (ext === 'jpg' || ext === 'jpeg') return { mime: 'image/jpeg', ext: 'jpg' }
  if (ext === 'gif') return { mime: 'image/gif', ext }
  if (ext === 'bmp') return { mime: 'image/bmp', ext }
  return null
}

export function formatDate(d: Date | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}
