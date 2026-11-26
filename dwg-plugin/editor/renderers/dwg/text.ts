/** DWG text strings → displayable text: control codes of TEXT (%%d, %%p, %%c, \U+XXXX) and the
 *  formatting codes of MTEXT (\P paragraphs, {\f...;} fonts, \S stacking, ...). Pure (text.test.ts). */

/** `\U+XXXX` escapes (non-ASCII characters in R2000–R2004 strings) to characters. */
function unicodeEscapes(s: string): string {
  return s.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

/** TEXT/ATTRIB control codes: %%d °, %%p ±, %%c ⌀, %%% %, %%nnn character, %%u/%%o (dropped). */
export function decodeControlCodes(s: string): string {
  return unicodeEscapes(s).replace(/%%(\d{3}|[dDpPcC%uUoOkK])/g, (_, c: string) => {
    switch (c.toLowerCase()) {
      case 'd':
        return '°'
      case 'p':
        return '±'
      case 'c':
        return '⌀'
      case '%':
        return '%'
      case 'u':
      case 'o':
      case 'k':
        return ''
      default:
        return String.fromCharCode(parseInt(c, 10))
    }
  })
}

export interface MTextLine {
  text: string
  /** Relative height of the line's first run (\H...x), 1 when unchanged. */
  height: number
}

/** MTEXT contents → lines of plain text (formatting dropped, stacked fractions as a/b). */
export function parseMText(src: string): MTextLine[] {
  const s = unicodeEscapes(src)
  const lines: MTextLine[] = []
  let cur = ''
  let height = 1
  let lineHeight = 0 // first explicit height on this line
  const push = () => {
    lines.push({ text: decodeControlCodes(cur), height: lineHeight || 1 })
    cur = ''
    lineHeight = 0
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '{' || ch === '}') continue
    if (ch === '\n') {
      push()
      continue
    }
    if (ch === '^' && i + 1 < s.length) {
      // caret notation: ^I tab, ^J line feed, ^M carriage return
      const n = s[i + 1]
      if (n === 'I') cur += '    '
      else if (n === 'J') push()
      else if (n !== 'M') cur += ch + n
      i++
      continue
    }
    if (ch !== '\\' || i + 1 >= s.length) {
      cur += ch
      continue
    }
    const code = s[i + 1]
    i++
    switch (code) {
      case 'P':
      case 'N':
      case 'X':
        push()
        break
      case '~':
        cur += ' '
        break
      case '\\':
      case '{':
      case '}':
        cur += code
        break
      case 'L':
      case 'l':
      case 'O':
      case 'o':
      case 'K':
      case 'k':
        break
      case 'H': {
        const end = s.indexOf(';', i)
        const arg = s.slice(i + 1, end < 0 ? s.length : end)
        const v = parseFloat(arg)
        if (v > 0) {
          height = arg.endsWith('x') || arg.endsWith('X') ? height * v : v
          if (!lineHeight && !cur) lineHeight = height
        }
        i = end < 0 ? s.length : end
        break
      }
      case 'S': {
        // stacked text: up to ';' with ^, / or # between numerator and denominator
        const end = s.indexOf(';', i)
        const arg = s.slice(i + 1, end < 0 ? s.length : end)
        const m = arg.match(/^(.*?)[\^/#](.*)$/)
        cur += m ? `${m[1].trim()}/${m[2].trim()}` : arg
        i = end < 0 ? s.length : end
        break
      }
      case 'A':
      case 'C':
      case 'c':
      case 'F':
      case 'f':
      case 'Q':
      case 'T':
      case 'W':
      case 'p': {
        const end = s.indexOf(';', i)
        i = end < 0 ? s.length : end
        break
      }
      case 'M': {
        // \M+nXXXX: a double-byte character in code page n (rare; shown as is when not decodable)
        const m = s.slice(i + 1).match(/^\+\d([0-9a-fA-F]{4})/)
        if (m) {
          cur += decodeMbcs(parseInt(m[1], 16))
          i += m[0].length
        } else cur += '\\M'
        break
      }
      default:
        cur += '\\' + code
    }
  }
  push()
  return lines
}

function decodeMbcs(code: number): string {
  try {
    return new TextDecoder('euc-kr').decode(new Uint8Array([code >> 8, code & 0xff]))
  } catch {
    return '?'
  }
}

/** Plain-text width wrap for MTEXT boxes, by a character-width measure (one call per candidate). */
export function wrapLine(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (!(maxWidth > 0) || measure(text) <= maxWidth) return [text]
  const out: string[] = []
  // break at spaces; CJK text (no spaces) breaks between characters
  const tokens = text.match(/[ᄀ-ᇿ　-鿿가-힯豈-﫿]|\S+\s*|\s+/g) ?? [text]
  let line = ''
  for (const t of tokens) {
    if (line && measure(line + t.trimEnd()) > maxWidth) {
      out.push(line.trimEnd())
      line = t.trimStart()
    } else line += t
  }
  if (line) out.push(line.trimEnd())
  return out.length ? out : [text]
}
