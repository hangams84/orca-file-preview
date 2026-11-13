#!/bin/bash
# Inside the orca-fp image: tests dist/file-preview-setup-<v>.run (self-extracting installer) and the
# update command against a real Orca. Usage: bash test-setup-run.sh  (repo mounted at /src, results /out)
set -u
OUT=${OUT:-/out}
mkdir -p "$OUT"
LOG="$OUT/setup-run.log"
: >"$LOG"
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
sleep 1
eval "$(dbus-launch --sh-syntax)"
orca-ide open --json >/dev/null 2>&1
RUN=$(ls /src/dist/file-preview-setup-*.run | head -1)
rows=()
step() { # name expected-exit command...
  local name=$1 want=$2; shift 2
  echo "===== $name: $*" >>"$LOG"
  "$@" >>"$LOG" 2>&1 </dev/null
  local rc=$?
  local ok=false; [ "$rc" = "$want" ] && ok=true
  rows+=("| $name | $([ $ok = true ] && echo ✅ || echo ❌) | exit $rc (expected $want) |")
  echo "$([ $ok = true ] && echo PASS || echo FAIL)  $name (exit $rc)"
}
listed() { orca-ide plugin list 2>/dev/null | grep -q 'file-preview .*idle'; }
not_listed() { ! orca-ide plugin list 2>/dev/null | grep -q 'file-preview'; }
step "run: status" 0 sh "$RUN" status
step "run: install --yes" 0 sh "$RUN" install --yes
step "plugin listed and idle" 0 listed
step "unpacked into the per-user folder" 0 test -f "$HOME/.local/share/file-preview-orca/$(basename "$RUN" .run | sed 's/file-preview-setup-//')/File Preview/plugin/orca-plugin.json"
step "run: install again (replace) --yes" 0 sh "$RUN" install --yes
step "update --check (reports, changes nothing)" "${UPDATE_CHECK_EXIT:-0}" sh "$HOME/.local/share/file-preview-orca/"*/"File Preview/installer/unix/file-preview.sh" update --check
step "plugin still listed after the check" 0 listed
step "run: uninstall --yes" 0 sh "$RUN" uninstall --yes
step "plugin gone" 0 not_listed
{
  echo "# Self-extracting installer test · $(. /etc/os-release; echo "$PRETTY_NAME") · Orca $(orca-ide --version 2>/dev/null | tail -1)"
  echo
  echo "| Step | Result | Detail |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
} >"$OUT/setup-run.md"
grep -q '❌' "$OUT/setup-run.md" && exit 1 || exit 0
