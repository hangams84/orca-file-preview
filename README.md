# File Preview for Orca

[![orca-compat](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml/badge.svg)](https://github.com/hangams84/orca-file-preview/actions/workflows/orca-compat.yml)

Orca 데스크톱(Windows · macOS · Linux)과 브라우저/모바일 클라이언트에서 Office · PDF · 텍스트 · 이미지 파일을
**읽기 전용으로 미리보기** 하는 [Orca](https://github.com/stablyai/orca) 플러그인입니다.

Read-only previews for Office, PDF, text and image files inside Orca, on desktop and on browser/mobile clients.

| 형식 | 확장자 | 엔진 |
| --- | --- | --- |
| Word | `.docx` `.doc` | docx-preview · 자체 OLE/CFB 파서 (RTF·HTML·DOCX로 저장된 .doc 자동 감지) |
| PowerPoint | `.pptx` `.ppt` | 자체 OOXML 렌더러 · 자체 PPT 레코드 파서 |
| Excel | `.xlsx` `.xlsm` `.xls` `.ods` | SheetJS CE (Web Worker, 수식 계산 대체, 가상 스크롤) |
| PDF | `.pdf` | pdf.js (지연 렌더링, 한글 CMap, 암호 입력) |
| 이미지 | `.gif` `.bmp` `.svg` | 브라우저 디코더 (SVG 스크립트 차단, 배경 선택) |
| 웹 | `.html` `.htm` `.xhtml` | DOMPurify + 샌드박스 iframe (스크립트 미실행) |
| 표 | `.csv` `.tsv` | 자체 RFC 4180 파서 (인코딩·구분자 감지, 정렬, 필터) |
| 텍스트 | `.txt` `.log` | 인코딩 감지 (UTF-8/16, EUC-KR 등), 줄 번호, 줄바꿈 |
| 3D 모델 | `.stl` `.obj` `.ply` `.glb` `.gltf` `.3mf` `.off` `.fbx` `.dae` | three.js (WebGL, 회전·확대·이동, 터치, Draco·meshopt, Web Worker 파싱) |
| CAD (B-rep) | `.step` `.stp` `.stpz` `.iges` `.igs` `.brep` | OpenCascade (occt-import-js, WebAssembly, Web Worker): 어셈블리·부품 목록·색, 테셀레이션 품질 선택. `.stpz` = gzip 압축 STEP |
| AutoCAD 도면 (별도 플러그인) | `.dwg` `.dwt` | **File Preview DWG** ([별도 저장소](https://github.com/hangams84/orca-file-preview-dwg), Git URL `https://github.com/hangams84/orca-file-preview-dwg.git`; 소스 `dwg-plugin/`, GPL-3.0-or-later): LibreDWG (WebAssembly, Web Worker) + Canvas — 모형/배치, 레이어, 블록, 한글 문자, 치수, 해치. 이 MIT 플러그인과 따로 설치 ([dwg-plugin/README.md](dwg-plugin/README.md)) |
| SolidWorks | `.sldprt` `.sldasm` `.slddrw` `.slddrt` `.prtdot` `.asmdot` `.drwdot` | 자체 컨테이너 리더 (2014 이전 OLE/CFB, 2015 이후 형식): 저장된 미리보기 그림, 파트의 표시 메시(three.js 3D), 속성·구성·참조 파일·피처 이름·저장 기록. 정확한 B-rep 형상과 도면 뷰는 다시 그리지 않음 |
| EPLAN Electric P8 | `.edz` `.zw1` `.elk` `.ell` `.elr` `.els` `.ela` `.elp` `.elx` `.zx1` | 자체 7z(LZMA/LZMA2)·ZIP 리더: EDZ 부품 데이터·그림·PDF 문서·매크로 목록, 프로젝트 백업의 속성·페이지 설명·그림·내용 트리, 링크 파일 정보. 회로도 페이지와 매크로 그래픽은 그리지 않음 |
| (읽을 수 없는 경우) | 위 형식 전체 | 일반 검사기: 형식 식별, 크기, 엔트로피, 16진수 덤프, 문자열 |
| 다이어그램 | `.drawio` `.dio` `.vsdx` `.vsdm` `.vstx` `.vssx` | 자체 SVG 렌더러: draw.io(압축·여러 페이지, 기본 도형·연결선·스타일, HTML 레이블 DOMPurify 정제), Visio(마스터·스타일 시트 상속, Geometry 행 전체, 그룹·연결선·텍스트 서식·채우기 패턴·그라데이션·테마·EMF/WMF 그림·배경 페이지). 페이지 선택, 이동/확대/맞춤, 어두운 캔버스, 링크 |
| KiCad | `.kicad_sch` `.kicad_pcb` `.kicad_mod` `.kicad_sym` `.kicad_pro` | 자체 S-expression 파서 + SVG 렌더러 (KiCad 6–10, KiCad 스트로크 글꼴 newstroke): 회로도(심볼·유닛·De Morgan, 핀, 배선·버스, 레이블, 전원, 계층 시트, 표제란), PCB(레이어 표시/숨김, 패드·드릴, 트랙·호, 비아, 채움 영역, 앞/뒷면 뒤집기), 풋프린트, 심볼 라이브러리(목록+선택), 프로젝트 요약(넷 클래스·규칙·텍스트 변수·시트). 이동·확대·맞춤, 패드/핀/넷 정보 툴팁. 정확도: `docs/evidence/kicad/` |
| CAD 2D 도면 | `.dxf` `.dwf` `.dwfx` | 자체 Canvas 2D 렌더러: DXF(ASCII·바이너리, R12–2018+, 블록·치수·해치·MTEXT·한글), DWF(W2D 스트림, 시트, 썸네일 대체), DWFx(XPS 페이지, 내장 글꼴) · 레이어 목록, 모형/배치(뷰포트)/시트 선택, 밝은/어두운 배경, 정보 표시줄 ([근거](docs/evidence/cad2d/README.md)) |

공통: 다크/라이트 테마 실시간 반영, 한국어/영어 UI, Ctrl+휠 · 핀치 · 버튼 확대/축소, 휴대폰 화면에서 폭 맞춤,
파일이 바뀌면 자동 갱신, 손상 파일은 친절한 오류 안내.

**파일 크기 / File size** — 플러그인 자체 한도는 1 GB입니다. 하지만 Orca가 편집기에 파일을 넘겨줄 때
**50 MB 한도**가 있습니다(Orca 1.4.263 기준, 이미지·PDF 제외 · 플러그인에서 바꿀 수 없음, [stablyai/orca#46775](https://github.com/stablyai/orca/issues/46775)).
50 MB를 넘는 STEP 파일은 gzip으로 압축해 `.stpz`로 열면 됩니다(STEP은 보통 5–8배 줄어듭니다):
`gzip -c model.step > model.stpz` 또는 7-Zip → 압축 형식 gzip 후 확장자를 `.stpz`로. CAD 엔진(WebAssembly, 최대 4 GB 메모리)
실측(부품이 많은 합성 어셈블리, Chromium): STEP 61 MB 1.5분 · 189 MB 14분 · 343 MB 메모리는 되지만 30분 안에 끝나지 않음 · 412 MB 메모리 부족.
실용적인 상한은 STEP 원본 약 200 MB입니다. / The plugin accepts up to 1 GB, but Orca hands an editor at most 50 MB
(except images and PDFs); compress larger STEP files to `.stpz` (gzip).

## 설치 / Install

```sh
# GitHub에서 최신 버전 설치 (Orca 1.4.252+; Orca가 요청 권한과 승인 지문을 출력합니다)
# Orca 설정 → 플러그인 → 설치 → Git URL 에 https://github.com/hangams84/orca-file-preview.git 을 붙여넣어도 됩니다.
orca plugin install https://github.com/hangams84/orca-file-preview
orca plugin install https://github.com/hangams84/orca-file-preview --approve <fingerprint>
# 특정 버전: https://github.com/hangams84/orca-file-preview#v0.3.0

# 또는 로컬 폴더
orca plugin install ./plugin
```

플러그인은 `sandboxed-ui` 권한만 사용합니다(추가 capability 없음, 네트워크 없음, 파일 수정 없음).

> Orca가 직접 여는 형식(`.txt` `.csv` `.tsv` `.log` `.html` `.svg`)과 텍스트로 보이는 파일은 Orca의 Source
> 보기로 먼저 열립니다. 탭 오른쪽 위 보기 전환 버튼으로 미리보기로 바꿀 수 있습니다. **STEP(`.step` `.stp`), IGES
> (`.iges` `.igs`), BREP(`.brep`)도 텍스트 형식이라 Source로 먼저 열립니다** (Orca 1.4.258에서 확인). ASCII 3D 형식
> (`.obj`, ASCII `.stl`/`.ply`, `.off`, `.gltf`, `.dae`, ASCII `.fbx`)도 마찬가지일 수 있습니다.
> Files Orca opens itself open in Source first; switch with the view toggle at the tab's top right. **STEP, IGES and
> BREP files are text and open in Source first** (checked in Orca 1.4.258); text-based 3D formats may do the same.
> **KiCad 파일(`.kicad_*`)도 텍스트라 Source로 먼저 열립니다** (Orca 1.4.263 확인). / KiCad files are text and open
> in Source first too.

> **ASCII DXF(`.dxf`)도 텍스트라 Source로 먼저 열립니다** (바이너리 DXF·DWF·DWFx는 바로 미리보기). / ASCII DXF opens in
> Source first too; binary DXF, DWF and DWFx open straight in the preview.

## 저장소 구조 / Layout

```text
plugin/            배포되는 플러그인 (orca-plugin.json, editor/, vendor/)
samples/           테스트 픽스처 (tools/make-samples.py)
tools/harness/     Orca 유사 CSP + 모의 호스트 브라우저 하네스 (Playwright)
tools/verify.mjs   검증 라운드 실행기 (tsc, validate, 단위 테스트, 하네스 4종, fuzz, Orca 앱 캡처)
docs/              개발·검증 문서 (README.md, index.html, evidence/)
```

## Orca 버전별 호환성 (CI) / Orca compatibility

`.github/workflows/orca-compat.yml` 이 각 Orca 릴리스를 새로 설치하고 플러그인을 설치·테스트한 결과입니다.
플러그인·설치 스크립트·테스트 도구가 바뀌어 `main` 에 푸시되면 자동 실행되고, 아래 표가 자동으로 갱신됩니다.

<!-- ci-matrix:start -->
**Orca compatibility CI** — ❌ 20 failing check(s) · 2026-11-26 08:26 UTC · [run](https://github.com/hangams84/orca-file-preview/actions/runs/45782278510)

| Orca | Ubuntu 24.04 (Docker) | Ubuntu 26.04 (Docker) | macOS 15 arm64 | Windows 10 kernel (Server 2022) | Windows 11 kernel (Server 2025) |
| --- | --- | --- | --- | --- | --- |
| 1.4.277 | ❌ no result | ❌ no result | ❌ no result | ❌ no result | — |
| 1.4.258 | ❌ no result | ❌ no result | ❌ no result | — | ❌ no result |
| 1.4.257 | ❌ no result | — | — | — | — |
| 1.4.254 | ❌ no result | — | — | — | — |
| 1.4.253 | — | ❌ no result | ❌ no result | ❌ no result | ❌ no result |
| 1.4.250 | ❌ no result | — | — | — | — |
| 1.4.248 | ❌ no result | ❌ no result | ❌ no result | ❌ no result | ❌ no result |

Windows 7: ✅ the installer refuses with a clear message — Orca (Electron 23+) needs Windows 10 or later, and no Windows 7 CI runners exist. Windows 10/11 columns run on GitHub's Windows Server images, which share the Windows 10 (build 20348) and Windows 11 24H2 (build 26100) kernels; Windows 11 Pro 26200 was also tested on a real PC.

Each cell: a fresh Orca install of that version → plugin install with approval → validate · unit tests · static check → every fixture opened in the plugin editor → finished renders captured → plugin log free of errors (Windows also installs and removes through `installer/windows`). 1.4.247 is below the declared minimum (`engines.orca` >=1.4.248): Orca does not enforce that for folder installs, so its row is informational.

<details><summary>Failing checks</summary>

- linux · Orca 1.4.248: no results.json (job failed before writing results)
- linux · Orca 1.4.250: no results.json (job failed before writing results)
- linux · Orca 1.4.254: no results.json (job failed before writing results)
- linux · Orca 1.4.257: no results.json (job failed before writing results)
- linux · Orca 1.4.258: no results.json (job failed before writing results)
- linux · Orca 1.4.277: no results.json (job failed before writing results)
- macos · Orca 1.4.248: no results.json (job failed before writing results)
- macos · Orca 1.4.253: no results.json (job failed before writing results)
- macos · Orca 1.4.258: no results.json (job failed before writing results)
- macos · Orca 1.4.277: no results.json (job failed before writing results)
- ubuntu2604 · Orca 1.4.248: no results.json (job failed before writing results)
- ubuntu2604 · Orca 1.4.253: no results.json (job failed before writing results)
- ubuntu2604 · Orca 1.4.258: no results.json (job failed before writing results)
- ubuntu2604 · Orca 1.4.277: no results.json (job failed before writing results)
- windows-2022 · Orca 1.4.248: no results.json (job failed before writing results)
- windows-2022 · Orca 1.4.253: no results.json (job failed before writing results)
- windows-2022 · Orca 1.4.277: no results.json (job failed before writing results)
- windows-2025 · Orca 1.4.248: no results.json (job failed before writing results)
- windows-2025 · Orca 1.4.253: no results.json (job failed before writing results)
- windows-2025 · Orca 1.4.258: no results.json (job failed before writing results)

</details>
<!-- ci-matrix:end -->

## 설치 스크립트 / Installers

릴리스 패키지(`node tools/package-release.mjs` → `dist/orca-file-preview-<버전>.zip`)를 풀고 운영체제별 스크립트를 실행합니다.
자세한 사용법: [installer/README.md](installer/README.md)

| OS | 설치 | 제거 | 테스트 |
| --- | --- | --- | --- |
| Windows | `installer\windows\install.cmd` (더블클릭) | `installer\windows\uninstall.cmd` | Windows 11 ✅ |
| macOS | `installer/macos/Install File Preview.command` (더블클릭) | `Uninstall File Preview.command` | macOS 15 10/10 ✅ |
| Linux | `sh installer/linux/install.sh` | `sh installer/linux/uninstall.sh` | Ubuntu 22.04 · 24.04 10/10 ✅ |

## 운영체제별 테스트 / Platform tests

실제 Orca(1.4.258)를 새로 설치하고 플러그인 설치 → 검사 → 단위 테스트 → 전 픽스처 마운트 → 렌더 캡처를 수행합니다.

| 환경 | 실행 | 결과 |
| --- | --- | --- |
| Ubuntu 22.04 / 24.04 / 26.04 | `bash tools/platform-test/run-docker.sh 22.04 24.04 26.04` (WSL2 또는 Linux의 Docker, Xvfb) | 9/9 · 9/9 · 9/9 (26.04.1, Orca 1.4.277) |
| macOS 15 (arm64) | GitHub Actions `platform-macos` 워크플로 (`gh workflow run platform-macos --ref ci/macos-orca`) | 12/12 |
| Windows 11 | `node tools/verify.mjs --round <n>` (설치된 Orca 앱) | 10/10 |

증빙: `docs/evidence/platforms/` (summary.md, contact-sheet.png, 캡처, 로그)

## 개발 / Development

```sh
npm ci
npm run vendor            # 서드파티 라이브러리를 plugin/vendor 로 번들
orca plugin dev load plugin --approve <fingerprint>
npm run typecheck
node tools/harness/run.mjs --only docx,pdf --profiles desktop-dark,mobile-light
node tools/verify.mjs --round <n> && node tools/build-docs.mjs
```

검증 기록과 스크린샷은 [docs/README.md](docs/README.md) · [docs/index.html](docs/index.html) 에 있습니다.

## License

MIT (this project). Bundled libraries keep their own licenses: see
[plugin/THIRD_PARTY_NOTICES.md](plugin/THIRD_PARTY_NOTICES.md).
