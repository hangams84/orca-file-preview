# KiCad Preview — evidence

What: the KiCad Preview editor (`.kicad_sch`, `.kicad_pcb`, `.kicad_mod`, `.kicad_sym`, `.kicad_pro`) compared
with KiCad's own output, run in the browser harness, and run in real Orca.

## 1. Engine choice: KiCanvas evaluated, own SVG renderer chosen

[KiCanvas](https://github.com/theacodes/kicanvas) (MIT, commit of 2026-04-29) was cloned into `.orca/ext/` and read:

| Criterion | KiCanvas | Decision |
| --- | --- | --- |
| Licence | MIT; bundles newstroke (CC0 glyphs; the converted `.cpp` carries KiCad's GPL file header), earcut (ISC), Material Symbols (Apache-2.0), Nunito/Bellota (OFL) | usable, but only the newstroke glyph data is needed |
| CSP | no `eval`/`new Function` found; WebGL2 | would pass |
| Size | 1.3 MB of TypeScript source incl. 194 KB glyph table and its own UI (custom elements, fonts, icons) | too much for one format family |
| Formats | `.kicad_sch` and `.kicad_pcb` only, embedded as a whole app; no standalone `.kicad_mod`, `.kicad_sym` list view or `.kicad_pro` summary | all five extensions were required |
| KiCad 9/10 | project marked alpha, slow-moving; KiCad 10 boards name nets directly (`(net "GND")`) | own parser handles both |

Reused: only the newstroke glyph data (1,788 Latin/Greek/Cyrillic/symbol glyphs, 68 KB, extracted by
`tools/kicad/extract-newstroke.mjs`) and KiCanvas's port of KiCad's stroke-font layout rules (MIT). CJK glyphs
(OFL, Source Han Sans) are left out; text with characters outside the subset is drawn with a system font.

Result: `plugin/editor/renderers/kicad.ts` + `kicad/*.ts`, **≈ 225 KB of TypeScript** (no vendor bundle, no
WebAssembly, no worker). It parses the S-expression, builds per-layer SVG path data in millimetres (one `<path>`
per layer and stroke width), and pans/zooms by `viewBox`; colours, layer visibility and theme come from one
stylesheet, so toggles never rebuild geometry.

## 2. Fidelity against `kicad-cli` (KiCad 10.0.5)

How: `node tools/kicad/fidelity.mjs`. `kicad-cli` exports a black-and-white SVG of each case (schematic without
drawing sheet; one board layer at a time with drill shapes on copper layers); the plugin's own scene builder
draws the same file in black. Both are rasterised in Chromium over the same world window (12 px/mm schematics,
up to 30 px/mm boards) and compared as ink masks: **precision** = share of our ink within 2 px of KiCad's ink,
**recall** = share of KiCad's ink within 2 px of ours, **F1**. Symbols (kicad-cli draws each unit on its own
page and scale) are cropped to their ink box and stretched to 600 px wide first (3 px tolerance), which makes
that metric harsh on sub-0.3 mm text offsets. Each row has an image here: KiCad | preview | overlay (red = KiCad
only, blue = preview only).

Corpus: hand-written KiCad 8 files (`tools/kicad/make-kicad-samples.mjs`, committed in `samples/`).

| Case | Kind | Precision % | Recall % | F1 % | Image |
| --- | --- | --- | --- | --- | --- |
| sample.kicad_sch | schematic | 95.8 | 95.1 | **95.5** | [png](sch-sample.png) |
| sample-power.kicad_sch (sub-sheet) | schematic | 99.2 | 99.4 | **99.3** | [png](sch-sample-power.png) |
| sample.kicad_pcb F.Cu | board | 99.5 | 85.5 | **92.0** | [png](pcb-sample-F.Cu.png) |
| sample.kicad_pcb In1.Cu | board | 100.0 | 91.4 | **95.5** | [png](pcb-sample-In1.Cu.png) |
| sample.kicad_pcb In2.Cu | board | 100.0 | 65.3 | **79.0** | [png](pcb-sample-In2.Cu.png) |
| sample.kicad_pcb B.Cu | board | 100.0 | 96.8 | **98.4** | [png](pcb-sample-B.Cu.png) |
| sample.kicad_pcb F.SilkS | board | 93.8 | 93.0 | **93.4** | [png](pcb-sample-F.SilkS.png) |
| sample.kicad_pcb B.SilkS | board | 91.7 | 88.7 | **90.2** | [png](pcb-sample-B.SilkS.png) |
| sample.kicad_pcb F.Fab | board | 96.6 | 95.9 | **96.2** | [png](pcb-sample-F.Fab.png) |
| sample.kicad_pcb F.CrtYd | board | 100.0 | 100.0 | **100.0** | [png](pcb-sample-F.CrtYd.png) |
| sample.kicad_pcb Edge.Cuts | board | 100.0 | 100.0 | **100.0** | [png](pcb-sample-Edge.Cuts.png) |
| sample.kicad_mod F.Cu | footprint | 100.0 | 100.0 | **100.0** | [png](fp-sample-F.Cu.png) |
| sample.kicad_mod F.SilkS | footprint | 96.2 | 95.4 | **95.8** | [png](fp-sample-F.SilkS.png) |
| sample.kicad_mod F.Fab | footprint | 94.8 | 94.1 | **94.5** | [png](fp-sample-F.Fab.png) |
| sample.kicad_mod F.Paste | footprint | 100.0 | 100.0 | **100.0** | [png](fp-sample-F.Paste.png) |
| sample.kicad_sym R | symbol | 88.7 | 88.6 | **88.7** | [png](sym-R_unit1.png) |
| sample.kicad_sym R_Small (derived) | symbol | 81.5 | 81.0 | **81.3** | [png](sym-R_Small_unit1.png) |
| sample.kicad_sym C_Polarized | symbol | 100.0 | 100.0 | **100.0** | [png](sym-C_Polarized_unit1.png) |
| sample.kicad_sym OPAMP unit A / B / C | symbol | 96.2 / 95.7 / 79.2 | 96.4 / 96.2 / 80.6 | **96.3 / 96.0 / 79.9** | [A](sym-OPAMP_unit1.png) [B](sym-OPAMP_unit2.png) [C](sym-OPAMP_unit3.png) |
| sample.kicad_sym NAND / De Morgan | symbol | 93.4 / 93.7 | 93.5 / 93.8 | **93.4 / 93.8** | [1](sym-NAND_unit1.png) [2](sym-NAND_unit1_demorgan.png) |
| sample.kicad_sym MCU (pin shapes) | symbol | 87.5 | 86.9 | **87.2** | [png](sym-MCU_unit1.png) |
| sample.kicad_sym CONN4 / GND / +5V | symbol | 88.8 / 87.1 / 77.8 | 86.7 / 86.9 / 77.8 | **87.7 / 87.0 / 77.8** | [CONN4](sym-CONN4_unit1.png) [GND](sym-GND_unit1.png) [+5V](sym-+5V_unit1.png) |

Raw numbers: [fidelity.json](fidelity.json), [fidelity.md](fidelity.md).

Reading the gaps:

- **Copper recall (In2.Cu 65 %, F.Cu 86 %)**: almost all of the missing ink is the M3 *non-plated* mounting hole,
  which `kicad-cli` plots as a solid 3.2 mm disc on every copper layer; the preview draws it as a hole (as KiCad's
  board editor does). The overlays show no other copper difference.
- **Symbols at 78–88 %**: sub-0.3 mm pin-text and field offsets magnified by the ink-box normalisation (a 6 mm symbol
  becomes 600 px). Geometry (bodies, pins, pin decorations, arcs, fills) overlaps.
- **Silkscreen 90–93 %**: footprint text placement within ~0.1 mm; mirrored back-side text matches.

Local check on KiCad's bundled demo projects (KiCad 10 format; files read from the KiCad install, **not committed**;
the demos ship with KiCad without a separate licence of their own, so neither files nor images are kept here):

| Demo file | Kind | F1 % |
| --- | --- | --- |
| complex_hierarchy/ampli_ht.kicad_sch | schematic | 97.7 |
| pic_programmer/pic_programmer.kicad_sch | schematic | 97.5 |
| video/rams.kicad_sch | schematic | 95.2 |
| pic_programmer.kicad_pcb F.Cu / B.Cu / F.SilkS / Edge.Cuts | board | 94.9 / 99.6 / 100 / 100 |
| video.kicad_pcb (5.7 MB, 4 layers, 7,932 tracks, 808 vias) F.Cu / B.Cu / F.SilkS / Edge.Cuts | board | 100 / 100 / 100 / 100 (2 px ≈ 0.13 mm at this scale) |

`video.kicad_pcb` opens in the harness in about 1 s.

## 3. Feature table

| Feature | Status | Notes |
| --- | --- | --- |
| S-expression reader (KiCad 6–10) | ✅ | KiCad 8 corpus + KiCad 10 demos tested; KiCad 6/7 from format knowledge only |
| Library symbols, units, De Morgan | ✅ | unit suffix on references (`U1A`), derived symbols (`extends`) |
| Pins: names/numbers, offset/outside rules, hidden | ✅ | shapes: line, inverted, clock, inverted clock, input/clock/output low, edge clock, non-logic; `no_connect` type X |
| Wires, buses, bus entries, junctions, no-connects | ✅ | |
| Labels: local, global (5 shapes), hierarchical, net class flag | ✅ | global label box ≈0.1 mm narrower than KiCad |
| Power symbols | ✅ | hidden power pins name their nets for hover |
| Hierarchical sheets + pins | ✅ | toolbar list of sheets (name — file) zooms to each; sub-sheets are separate files (open them on their own) |
| Text, text boxes (word wrap), graphics, dashed strokes | ✅ | `~{overbar}`, `_{sub}`, `^{sup}`, `{slash}`-style escapes |
| Fields with symbol rotation/mirror | ✅ | KiCad's box-centre placement |
| Title block, paper size | ≈ | layout approximates KiCad's default drawing sheet; custom `.kicad_wks` not read |
| Embedded schematic images | ✅ | PNG via `data:` URL |
| Stroke font | ✅ | newstroke subset; CJK/Hangul fall back to a system font; TrueType font faces drawn with the stroke font |
| Board layers + toggles, presets | ✅ | copper incl. inner, silk, mask (40 %), paste, Edge.Cuts, fab, courtyard, user, drawing sheet |
| Pads: rect, roundrect, chamfered, circle, oval, trapezoid, custom; drills round/oval/offset | ✅ | mask/paste margins not applied |
| Tracks, arcs, vias (through/blind/micro), filled zones | ✅ | zones drawn 60 % opaque under their layer's tracks; unfilled zones/keepouts dashed |
| Board graphics, text, text boxes, dimensions | ✅ / ≈ | dimension: text + simple lines (no arrows) |
| Front/back flip | ✅ | mirrored view with back layers on top |
| `.kicad_mod` standalone | ✅ | |
| `.kicad_sym` standalone | ✅ | filterable list, unit and De Morgan selection |
| `.kicad_pro` summary | ✅ | sheets, text variables, net classes + patterns, rules, presets, defaults, schematic settings, severities, pinned libs, raw JSON |
| Pan / zoom / fit, dark / light | ✅ | wheel zooms at pointer, drag pans, pinch, `+ − 0 F` and arrows |
| Hover info | ✅ | pins (with net), symbols, labels, sheet pins, pads (net, drill, layers), tracks, vias, zones, footprints |
| Not done | — | net highlighting across the board, 3D, ratsnest, zone refill, legacy KiCad 5 `.sch`/`.lib`/`.kicad_mod` v5 quirks beyond basic parsing |

## 4. Browser harness

`node tools/harness/run.mjs --profiles desktop-dark,desktop-light,mobile-light,tablet-dark` (all samples) — see the
results in the worker report; KiCad shots for each profile are in [`harness/`](harness/). The five `broken.kicad_*`
files end in a friendly error (`kicad-parse`, `kicad-kind`, `kicad-pro`, `kicad-empty`).

## 5. Real Orca (1.4.263, Windows 11)

A copy of `plugin/` with id `file-preview-kicad` and only the KiCad editor was dev-loaded, each file opened with
`orca plugin open local.file-preview-kicad --editor …`, captured with `orca plugin shot --window` (sidebars cropped),
then unloaded. `orca plugin logs` showed no lines.

KiCad files are text, so Orca opens them in its **Source view first**; the preview is behind the tab's view toggle
(same as STEP). To capture without clicking in the user's window, the captured copies were saved as UTF-16 (which
Orca hands to the plugin editor directly; the decoder reads the BOM). Screenshots: [`orca/kicad_sch.png`](orca/kicad_sch.png),
[`orca/kicad_pcb.png`](orca/kicad_pcb.png), [`orca/kicad_mod.png`](orca/kicad_mod.png),
[`orca/kicad_sym.png`](orca/kicad_sym.png), [`orca/kicad_pro.png`](orca/kicad_pro.png).
