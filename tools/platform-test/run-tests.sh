#!/bin/bash
# Runs inside the orca-fp image: starts Orca's desktop app on a virtual display, installs the File
# Preview plugin from /src/plugin (read-only mount of the repository) and tests it in that Orca.
# Results go to /out (results.json, summary.md, screenshots, logs).
set -u
SRC=/src
OUT=/out
ORCA=orca-ide
KEY=local.file-preview
mkdir -p "$OUT/orca" "$OUT/window" "$OUT/logs"
. /etc/os-release
PLATFORM="ubuntu-${VERSION_ID}"
START=$(date +%s)

declare -a CHECKS=()
check() { # name ok detail
  CHECKS+=("$(jq -cn --arg n "$1" --argjson ok "$2" --arg d "$3" '{name:$n, ok:$ok, detail:$d}')")
  printf '%s  %s  %s\n' "$([ "$2" = true ] && echo PASS || echo FAIL)" "$1" "$(echo "$3" | head -1)"
}

# --- Orca on a virtual display -------------------------------------------------------------------
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >"$OUT/logs/xvfb.log" 2>&1 &
sleep 1
eval "$(dbus-launch --sh-syntax)"
$ORCA open --json >"$OUT/logs/open.json" 2>&1
OPEN_OK=$(jq -r '.ok // false' "$OUT/logs/open.json" 2>/dev/null || echo false)
VERSION=$($ORCA --version 2>/dev/null | tail -1)
check "Orca $VERSION desktop starts (Xvfb)" "$OPEN_OK" "$(jq -c '.result.app // .error // empty' "$OUT/logs/open.json" 2>/dev/null)"
for i in $(seq 1 30); do # wait for the runtime graph
  st=$($ORCA status --json 2>/dev/null | jq -r '.result.runtime.state // empty')
  [ "$st" = ready ] && break
  sleep 1
done

# --- Install the plugin like a user would (folder install, explicit approval) --------------------
cp -r "$SRC/plugin" "$HOME/file-preview"
cp -r "$SRC/samples" "$HOME/samples"
rm -rf "$HOME/samples/fuzz" "$HOME/samples/perf"
$ORCA plugin system on --json >/dev/null 2>&1
$ORCA plugin install "$HOME/file-preview" --json >"$OUT/logs/install-1.json" 2>&1
FP=$(jq -r '.error.data.approvalFingerprint // empty' "$OUT/logs/install-1.json")
if [ -n "$FP" ]; then
  jq -c '.error.data.grants' "$OUT/logs/install-1.json" >"$OUT/logs/grants.json"
  $ORCA plugin install "$HOME/file-preview" --approve "$FP" --json >"$OUT/logs/install-2.json" 2>&1
  INSTALL_OK=$(jq -r '.ok // false' "$OUT/logs/install-2.json")
else
  INSTALL_OK=$(jq -r '.ok // false' "$OUT/logs/install-1.json")
fi
check "plugin install (folder, approval $FP)" "$INSTALL_OK" "$(jq -c '.error.message // .result.plugin.status // .result.status // empty' "$OUT/logs/install-2.json" "$OUT/logs/install-1.json" 2>/dev/null | head -1)"
$ORCA plugin list --json >"$OUT/logs/plugin-list.json" 2>&1
STATUS=$(jq -r --arg k "$KEY" '.result.plugins[] | select(.pluginKey==$k) | .status' "$OUT/logs/plugin-list.json" 2>/dev/null)
EDITORS=$(jq -r --arg k "$KEY" '.result.plugins[] | select(.pluginKey==$k) | .customEditors | length' "$OUT/logs/plugin-list.json" 2>/dev/null)
check "plugin listed and enabled" "$([ -n "$STATUS" ] && [ "$STATUS" != disabled ] && echo true || echo false)" "status=$STATUS editors=$EDITORS"

# A fresh profile opens Orca's first-run dialog over everything: choose "Set up later" like a user.
$ORCA plugin shot "$KEY" --window --out "$OUT/logs/first-run.png" --json >/dev/null 2>&1 || true
for attempt in 1 2 3; do
  xdotool mousemove 332 926 click 1 2>/dev/null
  sleep 2
  xdotool key Escape 2>/dev/null
  sleep 1
done
$ORCA plugin shot "$KEY" --window --out "$OUT/logs/after-first-run.png" --json >/dev/null 2>&1 || true

# --- Static checks and unit tests on this OS -----------------------------------------------------
$ORCA plugin validate "$HOME/file-preview" --json >"$OUT/logs/validate.json" 2>&1
check "plugin validate" "$(jq -r '.result.valid // false' "$OUT/logs/validate.json")" "$(jq -c '.result.errors // .error.message' "$OUT/logs/validate.json")"
$ORCA plugin test "$HOME/file-preview" >"$OUT/logs/test.log" 2>&1
TEST_RC=$?
check "plugin test (unit, Node on $PLATFORM)" "$([ $TEST_RC = 0 ] && echo true || echo false)" "$(grep -E 'ℹ (pass|fail) ' "$OUT/logs/test.log" | tr '\n' ' ')"
$ORCA plugin check "$HOME/file-preview" --json >"$OUT/logs/check.json" 2>&1
check "plugin check (static)" "$([ $? = 0 ] && echo true || echo false)" "$(jq -c '.error.message // .result.issues // empty' "$OUT/logs/check.json" 2>/dev/null | head -c 300)"

# --- Every fixture in the installed plugin's editor (mount check at first paint) ----------------
declare -a SHOTS=()
mounted=0; total=0; native=0
for f in $(ls "$HOME/samples" | sort); do
  [ -f "$HOME/samples/$f" ] || continue
  r=$($ORCA plugin shot "$KEY" --editor "$HOME/samples/$f" --out "$OUT/orca/$f.png" --json 2>&1)
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
wins=0; wins_ok=0
for f in sample.docx sample.pptx sample.xlsx sample.pdf sample.doc sample.ppt sample-utf16.xhtml sample.gif; do
  [ -f "$HOME/samples/$f" ] || continue
  wins=$((wins + 1))
  $ORCA plugin open "$KEY" --editor "$HOME/samples/$f" --json >/dev/null 2>&1
  sleep 6
  if $ORCA plugin shot "$KEY" --window --out "$OUT/window/$f.png" --json >/dev/null 2>&1; then wins_ok=$((wins_ok + 1)); fi
done
check "finished renders captured from open tabs" "$([ $wins_ok = $wins ] && echo true || echo false)" "$wins_ok / $wins window captures"

$ORCA plugin logs "$KEY" >"$OUT/logs/plugin.log" 2>&1
ERRS=$(grep -c ' error ' "$OUT/logs/plugin.log" || true)
check "no error lines in the plugin log" "$([ "${ERRS:-0}" = 0 ] && echo true || echo false)" "$ERRS error lines$( [ "${ERRS:-0}" != 0 ] && grep ' error ' "$OUT/logs/plugin.log" | head -3 | sed 's/^/\n/')"

# --- Results --------------------------------------------------------------------------------------
printf '%s\n' "${CHECKS[@]}" | jq -s . >"$OUT/checks.json"
printf '%s\n' "${SHOTS[@]}" | jq -s . >"$OUT/shots.json"
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
