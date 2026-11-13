#!/bin/sh
# Remove File Preview from Orca on Linux: sh uninstall.sh [--yes]
exec sh "$(cd "$(dirname "$0")" && pwd)/../unix/file-preview.sh" uninstall "$@"
