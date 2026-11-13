#!/bin/sh
# Update File Preview for Orca to the newest release: sh update.sh [--check] [--yes]
exec sh "$(cd "$(dirname "$0")" && pwd)/../unix/file-preview.sh" update "$@"
