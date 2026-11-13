<#
  File Preview for Orca - install / uninstall / status on Windows (Windows PowerShell 5.1 or newer).

    powershell -ExecutionPolicy Bypass -File file-preview.ps1 install   [-Source <folder|git-url>] [-Yes] [-Orca <cli>]
    powershell -ExecutionPolicy Bypass -File file-preview.ps1 uninstall [-Yes] [-Orca <cli>]
    powershell -ExecutionPolicy Bypass -File file-preview.ps1 status    [-Orca <cli>]

  install   registers the plugin in Orca (the plugin folder of this package by default), shows the access
            Orca asks you to approve and approves it only after you confirm (or with -Yes). Running it
            again updates an existing install.
  uninstall removes every installed copy (development folders are only reported).
  Needs Orca 1.4.248 or newer, installed and started at least once. No administrator rights needed.
#>
param(
  [Parameter(Position = 0)][ValidateSet('install', 'uninstall', 'status', 'help')][string]$Action = 'help',
  [string]$Source = '',
  [switch]$Yes,
  [string]$Orca = $env:ORCA_CLI_COMMAND
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$PluginId = 'file-preview'
$GitHubSource = 'https://github.com/hangams84/orca-file-preview/tree/main/plugin'
$PkgRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Say([string]$Text) { Write-Host $Text }
function Fail([string]$Text) { Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }

function Find-Orca {
  if ($script:Orca) { return }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\orca\resources\bin\orca.exe'),
    (Join-Path $env:ProgramFiles 'Orca\resources\bin\orca.exe')
  )
  $onPath = Get-Command orca.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates = @($onPath.Source) + $candidates }
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $script:Orca = $c; return } }
  Fail ("Orca's command line tool was not found. Install Orca (https://github.com/stablyai/orca/releases), start it once, or pass -Orca <path>.`n" +
    "       Orca CLI를 찾지 못했습니다. Orca를 설치하고 한 번 실행한 뒤 다시 시도하거나 -Orca <경로> 를 지정하세요.")
}

# Runs the Orca CLI and returns @{ Code; Text }. Native stderr is merged without PowerShell wrapping it.
function Invoke-Orca([string[]]$Arguments) {
  # Output goes to temp files, not pipes: `orca open` launches the Orca app, which inherits the
  # handles and would keep a pipe open (reading to the end would then never finish).
  $outFile = [IO.Path]::GetTempFileName()
  $errFile = [IO.Path]::GetTempFileName()
  try {
    $argLine = ($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
    $p = Start-Process -FilePath $script:Orca -ArgumentList $argLine -NoNewWindow -PassThru `
      -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    [void]$p.Handle # keeps the exit code readable after the process ends
    $p.WaitForExit()
    $text = ([IO.File]::ReadAllText($outFile, [Text.Encoding]::UTF8) + [IO.File]::ReadAllText($errFile, [Text.Encoding]::UTF8)).Trim()
    return @{ Code = $p.ExitCode; Text = $text }
  } finally {
    Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
  }
}

function Confirm-Step([string]$Question) {
  if ($Yes) { return $true }
  $answer = Read-Host "$Question [y/N]"
  return $answer -match '^(y|yes|예|네)$'
}

# Orca is an Electron app: Electron 23+ (and so every Orca release) needs Windows 10 or later.
# FP_TEST_OS_VERSION overrides the detected version so CI can exercise this message.
function Assert-Windows {
  $v = if ($env:FP_TEST_OS_VERSION) { [version]$env:FP_TEST_OS_VERSION } else { [Environment]::OSVersion.Version }
  if ($v.Major -lt 10) {
    $name = switch ("$($v.Major).$($v.Minor)") { '6.1' { 'Windows 7' } '6.2' { 'Windows 8' } '6.3' { 'Windows 8.1' } default { "Windows $v" } }
    Fail ("Orca needs Windows 10 or later; this PC runs $name ($v). Orca and this plugin cannot be installed here.`n" +
      "       Orca는 Windows 10 이상에서만 동작합니다. 이 PC는 $name ($v) 입니다.")
  }
}

# Orca 1.4.248-1.4.251 have no `plugin install`/`uninstall`: there the folder is registered with
# `plugin dev load` (files load from the folder, so keep it).
function Test-CanInstall {
  $r = Invoke-Orca @('plugin', 'install', '--help')
  return -not ($r.Text -match 'Unknown command')
}

function Ensure-Running {
  $s = Invoke-Orca @('status', '--json')
  if ($s.Text -match '"running":\s*true') { return }
  Say 'Starting Orca... / Orca를 시작합니다...'
  $o = Invoke-Orca @('open', '--json')
  if ($o.Code -ne 0) { $o = Invoke-Orca @('open', '--json') }
  if ($o.Code -ne 0) { Fail 'Orca did not start. Start it once by hand and retry. / Orca를 시작하지 못했습니다.' }
}

# Plugin list lines for this plugin: "<key> <version>  <status>  <flags>"
function Get-PluginLines {
  $l = Invoke-Orca @('plugin', 'list')
  return @($l.Text -split "`r?`n" | Where-Object { $_ -match "^\S+\.$([regex]::Escape($PluginId)) " })
}

# Runs an Orca command that may stop with approval_required (exit 3): shows the requested access and
# approves only after confirmation.
function Invoke-WithApproval([string[]]$Arguments) {
  $r = Invoke-Orca $Arguments
  if ($r.Code -eq 3) {
    Say ''
    ($r.Text -split "`r?`n" | Where-Object { $_ -notmatch '^Next step:|--approve|^To approve, run' }) | ForEach-Object { Say "  $_" }
    Say ''
    $m = [regex]::Match($r.Text, 'ap1-[0-9a-f]+')
    if (-not $m.Success) { Fail 'Orca asked for approval but gave no fingerprint.' }
    if (-not (Confirm-Step 'Approve this access and continue? / 위 권한을 승인하고 계속할까요?')) { Fail 'Cancelled: nothing was installed. / 취소되었습니다.' }
    $r = Invoke-Orca ($Arguments + @('--approve', $m.Value))
  }
  if ($r.Code -ne 0) { Say $r.Text; return $false }
  return $true
}

function Resolve-Source {
  if ($script:Source) {
    if ($script:Source -match '^(https?://|git@|ssh://)') { return }
    if (-not (Test-Path (Join-Path $script:Source 'orca-plugin.json'))) { Fail "$($script:Source) has no orca-plugin.json." }
    $script:Source = (Resolve-Path $script:Source).Path
    return
  }
  $local = Join-Path $PkgRoot 'plugin'
  if (Test-Path (Join-Path $local 'orca-plugin.json')) { $script:Source = (Resolve-Path $local).Path } else { $script:Source = $GitHubSource }
}

function Do-Install {
  Assert-Windows; Find-Orca; Ensure-Running; Resolve-Source
  Say ("Orca: " + (Invoke-Orca @('--version')).Text.Split("`n")[-1] + "  ($($script:Orca))")
  Say "Source / 설치 원본: $($script:Source)"
  $lines = Get-PluginLines
  $existing = @($lines | Where-Object { $_ -notmatch ', dev' } | ForEach-Object { ($_ -split ' ')[0] })
  $dev = @($lines | Where-Object { $_ -match ', dev' } | ForEach-Object { ($_ -split ' ')[0] })
  $isFolder = $script:Source -notmatch '^(https?://|git@|ssh://)'
  $canInstall = Test-CanInstall
  if ($canInstall -and $dev.Count -gt 0 -and $existing.Count -eq 0 -and $isFolder) {
    Fail ("A development copy ($($dev[0])) is loaded from a folder. Remove it first: orca plugin dev unload <that folder>`n" +
      "       개발용으로 등록된 사본($($dev[0]))이 있습니다. 먼저 'plugin dev unload <폴더>' 로 해제하세요.")
  }
  if (-not $canInstall) {
    if (-not $isFolder) { Fail 'This Orca has no `plugin install` (Orca 1.4.248-1.4.251): install from the plugin folder of this package, or update Orca to 1.4.252+. / 이 Orca 버전은 폴더 설치만 지원합니다.' }
    Say 'This Orca (1.4.248-1.4.251) has no `plugin install`: registering the folder with `plugin dev load` (keep this folder). / 이 Orca 버전은 개발 폴더 등록 방식으로 설치합니다(폴더를 지우지 마세요).'
    if ($dev.Count -gt 0) {
      Say 'Already registered: reloading. / 이미 등록되어 있어 다시 읽어 옵니다.'
      [void](Invoke-Orca @('plugin', 'dev', 'reload'))
    } elseif (-not (Invoke-WithApproval @('plugin', 'dev', 'load', $script:Source))) { Fail 'Registration failed. / 등록 실패' }
    $line = @(Get-PluginLines)
    if ($line.Count -eq 0) { Fail 'Orca does not list the plugin after registering. / 등록 후 목록에 없습니다.' }
    Say ''
    Say "Installed / 설치 완료: $($line[0])"
    return
  }
  if ($existing.Count -gt 0) {
    Say "Updating $($existing[0]) ... / 기존 설치를 업데이트합니다"
    if (-not (Invoke-WithApproval @('plugin', 'update', $existing[0]))) { Fail 'Update failed. / 업데이트 실패' }
  } else {
    Say 'Installing ... / 설치합니다'
    if (-not (Invoke-WithApproval @('plugin', 'install', $script:Source))) {
      Fail "Install failed (a private GitHub repository needs Git credentials on this PC, e.g. 'gh auth setup-git'). / 설치 실패"
    }
  }
  $line = @(Get-PluginLines | Where-Object { $_ -notmatch ', dev' })
  if ($line.Count -eq 0) { Fail 'Orca does not list the plugin after installing. / 설치 후 목록에 없습니다.' }
  Say ''
  Say "Installed / 설치 완료: $($line[0])"
  Say "Open a .docx, .pdf, .xlsx ... file in Orca. Text-like files (.txt .csv .html .svg) open in Orca's own view first: use the view toggle at the tab's top right."
  Say 'Orca에서 .docx, .pdf, .xlsx 등을 열어 보세요. .txt .csv .html .svg 는 탭 오른쪽 위 보기 전환으로 미리보기를 선택합니다.'
}

function Do-Uninstall {
  Assert-Windows; Find-Orca; Ensure-Running
  if (-not (Test-CanInstall)) {
    $folder = Join-Path $PkgRoot 'plugin'
    if (@(Get-PluginLines).Count -eq 0) { Say 'File Preview is not installed. / 설치되어 있지 않습니다.'; return }
    if (-not (Confirm-Step 'Remove File Preview from Orca? / Orca에서 제거할까요?')) { Fail 'Cancelled. / 취소되었습니다.' }
    $r = Invoke-Orca @('plugin', 'dev', 'unload', $folder)
    if ($r.Code -ne 0) { Fail "Could not unregister $folder ($($r.Text))" }
    Say "Removed / 제거됨: $folder"
    return
  }
  $lines = Get-PluginLines
  $keys = @($lines | Where-Object { $_ -notmatch ', dev' } | ForEach-Object { ($_ -split ' ')[0] })
  $dev = @($lines | Where-Object { $_ -match ', dev' } | ForEach-Object { ($_ -split ' ')[0] })
  if ($keys.Count -eq 0) {
    Say 'File Preview is not installed. / 설치되어 있지 않습니다.'
  } else {
    Say 'Installed copies / 설치된 항목:'; $keys | ForEach-Object { Say "  $_" }
    if (-not (Confirm-Step 'Remove them from Orca? / Orca에서 제거할까요?')) { Fail 'Cancelled. / 취소되었습니다.' }
    foreach ($k in $keys) {
      $r = Invoke-Orca @('plugin', 'uninstall', $k)
      if ($r.Code -eq 0) { Say "Removed / 제거됨: $k" } else { Say "Could not remove / 제거 실패: $k  $($r.Text)" }
    }
  }
  if ($dev.Count -gt 0) { Say "Note: development copy still loaded: $($dev -join ', ') ('orca plugin dev unload <folder>' removes it). / 개발용 등록은 그대로입니다." }
  $left = @(Get-PluginLines | Where-Object { $_ -notmatch ', dev' })
  if ($left.Count -gt 0) { Fail "Still installed: $($left -join '; ')" }
}

function Do-Status {
  Find-Orca
  Say ("Orca: " + (Invoke-Orca @('--version')).Text.Split("`n")[-1] + "  ($($script:Orca))")
  $lines = Get-PluginLines
  if ($lines.Count -gt 0) { $lines | ForEach-Object { Say $_ } } else { Say 'File Preview is not installed. / 설치되어 있지 않습니다.' }
}

switch ($Action) {
  'install' { Do-Install }
  'uninstall' { Do-Uninstall }
  'status' { Do-Status }
  default { Get-Help $PSCommandPath -Detailed | Out-String | Write-Host; Say (Get-Content $PSCommandPath -TotalCount 14 | Out-String) }
}
exit 0
