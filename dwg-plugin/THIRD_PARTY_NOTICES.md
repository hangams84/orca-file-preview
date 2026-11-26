# Third-party notices — File Preview DWG

File Preview DWG is licensed under the **GNU General Public License v3.0 or later** (see
[`LICENSE`](LICENSE)). It ships or contains the following third-party work.

## GNU LibreDWG — GPL-3.0-or-later

- What: the DWG reader, compiled to WebAssembly (`vendor/libredwg/libredwg-web.wasm`)
- Copyright © Free Software Foundation, Inc. and the LibreDWG contributors
- Source: <https://www.gnu.org/software/libredwg/>, <https://github.com/LibreDWG/libredwg>
- Licence: GNU General Public License v3.0 or later — [`LICENSE`](LICENSE)

## @mlightcad/libredwg-web 0.9.4 — GPL-3.0

- What: the WebAssembly build of LibreDWG and its JavaScript wrapper (`vendor/libredwg/libredwg.js`,
  `vendor/libredwg/libredwg-web.wasm`)
- Copyright © MLight Lee and contributors
- Source: <https://github.com/mlightcad/libredwg-web> (tag `v0.9.4`)
- Licence: GNU General Public License v3.0 — [`LICENSE`](LICENSE)
- **Modified**: the Emscripten glue's two `new Function` code-generation sites are replaced by
  closures so it runs under Orca's Content Security Policy. Details, the patch and the
  corresponding source: [`vendor/libredwg/README.md`](vendor/libredwg/README.md).

## File Preview (shell and UI helpers) — MIT

- What: `editor/core/i18n.ts`, `editor/core/types.ts`, `editor/core/ui.ts` and the shell in
  `editor/main.ts`, copied from the File Preview plugin (`plugin/` of the same repository) so this
  plugin installs on its own
- Copyright © 2026 won geon
- Licence: MIT (GPL-compatible; used here under GPL-3.0-or-later):

```
MIT License

Copyright (c) 2026 won geon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Not included

AutoCAD and DWG are trademarks of Autodesk, Inc. This plugin is not affiliated with or endorsed by
Autodesk. No Autodesk or Open Design Alliance code is used.
