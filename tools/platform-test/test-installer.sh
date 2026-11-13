#!/bin/bash
# Inside the orca-fp image: exercises installer/linux/{install,uninstall}.sh against a real Orca.
# Writes /out/installer.md and /out/installer.log; exits non-zero when a step fails.
set -u
OUT=/out
mkdir -p "$OUT"
LOG="$OUT/installer.log"
: >"$LOG"
. /etc/os-release
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
sleep 1
eval "$(dbus-launch --sh-syntax)"
orca-ide open --json >/dev/null 2>&1
cp -r /src/plugin /src/installer "$HOME/" && mkdir -p "$HOME/pkg" && mv "$HOME/plugin" "$HOME/installer" "$HOME/pkg/"
cp /src/samples/sample.docx "$HOME/"
P="$HOME/pkg/installer/linux"
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
listed() { orca-ide plugin list 2>/dev/null | grep -q '^local\.file-preview .*idle'; }
not_listed() { ! orca-ide plugin list 2>/dev/null | grep -q 'file-preview'; }

step "status before install" 0 sh "$P/../unix/file-preview.sh" status
step "install declined without a terminal (nothing installed)" 1 sh "$P/install.sh"
step "plugin absent after decline" 0 not_listed
step "install --yes (approval shown, then approved)" 0 sh "$P/install.sh" --yes
step "plugin listed and idle" 0 listed
step "editor renders a .docx in the installed copy" 0 orca-ide plugin shot local.file-preview --editor "$HOME/sample.docx" --out "$OUT/installer-docx.png" --json
step "install again = update" 0 sh "$P/install.sh" --yes
step "uninstall --yes" 0 sh "$P/uninstall.sh" --yes
step "plugin gone after uninstall" 0 not_listed
step "uninstall when not installed is a no-op" 0 sh "$P/uninstall.sh" --yes
{
  echo "# Installer test · $PRETTY_NAME · Orca $(orca-ide --version 2>/dev/null | tail -1)"
  echo
  echo "| Step | Result | Detail |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
} >"$OUT/installer.md"
cat "$OUT/installer.md" | grep -q '❌' && exit 1 || exit 0
