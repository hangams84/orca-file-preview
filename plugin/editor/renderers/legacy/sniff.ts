/** Fallback readers for legacy-suffixed files whose bytes are another format: OOXML text parts,
 *  HTML ("Web page" saved as .doc) and plain text. All produce the shared DocModel. */
import type { Block, DocModel, Paragraph, Run } from './model.ts'
import { listZip, readZipText } from './zip.ts'

export function looksLikeHtml(b: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(b.subarray(0, 1024)).replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart().toLowerCase()
  return /^(<!doctype html|<html|<\?xml[^>]*>\s*<html|<head|<body|<meta|<!--)/.test(head) || head.includes('<html')
}

export function looksLikeMime(b: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(b.subarray(0, 512)).toLowerCase()
  return head.includes('mime-version:') && head.includes('multipart/related')
}

const el = (n: Element, local: string) => [...n.children].filter((c) => c.localName === local)

/** word/document.xml of a .docx: paragraphs, runs, tables. */
export async function readDocxText(bytes: Uint8Array): Promise<DocModel> {
  const entries = listZip(bytes)
  const xml = await readZipText(bytes, entries, 'word/document.xml')
  if (xml == null) throw new Error('no word/document.xml')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const body = doc.getElementsByTagNameNS('*', 'body')[0]
  if (!body) throw new Error('no body')
  const para = (p: Element): Paragraph => {
    const out: Paragraph = { kind: 'p', runs: [] }
    const ppr = el(p, 'pPr')[0]
    const style = ppr && el(ppr, 'pStyle')[0]?.getAttributeNS(ppr.namespaceURI, 'val')
    if (style) {
      const m = /heading\s*(\d)/i.exec(style)
      if (m) out.heading = Math.min(6, Number(m[1]))
      else if (/^title$/i.test(style)) out.heading = 0
      else if (/list/i.test(style)) out.list = true
    }
    if (ppr && el(ppr, 'numPr').length) out.list = true
    const walk = (n: Element) => {
      for (const c of n.children) {
        if (c.localName === 'r') {
          const rpr = el(c, 'rPr')[0]
          const on = (tag: string) => {
            const x = rpr && el(rpr, tag)[0]
            if (!x) return false
            const v = x.getAttributeNS(x.namespaceURI, 'val')
            return v == null || !/^(0|false|none)$/.test(v)
          }
          const run: Run = { text: '', b: on('b'), i: on('i'), u: on('u') }
          for (const t of c.children) {
            if (t.localName === 't') run.text += t.textContent ?? ''
            else if (t.localName === 'tab') run.text += '\t'
            else if (t.localName === 'br' || t.localName === 'cr') run.text += '\n'
            else if (t.localName === 'drawing' || t.localName === 'pict') out.runs.push({ text: '', object: 'picture' })
          }
          if (run.text) out.runs.push(run)
        } else if (c.localName === 'hyperlink' || c.localName === 'ins' || c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'sdtContent' || c.localName === 'fldSimple') walk(c)
      }
    }
    walk(p)
    return out
  }
  const blocks = (parent: Element): Block[] => {
    const out: Block[] = []
    for (const c of parent.children) {
      if (c.localName === 'p') out.push(para(c))
      else if (c.localName === 'tbl')
        out.push({ kind: 'table', rows: el(c, 'tr').map((r) => el(r, 'tc').map((tc) => blocks(tc))) })
      else if (c.localName === 'sdt') out.push(...blocks(el(c, 'sdtContent')[0] ?? c))
    }
    return out
  }
  return { blocks: blocks(body), variant: 'DOCX', warnings: ['docx'] }
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TITLE'])

/** Text structure of an HTML file; scripts never run (DOMParser documents are inert). */
export function readHtmlText(bytes: Uint8Array, decode: (b: Uint8Array) => string): DocModel {
  const doc = new DOMParser().parseFromString(decode(bytes), 'text/html')
  doc.querySelectorAll('script, style, noscript, template, head').forEach((n) => n.remove())
  const out: Block[] = []
  let runs: Run[] = []
  const flush = (tag?: string) => {
    const text = runs.map((r) => r.text).join('')
    if (text.trim()) {
      const p: Paragraph = { kind: 'p', runs }
      const m = tag && /^H(\d)$/.exec(tag)
      if (m) p.heading = Number(m[1])
      if (tag === 'LI') p.list = true
      out.push(p)
    }
    runs = []
  }
  const walk = (n: Node, b: boolean, i: boolean) => {
    for (const c of n.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) {
        const t = (c.textContent ?? '').replace(/\s+/g, ' ')
        if (t) runs.push({ text: t, b, i })
        continue
      }
      if (!(c instanceof Element)) continue
      const tag = c.tagName
      if (tag === 'BR') runs.push({ text: '\n' })
      else if (tag === 'TABLE') {
        flush()
        const rows: Block[][][] = []
        for (const tr of c.querySelectorAll('tr')) {
          rows.push([...tr.children].map((td) => [{ kind: 'p', runs: [{ text: (td.textContent ?? '').replace(/\s+/g, ' ').trim() }] } as Paragraph]))
        }
        if (rows.length) out.push({ kind: 'table', rows })
      } else if (BLOCK_TAGS.has(tag)) {
        flush()
        walk(c, b || /^H\d$/.test(tag), i)
        flush(tag)
      } else walk(c, b || tag === 'B' || tag === 'STRONG', i || tag === 'I' || tag === 'EM')
    }
  }
  walk(doc.body ?? doc.documentElement, false, false)
  flush()
  return { blocks: out, variant: 'HTML', warnings: ['html'] }
}

export function readPlainText(text: string, variant: string): DocModel {
  const blocks: Block[] = text
    .split(/\r\n|\r|\n/)
    .map((line) => ({ kind: 'p', runs: [{ text: line }] }) as Paragraph)
  return { blocks, variant, warnings: ['text'] }
}
