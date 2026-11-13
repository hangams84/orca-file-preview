#!/bin/sh
# Double-click in Finder to install File Preview into Orca. / Finder에서 더블클릭하면 설치됩니다.
cd "$(dirname "$0")" || exit 1
sh ../unix/file-preview.sh install "$@"
rc=$?
printf '\nPress Return to close. / Return 키를 누르면 닫힙니다. '
read -r _ </dev/tty 2>/dev/null
exit $rc
