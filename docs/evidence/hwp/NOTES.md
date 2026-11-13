# Hangul (.hwp / .hwpx) preview — notes

New editor **Hangul Preview** (`id: hangul`, bytes, any frame) for `.hwp` and `.hwpx`, entry
`plugin/editor/renderers/hwp.ts` (sniffs the bytes: a `.hwp` that is really HWPX, or the reverse, still opens).
No libraries were added: both formats are read by our own code in `plugin/editor/renderers/hangul/`.

| File | Role |
| --- | --- |
| `records.ts` | HWP 5 record stream (tag / level / size, 0xFFF long size), record tree, PARA_TEXT control characters (char / inline / extended, 8 WCHARs), units (HWPUNIT ↔ pt / px / mm), COLORREF |
| `hwp5.ts` | HWP 5.x: CFB container (`legacy/cfb.ts`, new additive `open(path)` / `list(path)`), FileHeader (version, compressed / password / distribution / DRM flags), raw-deflate streams (fflate `inflateSync`), DocInfo (ID_MAPPINGS, FACE_NAME, CHAR_SHAPE, PARA_SHAPE, BORDER_FILL, NUMBERING, BULLET, BIN_DATA), BodyText/SectionN (PARA_HEADER / TEXT / CHAR_SHAPE / LINE_SEG, CTRL_HEADER `secd` `cold` `tbl ` `gso ` `eqed` `head` `foot` `fn  ` `en  ` `atno` `pgnp`, LIST_HEADER lists, SHAPE_COMPONENT + rect / ellipse / line / picture / container / OLE / chart) |
| `xml.ts` | Small non-validating XML reader (no DOM, so the HWPX mapping is unit-tested in Node) |
| `hwpx.ts` | HWPX / OWPML: `content.hpf` manifest + spine, `header.xml` (fontfaces, charPr, paraPr incl. `hp:switch/case`, borderFills incl. gradient / image brush, numberings, bullets), `sectionN.xml` (`hp:p`, `hp:run`, `hp:t` with tab / lineBreak / nbSpace / fwSpace, `hp:secPr/pagePr`, `hp:ctrl`, `hp:tbl`, `hp:pic`, `hp:rect` / `ellipse` / `line` / `container` with `drawText`, `hp:equation`, `hp:linesegarray`), master pages, `BinData/` |
| `model.ts` | The shared document model (both readers fill it) |
| `layout.ts` | Pagination from Hangul's saved line segments, columns, floating object positions, tables split over pages, paragraph numbering |
| `fonts.ts` | Font stacks with Korean fallbacks and metric-adjusted `local()` aliases |
| `view.ts` | Page view (lazy pages, line fitting, tables, objects, header / footer, notes) and reading view |

## How the page view works

* **Hangul's saved layout is the layout.** Every body line carries PARA_LINE_SEG / `<hp:lineseg>`: vertical
  position, height, text height, baseline, start x and width in HWPUNIT. Each line is an absolutely placed
  element at `body top + vertpos`, `body left + column x + horzpos`, with its baseline at `+ baseline`
  (a flex baseline strut, so it does not depend on the font's metrics). A line whose position goes back
  up starts the next column, then the next page. HWPX `textpos` counts like HWP 5 (a control or tab = 8
  units), verified on the corpus.
* **Line fitting.** After a batch of pages is painted, all line widths are read once, then written once:
  a line wider than Hangul's saved width (missing Hancom font) is condensed with `scaleX`, a justified /
  distributed line is spread to the saved width (word spacing, or letter spacing without spaces). Stored
  in em, so zooming keeps it — line breaks are always exactly Hangul's.
* **Fonts.** `함초롬바탕` / `HCR Batang` / 바탕 / 명조 … → serif stack (`Noto Serif KR`, `Noto Serif CJK KR`,
  `Batang`, `AppleMyungjo`, `Nanum Myeongjo`); `함초롬돋움` / `맑은 고딕` / 고딕 / 돋움 … → sans stack (`Malgun
  Gothic`, `Apple SD Gothic Neo`, `Noto Sans KR`, `NanumGothic`). Every face is used through a `local()`
  alias with Hangul's vertical metrics (ascent 85 %, descent 15 %): glyphs are the installed font's, but
  text boxes sit on Hangul's line exactly (this took the median line-top error from 2.0 pt to 0.2 pt).
* **Units.** 1 em of the page = 1000 HWPUNIT = 10 pt; zoom changes one font size. Pages are sized exactly
  to the paper (`.fp-page[data-fp-page]`, CSS px = pt × 96 / 72 at 100 %).
* **Lazy pages.** Page shells get their final size up front; pages near the viewport are painted from
  scroll geometry (no IntersectionObserver / rAF, works in hidden windows), the rest in the background a
  page at a time. 210-page HWPX: parse 0.3 s, layout 12 ms, first page ready ≈ 1.2 s.
* **Reading view** (`읽기` / `Reading`, default on phones; `페이지` / `Page` returns): flowing paragraphs with
  margins, indents (hanging indents), spacing, line spacing and alignment; tables as HTML tables (≤ 5
  columns fit the screen, wider ones scroll sideways), pictures fit the width, header / footer and
  footnotes at the section ends, page breaks as dashed rules.
* **Files without saved layout** (written by tools, e.g. `hwpxlib-project-plan.hwpx`): the section is drawn
  as flowing text in a page that grows; paper / page anchored objects are still placed at their offsets.

## Format coverage

| Feature | HWP 5 | HWPX | Notes |
| --- | :---: | :---: | --- |
| Page size, margins, header / footer areas, gutter, landscape | ✅ | ✅ | Landscape swaps the stored portrait size (HWP bit 0, OWPML `NARROWLY`) |
| Line positions from the saved layout | ✅ | ✅ | Fallback to CSS flow when a section has none |
| Paragraph alignment (justify / left / right / centre / distribute) | ✅ | ✅ | |
| Indent / margins / spacing / line spacing | ✅ | ✅ | In the page view these come from the saved lines; used directly by the reading view (HWP stores margins doubled) |
| Char size, relative size, bold, italic, underline (below / above), strike, colour, shade, letter spacing, super / subscript | ✅ | ✅ | Width ratio (장평) is absorbed by line fitting |
| Fonts (Hangul / Latin faces) with Korean fallbacks | ✅ | ✅ | |
| Tables: borders (style, width, colour), fills (colour, gradient, picture), merges, widths, row heights, cell margins, vertical alignment, captions | ✅ | ✅ | Rows grow to their cells' saved text height; tables taller than the page continue on the next page by rows |
| Pictures (BinData) | ✅ | ✅ | PNG / JPEG / GIF / BMP / WebP / SVG; WMF / EMF / TIFF → labelled box |
| Text boxes, rectangles, ellipses, lines, groups | ✅ | ✅ | Polygons / curves / arcs drawn as their box (text still shown) |
| Header / footer (both / odd / even), page numbers (auto number, page-number position) | ✅ | ✅ | |
| Footnotes (page bottom) / endnotes (end of document) | ✅ | ✅ | |
| Paragraph numbering, outline numbering, bullets | ✅ | ✅ | `^1.` formats, 가나다 / ①②③ / roman / latin / 一二三 styles |
| Master pages (바탕쪽) | ✅ | ✅ | Drawn behind the body |
| Page background / border fill | ✅ | ✅ | Colour, gradient, picture |
| Multi-column sections | ✅ | ✅ | Relative column widths and gaps |
| Equations | ▢ | ▢ | Labelled box with the equation script |
| Charts, OLE objects, video, form controls, text art | ▢ | ▢ | Labelled box |
| Distribution (배포용), password, DRM documents | ✋ | — | Friendly refusal (`hwplib-distribution.hwp`) |
| HWP 3.x and earlier | ✋ | — | "구 버전 HWP 3.x 문서는 지원하지 않습니다…" |

✅ drawn · ▢ labelled placeholder · ✋ friendly refusal

## Limitations

* Equations are not typeset (script shown in the placeholder); charts / OLE are not drawn.
* Text wrapping around floating objects follows Hangul's saved lines in the page view; in the reading view
  floating objects become blocks before their paragraph.
* Polygons, curves, arcs, rotation and picture cropping are not drawn exactly (bounding box / full image).
* Tab leaders, paragraph borders / shading, character outlines / emboss, ruby (덧말), hidden comments and
  track changes are ignored.
* Very old HWP 5.0.0.x writers (before 5.0.2.5) use the old line-spacing field; handled, but untested
  beyond the 5.0.2.2 corpus file.
* A truncated `.hwp` / `.hwpx` is refused as damaged rather than partially shown.

## Results (2026-11-13, branch `hangams84/fp-hwp`)

### Fidelity report (`node tools/fidelity/run.mjs --only hwp,hwpx`)

21 / 23 files within limits. Limits: page size ≤ 1.5% · text recall ≥ 90% · median font size error ≤ 0.6 pt ·
median line top error ≤ 4 pt · median left edge error ≤ 4 pt (first 3 pages). Truth: Hangul's own saved line layout.

| | Format | File | Page size | Recall | Font size | Line top | Left edge | Notes |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| ✅ | hwp | `hwplib-blank.hwp` | 0.0% | — | — | — | — |  |
| ✅ | hwp | `hwplib-distribution.hwp` | — | — | — | — | — |  (refusal: distribution) |
| ✅ | hwp | `hwplib-equation.hwp` | 0.0% | — | — | — | — |  |
| ✅ | hwp | `hwplib-fields.hwp` | 0.0% | 100% | 0.0 | 0.2 | 0.0 |  |
| ✅ | hwp | `hwplib-footnotes.hwp` | 0.0% | — | — | — | — |  |
| ✅ | hwp | `hwplib-header-footer.hwp` | 0.0% | 100% | 0.0 | 0.2 | 0.0 |  |
| ✅ | hwp | `hwplib-master-page.hwp` | 0.0% | — | — | — | — |  |
| ✅ | hwp | `hwplib-merged-cells.hwp` | 0.0% | — | — | — | — |  |
| ✅ | hwp | `hwplib-numbering.hwp` | 0.0% | 100% | 0.0 | 0.2 | 0.0 |  |
| ✅ | hwp | `hwplib-old-5022.hwp` | 0.0% | 100% | 0.0 | 0.2 | 0.0 |  |
| ✅ | hwp | `hwplib-picture.hwp` | 0.0% | — | — | — | — |  |
| ✅ | hwp | `hwplib-table.hwp` | 0.0% | — | — | — | — |  |
| ✅ | hwp | `hwplib-textbox.hwp` | 0.0% | — | — | — | — |  |
| ✅ | hwpx | `hwpxlib-equation.hwpx` | 0.0% | — | — | — | — |  |
| ✅ | hwpx | `hwpxlib-header-footer.hwpx` | 0.0% | — | — | — | — |  |
| ❌ | hwpx | `hwpxlib-multi-column.hwpx` | 0.0% | 38% | 0.0 | 0.2 | 0.0 | text recall 38% (truth issue, see below) |
| ❌ | hwpx | `hwpxlib-page-size-margin.hwpx` | 42% | — | — | — | — | page size 41.6% (truth issue, see below) |
| ✅ | hwpx | `hwpxlib-picture.hwpx` | 0.0% | — | — | — | — |  |
| ✅ | hwpx | `hwpxlib-project-plan.hwpx` | 0.0% | — | — | — | — |  |
| ✅ | hwpx | `hwpxlib-real-test.hwpx` | 0.0% | 100% | 0.0 | 0.1 | 0.0 |  |
| ✅ | hwpx | `hwpxlib-rectangle.hwpx` | 0.0% | — | — | — | — |  |
| ✅ | hwpx | `hwpxlib-table.hwpx` | 0.0% | — | — | — | — |  |
| ✅ | hwpx | `hwpxlib-test-doc.hwpx` | 0.0% | 100% | 0.0 | 0.2 | 0.0 |  |

Against the task targets on every file with truth lines: page size within 1 % (0.0 %), every saved line
found (recall 100 %), line top median 0.1–0.2 pt (≤ 2 pt), font size median 0.0 pt (≤ 0.5 pt), left edge 0.0 pt.

**The two failures are in the truth extraction (`tools/fidelity/truth.py`), not the preview:**

* `hwpxlib-multi-column.hwpx` is a 3-column section (`colCount="3"`, relative widths 6552 / 12234 / 12236
  of 32768 → 8502 / 15875 / 15878 HWPUNIT, exactly the saved `horzsize` values). Its line positions reset
  to 0 at each **column**; truth.py starts a new **page** there and ignores the column x offset, so it
  expects 3 one-column pages. The preview draws one page with three columns; column 1 matches the truth
  lines exactly (top 0.2 pt, left 0.0 pt); columns 2 and 3 are what truth.py calls pages 2 and 3.
* `hwpxlib-page-size-margin.hwpx` is B4 **landscape** (`landscape="NARROWLY"`, stored 72852 × 103180). Its
  saved line width is 86172 = 103180 − 2 × 8503, so Hangul lays it out 1031.8 pt wide. truth.py reports the
  stored portrait size (728.5 × 1031.8 pt); the preview draws 1031.8 × 728.5 pt. (HWP 5: PAGE_DEF
  property bit 0, same rule.)

### Browser harness (`tools/harness/run.mjs`, fixtures `samples/sample.hwp` = `hwplib-table.hwp`, `samples/sample.hwpx` = `hwpxlib-real-test.hwpx`)

| Profile set | Result |
| --- | --- |
| desktop-dark, desktop-light, mobile-light, tablet-dark | 8 / 8 |
| `--no-raf` (no rAF / IntersectionObserver) | 2 / 2 |
| `--old-engine` | 2 / 2 |
| `--engine webkit` (mobile-light, desktop-dark) | 4 / 4 |
| Fuzz (`make-fuzz.mjs`: truncated, bit-flipped, zeroed, random, empty) | 16 / 16 settle (12 as friendly errors) |
| Whole corpus (`--dir samples/fidelity/hwp`, `…/hwpx`), desktop-dark + mobile-light | 44 / 46: every file renders; the 2 "failures" are `hwplib-distribution.hwp` ending in the friendly refusal (the generic harness only expects errors for `broken.*` names; the fidelity tool expects this refusal) |

### Unit tests (`orca plugin test`, copy on C:)

109 passed, 0 failed (whole plugin). New: `hangul/records.test.ts` (record headers incl. 0xFFF size,
truncation, tree; control-char widths and WCHAR → text positions; control ids; units; COLORREF),
`hangul/hwp5.test.ts` (FileHeader flags; distribution / password / HWP 3 refusals; PARA_SHAPE doubled
margins and line spacing by version; CHAR_SHAPE; BORDER_FILL; faces by language; a full section with page
definition, char shapes, line segments and a table), `hangul/hwpx.test.ts` (XML reader; `hp:switch`
margins; charPr; borderFill; text positions with controls / tabs; landscape; tables; pictures, equations,
text boxes), `hangul/layout.test.ts` (column boundaries with merges; row growth; relative columns;
page and column breaks from line positions; flow fallback; object positions; numbering; font stacks).

`orca plugin validate` and `orca plugin check`: valid, no errors.
