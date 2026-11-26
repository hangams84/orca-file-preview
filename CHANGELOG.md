# Changelog

All notable changes per release. Each release on GitHub carries its verification results
(`docs/release-notes/<tag>.md`) and SHA-256 checksums for every file.

## Unreleased

### Added
- **KiCad Preview** for `.kicad_sch`, `.kicad_pcb`, `.kicad_mod`, `.kicad_sym` and `.kicad_pro` (KiCad 6–10), drawn
  as SVG by an own S-expression reader with KiCad's stroke font (newstroke subset, CC0, via KiCanvas/MIT):
  - Schematic: library symbols with units and De Morgan body styles, pins with names/numbers and pin shapes, wires,
    buses and bus entries, junctions, no-connects, local/global/hierarchical labels and net class flags, power
    symbols, hierarchical sheets with pins (a toolbar list jumps to each sheet and names its file), text, text boxes
    (word-wrapped), graphics, fields, embedded PNG images, DNP marks, title block and paper size.
  - Board: per-layer toggles (copper incl. inner, silkscreen, mask, paste, Edge.Cuts, fab, courtyard, user, drawing
    sheet) with Front/Back/Copper presets, footprints with rect/roundrect/chamfered/circle/oval/trapezoid/custom pads
    and round/oval drills, tracks, arcs, through/blind/micro vias, filled zones, graphics, text, dimensions; back-side
    flip (mirrored view).
  - Footprint and symbol library files standalone (library list with filter, unit and De Morgan selection).
  - Project: a summary of sheets, text variables, net classes and patterns, board rules and presets, schematic
    settings, check severities and pinned libraries, plus the raw JSON.
  - Pan (drag), zoom at the pointer (wheel, pinch, keys), fit, dark/light themes; hover shows pin (with net name),
    symbol, label, pad, track, via, zone and footprint details.
- Fidelity check against `kicad-cli` SVG exports (`tools/kicad/fidelity.mjs`), hand-written KiCad 8 corpus
  (`tools/kicad/make-kicad-samples.mjs`), results in `docs/evidence/kicad/`.

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
