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

## Round 2 fixes

- **R2-10 page counter** (`pdf.ts`): the current page is the page whose top edge is nearest the viewport top; it is
  always 1 when scrolled to the very top and N at the very bottom (checked on a phone viewport: top → 1, bottom of
  `sample-large.pdf` → 300; `sample-slides.pdf` fits the phone screen, so it stays at 1).
- **R2-11 backdrop** (`media/image-view.ts`, `image.ts`, `svg.ts`): a "Background" select (light checker, dark checker,
  white, black) for GIF/BMP/SVG, remembered per kind (`image`, `svg`) in localStorage (wrapped in try/catch; without
  storage it lasts for the view). Defaults: SVG = light checker regardless of theme (black SVG text stays readable);
  GIF/BMP = checker following the theme until the person picks one. Verified: choice survives a reload.
- **R2-12 error codes**: `PreviewError` codes are now short — `pdf`, `pdf-password`, `image-format`, `image-decode`,
  `svg`; the sentence moved to the hint. Any other pdf.js load failure is wrapped as `pdf` with a "may be damaged" hint.
- **Fuzz** (`node tools/make-fuzz.mjs && node tools/harness/run.mjs --dir samples/fuzz --fuzz --no-shots
  --profiles desktop-dark --timeout 15000 --only pdf,gif,bmp,svg,html`, results in `fuzz-results.md`): every damaged
  file settles (0 timeouts) with **0 page errors** (was 5 for `sample-large.flip.pdf`, 15 for `sample-large.zero.pdf`).
  - Cause of the page errors: pdf.js 6.5's worker prefetches page dictionaries (`Catalog.getPageDict`:
    `pageDictCache.put(kid, xref.fetchAsync(kid))`) and never handles the failed fetches, so damaged objects became
    unhandled `FormatError` rejections in the worker, which Playwright reports as page errors. The worker is now started
    from `plugin/editor/renderers/media/pdf-worker.js` (hand-written, 20 lines), which imports
    `vendor/pdf.worker.min.js` and turns unhandled rejections whose name is a pdf.js parse error (`FormatError`,
    `XRef*Exception`, `InvalidPDFException`, …) into `console.warn`. Other errors are untouched.
  - `pdf.ts`: a page whose `getPage()` fails (damaged page tree / xref entry) shows the per-page "Cannot draw this page"
    message instead of rejecting; a damaged page 1 falls back to A4 placeholder size; the background size pass skips
    unreadable pages; the draw queue never stops on one bad page.
  - The 11 remaining fuzz "FAIL" rows are only the harness's own `*.pdf` painted-pixels check (`no page canvas was
    drawn` / `page canvas is blank`) firing on fuzzed PDFs that correctly end in the error state (truncated files with
    no trailer) or whose damaged first page legitimately draws blank. That check lives in `tools/harness/run.mjs`
    (out of my scope this round); it should be skipped under `--fuzz` or when the state is `error`.
- Verification: normal run 24/24 and `--no-raf` run 24/24 (`--only pdf,gif,bmp,svg,html --profiles
  desktop-dark,mobile-light`); `npx tsc -p plugin --noEmit` passes.

## Round 3

### ResizeObserver loop errors
Every `ResizeObserver` in `plugin/editor` did layout work synchronously in its callback, which can resize the
observed box again in the same frame (scrollbars appearing after a re-fit, a CSS variable widening a bar) and makes
the browser report "ResizeObserver loop completed with undelivered notifications". All five now only schedule the
work (`setTimeout(0)`, coalesced, cleared on cleanup) and skip it when the size did not change:
- mine: `renderers/pdf.ts` (refit + visibility refresh), `renderers/media/image-view.ts` (refit);
- others' (minimal, same pattern): `renderers/csv.ts` (filter-bar `--vw`, now also skipped when unchanged and set once
  up front), `renderers/ppt.ts`, `renderers/pptx.ts` (refit). `sheet.ts`/office have no ResizeObserver.
Headless Chrome did not reproduce the error even before the change (it is timing dependent), so this is preventive;
`tools/harness/theme-switch.mjs` now listens for that ErrorEvent (Playwright reports it neither as pageerror nor
console) while resizing the viewport 1280→700→1280 on every fixture: 0 occurrences.

### Live theme switching — `tools/harness/theme-switch.mjs` (+ `tools/harness/lib.mjs`, shared server copy)
Opens every fixture dark, calls `window.__setTheme('light')`, waits 300 ms, resizes, screenshots both
(`docs/evidence/media/theme/<file>.1-dark.png` / `.2-light.png`). Fails when the toolbar or page background did not
change, when toolbar text contrast is < 4.5:1 (disabled controls exempt), or on ResizeObserver-loop errors; text in
the content area outside document paper with contrast < 4.5:1 is listed as a warning. **42 / 42 pass.**
- Finding: no renderer keeps stale theme colours (all chrome uses `--orca-*` CSS variables; the image backdrop follows
  `ctx.onTheme`). The only failure was contrast: `muted-foreground` on `muted` is 4.40:1 in the light theme.
  Fixed the type badge in `plugin/editor/core/ui.ts` (shared, one line: badge text uses `--orca-foreground`) and the
  HTML "Safe preview" notice in `html.ts`.
- Remaining content warnings (others' areas, same 4.40:1 muted-on-muted pattern): sheet column/row headers
  (`sheet.ts` `th`, xlsx/xls/ods), the ".doc/.ppt is actually …" notes (`fp-format-note` / `fp-doc-note` in
  doc/ppt renderers); `sample.ppt`/`sample-ppt97.ppt` grey slide text is document content (3.4:1 as authored).

### Keyboard and accessibility — `tools/harness/a11y.mjs --keys`
- Content area is focusable (shell `tabIndex=0`); clicking a page/image focuses it.
- PDF (`pdf.ts`): PageDown/Space and PageUp/Shift+Space scroll one screen, Home/End go to page 1 / N, n/j p/k step
  pages, `+`/`=`, `-`, `0` zoom (new `renderers/media/keys.ts`); keys are ignored while typing in the page box or any
  field. Image/SVG/HTML: `+`/`-`/`0` zoom too; HTML also inside the preview frame (plain and Ctrl variants).
- Core fix (`plugin/editor/core/ui.ts` `stepZoom`, shared): above the 800 % table end, "+" returned 800 % — a small SVG
  fitted at 1047 % zoomed *out* on "+". It now keeps stepping ×1.25 beyond the table (and ÷1.25 below 10 %).
- Audit: every button/select/input/link in all 42 fixtures has an accessible name; **42 / 42 pass**, no gaps in other
  renderers. Results: `docs/evidence/media/a11y/results.md`.

Verification: `npx tsc -p plugin --noEmit` passes; media harness 24/24 normal and 24/24 `--no-raf`.

### Security addendum (S-1, S-2, S-3, S-5) — `plugin/editor/renderers/html.ts`
- **S-1** fragment links: `decodeURIComponent` is wrapped; an undecodable fragment (`#%E0%A4%A`) is treated as not
  found (no uncaught URIError).
- **S-2** the srcdoc iframe now carries `sandbox="allow-same-origin"` (constant `FRAME_SANDBOX`; set it to `null` to
  return to the unsandboxed frame if Orca does not render it). No `allow-scripts`, `allow-popups`, `allow-forms` or
  `allow-top-navigation`. Link interception, zoom and keys still work (the parent wires the same-origin document);
  Chrome now also blocks form submission at the sandbox level. Renders in the harness — **needs confirmation in Orca**.
- **S-3** CSS: a stylesheet or `style` attribute where decoding CSS escapes and dropping comments reveals more
  loading tokens (`url(`, `image-set(`, `image(`, `cross-fade(`, `@import`) than its plain text is dropped entirely
  (`@\69mport`, `u\72l(`, `@im/**/port`, `\75 rl(`); `image-set()` / `-webkit-image-set()` with non-data images
  become `none`. New fixture `samples/xss-css-escapes.html`: all five vectors removed, the data: background kept.
- **S-5** http(s) links show a bar with the full URL and Open / Cancel; `orca.shell.openExternal` is called only
  from the Open click (verified with a stubbed shell: nothing opened before confirming, the URL after; the frame
  stayed at `about:srcdoc`). Without `orca.shell` the bar shows the address and Close
  (`security-link-confirm.desktop-light.png`).
- Proof: fp-legacy's harness with its `XSS_CHECK` on fp-legacy's `xss-*` fixtures plus mine: **14 / 14** normal and
  **14 / 14** `--no-raf` (desktop-dark + mobile-light), `docs/evidence/media/security/`. (Run against fp-legacy's
  files before master has them; they are not committed on this branch.) Media harness 34/34 normal and `--no-raf`
  (the html/svg filter also matched the xss fixtures at that time).

## Round 4

- **#2 old engines (HIGH).** `tools/vendor/pdf.entry.js` and the worker copy in `tools/build-vendor.mjs` now use
  `pdfjs-dist/legacy/build/` (`npm run vendor`: `pdf.js` 436 → 491 KB, `pdf.worker.min.js` 1242 → 1296 KB; no eval
  path: the only `Function("return this")` is core-js's fallback when `globalThis` is missing; `isEvalSupported: false`
  unchanged). The legacy build's core-js covers `Map#getOrInsertComputed`, `Math.sumPrecise`, `Uint8Array.fromBase64`
  etc. but **not** `Promise.withResolvers` (30 call sites), `Array#findLast` or `structuredClone`, so
  `plugin/editor/renderers/media/pdf-polyfills.js` (plain JS) adds those three; it is imported first by `pdf.ts` and by
  the worker entry `media/pdf-worker.js`.
  - Harness `--old-engine` (`tools/harness/run.mjs`): an init script deletes `Promise.withResolvers`,
    `Map#getOrInsertComputed`/`getOrInsert`, `Math.sumPrecise`, `Uint8Array.fromBase64`/`fromHex`/`#toBase64`/`#toHex`,
    `Array#findLast`/`findLastIndex` and `structuredClone` before page scripts, and wraps `Worker` so every worker
    (module or classic) first runs the same deletions from a blob, then loads the real script (no eval).
  - Proof: modern build + `--old-engine` → every PDF fails (`Promise.withResolvers is not a function`); legacy build
    without the worker polyfill → `sample.pdf` hangs on the worker error (shows the worker stripping works); legacy
    build + polyfills → media formats **38/38** (`old-engine/`) and **all fixtures 102/102** (`old-engine-all/`).
- **#6 (MEDIUM)** `pdf.ts`: `if (signal.aborted) return` after `await pump()`; every await in pdf.ts is followed by an
  abort check, and cleanup registered by `mount()` after the render was superseded runs immediately (`onCleanup`), so
  no observer, timer or listener can outlive the document.
- **#7 (MEDIUM)** cleanup zeroes every page canvas (also evicted, replaced, cancelled or never-attached canvases) to
  free iOS canvas memory at once, and calls `pdfDocument.destroy()` in addition to `loadingTask.destroy()`.
- **#8 (LOW)** `image.ts`: abort check after `await createGifPlayer(...)`; `gif-player.ts` also returns early when the
  render was aborted during `ImageDecoder.isTypeSupported`.
- **#9 (LOW)** `html.ts`: a persistent `load` listener wires every document the iframe loads (first load, and after
  Source → Preview), instead of wiring whatever document exists when the 3 s wait ends.
- Verification (desktop-dark + mobile-light unless noted): media `--only pdf,gif,bmp,svg,html` 38/38 normal, 38/38
  `--no-raf`, 38/38 `--old-engine`; all fixtures `--old-engine` 102/102; fuzz (desktop-dark) 113/113
  (`fuzz/`); xss 16/16 normal and 16/16 `--no-raf` (`security/`); `npx tsc -p plugin --noEmit` passes.

## Round 5: image "off-centre at 125 %" report

- **Cause: not a defect.** A temporary `[fp-diag]` log run in Orca (Windows 11, build 4fbf30f) showed a 2053-px-wide
  editor pane, `devicePixelRatio` 1, in-body `<style>` applied, image box at 707/272 = centred. The evidence image
  was a fixed 1685-px crop of that pane (removed from master). The diagnostic is removed again.
- **Kept as low-risk hardening** (the 3D renderer did hit a lost-stylesheet case, so media no longer depends on it):
  - `media/image-view.ts` (+ `gif-player.ts`): stage, box, image/canvas layers and backdrops are inline styles; the fit
    uses the content area's displayed box clipped to the visible viewport, and refits on window and visualViewport
    resize and again 60 ms / 400 ms after load.
  - `pdf.ts` page boxes, canvases and the page box width, and `html.ts` wrapper/iframe have inline critical layout.
  - Remaining renderer CSS (pdf, html, source view) is installed once in `document.head` (`media/styles.ts`), like
    core's `installStyles`, instead of an in-body `<style>`.
- **Harness** (`tools/harness/run.mjs`): `--strip-styles` removes every renderer `<style>` after load (keeps core's),
  and every gif/bmp/svg must be centred (±3 %) and fitted, at load and after the pane shrinks to 70 %×80 %. The old
  image-view fails it at DPR 1.25 (SVG at 15.7 %/15.9 %, GIF overflowing); the new one passes.
- Verification, `--only pdf,gif,bmp,svg,html`, desktop-dark + mobile-light: normal 38/38, `--no-raf` 38/38,
  `--old-engine` 38/38, `--engine webkit` 38/38, `--strip-styles --dpr 1,1.25,1.5` 114/114, `--dpr 1.25,1.5` 76/76;
  `npx tsc -p plugin --noEmit` passes.
