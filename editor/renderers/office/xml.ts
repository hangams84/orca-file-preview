/** Namespace-agnostic XML helpers for OOXML parts (match by local name, e.g. `sp` for `p:sp`). */

export function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  return doc
}

/** Direct children with the given local name (all element children when omitted). */
export function kids(el: Element | null | undefined, name?: string): Element[] {
  const out: Element[] = []
  if (!el) return out
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c)
  return out
}

/** First direct child with the local name. */
export function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c
  return null
}

/** Follows a path of local names through first children: `path(spPr, 'xfrm', 'off')`. */
export function path(el: Element | null | undefined, ...names: string[]): Element | null {
  let cur: Element | null = el ?? null
  for (const n of names) {
    cur = kid(cur, n)
    if (!cur) return null
  }
  return cur
}

/** First descendant with the local name (depth-first). */
export function find(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null
  const all = el.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) if (all[i].localName === name) return all[i]
  return null
}

export function findAll(el: Element | null | undefined, name: string): Element[] {
  const out: Element[] = []
  if (!el) return out
  const all = el.getElementsByTagName('*')
  for (let i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i])
  return out
}

/** Attribute by local name (handles prefixed attributes such as `r:embed`). */
export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null
  const direct = el.getAttribute(name)
  if (direct != null) return direct
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value
  return null
}

export function num(el: Element | null | undefined, name: string, fallback?: number): number | undefined {
  const v = attr(el, name)
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function bool(el: Element | null | undefined, name: string): boolean | undefined {
  const v = attr(el, name)
  if (v == null) return undefined
  return v === '1' || v === 'true' || v === 'on'
}

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** A relationship id attribute such as `r:id` / `r:embed` (distinct from a plain `id`). */
export function relAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null
  const v = el.getAttributeNS(REL_NS, name)
  if (v) return v
  for (const a of Array.from(el.attributes)) if (a.localName === name && a.prefix) return a.value
  return null
}
