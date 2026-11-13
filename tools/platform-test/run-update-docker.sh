#!/bin/bash
# Runs tools/platform-test/test-update.sh (updater against the real GitHub release) in each Ubuntu image.
#   bash tools/platform-test/run-update-docker.sh [24.04 22.04]
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VERSIONS=("$@")
[ ${#VERSIONS[@]} -eq 0 ] && VERSIONS=(24.04)
rc=0
for v in "${VERSIONS[@]}"; do
  echo "=== Ubuntu $v"
  out="$ROOT/docs/evidence/platforms/ubuntu-$v"
  mkdir -p "$out" && chmod 777 "$out"
  docker run --rm --shm-size=1g --security-opt seccomp=unconfined \
    -v "$ROOT:/src:ro" -v "$out:/out" --entrypoint bash "orca-fp:$v" /src/tools/platform-test/test-update.sh || rc=1
done
exit $rc
