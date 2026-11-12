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
