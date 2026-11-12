# Harness results

22 / 22 passed · 2026-11-12T06:14:31.897Z

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.docx` | error (expect error) | 827 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:4538/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:4538/plugin/editor/renderers/docx.ts:65:11)
    at async show (http://127.0.0.1:4538/plugin/e |
| ✅ | desktop-dark | `broken.pptx` | error (expect error) | 771 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:4538/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:4538/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:4538/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:4538/plugin/editor/ |
| ✅ | desktop-dark | `sample-docx.doc` | ready (expect ready) | 824 |  |
| ✅ | desktop-dark | `sample-large.xlsx` | ready (expect ready) | 981 |  |
| ✅ | desktop-dark | `sample-pptx.ppt` | ready (expect ready) | 752 |  |
| ✅ | desktop-dark | `sample-shapes.pptx` | ready (expect ready) | 765 |  |
| ✅ | desktop-dark | `sample.docx` | ready (expect ready) | 792 |  |
| ✅ | desktop-dark | `sample.ods` | ready (expect ready) | 760 |  |
| ✅ | desktop-dark | `sample.pptx` | ready (expect ready) | 765 |  |
| ✅ | desktop-dark | `sample.xls` | ready (expect ready) | 772 |  |
| ✅ | desktop-dark | `sample.xlsx` | ready (expect ready) | 775 |  |
| ✅ | mobile-light | `broken.docx` | error (expect error) | 770 | console: Error: Corrupted zip: can't find end of central directory
    at f.readEndOfCentral (http://127.0.0.1:4538/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:4538/plugin/editor/renderers/docx.ts:65:11)
    at async show (http://127.0.0.1:4538/plugin/e |
| ✅ | mobile-light | `broken.pptx` | error (expect error) | 768 | console: Error: invalid zip data
    at Lr (http://127.0.0.1:4538/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:4538/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:4538/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:4538/plugin/editor/ |
| ✅ | mobile-light | `sample-docx.doc` | ready (expect ready) | 811 |  |
| ✅ | mobile-light | `sample-large.xlsx` | ready (expect ready) | 968 |  |
| ✅ | mobile-light | `sample-pptx.ppt` | ready (expect ready) | 758 |  |
| ✅ | mobile-light | `sample-shapes.pptx` | ready (expect ready) | 763 |  |
| ✅ | mobile-light | `sample.docx` | ready (expect ready) | 825 |  |
| ✅ | mobile-light | `sample.ods` | ready (expect ready) | 772 |  |
| ✅ | mobile-light | `sample.pptx` | ready (expect ready) | 780 |  |
| ✅ | mobile-light | `sample.xls` | ready (expect ready) | 771 |  |
| ✅ | mobile-light | `sample.xlsx` | ready (expect ready) | 775 |  |
