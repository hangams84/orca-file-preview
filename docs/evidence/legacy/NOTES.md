# Legacy binary Office + CSV renderers (area `legacy`)

## What was built

| File | Purpose |
| --- | --- |
| `editor/renderers/doc.ts` | `.doc` entry: sniffs the bytes, then Word 97-2003 / Word 6-95 / RTF / HTML / DOCX / plain text |
| `editor/renderers/ppt.ts` | `.ppt` entry: slide deck UI (cards, counter, prev/next, keys, fit, lazy build); `.ppt` that is really PPTX goes to `pptx.ts` |
| `editor/renderers/csv.ts` | `.csv` / `.tsv` table UI |
| `editor/renderers/legacy/cfb.ts` | Minimal OLE compound file (MS-CFB) reader: header, DIFAT chain, FAT, mini FAT, directory tree, 512/4096-byte sectors |
| `editor/renderers/legacy/word.ts` | FIB, CLX piece table (compressed cp1252 / UTF-16LE), CHPX + PAPX FKPs, STSH style names, control characters to structure |
| `editor/renderers/legacy/rtf.ts` | Forgiving RTF reader (codepages, `\uN`, tables, page breaks, heading styles, PNG/JPEG `\pict`) |
| `editor/renderers/legacy/pptbin.ts` | Current User → UserEditAtom chain → persist directory → DocumentContainer, slides, OfficeArt shapes, StyleTextPropAtom, BStore pictures, notes |
| `editor/renderers/legacy/paper.ts` | Draws the shared document model as white pages; chunked append on scroll and in idle time |
| `editor/renderers/legacy/blip.ts` | OfficeArt BLIP records (PNG, JPEG, DIB→BMP); metafiles skipped |
| `editor/renderers/legacy/sniff.ts`, `zip.ts`, `delegate.ts` | Format sniffing, text fallbacks (DOCX/HTML/plain), tiny ZIP reader (DecompressionStream), hand-off to another renderer |
| `editor/renderers/legacy/csvparse.ts` | RFC 4180 parser, delimiter detection, numeric detection, header guess |

## Library + license

**No third-party library.** The task suggested vendoring `cfb` (Apache-2.0); a ~200-line CFB reader
(`legacy/cfb.ts`) was enough and avoids a vendor bundle, so `tools/vendor/cfb.entry.js` and `vendor/cfb.*`
were **not** added. All code here is this plugin's own (MIT).

## Supported features

### DOC (Word 97-2003)
- Piece table text (compressed and Unicode pieces), main story plus footnotes, endnotes and text-box stories as trailing sections.
- `\r` paragraphs, `\x07` cell/row ends → real tables (uses `sprmPFInTable`/`sprmPFTtp`/`sprmPItap`; heuristic fallback without PAPX),
  `\x0C` and `sprmPFPageBreakBefore` → separate pages, `\x0B` line break, `\x13..\x14..\x15` fields show only the result (nested OK),
  `\x01` inline pictures from the Data stream (PICF → blip, PNG/JPEG/DIB, sized from dxaGoal/mx), OLE objects → `[Object]` placeholder, `\x08` drawn objects skipped.
- Character formatting from CHPX: bold, italic, underline, strike, colour (ico + cv), size (relative to the most common size), super/subscript, hidden text dropped.
- Paragraph formatting from PAPX: style → headings (sti 1-9, Title, names "Heading N"/"제목 N"), lists (ilfo / list styles), alignment, left indent.
- Encrypted (`fEncrypted`, or OOXML `EncryptedPackage`) → friendly "password-protected" message.
- Non-Word OLE files → hint ("this is an Excel workbook, rename to .xls", PowerPoint, generic).
- `.doc` that is really: **RTF** (rendered with note), **HTML** (structure extracted with inert DOMParser, scripts never run, note),
  **DOCX** (handed to `docx.ts`; if that fails, text from `word/document.xml`, note), **MHTML** (message), **plain text** (note).
- Word 6/95 (nFib < 0xC1): plain text from fcMin..fcMac with a note.
- Paper: A4-width white pages (`fp-page`), font-size zoom (Ctrl+wheel, pinch, buttons, fit width); on phones the page is fluid (reflows) instead of shrinking.
- Large files: 300 blocks per chunk, more on scroll and in the background (30 ms steps) — the 60-page / 2,580-paragraph fixture is ready in < 1 s.

### PPT (PowerPoint 97-2003)
- Persist directory through the full UserEdit chain (newest wins); fallback to a linear record scan.
- Slide size from DocumentAtom; one card per slide drawn at true positions (OfficeArtClientAnchor, ChildAnchor inside groups with FSPGR transform).
- Text from OfficeArtClientTextbox atoms and from OutlineTextRefAtom → SlideListWithText; TextHeaderAtom type decides title/body defaults.
- StyleTextPropAtom: paragraph runs (indent level, bullet on/off and char, alignment) and character runs (bold, italic, underline, size, colour incl. scheme index).
- Shape fill and line colours (RGB or scheme), vertical text anchor, table cells (LibreOffice/PowerPoint group-of-shapes tables).
- Pictures: BStore FBSE → delayed blips in the "Pictures" stream (or inline) → PNG/JPEG/DIB placed on their shapes; unreferenced blips in an "Other pictures" gallery.
- Speaker notes (SlideAtom.notesIdRef → notes SlideListWithText → NotesContainer) shown under the slide.
- Toolbar: `n / N` counter that follows scrolling, ‹ › buttons, PageUp/PageDown/Arrow/Home/End, zoom; fit-to-width on phones, fit-whole-slide on desktop; ResizeObserver re-fits.
- Lazy: slide DOM is built by an IntersectionObserver (800 px margin) — the 120-slide fixture opens in ~0.7 s.
- Encrypted (Current User token / encryptSessionPersistIdRef) and non-PowerPoint OLE files → friendly messages; `.ppt` that is a PPTX → `pptx.ts`, else text-only fallback with a note.

### CSV / TSV
- `core/encoding.ts` decoding (BOM, strict UTF-8, EUC-KR fallback) + encoding picker; Excel `sep=;` hint line honoured.
- RFC 4180 parser: quotes, doubled quotes, embedded newlines, CRLF/LF/CR, lenient on stray quotes; ragged rows padded.
- Delimiter auto-detect (`,` `;` tab `|`, most consistent field count; `.tsv` prefers tab) with a picker.
- "Header" toggle (guessed), sticky header row and sticky row-number column, numeric columns right-aligned.
- Click header to sort asc → desc → off (numeric-aware; collator with numeric option otherwise; blanks last).
- Filter box (debounced, case-insensitive, highlights matches, shows `matches / total`).
- "Raw" toggle shows the decoded source (chunked).
- Progressive: parses in 20k-row slices yielding to the UI (first 2k rows paint immediately), 400 rows appended per scroll step.
  50,000 rows × 7 cols (2.3 MB) is ready in ~0.75 s; sort 100-220 ms; filter < 200 ms.

## Known limitations
- DOC: no fonts/line spacing/tab stops/borders/shading/column widths, no numbering formats (all list items show `•`), headers/footers and comments are not shown,
  floating (`\x08`) pictures and textboxes positioned on the page are not drawn (textbox *text* is listed in a trailing section), WMF/EMF pictures are not drawn,
  nested tables are flattened, Word 6/95 is text only, fast-saved (complex) files rely on the piece table only.
- RTF: no colours/fonts/lists numbering; tables are simple grids.
- PPT: master/layout shapes (backgrounds, logos, placeholder positions) are not drawn; placeholders without an anchor get a default title/body box;
  no autoshape geometry (ellipses etc. are drawn as rectangles), no rotation/flip, gradients, WordArt, charts or OLE objects; WMF/EMF pictures show a placeholder;
  font sizes not set in the slide fall back to defaults (title 40 pt, body 24 pt, other 18 pt); text may overflow its box slightly because metrics differ.
- CSV: whole file is decoded into memory (fine for tens of MB); filter is plain substring; no column resizing.
- Text fallbacks for DOCX/PPTX-in-legacy-suffix are only used if `docx.ts` / `pptx.ts` throw (they are stubs on this branch, so the fixtures show the fallback here).

## Fixtures (all new ones are in `samples/`)
Generated with LibreOffice (`soffice --convert-to`) from the existing samples or from generated HTML/flat-ODP, or saved by Microsoft Word/PowerPoint via COM.

| Fixture | What it covers | desktop-dark | mobile-light |
| --- | --- | --- | --- |
| `sample.doc` | LibreOffice Word 97: title, formatting, table, picture, list, page break | ✅ ready | ✅ ready |
| `sample-word97.doc` | same content saved by **Microsoft Word** | ✅ ready | ✅ ready |
| `sample-large.doc` | 60 pages, 2,580 paragraphs, hyperlink fields, 60 tables (1.5 MB) | ✅ ready | ✅ ready |
| `sample-rtf.doc` | RTF with a .doc suffix (note banner, picture, table, headings) | ✅ ready | ✅ ready |
| `sample-html.doc` | HTML with a .doc suffix (script must not run) | ✅ ready | ✅ ready |
| `sample-docx.doc` | DOCX with a .doc suffix (delegation + text fallback) | ✅ ready | ✅ ready |
| `broken.doc` | an Excel workbook named .doc → "rename to .xls" | ✅ error | ✅ error |
| `broken.encrypted.doc` | password-protected Word 97 (Microsoft Word) | ✅ error | ✅ error |
| `sample.ppt` | LibreOffice PowerPoint 97: title, bullets, notes, picture, table, text box | ✅ ready | ✅ ready |
| `sample-ppt97.ppt` | same content saved by **Microsoft PowerPoint** | ✅ ready | ✅ ready |
| `sample-large.ppt` | 120 slides, shapes (lazy build) | ✅ ready | ✅ ready |
| `sample-pptx.ppt` | PPTX with a .ppt suffix (delegation + text fallback) | ✅ ready | ✅ ready |
| `broken.ppt` | truncated compound file | ✅ error | ✅ error |
| `broken.encrypted.ppt` | password-protected (Microsoft PowerPoint) | ✅ error | ✅ error |
| `sample.csv` | UTF-8 BOM, quotes, embedded newline, 502 rows | ✅ ready | ✅ ready |
| `sample-euckr.csv` | EUC-KR auto-detect | ✅ ready | ✅ ready |
| `sample-semicolon.csv` | `;` delimiter with decimal commas | ✅ ready | ✅ ready |
| `sample.tsv` | tab delimiter | ✅ ready | ✅ ready |
| `sample-large.csv` | 50,000 rows × 7 cols, 2.3 MB | ✅ ready | ✅ ready |

Harness: `node tools/harness/run.mjs --out docs/evidence/legacy --only .doc,.ppt,csv,tsv --profiles desktop-dark,mobile-light`
→ **38 / 38 pass** for this area (`sample.docx`, `sample.pptx`, `broken.docx` also match the filter but belong to the docx/pptx workers; their rows and PNGs were removed).

Extra interaction shots (Playwright, desktop 1100×700): `interact-csv-sort-filter.png` (sort by score desc + filter "부산": 4,954 / 50,000),
`interact-csv-raw.png` (raw view), `interact-ppt-slide3.png` (after two "next slide" clicks: counter 3 / 3). No page errors.

## Shared files
None changed (`editor/core/*`, `main.ts`, manifest, harness untouched). `.ppt`/`.doc` hand-off uses dynamic `import('./docx.ts')` / `import('./pptx.ts')`.

## Round 1 fixes

Merged `master` (plugin now lives in `plugin/`; typecheck `npx tsc -p plugin --noEmit` passes; `main.ts` untouched).

| Item | Fix |
| --- | --- |
| R1-8 "Other pictures" gallery in `sample.ppt` | The extra picture is a picture *fill* (`fillBlip`) on a LibreOffice master/layout shape, used by no slide. The gallery is removed: only pictures drawn by slide shapes are shown (`PptDoc.unplaced` dropped). Master/layout shapes stay undrawn, so master-only pictures are dropped. |
| R1-9 `sample-ppt97.ppt` slide 2 bullets small/tight | PowerPoint leaves size, spacing and bullets to the master. The parser now reads `TxMasterStyleAtom`s (Environment defaults + the slide's main master via `SlideAtom.masterIdRef`, centre/half/quarter types inherit body/title) per text type and indent level, for size, bold/italic/underline, colour (scheme index resolved per slide), font, bullet, alignment, line spacing and space-before. Slide 2 now uses 32 pt with 20 % space-before, the same as `sample.ppt`. PF/CF parsing is shared (`readPF`/`readCF`). |
| R1-10 Hangul larger/heavier, lines touching (`sample-large.ppt`) | Font face names come from the FontCollection (`FontEntityAtom`) and the run's font goes first, followed by a shared Korean-aware stack (`"Segoe UI", "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", NanumGothic, …`). Line height is now 1.2 × the paragraph's line spacing (was a fixed 1.15), measured from the paragraph's largest run. The `.doc` paper uses the same Korean fallbacks with line-height 1.6 (headings 1.35). Note: in `sample-large.ppt`, "슬라이드"/"요점" really are 18 pt in the file (the fixture set only the Latin size), so they stay slightly smaller. |
| Delegated DOCX/PPTX note dropped | `delegate()` takes a `note`; after the DOCX/PPTX renderer succeeds, a slim banner ("이 .doc 파일은 실제로 DOCX…" / ".ppt … PPTX") is prepended to the content (see `sample-docx.doc.*.png`, `sample-pptx.ppt.*.png`, which now go through the real docx/pptx renderers from master). |

Harness after the fixes: **38 / 38 pass** (desktop-dark + mobile-light, `.doc,.ppt,csv,tsv`; the `.docx`/`.pptx` rows of other areas were removed). The interaction shots were re-run with no page errors.

## Round 2 fixes

Merged `master` (harness content check, `--no-raf`, `--fuzz`, `tools/make-fuzz.mjs`). `main.ts`, `core/` and `tools/` are untouched.

| Item | Fix |
| --- | --- |
| R2-1 blank `.ppt` slides with no rAF/IO | `ppt.ts` now builds slides from scroll geometry (`offsetTop`/`offsetHeight` against `scrollTop` ± one viewport). This runs on the initial layout, on scroll, on zoom/layout, on ResizeObserver plus `window.resize`, and on two settle timers (50/400 ms). IntersectionObserver is only an extra trigger. The current slide is the most visible one. `doc.ts`/`paper.ts` (scroll events + `setTimeout` idle fill) and `csv.ts` (scroll events + `setTimeout` parse slices) never depended on IO/rAF; under `--no-raf` they pass unchanged. **`--no-raf`: 38 / 38** (`results-noraf.md`). |
| R2-2 RTF colours/sizes | `\colortbl` is parsed; `\cfN`, `\cbN`/`\highlightN`/`\chcbpatN` and `\fsN` are tracked per group (reset by `\plain`) and stored on runs (`color`, `bg`, `pt`). "and coloured text." is now red (192,38,38) at 14 pt. Heading paragraphs ignore run sizes so they don't compound with heading CSS. |
| R2-3 subtitle grey | Checked against `samples/sample-slides.pdf`: the reference draws the subtitle in **#8B8B8B**. `sample.ppt` renders #8B8B8B (explicit CF colour), and the PowerPoint-saved `sample-ppt97.ppt` renders #898989 (master TxMasterStyle + colour scheme, round 1). Both match the reference. The difference is on the `.pptx` side: `tx1` + `tint 75000` must be applied in linear (scRGB) space, giving ≈#898989, not linearly in sRGB (#404040). This was reported to the coordinator for the office worker. |
| R2-4 small, non-bold Hangul in `sample-large.ppt` title | The parser was right, the fixture was wrong. In the old file, the Hangul CF run carried only a colour (no size/bold mask bits), so per spec it inherits the master's 18 pt regular. My generated FODP had set only Western `fo:font-size/weight`, not the Asian variants. I regenerated `samples/sample-large.ppt` with `style:font-size-asian` / `style:font-weight-asian`, and the title now reads 32 pt bold across both scripts. Runs inherit only what the file leaves unset, from the master text style. |
| R2-5 slide frame | No border; the card has `box-shadow: 0 1px 4px rgba(0,0,0,.25)` and a white slide on the Orca background. A muted caption under the slide's left edge reads "N" or "N · title" (title from the title/centre-title placeholder, max 60 chars). The speaker notes block sits below it. |
| Fuzz | `node tools/make-fuzz.mjs && node tools/harness/run.mjs --dir samples/fuzz --fuzz --no-shots --profiles desktop-dark --timeout 15000 --only .doc,.ppt,.csv,.tsv` → **133 / 133** settle (ready or error) with no page errors. The CFB reader already guards chains with visited sets and sector bounds, and record walkers stop at bad lengths. No change was needed. |

Harness after the fixes: normal **38 / 38**, `--no-raf` **38 / 38** (desktop-dark + mobile-light, `.doc,.ppt,csv,tsv`; other areas' `.docx`/`.pptx` rows removed).

## Round 3: unit tests

Merged `master`. Pure Node unit tests (no DOM) live in `plugin/editor/renderers/legacy/*.test.ts` and use `orca/testing`. They run with `orca plugin test`. On this machine the runner only works from the C: drive, so they run from a copy of `plugin/` under `%LOCALAPPDATA%\Temp`, the same way `tools/verify.mjs` does it.
`legacy/testkit.ts` holds the helpers. It builds tiny synthetic compound files (version 3, 512-byte sectors, FAT, mini-FAT, directory) and binary records in memory, so the tests need no `node:fs` and no fixtures.

| File | Tests | Assertions | Covers |
| --- | ---: | ---: | --- |
| `csvparse.test.ts` | 11 | 32 | LF / CRLF / CR rows, trailing newline, quotes with delimiters, `""` escapes, embedded CR/LF, empty and empty-quoted fields, trailing delimiter, ragged rows, unterminated / stray quotes, `parseChunk` limit + resume, delimiter detection for `,` `;` tab `|` + single-column fallback, UTF-8 BOM, header guess, numeric detection, 50,000-row parse (< 2 s bound; ~35 ms measured) |
| `cfb.test.ts` | 6 | 15 | signature + sector-shift validation, mini-FAT and FAT stream round-trip, case-insensitive names, FAT cycle terminates, out-of-range start sectors (FAT and mini-FAT) → empty streams, truncated file, directory sibling cycle |
| `word.test.ts` | 8 | 15 | compressed cp1252 + UTF-16LE pieces in one story, `\r` / `\x0B` / `\x0C`, `\x07` cell/row → table, fields (result only, nested), `\x08` `\x02` `\x1F` `\x1E` handling, `\x01` placeholder, `fEncrypted` → `WordError('encrypted')`, missing stream / bad FIB / missing table → `corrupt`, ccpText past the pieces |
| `rtf.test.ts` | 8 | 18 | signature, group-scoped bold/italic, `\uN` + `\ucN` skip (incl. `\'hh` fallbacks, negative values), `\'hh` with `\ansicpg949` (한글) and cp1252, `\colortbl` + `\cf` / `\highlight` / `\fs` scoped to groups, skipped destinations and escapes, `\cell` / `\row` tables, `\page`, unbalanced braces |
| `pptbin.test.ts` | 7 | 15 | TextCharsAtom (UTF-16LE) vs TextBytesAtom (cp1252), `\r` paragraphs, `\x0B` line break, TextHeader type and default bullets, DocumentAtom size, ClientAnchor rectangle, slide order, oversized recLen stops the walk safely, truncated top-level record, missing DocumentContainer / stream → `corrupt`, encrypted Current User token |
| **Total** | **40** | **95** | all pass |

`orca plugin test` result (whole plugin, including other areas' tests): **57 / 57 pass**. `npx tsc -p plugin --noEmit` and `orca plugin check plugin` are clean.
The new tests found no bugs: the guards added in rounds 1-2 (chain visited-sets, bounds-checked record reads, lenient CSV quotes) held under every synthetic corruption tried. No renderer code changed this round.

## Round 3: security review

See `security-review.md`. Six `samples/xss-*` fixtures (43 HTML vectors, 8 fragment/raw-text vectors, 13 SVG vectors, HTML-with-script and RTF-with-javascript in `.doc`, markup in CSV cells), plus an `XSS_CHECK` in `tools/harness/run.mjs` for every `xss-*` file. No vector executed or covered the toolbar (normal and `--no-raf`, desktop-dark + mobile-light). `xss-vectors.html` fails on purpose until S-1 (`decodeURIComponent` URIError in `html.ts` link handling) is fixed. Recommended hardening: S-2, `sandbox="allow-same-origin"` on the preview iframe.
