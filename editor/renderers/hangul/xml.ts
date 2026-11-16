/** A small, non-validating XML reader for OWPML (HWPX) parts. Runs without the DOM so the HWPX
 *  mapping is unit-testable in Node, and is faster than DOMParser for large sections. Names are
 *  kept without their namespace prefix (`hp:p` → `p`); mixed content keeps text in `kids`. */

export interface XNode {
  name: string
  attrs: Record<string, string>
  kids: (XNode | string)[]
}

const ENT: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    return ENT[e] ?? m
  })
}

const local = (n: string): string => {
  const i = n.indexOf(':')
  return i >= 0 ? n.slice(i + 1) : n
}

export class XmlError extends Error {}

/** Parses a document and returns its root element. Throws XmlError on malformed input. */
export function parseXml(src: string): XNode {
  const root: XNode = { name: '#document', attrs: {}, kids: [] }
  const stack: XNode[] = [root]
  let i = 0
  const n = src.length
  const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      pushText(stack[stack.length - 1], src.slice(i))
      break
    }
    if (lt > i) pushText(stack[stack.length - 1], src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      if (end < 0) throw new XmlError('unterminated comment')
      i = end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      if (end < 0) throw new XmlError('unterminated CDATA')
      stack[stack.length - 1].kids.push(src.slice(lt + 9, end))
      i = end + 3
      continue
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt)
      if (end < 0) throw new XmlError('unterminated declaration')
      i = end + 1
      continue
    }
    const gt = findTagEnd(src, lt)
    if (gt < 0) throw new XmlError('unterminated tag')
    if (src[lt + 1] === '/') {
      const name = local(src.slice(lt + 2, gt).trim())
      // Close up to the matching element; tolerate stray end tags.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k
          break
        }
      }
      i = gt + 1
      continue
    }
    const selfClose = src[gt - 1] === '/'
    const body = src.slice(lt + 1, selfClose ? gt - 1 : gt)
    const sp = body.search(/[\s]/)
    const name = local(sp < 0 ? body : body.slice(0, sp))
    const attrs: Record<string, string> = {}
    if (sp >= 0) {
      attrRe.lastIndex = sp
      let m: RegExpExecArray | null
      while ((m = attrRe.exec(body))) attrs[local(m[1])] = decodeEntities(m[3] ?? m[4] ?? '')
    }
    const el: XNode = { name, attrs, kids: [] }
    stack[stack.length - 1].kids.push(el)
    if (!selfClose) stack.push(el)
    i = gt + 1
  }
  const top = root.kids.find((k): k is XNode => typeof k !== 'string')
  if (!top) throw new XmlError('no root element')
  return top
}

function findTagEnd(src: string, from: number): number {
  let q = ''
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i]
    if (q) {
      if (c === q) q = ''
    } else if (c === '"' || c === "'") q = c
    else if (c === '>') return i
  }
  return -1
}

function pushText(el: XNode, raw: string): void {
  if (!raw) return
  el.kids.push(decodeEntities(raw))
}

/** Child elements, optionally by local name. */
export function kids(el: XNode | null | undefined, name?: string): XNode[] {
  const out: XNode[] = []
  if (!el) return out
  for (const k of el.kids) if (typeof k !== 'string' && (!name || k.name === name)) out.push(k)
  return out
}

export function kid(el: XNode | null | undefined, name: string): XNode | null {
  if (!el) return null
  for (const k of el.kids) if (typeof k !== 'string' && k.name === name) return k
  return null
}

/** First descendant (depth-first) with the local name. */
export function find(el: XNode | null | undefined, name: string): XNode | null {
  if (!el) return null
  for (const k of el.kids) {
    if (typeof k === 'string') continue
    if (k.name === name) return k
    const f = find(k, name)
    if (f) return f
  }
  return null
}

export function text(el: XNode | null | undefined): string {
  if (!el) return ''
  let s = ''
  for (const k of el.kids) s += typeof k === 'string' ? k : text(k)
  return s
}

export function num(el: XNode | null | undefined, name: string, fallback = 0): number {
  const v = el?.attrs[name]
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
