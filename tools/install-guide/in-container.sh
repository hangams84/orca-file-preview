#!/bin/bash
# Inside the orca-guide image (see run.sh): capture every language, then draw the highlights.
#   bash in-container.sh "<orca-lang ...>"
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
LANGS=${1:-"ko en zh zh-Hant ja de fr es pt ru tr"}
WORK=/src/.orca/install-guide-work
DOCS=/src/docs/install-guide
export DISPLAY=:99
eval "$(dbus-launch --sh-syntax)"
# The sample the guide opens sits in the home folder, which Orca's Explorer shows on first start.
cp "/src/samples/${SAMPLE:-sample.docx}" "$HOME/"
rc=0
for l in $LANGS; do
  node "$HERE/capture.mjs" "$WORK" "$l" 2>&1 | grep -v '^\[' || true
  [ -f "$WORK/$l/steps.json" ] || { echo "!! no capture for $l"; rc=1; continue; }
  case $l in zh) d=zh-CN;; zh-Hant) d=zh-TW;; pt) d=pt-BR;; *) d=$l;; esac
  python3 "$HERE/annotate.py" "$WORK" "$DOCS" "$l" "$d" || rc=1
done
exit $rc
