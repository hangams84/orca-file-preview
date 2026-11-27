#!/bin/bash
# Re-capture the screenshot install guide in a throw-away Orca (Docker, Xvfb, CDP).
#   bash tools/install-guide/run.sh                 # all 11 languages, newest Orca release
#   LANGS="ko en" ORCA_VERSION=1.4.279 bash tools/install-guide/run.sh
# Needs Docker (on Windows: run it inside WSL2) and network access to GitHub.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
if [ -z "${ORCA_VERSION:-}" ]; then
  ORCA_VERSION=$(curl -fsSL https://api.github.com/repos/stablyai/orca/releases/latest | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
fi
[ -n "$ORCA_VERSION" ] || { echo "could not find the newest Orca release; set ORCA_VERSION" >&2; exit 1; }
IMAGE=orca-guide:$ORCA_VERSION
echo "Orca $ORCA_VERSION"
docker image inspect "$IMAGE" >/dev/null 2>&1 \
  || docker build -t "$IMAGE" --build-arg ORCA_VERSION="$ORCA_VERSION" "$ROOT/tools/install-guide"
mkdir -p "$ROOT/.orca/install-guide-work" "$ROOT/docs/install-guide"
chmod 777 "$ROOT/.orca/install-guide-work" "$ROOT/docs/install-guide" "$ROOT/tools/install-guide" 2>/dev/null || true
docker run --rm --init --hostname orca --shm-size=1g --security-opt seccomp=unconfined \
  -e SAMPLE="${SAMPLE:-sample.docx}" -v "$ROOT:/src" --entrypoint bash "$IMAGE" \
  /src/tools/install-guide/in-container.sh "${LANGS:-ko en zh zh-Hant ja de fr es pt ru tr}"
