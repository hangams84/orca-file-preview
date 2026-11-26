# Third-party software

`vendor/` bundles these libraries (built by `tools/build-vendor.mjs` in the repository). Each keeps
its own license; the license texts are included in the bundles' trailing comments
(`legalComments: 'eof'`) and in the projects' repositories.

| File | Project | Version | License |
| --- | --- | --- | --- |
| `vendor/pdf.js`, `vendor/pdf.worker.min.js`, `vendor/pdf-assets/` | [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 6.5.438 | Apache-2.0 |
| `vendor/docx.js` | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) | 0.4.1 | Apache-2.0 |
| `vendor/docx.js` (bundled dependency) | [JSZip](https://github.com/Stuk/jszip) | 3.10.x | MIT (dual MIT / GPL-3.0; used under MIT) |
| `vendor/sheet.js` | [SheetJS Community Edition](https://sheetjs.com) (`xlsx`) | 0.20.3 | Apache-2.0 |
| `vendor/purify.js` | [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.17 | Apache-2.0 (dual Apache-2.0 / MPL-2.0; used under Apache-2.0) |
| `vendor/zip.js` | [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT |
| `vendor/metafile.js` | [rtf.js](https://github.com/tbluemel/rtf.js) — WMFJS only (WMF → SVG) | 3.0.9 | MIT |
| `vendor/tiff.js` | [UTIF.js](https://github.com/photopea/UTIF.js) (`utif`) | 3.1.0 | MIT |
| `vendor/tiff.js` (bundled dependency) | [pako](https://github.com/nodeca/pako) | 1.0.x | MIT (dual MIT / Zlib) |
| `vendor/three.js` | [three.js](https://github.com/mrdoob/three.js) (core subset, loaders STL/OBJ/PLY/GLTF/3MF/FBX/COLLADA/DRACO, OrbitControls, RoomEnvironment, BufferGeometryUtils) | 0.179.1 | MIT |
| `vendor/three.js` (bundled dependency of the 3MF/FBX loaders) | [fflate](https://github.com/101arrowz/fflate) (copy shipped in three.js) | 0.8.x | MIT |
| `vendor/meshopt.js` | [meshoptimizer](https://github.com/zeux/meshoptimizer) decoder (copy shipped in three.js) | three 0.179.1 | MIT |
| `vendor/occt/occt-import-js.js`, `vendor/occt/occt-import-js.csp.js` (modified copy), `vendor/occt/occt-import-js.wasm` | [occt-import-js](https://github.com/kovacsv/occt-import-js) (OpenCascade Technology compiled to WebAssembly) | 0.0.23 | LGPL-2.1 (occt-import-js); OCCT: LGPL-2.1 with the Open CASCADE exception. Shipped unchanged, plus `occt-import-js.csp.js`, a modified copy in which two `new Function` code-generation calls are swapped for closures (CSP, see `vendor/occt/README.md`); licence texts in `vendor/occt/license.*.txt`; see `vendor/occt/README.md` |
| `vendor/draco/draco_decoder.js` | [Draco](https://github.com/google/draco) glTF decoder, asm.js build (copy shipped in three.js) | three 0.179.1 | Apache-2.0 |

`vendor/pdf-assets/cmaps/` and `vendor/pdf-assets/standard_fonts/` come from `pdfjs-dist` and carry
their own notices (Adobe CMap resources under the BSD-3-Clause license; Foxit/Liberation fonts under
their respective licenses), included in those folders where provided by the package.

The SolidWorks and EPLAN readers (`editor/renderers/prop/`) bundle no third-party code. The LZMA / LZMA2
decoder is written from the LZMA specification in the public-domain LZMA SDK (Igor Pavlov). The SolidWorks
container and display-mesh layouts follow the facts documented at
[blussyya/sldprt-format-research](https://github.com/blussyya/sldprt-format-research) (CC BY-SA 4.0 notes;
no text or code copied). EDZ and EPLAN project structure were read from public files (see
`docs/evidence/prop/README.md`).
## Data embedded in source files

| File | Content | Source | License |
| --- | --- | --- | --- |
| `editor/renderers/kicad/newstroke.ts` | Subset of the **newstroke** stroke font (KiCad's default font): Latin, Latin Extended, Greek, Cyrillic, arrows, math and technical symbols (1,788 glyphs). The CJK glyphs (derived from Source Han Sans, OFL-1.1) are **not** included. | Glyph data by Vladimir Uryvaev and KiCad contributors, as converted to JavaScript by [KiCanvas](https://github.com/theacodes/kicanvas) (`src/kicad/text/newstroke-glyphs.ts`, MIT, © 2023 Alethea Katherine Flowers); extracted by `tools/kicad/extract-newstroke.mjs` | Newstroke: CC0 1.0 (per the font's own README); KiCanvas conversion: MIT |

The KiCad preview's stroke-font layout (`editor/renderers/kicad/font.ts`) follows KiCanvas's port of KiCad's
`STROKE_FONT` (MIT). No KiCad (GPL) source code is included; KiCad file formats are read from their public
documentation and from files written by KiCad.

