/** Generic inspector for a registered file that its parser cannot read: what the bytes look like
 *  (signature, container), size, a hex dump of the start and the readable strings, instead of a
 *  bare error. Also lists the streams of OLE compound files and the entries of 7z / ZIP archives. */
import { formatBytes } from '../../core/i18n.ts'
import type { PreviewContext } from '../../core/types.ts'
import { h } from '../../core/ui.ts'
import { isCfb, readCfb } from '../legacy/cfb.ts'
import { is7z } from './sevenzip.ts'
import { collapsible, createPage, heading, kvTable, note, tree, type TreeEntry } from './view.ts'

export interface Identified {
  /** Short name such as "7z archive". */
  name: string
  /** Extra detail (version, variant). */
  detail?: string
  mime?: string
}

const ascii = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.subarray(s, Math.min(e, b.length)))

/** Identifies common containers and file types by their leading bytes. */
export function identify(b: Uint8Array): Identified {
  const at = (sig: number[], o = 0) => sig.every((v, i) => b[o + i] === v)
  if (is7z(b)) return { name: '7z archive', detail: `format ${b[6]}.${b[7]}` }
  if (at([0x50, 0x4b, 0x03, 0x04]) || at([0x50, 0x4b, 0x05, 0x06])) return { name: 'ZIP archive' }
  if (isCfb(b)) return { name: 'OLE compound file (CFB)', detail: `version ${b[0x1a] | (b[0x1b] << 8)}` }
  if (b.length > 64 && b[4] === 0 && b[5] === 0 && b[6] === 0 && b[7] === 4) return { name: 'SolidWorks 2015+ container (probable)' }
  if (at([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return { name: 'RAR archive' }
  if (at([0x1f, 0x8b])) return { name: 'gzip data' }
  if (at([0x42, 0x5a, 0x68])) return { name: 'bzip2 data' }
  if (at([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return { name: 'xz data' }
  if (ascii(b, 0, 5) === '%PDF-') return { name: 'PDF document', detail: ascii(b, 5, 8), mime: 'application/pdf' }
  if (at([0x89, 0x50, 0x4e, 0x47])) return { name: 'PNG image', mime: 'image/png' }
  if (at([0xff, 0xd8, 0xff])) return { name: 'JPEG image', mime: 'image/jpeg' }
  if (ascii(b, 0, 16) === 'SQLite format 3\u0000') return { name: 'SQLite database' }
  if (at([0x00, 0x01, 0x00, 0x00]) && ascii(b, 4, 19) === 'Standard Jet DB') return { name: 'Microsoft Access (Jet) database' }
  if (ascii(b, 4, 19) === 'Standard ACE DB') return { name: 'Microsoft Access (ACE) database' }
  if (at([0xff, 0xfe]) || at([0xfe, 0xff])) return { name: 'UTF-16 text' }
  const head = new TextDecoder('utf-8').decode(b.subarray(0, 512)).replace(/^﻿/, '').trimStart()
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const root = /<([A-Za-z_][\w:.-]*)[\s>]/.exec(head.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, ''))
    if (root?.[1] === 'EplanPxfRoot') return { name: 'EPLAN PXF XML', detail: /Type="([^"]*)"/.exec(head)?.[1] }
    return { name: 'XML document', detail: root ? `<${root[1]}>` : undefined }
  }
  let printable = 0
  const n = Math.min(b.length, 4096)
  for (let i = 0; i < n; i++) if ((b[i] >= 0x20 && b[i] < 0x7f) || b[i] === 9 || b[i] === 10 || b[i] === 13 || b[i] >= 0x80) printable++
  if (n > 0 && printable / n > 0.97) return { name: 'Text' }
  return { name: 'Unknown binary data' }
}

/** Classic hex dump: offset, 16 bytes, ASCII. */
export function hexDump(b: Uint8Array, length = 512, start = 0): string {
  const lines: string[] = []
  const end = Math.min(b.length, start + length)
  for (let o = start; o < end; o += 16) {
    const row = b.subarray(o, Math.min(o + 16, end))
    const hex = Array.from(row, (x) => x.toString(16).padStart(2, '0')).join(' ')
    const text = Array.from(row, (x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('')
    lines.push(`${o.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${text}`)
  }
  return lines.join('\n')
}

/** ASCII and UTF-16LE strings of at least `min` characters, in file order (deduplicated). */
export function readableStrings(b: Uint8Array, min = 6, max = 300, scanBytes = 4 * 1024 * 1024): string[] {
  const found: { at: number; s: string }[] = []
  const seen = new Set<string>()
  const end = Math.min(b.length, scanBytes)
  const keep = (at: number, s: string) => {
    s = s.trim()
    if (s.length < min || seen.has(s)) return
    seen.add(s)
    found.push({ at, s })
  }
  let start = -1
  for (let i = 0; i <= end; i++) {
    const c = i < end ? b[i] : 0
    const ok = (c >= 0x20 && c < 0x7f) || c === 9
    if (ok && start < 0) start = i
    else if (!ok && start >= 0) {
      if (i - start >= min) keep(start, ascii(b, start, Math.min(i, start + 200)))
      start = -1
    }
    if (found.length > max * 4) break
  }
  start = -1
  for (let i = 0; i + 1 <= end; i += 2) {
    const c = i + 1 < end ? b[i] | (b[i + 1] << 8) : 0
    const ok = c >= 0x20 && c !== 0x7f && c < 0xd800 && !(c >= 0x80 && c < 0xa0)
    if (ok && start < 0) start = i
    else if (!ok && start >= 0) {
      // Random bytes decode as runs of CJK: keep a UTF-16 run only when most of it is ASCII.
      let asciiChars = 0
      for (let k = start; k < i; k += 2) if (b[k + 1] === 0) asciiChars++
      if ((i - start) / 2 >= min && asciiChars * 2 >= (i - start) * 0.6) keep(start, new TextDecoder('utf-16le').decode(b.subarray(start, Math.min(i, start + 400))))
      start = -1
    }
    if (found.length > max * 4) break
  }
  return found
    .sort((a, b2) => a.at - b2.at)
    .slice(0, max)
    .map((f) => f.s)
}

/** Shannon entropy in bits per byte of a sample (8 = random or compressed). */
export function entropy(b: Uint8Array, sample = 1 << 20): number {
  const n = Math.min(b.length, sample)
  if (!n) return 0
  const counts = new Uint32Array(256)
  for (let i = 0; i < n; i++) counts[b[i]]++
  let e = 0
  for (const c of counts) {
    if (!c) continue
    const p = c / n
    e -= p * Math.log2(p)
  }
  return e
}

/** Renders the inspector page. `reason` says why the real viewer could not be used. */
export async function renderInspector(ctx: PreviewContext, formatName: string, reason?: string, extra?: (panel: HTMLElement) => void): Promise<void> {
  const { bytes, tr } = ctx
  const id = identify(bytes)
  ctx.toolbar.info(`${id.name} · ${formatBytes(bytes.byteLength)}`)
  createPage(ctx, [
    {
      id: 'summary',
      label: tr('파일 정보', 'File info'),
      build(panel) {
        panel.append(
          note(
            reason
              ? tr(`${formatName} 파일로 읽을 수 없어 일반 정보만 보여 줍니다. 이유: ${reason}`, `This file could not be read as ${formatName}, so only general information is shown. Reason: ${reason}`)
              : tr(`${formatName} 파일의 내용은 해석할 수 없어 일반 정보만 보여 줍니다.`, `The contents of this ${formatName} file cannot be interpreted, so only general information is shown.`),
            'warn'
          ),
          kvTable([
            [tr('형식', 'Format'), id.detail ? `${id.name} (${id.detail})` : id.name],
            [tr('확장자', 'Suffix'), `.${ctx.fileType}`],
            [tr('크기', 'Size'), `${formatBytes(bytes.byteLength)} (${bytes.byteLength.toLocaleString('en-US')} bytes)`],
            [tr('엔트로피', 'Entropy'), `${entropy(bytes).toFixed(2)} bits/byte${entropy(bytes) > 7.5 ? tr(' (압축 또는 암호화된 데이터로 보임)', ' (looks compressed or encrypted)') : ''}`]
          ])
        )
        extra?.(panel)
        if (isCfb(bytes)) {
          try {
            const cfb = readCfb(bytes)
            const rows: TreeEntry[] = []
            const walk = (path: string, depth: number) => {
              if (depth > 8) return
              for (const name of cfb.list?.(path) ?? []) {
                const full = path ? `${path}/${name}` : name
                const s = cfb.open?.(full)
                if (s) rows.push({ path: full, size: s.length })
                else {
                  rows.push({ path: full, size: 0, dir: true })
                  walk(full, depth + 1)
                }
              }
            }
            walk('', 0)
            panel.append(heading(tr(`복합 파일 스트림 (${rows.filter((r) => !r.dir).length})`, `Compound file streams (${rows.filter((r) => !r.dir).length})`)), tree(rows, tr, 1))
          } catch (e) {
            panel.append(note(tr(`복합 파일 구조를 읽지 못했습니다: ${(e as Error).message}`, `The compound file structure could not be read: ${(e as Error).message}`), 'warn'))
          }
        }
        const strings = readableStrings(bytes)
        panel.append(heading(tr('파일 시작 부분 (16진수)', 'Start of the file (hex)')))
        const pre = h('pre', 'fp-prop-hex', hexDump(bytes, 512))
        panel.append(pre)
        if (strings.length) {
          const ul = h('pre', 'fp-prop-hex', strings.join('\n'))
          ul.style.whiteSpace = 'pre-wrap'
          panel.append(collapsible(tr(`읽을 수 있는 문자열 ${strings.length}개`, `${strings.length} readable strings`), ul, true))
        }
      }
    }
  ])
}
