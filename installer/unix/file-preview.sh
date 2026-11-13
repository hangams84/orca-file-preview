#!/bin/sh
# File Preview for Orca — install / uninstall / status on macOS and Linux.
#
#   sh file-preview.sh install   [--source <folder|git-url>] [--yes] [--orca <cli>]
#   sh file-preview.sh uninstall [--yes] [--orca <cli>]
#   sh file-preview.sh status    [--orca <cli>]
#
# install   registers the plugin in Orca (the folder next to this package by default), shows the access
#           Orca asks you to approve, and approves it only after you confirm (or with --yes).
#           Running it again updates an existing install.
# uninstall removes every installed copy of the plugin (development folders are only reported).
# Needs Orca 1.4.248 or newer, installed and started at least once. No root rights needed.
set -u

PLUGIN_ID=file-preview
GITHUB_SOURCE=https://github.com/hangams84/orca-file-preview/tree/main/plugin
HERE=$(cd "$(dirname "$0")" && pwd)
PKG_ROOT=$(cd "$HERE/../.." 2>/dev/null && pwd)

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

ACTION=${1:-}
[ $# -gt 0 ] && shift
SOURCE=""
YES=0
ORCA=${ORCA_CLI_COMMAND:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE=${2:-}; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --orca) ORCA=${2:-}; shift 2 ;;
    -h|--help) ACTION=help; shift ;;
    *) die "unknown option: $1" ;;
  esac
done

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
}

# --- Locate Orca's CLI ------------------------------------------------------------------------------
find_orca() {
  if [ -n "$ORCA" ]; then return 0; fi
  case "$(uname -s)" in
    Darwin)
      for c in "/Applications/Orca.app/Contents/Resources/bin/orca" "$HOME/Applications/Orca.app/Contents/Resources/bin/orca"; do
        [ -x "$c" ] && { ORCA=$c; return 0; }
      done
      command -v orca >/dev/null 2>&1 && { ORCA=$(command -v orca); return 0; }
      ;;
    *)
      # On Linux a bare `orca` is usually the GNOME screen reader: only use Orca's own `orca-ide`.
      command -v orca-ide >/dev/null 2>&1 && { ORCA=$(command -v orca-ide); return 0; }
      for c in /opt/Orca/orca-ide /opt/Orca/resources/bin/orca-ide /usr/bin/orca-ide "$HOME/.local/bin/orca-ide"; do
        [ -x "$c" ] && { ORCA=$c; return 0; }
      done
      ;;
  esac
  die "Orca's command line tool was not found. Install Orca (https://github.com/stablyai/orca/releases) and start it once, or pass --orca <path-to-cli>.
      Orca CLI를 찾지 못했습니다. Orca를 설치하고 한 번 실행한 뒤 다시 시도하거나 --orca <경로> 를 지정하세요."
}

ensure_running() {
  if "$ORCA" status --json 2>/dev/null | grep -q '"running": *true'; then return 0; fi
  say "Starting Orca... / Orca를 시작합니다..."
  "$ORCA" open --json >/dev/null 2>&1 || "$ORCA" open --json >/dev/null 2>&1 || die "Orca did not start. Start it once by hand and retry. / Orca를 시작하지 못했습니다."
}

# Lines of `orca plugin list` for this plugin: "<key> <version>  <status>  <flags>".
plugin_lines() { "$ORCA" plugin list 2>/dev/null | grep -E "^[^ ]+\.${PLUGIN_ID} " || true; }

confirm() { # question
  [ $YES = 1 ] && return 0
  printf '%s [y/N] ' "$1"
  read -r answer </dev/tty 2>/dev/null || answer=""
  case "$answer" in y|Y|yes|YES|예|네) return 0 ;; *) return 1 ;; esac
}

# Runs an Orca command that may stop with approval_required (exit 3); shows what the plugin would be
# granted and approves only after confirmation.
with_approval() {
  out=$("$@" 2>&1); rc=$?
  if [ $rc = 3 ]; then
    say ""
    say "$out" | grep -v -E '^Next step:|--approve|^To approve, run' | sed 's/^/  /'
    say ""
    fp=$(printf '%s' "$out" | grep -o 'ap1-[0-9a-f]*' | head -1)
    [ -n "$fp" ] || die "Orca asked for approval but gave no fingerprint."
    confirm "Approve this access and continue? / 위 권한을 승인하고 계속할까요?" || die "Cancelled: nothing was installed. / 취소되었습니다."
    out=$("$@" --approve "$fp" 2>&1); rc=$?
  fi
  [ $rc = 0 ] || { say "$out" >&2; return $rc; }
  return 0
}

resolve_source() {
  if [ -n "$SOURCE" ]; then
    case "$SOURCE" in
      http*|git@*|ssh://*) return 0 ;;
      *) [ -f "$SOURCE/orca-plugin.json" ] || die "$SOURCE has no orca-plugin.json."; SOURCE=$(cd "$SOURCE" && pwd); return 0 ;;
    esac
  fi
  if [ -f "$PKG_ROOT/plugin/orca-plugin.json" ]; then SOURCE="$PKG_ROOT/plugin"; else SOURCE=$GITHUB_SOURCE; fi
}

do_install() {
  find_orca; ensure_running; resolve_source
  say "Orca: $("$ORCA" --version 2>/dev/null | tail -1)  ($ORCA)"
  say "Source / 설치 원본: $SOURCE"
  existing=$(plugin_lines | grep -v ', dev' | awk '{print $1}' | head -1)
  dev=$(plugin_lines | grep ', dev' | awk '{print $1}' | head -1)
  if [ -n "$dev" ] && [ -z "$existing" ] && case "$SOURCE" in http*|git@*|ssh://*) false ;; *) true ;; esac; then
    die "A development copy ($dev) is loaded from a folder. Remove it first: \"$ORCA\" plugin dev unload <that folder>
      개발용으로 등록된 사본($dev)이 있습니다. 먼저 'plugin dev unload <폴더>' 로 해제하세요."
  fi
  if [ -n "$existing" ]; then
    say "Updating $existing ... / 기존 설치를 업데이트합니다"
    with_approval "$ORCA" plugin update "$existing" || die "Update failed. / 업데이트 실패"
  else
    say "Installing ... / 설치합니다"
    with_approval "$ORCA" plugin install "$SOURCE" || die "Install failed (a private GitHub repository needs Git credentials on this machine, e.g. 'gh auth setup-git'). / 설치 실패"
  fi
  line=$(plugin_lines | grep -v ', dev' | head -1)
  [ -n "$line" ] || die "Orca does not list the plugin after installing. / 설치 후 목록에 없습니다."
  say ""
  say "Installed / 설치 완료: $line"
  say "Open a .docx, .pdf, .xlsx ... file in Orca. Text-like files (.txt .csv .html .svg) open in Orca's own view first: use the view toggle at the tab's top right."
  say "Orca에서 .docx, .pdf, .xlsx 등을 열어 보세요. .txt .csv .html .svg 는 탭 오른쪽 위 보기 전환으로 미리보기를 선택합니다."
}

do_uninstall() {
  find_orca; ensure_running
  keys=$(plugin_lines | grep -v ', dev' | awk '{print $1}')
  dev=$(plugin_lines | grep ', dev' | awk '{print $1}')
  if [ -z "$keys" ]; then
    say "File Preview is not installed. / 설치되어 있지 않습니다."
  else
    say "Installed copies / 설치된 항목:"; say "$keys" | sed 's/^/  /'
    confirm "Remove them from Orca? / Orca에서 제거할까요?" || die "Cancelled. / 취소되었습니다."
    for k in $keys; do
      "$ORCA" plugin uninstall "$k" >/dev/null 2>&1 && say "Removed / 제거됨: $k" || say "Could not remove / 제거 실패: $k"
    done
  fi
  [ -n "$dev" ] && say "Note: development copy still loaded: $dev ('plugin dev unload <folder>' removes it). / 개발용 등록은 그대로입니다."
  remaining=$(plugin_lines | grep -v ', dev')
  [ -z "$remaining" ] || die "Still installed: $remaining"
  return 0
}

do_status() {
  find_orca
  say "Orca: $("$ORCA" --version 2>/dev/null | tail -1)  ($ORCA)"
  lines=$(plugin_lines)
  if [ -n "$lines" ]; then say "$lines"; else say "File Preview is not installed. / 설치되어 있지 않습니다."; fi
}

case "$ACTION" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  status) do_status ;;
  *) usage; [ "$ACTION" = help ] || exit 2 ;;
esac
