#!/bin/bash
# Builds the Orca test image for each Ubuntu version and runs the plugin tests in it.
# Run inside WSL2 (or any Linux with Docker) from the repository root:
#   bash tools/platform-test/run-docker.sh [22.04 24.04]
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VERSIONS=("$@")
[ ${#VERSIONS[@]} -eq 0 ] && VERSIONS=(22.04 24.04)
rc=0
for v in "${VERSIONS[@]}"; do
  echo "=== Ubuntu $v"
  docker build -q -t "orca-fp:$v" --build-arg UBUNTU="$v" "$ROOT/tools/platform-test" >/dev/null || { echo "build failed"; rc=1; continue; }
  out="$ROOT/docs/evidence/platforms/ubuntu-$v"
  rm -rf "$out" && mkdir -p "$out" && chmod 777 "$out"
  # seccomp=unconfined: Chromium's sandbox needs user namespaces, blocked by Docker's default profile.
  docker run --rm --shm-size=1g --security-opt seccomp=unconfined \
    -v "$ROOT:/src:ro" -v "$out:/out" "orca-fp:$v" || rc=1
done
exit $rc
