/** Hangul font names to CSS font stacks with Korean fallbacks for machines without Hancom fonts.
 *
 *  Hangul places a line's baseline at 85 % of the text height: the em box sits exactly on the line.
 *  Browsers size text boxes from each font's own ascent / descent, which for most Korean fonts is
 *  taller (ascent ≈ 1.05 em), so glyph boxes would start ~2 pt above Hangul's line top. Every face
 *  is therefore used through a local() alias with Hangul's metrics (ascent 85 %, descent 15 %, no
 *  line gap); the glyphs are the installed font's, only the vertical box changes. */

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

const clean = (face: string): string => face.replace(/["\\;{}<>]/g, '').trim()
function quote(face: string): string {
  return '"' + clean(face) + '"'
}

/** Installed fonts used when the document's own fonts are missing, by local() name. */
const SERIF_LOCAL = {
  regular: ['함초롬바탕', 'HCR Batang', 'HCRBatang', '한컴바탕', 'Noto Serif KR', 'NotoSerifKR-Regular', 'Noto Serif CJK KR', 'NotoSerifCJKkr-Regular', 'Source Han Serif K', 'Batang', '바탕', 'AppleMyungjo', 'NanumMyeongjo', '나눔명조'],
  bold: ['HCR Batang Bold', 'HCRBatang-Bold', '함초롬바탕 Bold', 'Noto Serif KR Bold', 'NotoSerifKR-Bold', 'Noto Serif CJK KR Bold', 'NotoSerifCJKkr-Bold', 'NanumMyeongjoBold', 'NanumMyeongjo Bold']
}
const SANS_LOCAL = {
  regular: ['함초롬돋움', 'HCR Dotum', 'HCRDotum', '한컴돋움', '맑은 고딕', 'Malgun Gothic', 'MalgunGothic', 'Apple SD Gothic Neo', 'AppleSDGothicNeo-Regular', 'Noto Sans KR', 'NotoSansKR-Regular', 'Noto Sans CJK KR', 'NotoSansCJKkr-Regular', 'Source Han Sans K', 'NanumGothic', '나눔고딕', 'Dotum', '돋움'],
  bold: ['HCR Dotum Bold', 'HCRDotum-Bold', '함초롬돋움 Bold', '맑은 고딕 Bold', 'Malgun Gothic Bold', 'MalgunGothicBold', 'AppleSDGothicNeo-Bold', 'Noto Sans KR Bold', 'NotoSansKR-Bold', 'Noto Sans CJK KR Bold', 'NotoSansCJKkr-Bold', 'NanumGothicBold', 'NanumGothic Bold']
}

const METRICS = 'ascent-override: 85%; descent-override: 15%; line-gap-override: 0%;'

function face(family: string, weight: number, names: string[]): string {
  const src = names.map((n) => `local(${quote(n)})`).join(', ')
  return `@font-face { font-family: ${quote(family)}; src: ${src}; font-weight: ${weight}; font-display: block; ${METRICS} }`
}

/** Collects the faces a document uses and gives each one a stack and a metric-adjusted alias. */
export class FontBook {
  private names = new Map<string, string>()

  private alias(name: string): string {
    const n = clean(name)
    let a = this.names.get(n)
    if (!a) {
      a = `hwp-f${this.names.size}`
      this.names.set(n, a)
    }
    return a
  }

  /** Latin face first (Latin glyphs), then the Hangul face, then the metric-adjusted Korean
   *  fallback and the plain generic stack chosen by the Hangul face's family. */
  stack(latin: string, hangul: string): string {
    const base = hangul || latin
    const mono = MONO_RE.test(base)
    const serif = isSerifFace(base)
    const generic = mono ? MONO_STACK : serif ? SERIF_STACK : SANS_STACK
    const names: string[] = []
    for (const f of [latin, hangul]) {
      if (!f || !clean(f)) continue
      const q = quote(this.alias(f))
      if (!names.includes(q)) names.push(q)
    }
    if (!mono) names.push(serif ? '"hwp-serif"' : '"hwp-sans"')
    return `${names.join(', ')}, ${generic}`
  }

  /** @font-face rules: one alias per document face (regular and bold) and the two fallbacks. */
  css(): string {
    const out: string[] = []
    for (const [name, alias] of this.names) {
      const ps = name.replace(/\s+/g, '')
      out.push(face(alias, 400, [name, `${name} Regular`, `${ps}-Regular`, ps]))
      out.push(face(alias, 700, [`${name} Bold`, `${ps}-Bold`, `${ps}Bold`]))
    }
    out.push(face('hwp-serif', 400, SERIF_LOCAL.regular), face('hwp-serif', 700, SERIF_LOCAL.bold))
    out.push(face('hwp-sans', 400, SANS_LOCAL.regular), face('hwp-sans', 700, SANS_LOCAL.bold))
    return out.join('\n')
  }
}

/** A stack without aliases (tests, one-off use). */
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
