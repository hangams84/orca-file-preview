#!/bin/bash
# On this PC (Git Bash + the installed Orca): installs File Preview from the Git URL the way Orca's
# "Install → Git URL" dialog does, then tests every format in the installed plugin.
#   bash tools/platform-test/local-git-install-test.sh <out-dir> [git-url]
# Needs: the development copy unloaded first (same extensions), FP_PYTHON with Pillow for crops.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:?out dir}
URL=${2:-https://github.com/hangams84/orca-file-preview.git}
ORCA=${ORCA:-orca}
PY=${FP_PYTHON:-python}
mkdir -p "$OUT/window" "$OUT/mount"
rows=()
row() { rows+=("| $1 | $([ "$2" = true ] && echo ✅ || echo ❌) | $3 |"); echo "$([ "$2" = true ] && echo PASS || echo FAIL)  $1  $3"; }

# 1. Install from the Git URL (approval like the dialog's "계속" -> approve)
r1=$($ORCA plugin install "$URL" --json 2>&1)
code=$(printf '%s' "$r1" | grep -o '"code": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
ver=$(printf '%s' "$r1" | grep -o '"version": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fp=$(printf '%s' "$r1" | grep -o 'ap1-[0-9a-f]*' | head -1)
row "Git URL resolves and passes Orca's size/file limits" "$([ "$code" = approval_required ] && echo true || echo false)" "$code, version $ver ($URL)"
r2=$($ORCA plugin install "$URL" --approve "$fp" --json 2>&1)
key=$(printf '%s' "$r2" | grep -o '"pluginKey": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
line=$($ORCA plugin list 2>/dev/null | grep 'file-preview' | grep -v ', dev')
row "approved install is listed and idle" "$(printf '%s' "$line" | grep -q 'idle' && echo true || echo false)" "$line"
KEY=${key:-hangams84.file-preview}

# 2. Every fixture mounts in the installed plugin's editor
mounted=0; total=0; native=0
for f in $(ls "$ROOT/samples" | sort); do
  [ -f "$ROOT/samples/$f" ] || continue
  r=$($ORCA plugin shot "$KEY" --editor "samples/$f" --out "$OUT/mount/$f.png" --json 2>&1)
  if printf '%s' "$r" | grep -qi 'not on screen'; then native=$((native + 1)); continue; fi
  total=$((total + 1))
  case "$f" in broken.*) [ -f "$OUT/mount/$f.png" ] && mounted=$((mounted + 1)) ;; *) printf '%s' "$r" | grep -q '"ok": *true' && mounted=$((mounted + 1)) ;; esac
done
row "every sample file mounts in the installed plugin" "$([ $mounted = $total ] && echo true || echo false)" "$mounted / $total mounted; $native open in Orca's own view first"

# 3. Finished renders of each format family (open, wait, window capture without the left sidebar)
caps=0; caps_ok=0
for f in sample.docx samples/fidelity/doc/word-a4-korean.doc sample.pptx sample.ppt sample.xlsx sample.xls sample.pdf \
  sample.hwp samples/fidelity/hwpx/hwpxlib-project-plan.hwpx sample.glb sample.stl sample.gif sample.bmp sample-utf16.xhtml; do
  case "$f" in samples/*) p=$f ;; *) p=samples/$f ;; esac
  n=$(basename "$p"); caps=$((caps + 1))
  ed=$($ORCA plugin open "$KEY" --editor "$p" --json 2>&1 | grep -o '"editorId": *"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')
  sleep 6
  if $ORCA plugin shot "$KEY" --window --out "$OUT/window/$n.raw.png" --json >/dev/null 2>&1; then
    "$PY" "$ROOT/tools/crop.py" "$OUT/window/$n.raw.png" "$OUT/window/$n.png" 280 0 0 0 && rm -f "$OUT/window/$n.raw.png"
    caps_ok=$((caps_ok + 1)); echo "  captured $n ($ed)"
  fi
done
row "finished renders captured (Word, Slides, Sheet, PDF, Hangul, 3D, image, HTML)" "$([ $caps_ok = $caps ] && echo true || echo false)" "$caps_ok / $caps"

# 4. Plugin log
logs=$($ORCA plugin logs "$KEY" 2>&1)
errs=$(printf '%s\n' "$logs" | grep -c ' error ' || true)
row "no error lines in the installed plugin's log" "$([ "$errs" = 0 ] && echo true || echo false)" "$errs error lines"
{
  echo "# Install-from-Git-URL and feature test · $(uname -s) · Orca $($ORCA --version 2>/dev/null | tail -1)"
  echo
  echo "| Step | Result | Detail |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
} >"$OUT/summary.md"
grep -q '❌' "$OUT/summary.md" && exit 1 || exit 0
