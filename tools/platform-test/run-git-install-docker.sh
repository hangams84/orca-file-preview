#!/bin/bash
# Local run of test-git-install.sh in the Ubuntu 24.04 Orca image.
#   bash tools/platform-test/run-git-install-docker.sh <git-url> <expected-version>
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
out="$ROOT/.orca/git-install"
mkdir -p "$out" && chmod 777 "$out"
docker run --rm --shm-size=1g --security-opt seccomp=unconfined -e EXPECT="${2:-}" \
  -v "$ROOT:/src:ro" -v "$out:/out" --entrypoint bash orca-fp:24.04 /src/tools/platform-test/test-git-install.sh "$1"
