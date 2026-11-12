# Harness results

38 / 38 passed · 2026-11-12T04:13:02.774Z · filter: .doc,.ppt,csv,tsv (sample.docx/.pptx/broken.docx belong to other areas and were removed)

| Result | Profile | File | State | Time (ms) | Notes |
| --- | --- | --- | --- | ---: | --- |
| ✅ | desktop-dark | `broken.doc` | error (expect error) | 833 | console: Failed to load resource: the server responded with a status of 404 (Not Found)<br>console: PreviewError: notword
    at oleGuards (http://127.0.0.1:13671/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:13671/editor/rende |
    at Module.render (http://127.0.0.1:13671/editor/renderers/docx.ts:3:9)
    at show (http://127.0.0.1:13671/editor/main.ts:76:25) |
| ✅ | desktop-dark | `broken.encrypted.doc` | error (expect error) | 889 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:13671/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:13671/editor/ren |
| ✅ | desktop-dark | `broken.encrypted.ppt` | error (expect error) | 958 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:13671/editor/renderers/ppt.ts:66:10)
    at Module.render (http://127.0.0.1:13671/editor/ren |
| ✅ | desktop-dark | `broken.ppt` | error (expect error) | 714 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:13671/editor/renderers/ppt.ts:43:11)
    at show (http://127.0.0.1:13671/editor/main.ts:76:25) |
| ✅ | desktop-dark | `sample-docx.doc` | ready (expect ready) | 756 |  |
| ✅ | desktop-dark | `sample-euckr.csv` | ready (expect ready) | 731 |  |
| ✅ | desktop-dark | `sample-html.doc` | ready (expect ready) | 731 |  |
| ✅ | desktop-dark | `sample-large.csv` | ready (expect ready) | 767 |  |
| ✅ | desktop-dark | `sample-large.doc` | ready (expect ready) | 828 |  |
| ✅ | desktop-dark | `sample-large.ppt` | ready (expect ready) | 709 |  |
| ✅ | desktop-dark | `sample-ppt97.ppt` | ready (expect ready) | 687 |  |
| ✅ | desktop-dark | `sample-pptx.ppt` | ready (expect ready) | 695 |  |
| ✅ | desktop-dark | `sample-rtf.doc` | ready (expect ready) | 773 |  |
| ✅ | desktop-dark | `sample-semicolon.csv` | ready (expect ready) | 691 |  |
| ✅ | desktop-dark | `sample-word97.doc` | ready (expect ready) | 920 |  |
| ✅ | desktop-dark | `sample.csv` | ready (expect ready) | 728 |  |
| ✅ | desktop-dark | `sample.doc` | ready (expect ready) | 867 |  |
    at Module.render (http://127.0.0.1:13671/editor/renderers/docx.ts:3:9)
    at show (http://127.0.0.1:13671/editor/main.ts:76:25) |
| ✅ | desktop-dark | `sample.ppt` | ready (expect ready) | 2203 |  |
    at Module.render (http://127.0.0.1:13671/editor/renderers/pptx.ts:3:9)
    at show (http://127.0.0.1:13671/editor/main.ts:76:25) |
| ✅ | desktop-dark | `sample.tsv` | ready (expect ready) | 723 |  |
| ✅ | mobile-light | `broken.doc` | error (expect error) | 720 | console: PreviewError: notword
    at oleGuards (http://127.0.0.1:13671/editor/renderers/doc.ts:68:11)
    at Module.render (http://127.0.0.1:13671/editor/rende |
    at Module.render (http://127.0.0.1:13671/editor/renderers/docx.ts:3:9)
    at show (http://127.0.0.1:13671/editor/main.ts:76:25) |
| ✅ | mobile-light | `broken.encrypted.doc` | error (expect error) | 729 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:13671/editor/renderers/doc.ts:57:10)
    at Module.render (http://127.0.0.1:13671/editor/ren |
| ✅ | mobile-light | `broken.encrypted.ppt` | error (expect error) | 683 | console: PreviewError: encrypted
    at encrypted (http://127.0.0.1:13671/editor/renderers/ppt.ts:66:10)
    at Module.render (http://127.0.0.1:13671/editor/ren |
| ✅ | mobile-light | `broken.ppt` | error (expect error) | 936 | console: PreviewError: cfb
    at Module.render (http://127.0.0.1:13671/editor/renderers/ppt.ts:43:11)
    at show (http://127.0.0.1:13671/editor/main.ts:76:25) |
| ✅ | mobile-light | `sample-docx.doc` | ready (expect ready) | 983 |  |
| ✅ | mobile-light | `sample-euckr.csv` | ready (expect ready) | 764 |  |
| ✅ | mobile-light | `sample-html.doc` | ready (expect ready) | 1124 |  |
| ✅ | mobile-light | `sample-large.csv` | ready (expect ready) | 848 |  |
| ✅ | mobile-light | `sample-large.doc` | ready (expect ready) | 792 |  |
| ✅ | mobile-light | `sample-large.ppt` | ready (expect ready) | 699 |  |
| ✅ | mobile-light | `sample-ppt97.ppt` | ready (expect ready) | 848 |  |
| ✅ | mobile-light | `sample-pptx.ppt` | ready (expect ready) | 706 |  |
| ✅ | mobile-light | `sample-rtf.doc` | ready (expect ready) | 718 |  |
| ✅ | mobile-light | `sample-semicolon.csv` | ready (expect ready) | 696 |  |
| ✅ | mobile-light | `sample-word97.doc` | ready (expect ready) | 731 |  |
| ✅ | mobile-light | `sample.csv` | ready (expect ready) | 741 |  |
| ✅ | mobile-light | `sample.doc` | ready (expect ready) | 733 |  |
    at Module.render (http://127.0.0.1:13671/editor/renderers/docx.ts:3:9)
    at show (http://127.0.0.1:13671/editor/main.ts:76:25) |
| ✅ | mobile-light | `sample.ppt` | ready (expect ready) | 697 |  |
    at Module.render (http://127.0.0.1:13671/editor/renderers/pptx.ts:3:9)
    at show (http://127.0.0.1:13671/editor/main.ts:76:25) |
| ✅ | mobile-light | `sample.tsv` | ready (expect ready) | 729 |  |
