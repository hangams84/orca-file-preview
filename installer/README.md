# File Preview for Orca — 설치 · 업데이트 · 제거 (Install · Update · Uninstall)

Orca 1.4.248 이상이 설치되어 있고 한 번 이상 실행된 PC에서 사용합니다. 관리자 권한은 필요 없습니다.
설치할 때 Orca가 요청하는 권한(샌드박스 화면 표시만, 추가 권한·네트워크 없음)을 보여 주고, 확인한 뒤에만 승인합니다.
경로는 압축을 푼 `File Preview` 폴더 기준입니다.

## 실행 파일 / Executables (GitHub Releases)

| OS | 파일 | 사용법 |
| --- | --- | --- |
| Windows 10/11 | `FilePreviewSetup-<버전>.exe` | 더블클릭 → 메뉴(설치 · 업데이트 · 제거 · 상태). 명령줄: `/install` `/update` `/update /check` `/uninstall` `/status`, 무인 `/yes` |
| macOS | `File-Preview-Setup-<버전>-macos.zip` | 압축 해제 → *File Preview Setup.app* (처음엔 Control-클릭 → 열기) → 설치/업데이트/제거 선택, 터미널에서 진행 |
| macOS · Linux | `file-preview-setup-<버전>.run` | `sh file-preview-setup-<버전>.run [install\|update\|uninstall\|status] [--yes]` |

서명되지 않은 실행 파일입니다: Windows SmartScreen이 막으면 *추가 정보* → *실행*, macOS Gatekeeper는 Control-클릭 → *열기*.

## 스크립트 / Scripts (zip, tar.gz 패키지)

| OS | 설치 | 업데이트 | 제거 | 상태 |
| --- | --- | --- | --- | --- |
| Windows | `installer\windows\install.cmd` | `installer\windows\update.cmd` | `installer\windows\uninstall.cmd` | `powershell -ExecutionPolicy Bypass -File installer\windows\file-preview.ps1 status` |
| macOS | `installer/macos/Install File Preview.command` | `Update File Preview.command` | `Uninstall File Preview.command` | `sh installer/unix/file-preview.sh status` |
| Linux | `sh installer/linux/install.sh` | `sh installer/linux/update.sh` | `sh installer/linux/uninstall.sh` | `sh installer/unix/file-preview.sh status` |

- **업데이트**: 이 저장소의 최신 GitHub 릴리스를 확인 → 패키지를 내려받아 SHA-256 검증 → 사용자 폴더
  (Windows `%LOCALAPPDATA%\FilePreviewForOrca`, macOS `~/Library/Application Support/FilePreviewForOrca`,
  Linux `~/.local/share/file-preview-orca`)에 풀고 → 승인을 거쳐 다시 설치합니다. 이전 버전 하나는 보관합니다.
  `-Check` / `--check` 는 확인만, `-Force` / `--force` 는 같은 버전도 다시 설치, `-Version v0.1.0` / `--version v0.1.0` 은 특정 버전.
- 무인 실행: Windows `-Yes`, macOS/Linux `--yes`.
- 다른 원본에서 설치: `-Source <폴더|Git URL>` / `--source <폴더|Git URL>`.
- Orca CLI 경로 지정: `-Orca <경로>` / `--orca <경로>` (기본: Windows `%LOCALAPPDATA%\Programs\orca\resources\bin\orca.exe`,
  macOS `/Applications/Orca.app/Contents/Resources/bin/orca`, Linux `orca-ide`).
- Orca 1.4.248–1.4.251 에는 `plugin install` 이 없어 개발 폴더 등록(`plugin dev load`)으로 설치합니다. 이때는 폴더를 지우지 마세요.
- Windows 7/8 은 Orca(Electron)가 지원하지 않아 설치를 명확한 안내와 함께 거절합니다(Windows 10 이상 필요).
- `orca plugin dev load` 로 개발용 등록을 해 둔 경우 먼저 `orca plugin dev unload <폴더>` 로 해제해야 합니다(설치 스크립트가 알려 줍니다).
- 설치 후: Orca에서 파일을 열면 미리보기가 열립니다. `.txt .csv .html .svg` 등은 Orca 기본 보기로 먼저 열리므로 탭 오른쪽 위 보기 전환 버튼으로 미리보기를 선택하세요.

## English

Needs Orca 1.4.248+, installed and started once; no administrator rights. Every installer shows the access
Orca asks you to approve (sandboxed UI only) and approves only after you confirm.

- **Executables** (GitHub Releases): Windows `FilePreviewSetup-<v>.exe` (menu, or `/install /update /uninstall /status [/yes]`),
  macOS `File Preview Setup.app`, macOS/Linux `sh file-preview-setup-<v>.run [install|update|uninstall|status] [--yes]`.
  Unsigned: SmartScreen → *More info* → *Run anyway*; Gatekeeper → Control-click → *Open*.
- **Scripts**: `installer/windows/{install,update,uninstall}.cmd`, `installer/macos/{Install,Update,Uninstall} File Preview.command`,
  `installer/linux/{install,update,uninstall}.sh`.
- **Update** checks the latest GitHub release, downloads it, verifies its SHA-256, unpacks it into a per-user folder and
  reinstalls (keeps the previous version). `--check` reports only; `--force` reinstalls; `--version vX.Y.Z` picks a release.
- Orca 1.4.248–1.4.251 have no `plugin install`: the folder is registered with `plugin dev load` instead (keep the folder).
- Windows 7/8 are refused with a clear message (Orca needs Windows 10+).
