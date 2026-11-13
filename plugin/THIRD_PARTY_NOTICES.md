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
| `vendor/three.js` | [three.js](https://github.com/mrdoob/three.js) (core subset, loaders STL/OBJ/PLY/GLTF/3MF/FBX/COLLADA/DRACO, OrbitControls, RoomEnvironment, BufferGeometryUtils) | 0.179.1 | MIT |
| `vendor/three.js` (bundled dependency of the 3MF/FBX loaders) | [fflate](https://github.com/101arrowz/fflate) (copy shipped in three.js) | 0.8.x | MIT |
| `vendor/meshopt.js` | [meshoptimizer](https://github.com/zeux/meshoptimizer) decoder (copy shipped in three.js) | three 0.179.1 | MIT |
| `vendor/draco/draco_decoder.js` | [Draco](https://github.com/google/draco) glTF decoder, asm.js build (copy shipped in three.js) | three 0.179.1 | Apache-2.0 |

`vendor/pdf-assets/cmaps/` and `vendor/pdf-assets/standard_fonts/` come from `pdfjs-dist` and carry
their own notices (Adobe CMap resources under the BSD-3-Clause license; Foxit/Liberation fonts under
their respective licenses), included in those folders where provided by the package.
