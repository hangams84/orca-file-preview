# vendor/libredwg

LibreDWG compiled to WebAssembly, from the npm package
[`@mlightcad/libredwg-web`](https://www.npmjs.com/package/@mlightcad/libredwg-web) **0.9.4**
(source: <https://github.com/mlightcad/libredwg-web>, tag `v0.9.4`, commit `15feb51bd853d99892cbe18be842e29a06b404ce`;
a fork of GNU LibreDWG <https://www.gnu.org/software/libredwg/>, <https://github.com/LibreDWG/libredwg>).

Licence: **GPL-3.0-or-later** (GNU LibreDWG) / GPL-3.0 (libredwg-web). The full licence text is
[`../../LICENSE`](../../LICENSE).

| File | What | Modified |
| --- | --- | --- |
| `libredwg-web.wasm` | LibreDWG built with Emscripten (`wasm/libredwg-web.wasm` of the package) | no |
| `libredwg.js` | the package's JavaScript wrapper (`dist/libredwg-web.js`) and Emscripten glue (`wasm/libredwg-web.js`) bundled into one ES module by esbuild, not minified | **yes**, see below |
| `libredwg-patches.mjs` | the exact text replacements applied to the glue | — |
| `VERSION` | package version | — |

## Modification (GPL-3.0 section 5a)

Orca runs plugin editors under a Content Security Policy without `unsafe-eval`. The Emscripten
embind glue builds two kinds of small wrapper functions from source text with `new Function`
(`createJsInvoker` and `__emval_create_invoker`), which that policy refuses. `libredwg-patches.mjs`
replaces both with closures that do the same work (the code Emscripten emits with
`-sDYNAMIC_EXECUTION=0`). Nothing else differs from the package; the WebAssembly is unchanged.
Modified on 2026-11-26 for File Preview DWG.

## Corresponding source (GPL-3.0 section 6)

- LibreDWG + the JavaScript bindings: <https://github.com/mlightcad/libredwg-web/tree/v0.9.4>
  (build steps in `bindings/javascript/README.md` of that tree: `pnpm build:prepare`, `build:obj`,
  `build:wasm`, `build`).
- The modification: `libredwg-patches.mjs` in this folder.
- How this folder is produced: in the File Preview repository, `npm install` then
  `node tools/build-dwg-vendor.mjs` (esbuild bundle of `@mlightcad/libredwg-web` with the patch applied,
  wasm copied as is).

If any of these links stops working, ask the plugin's maintainer for the source; it will be provided
under the same licence for at least three years after the last release of this plugin.
