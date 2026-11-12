# Media renderers: PDF, GIF/BMP, SVG, HTML

Area `media`, branch `fp-media`. Harness:
`node tools/harness/run.mjs --out docs/evidence/media --only pdf,gif,bmp,svg,html --profiles desktop-dark,mobile-light`
→ **24 / 24 passed** (see `results.md`; the filter also matches `sample-html.doc` from the legacy area), and
**24 / 24 with `--no-raf`** (`no-raf/results.md`). `npx tsc -p plugin --noEmit` passes. Paths below are now under `plugin/`.

## What was built

| File | Purpose |
| --- | --- |
| `editor/renderers/pdf.ts` | pdf.js viewer: lazy pages, text layer, page nav, zoom, password prompt |
| `editor/renderers/image.ts` | GIF / BMP (also sniffs PNG/JPEG by magic bytes) |
| `editor/renderers/svg.ts` | SVG as an inert `<img>`, Source toggle |
| `editor/renderers/html.ts` | Sanitized HTML in an `srcdoc` iframe, Preview/Source toggle |
| `editor/renderers/media/image-view.ts` | Shared image stage: checkerboard, fit, zoom anchored on centre, drag-pan, GIF delay parser |
| `editor/renderers/media/gif-player.ts` | GIF pause/play via WebCodecs `ImageDecoder` |
| `editor/renderers/media/source-view.ts` | Line-numbered source view (chunked like `text.ts`), switchable zoom |
| `tools/vendor/pdf.entry.js` → `vendor/pdf.js` + `vendor/pdf.d.ts` | pdf.js 6.5.438 display layer (436 KB) |
| `vendor/pdf.worker.min.js` | pdf.js worker (1.24 MB, copied by `build-vendor.mjs`) |
| `vendor/pdf-assets/{cmaps,standard_fonts,wasm}` | all 168 packed bcmaps (1.1 MB), standard fonts (0.8 MB), JBIG2/OpenJPEG/QCMS wasm + JS fallbacks (0.9 MB) |
| `tools/vendor/purify.entry.js` → `vendor/purify.js` + `vendor/purify.d.ts` | DOMPurify 3 (30 KB) |
| `docs/evidence/media/make-pdf-fixtures.mjs` | Generates `sample-large.pdf` and `sample-password.pdf` (no dependencies) |

Shared-file change: `tools/build-vendor.mjs` gained a ~20-line block that copies pdf.js `cmaps/`, `standard_fonts/`
and `wasm/` (minus QuickJS) into `vendor/pdf-assets/` so the assets regenerate with `npm run vendor`.

## Libraries and licenses

- **pdf.js** (`pdfjs-dist` 6.5.438): Apache-2.0. cMaps: Adobe, BSD-3-Clause (`vendor/pdf-assets/cmaps/LICENSE`);
  standard fonts: Foxit (BSD-style) and Liberation (SIL OFL 1.1), license files copied alongside; wasm decoders:
  license files copied in `vendor/pdf-assets/wasm/`.
- **DOMPurify** 3.x: Apache-2.0 OR MPL-2.0.

## Features

**PDF**
- Module worker via `GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.js', import.meta.url)`;
  pdf.js falls back to its main-thread "fake worker" (it imports the same module) when a worker cannot start.
- `isEvalSupported: false`, `enableXfa: false`, `cMapPacked: true`; `cMapUrl`, `standardFontDataUrl` and `wasmUrl`
  point at `vendor/pdf-assets/` (resolved from `import.meta.url`). Korean text in `sample.pdf` (LibreOffice export)
  and `sample-slides.pdf` renders correctly.
- Bytes are copied before `getDocument` (pdf.js transfers the buffer to its worker; `ctx.bytes` stays intact).
- Every page is a correctly sized placeholder (page 1's size first, the real sizes of the rest filled in the
  background); an IntersectionObserver (±50 % of the view) draws pages one at a time, nearest the current page first,
  into `devicePixelRatio` canvases (capped at 16 MP per page for iOS). At most 12 canvases are kept; far ones are
  released. `render()` resolves after page 1 is drawn.
- Text layer (pdf.js `TextLayer`, scaled by CSS variables so zoom does not rebuild it): selectable, copyable text.
- Toolbar: ‹ [page input] / N ›, keys `n`/`p` (or `j`/`k`) when the content has focus, size info, zoom
  (−, %, +, 1:1, fit width). Ctrl+wheel, Ctrl +/−/0 and pinch zoom. While zooming, canvases stretch at once; visible
  pages re-render at the new scale 150 ms after the last change. Zoom keeps the same spot of the current page in view.
- Default zoom: fit width on phones (`ctx.compact`), `min(fit width, 100 %)` on desktop; refits on resize until the
  person zooms by hand. Mixed portrait/landscape documents fit the current page; wider pages scroll sideways inside
  the content area (no page overflow).
- Password-protected PDFs: inline password form (render returns so the shell leaves the loading state); a wrong
  password shows "Incorrect password", the right one opens the document (verified with `sample-password.pdf`, `1234`).
- Damaged / non-PDF input: `PreviewError` "Cannot open this PDF" (broken.pdf ends in the error state). A page that
  fails to draw shows a per-page message instead of failing the whole document.

**GIF / BMP**
- `<img>` from a blob URL (GIF animates natively), magic-byte sniffing, decode failure → friendly error.
- Checkerboard behind transparency (theme-aware tones), centred; fit to window (not upscaled initially); zoom by
  buttons, Ctrl+wheel, pinch and keys, anchored on the view centre; pixelated rendering at ≥ 250 %; pan by scrolling or
  mouse drag.
- Toolbar info: `W × H · size · GIF · N frames`.
- GIF pause/play (multi-frame GIFs where `ImageDecoder` exists): a canvas player takes over at the estimated current
  frame and then plays with the GIF's own frame delays.

**SVG**
- `<img src=blob:image/svg+xml>`: scripts, event handlers and external loads inside the SVG never run
  (`sample.svg`'s `<script>` does not run; the harness check passes).
- Intrinsic size from width/height/viewBox (parsed with DOMParser as inert XML; 300×150 fallback). Same stage as
  images, fit to window including upscaling (vectors stay sharp). Non-UTF-8 SVGs are re-encoded as UTF-8 for the
  image decoder.
- "Source" toggle: line-numbered XML (decoded with `core/encoding.ts`) with its own font zoom. A malformed SVG shows
  the source with a "cannot draw" note instead of a dead end.

**HTML**
- Decoding: BOM, then `<meta charset>` / `http-equiv Content-Type` in the first 1 KiB, then `core/encoding.ts`
  detection (`sample-euckr.html` is EUC-KR declared via http-equiv).
- DOMPurify (`WHOLE_DOCUMENT`) strips scripts, event handlers and `javascript:` URLs; it also forbids `base, link,
  meta, iframe, frame(set), object, embed, portal` and `action, formaction, target, ping, http-equiv`. Hooks drop every
  non-`data:`/`blob:` resource URL (`src`, `srcset`, `poster`, `background`, `href` on SVG `image`/`use`), rewrite
  non-link `<a href>` to `#`, and neutralise CSS `url(...)` / `@import` in `<style>` and `style=""`.
- Shown in an `<iframe srcdoc>` without a sandbox attribute (what renders in Orca). The document gets its own CSP meta
  (`default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; …`) and
  a white paper default, so its CSS cannot reach the toolbar.
- Link clicks are intercepted: `#anchor` scrolls inside the preview, `http(s)` calls `orca.shell?.openExternal` when
  available, nothing navigates the frame (verified: the frame stays at `about:srcdoc`). Form submission is prevented.
- Dismissible notice: "Safe preview: N script(s) not run · M external or relative resource(s) not loaded".
- Toolbar: Source/Preview toggle (line-numbered source), encoding · size, zoom (CSS zoom of the preview document;
  Ctrl+wheel also works inside the frame).

## Known limitations

- pdf.js 6 uses `Promise.withResolvers` and CSS `round()`: it needs a Chromium ≥ 125 / Safari ≥ 17.4 class engine
  (Orca's Electron is fine; very old mobile browsers are not supported).
- No PDF annotation layer (links and form fields inside PDFs are not clickable), no outline/thumbnail sidebar, no
  search, no rotation control.
- Without `'wasm-unsafe-eval'` in the CSP, JBIG2 / JPEG 2000 images use pdf.js' JS fallbacks (slower, but they work).
- Page sizes after page 1 are learned in the background; with mixed page sizes, pages above the view can shift
  slightly while that pass runs.
- HTML: pinch inside the iframe is the browser's own (toolbar buttons and Ctrl+wheel work); Ctrl +/−/0 only work when
  focus is outside the frame. Relative images/styles are not shown (no network, by design). Chrome logs a CSP report
  "Executing inline event handler violates…" while DOMPurify parses markup containing `on*=` attributes (DOMParser,
  inert document): nothing runs, it is only a console message (it shows as `errors=1` in results.md, still PASS).
- GIF pause needs WebCodecs `ImageDecoder` (Chromium; Safari partially); elsewhere GIFs animate without a pause
  button. The first paused frame is estimated from elapsed time (can be off by a frame); finite loop counts are
  treated as looping.
- BMP variants Chrome cannot decode (rare RLE/OS2 types) end in the friendly error.

## Fixtures → result (desktop-dark + mobile-light)

| Fixture | What it exercises | Result |
| --- | --- | --- |
| `sample.pdf` | LibreOffice docx export, Korean (CID font + cMaps), table, image | ✅ ✅ |
| `sample-slides.pdf` | Landscape slides, Korean | ✅ ✅ |
| `sample-large.pdf` (new) | 300 pages, page 5 landscape: lazy drawing, eviction, mixed sizes | ✅ ✅ |
| `sample-password.pdf` (new) | RC4-40 encrypted, password `1234`: prompt, retry, unlock | ✅ ✅ |
| `broken.pdf` | 17 bytes, not a PDF → friendly error | ✅ ✅ (error state) |
| `sample.gif` | 12-frame animation, pause/play | ✅ ✅ |
| `sample.bmp` | 640×360 BMP, fit to window | ✅ ✅ |
| `sample.svg` | Gradient, Hangul text, embedded `<script>` must not run | ✅ ✅ |
| `sample-viewbox.svg` (new) | viewBox-only size, transparency, external `<image>`, `javascript:` link | ✅ ✅ |
| `sample.html` | `<script>` and `onerror` must not run, styles, link | ✅ ✅ |
| `sample-euckr.html` (new) | EUC-KR via http-equiv, CSS url/relative/remote images, form, `javascript:` link, iframe | ✅ ✅ |

Extra interaction screenshots (scripted with Playwright against `run.mjs --serve`, desktop 1280×800):
`interact-password-unlocked`, `interact-large-p150-zoomed` (jump to page 150, then 150 %),
`interact-large-p5-landscape-fit`, `interact-svg-source`, `interact-html-source`, `interact-gif-paused-zoomed`.
After scrolling 30 screens through `sample-large.pdf`, 12 canvases were alive (eviction works); clicking an http link
left the frame at `about:srcdoc`.

## Round 1 fix: R1-1 PDF pages blank in Orca (hidden/occluded window)

**Cause.** Orca captures (and users see) the frame while its window is hidden or occluded, where
`requestAnimationFrame` and `IntersectionObserver`/`ResizeObserver` callbacks are paused. The PDF viewer marked pages
visible only from IntersectionObserver, and pdf.js paces `intent: 'display'` renders with rAF, so page 1 stayed a
numbered placeholder.

**Fix (`plugin/editor/renderers/pdf.ts`).**
- Visibility is computed from geometry (`scrollTop` vs. page `offsetTop`, ±½ screen, binary search, the current page
  always included) on first layout, on every scroll event, on resize (ResizeObserver **and** `window` `resize`), after
  zoom and when background page sizing changes a page. IntersectionObserver is only an extra trigger.
- Before each page render a probe asks for one animation frame; if none arrives within 100 ms (or
  `document.visibilityState === 'hidden'`), the page renders with `intent: 'print'`, which pdf.js runs without rAF.
  Effect of `print`: annotations are drawn by their Print flag instead of NoView, and optional content uses its print
  state; for ordinary documents the output is identical. When frames run again, later renders use `display`.
- The page counter no longer waits for rAF: the scroll handler updates it directly (a binary search per event).
- `vendor/pdf.d.ts` declares `intent`.

**Other renderers.** `image.ts` / `svg.ts`: the initial fit was already synchronous; `media/image-view.ts` now also
refits on `window` `resize` (ResizeObserver is paused while hidden) and `loadImage()` resolves on the `load` event as
well as `decode()`. `html.ts` waits for the iframe `load` event (with a 3 s timeout), which is not paced by rendering.

**Proof.** `tools/harness/run.mjs` gained `--no-raf` (shared file, small change): an init script replaces
`requestAnimationFrame` with a no-op and `IntersectionObserver` with a class that never calls back; the harness also
polls its ready state with a 100 ms interval instead of rAF. New check for every `*.pdf` fixture (except `broken.*`
and the password one): the first page canvas must contain non-white pixels (`page canvas is blank` /
`no page canvas was drawn` otherwise).
- Before the fix, `--no-raf`: `sample.pdf` and `sample-slides.pdf` FAIL (`timeout`, `no page canvas was drawn`).
- After the fix: normal run 24/24, `--no-raf` run 24/24 (`docs/evidence/media/no-raf/`), all PDFs painted.
- Scripted under the same stubs on `sample-large.pdf`: scrolling 5000 px drew pages 5–6 and moved the counter to 5,
  jumping to page 200 drew 199–200, zooming re-rendered at the new size
  (`no-raf/interact-norf-large-p200-zoomed.desktop-dark.png`).
