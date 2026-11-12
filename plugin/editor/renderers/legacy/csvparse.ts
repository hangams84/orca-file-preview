/** RFC 4180 CSV parsing (quotes, doubled quotes, embedded newlines, CRLF / LF / CR) with a
 *  lenient fallback for stray quotes, plus delimiter detection. */

export const DELIMITERS = [',', ';', '\t', '|'] as const

/** Parses rows from `text[start..]`, at most `limit` rows. Returns the rows and where it stopped. */
export function parseChunk(text: string, delim: string, start: number, limit: number): { rows: string[][]; next: number } {
  const rows: string[][] = []
  const n = text.length
  const d = delim.charCodeAt(0)
  let i = start
  while (i < n && rows.length < limit) {
    const row: string[] = []
    for (;;) {
      let field = ''
      if (text.charCodeAt(i) === 34) {
        // quoted field
        i++
        let segStart = i
        for (;;) {
          const q = text.indexOf('"', i)
          if (q < 0) {
            field += text.slice(segStart)
            i = n
            break
          }
          if (text.charCodeAt(q + 1) === 34) {
            field += text.slice(segStart, q + 1)
            i = q + 2
            segStart = i
            continue
          }
          field += text.slice(segStart, q)
          i = q + 1
          break
        }
        // lenient: characters after the closing quote up to the delimiter belong to the field
        let j = i
        while (j < n) {
          const c = text.charCodeAt(j)
          if (c === d || c === 10 || c === 13) break
          j++
        }
        if (j > i) field += text.slice(i, j)
        i = j
      } else {
        let j = i
        while (j < n) {
          const c = text.charCodeAt(j)
          if (c === d || c === 10 || c === 13) break
          j++
        }
        field = text.slice(i, j)
        i = j
      }
      row.push(field)
      if (i >= n) break
      const c = text.charCodeAt(i)
      if (c === d) {
        i++
        if (i >= n) {
          row.push('')
          break
        }
        continue
      }
      // newline
      i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1
      break
    }
    rows.push(row)
  }
  return { rows, next: i }
}

/** Picks the delimiter whose field counts are most consistent over the first rows. */
export function detectDelimiter(text: string, preferred: string): string {
  const sample = text.slice(0, 64 * 1024)
  let best = preferred
  let bestScore = -1
  for (const d of DELIMITERS) {
    const { rows } = parseChunk(sample, d, 0, 60)
    if (rows.length > 1 && sample.length >= 64 * 1024) rows.pop() // last row may be cut
    const counts = rows.map((r) => r.length).filter((c) => c > 0)
    if (!counts.length) continue
    const freq = new Map<number, number>()
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1)
    let mode = 1
    let modeN = 0
    for (const [c, k] of freq) if (k > modeN || (k === modeN && c > mode)) [mode, modeN] = [c, k]
    if (mode < 2) continue
    const score = (modeN / counts.length) * 1000 + Math.min(mode, 50) + (d === preferred ? 0.5 : 0)
    if (score > bestScore) [best, bestScore] = [d, score]
  }
  return best
}

/** Applied to trimmed cells only, so there are no whitespace runs at either end to backtrack over. */
const NUM = /^[-+]?(?:[$€£¥₩] ?)?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][-+]?\d+)? ?%?$/
/** Longer cells are never treated as numbers (and never reach the regex). */
const MAX_NUMERIC_LENGTH = 64

export function isNumeric(s: string): boolean {
  if (s === '' || s.length > MAX_NUMERIC_LENGTH * 4) return false
  const t = s.trim()
  return t !== '' && t.length <= MAX_NUMERIC_LENGTH && /\d/.test(t) && NUM.test(t)
}

export function toNumber(s: string): number {
  return Number(s.replace(/[\s,$€£¥₩%]/g, ''))
}

/** First row looks like a header: no numbers in it while some column below has numbers, or
 *  all distinct non-empty labels. */
export function guessHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false
  const head = rows[0]
  if (head.some((c) => isNumeric(c))) return false
  const body = rows.slice(1, 30)
  const numericBelow = head.some((_, k) => body.filter((r) => isNumeric(r[k] ?? '')).length > body.length / 2)
  if (numericBelow) return true
  const labels = head.map((c) => c.trim())
  return labels.every((c) => c !== '') && new Set(labels).size === labels.length
}
