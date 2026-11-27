/** Shared state, styles and helpers of the AI Model Preview views. */
import type { ThemeName } from '../../../core/types.ts'
import type { ModelIR, ModuleNode, TensorInfo, Value } from '../ir.ts'
import type { ModuleStat } from '../tree.ts'

export type ViewName = 'graph' | 'tree' | 'table' | 'map' | 'arch' | 'tensor' | 'info'

export type Selection = { kind: 'module'; path: string } | { kind: 'tensor'; name: string } | { kind: 'node'; id: string } | null

/** What every view gets. */
export interface App {
  ir: ModelIR
  tr(ko: string, en: string): string
  compact: boolean
  theme(): ThemeName
  signal: AbortSignal
  modules: ModuleNode
  stats: Map<string, ModuleStat>
  tensorsByName: Map<string, TensorInfo>
  moduleByPath: Map<string, ModuleNode>
  /** Owner module path of a tensor. */
  ownerOf(tensor: string): string
  /** Shows details in the side panel (null hides it). */
  detail(content: HTMLElement | null): void
  /** Switches view; `arg` selects something in it (tensor name, module path). */
  show(view: ViewName, arg?: string): void
  /** The current view's exportable SVG, when it has one. */
  setExportSvg(get: (() => SVGSVGElement | null) | null): void
}

export interface View {
  /** Mounts into `el`; returns cleanup. `arg` is a selection hint. */
  mount(el: HTMLElement, app: App, arg?: string): void | (() => void)
}

export const CSS = `
.am-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; box-sizing: border-box; }
.am-summary { flex: none; display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; padding: 6px 10px; font-size: 12px;
  border-bottom: 1px solid var(--orca-border, #ddd); color: var(--orca-muted-foreground, #666); }
.am-summary b { color: var(--orca-foreground, inherit); font-weight: 600; }
.am-dtbar { display: inline-flex; width: 120px; height: 8px; border-radius: 3px; overflow: hidden; vertical-align: middle; background: var(--orca-muted, #eee); }
.am-dtbar span { display: block; height: 100%; }
.am-notes { flex: none; font-size: 12px; padding: 0 10px; border-bottom: 1px solid var(--orca-border, #ddd); }
.am-notes summary { cursor: pointer; padding: 4px 0; color: var(--orca-muted-foreground, #666); }
.am-notes li { margin: 2px 0; }
.am-notes li.warn { color: #c0392b; }
:root:not(.light) .am-notes li.warn { color: #ff8a7a; }
.am-body { flex: 1 1 auto; display: flex; min-height: 0; position: relative; }
.am-view { flex: 1 1 auto; min-width: 0; min-height: 0; position: relative; overflow: hidden; display: flex; flex-direction: column; }
.am-side { flex: none; width: 320px; max-width: 45%; overflow: auto; border-left: 1px solid var(--orca-border, #ddd); background: var(--orca-card, #fafafa);
  padding: 8px 10px; box-sizing: border-box; font-size: 12px; position: relative; }
.am-side[hidden] { display: none; }
.am-side .am-close { position: absolute; top: 4px; right: 4px; }
.am-side h3 { margin: 0 24px 2px 0; font-size: 14px; word-break: break-all; }
.am-side .sub { color: var(--orca-muted-foreground, #666); margin-bottom: 8px; word-break: break-all; }
.am-side h4 { margin: 10px 0 4px; font-size: 12px; color: var(--orca-muted-foreground, #666); font-weight: 600; }
.am-kv { width: 100%; border-collapse: collapse; font-size: 12px; }
.am-kv td { padding: 2px 4px; vertical-align: top; border-bottom: 1px solid var(--orca-border, #eee); word-break: break-word; }
.am-kv td:first-child { color: var(--orca-muted-foreground, #666); white-space: nowrap; width: 1%; }
.am-mono { font-family: ui-monospace, "Cascadia Mono", Consolas, "D2Coding", monospace; font-size: 11.5px; }
.am-chip { display: inline-block; font: 600 10.5px/1.5 ui-monospace, Consolas, monospace; padding: 0 5px; border-radius: 4px;
  background: var(--orca-muted, #eee); color: var(--orca-foreground, #222); margin-right: 3px; }
.am-link { color: var(--orca-primary, #2563eb); cursor: pointer; text-decoration: underline; background: none; border: 0; padding: 0; font: inherit; text-align: left; }
.am-bar { flex: none; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--orca-border, #ddd); }
.am-bar input[type=search], .am-bar input[type=text], .am-bar select { font: inherit; min-height: 26px; padding: 0 6px; border-radius: var(--orca-radius, 6px);
  border: 1px solid var(--orca-input, var(--orca-border, #ccc)); background: var(--orca-background, #fff); color: inherit; min-width: 0; }
.am-bar input[type=search] { flex: 1 1 140px; max-width: 280px; }
.am-bar button { font: inherit; min-height: 26px; padding: 0 8px; border-radius: var(--orca-radius, 6px); cursor: pointer;
  border: 1px solid var(--orca-input, var(--orca-border, #ccc)); background: var(--orca-secondary, #eee); color: var(--orca-secondary-foreground, inherit); }
.am-bar button[aria-pressed="true"] { background: var(--orca-primary, #333); color: var(--orca-primary-foreground, #fff); }
.am-bar .am-info { color: var(--orca-muted-foreground, #666); font-size: 12px; }
.am-scroll { flex: 1 1 auto; overflow: auto; min-height: 0; position: relative; }
.am-empty { padding: 24px; text-align: center; color: var(--orca-muted-foreground, #666); }
.am-pad { padding: 10px 12px; }
.am-section { margin: 0 0 16px; }
.am-section h3 { font-size: 13px; margin: 0 0 6px; }
.am-table { border-collapse: collapse; font-size: 12px; }
.am-table th, .am-table td { padding: 3px 8px; border-bottom: 1px solid var(--orca-border, #eee); text-align: left; vertical-align: top; }
.am-table th { color: var(--orca-muted-foreground, #666); font-weight: 600; }
.am-table td.num, .am-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
.am-inferred { color: #b45309; font-size: 12px; }
:root:not(.light) .am-inferred { color: #f0b35a; }
.am-sheet-handle { display: none; }
@media (max-width: 600px) {
  .am-side { position: absolute; left: 0; right: 0; bottom: 0; width: auto; max-width: none; max-height: 55%; border-left: 0;
    border-top: 1px solid var(--orca-border, #ddd); border-radius: 12px 12px 0 0; box-shadow: 0 -4px 16px rgba(0,0,0,.2); z-index: 5; }
  .am-sheet-handle { display: block; width: 40px; height: 4px; border-radius: 2px; background: var(--orca-border, #bbb); margin: 0 auto 6px; }
  .am-summary { gap: 2px 10px; }
}
`

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export const SVGNS = 'http://www.w3.org/2000/svg'
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

/** 1234567 → `1.23 M`; exact value stays in titles. */
export function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)} T`
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)} B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)} M`
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)} K`
  return n.toLocaleString('en-US')
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function fmtShape(s: readonly (number | string)[]): string {
  return s.length ? s.join('×') : 'scalar'
}

export function fmtNum(x: number): string {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e5 || a < 1e-3) return x.toExponential(3)
  return String(+x.toPrecision(5))
}

/** A Value as short text. */
export function fmtValue(v: Value | undefined): string {
  if (v === undefined) return ''
  if (v === null) return 'None'
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'number') return fmtNum(v)
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))
  } catch {
    return String(v)
  }
}

/** Key/value table. Values may be elements. */
export function kvTable(rows: [string, string | Node][]): HTMLTableElement {
  const t = el('table', 'am-kv')
  for (const [k, v] of rows) {
    const tr = el('tr')
    const a = el('td', undefined, k)
    const b = el('td')
    if (typeof v === 'string') b.textContent = v
    else b.append(v)
    tr.append(a, b)
    t.append(tr)
  }
  return t
}

/** Stable colour per dtype for chips and bars. */
export function dtypeColor(d: string): string {
  const map: Record<string, string> = { f32: '#4c8bf5', f16: '#22a06b', bf16: '#8e5bd8', f64: '#1f5fbf', i64: '#a0a0a0', i32: '#b0b0b0', i8: '#e5793a', u8: '#d9a54c', qint8: '#e5793a', quint8: '#d9a54c', bool: '#888', f8e4m3: '#c2417a', f8e5m2: '#c2417a' }
  if (map[d]) return map[d]
  let h = 0
  for (const c of d) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 55% 55%)`
}

/** Operator category for graph colours. */
export function opCategory(op: string): 'conv' | 'linear' | 'norm' | 'act' | 'pool' | 'attn' | 'shape' | 'math' | 'io' | 'other' {
  const o = op.toLowerCase().replace(/^aten::|^aten\./, '')
  if (/conv/.test(o)) return 'conv'
  if (/linear|gemm|matmul|dense|fully_?connected|addmm|^mm$|^bmm$|embedding|gather/.test(o)) return 'linear'
  if (/norm|batch_norm|layer_norm|instancenorm|groupnorm|rms/.test(o)) return 'norm'
  if (/relu|gelu|silu|sigmoid|tanh|softmax|swish|elu|mish|hardswish|softplus|prelu|leaky|activation|logistic|dropout/.test(o)) return 'act'
  if (/pool|upsample|resize|interpolate/.test(o)) return 'pool'
  if (/attention|multihead|scaled_dot|sdpa|attn/.test(o)) return 'attn'
  if (/reshape|view|flatten|transpose|permute|squeeze|unsqueeze|concat|cat$|split|slice|getitem|expand|stack|chunk|shape|pad|tuple|list|contiguous|select|index|gather_nd|strided/.test(o)) return 'shape'
  if (/^(add|sub|mul|div|pow|neg|exp|log|sqrt|rsqrt|mean|sum|max|min|abs|where|clamp|erf|reciprocal|floordiv|remainder|cumsum)/.test(o)) return 'math'
  return 'other'
}

export const CATEGORY_COLORS: Record<string, { light: string; dark: string; label: string }> = {
  conv: { light: '#dbe7fd', dark: '#2f4f86', label: 'C' },
  linear: { light: '#d5ecfa', dark: '#24577a', label: 'L' },
  norm: { light: '#d7f0df', dark: '#2f6b45', label: 'N' },
  act: { light: '#fde7c8', dark: '#8a5a1f', label: 'A' },
  pool: { light: '#e6e6e6', dark: '#4a4d55', label: 'P' },
  attn: { light: '#eadcf8', dark: '#5a3f7a', label: 'T' },
  shape: { light: '#eeeeee', dark: '#3c3f45', label: 'S' },
  math: { light: '#f8dce4', dark: '#6e3348', label: 'M' },
  io: { light: 'transparent', dark: 'transparent', label: '' },
  other: { light: '#ececf4', dark: '#43465a', label: '·' }
}

/** Short module type (`torch.nn.modules.conv.Conv2d` → `Conv2d`). */
export function shortType(t: string | undefined): string {
  if (!t) return ''
  return t.split('.').pop() ?? t
}

/** Triggers a download where the frame allows it; returns false otherwise. */
export function download(name: string, data: Blob): boolean {
  try {
    const url = URL.createObjectURL(data)
    const a = el('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return true
  } catch {
    return false
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Sandboxed frames may refuse the async clipboard: fall back to a selected textarea.
    const ta = el('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

/** A virtual list: renders only rows in view. `render(i)` builds row i (fixed height). */
export function virtualList(host: HTMLElement, rowHeight: number, count: () => number, render: (i: number) => HTMLElement, signal: AbortSignal): { refresh(): void; scrollTo(i: number): void } {
  host.style.overflow = 'auto'
  const spacer = el('div')
  spacer.style.position = 'relative'
  host.append(spacer)
  let raf = 0
  const draw = () => {
    raf = 0
    const n = count()
    spacer.style.height = `${n * rowHeight}px`
    const top = host.scrollTop
    const first = Math.max(0, Math.floor(top / rowHeight) - 10)
    const last = Math.min(n, Math.ceil((top + host.clientHeight) / rowHeight) + 10)
    const frag = document.createDocumentFragment()
    for (let i = first; i < last; i++) {
      const r = render(i)
      r.style.position = 'absolute'
      r.style.top = `${i * rowHeight}px`
      r.style.left = '0'
      r.style.right = '0'
      r.style.height = `${rowHeight}px`
      frag.append(r)
    }
    spacer.replaceChildren(frag)
  }
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw)
  }
  host.addEventListener('scroll', schedule, { signal, passive: true })
  const ro = new ResizeObserver(schedule)
  ro.observe(host)
  signal.addEventListener('abort', () => ro.disconnect())
  draw()
  return {
    refresh: draw,
    scrollTo: (i) => {
      host.scrollTop = Math.max(0, i * rowHeight - host.clientHeight / 2)
      draw()
    }
  }
}

/** Theme-aware colour lookups at render time. */
export function isDark(app: App): boolean {
  return app.theme() === 'dark'
}
