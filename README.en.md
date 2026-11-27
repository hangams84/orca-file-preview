[한국어](README.md) · [English](README.en.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Türkçe](README.tr.md)

# File Preview for Orca

[![orca-compat](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml/badge.svg)](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml)

File Preview is an [Orca](https://github.com/stablyai/orca) plugin that shows **read-only previews** of Office, Hangul,
PDF, text, image, 3D, CAD and electronics files inside Orca. It works in Orca for desktop (Windows · macOS · Linux) and
in browser/mobile clients.

- Latest release: **v0.4.0** · requires Orca **1.4.248** or later (**1.4.252** or later to install from the Git URL)
- Runs as `sandboxed-ui` only: no extra capabilities, no network access, and it never modifies your files.

## Supported formats

| Format | Extensions | Engine · what you see |
| --- | --- | --- |
| Word | `.docx` `.doc` | docx-preview · own OLE/CFB parser (detects `.doc` files saved as RTF, HTML or DOCX) |
| PowerPoint | `.pptx` `.ppt` | Own OOXML renderer · own PPT record parser |
| Excel | `.xlsx` `.xlsm` `.xls` `.ods` | SheetJS CE (Web Worker, formula fallback, virtual scrolling) |
| Hangul | `.hwp` `.hwpx` | HWP 5 and HWPX (OWPML), laid out from the line layout Hangul saved. Distribution-protected and password-protected files and HWP 3 get a friendly message |
| PDF | `.pdf` | pdf.js (lazy rendering, Korean CMaps, password prompt) |
| Images | `.gif` `.bmp` `.svg` | Browser decoder (SVG scripts blocked, background choice) |
| Web | `.html` `.htm` `.xhtml` | DOMPurify + sandboxed iframe (scripts never run) |
| Tables | `.csv` `.tsv` | Own RFC 4180 parser (encoding and delimiter detection, sorting, filter) |
| Text | `.txt` `.log` | Encoding detection (UTF-8/16, EUC-KR and more), line numbers, word wrap |
| Diagrams | `.drawio` `.dio` `.vsdx` `.vsdm` `.vstx` `.vssx` | Own SVG renderer: draw.io (compressed and multi-page files, built-in shapes, connectors, styles, HTML labels sanitised with DOMPurify), Visio (master and style-sheet inheritance, every Geometry row, groups, connectors, text formatting, fill patterns, gradients, themes, EMF/WMF pictures, background pages). Page picker, pan, zoom, fit, dark canvas, links |
| 3D models | `.stl` `.obj` `.ply` `.glb` `.gltf` `.3mf` `.off` `.fbx` `.dae` | three.js (WebGL, orbit, zoom, pan, touch, Draco and meshopt, parsing in a Web Worker). OBJ `.mtl` files and textures, glTF external `.bin` files and images, and DAE/FBX/3MF textures load from companion files (📁 or drop) |
| CAD (B-rep) | `.step` `.stp` `.stpz` `.iges` `.igs` `.brep` | OpenCascade (occt-import-js, WebAssembly, Web Worker): assemblies, part list, colours, tessellation quality. `.stpz` is gzip-compressed STEP |
| 2D CAD drawings | `.dxf` `.dwf` `.dwfx` | Own Canvas 2D renderer: DXF (ASCII and binary, R12–2018+, blocks, dimensions, hatches, MTEXT, Korean text), DWF (W2D streams, sheets, thumbnail fallback), DWFx (XPS pages, embedded fonts). Layer list, model/layout (viewport)/sheet picker, light/dark background, info bar. DXF external references (xrefs) and IMAGE entities load from companion files (xref layers appear as `XREF\|layer`) |
| AutoCAD drawings (separate plugin) | `.dwg` `.dwt` | **File Preview DWG** — [separate repository](https://github.com/hangams84/orca-file-preview-dwg), GPL-3.0-or-later, installed on its own (Git URL `https://github.com/hangams84/orca-file-preview-dwg.git`, source in [dwg-plugin/](dwg-plugin/README.md)). LibreDWG (WebAssembly, Web Worker) + Canvas: model/layouts, layers, blocks, Korean text, dimensions, hatches |
| Robot descriptions (ROS) | `.urdf` `.xacro` | Own XML reader + xacro processor (ROS 2 xacro 2.x rules, safe expression evaluator without eval) + three.js: kinematic tree, primitive shapes, origins and materials, all six joint types, limits, mimic, joint sliders, visual/collision/frame/joint-axis toggles. Also opens `.urdf.xacro`. Meshes and `xacro:include` files load from companion files |
| KiCad | `.kicad_sch` `.kicad_pcb` `.kicad_mod` `.kicad_sym` `.kicad_pro` `.kicad_wks` | Own S-expression parser + SVG renderer (KiCad 6–10, KiCad's newstroke stroke font): schematics, boards (layer toggles, front/back flip), footprints, symbol libraries, project summary, tooltips for pads, pins and nets. With the project folder: hierarchical sheet navigation and custom drawing sheets |
| SolidWorks | `.sldprt` `.sldasm` `.slddrw` `.slddrt` `.prtdot` `.asmdot` `.drwdot` | Own container reader (OLE/CFB up to 2014, the 2015+ format): stored preview pictures, the part's display mesh in 3D, **3D assembly** (stored placements + meshes, or part files given with 📁), properties, configurations, referenced files, feature names, save history |
| EPLAN Electric P8 | `.edz` `.zw1` `.elk` `.ell` `.elr` `.els` `.ela` `.elp` `.elx` `.zx1` `.ema` `.emp` | Own 7z (LZMA/LZMA2) and ZIP reader: EDZ part data, pictures and PDF documents, **macro graphics** (PXF: lines, arcs, curves, text, per variant), project backups with properties, page descriptions, **parts list**, pictures and contents tree, link files + the 📁 project folder (`.edb`) |
| (unreadable files) | All of the above | Generic inspector: format identification, size, entropy, hex dump, strings |
| **File Preview panel** | All of the above | A panel in the right sidebar; see [File Preview panel](#file-preview-panel) below |

Everywhere: dark/light theme follows Orca live, Korean/English UI, zoom with Ctrl+wheel, pinch or buttons, fit-to-width
on phones, automatic refresh when the file changes, and a friendly message for damaged files.

### Text formats open straight in the preview (0.4.0)

Orca treats URDF, xacro, KiCad, draw.io, ASCII DXF, STEP/IGES/BREP, OBJ and the other text 3D formats, `.doc` files saved
as RTF/HTML and XML `.xls` files as text. The plugin registers text editors for them, so these files now open in the
preview by default. Files that Orca opens itself (`.txt` `.csv` `.tsv` `.html` `.htm`) still open in the Source view
first, as Orca's rules require; pick the preview with the view toggle at the top right of the tab.

### Companion files (📁 or drop)

Orca hands an editor only the file you opened. Pick a folder with the 📁 toolbar button (hold Shift to pick single
files) or drop files onto the preview, and the plugin reads them inside its sandboxed frame:

| Preview | What a folder or dropped files add |
| --- | --- |
| Robot (URDF/xacro) | Meshes (STL, DAE with textures, OBJ with `.mtl`, glTF) replace the placeholders while the joint pose stays; `xacro:include` is resolved (`$(find pkg)`, relative, nested) |
| 3D | OBJ materials and textures, glTF external `.bin` files and images, DAE textures |
| CAD drawing (DXF) | External references (xrefs) inserted as `XREF\|layer`, IMAGE entities drawn |
| KiCad | Sub-sheet navigation with per-instance references, `.kicad_pro` → schematic and board, custom `.kicad_wks` |
| SolidWorks | **3D assembly** from the stored placements (2015+ files need no part files; 2014 files use the parts you give) |
| EPLAN | Macros drawn (`.ema` `.emp`, macros inside `.edz`); `.elk` + `.edb` folder → project properties, pages, parts list |

### File Preview panel

Open the **File Preview** panel in the right sidebar and use "Open file…", "Open folder…" or drag and drop: the file is
shown with the same renderers, without Orca's 50 MB editor limit (only the renderers' own limits apply, up to 1 GB), and
files outside a workspace work too. Files opened together serve as companion files. The panel needs no extra
permission.

## Install

### (a) In the Orca app (recommended)

Requires Orca **1.4.252** or later.

1. Open **Settings** → **Plugins**.
2. Choose **Add plugin** → **From a Git URL…**.
3. Paste `https://github.com/hangams84/orca-file-preview.git` into **Repository URL**, then click **Continue** → **Install**.
4. Review the access Orca shows (sandboxed UI only) and click **Enable plugin**.

Step-by-step guide with screenshots: [docs/install-guide/en.md](docs/install-guide/en.md)

For `.dwg` and `.dwt`, install `https://github.com/hangams84/orca-file-preview-dwg.git` the same way.

### (b) From the command line

```sh
# Install the latest version from GitHub (Orca 1.4.252+). Orca prints the requested access and an approval fingerprint.
orca plugin install https://github.com/hangams84/orca-file-preview
orca plugin install https://github.com/hangams84/orca-file-preview --approve <fingerprint>
# A specific version: https://github.com/hangams84/orca-file-preview#v0.4.0

# Or from a local folder
orca plugin install ./plugin
```

### (c) Release packages, executables and scripts

Download them from [GitHub Releases](https://github.com/hangams84/orca-file-preview/releases). You need a PC where Orca
1.4.248 or later is installed and has been started at least once; no administrator rights are needed. Every installer
shows the access Orca asks you to approve and approves it only after you confirm.

| OS | Executable | Scripts (zip or tar.gz package) |
| --- | --- | --- |
| Windows 10/11 | `FilePreviewSetup-<version>.exe` (menu: install · update · uninstall · status) | `installer\windows\install.cmd` |
| macOS | `File-Preview-Setup-<version>-macos.zip` → *File Preview Setup.app* | `installer/macos/Install File Preview.command` |
| macOS · Linux | `sh file-preview-setup-<version>.run [install\|update\|uninstall\|status]` | `sh installer/linux/install.sh` (Linux) |

The executables are unsigned. If Windows SmartScreen blocks one, choose *More info* → *Run anyway*; on macOS, Control-click
→ *Open* to get past Gatekeeper. Orca 1.4.248–1.4.251 have no `plugin install`, so the installers register the folder
with `plugin dev load` instead; do not delete that folder. Windows 7/8 are refused with a clear message, since Orca
needs Windows 10 or later. All options: [installer/README.md](installer/README.md)

### (d) Update and uninstall

- **Installed from the Orca app or the CLI**: find the plugin key with `orca plugin list`, then update with
  `orca plugin update <key>` and remove with `orca plugin uninstall <key>`. A Git URL install moves to the newest version tag
  when updated.
- **Executables**: the `FilePreviewSetup-<version>.exe` menu (or `/update` · `/uninstall`), `file-preview-setup-<version>.run update|uninstall`,
  or *File Preview Setup.app* on macOS.
- **Scripts**: Windows `installer\windows\update.cmd` · `uninstall.cmd`, macOS `Update File Preview.command` ·
  `Uninstall File Preview.command`, Linux `sh installer/linux/update.sh` · `sh installer/linux/uninstall.sh`.
- An update checks this repository's latest GitHub release, downloads the package, verifies its SHA-256 and reinstalls
  after your approval. The previous version is kept. `--check` (Windows: `-Check`) only reports.

## Limitations

- **50 MB read limit**: Orca hands a plugin editor at most 50 MB of a file (images and PDFs excepted; a plugin cannot change
  this, see [stablyai/orca#46775](https://github.com/stablyai/orca/issues/46775)). The plugin itself accepts up to 1 GB. Open
  larger files in the [File Preview panel](#file-preview-panel). STEP files can also be compressed with gzip and opened as
  `.stpz` (STEP usually shrinks 5–8×): `gzip -c model.step > model.stpz`.
- **CAD engine size**: OpenCascade (32-bit WebAssembly, up to 4 GB of memory) is practical up to roughly 200 MB of STEP.
  Measured on synthetic assemblies with many parts: 61 MB in 1.5 min · 189 MB in 14 min · 343 MB does not finish within
  30 min · 412 MB runs out of memory.
- **Formats that open in Source first**: Orca opens `.txt` `.csv` `.tsv` `.html` `.htm` itself, so its Source view comes
  first. Pick the preview with the view toggle.
- **What is not drawn**:
  - EPLAN: schematic pages (EPLAN's own binary object store, `.eod`/`.eox`) and symbol library graphics.
  - SolidWorks: exact B-rep geometry and drawing views are not redrawn; the stored pictures are shown instead. Hidden and
    suppressed components are listed, not drawn.
  - draw.io: stencil libraries that are not bundled (`mxgraph.aws4.*` and others) show as a dashed box with the stencil
    name; remote pictures show a placeholder.
  - Visio: formulas are not evaluated (the stored values are used). Binary `.vsd` is not supported (a clear message is shown).
  - DWF: a sheet with drawing commands the reader cannot handle shows the package's stored thumbnail and a notice.
  - DWG (separate plugin): 3D solids and regions (ACIS), raster image content, OLE objects and xrefs are not drawn; they are
    listed in a note.
  - Office: charts and SmartArt in PPTX and cell styles in spreadsheets are simplified; spreadsheets show the first 20,000
    rows. Equations, charts and OLE objects in `.hwp` show as labelled boxes.
- Mobile clients were tested with the browser harness (phone profiles, WebKit, older-engine mode), not on physical devices.

## Compatibility

Orca **1.4.248** or later; installing from the Git URL needs **1.4.252** or later. The compatibility CI installs each Orca
release fresh on Ubuntu, macOS and Windows, installs the plugin and tests it. Its results table is kept in one place
only, the Korean README: [Orca compatibility (CI)](README.md#ci-matrix). Platform test evidence: `docs/evidence/platforms/`.

## Development

```sh
npm ci
npm run vendor            # bundle third-party libraries into plugin/vendor
orca plugin dev load plugin --approve <fingerprint>
npm run typecheck
node tools/harness/run.mjs --only docx,pdf --profiles desktop-dark,mobile-light
node tools/verify.mjs --round <n> && node tools/build-docs.mjs
node tools/check-readmes.mjs   # check the language bar, links and format table of all 11 READMEs
```

### Repository layout

```text
plugin/            the shipped plugin (orca-plugin.json, editor/, panel/, vendor/)
dwg-plugin/        source of File Preview DWG (GPL-3.0-or-later, separate plugin)
installer/         installer scripts for Windows · macOS · Linux
samples/           test fixtures (tools/make-samples.py and others)
tools/harness/     browser harness with an Orca-like CSP and a mock host (Playwright)
tools/verify.mjs   verification round runner (tsc, validate, unit tests, 4 harness profiles, fuzz, Orca app captures)
docs/              development and verification docs (README.md, index.html, evidence/, release-notes/)
```

Verification records and screenshots: [docs/README.md](docs/README.md) · [docs/index.html](docs/index.html). Changes:
[CHANGELOG.md](CHANGELOG.md).

## License

This project is licensed under MIT ([LICENSE](LICENSE)). Bundled libraries keep their own licenses:
[plugin/THIRD_PARTY_NOTICES.md](plugin/THIRD_PARTY_NOTICES.md).
**File Preview DWG** for `.dwg` and `.dwt` is a separate plugin under GPL-3.0-or-later and is not part of this MIT plugin.
