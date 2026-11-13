#!/bin/sh
# Double-click in Finder to update File Preview to the newest release. / 더블클릭하면 최신 버전으로 업데이트합니다.
cd "$(dirname "$0")" || exit 1
sh ../unix/file-preview.sh update "$@"
rc=$?
printf '\nPress Return to close. / Return 키를 누르면 닫힙니다. '
read -r _ </dev/tty 2>/dev/null
exit $rc
