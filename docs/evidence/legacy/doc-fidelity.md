# .doc layout fidelity (Word page layout)

**Result: 23 of the 27 `.doc` rows in the fidelity report are within limits (was 3 of 27).** That includes every `word-*.doc`, every Apache POI Word 6 / Word 95 / Word 97 file, `sample-large.doc` and `sample-word97.doc`. With the `.hwpx` row (another area), the whole report is 23 / 28 (was 3 / 28).
Report: `node tools/fidelity/run.mjs --only doc` → `docs/evidence/legacy/fidelity/report.md` (plus side-by-side images for 8 files: `*.truth.png` is Word's page, `*.ours.png` is the preview with Word's line boxes in red).
Limits: page size ≤ 1.5 % · text recall ≥ 90 % · median font size error ≤ 0.6 pt · median line top error ≤ 4 pt · median left edge error ≤ 4 pt.

## Before → after (first 3 pages; before = `docs/evidence/fidelity/baseline/report.md`)

| File | Before: pass · page · recall · size · top · left | After: pass · page · recall · size · top · left |
| --- | --- | --- |
| `poi-47950.doc` | ❌ · 6.3% · 100% · 0.2 · 21.3 · 15.8 | ✅ · 0.0% · 100% · 0.0 · 2.7 · 0.0 |
| `poi-gaia.doc` | ❌ · 6.3% · 100% · 6.8 · 8.8 · 10.4 | ✅ · 0.0% · 100% · 0.0 · 0.1 · 0.0 |
| `poi-innertable.doc` | ✅ · 0.0% · — · — · — · — | ✅ · 0.0% · — · — · — · — |
| `poi-lists-margins.doc` | ❌ · 0.0% · 50% · 3.2 · 25.8 · 162.5 | ✅ · 0.0% · 100% · 0.0 · 0.3 · 0.1 |
| `poi-lists.doc` | ❌ · 37% · 30% · 0.2 · 19.8 · 36.0 | ✅ · 0.0% · 95% · 0.0 · 2.5 · 0.0 |
| `poi-o-kurs.doc` | ❌ · 0.7% · 30% · 0.8 · 109.7 · 16.0 | ✅ · 0.0% · 97% · 0.0 · 2.2 · 0.0 |
| `poi-page-break.doc` | ❌ · 0.0% · 100% · 0.8 · 4.2 · 0.4 | ✅ · 0.0% · 100% · 0.0 · 0.1 · 0.1 |
| `poi-sampledoc.doc` | ❌ · 0.0% · 100% · 4.7 · 25.0 · 15.8 | ✅ · 0.0% · 100% · 0.0 · 2.4 · 0.0 |
| `poi-saved-by-table.doc` | ❌ · 0.0% · 24% · 2.8 · 30.1 · 33.8 | ✅ · 0.0% · 96% · 0.0 · 1.1 · 0.0 |
| `poi-sections.doc` | ❌ · 0.0% · 50% · 0.2 · 21.3 · 15.8 | ✅ · 0.0% · 100% · 0.0 · 2.4 · 0.0 |
| `poi-seven-columns.doc` | ✅ · 0.0% · — · — · — · — | ✅ · 0.0% · — · — · — · — |
| `poi-simple-table.doc` | ❌ · 6.3% · 44% · 1.3 · 19.6 · 33.8 | ✅ · 0.0% · 100% · 0.0 · 0.4 · 0.3 |
| `poi-table-merges.doc` | ✅ · 0.0% · — · — · — · — | ✅ · 0.0% · — · — · — · — |
| `poi-threecol-headfoot.doc` | ❌ · 6.3% · 43% · 0.2 · 27.1 · 15.8 | ✅ · 0.0% · 100% · 0.0 · 2.5 · 0.0 |
| `poi-travel-form.doc` | ❌ · 162% · 71% · 1.3 · 453.9 · 20.0 | ✅ · 0.0% · 90% · 0.0 · 3.0 · 0.3 |
| `poi-word6.doc` | ❌ · 6.3% · 100% · 0.8 · 19.6 · 33.8 | ✅ · 0.0% · 100% · 0.0 · 0.0 · 0.1 |
| `poi-word95.doc` | ❌ · 6.3% · 100% · 0.8 · 19.6 · 33.8 | ✅ · 0.0% · 100% · 0.0 · 0.0 · 0.1 |
| `word-a4-korean.doc` | ❌ · 0.0% · 53% · 1.3 · 78.6 · 28.8 | ✅ · 0.0% · 100% · 0.0 · 0.2 · 0.1 |
| `word-b5-dense.doc` | ❌ · 16% · 47% · 2.3 · 131.3 · 20.3 | ✅ · 0.0% · 100% · 0.0 · 0.2 · 0.0 |
| `word-landscape-sizes.doc` | ❌ · 41% · 100% · 0.4 · 36.4 · 14.5 | ✅ · 0.0% · 100% · 0.0 · 0.3 · 0.0 |
| `word-letter-spacing.doc` | ❌ · 6.3% · 57% · 0.8 · 38.3 · 15.8 | ✅ · 0.0% · 100% · 0.0 · 0.1 · 0.0 |
| `sample-docx.doc` | ❌ · 0.0% · 79% · 0.0 · 32.1 · 0.0 | ❌ · 0.0% · 79% · 0.0 · 32.1 · 0.0 |
| `sample-html.doc` | ❌ · 0.0% · 88% · 0.8 · 52.3 · 15.8 | ❌ · 0.0% · 88% · 0.8 · 52.3 · 15.8 |
| `sample-large.doc` | ❌ · 134% · 18% · 0.8 · 11.1 · 0.4 | ✅ · 0.0% · 99% · 0.0 · 1.3 · 0.1 |
| `sample-rtf.doc` | ❌ · 6.3% · 50% · 0.2 · 25.1 · 33.8 | ❌ · 0.0% · 79% · 0.0 · 4.2 · 0.0 |
| `sample-word97.doc` | ❌ · 6.3% · 57% · 0.2 · 31.8 · 33.8 | ✅ · 0.0% · 100% · 0.0 · 0.9 · 0.0 |
| `sample.doc` | ❌ · 6.3% · 60% · 0.2 · 24.9 · 33.8 | ❌ · 0.0% · 78% · 0.0 · 1.0 · 0.0 |

## What changed

**Reader (`legacy/word.ts`, new `legacy/wordfmt.ts`)**
- **Sections:** SEP from PlcfSed / SEPX: page width, height and orientation, margins, gutter, header/footer distance, columns, break kind (continuous / new page), title page, document grid. A `sect` block opens each section.
- **Style sheet (STSH):** every STD with its UPXs. Based-on chains are resolved, and character styles keep their own CHPX chain so they apply only what they set.
- **Formatting order:** style → list level → direct PAPX (plus huge PAPX in the Data stream), and paragraph style → character style → direct CHPX. The 0x80/0x81 toggles are relative to the style.
- **PAP:** space before/after (incl. auto), line spacing (auto multiple / exact / at least via LSPD), left/right/first-line indents (incl. negative and hanging), alignment, keep, keep-with-next, page break before, widow control, contextual spacing, custom tab stops (sprmPChgTabs/Papx), paragraph borders (BRC80 and BRC).
- **CHP:** size, bold, italic, underline, strike, caps, hidden, colour (ico and COLORREF), highlight, super/sub, character spacing, Latin / East Asian fonts from SttbfFfn (with family class), East Asian language.
- **TAP:** cell boundaries from sprmTDefTable, gap / cell padding, row height, cell and table borders, horizontal merges. Each Word row keeps its own geometry.
- **Lists:** LSTF/LVL/LFO, with number text, start-at overrides, Roman / letter / Korean formats, bullets mapped from Symbol/Wingdings, and the level's indents.
- **Word 6/95:** old FIB offsets, tables inside WordDocument, 2-byte PNs, 7-byte BX, 1-byte sprms mapped onto the Word 97 ones, Word 6 STSH/FFN layouts.
- **Also:** headers and footers (odd / first page), FORMCHECKBOX boxes, a section break's empty paragraph dropped, and DOP `fDontUseHTMLParagraphAutoSpacing` (spacing between paragraphs = max(after, before) unless set).

**RTF in `.doc` (`legacy/rtf.ts`):** page setup (`\paperw/h`, `\marg*`, `\landscape`), paragraph spacing / line rules / indents / alignment, Latin vs East Asian fonts from `\fonttbl` (`\loch`/`\dbch\af`), table cell geometry (`\trleft`, `\cellx`, `\trgaph`, borders), list labels from `\listtext`.

**Page layout (`legacy/pages.ts`, toolbar "Page" / "Reading")**
- **Page boxes:** every page is `.fp-page[data-fp-page]`, exactly the physical page (CSS px = pt × 96/72 at 100 %, Ctrl+0), with the body placed at the margins and headers/footers at their distances.
- **Pagination by measured height:** paragraphs split by lines across pages (widow control), keep-with-next pulls headings along, tables split by rows, page and section breaks are honoured, and page-break-before is applied. Space after doesn't need to fit at the page bottom.
- **Word's line metrics:** a per-font table (single = max(win ascent + descent, hhea ascent + descent + gap); baseline = single − descent; Malgun Gothic 1.733 em, Batang 1.2925 em, Times New Roman 1.15 em, Calibri 1.2207 em …), multiples put the extra leading below the text, and exact lines sit the baseline at 80 %. Chrome's own baseline is measured with a zero-size marker and each paragraph is shifted to Word's.
- **Fonts:** not-installed fonts are substituted by family class (swiss → Calibri, roman → Times New Roman), as Word does. Hangul in a font without Hangul (MS Mincho …) falls back to Malgun Gothic. Korean names are aliased with fallbacks for macOS / Linux.
- **Korean typography, measured against Word 2021:**
  - a space next to Hangul is 0.14 em wider when the Latin font is a Korean face
  - a digit or Latin letter touching Hangul gets a ¼ em gap and stays with it
  - closing punctuation hangs past the right margin (overflowPunct)
  - Hangul tagged with a non-Asian language wraps only at spaces
- **Grouping like Word's PDF output:** table cells, wide tab gaps and stretched justified gaps end with an invisible zero-width mark, so tools that rebuild lines from glyph positions see the same groups. List numbers and bullets are placed like Word's tab.
- **Mode by device:** phones keep the reflowing reading layout by default (`ctx.compact`); desktop opens in page layout.

## Files not within limits
- **`sample.doc`** (LibreOffice-written) and **`sample-rtf.doc`** (LibreOffice RTF), recall 78 % / 79 %, line top 1.0 / 4.2 pt:
  - Word puts a 0.27 em gap before each Hangul word that follows a Latin space in these two files, but not in `sample-word97.doc`, which has the same text, fonts and language tags. I could not find the switch: no sprm, DOP bit or language id distinguishes them.
  - Without it, "테스트" fits at the end of our line, while Word wraps it.
  - Everything else in these files is laid out correctly: page size, sizes, left edges and line tops.
- **`sample-html.doc`:** HTML saved with a `.doc` suffix. Word lays it out with its HTML import rules (default HTML styles), not with Word paragraph properties, so the reader extracts text structure only, shown in the reading layout.
- **`sample-docx.doc`:** a DOCX with a `.doc` suffix, so it is drawn by the DOCX renderer (`docx.ts`, another area). Its numbers are unchanged.

## Checks
- Harness (desktop-dark + mobile-light, `.doc,.ppt,csv,tsv,xss-`): normal 72 / 72, `--no-raf` 72 / 72, `--old-engine` 72 / 72, `--engine webkit` 72 / 72.
- Fuzz (`.doc,.ppt,.csv,.tsv`): 168 / 168 settled. Unit tests: 80 / 80, including the new `wordfmt.test.ts` (PAP/CHP/SEP/TAP sprms, Word 6 sprms, tab stops, STSH based-on chains, list numbering).
- `sample-large.doc` (240 pages): ready in about 1.1 s; the remaining pages are laid out in the background in about 1.3 s, without rAF.
