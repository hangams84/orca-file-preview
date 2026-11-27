# Companion files for KiCad, SolidWorks and EPLAN — evidence

What: the engineering viewers reading the files a user hands to the preview (📁 toolbar button: a folder, Shift: single
files; or a drop on the preview), on top of `plugin/editor/core/companions.ts`:

- **KiCad** — hierarchical schematics (sheet tree, sub-sheets, instance references), `.kicad_pro` → root schematic /
  board, custom drawing sheets (`.kicad_wks`), missing sheets listed.
- **SolidWorks** — assemblies in 3D at their stored placements; part files fill in meshes the assembly does not carry;
  drawings link the referenced models.
- **EPLAN** — macros (`.ema`/`.emp`, and macros inside `.edz`) drawn; link files (`.elk` …) with the project folder
  (`.edb`): project properties, page list, parts list.

## How it was measured

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `tsc -p plugin --noEmit` | 0 errors |
| Unit tests | `orca plugin test plugin --json` (copy in `C:\fpt-compeng`) | 262/262 after rebasing on master (242 before; 14 new: `kicad/hierarchy.test.ts` 6, `prop/swasm.test.ts` 4, `prop/pxf.test.ts` 4 incl. 2 for `.edb`; `text-type.test.ts` extended for the eplan family) |
| Companion harness | `node tools/harness/companions-eng.mjs [--local]` — Playwright answers the 📁 folder picker with `fileChooser.setFiles(<dir>)` (webkitdirectory) and fires synthetic `DataTransfer` drops | 9/9 committed-sample cases, 12/12 with `--local` (public downloads in `.orca/`); `harness/results.json`, screenshots in `harness/` |
| Full harness | `node tools/harness/run.mjs --profiles desktop-dark,desktop-light,mobile-light,tablet-dark` (+ `--dir samples/kicad-project`, `samples/sw-assembly`, `samples/eplan-project`) | 512/512 (all samples × 4 profiles, before the rebase); `samples/kicad-project` 24/24 (incl. the new standalone `.kicad_wks` view), `samples/sw-assembly` 20/20, `samples/eplan-project` 4/4 |
| KiCad ground truth | `kicad-cli sch export svg samples/kicad-project/demo.kicad_sch` (KiCad 10.0.5) | KiCad loads the generated hierarchy; per-instance references R101/R201/R301/C501 and the custom sheet text match (`kicad-channel-b-vs-kicad-cli.png`) |
| Real Orca | 1.4.277, Windows 11: copy of `plugin/` with id `file-preview-compeng` and only the engineering, KiCad-text and EPLAN-text editors; `orca plugin open --editor <file>` + `orca plugin shot --window`, left 285 px and the file tree cropped | 7 files opened in the Engineering Preview, 📁 control present in each toolbar, `orca plugin logs`: no lines (`orca/`) |

## SolidWorks: where an assembly stores component placements

Research on public assemblies (2014 OLE and 2015+ container), reading streams with the plugin's own `prop/sw.ts`:

- **`swXmlContents/COMPINSTANCETREE`** (XML; zlib-framed `__ZLB` in OLE files, deflate in 2015+) holds
  `swHeader/swFile` (saved path, type), `swModelList/swModel` (per referenced model and configuration, with
  `swBoundingBox` in metres) and, inside the assembly's own `swModel`, one **`swReference` per component instance**:
  `swName`, `swReferenceNumber`, `swModelRef`, `swConfigurationName`, `swSuppressed`, `swHidden`,
  `swIsVirtualComponent` and **`swTransform`** — 16 numbers, a 4×4 matrix stored column by column (x-, y-, z-axis
  images, then the translation in metres). A sub-assembly's `swModel` holds its own `swReference`s, relative to the
  sub-assembly. `swConfiguration` → `swModelRef` picks the configuration's tree; `swDisplayStateList`
  (`swCompNameList` + `swShowState`) gives hidden components per display state.
- **Check**: transform every model box with its instance's matrix and union them; compare with the top model's stored
  `swBoundingBox` (`.orca/scratch/bbox2.py`, `bbox3.py`):

  | Assembly (public, MIT) | Format | Instances | Column-major (used) | Row-major | Nested: compose vs absolute |
  | --- | --- | --- | --- | --- | --- |
  | SmartHarvest `jaw.SLDASM` | 2015+ (2024) | 12 | equals the stored box (±0.1 mm) | off by up to 44 mm | — |
  | SmartHarvest `jaw_asm`, `slider_base2` | 2015+ | 5, 4 | equal | — | — |
  | ARIG `20170416-2304.SLDASM` | OLE (2014) | 3 | equal | — | — |
  | ARIG `20181002-0030.SLDASM` | OLE (2014) | 96 | equal | — | — |
  | ERGOS `Ankle_Assembly_Left.SLDASM` | 2015+ (2025) | 24 (3 levels) | inside the stored box | — | compose: inside; absolute: at the origin |
  | ERGOS `Tether_Assembly.SLDASM` | 2015+ (2025) | 35 (2 levels) | inside the stored box | — | compose |

- **`FaceTessellations/Directory`** (2015+ only) lists every leaf instance by path (`slider-1@jaw`, nested
  `caster-2inch-1@Tether_Assembly/caster-2inch-2-1@caster-2inch`) with the component's modification stamp, the hash of
  its own tessellation block and, for copies, the hash of the instance whose block it reuses; the blocks in
  `FaceTessellations/<stream>` start with `[u32][8-byte hash]` and hold the same face records as a part's
  `DisplayLists`, in the part's coordinates. Matched: jaw 12/12, jaw_asm 5/5, slider_base2 4/4, ankle 19/19, tether
  31/31 leaf instances. The 2014 OLE assemblies have no tessellation blocks → the part files are needed.
- **Stored mesh vs the real part file**: for the 7 jaw instances whose part file is in the repository under the
  same name, the stored block and the part's own `DisplayLists`, both placed with the instance matrix, have identical
  boxes (Δ 0.000 mm; `.orca/scratch/asm2.mts`). Toolbox parts saved under their configuration name
  (`GB - Spur gear … .SLDPRT`) are matched by configuration name.
- Visual check: `harness/sw-jaw-real-stored-3d.png` (our placement) against the assembly's own saved preview — same
  layout (two claws, slider base, gear rack).

Viewer: the **3D assembly** tab places every visible leaf; meshes come from the assembly's tessellations, else from a
given part file (recursing into given sub-assemblies, depth ≤ 4); hidden/suppressed components are listed, not drawn;
components without a mesh are listed with the hint. Colours tell files apart (not materials). Without a component tree
the given parts are laid out side by side, labelled, with a note. The References tab gets a placement table (mm). A
drawing's referenced models get **Open** when given (the sheet pictures stay as before).

## KiCad

- Sheets: `(sheet … (property "Sheetname"|"Sheet name") (property "Sheetfile"|"Sheet file"))`; sub-sheet files are
  resolved relative to the referring file, then by path tail among the companions. Pages: KiCad 7+ `(instances
  (project … (path "/<root uuid>/…" (page "3"))))` on each sheet, KiCad 6 `sheet_instances` in the root.
- References: KiCad 7+ `(instances (project … (path "/<root>/<sheet>…" (reference "R201") (unit 1))))` on each placed
  symbol; KiCad 6 `symbol_instances` (`/<sheet>…/<symbol uuid>`) in the root. Unit suffixes follow the instance unit.
- UI: the sheet select lists the tree (indented, page numbers, "(missing)"); select, double-click a sheet box, or ↑;
  the toolbar shows the breadcrumb `Root › Power › Regulator (page 5)`. Missing or unreadable sheets (and recursive
  ones) are listed in a note with a hint.
- `.kicad_wks` opened on its own: drawn on A4 landscape with the variables left as names (a template view).
- `.kicad_pro`: "Project files" buttons open `<name>.kicad_sch` / `<name>.kicad_pcb` in an overlay.
- Drawing sheet: `schematic.page_layout_descr_file` / `pcbnew.page_layout_descr_file` (`${KIPRJMOD}/` removed) of the
  project → `.kicad_wks` (or the older `page_layout`): `line`, `rect`, `tbtext`, `polygon` from the four corners inside
  the margins, `repeat`/`incrx`/`incry`/`incrlabel`, `page1only`/`notonpage1`, text variables (`${TITLE}`,
  `${#}/${##}`, `${SHEETPATH}`, `${COMMENTn}`, project `text_variables`, the pre-6 `%T`-style codes). Bitmaps are not
  drawn.
- Sample: `tools/make-kicad-project.mjs` → `samples/kicad-project/` (root, `channel.kicad_sch` instanced twice,
  `power.kicad_sch` with a nested `regulator.kicad_sch`, `demo.kicad_wks`, `demo.kicad_pro`), checked with
  `kicad-cli` (loads; only off-grid ERC warnings).

## EPLAN: what the formats carry

| Format | Real structure (evidence) | Page graphics decodable? | What the viewer shows |
| --- | --- | --- | --- |
| `.ema` window macro, `.emp` page macro | PXF: XML whose elements/attributes are numbers (`O31` line `A531/A532`, `O32` arc `A555` centre, `A556` radii, `A553/A554` start/end angle in radians, `O34` cubic curve `A621`, `O30` text `A501`/`A511` + `S54x505 A961` height, `O89` rectangle, `O17` device + `S89x5` black box). 25 Bachmann macros, 60k primitives. Arc angles: start/end puts 72 % of 20,796 arc ends on another primitive's end, start/sweep 57 % | **yes** — the macro's own lines, arcs, curves and texts | drawn per variant (select), pan/zoom; library symbols named in a note, black boxes dashed; layer colours/fonts/line types not applied |
| `.edz` (Data Portal) | 7z/ZIP: `manifest.xml`, part XML, pictures, PDFs, `.ema` macros | macros: yes (as above); no page previews | macro list gets **Draw** |
| `.zw1` / `.elp` / `.elx` backups | 7z/ZIP of the `.edb` folder | no: pages are records in `Page.eod` (binary, see below); no page previews or PDF exports found inside (only if a user added them) | unchanged + **Parts** tab from `Article.eod` |
| `.edb` folder (with `.elk`) | not SQLite / SQL CE / XML: EPLAN's own object store, one `.eod` data + `.eox` index per class (Page, Function, Article, Connection, Instance …), records `33 e8 <class u16> <id u32>` + tagged values, many zlib-compressed (e.g. EPLAN 2026 sample: `Article.eod` 83 compressed + 56 plain records); `ProjectInfo.xml`; `Images/`; symbol libraries `*.sdb` and `FctDefLib.fdb` in the same format | no: graphics live in `Instance.eod`/`Variant.eod` as tagged doubles referencing symbol variants in the `.sdb` stores — decoding them is a reverse-engineering project of its own | with the folder given: ProjectInfo.xml properties, page descriptions (Page.eod), **parts** (part number + descriptions from Article.eod; 97 parts in the public EPLAN 2026 sample), pictures, contents tree |
| `.elk` `.ell` `.elr` `.els` `.ela` | 2 lines (UTF-16): data directory, database version | — | link info; 📁 reads the project folder: the `.edb` named by the link, else the only `.edb` with a ProjectInfo.xml (the public sample's link names `EPLAN_Sample_Project_Education.edb` while its folder is `cdp_place_only.edb`) |

Samples: `tools/make-eplan-project.py` → `samples/eplan-project/` (`Plant.elk`, `Plant.edb/` with ProjectInfo.xml,
Page.eod, Article.eod with plain and zlib records, images) and `samples/sample-terminal.ema` (two variants);
`tools/make-prop-samples.py` now gives the EDZ sample's macro real geometry.

## Fidelity

| Viewer | Shown | Not shown (why) |
| --- | --- | --- |
| KiCad hierarchy | every sheet given, instance references and units, page numbers, breadcrumb, custom drawing sheet with variables | sheets not given (listed); drawing-sheet bitmaps; a sub-sheet opened on its own does not know its instance (open the root) |
| SolidWorks assembly 3D | 2015+: every visible component from the assembly alone (stored tessellations) at its stored placement; 2014 OLE / missing tessellations: from given part files; nested sub-assemblies; hidden/suppressed state listed; placement table | exact B-rep; colours/materials; flexible sub-assembly states other than the stored transforms; parts whose files are neither stored nor given (listed) |
| SolidWorks drawing | sheet pictures (as before); referenced models with Open for given ones | views are not redrawn from the models |
| EPLAN macros | lines, arcs, curves, texts, rectangles, black boxes, per variant | symbols from symbol libraries (graphics not in the macro); layer colours, line types, fonts |
| EPLAN project folder | properties, page descriptions, parts list, pictures, contents | schematic pages (binary object store), devices, connections |

## Local-only public files (`.orca/`, not committed)

| File | Source / licence | Result |
| --- | --- | --- |
| `.orca/sw/jaw/*` (jaw.SLDASM + 14 parts + 2 assemblies) | github.com/DSPEILab/SmartHarvest `mechanical/cad/` (MIT) | 12/12 placed from stored meshes; 7/7 identical to the part files |
| ERGOS / ARIG assemblies | see `docs/evidence/prop/README.md` (MIT) | tree + placements verified (table above) |
| `.orca/eplan/graphical_edit/` (`cdp_place_only.elk` + `.edb`) | github.com/binfen1/Eplan_2026_IA_MCP_scripts (MIT; EPLAN 2026 sample project) | 77 page descriptions, 97 parts |
| Bachmann `AI204_1.ema` and 24 more | bachmann.info EPLAN data (licence not stated; screenshots not committed) | drawn: module front with connector, LEDs, labels |
