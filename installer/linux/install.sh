#!/bin/sh
# Install File Preview into Orca on Linux: sh install.sh [--yes] [--source <folder|git-url>]
exec sh "$(cd "$(dirname "$0")" && pwd)/../unix/file-preview.sh" install "$@"
