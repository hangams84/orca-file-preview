#!/bin/sh
# Double-click in Finder to remove File Preview from Orca. / Finder에서 더블클릭하면 제거됩니다.
cd "$(dirname "$0")" || exit 1
sh ../unix/file-preview.sh uninstall "$@"
rc=$?
printf '\nPress Return to close. / Return 키를 누르면 닫힙니다. '
read -r _ </dev/tty 2>/dev/null
exit $rc
