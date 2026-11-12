/** HTML (.html, .htm): a safe, static preview. The markup is sanitized with DOMPurify (no scripts,
 *  event handlers, javascript: URLs, forms that post, frames or embeds), external and relative
 *  resources are dropped (there is no network), and the result is shown in an `srcdoc` iframe with
 *  its own restrictive CSP so the page's CSS cannot reach the toolbar. Links never navigate the
 *  frame: in-page anchors scroll, http(s) links open in the system browser when Orca allows it. */
import { DOMPurify } from '../../vendor/purify.js'
import { decodeText } from '../core/encoding.ts'
import { formatBytes } from '../core/i18n.ts'
import type { PreviewContext } from '../core/types.ts'
import { bindZoomGestures, createZoom, h } from '../core/ui.ts'
import { bindZoomKeys } from './media/keys.ts'
import { createSourceView, switchableZoom } from './media/source-view.ts'

const STYLE = `
.fp-html { position: absolute; inset: 0; display: flex; flex-direction: column; }
.fp-html iframe { flex: 1 1 auto; width: 100%; min-height: 0; border: 0; display: block; background: #fff; }
.fp-html-note { flex: none; display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 12px; font-size: 12px;
  background: var(--orca-muted, #f4f4f5); color: var(--orca-foreground, #222); border-bottom: 1px solid var(--orca-border, #ddd); }
.fp-html-note span { flex: 1 1 auto; min-width: 0; }
.fp-html-note button { flex: none; font: inherit; min-width: 32px; min-height: 28px; border: 0; background: transparent;
  color: inherit; cursor: pointer; border-radius: var(--orca-radius, 6px); }
.fp-html-note button:hover { background: var(--orca-accent, #e4e4e4); }
.fp-html-link { flex-wrap: wrap; }
.fp-html-link code { flex: 1 1 100%; overflow-wrap: anywhere; font: 12px/1.4 ui-monospace, Consolas, monospace; user-select: all; }
.fp-html-link button { border: 1px solid var(--orca-input, var(--orca-border, #ccc)); padding: 0 10px; }
.fp-html-link button.primary { background: var(--orca-primary, #333); color: var(--orca-primary-foreground, #fff); }
`

/** CSP inside the preview document: nothing may load except inline styles and data:/blob: media. */
const INNER_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'"
/** Sandbox tokens for the preview iframe: same origin (so the parent can wire link clicks, zoom
 *  and keys on its document) but no allow-scripts, so even a sanitiser bypass cannot run script;
 *  never allow-popups or allow-top-navigation. Orca did not render an iframe with sandbox="" (no
 *  tokens); set this to null to fall back to the unsandboxed srcdoc iframe if this one does not
 *  render either (the inner CSP still blocks script). */
const FRAME_SANDBOX: string | null = 'allow-same-origin'
/** Paper defaults applied before the page's own styles (it can override them). */
const BASE_CSS = 'html{background:#fff;color:#000;color-scheme:light}'

/** Charset from a BOM-less file's <meta charset> or http-equiv Content-Type, in the first 1 KiB. */
function metaCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 1024))
  const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)
  return m ? m[1].toLowerCase() : null
}

function decodeHtml(bytes: Uint8Array): { text: string; encoding: string } {
  const hasBom = (bytes[0] === 0xef && bytes[1] === 0xbb) || (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  const declared = hasBom ? null : metaCharset(bytes)
  if (declared && !declared.startsWith('utf-16')) {
    try {
      const dec = new TextDecoder(declared, { fatal: declared === 'utf-8' })
      return { text: dec.decode(bytes), encoding: dec.encoding }
    } catch {
      // unknown label or not really UTF-8: fall back to detection
    }
  }
  return decodeText(bytes)
}

const URL_ATTRS = new Set(['src', 'href', 'xlink:href', 'poster', 'background', 'srcset', 'data', 'action', 'formaction', 'ping', 'cite', 'longdesc'])
const isInline = (v: string) => /^\s*(data:|blob:)/i.test(v)
const isLink = (v: string) => /^\s*(https?:|mailto:|tel:|#)/i.test(v)

interface Sanitized {
  html: string
  blocked: number
  scripts: number
}

/** CSS text with comments removed and escapes decoded, for detection only (never rendered). */
function cssNormalise(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_m, hex: string) => {
      const cp = parseInt(hex, 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�'
    })
    .replace(/\\([^\n])/g, '$1')
}
/** Count of tokens that can load something: url(, image-set(, image(, cross-fade(, @import. */
function loadTokens(text: string): number {
  return (text.match(/\b(?:url|image-set|image|cross-fade)\(|@import\b/gi) ?? []).length
}

function sanitize(text: string): Sanitized {
  let blocked = 0
  DOMPurify.removeAllHooks()
  // url(...) and @import in CSS that is not inline data cannot load: neutralise them so nothing is
  // requested (the inner CSP would block them anyway) and count them for the notice.
  const css = (text: string) => {
    // Escaped or comment-split forms (an escaped "@import", an escaped "url(", "@im/**/port") are never legitimate:
    // when decoding CSS escapes and dropping comments reveals more loading tokens than the plain
    // text has, drop the whole stylesheet / style attribute.
    if (loadTokens(cssNormalise(text)) > loadTokens(text)) {
      blocked++
      return ''
    }
    return text
      .replace(/(?:-webkit-)?image-set\((?:[^()]|\([^()]*\))*\)/gi, (m) => {
        if (!/["'(]\s*(?!data:|blob:)[^"'()\s]/i.test(m.replace(/^(?:-webkit-)?image-set\(/i, ''))) return m
        blocked++
        return 'none'
      })
      .replace(/@import\s+[^;]+;?/gi, () => {
        blocked++
        return ''
      })
      .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (m, _q, u: string) => {
        if (isInline(u)) return m
        blocked++
        return 'none'
      })
  }
  DOMPurify.addHook('uponSanitizeElement', (node) => {
    if (node.nodeName.toLowerCase() === 'style' && node.textContent) node.textContent = css(node.textContent)
  })
  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const name = data.attrName
    if (name === 'style') {
      data.attrValue = css(data.attrValue)
      return
    }
    if (!URL_ATTRS.has(name)) return
    const v = data.attrValue
    if (name === 'href' && node.nodeName.toLowerCase() === 'a') {
      if (!isLink(v)) data.attrValue = '#'
      return
    }
    if (name === 'href' && (node.nodeName.toLowerCase() === 'use' || node.nodeName.toLowerCase() === 'image') && /^\s*#/.test(v)) return
    if (isInline(v) && name !== 'srcset') return
    if (v.trim()) blocked++
    data.keepAttr = false
  })
  let html: string
  try {
    // <base> is forbidden below anyway; dropping its tags first stops DOMPurify's inert parse from
    // attempting a base-URI change that the frame's CSP then reports as a violation.
    html = DOMPurify.sanitize(text.replace(/<base\b[^>]*>/gi, ''), {
      WHOLE_DOCUMENT: true,
      FORBID_TAGS: ['base', 'link', 'meta', 'iframe', 'frame', 'frameset', 'object', 'embed', 'portal'],
      FORBID_ATTR: ['action', 'formaction', 'target', 'ping', 'http-equiv']
    })
  } finally {
    DOMPurify.removeAllHooks()
  }
  let scripts = 0
  for (const r of DOMPurify.removed as { element?: Element }[]) {
    if (r.element && r.element.nodeName.toLowerCase() === 'script') scripts++
  }
  return { html, blocked, scripts }
}

function buildSrcdoc(original: string, s: Sanitized): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${INNER_CSP}"><style>${BASE_CSS}</style>`
  let html = s.html
  const i = html.search(/<head[^>]*>/i)
  if (i >= 0) {
    const end = html.indexOf('>', i) + 1
    html = html.slice(0, end) + head + html.slice(end)
  } else {
    html = `<head>${head}</head>` + html
  }
  const doctype = /^\s*(<!--[\s\S]*?-->\s*)*<!doctype\s+html/i.test(original) ? '<!doctype html>' : ''
  return doctype + html
}

export async function render(ctx: PreviewContext): Promise<void> {
  const { bytes, root, toolbar, tr, signal } = ctx
  const { text, encoding } = decodeHtml(bytes)
  const sanitized = sanitize(text)

  const style = h('style', undefined, STYLE)
  const wrap = h('div', 'fp-html')
  const frame = h('iframe')
  frame.title = tr('HTML 미리보기', 'HTML preview')
  frame.setAttribute('referrerpolicy', 'no-referrer')
  if (FRAME_SANDBOX !== null) frame.setAttribute('sandbox', FRAME_SANDBOX)
  frame.setAttribute('srcdoc', buildSrcdoc(text, sanitized))

  const notes: string[] = []
  if (sanitized.scripts > 0) notes.push(tr(`스크립트 ${sanitized.scripts}개는 실행하지 않습니다`, `${sanitized.scripts} script(s) not run`))
  if (sanitized.blocked > 0) {
    notes.push(
      tr(`외부·상대 경로 리소스 ${sanitized.blocked}개는 불러오지 않습니다`, `${sanitized.blocked} external or relative resource(s) not loaded`)
    )
  }
  if (notes.length) {
    const note = h('div', 'fp-html-note')
    note.setAttribute('role', 'note')
    const close = h('button', undefined, '×')
    close.type = 'button'
    close.title = tr('닫기', 'Dismiss')
    close.setAttribute('aria-label', close.title)
    close.addEventListener('click', () => note.remove())
    note.append(h('span', undefined, `${tr('안전 미리보기', 'Safe preview')}: ${notes.join(' · ')}`), close)
    wrap.append(note)
  }
  wrap.append(frame)

  // http(s) links: show the full URL and ask before handing it to Orca (which may ask again).
  let linkBar: HTMLElement | null = null
  const confirmLink = (href: string) => {
    linkBar?.remove()
    const bar = h('div', 'fp-html-note fp-html-link')
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', tr('외부 링크', 'External link'))
    const close = () => {
      bar.remove()
      if (linkBar === bar) linkBar = null
    }
    const cancel = h('button', undefined, tr('취소', 'Cancel'))
    cancel.type = 'button'
    cancel.addEventListener('click', close)
    const shell = orca.shell
    if (shell) {
      const open = h('button', 'primary', tr('열기', 'Open'))
      open.type = 'button'
      open.addEventListener('click', () => {
        close()
        void shell.openExternal(href).catch(() => {})
      })
      bar.append(h('span', undefined, tr('이 링크를 브라우저에서 열까요?', 'Open this link in your browser?')), open, cancel, h('code', undefined, href))
      open.focus()
    } else {
      cancel.textContent = tr('닫기', 'Close')
      bar.append(h('span', undefined, tr('여기서는 링크를 열 수 없습니다. 주소:', 'Links cannot be opened here. Address:')), cancel, h('code', undefined, href))
    }
    wrap.insertBefore(bar, frame)
    linkBar = bar
    if (!shell) cancel.focus()
  }

  let scale = 1
  const zoom = createZoom(scale, (s) => {
    scale = s
    const d = frame.contentDocument
    if (d?.documentElement) d.documentElement.style.zoom = String(s)
  }, undefined, { min: 0.25, max: 4 })

  // Wire every document the frame loads (the first load, and again after Source -> Preview moves
  // the iframe), never a placeholder document that exists before the srcdoc has loaded.
  frame.addEventListener('load', () => wireFrame(ctx, frame, zoom, () => scale, confirmLink), { signal })
  const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }))
  const source = createSourceView(ctx, text)
  const sw = switchableZoom(zoom)
  const showPreview = () => {
    root.onscroll = null
    root.replaceChildren(style, wrap)
  }
  showPreview()
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 3000))])
  if (signal.aborted) return

  let showingSource = false
  const btn = toolbar.button({
    label: tr('원본', 'Source'),
    title: tr('HTML 원본 보기', 'Show HTML source'),
    onClick: () => {
      showingSource = !showingSource
      btn.setAttribute('aria-pressed', String(showingSource))
      btn.textContent = showingSource ? tr('미리보기', 'Preview') : tr('원본', 'Source')
      if (showingSource) {
        source.show()
        sw.use(source.zoom)
        toolbar.zoom(source.zoom)
      } else {
        // Moving an iframe reloads it; the load listener above wires the fresh document.
        showPreview()
        sw.use(zoom)
        toolbar.zoom(zoom)
      }
    }
  })
  btn.setAttribute('aria-pressed', 'false')
  toolbar.info(`${encoding.toUpperCase()} · ${formatBytes(bytes.byteLength)}`)
  toolbar.zoom(zoom)
  bindZoomGestures(root, sw.ctl, signal)
  bindZoomKeys(root, sw.ctl, signal)
}

/** Click, submit and Ctrl+wheel handling inside the (same-origin, script-free) preview document. */
function wireFrame(
  ctx: PreviewContext,
  frame: HTMLIFrameElement,
  zoom: ReturnType<typeof createZoom>,
  scale: () => number,
  onExternal: (href: string) => void
): void {
  const doc = frame.contentDocument
  if (!doc) return
  if (doc.documentElement) doc.documentElement.style.zoom = String(scale())
  const { signal } = ctx
  doc.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]')
      if (!a) return
      e.preventDefault()
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('#')) {
        // A malformed escape (e.g. "#%E0%A4%A") is simply a fragment that is not found.
        let id: string | null
        try {
          id = decodeURIComponent(href.slice(1))
        } catch {
          id = null
        }
        if (id === null) return
        const target = id ? (doc.getElementById(id) ?? doc.getElementsByName(id)[0]) : doc.body
        target?.scrollIntoView({ block: 'start' })
        return
      }
      if (/^https?:/i.test(href)) onExternal(href)
    },
    { capture: true, signal }
  )
  doc.addEventListener('submit', (e) => e.preventDefault(), { capture: true, signal })
  // Keys typed inside the preview document: plain +/-/0 zoom (Ctrl variants too, the outer handler
  // does not see events inside the frame).
  bindZoomKeys(doc, zoom, signal)
  doc.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key === '+' || e.key === '=') zoom.set(zoom.get() * 1.1)
      else if (e.key === '-') zoom.set(zoom.get() / 1.1)
      else if (e.key === '0') zoom.set(1)
      else return
      e.preventDefault()
    },
    { signal }
  )
  doc.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoom.set(zoom.get() * Math.exp(-e.deltaY * 0.0025))
    },
    { passive: false, signal }
  )
}
