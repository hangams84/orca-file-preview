#!/bin/bash
# Inside the orca-fp image: the updater against the real GitHub release (network needed).
#   docker run ... -v repo:/src:ro -v out:/out --entrypoint bash orca-fp:24.04 /src/tools/platform-test/test-update.sh
set -u
OUT=${OUT:-/out}
mkdir -p "$OUT"
LOG="$OUT/update.log"
: >"$LOG"
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
sleep 1
eval "$(dbus-launch --sh-syntax)"
orca-ide open --json >/dev/null 2>&1
cp -r /src/installer "$HOME/installer"
U="$HOME/installer/linux/update.sh"
rows=()
step() {
  local name=$1 want=$2; shift 2
  echo "===== $name: $*" >>"$LOG"
  "$@" >>"$LOG" 2>&1 </dev/null
  local rc=$?
  local ok=false; [ "$rc" = "$want" ] && ok=true
  rows+=("| $name | $([ $ok = true ] && echo ✅ || echo ❌) | exit $rc (expected $want) |")
  echo "$([ $ok = true ] && echo PASS || echo FAIL)  $name (exit $rc)"
}
step "update --check (nothing installed: reports the release)" 0 sh "$U" --check
step "update --yes (download, SHA-256, unpack, install)" 0 sh "$U" --yes
LATEST=$(curl -fsSL https://api.github.com/repos/hangams84/orca-file-preview/releases/latest | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"v//; s/"$//')
installed_is_latest() { orca-ide plugin list | grep -q "^local\.file-preview $LATEST "; }
step "installed version equals the latest release ($LATEST)" 0 installed_is_latest
step "update --check again: up to date" 0 sh -c "sh '$U' --check | grep -q 'Up to date'"
step "update --force reinstalls the same release" 0 sh "$U" --force --yes
step "per-user folder holds the release" 0 sh -c "ls \"\$HOME/.local/share/file-preview-orca\" | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$'"
{
  echo "# Updater test against the GitHub release · $(. /etc/os-release; echo "$PRETTY_NAME") · Orca $(orca-ide --version 2>/dev/null | tail -1)"
  echo
  echo "| Step | Result | Detail |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
} >"$OUT/update.md"
grep -q '❌' "$OUT/update.md" && exit 1 || exit 0
