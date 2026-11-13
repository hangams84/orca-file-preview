#!/bin/bash
# macOS port of run-tests.sh (bash 3.2 compatible). Runs on a macOS GUI session (GitHub Actions
# macos-15 runner): starts the installed Orca desktop app, installs the File Preview plugin from the
# repository's plugin/ folder with explicit approval, and tests it in that Orca.
# Usage: run-tests-macos.sh <repo-root> <out-dir>     (env ORCA = path of the orca CLI)
set -u
SRC=$(cd "${1:-.}" && pwd)
OUT=${2:-$PWD/out}
ORCA=${ORCA:-/Applications/Orca.app/Contents/Resources/bin/orca}
KEY=local.file-preview
WORK=${WORK:-$HOME/fp-work}
mkdir -p "$OUT/orca" "$OUT/window" "$OUT/logs" "$WORK"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
PLATFORM="macos-$(sw_vers -productVersion | cut -d. -f1)-$(uname -m)"
PRETTY_NAME="macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion), $(uname -m))"
START=$(date +%s)

CHECKS=()
check() { # name ok detail
  CHECKS+=("$(jq -cn --arg n "$1" --argjson ok "$2" --arg d "$3" '{name:$n, ok:$ok, detail:$d}')")
  printf '%s  %s  %s\n' "$([ "$2" = true ] && echo PASS || echo FAIL)" "$1" "$(echo "$3" | head -1)"
}
winshot() { # out.png -> captures Orca's whole window (never raises it)
  $ORCA plugin shot "$KEY" --window --out "$1" --json >"$1.json" 2>&1
}
# Text in a window capture, read by macOS Vision (tools/platform-test/ocr.swift). Orca's own
# accessibility tree needs a permission the runner does not grant, so the screen is checked by OCR.
OCR_BIN="$WORK/ocr"
swiftc -O "$SRC/tools/platform-test/ocr.swift" -o "$OCR_BIN" >"$OUT/logs/ocr-build.log" 2>&1
ocr() { "$OCR_BIN" "$@" 2>&1; }
dialog_shown() { # png -> 0 when the first-run dialog or its "Skip onboarding?" prompt is on it
  ocr "$1" >"$1.txt"
  grep -qiE "work with agents|Skip onboarding|Set up later" "$1.txt"
}

# --- Orca desktop app -----------------------------------------------------------------------------
# A cold first launch can outlast `orca open`'s own wait (runtime_timeout on the first try): retry.
OPEN_OK=false
for attempt in 1 2 3; do
  $ORCA open --json >"$OUT/logs/open-$attempt.json" 2>&1
  cp "$OUT/logs/open-$attempt.json" "$OUT/logs/open.json"
  OPEN_OK=$(jq -r '.ok // false' "$OUT/logs/open.json" 2>/dev/null || echo false)
  [ "$OPEN_OK" = true ] && break
  sleep 5
done
VERSION=$($ORCA --version 2>/dev/null | tail -1)
check "Orca $VERSION desktop starts (macOS GUI session)" "$OPEN_OK" "attempt $attempt: $(jq -c '.result.app // .error // empty' "$OUT/logs/open.json" 2>/dev/null)"
for i in $(seq 1 30); do # wait for the runtime graph
  st=$($ORCA status --json 2>/dev/null | jq -r '.result.runtime.state // empty')
  [ "$st" = ready ] && break
  sleep 1
done
$ORCA status --json >"$OUT/logs/status.json" 2>&1

# --- Install the plugin like a user would (folder install, explicit approval) --------------------
rm -rf "$WORK/file-preview" "$WORK/samples"
cp -R "$SRC/plugin" "$WORK/file-preview"
rm -rf "$WORK/file-preview/.orca"
cp -R "$SRC/samples" "$WORK/samples"
rm -rf "$WORK/samples/fuzz" "$WORK/samples/perf"
$ORCA plugin system on --json >/dev/null 2>&1
$ORCA plugin install "$WORK/file-preview" --json >"$OUT/logs/install-1.json" 2>&1
FP=$(jq -r '.error.data.approvalFingerprint // empty' "$OUT/logs/install-1.json")
if [ -n "$FP" ]; then
  jq -c '.error.data.grants' "$OUT/logs/install-1.json" >"$OUT/logs/grants.json"
  $ORCA plugin install "$WORK/file-preview" --approve "$FP" --json >"$OUT/logs/install-2.json" 2>&1
  INSTALL_OK=$(jq -r '.ok // false' "$OUT/logs/install-2.json")
  INSTALL_LOG="$OUT/logs/install-2.json"
else
  INSTALL_OK=$(jq -r '.ok // false' "$OUT/logs/install-1.json")
  INSTALL_LOG="$OUT/logs/install-1.json"
fi
check "plugin install (folder, approval $FP)" "$INSTALL_OK" "$(jq -c '.error.message // .result.plugin.status // .result.status // empty' "$INSTALL_LOG" 2>/dev/null | head -1)"
$ORCA plugin list --json >"$OUT/logs/plugin-list.json" 2>&1
STATUS=$(jq -r --arg k "$KEY" '.result.plugins[] | select(.pluginKey==$k) | .status' "$OUT/logs/plugin-list.json" 2>/dev/null)
EDITORS=$(jq -r --arg k "$KEY" '.result.plugins[] | select(.pluginKey==$k) | .customEditors | length' "$OUT/logs/plugin-list.json" 2>/dev/null)
check "plugin listed and enabled" "$([ -n "$STATUS" ] && [ "$STATUS" != disabled ] && echo true || echo false)" "status=$STATUS editors=$EDITORS"

# --- First-run dialog ("How do you want to work with agents?"): dismiss it like a user ----------
# Escape on the dialog asks "Skip onboarding?" with Skip focused; Return then confirms Skip.
# Keys go through System Events (the runner grants it Accessibility); each step is captured and
# read by OCR.
FR="$OUT/logs/first-run"
mkdir -p "$FR"
sleep 3
$ORCA computer permissions --json >"$FR/computer-permissions.json" 2>&1
DISMISSED=false; SEEN=false
for attempt in 1 2 3 4; do
  winshot "$FR/$attempt-before.png"
  if ! dialog_shown "$FR/$attempt-before.png"; then
    DISMISSED=true
    break
  fi
  SEEN=true
  osascript -e 'tell application "Orca" to activate' -e 'delay 1' \
    -e 'tell application "System Events" to key code 53' >"$FR/$attempt-escape.log" 2>&1
  sleep 1.5
  winshot "$FR/$attempt-after-escape.png"
  if grep -qi "Skip onboarding" <(ocr "$FR/$attempt-after-escape.png"); then
    osascript -e 'tell application "System Events" to key code 36' >"$FR/$attempt-return.log" 2>&1
    sleep 2
  fi
done
winshot "$OUT/logs/after-first-run.png"
dialog_shown "$OUT/logs/after-first-run.png" && DISMISSED=false
check "first-run dialog dismissed (Escape, then Skip)" "$DISMISSED" "dialog seen: $SEEN; after $attempt attempt(s); OCR of logs/after-first-run.png: $(head -c 200 "$OUT/logs/after-first-run.png.txt" | tr '\n' ' ')"

# --- Static checks and unit tests on this OS -----------------------------------------------------
$ORCA plugin validate "$WORK/file-preview" --json >"$OUT/logs/validate.json" 2>&1
check "plugin validate" "$(jq -r '.result.valid // false' "$OUT/logs/validate.json")" "$(jq -c '.result.errors // .error.message' "$OUT/logs/validate.json")"
$ORCA plugin test "$WORK/file-preview" >"$OUT/logs/test.log" 2>&1
TEST_RC=$?
check "plugin test (unit, Node on $PLATFORM)" "$([ $TEST_RC = 0 ] && echo true || echo false)" "$(grep -E 'ℹ (pass|fail) ' "$OUT/logs/test.log" | tr '\n' ' ')"
$ORCA plugin check "$WORK/file-preview" --json >"$OUT/logs/check.json" 2>&1
CHECK_RC=$?
check "plugin check (static)" "$([ $CHECK_RC = 0 ] && echo true || echo false)" "$(jq -c '.error.message // .result.issues // empty' "$OUT/logs/check.json" 2>/dev/null | head -c 300)"

# --- Every fixture in the installed plugin's editor (mount check at first paint) ----------------
SHOTS=()
mounted=0; total=0; native=0
for f in $(ls "$WORK/samples" | sort); do
  [ -f "$WORK/samples/$f" ] || continue
  r=$($ORCA plugin shot "$KEY" --editor "$WORK/samples/$f" --out "$OUT/orca/$f.png" --json 2>&1)
  msg=$(echo "$r" | jq -r '.error.message // empty' 2>/dev/null)
  errs=$(echo "$r" | jq -c '.result.errors // []' 2>/dev/null)
  if echo "$msg" | grep -qi "not on screen"; then
    native=$((native + 1)); state=toggle
  else
    total=$((total + 1))
    case "$f" in broken.*) expect_err=1 ;; *) expect_err=0 ;; esac
    if [ "$(echo "$r" | jq -r '.ok' 2>/dev/null)" = true ] || { [ $expect_err = 1 ] && [ -f "$OUT/orca/$f.png" ]; }; then
      mounted=$((mounted + 1)); state=ok
    else
      state=fail
    fi
  fi
  SHOTS+=("$(jq -cn --arg f "$f" --arg s "$state" --arg m "$msg" --argjson e "${errs:-[]}" '{file:$f, state:$s, message:$m, errors:$e}')")
  echo "  $state  $f"
done
check "editors mount in Orca without errors" "$([ $mounted = $total ] && echo true || echo false)" "$mounted / $total mounted; $native open in Orca's own view first"

# --- Finished renders from real open tabs ---------------------------------------------------------
# First: is the editor area visible (no dialog over it)? Open one file and capture the window.
$ORCA plugin open "$KEY" --editor "$WORK/samples/sample.docx" --json >"$OUT/logs/open-editor.json" 2>&1
sleep 6
winshot "$OUT/logs/editor-visible.png"
VIS_OK=false
[ -s "$OUT/logs/editor-visible.png" ] && ! dialog_shown "$OUT/logs/editor-visible.png" && VIS_OK=true
check "editor visible before window captures (no dialog, OCR)" "$VIS_OK" "logs/editor-visible.png: $(head -c 200 "$OUT/logs/editor-visible.png.txt" | tr '\n' ' ')"
wins=0; wins_ok=0
for f in sample.docx sample.pptx sample.xlsx sample.pdf sample.doc sample.ppt sample-utf16.xhtml sample.gif; do
  [ -f "$WORK/samples/$f" ] || continue
  wins=$((wins + 1))
  $ORCA plugin open "$KEY" --editor "$WORK/samples/$f" --json >/dev/null 2>&1
  sleep 6
  if $ORCA plugin shot "$KEY" --window --out "$OUT/window/$f.png" --json >/dev/null 2>&1; then wins_ok=$((wins_ok + 1)); fi
done
check "finished renders captured from open tabs" "$([ $wins_ok = $wins ] && echo true || echo false)" "$wins_ok / $wins window captures"
# OCR every finished render: no dialog over it, and Hangul text where the fixture has Korean text.
mkdir -p "$OUT/window-ocr"
ocr_ok=0; ocr_n=0; ocr_detail=""
for png in "$OUT"/window/*.png; do
  [ -f "$png" ] || continue
  name=$(basename "$png" .png)
  ocr "$png" >"$OUT/window-ocr/$name.txt"
  hangul=$(perl -CSD -ne '$n += () = /\p{Hangul}/g; END { print $n+0 }' "$OUT/window-ocr/$name.txt")
  dlg=no; grep -qiE "work with agents|Skip onboarding" "$OUT/window-ocr/$name.txt" && dlg=yes
  ocr_n=$((ocr_n + 1))
  case "$name" in sample.gif) need=0 ;; *) need=1 ;; esac
  if [ $dlg = no ] && [ "$hangul" -ge $need ]; then ocr_ok=$((ocr_ok + 1)); fi
  ocr_detail="$ocr_detail $name:hangul=$hangul,dialog=$dlg;"
done
check "finished renders show Korean text, no dialog (OCR)" "$([ $ocr_ok = $ocr_n ] && [ $ocr_n -gt 0 ] && echo true || echo false)" "$ocr_ok / $ocr_n:$ocr_detail"

$ORCA plugin logs "$KEY" >"$OUT/logs/plugin.log" 2>&1
ERRS=$(grep -c ' error ' "$OUT/logs/plugin.log" || true)
check "no error lines in the plugin log" "$([ "${ERRS:-0}" = 0 ] && echo true || echo false)" "$ERRS error lines$( [ "${ERRS:-0}" != 0 ] && grep ' error ' "$OUT/logs/plugin.log" | head -3 | sed 's/^/\n/')"

# --- Results --------------------------------------------------------------------------------------
printf '%s\n' "${CHECKS[@]}" | jq -s . >"$OUT/checks.json"
printf '%s\n' ${SHOTS[@]+"${SHOTS[@]}"} | jq -s . >"$OUT/shots.json"
jq -n --arg p "$PLATFORM" --arg pretty "$PRETTY_NAME" --arg v "$VERSION" --arg k "$(uname -r)" \
  --argjson secs $(( $(date +%s) - START )) --slurpfile c "$OUT/checks.json" --slurpfile s "$OUT/shots.json" \
  '{platform:$p, os:$pretty, orcaVersion:$v, kernel:$k, durationSec:$secs, date:(now|todate), checks:$c[0], shots:$s[0]}' >"$OUT/results.json"
{
  echo "# $PRETTY_NAME · Orca $VERSION"
  echo
  echo "| Check | Result | Detail |"
  echo "| --- | --- | --- |"
  jq -r '.[] | "| \(.name) | \(if .ok then "✅" else "❌" end) | \(.detail | gsub("\n"; "<br>") | gsub("\\|"; "\\\\|") | .[0:300]) |"' "$OUT/checks.json"
} >"$OUT/summary.md"
$ORCA quit --json >/dev/null 2>&1 || true
jq -e 'all(.[]; .ok)' "$OUT/checks.json" >/dev/null
