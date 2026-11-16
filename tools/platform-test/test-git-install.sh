#!/bin/bash
# Inside the orca-fp image: installs the plugin from the repository's Git URL the way Orca's
# "Install → Git URL" dialog does (newest vX.Y.Z tag), approves it and checks it is listed.
#   EXPECT=0.2.2 bash test-git-install.sh [repo-url]
set -u
URL=${1:-https://github.com/hangams84/orca-file-preview.git}
EXPECT=${EXPECT:-}
OUT=${OUT:-/out}
mkdir -p "$OUT"
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
sleep 1
eval "$(dbus-launch --sh-syntax)"
orca-ide open --json >/dev/null 2>&1
fail() { echo "FAIL  $*"; exit 1; }
orca-ide plugin install "$URL" --json >"$OUT/git-install-1.json" 2>&1
code=$(jq -r '.error.code // "ok"' "$OUT/git-install-1.json")
echo "first install attempt: $code"
[ "$code" = approval_required ] || fail "expected approval_required, got $code: $(jq -r '.error.message // empty' "$OUT/git-install-1.json" | head -c 300)"
ver=$(jq -r '.error.data.version // empty' "$OUT/git-install-1.json")
[ -z "$EXPECT" ] || [ "$ver" = "$EXPECT" ] || fail "Git URL resolves to $ver, expected $EXPECT"
fp=$(jq -r '.error.data.approvalFingerprint' "$OUT/git-install-1.json")
orca-ide plugin install "$URL" --approve "$fp" --json >"$OUT/git-install-2.json" 2>&1
[ "$(jq -r '.ok' "$OUT/git-install-2.json")" = true ] || fail "approved install failed: $(jq -r '.error.message // empty' "$OUT/git-install-2.json" | head -c 300)"
line=$(orca-ide plugin list 2>/dev/null | grep 'file-preview')
echo "$line"
echo "$line" | grep -q "file-preview ${EXPECT:-[0-9]}" || fail "not listed"
echo "PASS  Git URL install: $URL -> $line"
