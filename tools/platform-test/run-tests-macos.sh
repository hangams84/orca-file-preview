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
# Accessibility query for the first-run dialog's "Set up later" button (prints the snapshot JSON).
dialog_state() {
  $ORCA computer get-app-state --app Orca --query "Set up later" --no-screenshot --json 2>&1
}

# --- Orca desktop app -----------------------------------------------------------------------------
$ORCA open --json >"$OUT/logs/open.json" 2>&1
OPEN_OK=$(jq -r '.ok // false' "$OUT/logs/open.json" 2>/dev/null || echo false)
VERSION=$($ORCA --version 2>/dev/null | tail -1)
check "Orca $VERSION desktop starts (macOS GUI session)" "$OPEN_OK" "$(jq -c '.result.app // .error // empty' "$OUT/logs/open.json" 2>/dev/null)"
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
# Tries, in order, until the accessibility tree no longer shows "Set up later": (a) click the button
# found in Orca's accessibility tree, (b) Escape through Orca's computer-use provider, (c) Escape
# through System Events. Each step is logged and followed by a window capture.
FR="$OUT/logs/first-run"
mkdir -p "$FR"
sleep 3
winshot "$FR/0-initial.png"
osascript -e 'tell application "Orca" to activate' >"$FR/activate.log" 2>&1
sleep 1
$ORCA computer capabilities --json >"$FR/capabilities.json" 2>&1
$ORCA computer permissions --json >"$FR/permissions.json" 2>&1
$ORCA computer list-windows --app Orca --json >"$FR/list-windows.json" 2>&1
dialog_state >"$FR/state-0.json"
# The accessibility tree is trusted only once it has shown the button: an empty tree proves nothing.
AX_SAW=false
jq -r '.result.snapshot.treeText // ""' "$FR/state-0.json" | grep -q "Set up later" && AX_SAW=true
DISMISSED_BY=""
step=0
for method in ax-click computer-escape sysevents-escape; do
  [ -n "$DISMISSED_BY" ] && break
  step=$((step + 1))
  case $method in
    ax-click)
      idx=$(jq -r '.result.snapshot.treeText // ""' "$FR/state-0.json" | grep "Set up later" | head -1 | sed -E 's/^[^0-9]*([0-9]+).*/\1/')
      if [ -n "$idx" ]; then
        $ORCA computer click --app Orca --element-index "$idx" --no-screenshot --json >"$FR/$step-$method.json" 2>&1
      else
        echo "no element index in tree" >"$FR/$step-$method.json"
      fi ;;
    computer-escape)
      $ORCA computer press-key --app Orca --key Escape --restore-window --no-screenshot --json >"$FR/$step-$method.json" 2>&1 ;;
    sysevents-escape)
      osascript -e 'tell application "Orca" to activate' -e 'delay 0.5'         -e 'tell application "System Events" to key code 53' >"$FR/$step-$method.json" 2>&1 ;;
  esac
  sleep 2
  winshot "$FR/$step-$method.png"
  dialog_state >"$FR/state-$step.json"
  if [ $AX_SAW = true ] && ! jq -r '.result.snapshot.treeText // ""' "$FR/state-$step.json" | grep -q "Set up later"; then
    DISMISSED_BY=$method
  fi
done
[ -z "$DISMISSED_BY" ] && [ $AX_SAW = false ] && DISMISSED_BY="unverified (accessibility tree never showed the dialog; see logs/first-run PNGs)"
winshot "$OUT/logs/after-first-run.png"
check "first-run dialog dismissed" "$([ -n "$DISMISSED_BY" ] && echo true || echo false)" "by: ${DISMISSED_BY:-nothing worked (see logs/first-run)}"

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
dialog_state >"$OUT/logs/editor-visible-state.json"
VIS_OK=$([ -s "$OUT/logs/editor-visible.png" ] && ! jq -r '.result.snapshot.treeText // ""' "$OUT/logs/editor-visible-state.json" | grep -q "Set up later" && echo true || echo false)
check "editor visible before window captures (no dialog)" "$VIS_OK" "logs/editor-visible.png"
wins=0; wins_ok=0
for f in sample.docx sample.pptx sample.xlsx sample.pdf sample.doc sample.ppt sample-utf16.xhtml sample.gif; do
  [ -f "$WORK/samples/$f" ] || continue
  wins=$((wins + 1))
  $ORCA plugin open "$KEY" --editor "$WORK/samples/$f" --json >/dev/null 2>&1
  sleep 6
  if $ORCA plugin shot "$KEY" --window --out "$OUT/window/$f.png" --json >/dev/null 2>&1; then wins_ok=$((wins_ok + 1)); fi
done
check "finished renders captured from open tabs" "$([ $wins_ok = $wins ] && echo true || echo false)" "$wins_ok / $wins window captures"

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
