# occt-import-js (STEP / IGES / BREP)

- `occt-import-js.js` and `occt-import-js.wasm` come from the npm package
  [occt-import-js](https://www.npmjs.com/package/occt-import-js) **0.0.23**, unchanged. They are copied by `tools/build-vendor.mjs` from
  `node_modules/occt-import-js/dist/`.
  - Source code: https://github.com/kovacsv/occt-import-js (tag v0.0.23).
  - OpenCascade Technology source code: https://github.com/Open-Cascade-SAS/OCCT.
- **Licences:**
  - occt-import-js is under the GNU Lesser General Public License 2.1: `license.occt-import-js.txt`.
  - OpenCascade Technology is under LGPL-2.1 with the Open CASCADE exception: `license.occt.txt`.
- **Replacing the library:** both files are separate and replaceable. To use another build, put a compatible
  `occt-import-js.js` and `occt-import-js.wasm` in this folder. The plugin loads them at run time; nothing is linked into
  the plugin's own code.
- **Run-time adaptation:** `editor/renderers/model3d/occt-worker.js` fetches `occt-import-js.js` as text. Before running
  it from a `blob:` URL, the worker replaces two Emscripten/embind code-generation calls (`new Function`) with the
  closure-based equivalents that Emscripten emits for `-sDYNAMIC_EXECUTION=0`. This is needed because the plugin frame's
  Content Security Policy forbids evaluating strings as code. The file on disk is not changed; the exact replacements
  are listed in that worker file.
