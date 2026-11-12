# Harness results

38 / 38 passed · 2026-11-12T06:46:06.760Z · .docx/.pptx rows of other areas removed

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.doc` | error (expect error) | 820 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: PreviewError: notword
    at oleGuards (http://127.0.0.1:5046/plugin/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:5046/plugin/ |
    at f.readEndOfCentral (http://127.0.0.1:5046/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:5046/plugin/editor/renderers/docx.ts:65:11)
    at async show (http://127.0.0.1:5046/plugin/e |
| ✅ | desktop-dark | `broken.encrypted.doc` | error (expect error) | 779 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:5046/plugin/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:5046/plugi |
| ✅ | desktop-dark | `broken.encrypted.ppt` | error (expect error) | 771 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:5046/plugin/editor/renderers/ppt.ts:70:10)
    at Module.render (http://127.0.0.1:5046/plugi |
| ✅ | desktop-dark | `broken.ppt` | error (expect error) | 772 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:5046/plugin/editor/renderers/ppt.ts:47:11)
    at show (http://127.0.0.1:5046/plugin/editor/ma |
    at Lr (http://127.0.0.1:5046/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:5046/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:5046/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:5046/plugin/editor/ |
| ✅ | desktop-dark | `sample-docx.doc` | ready (expect ready) | 894 |  |
| ✅ | desktop-dark | `sample-euckr.csv` | ready (expect ready) | 766 |  |
| ✅ | desktop-dark | `sample-html.doc` | ready (expect ready) | 766 |  |
| ✅ | desktop-dark | `sample-large.csv` | ready (expect ready) | 792 |  |
| ✅ | desktop-dark | `sample-large.doc` | ready (expect ready) | 794 |  |
| ✅ | desktop-dark | `sample-large.ppt` | ready (expect ready) | 779 |  |
| ✅ | desktop-dark | `sample-ppt97.ppt` | ready (expect ready) | 774 |  |
| ✅ | desktop-dark | `sample-pptx.ppt` | ready (expect ready) | 766 |  |
| ✅ | desktop-dark | `sample-rtf.doc` | ready (expect ready) | 778 |  |
| ✅ | desktop-dark | `sample-semicolon.csv` | ready (expect ready) | 773 |  |
| ✅ | desktop-dark | `sample-word97.doc` | ready (expect ready) | 777 |  |
| ✅ | desktop-dark | `sample.csv` | ready (expect ready) | 766 |  |
| ✅ | desktop-dark | `sample.doc` | ready (expect ready) | 774 |  |
| ✅ | desktop-dark | `sample.ppt` | ready (expect ready) | 779 |  |
| ✅ | desktop-dark | `sample.tsv` | ready (expect ready) | 768 |  |
| ✅ | mobile-light | `broken.doc` | error (expect error) | 777 | console: PreviewError: notword
    at oleGuards (http://127.0.0.1:5046/plugin/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:5046/plugin/ |
    at f.readEndOfCentral (http://127.0.0.1:5046/plugin/vendor/docx.js:2:32683)
    at f.load<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:5046/plugin/editor/renderers/docx.ts:65:11)
    at async show (http://127.0.0.1:5046/plugin/e |
| ✅ | mobile-light | `broken.encrypted.doc` | error (expect error) | 784 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:5046/plugin/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:5046/plugi |
| ✅ | mobile-light | `broken.encrypted.ppt` | error (expect error) | 778 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:5046/plugin/editor/renderers/ppt.ts:70:10)
    at Module.render (http://127.0.0.1:5046/plugi |
| ✅ | mobile-light | `broken.ppt` | error (expect error) | 783 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:5046/plugin/editor/renderers/ppt.ts:47:11)
    at show (http://127.0.0.1:5046/plugin/editor/ma |
    at Lr (http://127.0.0.1:5046/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:5046/plugin/editor/ren<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:5046/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:5046/plugin/editor/ |
| ✅ | mobile-light | `sample-docx.doc` | ready (expect ready) | 873 |  |
| ✅ | mobile-light | `sample-euckr.csv` | ready (expect ready) | 775 |  |
| ✅ | mobile-light | `sample-html.doc` | ready (expect ready) | 790 |  |
| ✅ | mobile-light | `sample-large.csv` | ready (expect ready) | 821 |  |
| ✅ | mobile-light | `sample-large.doc` | ready (expect ready) | 799 |  |
| ✅ | mobile-light | `sample-large.ppt` | ready (expect ready) | 796 |  |
| ✅ | mobile-light | `sample-ppt97.ppt` | ready (expect ready) | 777 |  |
| ✅ | mobile-light | `sample-pptx.ppt` | ready (expect ready) | 760 |  |
| ✅ | mobile-light | `sample-rtf.doc` | ready (expect ready) | 771 |  |
| ✅ | mobile-light | `sample-semicolon.csv` | ready (expect ready) | 782 |  |
| ✅ | mobile-light | `sample-word97.doc` | ready (expect ready) | 766 |  |
| ✅ | mobile-light | `sample.csv` | ready (expect ready) | 777 |  |
| ✅ | mobile-light | `sample.doc` | ready (expect ready) | 776 |  |
| ✅ | mobile-light | `sample.ppt` | ready (expect ready) | 797 |  |
| ✅ | mobile-light | `sample.tsv` | ready (expect ready) | 769 |  |
