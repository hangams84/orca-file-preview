# Changelog

All notable changes per release. Each release on GitHub carries its verification results
(`docs/release-notes/<tag>.md`) and SHA-256 checksums for every file.

## [Unreleased] → 0.2.0

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
- `.doc` files from other Word versions: page size, margins, spacing, line spacing, indents and pagination.
- Word list bullets showed as empty boxes on Linux/macOS (Symbol-font characters).
- Installers hung when Orca was not running (Windows); Orca 1.4.248–1.4.251 have no `plugin install` — the
  folder is registered with `plugin dev load` there.

## [0.1.0] — 2026-11-12

First verified release: read-only previews for `.docx` `.doc` `.pptx` `.ppt` `.xlsx` `.xlsm` `.xls` `.ods` `.pdf`
`.txt` `.log` `.csv` `.tsv` `.html` `.htm` `.xhtml` `.svg` `.gif` `.bmp` in Orca 1.4.248+, on desktop and
browser/mobile clients. Five verification rounds (63 issues found, all high/medium fixed); final round 10/10
checks. [Release](https://github.com/hangams84/orca-file-preview/releases/tag/v0.1.0)

[Unreleased]: https://github.com/hangams84/orca-file-preview/compare/v0.1.0...main
[0.1.0]: https://github.com/hangams84/orca-file-preview/releases/tag/v0.1.0
