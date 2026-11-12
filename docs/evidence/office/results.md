# Harness results

18 / 18 passed · 2026-11-12T03:58:14.438Z

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.docx` | error (expect error) | 815 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:8664/vendor/docx.js:2:32683)
    at f.load (http:<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:8664/editor/renderers/docx.ts:52:11)
    at async show (http://127.0.0.1:8664/editor/main.ts: |
| ✅ | desktop-dark | `broken.pptx` | error (expect error) | 783 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:8664/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:8664/editor/renderers/office/<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:8664/editor/renderers/pptx.ts:44:11)
    at show (http://127.0.0.1:8664/editor/main.ts:76:25) |
| ✅ | desktop-dark | `sample-large.xlsx` | ready (expect ready) | 1044 |  |
| ✅ | desktop-dark | `sample-shapes.pptx` | ready (expect ready) | 748 |  |
| ✅ | desktop-dark | `sample.docx` | ready (expect ready) | 833 |  |
| ✅ | desktop-dark | `sample.ods` | ready (expect ready) | 937 |  |
| ✅ | desktop-dark | `sample.pptx` | ready (expect ready) | 740 |  |
| ✅ | desktop-dark | `sample.xls` | ready (expect ready) | 774 |  |
| ✅ | desktop-dark | `sample.xlsx` | ready (expect ready) | 782 |  |
| ✅ | mobile-light | `broken.docx` | error (expect error) | 696 | console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:8664/vendor/docx.js:2:32683)
    at f.load (http:<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:8664/editor/renderers/docx.ts:52:11)
    at async show (http://127.0.0.1:8664/editor/main.ts: |
| ✅ | mobile-light | `broken.pptx` | error (expect error) | 791 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:8664/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:8664/editor/renderers/office/<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:8664/editor/renderers/pptx.ts:44:11)
    at show (http://127.0.0.1:8664/editor/main.ts:76:25) |
| ✅ | mobile-light | `sample-large.xlsx` | ready (expect ready) | 1058 |  |
| ✅ | mobile-light | `sample-shapes.pptx` | ready (expect ready) | 780 |  |
| ✅ | mobile-light | `sample.docx` | ready (expect ready) | 1207 |  |
| ✅ | mobile-light | `sample.ods` | ready (expect ready) | 853 |  |
| ✅ | mobile-light | `sample.pptx` | ready (expect ready) | 703 |  |
| ✅ | mobile-light | `sample.xls` | ready (expect ready) | 766 |  |
| ✅ | mobile-light | `sample.xlsx` | ready (expect ready) | 772 |  |
