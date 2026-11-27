# Screenshot install guide — capture tools

Builds `docs/install-guide/` (one page and one folder of screenshots per Orca UI language) by driving a real Orca
desktop app, not by mock-ups. Each language starts from a fresh Orca profile with the plugin not installed.

```sh
# Docker (on Windows: inside WSL2), network access to GitHub
bash tools/install-guide/run.sh                         # 11 languages, newest Orca release
LANGS="ko en" bash tools/install-guide/run.sh           # a subset (Orca language codes)
ORCA_VERSION=1.4.279 bash tools/install-guide/run.sh    # a given Orca version
node tools/install-guide/build-pages.mjs                # rewrite the .md pages from the captured labels
```

From Windows: `wsl -d Ubuntu -- bash -c 'cd /mnt/d/<repo> && bash tools/install-guide/run.sh'`, then run
`build-pages.mjs` with Node on either side. A full run takes about 3 minutes per language.

## How it works

| File | Role |
| --- | --- |
| `Dockerfile` | Ubuntu 24.04 + Orca `.deb` + Xvfb + fonts (Noto CJK/core, DejaVu, Liberation, emoji) + `playwright-core` + PIL + pngquant. Based on `tools/platform-test/Dockerfile`. |
| `run.sh` | Finds the newest Orca release (or `ORCA_VERSION`), builds `orca-guide:<version>` once, runs `in-container.sh` in a throw-away container with the repository mounted at `/src`. |
| `start-orca.sh` | Starts Xvfb (1440×900), a D-Bus session and Orca with `--remote-debugging-port=9222`, after deleting `~/.config/orca` (fresh profile). |
| `capture.mjs` | Attaches to Orca's renderer with `chromium.connectOverCDP`, marks onboarding as done, sets the UI language, reloads, then clicks through the flow by role and visible text. Before each click it saves a screenshot of the window and the element's bounding box; the labels are read from the DOM. Raw output: `.orca/install-guide-work/<lang>/`. |
| `annotate.py` | Draws the highlight (rounded rectangle, numbered badge outside the element; orange outline for context) with PIL from the measured boxes, runs pngquant, writes `docs/install-guide/<lang>/NN-<slug>.png` and the labels to `captured/<lang>.json`. |
| `text.mjs` | The sentences of each page, per language, with `{label}` placeholders. |
| `build-pages.mjs` | Writes `docs/install-guide/<lang>.md` and `README.md` from `text.mjs` and `captured/*.json`, so every label in a page is the text of its screenshot. |

**UI language.** Orca keeps it in its settings (`uiLanguage`: `system`, `en`, `ko`, `zh`, `zh-Hant`, `ja`, `de`, `fr`,
`es`, `pt`, `ru`, `tr`). `capture.mjs` sets it with `window.api.settings.set({ uiLanguage })` and reloads the renderer.
Folder names map Orca's codes to `zh-CN`, `zh-TW` and `pt-BR`.

**Finding elements in every language.** Each label is looked up by its key in Orca's own locale catalog
(`app.asar.unpacked/out/renderer/assets/<lang>-<hash>.json`), with the English text as fallback; the keys are in `K`
at the top of `capture.mjs`. Keys missing from a catalog are listed in `captured/<lang>.json` (`missingKeys`).

## After an Orca UI change

1. Run `LANGS=en bash tools/install-guide/run.sh` and look at the output: each step prints the labels it found.
2. If a step times out, open Orca's source for the new text (`src/renderer/src/i18n/locales/en.json`), update the
   key in `K` (and the role or matcher in `capture.mjs` if the element changed), and run again.
3. If a step was added or removed, add or remove its sentence (by slug) in every language in `text.mjs`;
   `build-pages.mjs` refuses to write a page with a step that has no text.
4. Run all languages, then `node tools/install-guide/build-pages.mjs`, and check the images (`git diff --stat`).

Steps: settings button → Settings → Plugins → Add plugin → From a Git URL… → URL field → Continue → Install →
trust prompt → Enable plugin (with the "Can access" list) → On / Back to app → open `samples/sample.docx` →
preview → optional DWG companion (dialog with its URL resolved; cancelled, not installed). If Orca shows an extra
permission dialog after Enable, it is captured as an additional `permissions` step.
