# File Preview DWG for Orca

[Orca](https://github.com/stablyai/orca)에서 AutoCAD 도면(`.dwg`)과 도면 템플릿(`.dwt`)을 **읽기 전용으로
미리보기** 하는 플러그인입니다. 파일은 GNU LibreDWG(WebAssembly, Web Worker)로 읽고 Canvas에 그립니다.
네트워크를 쓰지 않고 파일을 수정하지 않습니다.

Read-only previews of AutoCAD drawings (`.dwg`) and drawing templates (`.dwt`) inside Orca. Files are
read with GNU LibreDWG compiled to WebAssembly (in a Web Worker) and drawn on a canvas. No network
access, no file changes.

> 이 플러그인은 **GPL-3.0-or-later** 입니다 (LibreDWG가 GPL이기 때문). MIT 라이선스인 File Preview 본
> 플러그인과 별도로 설치합니다. / This plugin is **GPL-3.0-or-later** because LibreDWG is GPL; it is
> installed separately from the MIT-licensed File Preview plugin.

## 기능 / Features

| | 한국어 | English |
| --- | --- | --- |
| 버전 | R13, R14, AutoCAD 2000 · 2004 · 2007 · 2010 · 2013 · 2018 이후 형식(AC1012–AC1032). R2.x–R12는 LibreDWG 지원이 초기 단계라 일부만 표시 | R13, R14, AutoCAD 2000/2004/2007/2010/2013/2018+ (AC1012–AC1032). R2.x–R12: LibreDWG support is preliminary, partial |
| 공간 | 모형 공간, 배치(용지 공간) 탭 — 용지와 뷰포트(모형을 축척에 맞춰 잘라 표시) | Model space and paper-space layouts with the sheet and viewports (model space clipped and scaled) |
| 레이어 | 레이어 목록, 켜기/끄기(파일에서 꺼지거나 동결된 레이어는 꺼진 상태로 시작), 모두 켜기/끄기 | Layer list with visibility toggles (off/frozen layers start hidden), all on/off |
| 객체 | 선, 폴리선(볼록·폭), 원, 호, 타원, 스플라인(NURBS·맞춤점), 점, 솔리드, 3D면 윤곽, 해치(단색·패턴·그라데이션·구멍), 블록 참조(회전·축척·대칭·배열, 중첩), 속성, TEXT/MTEXT(한글, 정렬, 서식 코드), 치수(치수 블록), 지시선, 다중 지시선, 다중선, 와이프아웃, 표, 공차 | Lines, polylines (bulges, widths), circles, arcs, ellipses, splines (NURBS and fit points), points, solids, 3D-face edges, hatches (solid, pattern, gradient, holes), block references (rotated, scaled, mirrored, arrayed, nested), attributes, TEXT/MTEXT (Korean, alignment, format codes), dimensions (their blocks), leaders, multileaders, multilines, wipeouts, tables, tolerances |
| 표시 | 색(ACI·트루컬러, ByLayer/ByBlock), 선 두께(켜기/끄기), 선 종류(점선 등), 어두운/밝은 배경, 배경과 같은 색 자동 대비 | Colours (ACI, true colour, ByLayer/ByBlock), line weights (toggle), line types (dashes), dark/light background, colours too close to the background adjusted |
| 조작 | 끌어서 이동, 휠로 커서 위치 확대/축소, 두 손가락 핀치, 더블클릭/버튼으로 전체 보기, 키보드(+ − F 화살표) | Drag to pan, wheel zooms at the cursor, two-finger pinch, double-click or button to fit, keys (+ − F arrows) |
| 정보 | 버전, 단위(INSUNITS), 범위(가로 × 세로), 객체 수, 파일 크기; 그리지 않은 객체 종류 안내 | Version, units, extents, entity count, file size; a note lists entity types not drawn |
| 대체 | LibreDWG가 읽지 못하거나 그릴 객체가 없으면 파일에 저장된 미리보기 이미지(BMP/PNG)를 안내와 함께 표시 | When LibreDWG cannot read the file or nothing is drawable, the preview image stored in the file (BMP/PNG) is shown with a note |

그리지 않는 것 / Not drawn: 3D 솔리드·영역·바디(ACIS), 나선, 외부 참조 파일, 래스터 이미지 내용(테두리만),
OLE 개체, SHX 셰이프 — SHX 글꼴은 시스템 글꼴(맑은 고딕 등)로 대신 표시합니다.
3D solids/regions/bodies (ACIS), helixes, external references, raster image contents (frame only), OLE
objects, SHX shapes. SHX fonts are replaced by the system font.

## 설치 / Install

```sh
# 로컬 폴더 / from a local folder
orca plugin install ./dwg-plugin
orca plugin install ./dwg-plugin --approve <fingerprint>
```

별도 저장소가 생기면 그 Git URL로 설치합니다. / Once it has its own repository, install from its Git URL.

> Orca가 편집기에 넘기는 파일은 최대 50 MB입니다. / Orca hands an editor at most 50 MB of file data.

## 개발 / Development

이 폴더는 File Preview 저장소 안에서 개발합니다. / Developed inside the File Preview repository:

```sh
npm ci
node tools/build-dwg-vendor.mjs            # vendor/libredwg (LibreDWG wasm + CSP-patched glue)
npx tsc -p dwg-plugin                      # typecheck (after `orca plugin types dwg-plugin`)
orca plugin test dwg-plugin --json         # unit tests (copy to the drive Orca is on first on Windows)
node tools/harness/run.mjs --plugin dwg-plugin   # browser harness, samples/dwg
node tools/harness/dwg-interact.mjs        # pan/zoom/layers/layout checks
node tools/check-dwg-plugin.mjs            # size, licence files, self-contained, CSP
python tools/make-dwg-samples.py           # regenerate samples/dwg (ezdxf + LibreDWG dxf2dwg)
```

## 라이선스 / License

GPL-3.0-or-later — [`LICENSE`](LICENSE). 서드파티 고지: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md),
LibreDWG 소스와 수정 내용: [`vendor/libredwg/README.md`](vendor/libredwg/README.md).

AutoCAD와 DWG는 Autodesk, Inc.의 상표입니다. 이 플러그인은 Autodesk와 관련이 없습니다.
AutoCAD and DWG are trademarks of Autodesk, Inc.; this plugin is not affiliated with Autodesk.
