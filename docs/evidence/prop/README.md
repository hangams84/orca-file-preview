# SolidWorks and EPLAN viewers — evidence

What: the `solidworks` and `eplan` custom editors (`plugin/editor/renderers/solidworks.ts`, `eplan.ts`,
`prop/*`) on synthetic samples and on public files downloaded for local checks.

## How it was measured

- **Unit tests** (`*.test.ts` in `plugin/editor/renderers/prop/`): LZMA/LZMA2, 7z (solid + encoded header, one block
  per file, damaged), SolidWorks modern container, `__ZLB` frames, display mesh (unaligned records, look-alike
  rejection), History, DIB→BMP, OLE property sets, EPLAN link files, XML reader, EDZ manifest/part XML/locators,
  ProjectInfo, page descriptions, inspector. `orca plugin test`: 159/159 pass (20 of them new).
- **7z reader cross-check**: archives written by 7-Zip 24 (LZMA, LZMA2 solid, Deflate, Copy, AES with and without
  header encryption) decode byte-identical to `7z x` (MD5); encrypted ones are refused with "password-protected".
  The 108 MB Bachmann EDZ (645 LZMA blocks, 206 MB unpacked) decodes completely in 12.6 s in Node; a 88 MB solid
  LZMA2 block (EPLAN project backup) in 2.2 s.
- **Browser walk** `node tools/harness/prop-interact.mjs`: opens each file in the harness (Chromium, Orca frame CSP),
  clicks every tab, waits for the 3D canvas, opens the first PDF document; fails on page/console errors, missing
  canvas or a viewer that cannot open. Screenshots and `results.json` in `walk/` (18/18 pass; full `run.mjs` harness, all samples × 4 profiles: 356/356; plus 2/2 on the
  Bachmann EDZ files, screenshots not committed because their pictures and PDFs are the manufacturer's).
- **Real Orca** (1.4.263, Windows 11): a copy of `plugin/` with id `file-preview-prop` and only these two editors,
  `orca plugin open --editor` then `orca plugin shot --window`, left 285 px cropped. `orca/`: all 9 files opened,
  no errors, no plugin log lines. (A 13.9 MB Bachmann subset EDZ also opened; capture not committed.)

## Fidelity

| What | Shown | Not shown (and why) |
| --- | --- | --- |
| SolidWorks part | saved preview PNG/bitmap; **3D display mesh** (the triangles SolidWorks drew, three.js, mm); summary, custom and per-configuration properties; SW document info; release that saved it + save history; configurations; feature names/types; stream list | exact B-rep geometry (Parasolid); colours/materials; bodies saved without display data (e.g. imported LocalBodies in `arig-oled`); meshes of 2001-and-older files (PKWARE implode) |
| SolidWorks assembly | preview; properties; referenced files with types; component instances; configurations | 3D: the stored per-component meshes have no placement (checked by rendering 2 assemblies, ergos-tether and arig-20181002, against their previews: one copy per component at its own origin) |
| SolidWorks drawing / sheet format | preview + sheet image(s) (`Images/Sheet_N`), sheet names, referenced models, properties | views, dimensions, notes are not redrawn |
| EDZ | parts list with search; part data (numbers, manufacturer, multilingual descriptions, dimensions, weight, groups, macros, picture file); free technical properties; manufacturer address; part pictures; PDF documents in the PDF viewer; macro name/type/variants; contents tree with Open for pictures/PDF/XML | macro graphics (EPLAN PXF) |
| Project backup `.zw1` (`.elp` `.elx` `.zx1` if 7z/ZIP) | ProjectInfo.xml key fields + all properties; A_BAKINFO; comment; page descriptions found in `Page.eod` (stored order); pictures; contents tree | schematic pages (binary `.eod` object databases); page numbers |
| Link files `.elk` `.ell` `.elr` `.els` `.ela` | kind, data directory, database version | the project itself lives in `<name>.edb` beside the file |
| Anything unreadable | inspector: format id, size, entropy, hex dump, readable strings, OLE streams | — |

## Real samples (local only, `.orca/corpus/`, not committed)

| File | Source / licence | What the viewer shows |
| --- | --- | --- |
| `arig-0049.SLDPRT` (2014, OLE) | github.com/ARIG-Robotique/cad-projects `2019_all/20190309-0049.SLDPRT` (MIT) | preview, 26-face mesh in 3D, properties, history 2014 |
| `arig-carter.SLDPRT` (2014, OLE) | same repo, `2019_all/Carter2019.SLDPRT` | preview, 92 faces |
| `arig-oled.SLDPRT` (2014→2018, modern) | same repo, `2020_all/Ecran_128x32oled.SLDPRT` | preview, 2,512 faces (plate and engraving; the imported display body is not in DisplayLists) |
| `arig-20170416.SLDASM`, `arig-20181002.SLDASM` (2014) | same repo | preview, 2 configurations, components; no 3D |
| `arig-20181006.SLDDRW`, `arig-alu.SLDDRW` (2014) | same repo | preview + Sheet_0 image, referenced model |
| `ergos-elbow.SLDPRT` (2024), `ergos-tether.SLDASM`, `ergos-ankle.SLDASM` (2025), `ergos-jetson.SLDDRW` (2024, 7.7 MB) | github.com/Bryanh002/ERGOS-Dynamic-Humanoid-Platform (MIT) | preview, mesh (part), 11 imported components (ankle), drawing referencing 74 models |
| `smart-servo.SLDPRT`, `smart-jaw.SLDASM` (2024) | github.com/DSPEILab/SmartHarvest `mechanical/cad/` (MIT) | preview, 32-face mesh matching the preview, Chinese configuration names, 8 referenced parts |
| `poi-TestSolidWorks.sldprt` (98 → 2003, OLE) | github.com/apache/poi `test-data/hpsf/TestSolidWorks.sldprt` (Apache-2.0) | bitmap preview, 6-save history (98+ … 2003), properties; mesh is implode-compressed → no 3D tab, said on the page |
| `BE_Artikel_V1.10_2020_03_17.edz` (108 MB, 7z LZMA) | bachmann.info download centre, `ePLAN_Bachmann_1.10.zip` (manufacturer data, licence not stated) | 175 parts, pictures, PDF data sheets, 171 macros; too big for Orca's 50 MB read limit, read in the harness |
| `bachmann-subset.edz` (13.9 MB) | the above, re-packed with 7-Zip (fewer pictures/macros) | opens in Orca, same views |
| `cdp_*.elk` (8 files), `ia-cdp_place_only.zw1` (17.2 MB, LZMA2 solid, built with 7-Zip from `cdp_place_only.edb`) | github.com/binfen1/Eplan_2026_IA_MCP_scripts `artifacts/graphical_edit/` (MIT; EPLAN 2026 sample project "IEC_bas001") | link files: data dir + DB 18.0; backup: description "Grinding machine", EPLAN 2026.0.3, 201 properties, 77 page descriptions, 6 pictures, 217 files |

Not found publicly: a real `.zw1` / `.elp` / `.elx` / `.zx1` file (the Saia-Burgess example project link returned
HTTP 500). `.zx1` is registered and handled like the archives when it is 7z/ZIP, else by the inspector; its real
structure is unverified.

## Committed synthetic samples

`tools/make-prop-samples.py` (stdlib only) writes `samples/sample.sldprt` (2015+ container), `sample-2014.sldprt`
(OLE), `sample.sldasm`, `sample.slddrw`, `sample.edz` (7z LZMA), `sample-zip.edz`, `sample.zw1` (7z LZMA2 solid,
encoded header), `sample.elk`, and `damaged.sldprt|edz|zx1` (inspector). 7-Zip verifies the generated 7z and CFB
files.
