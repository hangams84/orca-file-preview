#!/bin/sh
# File Preview for Orca — install / uninstall / status on macOS and Linux.
#
#   sh file-preview.sh install   [--source <folder|git-url>] [--yes] [--orca <cli>]
#   sh file-preview.sh uninstall [--yes] [--orca <cli>]
#   sh file-preview.sh status    [--orca <cli>]
#   sh file-preview.sh update    [--check] [--force] [--version vX.Y.Z] [--yes] [--orca <cli>]
#
# install   registers the plugin in Orca (the folder next to this package by default), shows the access
#           Orca asks you to approve, and approves it only after you confirm (or with --yes).
#           Running it again updates an existing install.
# uninstall removes every installed copy of the plugin (development folders are only reported).
# update    checks the latest GitHub release, downloads it (SHA-256 verified) into a per-user folder
#           and reinstalls from there; --check only reports, --force reinstalls the same version.
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
CHECK=0
FORCE=0
VERSION=""
REPO=${FP_REPO:-hangams84/orca-file-preview}
ORCA=${ORCA_CLI_COMMAND:-}
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE=${2:-}; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --orca) ORCA=${2:-}; shift 2 ;;
    --check) CHECK=1; shift ;;
    --force) FORCE=1; shift ;;
    --version) VERSION=${2:-}; shift 2 ;;
    -h|--help) ACTION=help; shift ;;
    *) die "unknown option: $1" ;;
  esac
done

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
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

# Orca 1.4.248-1.4.251 have no `plugin install`/`uninstall`: there the folder is registered with
# `plugin dev load` (files load from the folder, so keep it).
can_install() { ! "$ORCA" plugin install --help 2>&1 | grep -q 'Unknown command'; }

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
  if ! can_install; then
    case "$SOURCE" in http*|git@*|ssh://*) die "This Orca (1.4.248-1.4.251) has no 'plugin install': install from the package folder or update Orca to 1.4.252+. / 이 Orca 버전은 폴더 설치만 지원합니다." ;; esac
    say "This Orca (1.4.248-1.4.251) has no 'plugin install': registering the folder with 'plugin dev load' (keep this folder)."
    say "이 Orca 버전은 개발 폴더 등록 방식으로 설치합니다(폴더를 지우지 마세요)."
    if [ -n "$dev" ]; then
      say "Already registered: reloading. / 이미 등록되어 있어 다시 읽어 옵니다."
      "$ORCA" plugin dev reload >/dev/null 2>&1
    else
      with_approval "$ORCA" plugin dev load "$SOURCE" || die "Registration failed. / 등록 실패"
    fi
    line=$(plugin_lines | head -1)
    [ -n "$line" ] || die "Orca does not list the plugin after registering. / 등록 후 목록에 없습니다."
    say ""; say "Installed / 설치 완료: $line"
    return 0
  fi
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
  if ! can_install; then
    if [ -z "$(plugin_lines)" ]; then say "File Preview is not installed. / 설치되어 있지 않습니다."; return 0; fi
    confirm "Remove File Preview from Orca? / Orca에서 제거할까요?" || die "Cancelled. / 취소되었습니다."
    "$ORCA" plugin dev unload "$PKG_ROOT/plugin" >/dev/null 2>&1 || die "Could not unregister $PKG_ROOT/plugin"
    say "Removed / 제거됨: $PKG_ROOT/plugin"
    return 0
  fi
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


# --- update: newest GitHub release -> per-user folder -> reinstall ---------------------------------
data_home() {
  case "$(uname -s)" in
    Darwin) printf '%s\n' "$HOME/Library/Application Support/FilePreviewForOrca" ;;
    *) printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}/file-preview-orca" ;;
  esac
}
http_get() { curl -fsSL "$1" 2>/dev/null || wget -qO- "$1" 2>/dev/null; }
http_save() { curl -fsSL -o "$2" "$1" 2>/dev/null || wget -qO "$2" "$1" 2>/dev/null; }
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
ver_gt() { # $1 > $2 (x.y.z)
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" = "$1" ]
}
installed_version() { plugin_lines | grep -v ', dev' | awk '{print $2}' | head -1; }

do_update() {
  find_orca; ensure_running
  cur=$(installed_version)
  if [ -n "$VERSION" ]; then api="releases/tags/v${VERSION#v}"; else api="releases/latest"; fi
  json=$(http_get "https://api.github.com/repos/$REPO/$api") || {
    code=$(curl -s -o /dev/null -w '%{http_code}' "https://api.github.com/repos/$REPO/$api" 2>/dev/null)
    [ "$code" = 404 ] && die "No release published for $REPO yet. / 아직 게시된 릴리스가 없습니다."
    die "Could not reach GitHub ($REPO). / GitHub에 연결할 수 없습니다."
  }
  tag=$(printf '%s' "$json" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  [ -n "$tag" ] || die "No release found for $REPO ($api). / 릴리스를 찾지 못했습니다."
  latest=${tag#v}
  say "Installed / 설치됨: ${cur:-none / 없음} · Release / 릴리스: $latest"
  if [ -n "$cur" ] && ! ver_gt "$latest" "$cur" && [ $FORCE = 0 ]; then
    say "Up to date. / 최신 버전입니다."; return 0
  fi
  if [ $CHECK = 1 ]; then say "Update available: $latest (run without --check to install). / 업데이트가 있습니다."; return 0; fi
  home=$(data_home); dir="$home/$latest"; tmp="$home/.download-$$"
  mkdir -p "$tmp" || die "Cannot write $home"
  base="https://github.com/$REPO/releases/download/$tag/orca-file-preview-$latest"
  say "Downloading / 내려받는 중: $base.tar.gz"
  http_save "$base.tar.gz" "$tmp/pkg.tar.gz" || die "Download failed. / 내려받기 실패"
  http_save "$base.tar.gz.sha256" "$tmp/pkg.sha256" || die "Checksum download failed. / 체크섬 내려받기 실패"
  want=$(awk '{print $1}' "$tmp/pkg.sha256"); got=$(sha256_of "$tmp/pkg.tar.gz")
  [ "$want" = "$got" ] || { rm -rf "$tmp"; die "Checksum mismatch: the download is damaged. / 체크섬 불일치"; }
  say "SHA-256 OK: $got"
  rm -rf "$dir" && mkdir -p "$dir" && tar -xzf "$tmp/pkg.tar.gz" -C "$dir" || die "Could not unpack. / 압축 해제 실패"
  rm -rf "$tmp"
  new="$dir/File Preview/plugin"
  [ -f "$new/orca-plugin.json" ] || die "The package has no plugin folder. / 패키지에 plugin 폴더가 없습니다."
  # The folder install re-copies from its original folder, so switch: remove the old copy first.
  if [ -n "$cur" ]; then
    for k in $(plugin_lines | grep -v ', dev' | awk '{print $1}'); do "$ORCA" plugin uninstall "$k" >/dev/null 2>&1; done
  fi
  if [ -f "$home/current" ] && ! can_install; then "$ORCA" plugin dev unload "$(cat "$home/current")" >/dev/null 2>&1; fi
  SOURCE=$new
  PKG_ROOT="$dir/File Preview"
  do_install
  printf '%s\n' "$new" >"$home/current"
  # keep this and the previous version only
  vers=$(ls -1 "$home" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n)
  n=$(printf '%s\n' "$vers" | grep -c .)
  printf '%s\n' "$vers" | awk -v n="$n" 'NR <= n - 2' | while read -r old; do
    [ -n "$old" ] && [ "$old" != "$latest" ] && rm -rf "$home/$old"
  done
  say "Updated to $latest. / $latest 버전으로 업데이트했습니다."
}

case "$ACTION" in
  install) do_install ;;
  uninstall) do_uninstall ;;
  status) do_status ;;
  update) do_update ;;
  *) usage; [ "$ACTION" = help ] || exit 2 ;;
esac
