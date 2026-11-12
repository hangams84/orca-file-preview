# Office (OOXML) renderers — evidence notes

Harness: `node tools/harness/run.mjs --out docs/evidence/office --only docx,pptx,xls,ods --profiles desktop-dark,mobile-light`
→ **18 / 18 passed** (see `results.md`). `interact-*.png` come from an extra ad-hoc Playwright pass
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
  errors centred; formulas saved without a cached result show as `=SUM(C2:C5)` in muted italics.
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
