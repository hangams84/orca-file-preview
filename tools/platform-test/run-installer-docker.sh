#!/bin/bash
# Tests installer/linux scripts against a real Orca in each Ubuntu image (built by run-docker.sh).
#   bash tools/platform-test/run-installer-docker.sh [22.04 24.04]
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VERSIONS=("$@")
[ ${#VERSIONS[@]} -eq 0 ] && VERSIONS=(22.04 24.04)
rc=0
for v in "${VERSIONS[@]}"; do
  echo "=== Ubuntu $v"
  docker image inspect "orca-fp:$v" >/dev/null 2>&1 ||
    docker build -q -t "orca-fp:$v" --build-arg UBUNTU="$v" "$ROOT/tools/platform-test" >/dev/null || { rc=1; continue; }
  out="$ROOT/docs/evidence/platforms/ubuntu-$v"
  mkdir -p "$out" && chmod 777 "$out"
  docker run --rm --shm-size=1g --security-opt seccomp=unconfined \
    -v "$ROOT:/src:ro" -v "$out:/out" --entrypoint bash "orca-fp:$v" /src/tools/platform-test/test-installer.sh || rc=1
done
exit $rc
