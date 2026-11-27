# Companion files and the File Preview panel

**What.** An Orca editor receives only the opened file (no path, no file system, no network) and at most 50 MB.
The preview frame can still read files the user hands it: the 📁 toolbar button (a folder; Shift: single
files) or a drop. With these "companion" files the Robot, 3D and CAD Drawing previews load meshes, xacro
includes, `.mtl`/textures, glTF buffers/images and DXF xrefs/images. The **File Preview panel** (right sidebar)
opens any supported file itself, so neither the 50 MB limit nor the workspace boundary applies.

**How measured.**
- Samples: `node tools/make-companion-samples.mjs` → `samples/companions/` (all generated, MIT).
- Browser harness with the Orca frame CSP: `node tools/harness/companions.mjs` → `harness/` (screenshots,
  `results.json`). Companion files go in through Playwright's file chooser on the folder input
  (`webkitdirectory`) and through a synthetic `DataTransfer` drop. The panel runs from the same harness page
  (`?panel=1&entry=panel/main.ts`); its 150 MB STL (3,000,000 triangles) is generated under `.orca/large/`.
- Unit tests (`orca plugin test`): `core/refs.test.ts`, `renderers/urdf/include.test.ts`,
  `renderers/cad2d/dxf/xref.test.ts`, `renderers/meshfiles.test.ts`, `panel/files.test.ts`.
- Real Orca 1.4.277 (Windows 11, Korean UI): a test copy (`local.file-preview-comp3d`: the 3D, Robot and CAD
  editors plus the panel) dev-loaded; `orca plugin open --editor`, `orca plugin shot --window` / `--panel`,
  `orca plugin logs` → `orca/` (left 285 px cropped).

## Fidelity

| Case | Without files | With files | Evidence |
| --- | --- | --- | --- |
| `robot.urdf.xacro` (includes `$(find demo_bot)/urdf/macros.xacro` → `inertia.xacro`, `parts/wheel.xacro`) | 2 links, includes and macros listed, hint to pick the package folder | 3 includes read, 5 links / 4 joints / 3 DOF, 5/5 meshes (binary STL ×0.001 with URDF `steel`, ASCII STL, Z-up DAE with its texture, OBJ + MTL + texture) | `harness/xacro-folder-*.png`, `orca/xacro-editor-ko.png` |
| `robot.urdf` (package://, `../meshes/…`, `file:///opt/ros/…`, a missing `package://other_pkg`) | 4 placeholders | dropped files: 3/4 meshes replace placeholders live, lidar listed as missing, `arm_joint` pose kept | `harness/urdf-drop-*.png` |
| OBJ + `mtllib` + `map_Kd` texture | neutral material, note names `model.mtl` | MTL colour and texture | `harness/obj-mtl-*.png`, `orca/obj-editor-ko.png` |
| glTF + external `.bin` + image | friendly refusal naming `model.bin`, 📁 button | renders from blob: buffer and blob: image | `harness/gltf-bin-*.png`, `orca/gltf-editor-ko.png` |
| DAE + texture | note names `checker.png` (white pixel stands in) | texture drawn | `harness/dae-texture-*.png` |
| DXF: xref `parts\bolt.dxf`, xref `C:\Projects\std\title.dxf`, IMAGE `images\logo.png` | notice lists both xrefs and the image; image frame only | bolt inserted twice (scale/rotation), layer `BOLT\|BOLT`; logo drawn; only `title.dxf` left in the notice | `harness/dxf-xref-*.png`, `orca/dxf-editor-ko.png` |
| Panel: "Open folder…" on `ros_pkg` | — | lists previewable files; the xacro opens with includes and 5/5 meshes | `harness/panel-folder-*.png`, `orca/panel-empty-ko.png` |
| Panel: drop `main.dxf`, then drop `bolt.dxf` + `logo.png` on the drawing | — | first drop opens, second adds the references | `harness/panel-drop-dxf.png` |
| Panel: 150 MB (143.1 MiB) binary STL via "Open file…" | Orca's editor refuses files over 50 MB | renders, 3,000,000 triangles, < 1 s after the file is read | `harness/panel-large.png` |

All harness cases also check: no page errors, no console errors, no CSP violations (blob: images and
`fetch(blob:)` buffers are allowed by the frame CSP; no blob: scripts are used). Result: see `harness/results.json`.

## Not covered / limits

- The editor never learns the opened file's path. Relative references resolve by path tail; when the picked folder
  holds the opened file itself (same bytes), its real place is used, which disambiguates same-named files.
- xacro: `xacro:include ns="…"` is expanded without the namespace (a note says so); glob patterns in include names
  are not expanded.
- glTF meshes in a URDF with Draco/meshopt compression are not decoded there (they are in the 3D Preview).
- DXF: an xref that is not supplied stays an empty block (listed in the notice). TIFF rasters are not decoded
  (listed as not usable).
- Real Orca: the native file dialog and a real drag and drop need a person; see the manual steps below.

## Manual steps in Orca (native dialog and drop)

1. `orca plugin dev load <copy of plugin/ with id file-preview-comp3d>` (approve the printed fingerprint).
2. `orca file open D:/500_dev_ws/orca-plugin-creator/fp-comp3d/samples/companions/ros_pkg/demo_bot/urdf/robot.urdf.xacro --worktree path:D:/500_dev_ws/orca-plugin-creator --focus`
   (switch the tab to the preview with the view toggle if it opens in Source). Click 📁 in the preview toolbar and
   choose `samples/companions/ros_pkg` in the folder dialog (confirm Chrome's "upload N files" prompt). Expect 5
   links, "5 meshes loaded" bottom left, joint sliders kept.
3. Open `samples/companions/dxf/main.dxf`, drag the `samples/companions/dxf` folder from Explorer onto the drawing:
   the bolts and the logo appear; the notice keeps only `title.dxf`.
4. Right sidebar → File Preview panel (file icon): "폴더 열기…/Open folder…" → `samples/companions/ros_pkg` → pick
   `robot.urdf.xacro`. Then "파일 열기…/Open file…" on a file over 50 MB (e.g. `.orca/large/large-150mb.stl`, made by
   the harness): it renders.
5. `orca plugin logs local.file-preview-comp3d` shows no errors; `orca plugin dev unload <dir>`.
