#!/bin/bash
# macOS (GitHub Actions runner): exercises installer/macos/*.command and installer/unix/file-preview.sh
# against a real Orca. Usage: bash test-installer-macos.sh <repo> <out-dir>
set -u
SRC=$1
OUT=$2
mkdir -p "$OUT"
LOG="$OUT/installer.log"
: >"$LOG"
ORCA=${ORCA:-/Applications/Orca.app/Contents/Resources/bin/orca}
for i in 1 2 3; do "$ORCA" open --json >/dev/null 2>&1 && break; sleep 5; done
# A package laid out like the release zip: plugin/ + installer/
PKG="$HOME/File Preview"
mkdir -p "$PKG" && cp -R "$SRC/plugin" "$SRC/installer" "$PKG/"
U="$PKG/installer/unix/file-preview.sh"
M="$PKG/installer/macos"
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
listed() { "$ORCA" plugin list 2>/dev/null | grep -q '^local\.file-preview .*idle'; }
not_listed() { ! "$ORCA" plugin list 2>/dev/null | grep -q 'file-preview'; }

step "status before install" 0 sh "$U" status
step "install declined without a terminal (nothing installed)" 1 sh "$U" install
step "plugin absent after decline" 0 not_listed
step "Install File Preview.command --yes" 0 sh "$M/Install File Preview.command" --yes
step "plugin listed and idle" 0 listed
step "editor renders a .docx in the installed copy" 0 "$ORCA" plugin shot local.file-preview --editor "$SRC/samples/sample.docx" --out "$OUT/installer-docx.png" --json
step "install again = update (file-preview.sh install --yes)" 0 sh "$U" install --yes
step "Uninstall File Preview.command --yes" 0 sh "$M/Uninstall File Preview.command" --yes
step "plugin gone after uninstall" 0 not_listed
step "uninstall when not installed is a no-op" 0 sh "$U" uninstall --yes
{
  echo "# Installer test · macOS $(sw_vers -productVersion) ($(uname -m)) · Orca $("$ORCA" --version 2>/dev/null | tail -1)"
  echo
  echo "| Step | Result | Detail |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${rows[@]}"
} >"$OUT/installer.md"
grep -q '❌' "$OUT/installer.md" && exit 1 || exit 0
