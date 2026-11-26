/** MTEXT inline formatting → paragraphs of styled runs. Supports \P (paragraph), \X, \N, \~,
 *  {...} groups, \f/\F (font, bold, italic), \H (height, absolute or "x" relative), \C (ACI colour),
 *  \c (true colour, BGR), \L/\l, \O/\o, \K/\k (underline, overline, strike), \W (width), \S
 *  (stacked fractions shown as a/b), \A \Q \T \p (read and ignored), and %%c/%%d/%%p. */
import type { TextRun } from '../scene.ts'
import { aciColor } from './aci.ts'

export interface MTextStyle {
  h: number
  family?: string
  bold?: boolean
  italic?: boolean
}

export function specialChars(s: string): string {
  if (s.indexOf('%%') < 0) return s
  return s.replace(/%%([cCdDpP%]|\d{3})/g, (_, c: string) => {
    switch (c.toLowerCase()) {
      case 'c':
        return '⌀'
      case 'd':
        return '°'
      case 'p':
        return '±'
      case '%':
        return '%'
      default:
        return String.fromCharCode(parseInt(c, 10))
    }
  })
}

/** TEXT content: %%u / %%o toggle under/overline (applied to the whole string here). */
export function plainText(s: string): { text: string; underline: boolean; overline: boolean } {
  const underline = /%%[uU]/.test(s)
  const overline = /%%[oO]/.test(s)
  return { text: specialChars(s.replace(/%%[uUoOkK]/g, '')), underline, overline }
}

export function parseMText(src: string, base: MTextStyle, aci?: (i: number) => number): TextRun[][] {
  const colorOf = aci ?? aciColor
  const paras: TextRun[][] = [[]]
  type St = Omit<TextRun, 'text'> & { h: number }
  let st: St = { h: base.h, family: base.family, bold: base.bold, italic: base.italic }
  const stack: St[] = []
  let buf = ''
  const flush = () => {
    if (!buf) return
    paras[paras.length - 1].push({ ...st, text: specialChars(buf) })
    buf = ''
  }
  const newPara = () => {
    flush()
    paras.push([])
  }
  const s = src
  let i = 0
  const readTo = (end: string): string => {
    const j = s.indexOf(end, i)
    const v = j < 0 ? s.slice(i) : s.slice(i, j)
    i = j < 0 ? s.length : j + 1
    return v
  }
  while (i < s.length) {
    const ch = s[i]
    if (ch === '{') {
      flush()
      stack.push({ ...st })
      i++
      continue
    }
    if (ch === '}') {
      flush()
      st = stack.pop() ?? st
      i++
      continue
    }
    if (ch === '\\' && i + 1 < s.length) {
      const c = s[i + 1]
      i += 2
      switch (c) {
        case 'P':
        case 'X':
        case 'N':
          newPara()
          break
        case '~':
          buf += ' '
          break
        case '\\':
        case '{':
        case '}':
          buf += c
          break
        case 'f':
        case 'F': {
          flush()
          const v = readTo(';')
          const parts = v.split('|')
          const name = parts[0].replace(/\.(shx|ttf|ttc|otf)$/i, '').trim()
          if (name) st.family = c === 'F' ? undefined : name
          for (const p of parts.slice(1)) {
            if (p[0] === 'b') st.bold = p[1] === '1'
            if (p[0] === 'i') st.italic = p[1] === '1'
          }
          break
        }
        case 'H': {
          flush()
          const v = readTo(';')
          const m = /^([\d.]+)(x?)$/i.exec(v.trim())
          if (m) {
            const f = parseFloat(m[1])
            if (f > 0) st.h = m[2] ? st.h * f : f
          }
          break
        }
        case 'C': {
          flush()
          const v = parseInt(readTo(';'), 10)
          if (v === 0 || v === 256) delete st.color
          else if (v > 0 && v < 256) st.color = v === 7 ? -1 : colorOf(v)
          break
        }
        case 'c': {
          flush()
          const v = parseInt(readTo(';'), 10)
          if (Number.isFinite(v)) st.color = ((v & 255) << 16) | (v & 0xff00) | ((v >> 16) & 255)
          break
        }
        case 'W': {
          flush()
          const f = parseFloat(readTo(';'))
          if (f > 0) st.wf = f
          break
        }
        case 'L':
          flush()
          st.underline = true
          break
        case 'l':
          flush()
          st.underline = false
          break
        case 'O':
          flush()
          st.overline = true
          break
        case 'o':
          flush()
          st.overline = false
          break
        case 'K':
          flush()
          st.strike = true
          break
        case 'k':
          flush()
          st.strike = false
          break
        case 'S': {
          const v = readTo(';')
          const m = /^(.*?)[\^/#](.*)$/.exec(v)
          buf += m ? (m[2].trim() ? `${m[1].trim()}/${m[2].trim()}` : m[1].trim()) : v
          break
        }
        case 'A':
        case 'Q':
        case 'T':
        case 'p':
          readTo(';')
          break
        default:
          // Unknown escape: keep the character.
          buf += c
      }
      continue
    }
    buf += ch
    i++
  }
  flush()
  return paras
}
