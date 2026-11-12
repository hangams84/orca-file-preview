# Security review: HTML / SVG / image previews and HTML-or-RTF text in .doc (round 3)

**Scope:** `plugin/editor/renderers/html.ts`, `svg.ts`, `image.ts`, `media/**`, the DOMPurify bundle (`plugin/vendor/purify.js`, DOMPurify 3.4.17), and in my own area `legacy/sniff.ts` `readHtmlText`, `legacy/rtf.ts` and the CSV table.
**Threat model:** a malicious file opened in Orca must not run script in the plugin frame (which holds `orca.*`: storage, settings, `shell.openExternal`, `files.saveAs`). It also must not navigate the frame, exfiltrate data, or spoof or cover the Orca toolbar.
**Method:** six fixtures carry every vector (below). If a payload ever runs, it appends its id to `top.document.body.dataset.pwned`, sets `document.title = 'XSS'` and appends the text `PWNED`.
The harness check for `xss-*` files (`tools/harness/run.mjs`, `XSS_CHECK`) works in four steps:
1. It clicks, focuses and hovers every link, button, input and details element in all same-origin frames.
2. It waits, then fails on any marker in the top document or any same-origin frame, or on a top-level navigation.
3. In the sanitized preview document it also fails on leftovers: `on*` attributes, `javascript:`/`vbscript:`/`data:text/html` URLs, `script`/`iframe`/`object`/`embed`/`base`/`link`/`portal`, `meta refresh`, and `<animate|set attributeName=href|on*>`.
4. It fails if anything covers the toolbar, checked with `elementFromPoint` and with fixed elements mapped from the frame.

A positive control (a fixture with `data-pwned` and the marker text) failed as expected, so the check does detect markers.

## Results

`node tools/harness/run.mjs --only xss- --profiles desktop-dark,mobile-light`, normal and `--no-raf`. Output is in `docs/evidence/legacy/security/` (`results.md`, `results-noraf.md` and screenshots).

| Fixture | desktop-dark | mobile-light | --no-raf (both) |
| --- | --- | --- | --- |
| `xss-vectors.html` (43 vectors) | ❌ `pageerror: URI malformed` (finding S-1); no marker | ❌ same | ❌ same |
| `xss-fragments.html` (8 raw-text / foreign-content vectors) | ✅ | ✅ | ✅ |
| `xss-vectors.svg` (13 SVG vectors) | ✅ | ✅ | ✅ |
| `xss-html.doc` (HTML with script, meta refresh, handlers, javascript: link in a .doc) | ✅ | ✅ | ✅ |
| `xss-rtf.doc` (markup text + `HYPERLINK "javascript:…"` field) | ✅ | ✅ | ✅ |
| `xss-cells.csv` (markup and `=HYPERLINK("javascript:…")` in cells) | ✅ | ✅ | ✅ |

**No vector executed script, set a marker, navigated the frame, or covered the toolbar.** The only failing fixture fails on a crash (S-1), not on code execution. It stays committed as the regression test and should pass once S-1 is fixed.

## Findings

| # | Vector | Result | Severity | Recommended fix (owner: html.ts unless noted) |
| --- | --- | --- | --- | --- |
| S-1 | `<a href="#%E0%A4%A">` clicked in the HTML preview | `decodeURIComponent` in `wireFrame`'s click handler throws an uncaught `URIError` in the plugin frame (page error). No script runs, but any HTML file can make the preview throw on a click. | **Low** (robustness) | Wrap it: `let id; try { id = decodeURIComponent(href.slice(1)) } catch { id = href.slice(1) }`. |
| S-2 | srcdoc iframe **without `sandbox`** | Every vector was stopped by DOMPurify and, behind it, by the inner `<meta>` CSP (`script-src 'none'`) and the inherited plugin CSP. Defence in depth still rests on one sanitizer: a future DOMPurify bypass, or an edit that drops the meta CSP, would run same-origin with `orca.*`. | **Medium** (hardening) | Add `sandbox="allow-same-origin"` (no `allow-scripts`, no `allow-forms`, no `allow-top-navigation`, no `allow-popups`). The parent keeps `contentDocument` access for zoom and click wiring, and the browser refuses all script, form submission, navigation and popups inside the preview. |
| S-3 | CSS escapes: `@\69mport "https://…"`; `background-image: image-set('https://…' 1x)` (also `u\72l(…)`-style escapes) | Both pass the sanitizer's regex CSS filter (only literal `@import` and `url(` are matched). The fetches are **blocked by CSP** (inner `default-src 'none'` and the plugin CSP); the browser logs them as CSP violations. No exfiltration, because of CSP. | **Low** | Rely on the CSP explicitly and say so, or decode CSS escapes before matching and also neutralise `image-set(`/`-webkit-image-set(` and any quoted string containing `:` + `//` in `<style>`/`style=`. Do not count on the regex alone. |
| S-4 | `position:fixed; top:-60px; z-index:2147483647` overlay | Stays inside the preview iframe and cannot reach the Orca toolbar or the "Safe preview" note (checked by `elementFromPoint`). It can cover the top of the previewed page, so a page can draw its own fake UI inside the preview area. | **Info** | Acceptable for a preview. Optionally map `position:fixed` to `absolute` in the style hook, or add `contain: paint` on the iframe body. |
| S-5 | `http(s)` links in previewed HTML | A click calls `orca.shell.openExternal(href)` directly, so any page can steer the system browser to a lookalike URL. | **Info** | Show the target URL (title/tooltip or a confirm) before opening, or only open on Ctrl/Cmd+click. |
| S-6 | Inert parsing (`DOMParser` in `legacy/sniff.ts` `readHtmlText`, `svg.ts` `svgSize`, DOMPurify) | Chrome logs "Executing inline event handler violates CSP" for `on*` attributes in these **inert** documents. A probe page with **no CSP** confirmed that handlers in `DOMParser` documents never run (images do not load, no `onload`/`onerror`). These are console noise only. | **Info** | None needed. If the noise matters, strip `on*` attributes from the parsed tree before anything else touches it. |

## Vectors confirmed blocked (no change needed)

**HTML preview (`xss-vectors.html`, `xss-fragments.html`):**
- Scripts: `<script>`, `<script src=data:>`, `<svg><script>`.
- Event handlers: `img onerror/onload`, `svg onload`, `body onload`, `details ontoggle`, `input autofocus onfocus`, `video>source onerror`, `marquee onstart`.
- Script URLs: `javascript:`, `vbscript:`, `data:text/html` and entity-encoded `&#106;avascript&colon;` links (rewritten to `#`); `target=_top` (dropped).
- Frames, embeds and head elements: `iframe srcdoc`, `iframe src=javascript:`, `object data=`, `embed src=`, `meta http-equiv=refresh`, `base href`, `link rel=import|stylesheet`.
- Forms: `form action=javascript:`, `button formaction` (dropped; submit also prevented, `form-action 'none'`), `img srcset=javascript:`.
- CSS: `@import` and `url(javascript:)` (neutralised).
- SVG and MathML: `<animate attributeName=href values=javascript:>` and `<set attributeName=xlink:href>` (removed), `<a xlink:href=javascript:>`, `<use href=data:…#x>`, `<foreignObject><img onerror>`, `<maction href=javascript:>`, `<template><img onerror>`.
- DOM clobbering: `form name=getElementById`, `img name=body`, `a id=defaultView` (names stripped).
- mXSS: `<noscript><p title="</noscript><img …>">`, `<svg></p><style><a id="</style><img …>">`, `<math><mtext><table><mglyph><style><img …>`, `<form><math><mtext></form><form><mglyph><style></math><img …>`, `<math><mi><mglyph><svg><mtext><textarea><path id="</textarea><img …>">`, `<svg><style><img>`, `<math><style><img>`, `<select><template><style><img>`, `<table><caption><svg><mi><img>`, `<xmp>`, `<listing>`, `<iframe>` raw text.

**SVG (`xss-vectors.svg`):** the root `onload`, `<script>`, `<script href=data:>`, `xlink:href=javascript:`, `<animate href>`, `<set onmouseover>`, `<image onerror>`, `<use href=data:…>`, `<foreignObject><img onerror>`, `<style>@import/url()` and an XHTML `<iframe srcdoc>` are all inert. The SVG is drawn as `<img src=blob:image/svg+xml>`, which is an image document with no script and no external loads. The source view is `textContent`.

**Raster images (`image.ts`):** the MIME type comes from magic bytes (GIF/BMP/PNG/JPEG only), so an SVG or HTML payload behind a `.gif`/`.bmp` name is never given an active type.

**.doc as HTML (`xss-html.doc`) and RTF (`xss-rtf.doc`):**
- `readHtmlText` parses with `DOMParser` (inert), removes `script`/`style`/`noscript`/`template`/`head`, and copies **text only** into the paper model. The paper renderer writes runs with `textContent`.
- Links become plain text, `meta refresh` is discarded, and pictures come only from typed blobs (`image/png|jpeg|bmp`).
- RTF field instructions (`HYPERLINK "javascript:…"`) are a skipped destination; only `\fldrslt` text is shown.

**CSV (`xss-cells.csv`):** every cell is written with `textContent` (and the filter highlight with text nodes plus `<mark>`). Formula-looking cells are shown as text and never evaluated.

## Files
- Fixtures: `samples/xss-vectors.html`, `samples/xss-fragments.html`, `samples/xss-vectors.svg`, `samples/xss-html.doc`, `samples/xss-rtf.doc`, `samples/xss-cells.csv`.
- Harness: `tools/harness/run.mjs` (`XSS_CHECK`, used by `checkFor()` for every `xss-*` file).
- Evidence: `docs/evidence/legacy/security/` (results normal + `--no-raf`, screenshots).
- `html.ts`, `svg.ts`, `image.ts` and `media/**` were not edited (findings routed to their owner).
