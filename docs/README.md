# File Preview for Orca — 개발 문서 / Development docs

Orca 데스크톱(Windows · macOS · Linux)과 브라우저/모바일 클라이언트에서 Office·PDF·텍스트·이미지 파일을 **읽기 전용으로 미리보기** 하는 Orca 플러그인입니다.

> HTML 버전: [index.html](index.html) · 원본 증빙 자료: [evidence/](evidence/)

## 지원 형식 / Supported formats

| 확장자 | 종류 | 엔진 | 기능 |
| --- | --- | --- | --- |
| .docx | Word | docx-preview (Apache-2.0) + JSZip | Pages, styles, tables, images, lists; zoom / fit width |
| .doc | Word 97-2003 | Own OLE/CFB + piece-table parser | Text, paragraphs, tables, page breaks |
| .pptx | PowerPoint | Own OOXML renderer (fflate) | Positioned text, pictures, tables, fills, notes |
| .ppt | PowerPoint 97-2003 | Own CFB record parser | Per-slide titles and body text, pictures |
| .xlsx .xlsm .xls .ods | Spreadsheets | SheetJS CE 0.20.3 (Apache-2.0) | Sheet picker, merged cells, formatted values, sticky headers |
| .pdf | PDF | pdf.js 6.5 (Apache-2.0) | Lazy page rendering, page navigation, zoom, CJK cMaps |
| .gif .bmp | Images | Browser decoder | Animated GIF, fit / zoom / pinch, dimensions |
| .svg | SVG | Browser <img> (scripts never run) | Zoom, source view |
| .html .htm | HTML | DOMPurify (Apache-2.0 / MPL-2.0) | Sanitised preview, source view, links blocked |
| .csv .tsv | Tables | Own RFC 4180 parser | Encoding + delimiter detection, sort, filter, raw view |
| .txt .log | Text | Own | Encoding detection (UTF-8/16, EUC-KR, …), line numbers, wrap |

## 검증 라운드 요약 / Verification rounds

![pass rate](evidence/charts/pass-rate.svg)

![issues](evidence/charts/issues.svg)

| Round | 날짜 | 커밋 | 정적 검사 | 브라우저 하네스 | Orca 앱 | 발견/수정 |
| --- | --- | --- | --- | --- | --- | --- |
| [1](#round-1) | 2026-11-12 06:03 | `858c111` | 6/6 | 168/168 | 52/52 | 15/14 |
| [2](#round-2) | 2026-11-12 06:33 | `7ed1655` | 7/7 | 168/168 | 52/52 | 18/18 |
| [3](#round-3) | 2026-11-12 07:15 | `9d6ca3a` | 7/8 | 168/168 | 57/58 | 11/9 |
| [4](#round-4) | 2026-11-12 08:02 | `459a5dc` | 8/9 | 220/220 | 66/68 | 14/14 |

### Round 1

커밋 `858c111` · 2026-11-12T06:03:19.387Z · Orca 1.4.257 · win32 x64

| 검사 | 결과 | 상세 |
| --- | --- | --- |
| TypeScript (tsc --noEmit) | ✅ |  |
| orca plugin validate | ✅ |  |
| orca plugin test (unit) | ✅ | passed 5 · failed 0 |
| orca plugin check (static) | ✅ | "" |
| Browser harness (4 profiles) | ✅ | 168 / 168 passed |
| Orca app screenshots (plugin shot) | ✅ | 52 / 52 rendered in Orca; 32 open in Orca's own view first (preview via the view toggle) |

**발견된 문제와 조치 / Issues and fixes**

| ID | 심각도 | 영역 | 문제 | 원인 | 조치 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| R1-1 | medium | pdf | PDF pages blank in Orca captures and in hidden/occluded windows | Orca captures at first paint (mostly a timing artifact); drawing also relied on IntersectionObserver and pdf.js requestAnimationFrame, which pause in hidden windows | Visibility from scroll geometry, rAF-free print-intent fallback, harness --no-raf mode with pixel check (24/24) | fixed |
| R1-2 | medium | sheet | Formula cells without cached values show '=C2*D2' instead of a result | Files written by scripts (openpyxl) store no cached values; SheetJS CE does not calculate | Safe formula evaluator (no eval) for common operators and functions, with unit tests (fp-office) | fixed |
| R1-3 | low | docx/pptx | Body text falls back to a serif font when Office fonts are missing | Documents name Calibri/Cambria/맑은 고딕, which macOS, Linux and phones lack | @font-face local() aliases to metric-compatible or platform fonts (fp-office); note: sample.docx body is Cambria by design, so it stays serif where a Cambria alias exists | fixed |
| R1-4 | medium | build | Plugin folder exceeded Orca's 50 MiB limit | Orca counts the whole folder: node_modules, Orca child worktrees and evidence screenshots | Shipped plugin moved to plugin/ (manifest, editor, vendor only: about 6 MB) | fixed |
| R1-5 | low | tooling | orca plugin test fails: cannot import ./orca-runtime.mjs | Orca's Windows test loader rejects its own runtime when the plugin is on a different drive (D:) than Orca (C:) | verify.mjs runs unit tests from a temporary copy on the system drive | fixed |
| R1-6 | info | orca | txt/csv/tsv/log/html/svg open in Orca's own Source view first | Orca always treats suffixes it opens itself (and text-looking files) as priority 'option' | Documented: switch with the view toggle at the tab's top right; preview editors are registered for these suffixes | documented |
| R1-7 | high | core | A .doc that is really DOCX stayed on the spinner in Orca captures; every file rendered twice | Orca delivers the same document more than once; the dedupe compared object identity | main.ts dedupes by file type and bytes; verify.mjs opens, waits, then captures | fixed |
| R1-8 | medium | ppt | Extra "기타 그림" gallery with a placeholder picture after the last slide | All unplaced blips (thumbnail/master pictures) were shown | Only slide-referenced, decodable pictures (fp-legacy) | fixed |
| R1-9 | low | ppt | PPT 97 slide text smaller and tighter than the same slide elsewhere | Font size / master text style defaults | Read sizes from master text styles (fp-legacy) | fixed |
| R1-10 | low | ppt/doc | Korean glyphs heavier than Latin, lines nearly touch | Font stack without Korean fallbacks | Korean font fallbacks and line-height (fp-legacy) | fixed |
| R1-11 | medium | docx | DOCX unreadable on phones (page fitted at ~43%, ~5 px text) | Fixed page width scaled down to fit | Reading/reflow mode by default on phones (fp-office) | fixed |
| R1-12 | medium | docx | Word table style and cell padding not applied | docx-preview ignores conditional table formatting and default cell margins | CSS fallbacks for header/banding and padding (fp-office) | fixed |
| R1-13 | low | docx | List bullets without hanging indent | Numbering indents not applied | Numbering CSS (fp-office) | fixed |
| R1-14 | low | sheet | Dates cut off in narrow columns | No overflow into empty neighbours | Excel-like overflow / minimum widths (fp-office) | fixed |
| R1-15 | low | sheet | .xls column widths about twice the .xlsx widths | BIFF width unit conversion | Prefer wpx, then wch (fp-office) | fixed |

증빙: [harness](evidence/round-1/harness/) · [orca](evidence/round-1/orca/) · [summary.json](evidence/round-1/summary.json)

### Round 2

커밋 `7ed1655` · 2026-11-12T06:33:40.913Z · Orca 1.4.257 · win32 x64

| 검사 | 결과 | 상세 |
| --- | --- | --- |
| TypeScript (tsc --noEmit) | ✅ |  |
| orca plugin validate | ✅ |  |
| orca plugin test (unit) | ✅ | passed 17 · failed 0 |
| orca plugin check (static) | ✅ | "" |
| Browser harness (4 profiles) | ✅ | 168 / 168 passed |
| Harness without rAF/IntersectionObserver (hidden window) | ✅ | 42 / 42 passed |
| Orca app screenshots (plugin shot) | ✅ | 52 / 52 rendered in Orca; 32 open in Orca's own view first (preview via the view toggle) |

**발견된 문제와 조치 / Issues and fixes**

| ID | 심각도 | 영역 | 문제 | 원인 | 조치 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| R2-1 | high | ppt | Legacy .ppt slides blank in a hidden/occluded window | Slides were built only from IntersectionObserver callbacks; the harness counted 'ready' as a pass | Geometry-based visibility fallback like pdf.ts (fp-legacy); harness now requires visible content for 'ready' | fixed |
| R2-2 | medium | doc (RTF) | RTF character colour and size ignored (red 14pt text shown black) | RTF reader dropped \cfN / \fsN inside groups | Colour table and font size per run (fp-legacy) | fixed |
| R2-3 | low | ppt | Legacy .ppt subtitle colour differs from the .pptx | Not a .ppt bug: the .ppt matches the PDF (#898989); the .pptx tint maths was off (see R2-7) | Covered by R2-7 | fixed |
| R2-4 | low | ppt | Korean run in a .ppt title smaller and not bold | Fixture set only Western font attributes for the Hangul run | Fixture regenerated with East Asian size/weight; renders 32 pt bold | fixed |
| R2-5 | low | pptx/ppt | Slide frames differ between .pptx and .ppt | Two renderers with separate frame styles | One frame style: shadow, no double border, same number badge (fp-office, fp-legacy) | fixed |
| R2-6 | medium | docx | DOCX reading mode: tight table cells, headings flush on content, list indent, large gap at page breaks | Reading-mode CSS drops cell margins and paragraph spacing; page break rendered as a spacer | Reading-mode spacing rules (fp-office) | fixed |
| R2-7 | low | pptx | Tinted theme colours too dark (subtitle #404040 instead of #898989) | Tint applied in RGB instead of PowerPoint's HSL luminance formula | Office colour transforms in linear RGB (tinted tx1 = #898989) with unit tests | fixed |
| R2-8 | low | pptx | Shape labels cross the shape outline (chevron, triangle) | Text placed in the bounding box, not the preset's text rectangle | Preset text insets (fp-office) | fixed |
| R2-9 | low | sheet | Formula indicator marks poke past cell borders | Overlay positioned outside the cell | Clip indicator inside the cell (fp-office) | fixed |
| R2-10 | low | pdf | Page box shows 2/3 when the first page is at the top | Current page picked by the most visible page | Page whose top is nearest the viewport top (fp-media) | fixed |
| R2-11 | low | svg/image | Black SVG text unreadable on the dark checkerboard | Transparency background follows the dark theme only | Background toggle (checker light/dark, white, black) (fp-media) | fixed |
| R2-12 | low | core | Error cards show developer text ('PreviewError: cfb · 35 B') | Diagnostic line always visible | Moved into a collapsed Details element; consistent error codes | fixed |
| R2-13 | low | core | Toolbar file info cut off with … on phones | Single-line ellipsis | Info gets its own wrapping row on phones | fixed |
| R2-14 | medium | tooling | Orca editor captures show the loading state for slow renderers; verify left sample tabs open | plugin shot mounts a fresh frame and captures at first paint | plugin shot used as a mount/error check; finished renders captured from a few real open tabs (window capture, cropped) | fixed |
| R2-15 | medium | tooling | Harness passed previews that were blank | 'ready' state alone counted as a pass | Harness requires visible text/image/canvas in the first viewport | fixed |
| R2-16 | high | sheet | A damaged (bit-flipped) .xlsx freezes the preview for about 60 s | SheetJS parses on the main thread and loops on corrupted input (found by the fuzz pass) | Spreadsheets parse in a module Web Worker with a 10 s limit; damaged file now shows a friendly error at ~10.8 s with the page responsive; verified in Orca | fixed |
| R2-17 | medium | tooling | Fuzz run stalled on a frozen page | In-page checks had no timeout; same-origin pages share a renderer process | Harness records 'did not settle' and continues in a fresh browser context | fixed |
| R2-18 | medium | pdf | Damaged PDFs raised unhandled rejections (5-15 page errors per fuzzed file) | pdf.js prefetch promises without handlers; getPage failures thrown | Per-page error tiles, A4 fallback for page 1, worker entry that downgrades pdf.js internal rejections (fp-media) | fixed |

증빙: [harness](evidence/round-2/harness/) · [orca](evidence/round-2/orca/) · [summary.json](evidence/round-2/summary.json)

### Round 3

커밋 `9d6ca3a` · 2026-11-12T07:15:07.207Z · Orca 1.4.257 · win32 x64

| 검사 | 결과 | 상세 |
| --- | --- | --- |
| TypeScript (tsc --noEmit) | ✅ |  |
| orca plugin validate | ✅ |  |
| orca plugin test (unit) | ✅ | passed 64 · failed 0 |
| orca plugin check (static) | ✅ | "" |
| Browser harness (4 profiles) | ✅ | 168 / 168 passed |
| Fuzz: damaged inputs settle without page errors | ✅ | 253 / 253 settled (135 as friendly errors) |
| Harness without rAF/IntersectionObserver (hidden window) | ✅ | 42 / 42 passed |
| Orca app: editor mounts without errors (plugin shot) | ❌ | 51 / 52 mounted in Orca; 32 open in Orca's own view first (preview via the view toggle) |

**발견된 문제와 조치 / Issues and fixes**

| ID | 심각도 | 영역 | 문제 | 원인 | 조치 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| R3-1 | medium | core/renderers | 'ResizeObserver loop completed' errors in Orca logs; fails the Orca mount check for a .ppt delegated to the .pptx renderer at 390px | ResizeObserver callbacks changed layout synchronously | All 5 observers defer and coalesce layout work and skip unchanged sizes (fp-media); confirm in round 4 | fixed |
| R3-2 | low | html | Malformed fragment link (#%E0%A4%A) threw an uncaught URIError | decodeURIComponent without try/catch | Undecodable fragments treated as not found (security review S-1) | fixed |
| R3-3 | medium | html | Defense in depth: preview iframe was unsandboxed | srcdoc iframe without sandbox (sandbox="" does not render in Orca) | sandbox="allow-same-origin" without allow-scripts; verified rendering in real Orca with UTF-16 .xhtml fixtures (S-2) | fixed |
| R3-4 | low | html | CSS filter missed escaped @import and image-set() | Regex on raw CSS text | Normalise escapes; drop loading tokens (S-3) | fixed |
| R3-5 | info | html | Link click opened the browser without showing the URL | Direct shell.openExternal | Confirm bar with the full URL first (S-5) | fixed |
| R3-6 | info | html | CSP console errors from DOMPurify's inert documents ('base-uri none') | Inert DOMParser documents report CSP violations | Documented as noise; proven not executable | documented |
| R3-7 | medium | sheet/docx | 100k-row .xlsx took 5.4 s to first content; zoom long tasks of 620-740 ms | Whole grid parsed and built | Parse at most 20,000 rows, virtualised rows; docx content-visibility: 2.2-2.4 s, no long task > 70 ms (fp-office) | fixed |
| R3-8 | low | a11y | Muted text on muted fill 4.40:1 (below 4.5:1) | Badge colours | Badge fixed in core/ui.ts; sheet headers and doc/ppt notes left for round 4 | in progress |
| R3-9 | low | core | '+' zoomed out above 800% | stepZoom edge case | Fixed with keyboard shortcuts (fp-media) | fixed |
| R3-10 | info | html | UTF-16 and .xhtml HTML | Orca opens text-like files in Source; UTF-16 files open in the plugin directly | Added .xhtml; UTF-16 fixtures used to verify html.ts inside Orca | fixed |
| R3-11 | low | tooling | Window captures not cropped (sidebar included) | Inline python -c mangled by shell quoting | tools/crop.py called without a shell | fixed |

증빙: [harness](evidence/round-3/harness/) · [orca](evidence/round-3/orca/) · [summary.json](evidence/round-3/summary.json)

### Round 4

커밋 `459a5dc` · 2026-11-12T08:02:50.349Z · Orca 1.4.257 · win32 x64

| 검사 | 결과 | 상세 |
| --- | --- | --- |
| TypeScript (tsc --noEmit) | ✅ |  |
| orca plugin validate | ✅ |  |
| orca plugin test (unit) | ✅ | passed 72 · failed 0 |
| orca plugin check (static) | ✅ | "" |
| Browser harness (4 profiles) | ✅ | 220 / 220 passed |
| Harness on an older engine (no Promise.withResolvers etc.) | ✅ | 55 / 55 passed |
| Fuzz: damaged inputs settle without page errors | ✅ | 321 / 321 settled (152 as friendly errors) |
| Harness without rAF/IntersectionObserver (hidden window) | ✅ | 55 / 55 passed |
| Orca app: editor mounts without errors (plugin shot) | ❌ | 60 / 62 mounted in Orca; 48 open in Orca's own view first (preview via the view toggle) |

**발견된 문제와 조치 / Issues and fixes**

| ID | 심각도 | 영역 | 문제 | 원인 | 조치 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| R4-1 | high | doc | Crafted .doc could loop forever in the piece-table walk | Signed skip length allowed p to stand still or move back | Unsigned length, strictly increasing cursor, unit test (fp-legacy) | fixed |
| R4-2 | high | pdf | PDFs fail on iOS 16-17.3, Safari 16 and older Android WebViews | pdf.js modern build needs Promise.withResolvers and newer built-ins | pdf.js legacy build + targeted polyfills (page and worker); harness --old-engine 55/55 | fixed |
| R4-3 | medium | core/legacy | A render superseded mid-load could write into the newer render and leak observers | No abort checks after awaits; stale cleanup stored | main.ts releases superseded renders; abort checks in delegate/fallbacks (fp-legacy) | fixed |
| R4-4 | medium | docx | Document hyperlinks navigated the preview frame (incl. javascript: hrefs) | docx-preview renders live <a href> from relationships | Intercept clicks, confirm bar, http(s)/mailto only (fp-office) | fixed |
| R4-5 | medium | docx | Object URLs for images/fonts leaked on every re-render | docx-preview never revokes them | Track and revoke on abort (fp-office) | fixed |
| R4-6 | medium | pdf | ResizeObserver could stay attached after a re-render; canvases kept alive | Registered after an await without an abort check; no canvas release | Abort checks; canvases zeroed; document destroyed (fp-media) | fixed |
| R4-7 | medium | core | Stale root.onscroll kept the previous document alive | reset() did not clear renderer handlers | reset() clears onscroll/onkeydown/style | fixed |
| R4-8 | low | image/html | GIF controls could land in a newer toolbar; HTML links unwired after a slow iframe load | Missing abort check; wiring only once | Abort check; re-wire on each load (fp-media) | fixed |
| R4-9 | low | doc/csv | Quadratic work on many field pairs (.doc) or long-space cells (CSV) | Per-character array scan; backtracking regex | Counter; trim and length cap (fp-legacy) | fixed |
| R4-10 | low | zip | Text fallbacks fail before Safari 16.4; zip bombs inflate everything | DecompressionStream('deflate-raw') unguarded; unzipSync without a filter | Feature detection with fflate fallback; entry filter and size cap (fp-legacy, fp-office) | fixed |
| R4-11 | low | a11y | Muted text contrast 4.40:1 in sheet headers | --orca-muted-foreground on --orca-muted | --orca-foreground on --orca-muted (fp-office); doc/ppt notes in progress (fp-legacy) | fixed |
| R4-12 | info | core | Round-3 ResizeObserver loop errors confirmed gone in Orca logs | - | Deferred observer work (R3-1) verified: 0 occurrences during round 4 | fixed |
| R4-13 | low | html | XSS fixture failed the Orca mount check with a CSP 'base-uri' report | DOMPurify's inert parse of a <base> vector triggered a CSP report (blocked, not executed) | Strip <base> tags before sanitising; Orca mount errors now empty | fixed |
| R4-14 | info | tooling | Cross-engine coverage | Only Chromium was tested | Harness --engine webkit (Safari engine) added for round 5 | fixed |

증빙: [harness](evidence/round-4/harness/) · [orca](evidence/round-4/orca/) · [summary.json](evidence/round-4/summary.json)

## 영역별 개발 노트 / Development notes

- [legacy](evidence/legacy/NOTES.md)
- [media](evidence/media/NOTES.md)
- [office](evidence/office/NOTES.md)

## 구조 / Architecture

```text
plugin/                     # 배포되는 Orca 플러그인 (orca-plugin.json, editor/, vendor/)
  editor/main.ts            # 확장자 → 렌더러 디스패처, 파일 변경 시 재렌더
  editor/core/              # 툴바, 줌/핀치, 인코딩 감지, i18n
  editor/renderers/*.ts     # 형식별 렌더러 (지연 로딩)
  vendor/                   # esbuild 로 번들한 서드파티 ESM (네트워크 없음)
samples/                    # 테스트 픽스처 (tools/make-samples.py)
tools/harness/              # Orca 유사 CSP + 모의 호스트 브라우저 하네스 (Playwright)
tools/verify.mjs            # 검증 라운드 실행기
tools/build-docs.mjs        # 이 문서 생성기
docs/evidence/              # 라운드별 스크린샷 · 결과 · 차트
```
