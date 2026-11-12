# Harness results

38 / 38 passed · 2026-11-12T06:46:54.907Z · --no-raf (rAF + IntersectionObserver stubbed) · .docx/.pptx rows of other areas removed

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.doc` | error (expect error) | 826 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: PreviewError: notword
    at oleGuards (http://127.0.0.1:12476/plugin/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:12476/plugi |
    at f.readEndOfCentral (http://127.0.0.1:12476/plugin/vendor/docx.js:2:32683)
    at f.loa<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:12476/plugin/editor/renderers/docx.ts:65:11)
    at async show (http://127.0.0.1:12476/plugin |
| ✅ | desktop-dark | `broken.encrypted.doc` | error (expect error) | 770 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:12476/plugin/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:12476/plu |
| ✅ | desktop-dark | `broken.encrypted.ppt` | error (expect error) | 771 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:12476/plugin/editor/renderers/ppt.ts:70:10)
    at Module.render (http://127.0.0.1:12476/plu |
| ✅ | desktop-dark | `broken.ppt` | error (expect error) | 778 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:12476/plugin/editor/renderers/ppt.ts:47:11)
    at show (http://127.0.0.1:12476/plugin/editor/ |
    at Lr (http://127.0.0.1:12476/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:12476/plugin/editor/r<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:12476/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:12476/plugin/edito |
| ✅ | desktop-dark | `sample-docx.doc` | ready (expect ready) | 911 |  |
| ✅ | desktop-dark | `sample-euckr.csv` | ready (expect ready) | 780 |  |
| ✅ | desktop-dark | `sample-html.doc` | ready (expect ready) | 774 |  |
| ✅ | desktop-dark | `sample-large.csv` | ready (expect ready) | 803 |  |
| ✅ | desktop-dark | `sample-large.doc` | ready (expect ready) | 796 |  |
| ✅ | desktop-dark | `sample-large.ppt` | ready (expect ready) | 772 |  |
| ✅ | desktop-dark | `sample-ppt97.ppt` | ready (expect ready) | 807 |  |
| ✅ | desktop-dark | `sample-pptx.ppt` | ready (expect ready) | 789 |  |
| ✅ | desktop-dark | `sample-rtf.doc` | ready (expect ready) | 780 |  |
| ✅ | desktop-dark | `sample-semicolon.csv` | ready (expect ready) | 764 |  |
| ✅ | desktop-dark | `sample-word97.doc` | ready (expect ready) | 764 |  |
| ✅ | desktop-dark | `sample.csv` | ready (expect ready) | 778 |  |
| ✅ | desktop-dark | `sample.doc` | ready (expect ready) | 770 |  |
| ✅ | desktop-dark | `sample.ppt` | ready (expect ready) | 789 |  |
| ✅ | desktop-dark | `sample.tsv` | ready (expect ready) | 767 |  |
| ✅ | mobile-light | `broken.doc` | error (expect error) | 783 | console: PreviewError: notword
    at oleGuards (http://127.0.0.1:12476/plugin/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:12476/plugi |
    at f.readEndOfCentral (http://127.0.0.1:12476/plugin/vendor/docx.js:2:32683)
    at f.loa<br>console: PreviewError: docx
    at Module.render (http://127.0.0.1:12476/plugin/editor/renderers/docx.ts:65:11)
    at async show (http://127.0.0.1:12476/plugin |
| ✅ | mobile-light | `broken.encrypted.doc` | error (expect error) | 773 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:12476/plugin/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:12476/plu |
| ✅ | mobile-light | `broken.encrypted.ppt` | error (expect error) | 786 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:12476/plugin/editor/renderers/ppt.ts:70:10)
    at Module.render (http://127.0.0.1:12476/plu |
| ✅ | mobile-light | `broken.ppt` | error (expect error) | 792 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:12476/plugin/editor/renderers/ppt.ts:47:11)
    at show (http://127.0.0.1:12476/plugin/editor/ |
    at Lr (http://127.0.0.1:12476/plugin/vendor/zip.js:1:5079)
    at OoxmlPackage.open (http://127.0.0.1:12476/plugin/editor/r<br>console: PreviewError: pptx
    at Module.render (http://127.0.0.1:12476/plugin/editor/renderers/pptx.ts:45:11)
    at show (http://127.0.0.1:12476/plugin/edito |
| ✅ | mobile-light | `sample-docx.doc` | ready (expect ready) | 885 |  |
| ✅ | mobile-light | `sample-euckr.csv` | ready (expect ready) | 738 |  |
| ✅ | mobile-light | `sample-html.doc` | ready (expect ready) | 781 |  |
| ✅ | mobile-light | `sample-large.csv` | ready (expect ready) | 794 |  |
| ✅ | mobile-light | `sample-large.doc` | ready (expect ready) | 806 |  |
| ✅ | mobile-light | `sample-large.ppt` | ready (expect ready) | 780 |  |
| ✅ | mobile-light | `sample-ppt97.ppt` | ready (expect ready) | 782 |  |
| ✅ | mobile-light | `sample-pptx.ppt` | ready (expect ready) | 794 |  |
| ✅ | mobile-light | `sample-rtf.doc` | ready (expect ready) | 789 |  |
| ✅ | mobile-light | `sample-semicolon.csv` | ready (expect ready) | 786 |  |
| ✅ | mobile-light | `sample-word97.doc` | ready (expect ready) | 773 |  |
| ✅ | mobile-light | `sample.csv` | ready (expect ready) | 784 |  |
| ✅ | mobile-light | `sample.doc` | ready (expect ready) | 772 |  |
| ✅ | mobile-light | `sample.ppt` | ready (expect ready) | 771 |  |
| ✅ | mobile-light | `sample.tsv` | ready (expect ready) | 720 |  |
