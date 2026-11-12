# Harness results

22 / 22 passed · 2026-11-12T06:09:43.889Z

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.docx` | error (expect error) | 992 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:5545/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:5545/plugin/editor/renderers/docx.ts:54:11)
    at async show (http://127.0.0.1:5545/plugin/e |
| ✅ | desktop-dark | `broken.pptx` | error (expect error) | 699 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:5545/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:5545/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:5545/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:5545/plugin/editor/ |
| ✅ | desktop-dark | `sample-docx.doc` | ready (expect ready) | 821 |  |
| ✅ | desktop-dark | `sample-large.xlsx` | ready (expect ready) | 1012 |  |
| ✅ | desktop-dark | `sample-pptx.ppt` | ready (expect ready) | 732 |  |
| ✅ | desktop-dark | `sample-shapes.pptx` | ready (expect ready) | 750 |  |
| ✅ | desktop-dark | `sample.docx` | ready (expect ready) | 824 |  |
| ✅ | desktop-dark | `sample.ods` | ready (expect ready) | 763 |  |
| ✅ | desktop-dark | `sample.pptx` | ready (expect ready) | 702 |  |
| ✅ | desktop-dark | `sample.xls` | ready (expect ready) | 751 |  |
| ✅ | desktop-dark | `sample.xlsx` | ready (expect ready) | 753 |  |
| ✅ | mobile-light | `broken.docx` | error (expect error) | 681 | console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:5545/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:5545/plugin/editor/renderers/docx.ts:54:11)
    at async show (http://127.0.0.1:5545/plugin/e |
| ✅ | mobile-light | `broken.pptx` | error (expect error) | 680 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:5545/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:5545/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:5545/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:5545/plugin/editor/ |
| ✅ | mobile-light | `sample-docx.doc` | ready (expect ready) | 812 |  |
| ✅ | mobile-light | `sample-large.xlsx` | ready (expect ready) | 972 |  |
| ✅ | mobile-light | `sample-pptx.ppt` | ready (expect ready) | 727 |  |
| ✅ | mobile-light | `sample-shapes.pptx` | ready (expect ready) | 741 |  |
| ✅ | mobile-light | `sample.docx` | ready (expect ready) | 803 |  |
| ✅ | mobile-light | `sample.ods` | ready (expect ready) | 748 |  |
| ✅ | mobile-light | `sample.pptx` | ready (expect ready) | 713 |  |
| ✅ | mobile-light | `sample.xls` | ready (expect ready) | 729 |  |
| ✅ | mobile-light | `sample.xlsx` | ready (expect ready) | 758 |  |
