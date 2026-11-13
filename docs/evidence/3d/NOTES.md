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
| `.glb` | glTF 2.0 binary with embedded buffers and textures | three `GLTFLoader` | main thread (after a yield) | **Draco** works through the pure-JS (asm.js) decoder in `vendor/draco/` (no WebAssembly, no eval) and runs in a blob worker. **meshopt** needs WebAssembly. Without `'wasm-unsafe-eval'` (the harness CSP), it shows a friendly `meshopt` message. Other required extensions that three does not support (such as `KHR_texture_basisu`) get a `gltf-extension` message. |
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
| `orca plugin test` (from a copy on C:) | ✅ 88/88, including the new `model3d/format.test.ts` and `model3d/parse.test.ts` |
| Harness: desktop-dark, desktop-light, mobile-light, tablet-dark (`harness/`) | ✅ 52/52, ready in 0.8–1.1 s |
| Harness `--no-raf` (`harness-no-raf/`) | ✅ 13/13: models are drawn without animation frames |
| Harness `--engine webkit`, desktop-dark and mobile-light (`harness-webkit/`) | ✅ 26/26: Playwright WebKit has WebGL 2, so every model renders (no `webgl` fallback was needed) |
| Harness `--old-engine`, mobile-light (`harness-old-engine/`) | ✅ 13/13: the bundle and the worker do not depend on `structuredClone`, `findLast` or `Promise.withResolvers` |
| Fuzz (`node tools/make-fuzz.mjs`; 92 damaged 3D files: truncated, bit-flipped, zeroed, random, empty) (`harness-fuzz/`) | ✅ 92/92 settle (23 still render, 69 show a friendly error), with no hangs or page errors |
| Interaction (`node tools/harness/model3d-interact.mjs`) (`interact/`) | ✅ 18/18, see below |

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
