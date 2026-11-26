# CAD Drawing Preview (DXF · DWF · DWFx) — evidence

New editor **CAD Drawing Preview** (`cad2d`) for `.dxf`, `.dwf`, `.dwfx`: pan (drag), zoom (wheel at the pointer,
pinch, toolbar buttons, `+`/`-` keys), fit (button, double-click, `0`/`f`), layer list with visibility toggles
(filter box above 12 layers), model space + paper-space layouts / sheets selector, dark/light background toggle,
line-weight toggle, and an info bar (format, version, units, extents, entity counts, layers, skipped items, cursor
coordinates). All three formats are read into one scene model and drawn by one Canvas 2D painter.

## Engine choice: own renderer, not vagran/dxf-viewer

| | vagran/dxf-viewer | own (`renderers/cad2d/`) |
| --- | --- | --- |
| Licence | **MPL-2.0** since 2021 (only the 2021 1.0.0–1.0.1x releases were MIT) — not on this plugin's permissive list | MIT (this repo) |
| Text / Hangul | glyphs tessellated with opentype.js from a **bundled font**: Hangul needs a multi-MB CJK font or a subset that misses characters | browser text with the system font stack (Malgun Gothic, Apple SD Gothic Neo, Noto Sans KR/CJK) — all Hangul, 0 bytes added |
| Binary DXF, R12 code pages | dxf-parser: ASCII only | ASCII + binary (R12 1-byte and R13+ 2-byte codes), `$DWGCODEPAGE` (ANSI_949 → EUC-KR), `\U+`/`\M+` |
| Paper-space layouts / viewports | no | yes (LAYOUT objects, VIEWPORT windows with scale, frozen layers) |
| DWF / DWFx | no | same scene model, same viewer |
| Size | ~900 KB unpacked + three.js + opentype.js + font | 198 KB of `.ts` source (13 modules), no new vendor files |

## What renders — DXF

LINE, LWPOLYLINE/POLYLINE (bulges as exact arcs, constant/varying width, 3D polylines, polyface and polygon meshes as
edges, spline-fit vertices), CIRCLE, ARC, ELLIPSE (incl. extrusion −Z), SPLINE (rational NURBS by de Boor; fit
points by Catmull-Rom), TEXT/ATTRIB/ATTDEF (alignments incl. fit/aligned/middle, width factor, oblique, mirroring,
`%%c %%d %%p %%u %%o`), MTEXT (paragraphs, word wrap incl. CJK, `\f \H \C \c \L \O \K \W \S`, attachment 1–9, line
spacing, background fill), INSERT/MINSERT (nested, scaled, rotated, mirrored, row/column arrays, ATTRIBs; layer-0 and
BYBLOCK inheritance; references stay shared, not copied), DIMENSION/ARC_DIMENSION/ACAD_TABLE (their anonymous blocks),
HATCH/MPOLYGON (polyline and edge boundaries — line, arc, ellipse, spline — even-odd islands; solid; pattern lines
from the pattern definition in the entity, clipped by the boundary; > 30 000 segments falls back to a 35 % tint;
gradients as their first colour), SOLID/TRACE/3DFACE, POINT, LEADER (with arrowhead), MULTILEADER (leader lines,
dogleg, arrowheads, MTEXT content), WIPEOUT (background fill), RAY/XLINE (drawn long, excluded from extents),
IMAGE (frame only: the picture is an external file), VIEWPORT. Layers (colour, off, frozen, linetype, lineweight),
linetypes (`LTYPE` dashes × `$LTSCALE` × entity scale), ACI and true colours, transparency, lineweights (mm, drawn
from 0.3 mm up; toggle), OCS/extrusion (arbitrary axis algorithm), `$INSUNITS`.
Not shown (listed in the info bar under "not shown"): REGION/3DSOLID/BODY/SURFACE/MESH (ACIS), OLE2FRAME, SHAPE,
TOLERANCE, external references, complex linetype shapes/text, viewport clipping by non-rectangular boundaries.
Twisted viewports (VIEWPORT 51) are rotated but the sign was not verified against AutoCAD; R12 viewports (stored in
xdata) are not shown.

## What renders — DWF / DWFx

- **DWF 6.x packages** (`(DWF V06.xx)` + ZIP): manifest → sections → descriptors; each ePlot section is a sheet
  (paper size, logical → paper transform, so coordinates and extents are in mm/in). W2D opcodes read: lines
  (16/32-bit relative, ASCII), polylines / polygons (fill mode), contour sets with holes (binary + ASCII `Contour`),
  polytriangles, Gouraud triangles/lines (flat colour), circles, arcs, ellipses (tilt), markers, text (`x` and
  `Ctrl-X` with overscore/underscore/bounds/reserved options) with the font opcode (name, height, rotation, width
  scale, oblique, bold/italic), RGBA / indexed colour, colour maps (binary + ASCII; default map built in), line weight,
  fill, visibility, layers (binary + ASCII names incl. hex UTF-16), origin, object nodes, units, viewports (parsed),
  background, images (PNG, JPEG, RGB, RGBA, mapped, indexed, bitonal; Group 3X/4 as frames), zlib-compressed
  sections. Informational opcodes are skipped silently; line/fill pattern styles are drawn solid and counted.
- **When a stream uses an opcode the reader cannot skip** (or LZ compression), the sheet shows the package's
  embedded thumbnail/preview image and a yellow notice says *only the thumbnail is shown* and why (opcode and byte);
  the info bar says "thumbnail only". 3D (eModel) sections show their icon/thumbnail with a notice; data/global
  sections are skipped.
- **Legacy single-stream DWF** (`(DWF V00.xx)`) and bare W2D streams.
- **DWFx**: OPC → FixedDocumentSequence → FixedDocument → FixedPage per sheet (page order from the package; mm, y up).
  Path (abbreviated syntax incl. arcs/beziers/H/V/relative, `F0/F1`; PathGeometry/PathFigure segments; fills, strokes,
  thickness, dashes, joins, caps), Glyphs (UnicodeString, `Indices` advances, embedded fonts incl. **obfuscated
  `.odttf`** loaded with `FontFace`, bold/italic simulations, any RenderTransform incl. shear/mirror), Canvas
  transforms and opacity, ImageBrush fills (PNG/JPEG), static resources (inline and remote dictionaries), scRGB
  colours. Not done: clips (counted, ignored), gradients (first stop), TIFF/WDP images (frame), glyph-index-only text.

## Fidelity vs. a reference renderer

`node tools/cad2d/fidelity.mjs` renders each DXF with **ezdxf's drawing add-on** (`tools/cad2d/ezdxf_ref.py`, SVG,
white background) and with this preview (light theme, 1000×750), crops both to their ink, scales to 800 px wide and
compares ink masks with a 3-px tolerance (precision = our ink near reference ink, recall = reference ink near ours).
"Colour match" = share of overlapping ink pixels with the same hue (±30°) or both grey. Per-file pictures:
reference | preview | overlay (red only reference, blue only preview) in [`fidelity/`](fidelity/).

| File | Precision | Recall | F1 | Colour | Notes |
|---|---:|---:|---:|---:|---|
| cad2d/lines-curves.dxf | 100.0 % | 100.0 % | 100.0 % | 97.0 % | lines, linetypes, lineweights, true colour, off layer, OCS −Z arc |
| cad2d/polylines-splines.dxf | 100.0 % | 99.9 % | 99.9 % | 95.9 % | bulges, widths, 2D/3D polylines, fit/control/rational splines |
| cad2d/blocks-inserts.dxf | 100.0 % | 100.0 % | 100.0 % | 88.2 % | nested, scaled, rotated, mirrored, 4×3 array, ATTRIB |
| cad2d/dimensions.dxf | 99.5 % | 100.0 % | 99.7 % | 74.9 % | linear, aligned, radius, angular (colour: ezdxf draws the dimension and extension lines black; the preview gives the dimension block's layer-0/BYLAYER entities the DIMENSION's layer colour, cyan, as AutoCAD does) |
| cad2d/hatches.dxf | 100.0 % | 100.0 % | 100.0 % | 72.5 % | solid, ANSI31 with island, NET over arc/ellipse edges, DASH, gradient (ezdxf paints the gradient black, the preview uses its first colour: blue) |
| cad2d/solid-point-leader.dxf | 99.4 % | 99.5 % | 99.5 % | 91.2 % | SOLID, TRACE, 3DFACE, POINT, LEADER, MLEADER, WIPEOUT |
| cad2d/text-mtext.dxf | 82.8 % | 84.9 % | 83.9 % | 95.8 % | glyph shapes differ (system fonts vs. ezdxf's font engine); ezdxf shows Hangul as boxes |
| sample-r12.dxf | 72.0 % | 74.7 % | 73.4 % | 77.9 % | text dominated; ezdxf draws the Korean title as boxes (□□), the preview draws Hangul |
| sample-binary.dxf | 95.6 % | 98.8 % | 97.2 % | 96.6 % | binary DXF |
| sample.dxf | 27.6 % | 9.9 % | 14.6 % | 13.3 % | not comparable: the XLINE is drawn far beyond the extents by the preview (as AutoCAD does) and clipped differently by ezdxf, so the ink boxes do not match |

LibreOffice (Draw's DXF import, `soffice --convert-to png`) was tried as a second reference: an R2018 file comes out
blank and the R12 file shows only its text, so it is not used.

## Real files (local only, not committed)

Autodesk-written DWF files from the DWF Toolkit's sample folder (github.com/kveretennicov/dwf-toolkit, `samples/`),
checked in the harness from `.orca/real/` (their licence does not allow redistributing them here):

| File | Result |
|---|---|
| `1 - IRD Addition.dwf` (DWF 6.0, 12 sheets, 890 KB, feet/inches) | all 11 ePlot sheets draw (title sheet, plans, elevations, sections; 151,927 items, text and markers), paint 1–12 ms each; global section skipped |
| `content.dwf` (DWF 6.20, "Oceanarium", inches) | draws (7,334 items incl. 357 ASCII `Contour` fills) |
| `3DPublishOut.dwf` (DWF 6.20, 2 eModel 3D sections + data section) | each 3D section shows its icon image with the "3D not supported, thumbnail only" notice; the data section is skipped |
| `ocean_90.w2d` (bare W2D stream) | draws |

## Interaction (browser harness, `node tools/cad2d/interact.mjs`): 10/10

Layer list opens with all 13 layers; turning layer HATCH off removes its ink (6961 → 4030 sampled ink pixels);
wheel zoom keeps the point under the pointer; drag pan keeps the grabbed point under the pointer; fit returns to
100 %; the selector switches to the paper-space layout `도면-A3`; background toggles light; no page errors; on a phone
profile a two-finger pinch zooms 100 % → 313 % and the layer list is an overlay inside the screen.
Screenshots: [`interact/`](interact/). All views of every sample: [`views/`](views/).

## Real Orca (1.4.263, Windows 11, dev-loaded copy `local.file-preview-cad2d` with only this editor)

`orca plugin open … --editor` + `orca plugin shot --window` (left 285 px cropped): [`orca/`](orca/) —
`sample.dwf` (sheet 1), `sample.dwfx` (incl. the obfuscated embedded font), `sample-binary.dxf` render in the plugin;
ASCII `sample.dxf` opens in Orca's Source view first (expected for text files; the preview is one view toggle away).
`orca plugin logs`: no errors. The plugin was unloaded afterwards.

## Harness and tests

- `node tools/harness/run.mjs --only .dxf,.dwf --profiles desktop-dark,desktop-light,mobile-light,tablet-dark`:
  40/40 (8 samples ready, 3 `broken.*` end in the friendly error, 4 profiles).
- Unit tests: `renderers/cad2d/dxf/dxf.test.ts` (17) and `renderers/cad2d/formats.test.ts` (10); whole plugin 166/166 (`orca plugin test`), `npm run typecheck` clean, `orca plugin check` valid.

## Performance

`python tools/make-cad2d-samples.py --perf` → `samples/perf/large.dxf` (26.6 MB ASCII R2000: 300,000 lines on 40
layers × 7 colours, 30,000 texts, 20,000 block references; git-ignored). Chromium, 1280×800: load to first paint
1.5–2.3 s; a full repaint 35–37 ms (strokes of the same style are merged across non-occluding items; text smaller
than ~1 px is skipped). Pan/zoom of heavy drawings uses the last frame as a snapshot and repaints when the gesture
rests. Orca hands an editor at most 50 MB.

## Scene model (reusable, e.g. by a DWG reader)

`plugin/editor/renderers/cad2d/scene.ts` — no DOM, no format specifics:

- `Scene { format, version?, units?, layers: SceneLayer[], blocks: Map<string, SceneBlock>, views: SceneView[],
  counts, skipped, info }`; `emptyScene(format)`.
- `SceneLayer { name, color, visible, count }`. `SceneView { name, kind: 'model'|'layout'|'sheet', items, paper?,
  background?, notice?, info? }`. `SceneBlock { name, items }`.
- `Item` = `PathItem` (`d` commands `P.M/L/C/Q/E/Z`, stroke/fill, even-odd, `width` world units, `dash` world units,
  cap/join) · `HatchItem` (boundary, solid, pattern `lines`) · `TextItem` (single line with alignment/fit/advances,
  or MTEXT `paras` with wrap/attachment/spacing) · `RefItem` (block + matrix) · `ImageItem` (decoded image + unit
  square matrix) · `PointItem` · `ViewportItem` (window onto another view with a matrix and frozen layers).
  Common: `layer` (−1 = inherit from the reference), `color` (0xRRGGBB or `C.FG/BYBLOCK/BYLAYER_INHERIT/BG`),
  `lw` (mm, −1 = BYBLOCK), `alpha`, `noExtents`.
- Helpers: matrices (`mul`, `invert`, `apply`, `translate`, `rotate`, `scale`), extents (`pathBox`, `textBox`,
  `itemsBox`, `viewBox`), `mergePaths`. `path.ts` `PathB` builds paths through an affine map (arcs exact under
  similarities). `dxf/build.ts` exports `ocsMatrix`, `nurbs`, `catmull`, `styleFamily`; `dxf/aci.ts` the ACI table.
- Drawing: `paint.ts` `paintView(ctx2d, scene, viewIndex, worldToDevice, options)`; UI: `viewer.ts`
  `showScene(previewContext, scene, { summary })`.

A DWG reader only has to produce a `Scene` (or a `DxfDoc` for `dxf/build.ts`) to get the whole viewer.

## Regenerate

```sh
python -m pip install ezdxf fonttools
python tools/make-cad2d-samples.py            # samples/*.dxf|dwf|dwfx, samples/cad2d/*.dxf
node tools/cad2d/fidelity.mjs --out docs/evidence/cad2d/fidelity samples/cad2d/*.dxf samples/sample-r12.dxf samples/sample-binary.dxf samples/sample.dxf
node tools/cad2d/interact.mjs --out docs/evidence/cad2d/interact
node tools/cad2d/shoot.mjs --out docs/evidence/cad2d/views samples/sample.dxf samples/sample.dwf samples/sample.dwfx ...
```
