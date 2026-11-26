/** A small, strict XML reader and writer for robot descriptions (URDF, xacro). It runs without the
 *  DOM so the xacro processor and its unit tests share one tree; the tree keeps attribute order,
 *  text, comments and CDATA so a processed xacro can be written back out as URDF. */

export interface XElement {
  type: 'element'
  name: string
  /** Attributes in document order. */
  attrs: [string, string][]
  children: XNode[]
  /** 1-based source line of the start tag (0 for generated nodes). */
  line: number
}
export interface XText {
  type: 'text'
  text: string
}
export interface XComment {
  type: 'comment'
  text: string
}
export type XNode = XElement | XText | XComment

export class XmlError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number
  ) {
    super(`${message} (line ${line}, column ${column})`)
    this.name = 'XmlError'
  }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' }
const NAME_START = /[A-Za-z_:À-￿]/
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/

/** Parses a document and returns its root element. Throws XmlError on malformed input. */
export function parseXml(src: string): XElement {
  let i = 0
  const n = src.length
  if (src.charCodeAt(0) === 0xfeff) i = 1

  const fail = (msg: string, at = i): never => {
    let line = 1
    let col = 1
    for (let k = 0; k < at && k < n; k++) {
      if (src.charCodeAt(k) === 10) {
        line++
        col = 1
      } else col++
    }
    throw new XmlError(msg, line, col)
  }
  // Line numbers of start tags, counted incrementally.
  let lineAt = 0
  let lineNo = 1
  const lineOf = (pos: number) => {
    for (; lineAt < pos; lineAt++) if (src.charCodeAt(lineAt) === 10) lineNo++
    return lineNo
  }

  const decode = (raw: string, at: number): string => {
    if (raw.indexOf('&') < 0) return raw
    return raw.replace(/&([^;&\s]*);?/g, (m, ent: string) => {
      if (!m.endsWith(';')) fail('unescaped "&"', at)
      if (ent[0] === '#') {
        const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) fail(`bad character reference &${ent};`, at)
        return String.fromCodePoint(code)
      }
      const v = ENTITIES[ent]
      if (v == null) fail(`unknown entity &${ent};`, at)
      return v as string
    })
  }

  const readName = (): string => {
    const start = i
    if (i >= n || !NAME_START.test(src[i])) fail('expected a name')
    i++
    while (i < n && NAME_CHAR.test(src[i])) i++
    return src.slice(start, i)
  }
  const skipSpace = () => {
    while (i < n) {
      const c = src.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) i++
      else break
    }
  }
  const startsWith = (s: string) => src.startsWith(s, i)

  /** Skips the prolog/epilog items: declarations, comments, processing instructions, DOCTYPE. */
  const skipMisc = (allowDoctype: boolean) => {
    for (;;) {
      skipSpace()
      if (startsWith('<?')) {
        const end = src.indexOf('?>', i + 2)
        if (end < 0) fail('unterminated processing instruction')
        i = end + 2
      } else if (startsWith('<!--')) {
        const end = src.indexOf('-->', i + 4)
        if (end < 0) fail('unterminated comment')
        i = end + 3
      } else if (allowDoctype && startsWith('<!DOCTYPE')) {
        // Skip, including an internal subset in brackets; entities declared there are not expanded.
        let depth = 0
        for (; i < n; i++) {
          const c = src[i]
          if (c === '[') depth++
          else if (c === ']') depth--
          else if (c === '>' && depth <= 0) break
        }
        if (i >= n) fail('unterminated DOCTYPE')
        i++
      } else return
    }
  }

  skipMisc(true)
  if (i >= n || src[i] !== '<') fail(i >= n ? 'the file has no XML element' : 'text before the root element')

  const stack: XElement[] = []
  let root: XElement | null = null
  while (i < n) {
    if (src[i] === '<') {
      if (startsWith('</')) {
        i += 2
        const name = readName()
        skipSpace()
        if (src[i] !== '>') fail('expected ">"')
        i++
        const open = stack.pop()
        if (!open) fail(`unexpected closing tag </${name}>`)
        if (open!.name !== name) fail(`closing tag </${name}> does not match <${open!.name}> (line ${open!.line})`)
        if (!stack.length) break
        continue
      }
      if (startsWith('<!--')) {
        const end = src.indexOf('-->', i + 4)
        if (end < 0) fail('unterminated comment')
        if (!stack.length) fail('comment outside the root element')
        stack[stack.length - 1].children.push({ type: 'comment', text: src.slice(i + 4, end) })
        i = end + 3
        continue
      }
      if (startsWith('<![CDATA[')) {
        const end = src.indexOf(']]>', i + 9)
        if (end < 0) fail('unterminated CDATA section')
        if (!stack.length) fail('CDATA outside the root element')
        pushText(stack[stack.length - 1], src.slice(i + 9, end))
        i = end + 3
        continue
      }
      if (startsWith('<?')) {
        const end = src.indexOf('?>', i + 2)
        if (end < 0) fail('unterminated processing instruction')
        i = end + 2
        continue
      }
      if (startsWith('<!')) fail('unexpected declaration')
      const tagStart = i
      i++
      const name = readName()
      const el: XElement = { type: 'element', name, attrs: [], children: [], line: lineOf(tagStart) }
      for (;;) {
        const before = i
        skipSpace()
        if (i >= n) fail(`unterminated start tag <${name}>`, tagStart)
        if (src[i] === '>' || startsWith('/>')) break
        if (i === before) fail('expected whitespace between attributes')
        const aname = readName()
        skipSpace()
        if (src[i] !== '=') fail(`attribute "${aname}" has no value`)
        i++
        skipSpace()
        const q = src[i]
        if (q !== '"' && q !== "'") fail(`attribute "${aname}" value must be quoted`)
        const end = src.indexOf(q, i + 1)
        if (end < 0) fail(`unterminated attribute "${aname}"`)
        const raw = src.slice(i + 1, end)
        if (raw.indexOf('<') >= 0) fail(`"<" in attribute "${aname}"`, i + 1 + raw.indexOf('<'))
        if (el.attrs.some((a) => a[0] === aname)) fail(`duplicate attribute "${aname}"`)
        // Attribute-value normalisation: literal tabs and line breaks become spaces.
        el.attrs.push([aname, decode(raw.replace(/\r\n|[\t\n\r]/g, ' '), i)])
        i = end + 1
      }
      if (stack.length) stack[stack.length - 1].children.push(el)
      else root = el
      if (startsWith('/>')) {
        i += 2
        if (!stack.length) break
      } else {
        i++
        stack.push(el)
      }
      continue
    }
    // character data
    const next = src.indexOf('<', i)
    const end = next < 0 ? n : next
    if (!stack.length) fail('text outside the root element')
    const raw = src.slice(i, end)
    if (raw.indexOf(']]>') >= 0) fail('"]]>" in text', i + raw.indexOf(']]>'))
    pushText(stack[stack.length - 1], decode(raw.replace(/\r\n?/g, '\n'), i))
    i = end
  }
  if (stack.length) fail(`<${stack[stack.length - 1].name}> (line ${stack[stack.length - 1].line}) is not closed`, n)
  if (!root) fail('the file has no XML element')
  skipMisc(false)
  if (i < n) fail('content after the root element')
  return root!
}

function pushText(parent: XElement, text: string): void {
  const last = parent.children[parent.children.length - 1]
  if (last && last.type === 'text') last.text += text
  else parent.children.push({ type: 'text', text })
}

// ---------------------------------------------------------------------------------------------
// Helpers

export function attr(el: XElement, name: string): string | undefined {
  for (const a of el.attrs) if (a[0] === name) return a[1]
  return undefined
}

export function setAttr(el: XElement, name: string, value: string): void {
  for (const a of el.attrs) {
    if (a[0] === name) {
      a[1] = value
      return
    }
  }
  el.attrs.push([name, value])
}

export function removeAttr(el: XElement, name: string): void {
  const k = el.attrs.findIndex((a) => a[0] === name)
  if (k >= 0) el.attrs.splice(k, 1)
}

export function elements(el: XElement, name?: string): XElement[] {
  const out: XElement[] = []
  for (const c of el.children) if (c.type === 'element' && (name == null || c.name === name)) out.push(c)
  return out
}

export function child(el: XElement, name: string): XElement | undefined {
  for (const c of el.children) if (c.type === 'element' && c.name === name) return c
  return undefined
}

export function cloneNode<T extends XNode>(node: T): T {
  if (node.type !== 'element') return { ...node }
  const el = node as XElement
  return { type: 'element', name: el.name, attrs: el.attrs.map((a) => [a[0], a[1]]), children: el.children.map(cloneNode), line: el.line } as XElement as T
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')

/** Writes the tree as XML. Whitespace-only text is dropped and elements are indented. */
export function serializeXml(root: XElement, indent = '  '): string {
  const out: string[] = ['<?xml version="1.0" encoding="utf-8"?>\n']
  const write = (el: XElement, depth: number) => {
    const pad = indent.repeat(depth)
    let open = `${pad}<${el.name}`
    for (const [k, v] of el.attrs) open += ` ${k}="${escAttr(v)}"`
    const kids = el.children.filter((c) => !(c.type === 'text' && !c.text.trim()))
    if (!kids.length) {
      out.push(open + '/>\n')
      return
    }
    if (kids.every((c) => c.type === 'text')) {
      out.push(`${open}>${escText(kids.map((c) => (c as XText).text).join(''))}</${el.name}>\n`)
      return
    }
    out.push(open + '>\n')
    for (const c of kids) {
      if (c.type === 'element') write(c, depth + 1)
      else if (c.type === 'comment') out.push(`${pad}${indent}<!--${c.text}-->\n`)
      else out.push(`${pad}${indent}${escText(c.text.trim())}\n`)
    }
    out.push(`${pad}</${el.name}>\n`)
  }
  write(root, 0)
  return out.join('')
}
