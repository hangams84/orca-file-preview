/** A stand-in for Orca's frame API so the preview runs in a plain browser for automated tests.
 *  Query: ?file=samples/sample.docx&theme=dark|light&locale=ko|en */
const q = new URLSearchParams(location.search)
const file = q.get('file') ?? ''
const theme = q.get('theme') === 'light' ? 'light' : 'dark'
const locale = q.get('locale') ?? 'ko'

const VARS = {
  dark: {
    background: '#0a0a0a', foreground: '#f0f0f0', card: '#141414', 'card-foreground': '#f0f0f0',
    popover: '#171717', 'popover-foreground': '#f0f0f0', primary: '#f0f0f0', 'primary-foreground': '#111',
    secondary: '#262626', 'secondary-foreground': '#f0f0f0', muted: '#262626', 'muted-foreground': '#a3a3a3',
    accent: '#303030', 'accent-foreground': '#fafafa', destructive: '#dc2626', 'destructive-foreground': '#fff',
    border: '#2a2a2a', input: '#3a3a3a', ring: '#737373', radius: '6px'
  },
  light: {
    background: '#ffffff', foreground: '#0a0a0a', card: '#fafafa', 'card-foreground': '#0a0a0a',
    popover: '#ffffff', 'popover-foreground': '#0a0a0a', primary: '#171717', 'primary-foreground': '#fafafa',
    secondary: '#f4f4f5', 'secondary-foreground': '#171717', muted: '#f4f4f5', 'muted-foreground': '#71717a',
    accent: '#e4e4e7', 'accent-foreground': '#171717', destructive: '#dc2626', 'destructive-foreground': '#fff',
    border: '#e4e4e7', input: '#d4d4d8', ring: '#a1a1aa', radius: '6px'
  }
}
const html = document.documentElement
html.classList.add(theme)
for (const [k, v] of Object.entries(VARS[theme])) html.style.setProperty(`--orca-${k}`, v)

const listeners: Record<string, ((p: unknown) => void)[]> = {}
const fileType = (file.match(/\.([^./\\]+)$/)?.[1] ?? '').toLowerCase()
const docPromise = fetch(`/${file}`).then(async (r) => {
  if (!r.ok) throw new Error(`fixture ${file}: HTTP ${r.status}`)
  return { version: 1, readOnly: false, content: { kind: 'bytes' as const, bytes: await r.arrayBuffer() }, fileType }
})

;(globalThis as any).orca = {
  api: 1,
  locale,
  on(event: string, handler: (p: unknown) => void) {
    ;(listeners[event] ??= []).push(handler)
    return { dispose() {} }
  },
  document: {
    get: () => docPromise,
    onDidChange(handler: (d: unknown) => void) {
      void docPromise.then(handler)
      return { dispose() {} }
    },
    applyEdit: () => Promise.reject(Object.assign(new Error('read-only harness'), { code: 'not_permitted' })),
    session: () => Promise.reject(new Error('not used by the preview'))
  }
}
// Lets a test flip the theme: window.__setTheme('light')
;(globalThis as any).__setTheme = (t: 'light' | 'dark') => {
  html.classList.remove('light', 'dark')
  html.classList.add(t)
  for (const [k, v] of Object.entries(VARS[t])) html.style.setProperty(`--orca-${k}`, v)
  for (const l of listeners.theme ?? []) l({ colorScheme: t })
}
