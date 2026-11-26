# File Preview for Orca

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
| 다이어그램 | `.drawio` `.dio` `.vsdx` `.vsdm` `.vstx` `.vssx` | 자체 SVG 렌더러: draw.io(압축·여러 페이지, 기본 도형·연결선·스타일, HTML 레이블 DOMPurify 정제), Visio(마스터·스타일 시트 상속, Geometry 행 전체, 그룹·연결선·텍스트 서식·채우기 패턴·그라데이션·테마·EMF/WMF 그림·배경 페이지). 페이지 선택, 이동/확대/맞춤, 어두운 캔버스, 링크 |

공통: 다크/라이트 테마 실시간 반영, 한국어/영어 UI, Ctrl+휠 · 핀치 · 버튼 확대/축소, 휴대폰 화면에서 폭 맞춤,
파일이 바뀌면 자동 갱신, 손상 파일은 친절한 오류 안내.

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

## 개발 / Development

```sh
npm ci
npm run vendor            # 서드파티 라이브러리를 plugin/vendor 로 번들
orca plugin dev load plugin --approve <fingerprint>
npm run typecheck
node tools/harness/run.mjs --only docx,pdf --profiles desktop-dark,mobile-light
node tools/verify.mjs --round <n> && node tools/build-docs.mjs
```

검증 기록과 스크린샷은 repository docs/ folder 에 있습니다.

## License

MIT (this project). Bundled libraries keep their own licenses: see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
