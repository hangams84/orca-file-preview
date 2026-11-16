/** Hyperlinks inside rendered documents. docx-preview turns the file's hyperlink relationships into
 *  live `<a href>` elements, including `javascript:`, `data:` and empty targets, and a click would
 *  navigate the preview frame away. This neutralises dangerous targets after rendering and takes
 *  over every click: `#bookmark` links scroll inside the document, http(s)/mailto links show the
 *  full address in a small bar and open in the browser only after the person confirms (through
 *  Orca, which may ask again); anything else does nothing. */
import { h } from '../../core/ui.ts'

const UNSAFE = /^\s*(?:javascript|data|vbscript|file|blob):/i
const EXTERNAL = /^\s*(?:https?:|mailto:)/i

/** Classifies an href: 'internal' (#bookmark), 'external' (http/https/mailto) or 'blocked'. */
export function linkKind(href: string | null): 'internal' | 'external' | 'blocked' {
  if (!href) return 'blocked'
  const v = href.trim()
  if (v.startsWith('#') && v.length > 1) return 'internal'
  if (UNSAFE.test(v)) return 'blocked'
  if (EXTERNAL.test(v)) return 'external'
  return 'blocked'
}

/** Removes unsafe targets so the link can never navigate, keeping the address for the tooltip. */
export function neutraliseLinks(container: ParentNode): void {
  for (const a of container.querySelectorAll<HTMLAnchorElement>('a[href], a:not([href])')) {
    const href = a.getAttribute('href')
    const kind = linkKind(href)
    a.removeAttribute('target')
    a.setAttribute('rel', 'noopener noreferrer')
    if (kind === 'blocked') {
      if (href != null) a.removeAttribute('href')
      a.setAttribute('aria-disabled', 'true')
      if (href && href.trim()) a.title = href.trim().slice(0, 200)
    } else if (kind === 'external') {
      a.title = href!.trim()
    }
  }
}

export interface LinkGuardOptions {
  /** Where clicks are captured (a shadow root or element). */
  target: EventTarget & ParentNode
  /** Scroll container; the confirm bar is pinned to its top. */
  root: HTMLElement
  tr(ko: string, en: string): string
  signal: AbortSignal
}

export function guardLinks({ target, root, tr, signal }: LinkGuardOptions): void {
  let bar: HTMLElement | null = null
  const closeBar = () => {
    bar?.remove()
    bar = null
  }
  signal.addEventListener('abort', closeBar, { once: true })

  const confirmExternal = (href: string) => {
    closeBar()
    const el = h('div', 'fp-link-bar')
    el.setAttribute('role', 'group')
    el.setAttribute('aria-label', tr('외부 링크', 'External link'))
    el.style.cssText =
      'position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;' +
      'background:var(--orca-card,#f6f6f6);color:var(--orca-card-foreground,#111);border-bottom:1px solid var(--orca-border,#ddd);font-size:13px'
    const code = h('code', undefined, href)
    code.style.cssText = 'flex:1 1 100%;overflow-wrap:anywhere;font-size:12px;color:var(--orca-card-foreground,#111)'
    const btn = (label: string, primary: boolean, onClick: () => void) => {
      const b = h('button', undefined, label)
      b.type = 'button'
      b.style.cssText =
        'font:inherit;min-height:28px;padding:0 10px;border-radius:var(--orca-radius,6px);cursor:pointer;border:1px solid var(--orca-input,var(--orca-border,#ccc));' +
        (primary
          ? 'background:var(--orca-primary,#333);color:var(--orca-primary-foreground,#fff)'
          : 'background:var(--orca-secondary,#eee);color:var(--orca-secondary-foreground,#111)')
      b.addEventListener('click', onClick)
      return b
    }
    const shell = orca.shell
    if (shell) {
      const open = btn(tr('열기', 'Open'), true, () => {
        closeBar()
        void shell.openExternal(href).catch(() => {})
      })
      el.append(h('span', undefined, tr('이 링크를 브라우저에서 열까요?', 'Open this link in your browser?')), open, btn(tr('취소', 'Cancel'), false, closeBar), code)
      root.prepend(el)
      open.focus()
    } else {
      const close = btn(tr('닫기', 'Close'), false, closeBar)
      el.append(h('span', undefined, tr('여기서는 링크를 열 수 없습니다. 주소:', 'Links cannot be opened here. Address:')), close, code)
      root.prepend(el)
      close.focus()
    }
    bar = el
  }

  const scrollToBookmark = (name: string) => {
    const id = decodeURIComponent(name)
    const esc = (s: string) => s.replace(/["\\]/g, '\\$&')
    const dest =
      target.querySelector<HTMLElement>(`[id="${esc(id)}"]`) ?? target.querySelector<HTMLElement>(`[name="${esc(id)}"]`)
    dest?.scrollIntoView({ block: 'start' })
  }

  target.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a) return
      e.preventDefault()
      e.stopPropagation()
      const href = a.getAttribute('href')
      const kind = linkKind(href)
      if (kind === 'internal') scrollToBookmark(href!.trim().slice(1))
      else if (kind === 'external') confirmExternal(href!.trim())
    },
    { capture: true, signal }
  )
  // Middle-click / auxclick would open a new window: block it too.
  target.addEventListener(
    'auxclick',
    (e) => {
      if ((e.target as Element | null)?.closest?.('a')) e.preventDefault()
    },
    { capture: true, signal }
  )
}
