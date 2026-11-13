#!/bin/bash
# Builds dist/File-Preview-Setup-<version>-macos.zip containing "File Preview Setup.app" (macOS only:
# needs osacompile, ditto, codesign). The app bundles the release package and runs the installer in
# Terminal so the approval prompt is visible. Ad-hoc signed, not notarized: on first open use
# Control-click -> Open (or System Settings -> Privacy & Security -> Open Anyway).
#   node tools/package-release.mjs && bash tools/build-macos-app.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VER=$(python3 -c "import json;print(json.load(open('$ROOT/plugin/orca-plugin.json'))['version'])")
TGZ="$ROOT/dist/orca-file-preview-$VER.tar.gz"
[ -f "$TGZ" ] || { echo "missing $TGZ: run node tools/package-release.mjs" >&2; exit 1; }
WORK=$(mktemp -d)
APP="$WORK/File Preview Setup.app"
cat >"$WORK/setup.applescript" <<'APPLESCRIPT'
on run
	set res to (path to me as text) & "Contents:Resources:"
	set pkg to POSIX path of res & "File Preview/installer/unix/file-preview.sh"
	set choice to button returned of (display dialog "File Preview for Orca" & return & return & ¬
		"Install this version, update to the newest release, or remove it from Orca." & return & ¬
		"이 버전을 설치하거나, 최신 버전으로 업데이트하거나, Orca에서 제거합니다." ¬
		buttons {"Uninstall / 제거", "Update / 업데이트", "Install / 설치"} default button 3 with title "File Preview Setup")
	if choice starts with "Install" then
		set act to "install"
	else if choice starts with "Update" then
		set act to "update"
	else
		set act to "uninstall"
	end if
	-- Run in Terminal so the access approval prompt can be answered.
	tell application "Terminal"
		activate
		do script "sh " & quoted form of pkg & " " & act & "; echo; echo 'You can close this window. / 이 창을 닫아도 됩니다.'"
	end tell
end run
APPLESCRIPT
osacompile -o "$APP" "$WORK/setup.applescript"
tar -xzf "$TGZ" -C "$APP/Contents/Resources"
/usr/libexec/PlistBuddy -c "Set :CFBundleName File Preview Setup" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $VER" "$APP/Contents/Info.plist" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VER" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string io.github.hangams84.file-preview-setup" "$APP/Contents/Info.plist" 2>/dev/null ||
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier io.github.hangams84.file-preview-setup" "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP"
OUT="$ROOT/dist/File-Preview-Setup-$VER-macos.zip"
rm -f "$OUT"
(cd "$WORK" && ditto -c -k --sequesterRsrc --keepParent "File Preview Setup.app" "$OUT")
shasum -a 256 "$OUT" | sed "s#  .*#  $(basename "$OUT")#" >"$OUT.sha256"
echo "$(basename "$OUT") $(du -h "$OUT" | cut -f1) $(cat "$OUT.sha256")"
rm -rf "$WORK"
