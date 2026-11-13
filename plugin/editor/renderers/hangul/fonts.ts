/** Hangul font names to CSS font stacks with Korean fallbacks for machines without Hancom fonts. */

export const SERIF_STACK =
  '"함초롬바탕", "HCR Batang", "한컴바탕", "Noto Serif KR", "Noto Serif CJK KR", "Source Han Serif K", "Batang", "바탕", "BatangChe", "AppleMyungjo", "Nanum Myeongjo", "나눔명조", serif'
export const SANS_STACK =
  '"함초롬돋움", "HCR Dotum", "한컴돋움", "맑은 고딕", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Source Han Sans K", "NanumGothic", "나눔고딕", "Dotum", "돋움", sans-serif'
const MONO_STACK = '"D2Coding", "Nanum Gothic Coding", "Consolas", "Menlo", monospace'

const SERIF_RE = /바탕|명조|궁서|Batang|Myeong|Myungjo|Gungsuh|Mincho|Song|serif|Times|Georgia|Cambria|Garamond|Book ?Antiqua|Palatino|신명|한양신|휴먼명조|HY.*[MS]$/i
const MONO_RE = /Coding|Mono|Courier|Consolas|고정폭/i

export function isSerifFace(face: string): boolean {
  if (/sans|gothic|고딕|돋움|굴림|Dotum|Gulim/i.test(face)) return false
  return SERIF_RE.test(face)
}

function quote(face: string): string {
  return '"' + face.replace(/["\\;{}<>]/g, '').trim() + '"'
}

/** Latin face first (Latin glyphs), then the Hangul face, then the generic Korean stack chosen by
 *  the Hangul face's family. */
export function fontStack(latin: string, hangul: string): string {
  const base = hangul || latin
  const generic = MONO_RE.test(base) ? MONO_STACK : isSerifFace(base) ? SERIF_STACK : SANS_STACK
  const names: string[] = []
  for (const f of [latin, hangul]) {
    const q = f && quote(f)
    if (q && q !== '""' && !names.includes(q) && !generic.includes(q)) names.push(q)
  }
  return names.length ? `${names.join(', ')}, ${generic}` : generic
}
