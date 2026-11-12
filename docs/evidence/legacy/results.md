# Harness results

38 / 38 passed · 2026-11-12T06:14:25.858Z · filter: .doc,.ppt,csv,tsv (.docx/.pptx fixtures belong to other areas and were removed)

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.doc` | error (expect error) | 1068 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: PreviewError: notword
    at oleGuards (http://127.0.0.1:9301/plugin/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:9301/plugin/ |
    at f.readEndOfCentral (http://127.0.0.1:9301/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:9301/plugin/editor/renderers/docx.ts:52:11)
    at async show (http://127.0.0.1:9301/plugin/e |
| ✅ | desktop-dark | `broken.encrypted.doc` | error (expect error) | 793 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:9301/plugin/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:9301/plugi |
| ✅ | desktop-dark | `broken.encrypted.ppt` | error (expect error) | 783 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:9301/plugin/editor/renderers/ppt.ts:69:10)
    at Module.render (http://127.0.0.1:9301/plugi |
| ✅ | desktop-dark | `broken.ppt` | error (expect error) | 783 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:9301/plugin/editor/renderers/ppt.ts:46:11)
    at show (http://127.0.0.1:9301/plugin/editor/ma |
    at Lr (http://127.0.0.1:9301/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:9301/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:9301/plugin/editor/renderers/pptx.ts:44:11)
    at show (http://127.0.0.1:9301/plugin/editor/ |
| ✅ | desktop-dark | `sample-docx.doc` | ready (expect ready) | 796 |  |
| ✅ | desktop-dark | `sample-euckr.csv` | ready (expect ready) | 728 |  |
| ✅ | desktop-dark | `sample-html.doc` | ready (expect ready) | 775 |  |
| ✅ | desktop-dark | `sample-large.csv` | ready (expect ready) | 797 |  |
| ✅ | desktop-dark | `sample-large.doc` | ready (expect ready) | 810 |  |
| ✅ | desktop-dark | `sample-large.ppt` | ready (expect ready) | 768 |  |
| ✅ | desktop-dark | `sample-ppt97.ppt` | ready (expect ready) | 777 |  |
| ✅ | desktop-dark | `sample-pptx.ppt` | ready (expect ready) | 822 |  |
| ✅ | desktop-dark | `sample-rtf.doc` | ready (expect ready) | 783 |  |
| ✅ | desktop-dark | `sample-semicolon.csv` | ready (expect ready) | 767 |  |
| ✅ | desktop-dark | `sample-word97.doc` | ready (expect ready) | 819 |  |
| ✅ | desktop-dark | `sample.csv` | ready (expect ready) | 731 |  |
| ✅ | desktop-dark | `sample.doc` | ready (expect ready) | 785 |  |
| ✅ | desktop-dark | `sample.ppt` | ready (expect ready) | 768 |  |
| ✅ | desktop-dark | `sample.tsv` | ready (expect ready) | 779 |  |
| ✅ | mobile-light | `broken.doc` | error (expect error) | 767 | console: PreviewError: notword
    at oleGuards (http://127.0.0.1:9301/plugin/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:9301/plugin/ |
    at f.readEndOfCentral (http://127.0.0.1:9301/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:9301/plugin/editor/renderers/docx.ts:52:11)
    at async show (http://127.0.0.1:9301/plugin/e |
| ✅ | mobile-light | `broken.encrypted.doc` | error (expect error) | 781 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:9301/plugin/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:9301/plugi |
| ✅ | mobile-light | `broken.encrypted.ppt` | error (expect error) | 775 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:9301/plugin/editor/renderers/ppt.ts:69:10)
    at Module.render (http://127.0.0.1:9301/plugi |
| ✅ | mobile-light | `broken.ppt` | error (expect error) | 779 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:9301/plugin/editor/renderers/ppt.ts:46:11)
    at show (http://127.0.0.1:9301/plugin/editor/ma |
    at Lr (http://127.0.0.1:9301/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:9301/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:9301/plugin/editor/renderers/pptx.ts:44:11)
    at show (http://127.0.0.1:9301/plugin/editor/ |
| ✅ | mobile-light | `sample-docx.doc` | ready (expect ready) | 865 |  |
| ✅ | mobile-light | `sample-euckr.csv` | ready (expect ready) | 779 |  |
| ✅ | mobile-light | `sample-html.doc` | ready (expect ready) | 786 |  |
| ✅ | mobile-light | `sample-large.csv` | ready (expect ready) | 780 |  |
| ✅ | mobile-light | `sample-large.doc` | ready (expect ready) | 783 |  |
| ✅ | mobile-light | `sample-large.ppt` | ready (expect ready) | 758 |  |
| ✅ | mobile-light | `sample-ppt97.ppt` | ready (expect ready) | 769 |  |
| ✅ | mobile-light | `sample-pptx.ppt` | ready (expect ready) | 771 |  |
| ✅ | mobile-light | `sample-rtf.doc` | ready (expect ready) | 759 |  |
| ✅ | mobile-light | `sample-semicolon.csv` | ready (expect ready) | 770 |  |
| ✅ | mobile-light | `sample-word97.doc` | ready (expect ready) | 772 |  |
| ✅ | mobile-light | `sample.csv` | ready (expect ready) | 768 |  |
| ✅ | mobile-light | `sample.doc` | ready (expect ready) | 778 |  |
| ✅ | mobile-light | `sample.ppt` | ready (expect ready) | 768 |  |
| ✅ | mobile-light | `sample.tsv` | ready (expect ready) | 763 |  |
