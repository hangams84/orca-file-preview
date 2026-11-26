# Changelog

All notable changes per release. Each release on GitHub carries its verification results
(`docs/release-notes/<tag>.md`) and SHA-256 checksums for every file.

## [Unreleased]

### Added
- **Diagram Preview** for draw.io (`.drawio`, `.dio`) and Visio (`.vsdx`, `.vsdm`, `.vstx`, `.vssx`): a page picker
  (PageUp/PageDown), pan/zoom/fit, a dark canvas switch (◐, remembered) and links (page links switch pages, web links
  ask before opening; linked shapes carry a small badge). Text-looking `.drawio` files open in Orca's Source view first.
  - draw.io: `mxfile`/`mxGraphModel`, compressed pages (base64 + raw deflate + URI encoding, and older non-URI ones),
    layers, groups, swimlanes/containers, about 50 built-in shapes, edges (straight, orthogonal, elbow, entity-relation,
    curved, rounded, waypoints, fixed connection points, 20 arrow kinds, labels), fill/stroke/gradient/dashed/opacity/
    shadow/rotation/flip/fonts, HTML labels sanitised with DOMPurify, placeholders, embedded images. Unknown stencils
    draw as a dashed box with the stencil name. Written in-tree: the official viewer (Apache-2.0) is 3.6 MB, loads math,
    fonts and stencils from the network, injects `<style>` and evaluates code for some styles.
  - Visio: masters (geometry, text and cells inherited row by row, group masters), style sheets (line/fill/text
    chains), every Geometry row type (MoveTo, LineTo, ArcTo, EllipticalArcTo, NURBSTo, SplineStart/SplineKnot,
    PolylineTo, Ellipse, InfiniteLine, Rel* rows), groups, 1-D connectors with arrow heads, text blocks (character and
    paragraph rows, bullets, margins, alignment, rotation, fields, text background), fill patterns, legacy and
    multi-stop gradients, transparency, shadows, line patterns, theme colours and fonts, PNG/JPEG/EMF/WMF pictures,
    hyperlinks, page sizes and background pages; stencils (`.vssx`) show one master per page. Binary `.vsd` gets a
    clear message.
  - Fidelity on a generated corpus (`tools/make-diagram-samples.py`): draw.io against the official draw.io viewer,
    Visio against LibreOffice (Visio is not installed): `docs/evidence/diagram/`.

## [0.2.4] — 2026-11-24

### Changed
- **Size limits raised to 1 GB** inside the plugin: 3D/CAD files (was 768 MB), Office/HWPX ZIP contents (was 120–400 MB),
  and the most a compressed model may expand to. CAD reading may take up to 30 minutes (was 5), with progress shown.
- **Orca's own 50 MB limit still applies.** "File too large: … exceeds 50MB limit" is Orca's load error: Orca 1.4.263
  (and its current source) reads at most 50 MB before it hands a file to any plugin editor (images and PDFs excepted), and
  offers plugins no other way to read a file (stablyai/orca#46775). A plugin cannot raise it.

### Added
- **`.stpz` (gzip-compressed STEP)**, and gzip-compressed content in any 3D/CAD file: unpacked in the frame
  (DecompressionStream, refused above 1 GB). STEP usually shrinks 5–8×, so large STEP files fit under Orca's 50 MB:
  verified in Orca 1.4.263 — a 58.6 MB `.step` is refused by Orca, the same model as a 10 MB `.stpz` opens (1,332 parts).
- A clear message when a CAD file does not fit in the engine's memory (OpenCascade, 32-bit WebAssembly, 4 GB) instead
  of "damaged". Measured on synthetic STEP assemblies: 61 MB in 1.5 min, 189 MB in 14 min, 343 MB exceeds the time
  limit, 412 MB runs out of memory.
- Harness `--warnings` prints console warnings.

## [0.2.3] — 2026-11-20

### Fixed
- **STEP / IGES / BREP did not open in Orca** (`preview refused: cad-engine`). The OpenCascade engine was started
  from a `blob:` script, which Orca's plugin frames refuse, also inside workers. The vendor build now ships
  `vendor/occt/occt-import-js.csp.js` (the library with its two `new Function` sites replaced, with an LGPL
  modification notice, beside the unmodified file), and the worker loads it by URL. The browser harness now
  refuses `blob:` scripts like Orca. Verified in Orca 1.4.258: a STEP assembly and an IGES part render.
- **Pictures missing in PowerPoint slides**, depending on the picture's format and effects. Checked against
  PowerPoint's own slide export on a 49-case corpus built with PowerPoint (formats, sizes, effects, placements):
  31 → 46 match, 6 → 0 missing.
  - Now shown: TIFF (LZW, multipage), EMF (shapes, text, embedded bitmaps; in-tree player), WMF (rtf.js WMFJS).
  - EXIF-rotated JPEGs are no longer rotated twice (Office stores the rotation on the shape).
  - Recolour (grayscale, black and white, washout, duotone), brightness/contrast, transparency and "set
    transparent colour" are applied; shape picture fills (stretch, tile) and pictures in table cells are drawn.
  - Very large pictures (above 16 MP) are decoded within a size budget.
  - HEIC and JPEG XR show a named placeholder; linked (external) pictures show their path.
- The same picture decoder fixes Word and legacy files: `.docx` 9/14 → 14/14, `.doc` 9/12 → 12/12, `.ppt` 19/23 → 22/23
  pictures shown.

### Added
- `samples/pptx-images/` corpus, `tools/make-pptx-images.ps1` and `tools/pptx-images/` (PowerPoint COM ground truth
  and comparison); report in `docs/evidence/office/pptx-images/report.md`; Orca captures in `docs/evidence/orca-cad/`.

## [0.2.2] — 2026-11-16

### Fixed
- **Install from the Git URL** (`https://github.com/hangams84/orca-file-preview.git` in Orca → Settings → Plugins →
  Install, or `orca plugin install <url>`) failed with "plugin exceeds the install size or file count limit": Orca
  installs the newest `vX.Y.Z` tag and expects `orca-plugin.json` at the repository root, but the tags pointed at the
  whole source tree (tests, evidence, tools). Releases now commit only the plugin to the root of the `dist` branch and
  put the version tag there; the source is tagged `source-vX.Y.Z`. Every release checks the Git URL install in a fresh
  Orca. The installers' online source and the READMEs use the plain repository URL.
- Older tags (v0.1.0–v0.2.1) still point at the source tree, so installing exactly those by Git URL keeps failing;
  their release packages and executables are unaffected.

## [0.2.1] — 2026-11-13

### Fixed
- Windows updater (`update.cmd`, `FilePreviewSetup.exe /update`, `file-preview.ps1 update`) reported a checksum
  mismatch for every download: GitHub serves `.sha256` files as binary, so the hash text was parsed wrongly.
  The v0.2.0 Windows updater cannot update itself — download 0.2.1 once by hand. macOS/Linux were not affected.

### Verified
- Updater against the real v0.2.0 release: Windows 11 (fixed script) and Ubuntu 22.04/24.04 (6/6 each).

## [0.2.0] — 2026-11-13

### Added
- **Hangul documents**: `.hwp` (HWP 5) and `.hwpx` (OWPML) previews laid out from Hangul's own saved line
  layout; distribution-protected, password and HWP 3 files get a friendly message.
- **3D models**: `.stl` `.obj` `.ply` `.glb` `.gltf` (embedded) `.3mf` `.off` `.fbx` `.dae` (three.js): orbit/zoom/pan,
  fit, wireframe, shading, grid/axes, backgrounds.
- **Installers** for Windows (`.cmd` + PowerShell), macOS (`.command`) and Linux (`.sh`), with `update` (newest
  GitHub release, SHA-256 verified) and `uninstall`; executables `FilePreviewSetup.exe`, `File Preview Setup.app`,
  `file-preview-setup.run`.
- **Fidelity checks** (`tools/fidelity`): Word and Hangul ground truth vs the preview's page size, line positions,
  indents and font sizes.
- **CI** (`orca-compat`): fresh Orca installs of every release 1.4.247–1.4.258 on Linux, macOS and Windows
  (Windows 10 and 11 kernels), results written into README; Windows 7 refusal check.
- Platform tests in Docker (Ubuntu 22.04/24.04) and on GitHub's macOS runners.

### Fixed
- `.doc` files from other Word versions: page size, margins, spacing, line spacing, indents and pagination
  (layout fidelity vs Word 3/27 → 23/27 files within limits; all Word-made files pass).
- Word list bullets showed as empty boxes on Linux/macOS (Symbol-font characters).
- Installers hung when Orca was not running (Windows); Orca 1.4.248–1.4.251 have no `plugin install` — the
  folder is registered with `plugin dev load` there.

## [0.1.0] — 2026-11-12

First verified release: read-only previews for `.docx` `.doc` `.pptx` `.ppt` `.xlsx` `.xlsm` `.xls` `.ods` `.pdf`
`.txt` `.log` `.csv` `.tsv` `.html` `.htm` `.xhtml` `.svg` `.gif` `.bmp` in Orca 1.4.248+, on desktop and
browser/mobile clients. Five verification rounds (63 issues found, all high/medium fixed); final round 10/10
checks. [Release](https://github.com/hangams84/orca-file-preview/releases/tag/v0.1.0)

[0.2.2]: https://github.com/hangams84/orca-file-preview/releases/tag/v0.2.2
[0.2.1]: https://github.com/hangams84/orca-file-preview/releases/tag/v0.2.1
[0.2.0]: https://github.com/hangams84/orca-file-preview/releases/tag/v0.2.0
[0.1.0]: https://github.com/hangams84/orca-file-preview/releases/tag/v0.1.0
