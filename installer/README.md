# File Preview for Orca — 설치 / 제거 (Install / Uninstall)

Orca 1.4.248 이상이 설치되어 있고 한 번 이상 실행된 PC에서 사용합니다. 관리자 권한은 필요 없습니다.
설치할 때 Orca가 요청하는 권한(샌드박스 화면 표시만, 추가 권한·네트워크 없음)을 보여 주고, 확인한 뒤에만 승인합니다.
이미 설치되어 있으면 같은 설치 명령이 업데이트로 동작합니다. 경로는 압축을 푼 `File Preview` 폴더 기준입니다.

| OS | 설치 | 제거 | 상태 확인 |
| --- | --- | --- | --- |
| Windows | `installer\windows\install.cmd` 더블클릭 | `installer\windows\uninstall.cmd` 더블클릭 | `powershell -ExecutionPolicy Bypass -File installer\windows\file-preview.ps1 status` |
| macOS | `installer/macos/Install File Preview.command` 더블클릭 | `installer/macos/Uninstall File Preview.command` 더블클릭 | `sh installer/unix/file-preview.sh status` |
| Linux | `sh installer/linux/install.sh` | `sh installer/linux/uninstall.sh` | `sh installer/unix/file-preview.sh status` |

- 무인 설치: Windows는 `install.cmd -Yes`, macOS/Linux는 `--yes` 를 붙이면 확인 질문 없이 승인합니다.
- 다른 원본에서 설치: `-Source <폴더|Git URL>` (Windows) / `--source <폴더|Git URL>` (macOS·Linux).
  기본값은 이 패키지의 `plugin/` 폴더이고, 없으면 GitHub 저장소(비공개 저장소는 이 PC에 Git 인증 필요, 예: `gh auth setup-git`)입니다.
- Orca CLI 경로 지정: `-Orca <경로>` / `--orca <경로>` (기본: Windows `%LOCALAPPDATA%\Programs\orca\resources\bin\orca.exe`,
  macOS `/Applications/Orca.app/Contents/Resources/bin/orca`, Linux `orca-ide`).
- 폴더에서 설치하면 Orca가 파일을 복사해 둡니다. 나중에 업데이트할 때는 새 패키지를 같은 위치에 풀고 설치를 다시 실행하세요.
- macOS에서 처음 열 때 "확인되지 않은 개발자" 경고가 나오면 Finder에서 `.command` 파일을 Control-클릭 → 열기를 선택하세요.
- `orca plugin dev load` 로 개발용 등록을 해 둔 경우 먼저 `orca plugin dev unload <폴더>` 로 해제해야 합니다(설치 스크립트가 알려 줍니다).
- 설치 후: Orca에서 .docx, .pdf, .xlsx 등을 열면 미리보기가 열립니다. `.txt .csv .html .svg` 등은 Orca 기본 보기로 먼저 열리므로
  탭 오른쪽 위 보기 전환 버튼으로 미리보기를 선택하세요.

## English

Needs Orca 1.4.248 or newer, installed and started once; no administrator rights. The installer shows the
access Orca asks you to approve (sandboxed UI only: no extra capabilities, no network) and approves only
after you confirm. Running install again updates an existing install. Paths are relative to the unzipped
`File Preview` folder.

| OS | Install | Uninstall |
| --- | --- | --- |
| Windows | double-click `installer\windows\install.cmd` | double-click `installer\windows\uninstall.cmd` |
| macOS | double-click `installer/macos/Install File Preview.command` | double-click `installer/macos/Uninstall File Preview.command` |
| Linux | `sh installer/linux/install.sh` | `sh installer/linux/uninstall.sh` |

Unattended: `-Yes` (Windows) or `--yes` (macOS/Linux). Other source: `-Source` / `--source <folder|git-url>`.
Orca CLI location: `-Orca` / `--orca <path>`. A development copy loaded with `orca plugin dev load` must be
unloaded first (`orca plugin dev unload <folder>`); the installer tells you when that is the case.
