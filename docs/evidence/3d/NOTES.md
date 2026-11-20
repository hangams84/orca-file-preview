# 3D Preview (`model3d`): notes and results

The custom editor `model3d` ("3D Preview", contentKind `bytes`, frame `any`) shows 3D models read-only.
The renderer is `plugin/editor/renderers/model3d.ts`. It uses the pure helpers in `model3d/format.ts`,
the geometry parsers in `model3d/parse.js` and the parse worker `model3d/worker.js`.

## Formats

| Suffix | Variant | Parser | Where it parses | Notes |
| --- | --- | --- | --- | --- |
| `.stl` | binary and ASCII (detected by content, so a binary header that starts with `solid` is fine) | three `STLLoader` | Web Worker | Shown flat at first; the smooth toggle merges shared corners and averages their normals (up to 3 M triangles). Per-facet `COLOR=` colours are kept. Z-up at first. |
| `.obj` | `v x y z [r g b]` vertex colours, lines, points | three `OBJLoader` | Web Worker | `.mtl` and texture files are separate files, so they are not loaded. A neutral material is used and a note says so. |
| `.ply` | ASCII and binary (LE/BE), vertex colours, meshes and point clouds | three `PLYLoader` | Web Worker | A file with no faces is drawn as a point cloud. |
| `.off` | `OFF` `COFF` `NOFF` `CNOFF` `STOFF`, polygons, vertex or face colours (0–1 or 0–255) | own parser (`parseOFF`) | Web Worker | Polygons become triangle fans. Z-up at first. |
| `.glb` | glTF 2.0 binary with embedded buffers and textures | three `GLTFLoader` | main thread (after a yield) | **Draco** works through the pure-JS (asm.js) decoder in `vendor/draco/` (no WebAssembly, no eval) and runs in a blob worker. **meshopt** works through the meshoptimizer decoder (WebAssembly, allowed in Orca's frames; fixture `sample-meshopt.glb`). If WebAssembly is ever unavailable, it shows a friendly `meshopt` message. Other required extensions that three does not support (such as `KHR_texture_basisu`) get a `gltf-extension` message. |
| `.gltf` | JSON with `data:` URIs only | three `GLTFLoader` | main thread | When it points to an external `.bin` or image, it shows the friendly `gltf-external` message ("export a self-contained .glb"). Nothing is fetched. |
| `.3mf` | core spec, base materials | three `ThreeMFLoader` (uses fflate and DOMParser) | main thread | Z-up at first. |
| `.fbx` | binary and ASCII, version 7000 and later | three `FBXLoader` (no eval) | main thread | External textures are swapped for a white pixel and counted in a note. Missing normals are computed. |
| `.dae` | COLLADA 1.4/1.5 | three `ColladaLoader` | main thread | External textures behave as for FBX. The loader applies `up_axis`. |

Every loader runs behind a `LoadingManager` URL modifier. `data:` and `blob:` URLs pass through. Any other
URL is never requested: it becomes a 1×1 white PNG and is listed in the note.

## UI

- **Mouse:** left-drag orbits, right-drag or shift-drag pans, and the wheel zooms toward the cursor.
- **Touch:** one finger orbits; two fingers pinch to zoom and pan.
- **Keyboard:** arrow keys orbit once the canvas has focus, and F fits the model to the view.
- **Toolbar:**
  - ⤢ fit (resets the camera to the bounding sphere)
  - ▦ wireframe
  - ◆ flat/smooth shading
  - \# grid and axes (off by default)
  - Z↑ Z-up/Y-up (Z-up at first for STL, 3MF and OFF)
  - ⟳ auto-rotate (off by default, hidden on phones)
  - background: theme, light or dark. The choice is remembered in localStorage when storage works.
- **Info line:** format · triangles · vertices · bounding-box size "(units as stored)" · file size.
- **Lighting:** a RoomEnvironment PMREM at intensity 0.45, a hemisphere fill and a headlight that follows the camera, so the side facing the viewer is always lit.
- **Rendering on demand:** OrbitControls' `change` schedules one animation frame. A 120 ms timer stands in when no animation frames run. The first frame is drawn synchronously, so hidden or occluded windows (`--no-raf`) still show the model. When idle, no frames run (measured: 0 `requestAnimationFrame` calls in 1.5 s). Only auto-rotate runs a loop.
- **Cleanup on abort:**
  - renderer dispose plus `forceContextLoss`
  - geometries, materials, textures, the environment map and the helpers
  - OrbitControls
  - pending frame and timer, the auto-rotate loop
  - ResizeObserver
  - parse worker terminate
  - Draco workers

## Limits

| Limit | Value | Behaviour |
| --- | --- | --- |
| File size | 768 MB | `too-large` before parsing |
| Triangles (desktop / phone) | 12 M / 4 M | `too-many-triangles`. For binary STL, PLY and OFF the check uses the header counts before parsing; other formats are checked after parsing. |
| Smooth-shading weld | 3 M triangles | Above this, the toggle changes only the material's flat flag. |
| Worker parse time | 60 s | Fails with `model-parse`. |
| Pixel ratio | 2 (1.5 above 2 M triangles) | Caps the fill cost on phones. |
| WebGL missing | — | `webgl` friendly message, before any parsing. |
| Wrong content or cut-off file | — | `model-format` (sniffed by content) or `model-parse` |

## Library and license

- **three.js 0.179.1** (MIT), pinned with `npm i -D -E three@0.179.1`.
  - `tools/vendor/three.entry.js` builds `plugin/vendor/three.js` with esbuild: tree-shaken, minified, **718 KB**.
  - The parse worker imports the same bundle.
  - `@types/three@0.179.0` is used for type checking only, through `vendor/three.d.ts`. That package pulls in `@webgpu/types`, which clashes with TypeScript 7's lib.dom, so `plugin/tsconfig.json` sets `skipLibCheck`.
- **meshoptimizer decoder** (MIT, copied from three.js): `vendor/meshopt.js`, **22 KB**.
  - It is a separate bundle that loads only for `EXT_meshopt_compression`, because it compiles WebAssembly as soon as it is imported.
- **Draco glTF decoder, asm.js build** (Apache-2.0, copied from three.js): `vendor/draco/draco_decoder.js`, **500 KB**.
- `plugin/THIRD_PARTY_NOTICES.md` lists all three. None of them contains `eval` or `new Function`; checked with grep on the built files.

## Fixtures

`node tools/make-3d-samples.mjs` writes the fixtures with hand-written writers that take geometry from three.js. `--perf N` writes `samples/perf/large-*.stl`, which is git-ignored.

| File | Size | Content |
| --- | --- | --- |
| `sample.stl` | 75 KB | binary, trophy cup, Z-up, mm |
| `sample-ascii.stl` | 161 KB | ASCII torus knot |
| `sample.obj` | 120 KB | bumpy ball with vertex colours plus a `mtllib` line (the note appears) |
| `sample.ply` | 125 KB | binary torus with rainbow vertex colours |
| `sample.off` | 1 KB | dodecahedron with face colours |
| `sample.glb` | 78 KB | textured sphere (embedded PNG) on a metallic base |
| `sample-embedded.gltf` | 104 KB | same as `sample.glb`, with `data:` URIs |
| `sample-draco.glb` | 23 KB | same as `sample.glb`, Draco-compressed (encoded with three's Draco encoder in Node) |
| `sample.3mf` | 1 KB | house, two base materials |
| `sample.fbx` | 57 KB | ASCII FBX 7.4 torus knot, Phong material, no normals in the file |
| `sample.dae` | 143 KB | COLLADA torus, Phong material |
| `broken.stl` | 0.4 KB | header says 5,000 triangles but the data ends after 7, giving `model-format` |
| `broken.glb` | 0.1 KB | cut inside the JSON chunk, giving `model-parse` |

## Results (Windows 11, Chrome 157, Playwright WebKit)

| Check | Result |
| --- | --- |
| `tsc --noEmit` | ✅ |
| `orca plugin validate` / `orca plugin check` | ✅ valid, no issues |
| `orca plugin test` (from a copy on C:) | ✅ 134/134 (all plugin tests), including `model3d/format.test.ts` with the CAD detection tests and `model3d/parse.test.ts` |
| Harness: desktop-dark, desktop-light, mobile-light, tablet-dark (`harness/`), 20 3D/CAD fixtures with the centring check | ✅ 80/80, ready in 0.8–1.3 s |
| Harness `--dpr 1.25,1.5,1.75`, desktop-dark and mobile-light (`harness-dpr/`) | ✅ 120/120 |
| Harness `--no-raf` (`harness-no-raf/`) | ✅ 20/20: models are drawn without animation frames |
| Harness `--engine webkit`, desktop-dark and mobile-light at DPR 1 and 1.25 (`harness-webkit/`) | ✅ 80/80: Playwright WebKit has WebGL 2, so every model renders (no `webgl` fallback was needed). The first run of the matrix had 2 flaky failures, an element-screenshot snapshot error and WebKit running out of WebGL contexts in its shared process; the re-run passed 80/80. |
| Harness `--old-engine`, mobile-light (`harness-old-engine/`) | ✅ 20/20: the bundle and the workers, CAD included, do not depend on `structuredClone`, `findLast` or `Promise.withResolvers` |
| Fuzz (`node tools/make-fuzz.mjs`; 139 damaged 3D and CAD files: truncated, bit-flipped, zeroed, random, empty) (`harness-fuzz/`) | ✅ 139/139 settle, with no hangs or page errors |
| Interaction (`node tools/harness/model3d-interact.mjs`) (`interact/`) | ✅ 24/24, see below (CAD: quality switch, parts list, 17 MB STEP) |

The interaction checks in `interact/results.json`:

- No frames while idle.
- Wireframe, smooth, grid, Z-up, background and fit each change the picture, and fit returns exactly to the first frame.
- Mouse drag and wheel work.
- Auto-rotate runs about 30 frames per 0.5 s and stops completely.
- A theme switch repaints.
- Touch: one-finger orbit and two-finger pinch, with no horizontal overflow on phones.
- With WebGL disabled, the friendly message shows with `code: webgl`.
- **Large mesh:** `samples/perf/large-2M.stl` (2,000,000 triangles, 95 MB) is ready in about 1.5 s. The longest main-thread stall is about 330–360 ms, which is the buffer copy plus the GPU upload; parsing runs in the worker. One orbit step draws in about 110 ms.

I looked at the screenshots: every fixture is visible, lit, centred and fitted in both themes and on phones. The texture shows on the GLB, glTF and Draco files. Vertex and face colours show on the OBJ, PLY and OFF files, and material colours on the 3MF, FBX and COLLADA files.

Found and fixed during the checks:

- The FBX fixture has no normals and rendered black. Normals are now computed for any mesh without them.
- OBJ files without `vn` lines now count as faceted, so the smooth toggle works on them.

### WebGL absence

Both harness engines here have WebGL 2: Chrome uses ANGLE/D3D11 and Playwright WebKit uses its Metal-backed path. So the `webgl` path was exercised by disabling `getContext('webgl*')` in the interaction script.

On real old engines that have WebGL 1 but no WebGL 2 (iOS before 15), three r17x cannot create a renderer. The preview catches that and shows the same `webgl` message.

### Not covered

- Real Orca app captures. `orca plugin shot` and window captures were not run for this area.
- glTF animations and skinning: the preview shows the static pose.
- Textures referenced from OBJ, FBX and COLLADA files: they are separate files, so they are not loaded.
- KTX2/Basis textures: no transcoder is vendored.

## Fix: model off-centre in Orca at 125 % display scaling

### Symptom

In the real Orca app (Windows 11, display scaling 125 %, devicePixelRatio 1.25), the model was drawn about 1.2× too large and pushed towards the bottom-right of the pane. `sample.glb` sat at about 58 %/67 %, and `sample.stl` about 61 % across. Screenshots: `orca-sample.glb.window.png` and `orca-sample.stl.window.png` in this folder.

### Cause

The canvas was displayed at its **drawing-buffer** size instead of the pane's size: 1685×905 CSS px in a 1348×724 pane, which is 1.25×. Two things combined:

- Its `width: 100%; height: 100%` came only from the renderer's injected `<style>`, and in Orca's frame that rule did not take effect.
- `setSize(w, h, false)` does not set a style.

The overflow-hidden pane then cropped the oversized canvas from the top-left. That is exactly the shift seen in Orca.

I reproduced it with the new interaction case `DPR 1.25 without our stylesheet`, which removes the renderer's in-body `<style>` at DPR 1.25. The old renderer gives canvas 1685×905 in pane 1348×724, with the model centre at 62.5 %/66 % for the GLB and 62.5 %/57 % for the STL. DPR alone, with the stylesheet working, does not reproduce it.

A second, smaller problem showed up too. The fit centred the 3D bounding box rather than the drawn outline, so even in the harness the GLB's outline sat at 57.7 % vertically because of the perspective.

### Fix (`renderers/model3d.ts`)

1. The stage and canvas sizes are pinned **inline** (`position:absolute; inset/left/top 0; width/height 100%`), so no host stylesheet can let the canvas fall back to its buffer size.
2. The drawing-buffer size is computed from the canvas's own displayed box (`getBoundingClientRect`) times the pixel ratio. `camera.aspect` is updated in the same place. A ResizeObserver watches both the pane and the canvas.
3. Until the person moves the camera, every resize re-fits the model. This covers a pane that gets its final size after the first draw.
4. The fit frames the model's **projected outline** instead of its bounding sphere:
   - It projects up to 20,000 sampled vertices and runs six iterations.
   - It centres the outline exactly and fills 75 % of the shorter side of the pane.
   - The orbit target becomes the outline's centre.

### Checks

- `tools/harness/run.mjs` has two additions:
  - A `--dpr 1.25,1.5,1.75` option, which runs every profile at those device pixel ratios.
  - For every 3D fixture, a pixel-based centring check. It takes a real screenshot of the pane and finds the bounding box of the non-background pixels. The centre must be within 3 % of the pane centre, both at load and after the viewport shrinks to 70 %×80 %.
- `model3d-interact.mjs` has the stylesheet-removal case above. The old renderer fails it; the new one passes: 50.0 %/50.0 % before and after the resize, and the canvas box equals the pane.

The coordinator still needs to confirm the fix in the real Orca app. It is still unknown why the injected `<style>` loses in Orca's frame, and the inline sizes make the canvas independent of that. Other renderers that put a `<style>` inside the content area (for example `media/image-view.ts`) may be worth checking in Orca for the same reason.

## CAD: STEP / IGES / BREP (OpenCascade)

The user reported that STEP files would not open. The 3D Preview now also reads CAD boundary-representation (B-rep) files:
`.step` and `.stp` (AP203, AP214 and AP242), `.iges` and `.igs`, and `.brep` (OpenCascade's own text format).

### Library and licence

- **occt-import-js 0.0.23** ([source](https://github.com/kovacsv/occt-import-js)): OpenCascade Technology (OCCT) compiled to WebAssembly. Pinned with `npm i -D -E`.
  - It ships unmodified as separate, replaceable files in `plugin/vendor/occt/`: `occt-import-js.js` (95 KB) and `occt-import-js.wasm` (7.4 MB).
  - Licences: **LGPL-2.1** for occt-import-js; LGPL-2.1 with the Open CASCADE exception for OCCT. The licence texts sit next to the files, and `vendor/occt/README.md` and `THIRD_PARTY_NOTICES.md` give the source links and the version.
- **Run-time adaptation.** The library's Emscripten "embind" glue builds two kinds of wrapper functions with `new Function`. Orca's frames, like the harness, forbid evaluating strings as code, so the engine failed to start with "Evaluating a string as JavaScript violates … CSP".
  - `occt-worker.js` fetches the script as text and swaps those two call sites for the closure-based code that Emscripten itself emits with `-sDYNAMIC_EXECUTION=0`.
  - It then runs the result from a `blob:` URL, which `script-src blob:` allows.
  - The `.wasm` is fetched from the plugin's own files and passed in as `wasmBinary`, so the server's MIME type does not matter.
  - Nothing is downloaded from the network.

### How it works

- **Worker.** `renderers/model3d/occt-worker.js` is a classic worker. It loads the engine, reads the file, tessellates it, and converts the result to typed arrays, which it transfers to the page. Per-face colours become per-vertex colours.
- **Model tree.** The page builds a three.js group tree from the result's node hierarchy (assemblies and parts), with the mesh colours, and reuses the whole viewer: fit, orbit, wireframe, grid and axes, backgrounds, centring.
- **Progress and time limit.**
  - While loading, the spinner text shows the phase (loading the engine, reading and triangulating, preparing the view) with elapsed seconds.
  - The time limit is 20 s plus 5 s per MB, at most 5 minutes. After that the worker is terminated and the friendly `cad-timeout` message suggests the Coarse setting.
- **Errors.** A STEP/IGES/BREP file OpenCascade cannot read gives `cad-read`; an engine that cannot start gives `cad-engine`.
- **Toolbar.**
  - A tessellation-quality picker: Coarse, Normal or Fine. Each is a deflection relative to the model's bounding box (linear deflection 0.004, 0.001 or 0.0003; angular deflection 0.8, 0.5 or 0.25 rad). Normal is the default and the choice is remembered. Changing it re-tessellates in place without duplicating toolbar buttons.
  - A ☰ parts list with a visibility checkbox per part plus an "All" checkbox.
  - A ? help panel.
  - Info line: `STEP · triangles · vertices · N parts · X × Y × Z mm · size`. STEP and IGES are converted to **mm**; BREP shows "units as stored".
- **Z-up** at first, as for STL and 3MF.

### Orca opens STEP in its Source view first

The coordinator checked this in Orca 1.4.258: STEP files are ASCII, so Orca sniffs them as text and opens them in its Source view. The preview is reached with the view toggle at the tab's top right, as for `.txt` and `.csv`. IGES and BREP are text too and will behave the same.

The renderer does not depend on how it was opened: the toggle mounts the same editor with the same bytes. This is documented in `README.md`, `installer/README.md`, and the preview's own ? help panel.

### Fixtures

The fixtures are made from scratch by `tools/make-cad-samples.py`, using OpenCascade 8.0 through `cadquery-ocp` at generation time only. They carry this repository's licence; the sources and SHA-256 hashes are in `FIXTURES.md`.

| File | Size | Content |
| --- | --- | --- |
| `sample.step` | 164 KB | AP214 assembly: plate, 4 bolt instances and a bracket, named and coloured |
| `sample-ap203.stp` | 93 KB | AP203 single part, no colours |
| `sample-ap242.step` | 39 KB | AP242 part with per-face colours |
| `sample.igs` | 14 KB | IGES 5.3, coloured |
| `sample.brep` | 4 KB | revolved shaft |
| `broken.step` | 31 KB | cut off in its DATA section, giving `cad-read` |

`--perf` writes `samples/perf/large-assembly.step` (git-ignored): **17.3 MB**, 144 distinct filleted parts, 289,008 triangles.

### Results

Per-file reading and tessellating in the worker (Chrome, Windows 11):

| File | Read and tessellate |
| --- | --- |
| `sample.step` | 0.3 s |
| `sample-ap203.stp` | 0.08 s |
| `sample.igs` | 0.03 s |
| Engine start (once per preview) | about 0.1 s |

The **17.3 MB assembly** is ready in 13.8–16.5 s at Normal quality. The longest main-thread stall is 174–204 ms (the UI stays responsive), and one orbit step takes about 110 ms. Coarse/Normal/Fine on `sample.step` give 996 / 1,868 / 3,984 triangles.

All harness runs include the centring check and cover the 3D and CAD fixtures. Results are in the main results table above, plus:

| Check | Result |
| --- | --- |
| All 77 fixtures in `samples/` (every renderer) with the new harness CSP | ✅ 77/77 |

The PNGs show every CAD sample visible, lit and centred:

- The assembly's plate is blue, the bolts steel and the bracket orange.
- The AP242 part shows red faces on grey.
- The IGES flange is green.
- The BREP shaft is neutral grey.

### Harness CSP now allows WebAssembly

The coordinator verified that Orca 1.4.258 allows `WebAssembly.instantiate` in plugin editor frames and in their workers: blob:, classic and module. The earlier "no wasm" finding came from the harness's own CSP. `tools/harness/run.mjs` and `lib.mjs` now use `script-src 'self' blob: 'wasm-unsafe-eval'`; everything else is unchanged.

Consequences:

- meshopt glTF now renders (`sample-meshopt.glb`).
- pdf.js may use its WebAssembly image decoders.
- All 77 fixtures still pass.

`'unsafe-eval'` stays off, so `new Function` and eval remain forbidden, as in Orca.

### Plugin size

- The `plugin/` folder is **15.9 MB in 307 files** (excluding the generated `.orca/` types). The largest single file is the 7.4 MB `.wasm`.
- Orca's limits are 50 MiB in total, 2,000 files, and 16 MiB per script.
- `orca plugin validate plugin` ✅ valid.

### Limits

- STEP AP242 PMI, tolerances and textures are not shown; only the geometry and colours are.
- Very large assemblies (hundreds of MB) can run out of WebAssembly memory. The 2 GB wasm32 limit gives a friendly `cad-engine` or `cad-timeout` message.
- Binary BREP (BinTools) is not supported; only text BREP is.
