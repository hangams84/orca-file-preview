# Harness results

42 / 42 passed · 2026-11-12T06:19:15.543Z

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.doc` | error (expect error) | 824 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: PreviewError: notword
    at oleGuards (http://127.0.0.1:12337/plugin/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:12337/plugi |
| ✅ | desktop-dark | `broken.docx` | error (expect error) | 769 | console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:12337/plugin/vendor/docx.js:2:32683)
    at f.loa<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:12337/plugin/editor/renderers/docx.ts:65:11)
    at async show (http://127.0.0.1:12337/plugin |
| ✅ | desktop-dark | `broken.encrypted.doc` | error (expect error) | 772 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:12337/plugin/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:12337/plu |
| ✅ | desktop-dark | `broken.encrypted.ppt` | error (expect error) | 776 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:12337/plugin/editor/renderers/ppt.ts:69:10)
    at Module.render (http://127.0.0.1:12337/plu |
| ✅ | desktop-dark | `broken.pdf` | error (expect error) | 776 | console: PreviewError: PDF 파일을 열 수 없습니다
    at friendly (http://127.0.0.1:12337/plugin/editor/renderers/pdf.ts:77:12)
    at Module.render (http://127.0.0.1:123 |
| ✅ | desktop-dark | `broken.ppt` | error (expect error) | 777 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:12337/plugin/editor/renderers/ppt.ts:46:11)
    at show (http://127.0.0.1:12337/plugin/editor/ |
| ✅ | desktop-dark | `broken.pptx` | error (expect error) | 774 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:12337/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:12337/plugin/editor/r<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:12337/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:12337/plugin/edito |
| ✅ | desktop-dark | `sample-docx.doc` | ready (expect ready) | 869 |  |
| ✅ | desktop-dark | `sample-euckr.csv` | ready (expect ready) | 759 |  |
| ✅ | desktop-dark | `sample-euckr.html` | ready (expect ready) | 771 | console: Executing inline event handler violates the following Content Security Policy directive 'script-src 'self' blob:'. Either the 'unsafe-inline' keyword,  |
| ✅ | desktop-dark | `sample-euckr.txt` | ready (expect ready) | 762 |  |
| ✅ | desktop-dark | `sample-html.doc` | ready (expect ready) | 776 |  |
| ✅ | desktop-dark | `sample-large.csv` | ready (expect ready) | 759 |  |
| ✅ | desktop-dark | `sample-large.doc` | ready (expect ready) | 788 |  |
| ✅ | desktop-dark | `sample-large.pdf` | ready (expect ready) | 982 |  |
| ✅ | desktop-dark | `sample-large.ppt` | ready (expect ready) | 772 |  |
| ✅ | desktop-dark | `sample-large.xlsx` | ready (expect ready) | 978 |  |
| ✅ | desktop-dark | `sample-password.pdf` | ready (expect ready) | 769 |  |
| ✅ | desktop-dark | `sample-ppt97.ppt` | ready (expect ready) | 773 |  |
| ✅ | desktop-dark | `sample-pptx.ppt` | ready (expect ready) | 762 |  |
| ✅ | desktop-dark | `sample-rtf.doc` | ready (expect ready) | 760 |  |
| ✅ | desktop-dark | `sample-semicolon.csv` | ready (expect ready) | 771 |  |
| ✅ | desktop-dark | `sample-shapes.pptx` | ready (expect ready) | 779 |  |
| ✅ | desktop-dark | `sample-slides.pdf` | ready (expect ready) | 1097 |  |
| ✅ | desktop-dark | `sample-viewbox.svg` | ready (expect ready) | 769 |  |
| ✅ | desktop-dark | `sample-word97.doc` | ready (expect ready) | 760 |  |
| ✅ | desktop-dark | `sample.bmp` | ready (expect ready) | 774 |  |
| ✅ | desktop-dark | `sample.csv` | ready (expect ready) | 761 |  |
| ✅ | desktop-dark | `sample.doc` | ready (expect ready) | 773 |  |
| ✅ | desktop-dark | `sample.docx` | ready (expect ready) | 803 |  |
| ✅ | desktop-dark | `sample.gif` | ready (expect ready) | 767 |  |
| ✅ | desktop-dark | `sample.html` | ready (expect ready) | 773 | console: Executing inline event handler violates the following Content Security Policy directive 'script-src 'self' blob:'. Either the 'unsafe-inline' keyword,  |
| ✅ | desktop-dark | `sample.log` | ready (expect ready) | 770 |  |
| ✅ | desktop-dark | `sample.ods` | ready (expect ready) | 783 |  |
| ✅ | desktop-dark | `sample.pdf` | ready (expect ready) | 1091 |  |
| ✅ | desktop-dark | `sample.ppt` | ready (expect ready) | 764 |  |
| ✅ | desktop-dark | `sample.pptx` | ready (expect ready) | 779 |  |
| ✅ | desktop-dark | `sample.svg` | ready (expect ready) | 773 |  |
| ✅ | desktop-dark | `sample.tsv` | ready (expect ready) | 768 |  |
| ✅ | desktop-dark | `sample.txt` | ready (expect ready) | 767 |  |
| ✅ | desktop-dark | `sample.xls` | ready (expect ready) | 773 |  |
| ✅ | desktop-dark | `sample.xlsx` | ready (expect ready) | 764 |  |
