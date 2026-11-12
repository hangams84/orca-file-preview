/** Text decoding with BOM sniffing and a strict UTF-8 attempt before legacy fallbacks. Korean files
 *  saved by Excel or Notepad are often EUC-KR (CP949), so that is the first fallback. */

export interface Decoded {
  text: string
  encoding: string
}

export const FALLBACK_ENCODINGS = ['euc-kr', 'shift_jis', 'gb18030', 'windows-1252'] as const

export function decodeText(bytes: Uint8Array, forced?: string): Decoded {
  if (forced) {
    return { text: new TextDecoder(forced).decode(stripBom(bytes, forced)), encoding: forced }
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }
  const utf16 = sniffUtf16WithoutBom(bytes)
  if (utf16) {
    return { text: new TextDecoder(utf16).decode(bytes), encoding: utf16 }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    // not UTF-8: try legacy code pages, keeping the one with the fewest replacement characters
  }
  let best: Decoded = { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  let bestBad = Number.POSITIVE_INFINITY
  for (const enc of FALLBACK_ENCODINGS) {
    try {
      const text = new TextDecoder(enc).decode(bytes)
      const bad = countReplacement(text)
      if (bad < bestBad) {
        best = { text, encoding: enc }
        bestBad = bad
        if (bad === 0) break
      }
    } catch {
      // encoding not supported by this browser
    }
  }
  return best
}

function stripBom(bytes: Uint8Array, enc: string): Uint8Array {
  if (enc === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3)
  return bytes
}

function countReplacement(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) n++
  return n
}

/** UTF-16 without a BOM: many zero bytes on one parity. */
function sniffUtf16WithoutBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, 4096) & ~1
  if (n < 4) return null
  let evenZero = 0
  let oddZero = 0
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero++
    if (bytes[i + 1] === 0) oddZero++
  }
  const half = n / 2
  if (oddZero > half * 0.4 && evenZero < half * 0.05) return 'utf-16le'
  if (evenZero > half * 0.4 && oddZero < half * 0.05) return 'utf-16be'
  return null
}

/** True when bytes look binary (NUL bytes outside UTF-16), used to refuse a text view of garbage. */
export function looksBinary(bytes: Uint8Array): boolean {
  if (sniffUtf16WithoutBom(bytes)) return false
  const n = Math.min(bytes.length, 8192)
  let ctrl = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return true
    if (b < 9 || (b > 13 && b < 32)) ctrl++
  }
  return n > 0 && ctrl / n > 0.1
}
