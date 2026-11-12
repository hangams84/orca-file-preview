# Harness results

22 / 22 passed · 2026-11-12T06:47:20.613Z

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.docx` | error (expect error) | 821 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:6689/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:6689/plugin/editor/renderers/docx.ts:72:11)
    at async show (http://127.0.0.1:6689/plugin/e |
| ✅ | desktop-dark | `broken.pptx` | error (expect error) | 773 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:6689/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:6689/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:6689/plugin/editor/renderers/pptx.ts:44:11)
    at show (http://127.0.0.1:6689/plugin/editor/ |
| ✅ | desktop-dark | `sample-docx.doc` | ready (expect ready) | 888 |  |
| ✅ | desktop-dark | `sample-large.xlsx` | ready (expect ready) | 1108 |  |
| ✅ | desktop-dark | `sample-pptx.ppt` | ready (expect ready) | 782 |  |
| ✅ | desktop-dark | `sample-shapes.pptx` | ready (expect ready) | 775 |  |
| ✅ | desktop-dark | `sample.docx` | ready (expect ready) | 823 |  |
| ✅ | desktop-dark | `sample.ods` | ready (expect ready) | 896 |  |
| ✅ | desktop-dark | `sample.pptx` | ready (expect ready) | 761 |  |
| ✅ | desktop-dark | `sample.xls` | ready (expect ready) | 882 |  |
| ✅ | desktop-dark | `sample.xlsx` | ready (expect ready) | 880 |  |
| ✅ | mobile-light | `broken.docx` | error (expect error) | 773 | console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:6689/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:6689/plugin/editor/renderers/docx.ts:72:11)
    at async show (http://127.0.0.1:6689/plugin/e |
| ✅ | mobile-light | `broken.pptx` | error (expect error) | 777 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:6689/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:6689/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:6689/plugin/editor/renderers/pptx.ts:44:11)
    at show (http://127.0.0.1:6689/plugin/editor/ |
| ✅ | mobile-light | `sample-docx.doc` | ready (expect ready) | 900 |  |
| ✅ | mobile-light | `sample-large.xlsx` | ready (expect ready) | 1130 |  |
| ✅ | mobile-light | `sample-pptx.ppt` | ready (expect ready) | 773 |  |
| ✅ | mobile-light | `sample-shapes.pptx` | ready (expect ready) | 801 |  |
| ✅ | mobile-light | `sample.docx` | ready (expect ready) | 864 |  |
| ✅ | mobile-light | `sample.ods` | ready (expect ready) | 898 |  |
| ✅ | mobile-light | `sample.pptx` | ready (expect ready) | 781 |  |
| ✅ | mobile-light | `sample.xls` | ready (expect ready) | 885 |  |
| ✅ | mobile-light | `sample.xlsx` | ready (expect ready) | 876 |  |
