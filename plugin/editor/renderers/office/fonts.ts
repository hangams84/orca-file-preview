/** Office font aliasing. Documents name fonts such as Calibri, Cambria or 맑은 고딕 that are missing
 *  on macOS, Linux and phones, and the browser then falls back to its default serif font. This adds
 *  `@font-face` rules to `document.head` (Chrome ignores @font-face inside a shadow root) that map
 *  each common Office font to the closest locally installed equivalent via `local()`, keeping the
 *  real font first when it exists. Only regular (400) and bold (700) faces are declared; italics
 *  are synthesized from them. A font with no local match is skipped by the browser, which moves on
 *  to the next family in the element's list — so documents also get a generic fallback chain. */

/** A target font's names as `local()` understands them (full name / PostScript name). */
interface Target {
  regular: string[]
  bold: string[]
}

function target(name: string, extra: Partial<Target> = {}): Target {
  const ps = name.replace(/ /g, '')
  return {
    regular: [name, `${name} Regular`, `${ps}-Regular`, ps, ...(extra.regular ?? [])],
    bold: [`${name} Bold`, `${ps}-Bold`, ...(extra.bold ?? [])]
  }
}

const T = {
  calibri: target('Calibri'),
  calibriLight: target('Calibri Light'),
  carlito: target('Carlito'),
  aptos: target('Aptos'),
  segoe: target('Segoe UI', { regular: ['SegoeUI'], bold: ['SegoeUI-Bold'] }),
  helveticaNeue: target('Helvetica Neue', { regular: ['HelveticaNeue'], bold: ['HelveticaNeue-Bold'] }),
  helvetica: target('Helvetica', { bold: ['Helvetica-Bold'] }),
  arial: target('Arial', { regular: ['ArialMT'], bold: ['Arial-BoldMT'] }),
  liberationSans: target('Liberation Sans'),
  arimo: target('Arimo'),
  roboto: target('Roboto'),
  notoSans: target('Noto Sans'),
  dejaVuSans: target('DejaVu Sans', { regular: ['DejaVuSans'], bold: ['DejaVuSans-Bold'] }),
  cambria: target('Cambria'),
  caladea: target('Caladea'),
  georgia: target('Georgia'),
  times: target('Times New Roman', { regular: ['TimesNewRomanPSMT'], bold: ['TimesNewRomanPS-BoldMT'] }),
  liberationSerif: target('Liberation Serif'),
  tinos: target('Tinos'),
  timesMac: target('Times', { regular: ['Times-Roman'], bold: ['Times-Bold'] }),
  notoSerif: target('Noto Serif'),
  courierNew: target('Courier New', { regular: ['CourierNewPSMT'], bold: ['CourierNewPS-BoldMT'] }),
  liberationMono: target('Liberation Mono'),
  cousine: target('Cousine'),
  consolas: target('Consolas'),
  menlo: target('Menlo'),
  courier: target('Courier'),
  dejaVuMono: target('DejaVu Sans Mono', { regular: ['DejaVuSansMono'], bold: ['DejaVuSansMono-Bold'] }),
  malgun: target('Malgun Gothic', { regular: ['맑은 고딕', 'MalgunGothic', 'MalgunGothicRegular'], bold: ['맑은 고딕 Bold', 'MalgunGothicBold'] }),
  appleGothic: target('Apple SD Gothic Neo', { regular: ['AppleSDGothicNeo-Regular'], bold: ['AppleSDGothicNeo-Bold'] }),
  notoSansKr: target('Noto Sans KR', { regular: ['Noto Sans CJK KR', 'NotoSansCJKkr-Regular'], bold: ['Noto Sans CJK KR Bold', 'NotoSansCJKkr-Bold'] }),
  nanumGothic: target('NanumGothic', { regular: ['나눔고딕'], bold: ['NanumGothicBold', 'NanumGothic Bold', '나눔고딕 Bold'] }),
  gulim: target('Gulim', { regular: ['굴림'] }),
  dotum: target('Dotum', { regular: ['돋움'] }),
  batang: target('Batang', { regular: ['바탕'] }),
  gungsuh: target('Gungsuh', { regular: ['궁서'] }),
  appleMyungjo: target('AppleMyungjo'),
  notoSerifKr: target('Noto Serif KR', { regular: ['Noto Serif CJK KR', 'NotoSerifCJKkr-Regular'], bold: ['Noto Serif CJK KR Bold', 'NotoSerifCJKkr-Bold'] }),
  nanumMyeongjo: target('NanumMyeongjo', { regular: ['나눔명조'], bold: ['NanumMyeongjoBold', 'NanumMyeongjo Bold'] })
}

const SANS = [T.carlito, T.segoe, T.helveticaNeue, T.helvetica, T.arial, T.liberationSans, T.arimo, T.roboto, T.notoSans, T.dejaVuSans]
const SERIF = [T.caladea, T.georgia, T.times, T.liberationSerif, T.tinos, T.timesMac, T.notoSerif]
const MONO = [T.consolas, T.menlo, T.courierNew, T.liberationMono, T.cousine, T.dejaVuMono, T.courier]
const KO_SANS = [T.malgun, T.appleGothic, T.notoSansKr, T.nanumGothic]
const KO_SERIF = [T.batang, T.appleMyungjo, T.notoSerifKr, T.nanumMyeongjo]

/** Office font family names (as documents spell them) → candidates, in order. */
const ALIASES: [string[], Target[]][] = [
  [['Calibri'], [T.calibri, ...SANS]],
  [['Calibri Light'], [T.calibriLight, T.calibri, ...SANS]],
  [['Aptos', 'Aptos Display'], [T.aptos, T.calibri, ...SANS]],
  [['Arial', 'Helvetica'], [T.arial, T.helveticaNeue, T.helvetica, T.liberationSans, T.arimo, T.roboto, T.notoSans, T.dejaVuSans]],
  [['Segoe UI', 'Tahoma', 'Verdana'], [T.segoe, ...SANS]],
  [['Cambria', 'Cambria Math'], [T.cambria, ...SERIF]],
  [['Times New Roman', 'Times'], [T.times, T.liberationSerif, T.tinos, T.timesMac, T.georgia, T.notoSerif]],
  [['Georgia', 'Book Antiqua', 'Palatino Linotype', 'Garamond'], [T.georgia, ...SERIF]],
  [['Courier New', 'Courier'], [T.courierNew, T.liberationMono, T.cousine, T.courier, T.menlo, T.consolas, T.dejaVuMono]],
  [['Consolas', 'Lucida Console'], [T.consolas, ...MONO]],
  [['맑은 고딕', 'Malgun Gothic'], [...KO_SANS]],
  [['굴림', 'Gulim', '굴림체', 'GulimChe'], [T.gulim, ...KO_SANS]],
  [['돋움', 'Dotum', '돋움체', 'DotumChe'], [T.dotum, ...KO_SANS]],
  [['나눔고딕', 'NanumGothic'], [T.nanumGothic, ...KO_SANS]],
  [['바탕', 'Batang', '바탕체', 'BatangChe', '함초롬바탕', 'HCR Batang', '신명조'], [...KO_SERIF]],
  [['궁서', 'Gungsuh', '궁서체', 'GungsuhChe'], [T.gungsuh, ...KO_SERIF]],
  [['나눔명조', 'NanumMyeongjo'], [T.nanumMyeongjo, ...KO_SERIF]],
  [['함초롬돋움', 'HCR Dotum'], [...KO_SANS]]
]

const q = (s: string) => `"${s.replace(/["\\]/g, '')}"`

function faceRules(): string {
  const out: string[] = []
  for (const [names, targets] of ALIASES) {
    const regular = [...new Set(targets.flatMap((t) => t.regular))].map((n) => `local(${q(n)})`).join(', ')
    const bold = [...new Set(targets.flatMap((t) => t.bold))].map((n) => `local(${q(n)})`).join(', ')
    for (const name of names) {
      out.push(`@font-face { font-family: ${q(name)}; font-weight: 100 599; src: ${regular}; }`)
      out.push(`@font-face { font-family: ${q(name)}; font-weight: 600 900; src: ${bold}; }`)
    }
  }
  return out.join('\n')
}

/** Generic chains appended after a document's own font names. */
export const OFFICE_SANS =
  '"Segoe UI", "Helvetica Neue", Helvetica, Arial, "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", NanumGothic, Roboto, "Noto Sans", sans-serif'
export const OFFICE_SERIF =
  'Cambria, Georgia, "Times New Roman", "Batang", AppleMyungjo, "Noto Serif KR", "Noto Serif", serif'

/** Adds the alias rules to `document.head` once. */
export function installOfficeFonts(): void {
  if (document.getElementById('fp-office-fonts')) return
  const style = document.createElement('style')
  style.id = 'fp-office-fonts'
  style.textContent = faceRules()
  document.head.append(style)
}

const SERIF_HINT = /serif|cambria|times|georgia|garamond|antiqua|palatino|batang|바탕|명조|myeongjo|myungjo|gungsuh|궁서|mincho|song/i

/** Appends a generic fallback chain to a `font-family` value unless it already ends in a generic. */
export function withFallback(family: string): string {
  const v = family.trim().replace(/\s*!important\s*$/, '')
  if (!v) return OFFICE_SANS
  if (/(^|,)\s*(sans-serif|serif|monospace|system-ui)\s*$/i.test(v)) return family
  const important = /!important\s*$/.test(family) ? ' !important' : ''
  // Serif-looking first names keep a serif fallback; var(--docx-…) values cannot be inspected.
  return `${v}, ${SERIF_HINT.test(v.split(',')[0]) ? OFFICE_SERIF : OFFICE_SANS}${important}`
}

/** Rewrites every `font-family:` declaration in CSS text to carry the fallback chain. */
export function patchCssFonts(css: string): string {
  return css.replace(/font-family\s*:\s*([^;}]+)/gi, (_m, v: string) => `font-family: ${withFallback(v)}`)
}
