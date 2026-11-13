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

공통: 다크/라이트 테마 실시간 반영, 한국어/영어 UI, Ctrl+휠 · 핀치 · 버튼 확대/축소, 휴대폰 화면에서 폭 맞춤,
파일이 바뀌면 자동 갱신, 손상 파일은 친절한 오류 안내.

## 설치 / Install

```sh
# GitHub 저장소의 plugin/ 폴더에서 설치 (Orca가 접근 권한을 확인하고 승인 지문을 출력합니다)
orca plugin install https://github.com/hangams84/orca-file-preview/tree/main/plugin
orca plugin install https://github.com/hangams84/orca-file-preview/tree/main/plugin --approve <fingerprint>

# 또는 로컬 폴더
orca plugin install ./plugin
```

플러그인은 `sandboxed-ui` 권한만 사용합니다(추가 capability 없음, 네트워크 없음, 파일 수정 없음).

> Orca가 직접 여는 형식(`.txt` `.csv` `.tsv` `.log` `.html` `.svg`)과 텍스트로 보이는 파일은 Orca의 Source
> 보기로 먼저 열립니다. 탭 오른쪽 위 보기 전환 버튼으로 미리보기로 바꿀 수 있습니다.
> Files Orca opens itself open in Source first; switch with the view toggle at the tab's top right.

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
_아직 실행되지 않았습니다._
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
| Ubuntu 22.04 / 24.04 | `bash tools/platform-test/run-docker.sh 22.04 24.04` (WSL2 또는 Linux의 Docker, Xvfb) | 9/9 · 9/9 |
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
