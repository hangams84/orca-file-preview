# Office (OOXML) renderers — evidence notes

Harness: `node tools/harness/run.mjs --out docs/evidence/office --only docx,pptx,xls,ods --profiles desktop-dark,mobile-light`
→ **22 / 22 passed** after round 1 (the filter now also matches the legacy fixtures `sample-docx.doc` and `sample-pptx.ppt` from master) (see `results.md`). `interact-*.png` come from an extra ad-hoc Playwright pass
(notes toggle + next slide, second sheet, scroll to the end of a 6,000-row sheet).

## What was built

| Format | File | Library (license) | Vendor bundle |
| --- | --- | --- | --- |
| .docx | `editor/renderers/docx.ts` | docx-preview 0.4.1 (Apache-2.0) + JSZip 3 (MIT / GPLv3 dual) | `vendor/docx.js` (~171 KB) |
| .pptx | `editor/renderers/pptx.ts`, `editor/renderers/office/{slides,drawing,package,xml}.ts` | custom; fflate 0.8 (MIT) for unzip | `vendor/zip.js` (~5 KB) |
| .xlsx .xlsm .xls .ods | `editor/renderers/sheet.ts` | SheetJS CE 0.20.3 (Apache-2.0), with codepage tables for legacy .xls | `vendor/sheet.js` (~1.2 MB) |

All bundles were checked for `eval` / `new Function`: only docx-preview's bundled `setImmediate` polyfill
contains `new Function`, on a path taken only when a string (not a function) is passed, which JSZip never does.

### DOCX
- docx-preview renders into a **shadow root**, so its injected `<style>` stays scoped; the toolbar is untouched.
- Pages are white paper (`section.docx`) with a shadow on the Orca background; headers/footers, footnotes,
  endnotes, tables, images, lists and page breaks come from docx-preview.
- Page count in the toolbar info (`2 쪽` / `2 pages`).
- CSS zoom with fit-width; it starts fitted on phones (`ctx.compact`) or whenever the paper is wider than the viewport.
- Non-zip bytes and parse failures → `PreviewError` with a friendly message.

### PPTX (custom renderer)
- Slide size from `ppt/presentation.xml` (`sldSz`), slide order from `sldIdLst` + relationships.
- Inheritance: slide → layout → master for placeholder position (`xfrm`), body properties (anchor, insets,
  wrap, autofit font scale), list styles and master `txStyles` (title/body/other), plus `defaultTextStyle`.
- Master and layout decorations (non-placeholder shapes) drawn under the slide unless `showMasterSp="0"`.
- Theme colours (`clrScheme`) through the master `clrMap` / `clrMapOvr`, with `lumMod`/`lumOff`/`tint`/`shade`/`alpha`/`satMod`.
- Text: paragraphs/runs with size, bold, italic, underline, strike, colour, highlight, super/subscript,
  letter spacing, caps, theme fonts (`+mj-lt`, `+mn-ea`, …) with Korean fallbacks, alignment, margins/indent,
  line and paragraph spacing, line breaks, fields; bullets (`buChar`, `buAutoNum` incl. alpha/roman/circled,
  `buClr`, `buSzPct`, Wingdings/Symbol glyphs mapped to Unicode).
- Shapes: solid and gradient fills, theme style references (`fillRef`/`lnRef`/`fontRef`), outlines with dash;
  geometry for rect, roundRect, ellipse, triangle, rtTriangle, diamond, parallelogram, hexagon, homePlate,
  chevron, left/right arrow; lines/connectors (with an arrow head for `tailEnd`); group shapes (`chOff`/`chExt`);
  rotation; `mc:AlternateContent` (fallback branch).
- Pictures from `ppt/media` via relationships as blob URLs (revoked on abort), with `srcRect` cropping and flips.
- Tables (`a:tbl`): grid widths, row heights, `gridSpan`/`rowSpan`/merges, cell fills, margins, anchors, borders;
  when a table style is set and a cell has no own fill, an approximation of the default
  "Medium Style 2 – Accent 1" (header row in accent 1, banded tints).
- Backgrounds: `bgPr` solid/gradient/picture fill and `bgRef` theme fills, inherited from layout/master.
- UI: vertical list of slides, each scaled to fit the width (keeps fitting on resize until the person zooms),
  slide counter (`3 / 40`), prev/next buttons, PageUp/PageDown/arrows/Home/End, a **Notes** toggle that shows
  speaker notes under each slide, slide number + title + "hidden" tag under each slide, zoom + pinch.
- Large decks: slides are built lazily by an IntersectionObserver (600 px margin); only a handful exist after load.
- Unsupported shapes draw as rectangles with their text; charts/SmartArt/OLE frames show a labelled
  placeholder box (or their fallback picture when one is embedded).
- `pptx-preview` (npm) was not adopted; the custom renderer was the default per the brief and covers the needed features.

### Spreadsheets
- SheetJS `read(..., { dense: true })`; `.xls` (BIFF8) works, Korean text decodes via the bundled codepages.
- Sheet picker (`toolbar.select`, hidden sheets labelled), info `sheet · rows × cols · size`.
- Grid with column letters and row numbers, both sticky; column widths from `!cols`, row heights / hidden rows from `!rows`.
- Merged cells → `colspan`/`rowspan`; formatted values from `cell.w`; numbers/dates right-aligned, booleans and
  errors centred; formulas saved without a cached result are calculated by `office/formula.ts` (round 1, below).
- Progressive rendering: 300 rows per chunk appended on scroll, capped at **5,000 rows × 200 columns** with a notice.
- Zoom (CSS zoom on the table, 25–400 %, starts at 90 % on phones) with Ctrl+wheel / pinch.

## Known limitations
- DOCX: fonts embedded in the document are registered inside the shadow root, where `@font-face` does not apply,
  so embedded fonts fall back to system fonts. docx-preview limits apply (no text boxes/shapes beyond basic
  VML/DrawingML, approximate page breaking, no comments/track changes shown).
- PPTX: no charts, SmartArt, custom geometry paths (drawn as rectangles), effects (shadows, glow, 3D),
  pattern fills, text columns, vertical-text nuances, or animations; table styles other than the default are
  approximated; text autofit uses the stored `fontScale` only. EMF/WMF pictures show a placeholder.
  Text metrics differ slightly from PowerPoint when the deck's fonts are not installed.
- Sheets: no cell styling (fills, fonts, borders, conditional formats), no charts/images, no frozen panes beyond
  the sticky headers; very wide/long sheets are truncated (with a notice) rather than virtualized.
  Password-protected workbooks show the friendly error.

## Fixtures

| Fixture | What it covers | desktop-dark | mobile-light |
| --- | --- | --- | --- |
| `sample.docx` | headings, Korean, bold/italic/colour, table, image, list, 2 pages | PASS | PASS |
| `broken.docx` | not a zip → friendly error | PASS (error) | PASS (error) |
| `sample.pptx` | title/subtitle placeholders inherited from layout/master, bullets, picture, table, text box, notes | PASS | PASS |
| `sample-shapes.pptx` (new) | background fill, 7 preset shapes + an unsupported one, line, run styles, right-aligned Korean, numbered list, level-2 bullet, group shape, 40 slides (lazy), notes | PASS | PASS |
| `broken.pptx` (new) | corrupt zip → friendly error | PASS (error) | PASS (error) |
| `sample.xlsx` | Korean, merged cell A6:B6, formulas without cached values, 3 sheets incl. empty | PASS | PASS |
| `sample.xls` | BIFF8 via LibreOffice, cached formula results | PASS | PASS |
| `sample.ods` (new) | OpenDocument spreadsheet (converted from sample.xls by SheetJS) | PASS | PASS |
| `sample-large.xlsx` (new) | 6,001 × 12 sheet (row cap notice) and a 5 × 250 sheet (column cap notice) | PASS | PASS |

## Round 1 fixes

### R1-2 Formula cells without a cached value
- New `plugin/editor/renderers/office/formula.ts`: tokenizer + recursive-descent parser + interpreter
  (no `eval`/`Function`). Numbers, strings, TRUE/FALSE, refs `A1`, `$A$1`, `Sheet!A1`, `'Sheet name'!A1`
  (Korean sheet names too), ranges, `+ - * / ^ &`, unary `-`, postfix `%`, `= <> < > <= >=`, parentheses;
  SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, ROUND (half away from zero), ABS, AND, OR, NOT, CONCAT
  (also `_xlfn.CONCAT`), CONCATENATE, LEN, UPPER, LOWER. Excel-style coercion and ordering;
  `#DIV/0!` / `#VALUE!` / `#NUM!` are results, not failures.
- Referenced formula cells are evaluated recursively, memoized per workbook, with a cycle guard and a
  depth limit of 64; ranges over 200,000 cells are refused.
- Used only when a cell has `f` but no value (`t: 'z'`). A calculated cell gets a small corner marker and the
  tooltip "미리보기에서 계산됨 / Calculated by the preview: =C2*D2"; numbers use the cell's number format (SSF)
  or Excel "General". Anything unsupported (other functions, whole-column refs, names, arrays, empty args)
  keeps the formula text in muted italics with the tooltip "Formula not calculated (no saved result)".
- `sample.xlsx` (openpyxl, no cached values) now shows E2..E5 = 15000/12000/10500/60000, C6 = 33,
  E6 = 97500, identical to `sample.xls`, which LibreOffice saved with results.
- Unit tests: `formula.test.ts` (9 tests) and `fonts.test.ts` (3 tests). `orca plugin test` on a copy of
  `plugin/` on C: → 17/17 pass (including the existing encoding tests).

### R1-3 Office font fallback
- New `plugin/editor/renderers/office/fonts.ts`: `installOfficeFonts()` adds `@font-face` aliases to
  `document.head` (not the shadow root) for Calibri, Calibri Light, Aptos, Arial/Helvetica, Segoe UI/Tahoma/Verdana,
  Cambria, Times New Roman, Georgia/Garamond family, Courier New, Consolas, 맑은 고딕/Malgun Gothic, 굴림/Gulim,
  돋움/Dotum, 나눔고딕, 바탕/Batang, 궁서/Gungsuh, 나눔명조, 함초롬바탕/돋움. Each maps to `local()` candidates,
  real font first, e.g. Calibri → Calibri, Carlito, Segoe UI, Helvetica Neue, Helvetica, Arial, Liberation Sans,
  Roboto…; Cambria → Cambria, Caladea, Georgia, Times New Roman…; 맑은 고딕 → Malgun Gothic, Apple SD Gothic Neo,
  Noto Sans KR, NanumGothic; 바탕 → Batang, AppleMyungjo, Noto Serif KR, NanumMyeongjo. Regular (100–599) and
  bold (600–900) faces are declared separately; italics are synthesized.
- DOCX: every `font-family` in docx-preview's generated CSS and inline styles gets a generic sans/serif chain
  appended (`patchCssFonts` / `withFallback`), and the paper root has a sans chain, so an unknown font never
  drops to the browser's default serif. Verified in Chrome: the Calibri/Cambria faces report `loaded` and the
  run "Mixed bold, italic…" computes to `Cambria, "Segoe UI", …, sans-serif`.
- PPTX: slide text uses the same `withFallback` chain after the theme/latin/ea fonts. Sheets: the grid uses
  `Calibri, "맑은 고딕"` + the sans chain (Excel's defaults).
- Note: `sample.docx` (python-docx default template) sets its body text to **Cambria** (theme minor font), so
  that paragraph is meant to be serif, as in Word; on devices without Cambria it now renders in Caladea/Georgia/Times
  rather than the browser's default font. Headings use Calibri → sans.

### R1-11 DOCX reading layout
- New toolbar toggle **읽기 / Reading** (aria-pressed) on every screen size; it is on by default when
  `ctx.compact` (phones). Reading layout drops the paper's fixed width, margins, minimum height and page
  headers/footers (`section.docx { width:auto; max-width:100%; padding:16px }`), so text wraps at the device
  width at 100 % zoom; images get `max-width:100%`, and every top-level table sits in its own horizontally
  scrolling box. Page layout is unchanged (fit-to-width when the paper is wider than the view). Zoom still works
  in reading mode (text reflows at the zoomed size; fit = 100 %).

### R1-12 DOCX table styles
- docx-preview emits the CSS for table-style conditional formatting but only tags rows/cells with
  `first-row`, `odd-row`, `first-col`, … when each row carries `w:cnfStyle` (Word writes it; python-docx and most
  generators do not). `office/docx-fixes.ts#applyTableLook` derives the classes from the table look
  (`first-row`, `last-row`, `first-col`, `last-col`, `no-hband`, `no-vband` on the `<table>`), skipping tables that
  already have cnfStyle classes. `sample.docx`'s Light Grid Accent 1 now shows the bold header with the thick
  rule, bold first column and banded #D3DFEE rows.
- `padTableCells`: cells that end up with no vertical padding get 1.5 pt top/bottom (and 5.4 pt left/right when
  those are zero too), so text no longer touches the top border.

### R1-13 DOCX list indents
- docx-preview draws list markers as `::before` content followed by a tab that collapses to a space.
  `listIndentCss` reads each `p.docx-num-N-L { text-indent: -X }` rule and adds
  `::before { display:inline-block; min-width:X }`, so text starts at the hanging indent as in Word.

### R1-14 Sheet: cut-off numbers and dates
- Numeric/date columns are widened to the widest formatted value among the first 200 rows (~7 px per char,
  max 260 px) — Excel would show `###`, we show the value. Text cells overflow into empty cells on their right
  (Excel behaviour) instead of being clipped with an ellipsis. `sample-large.xlsx` column E shows full dates.

### R1-15 Sheet: .xls column widths
- SheetJS's `wpx` for BIFF files assumes a 14 px max digit width (MDW), so .xls columns came out about twice as wide.
  Widths now come from `width` (Excel column units) × 7 px for every format, then `wch` × 7 + 5, then `wpx`;
  default 64 px (Excel's). `sample.xls` column B is 90 px vs 98 px in `sample.xlsx`.

### Changed files (round 1)
`plugin/editor/renderers/office/{formula,formula.test,fonts,fonts.test}.ts` (new), `sheet.ts`, `docx.ts`,
`pptx.ts`, `office/slides.ts`, `office/docx-fixes.ts` (new, R1-12/13/11), `plugin/vendor/sheet.d.ts` (adds `SSF.format` and `CellObject.z`; the bundle
already exported SSF, so `npm run vendor` was not needed). No shared core files changed.

## Round 2 fixes

Verification: harness `--only docx,pptx,xls,ods --profiles desktop-dark,mobile-light` **22/22** (normal) and
**22/22** with `--no-raf`; fuzz `node tools/make-fuzz.mjs && node tools/harness/run.mjs --dir samples/fuzz --fuzz
--no-shots --profiles desktop-dark --timeout 15000 --only docx,pptx,xls,ods` → **70/70** (every damaged file ends
ready or error, no timeouts, no page errors). Unit tests (`orca plugin test` on a C: copy): **24/24**.

### R2-16 Damaged spreadsheets froze the page
- SheetJS now parses in a module Web Worker, `plugin/editor/renderers/office/sheet-worker.js` (plain JS, so it
  needs no TypeScript transpile; loaded with `new Worker(new URL('./office/sheet-worker.js', import.meta.url),
  { type: 'module' })`, same pattern as the PDF worker). The bytes are copied and transferred.
- The worker returns only what the grid needs: sheet names/hidden flags and, per sheet, `!ref`, merges, column/row
  info and the cell values (`t v w f z`) for the rendered window (5,000 × 200). The window is recorded so the formula
  evaluator treats cells outside it as unknown (formula stays uncalculated) instead of blank.
- Time limit 10 s (below the harness's 15 s): the worker is terminated and the friendly error
  "too complex or damaged to read in time" is shown. Aborting a render terminates the worker.
- The worker posts `{ loaded: true }` on start; only if it fails *before* that (script cannot load) does the renderer
  fall back to parsing on the main thread. A crash after loading is reported as a damaged file.
- `samples/fuzz/sample-large.flip.xlsx` now ends in the error state after ~10.8 s with the page responsive.
- DOCX/PPTX: no fuzzed .docx/.pptx froze (all settle well under the limit), so they stay on the main thread.

### R2-6 DOCX reading layout polish
- Page breaks are a thin dashed separator: empty paragraphs that end a page are hidden (`markSectionTails`), the next
  page's first element loses its space-before, and the section top padding is 12 px (the ~100 px band is gone).
- Headings keep 6 px below them in reading mode; table cells get 3 px top/bottom padding.
- docx-preview's `line-height: 1.00` (Word "single") becomes 1.15, closer to Word's single spacing; Korean text no
  longer touches cell borders (both layouts).
- List markers: the marker box keeps the hanging-indent width but no longer renders docx-preview's tab with
  `white-space: pre` (which expanded it to 8 spaces), so the text starts at the hanging indent (18 pt for this file's
  List Bullet: left 360 / hanging 360, i.e. bullet at the margin, as in Word).

### R2-7 Tinted theme colours
- New `office/color.ts` (pure, unit-tested in `color.test.ts`): `tint`/`shade` are applied in linear RGB like Office
  (`c' = c·t + (1−t)`, `c' = c·s`), `lumMod`/`lumOff`/`lum`, `satMod`/`satOff`/`sat`, `hue*` in HSL, `alpha*`,
  per-channel `red/green/blueMod/Off`, `gray`, `inv`, `comp`. Black + tint 75 % → `#898989` (slide 1 subtitle now
  matches the PDF); accent1 `4472C4` lighter 40 % → `#8FAADC`, darker 25 % → `#2F5597` (Office's values).

### R2-8 Preset text rectangles
- Text in ellipse, roundRect, triangle, rtTriangle, diamond, parallelogram, hexagon, homePlate, chevron,
  right/leftArrow is laid out in the preset's text rectangle (from presetShapeDefinitions), then the bodyPr insets.
  "Tri" now sits inside the triangle's lower half. The fixture's chevron is small (1.8″ wide with the default 50 %
  notch), so its text rectangle is only ~0.4″ wide and "Chevron" breaks across lines, as PowerPoint does for words
  that do not fit; it no longer crosses the notch.

### R2-9 Formula marker
- The calculated-cell marker is a 5 × 5 px corner drawn in the cell's padding box (no-repeat, clipped), so it never
  overlaps borders. Tooltip unchanged.

### R2-5 Slide frame
- PPTX slides: white slide, `box-shadow: 0 1px 4px rgba(0,0,0,.25)`, no current-slide outline (the double grey
  border is gone), caption under the left edge "3" or "3 · title" in small muted text (hidden slides add a tag).

### Changed files (round 2)
`plugin/editor/renderers/{docx,pptx,sheet}.ts`, `office/{docx-fixes,drawing,formula,formula.test,slides}.ts`,
new `office/{color,color.test}.ts` and `office/sheet-worker.js`, `plugin/vendor/sheet.d.ts` (`!window`).
No core/, main.ts or tools/ changes.
