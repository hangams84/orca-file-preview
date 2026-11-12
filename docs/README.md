# File Preview for Orca — 개발 문서 / Development docs

Orca 데스크톱(Windows · macOS · Linux)과 브라우저/모바일 클라이언트에서 Office·PDF·텍스트·이미지 파일을 **읽기 전용으로 미리보기** 하는 Orca 플러그인입니다.

> HTML 버전: [index.html](index.html) · 원본 증빙 자료: [evidence/](evidence/)

## 지원 형식 / Supported formats

| 확장자 | 종류 | 엔진 | 기능 |
| --- | --- | --- | --- |
| .docx | Word | docx-preview (Apache-2.0) + JSZip | Pages, styles, tables, images, lists; zoom / fit width |
| .doc | Word 97-2003 | Own OLE/CFB + piece-table parser | Text, paragraphs, tables, page breaks |
| .pptx | PowerPoint | Own OOXML renderer (fflate) | Positioned text, pictures, tables, fills, notes |
| .ppt | PowerPoint 97-2003 | Own CFB record parser | Per-slide titles and body text, pictures |
| .xlsx .xlsm .xls .ods | Spreadsheets | SheetJS CE 0.20.3 (Apache-2.0) | Sheet picker, merged cells, formatted values, sticky headers |
| .pdf | PDF | pdf.js 6.5 (Apache-2.0) | Lazy page rendering, page navigation, zoom, CJK cMaps |
| .gif .bmp | Images | Browser decoder | Animated GIF, fit / zoom / pinch, dimensions |
| .svg | SVG | Browser <img> (scripts never run) | Zoom, source view |
| .html .htm | HTML | DOMPurify (Apache-2.0 / MPL-2.0) | Sanitised preview, source view, links blocked |
| .csv .tsv | Tables | Own RFC 4180 parser | Encoding + delimiter detection, sort, filter, raw view |
| .txt .log | Text | Own | Encoding detection (UTF-8/16, EUC-KR, …), line numbers, wrap |

## 검증 라운드 요약 / Verification rounds

_아직 실행된 검증 라운드가 없습니다._

## 구조 / Architecture

```text
plugin/                     # 배포되는 Orca 플러그인 (orca-plugin.json, editor/, vendor/)
  editor/main.ts            # 확장자 → 렌더러 디스패처, 파일 변경 시 재렌더
  editor/core/              # 툴바, 줌/핀치, 인코딩 감지, i18n
  editor/renderers/*.ts     # 형식별 렌더러 (지연 로딩)
  vendor/                   # esbuild 로 번들한 서드파티 ESM (네트워크 없음)
samples/                    # 테스트 픽스처 (tools/make-samples.py)
tools/harness/              # Orca 유사 CSP + 모의 호스트 브라우저 하네스 (Playwright)
tools/verify.mjs            # 검증 라운드 실행기
tools/build-docs.mjs        # 이 문서 생성기
docs/evidence/              # 라운드별 스크린샷 · 결과 · 차트
```
