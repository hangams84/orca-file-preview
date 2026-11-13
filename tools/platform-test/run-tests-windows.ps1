# Windows (GitHub Actions runner): tests the File Preview plugin inside an installed Orca. Installs the
# plugin with installer/windows/file-preview.ps1 (the real installer), then the same checks as the
# Linux/macOS scripts. Writes results.json, checks.json, shots.json, summary.md, orca/, window/, logs/.
#   powershell -File run-tests-windows.ps1 -Src <repo> -Out <dir> [-ExpectIncompatible]
param([Parameter(Mandatory)][string]$Src, [Parameter(Mandatory)][string]$Out, [switch]$ExpectIncompatible)
$ErrorActionPreference = 'Continue'
$Orca = Join-Path $env:LOCALAPPDATA 'Programs\orca\resources\bin\orca.exe'
$Key = 'local.file-preview'
$start = Get-Date
foreach ($d in 'orca', 'window', 'logs') { New-Item -ItemType Directory -Force -Path (Join-Path $Out $d) | Out-Null }
$checks = New-Object System.Collections.ArrayList
$shots = New-Object System.Collections.ArrayList
function Check([string]$Name, [bool]$Ok, [string]$Detail) {
  [void]$checks.Add([ordered]@{ name = $Name; ok = $Ok; detail = $Detail })
  Write-Host ("{0}  {1}  {2}" -f ($(if ($Ok) { 'PASS' } else { 'FAIL' }), $Name, ($Detail -split "`n")[0]))
}
function Run([string[]]$A) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Orca
  $psi.Arguments = ($A | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $p = [Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEndAsync(); $e = $p.StandardError.ReadToEnd(); $p.WaitForExit()
  return @{ Code = $p.ExitCode; Text = ($o.Result + $e).Trim() }
}
function Json([string]$t) { try { $i = $t.IndexOf('{'); if ($i -ge 0) { return ($t.Substring($i) | ConvertFrom-Json) } } catch {}; return $null }
function Finish {
  $os = (Get-CimInstance Win32_OperatingSystem)
  $verText = (Run @('--version')).Text.Split("`n")[-1].Trim()
  $res = [ordered]@{
    platform = 'windows-' + (& { if ($env:ImageOS) { $env:ImageOS } else { 'local' } })
    os = "$($os.Caption) $($os.Version)"; orcaVersion = $verText; durationSec = [int]((Get-Date) - $start).TotalSeconds
    date = (Get-Date).ToUniversalTime().ToString('o'); checks = @($checks); shots = @($shots)
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $Out 'results.json'), ($res | ConvertTo-Json -Depth 6), $utf8)
  [IO.File]::WriteAllText((Join-Path $Out 'checks.json'), (ConvertTo-Json -InputObject @($checks) -Depth 4), $utf8)
  [IO.File]::WriteAllText((Join-Path $Out 'shots.json'), (ConvertTo-Json -InputObject @($shots) -Depth 4), $utf8)
  $md = @("# $($res.os) · Orca $verText", '', '| Check | Result | Detail |', '| --- | --- | --- |')
  foreach ($c in $checks) { $md += "| $($c.name) | $(if ($c.ok) { '✅' } else { '❌' }) | $((($c.detail -replace "`r?`n", '<br>') -replace '\|', '\|').Substring(0, [Math]::Min(300, $c.detail.Length))) |" }
  [IO.File]::WriteAllText((Join-Path $Out 'summary.md'), ($md -join "`n") + "`n", $utf8)
  Run @('quit', '--json') | Out-Null
  if (@($checks | Where-Object { -not $_.ok }).Count -gt 0) { exit 1 } else { exit 0 }
}

# --- Orca --------------------------------------------------------------------------------------------
$open = $null
for ($i = 1; $i -le 3; $i++) { $open = Run @('open', '--json'); if ($open.Code -eq 0) { break }; Start-Sleep 5 }
$open.Text | Out-File -Encoding utf8 (Join-Path $Out 'logs\open.json')
$ver = (Run @('--version')).Text.Split("`n")[-1].Trim()
Check "Orca $ver desktop starts" ($open.Code -eq 0) ((Json $open.Text).result.app | ConvertTo-Json -Compress)
Start-Sleep 5

# --- Install with the real installer script ------------------------------------------------------------
$pkg = 'C:\fp-pkg'
Remove-Item -Recurse -Force $pkg -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $pkg | Out-Null
Copy-Item -Recurse (Join-Path $Src 'plugin') $pkg; Copy-Item -Recurse (Join-Path $Src 'installer') $pkg
$inst = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pkg 'installer\windows\file-preview.ps1') install -Yes -Orca $Orca 2>&1 | Out-String
$instCode = $LASTEXITCODE
$inst | Out-File -Encoding utf8 (Join-Path $Out 'logs\installer.log')
if ($ExpectIncompatible) {
  $why = (($inst -split "`r?`n") | Where-Object { $_ -match 'ERROR|engines|requires|needs|incompatible|not compatible' } | Select-Object -First 3) -join ' '
  Check "install refused on unsupported Orca $ver (needs >=1.4.248)" ($instCode -ne 0) $why
  Finish
}
Check 'install with installer\windows\file-preview.ps1 -Yes (approval shown, then approved)' ($instCode -eq 0) ((($inst -split "`r?`n") | Where-Object { $_ -match 'Installed|ERROR|Fingerprint' }) -join ' ')
$list = Json (Run @('plugin', 'list', '--json')).Text
$p = @($list.result.plugins | Where-Object { $_.pluginKey -eq $Key })[0]
Check 'plugin listed and enabled' ($null -ne $p -and $p.status -ne 'disabled') "status=$($p.status) editors=$(@($p.customEditors).Count)"

# Fresh profile: the first-run dialog covers the window; dismiss it like a user (Escape, then Skip).
Add-Type -AssemblyName System.Windows.Forms
$w = New-Object -ComObject WScript.Shell
for ($i = 0; $i -lt 3; $i++) { [void]$w.AppActivate('Orca'); Start-Sleep -Milliseconds 400; [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep 1 }
Run @('plugin', 'shot', $Key, '--window', '--out', (Join-Path $Out 'logs\after-first-run.png'), '--json') | Out-Null

# --- Static checks and unit tests (from C:, see the cross-drive note in tools/verify.mjs) --------------
$v = Run @('plugin', 'validate', (Join-Path $pkg 'plugin'), '--json')
Check 'plugin validate' ((Json $v.Text).result.valid -eq $true) ((Json $v.Text).result.errors | ConvertTo-Json -Compress)
$t = Run @('plugin', 'test', (Join-Path $pkg 'plugin'))
$t.Text | Out-File -Encoding utf8 (Join-Path $Out 'logs\test.log')
$counts = (([regex]::Matches($t.Text, '(?m)^(?:ℹ|#) (pass|fail) \d+') | ForEach-Object { $_.Value }) -join ' ')
Check 'plugin test (unit, Node on Windows)' ($t.Code -eq 0) $counts
$c = Run @('plugin', 'check', (Join-Path $pkg 'plugin'), '--json')
Check 'plugin check (static)' ($c.Code -eq 0) ((Json $c.Text).error.message)

# --- Every fixture in the installed plugin's editor ----------------------------------------------------
$samples = Join-Path $Src 'samples'
$mounted = 0; $total = 0; $native = 0
foreach ($f in (Get-ChildItem -File $samples | Sort-Object Name)) {
  $r = Run @('plugin', 'shot', $Key, '--editor', $f.FullName, '--out', (Join-Path $Out "orca\$($f.Name).png"), '--json')
  $j = Json $r.Text
  $msg = "$($j.error.message)"
  if ($msg -match 'not on screen') { $native++; $state = 'toggle' }
  else {
    $total++
    $expectErr = $f.Name -like 'broken.*'
    if ($j.ok -or ($expectErr -and (Test-Path (Join-Path $Out "orca\$($f.Name).png")))) { $mounted++; $state = 'ok' } else { $state = 'fail' }
  }
  [void]$shots.Add([ordered]@{ file = $f.Name; state = $state; message = $msg; errors = @($j.result.errors) })
}
Check 'editors mount in Orca without errors' ($mounted -eq $total) "$mounted / $total mounted; $native open in Orca's own view first"

# --- Finished renders from real open tabs --------------------------------------------------------------
$wins = 0; $winsOk = 0
foreach ($f in 'sample.docx', 'sample.pptx', 'sample.xlsx', 'sample.pdf', 'sample.doc', 'sample.ppt', 'sample-utf16.xhtml', 'sample.gif') {
  $wins++
  Run @('plugin', 'open', $Key, '--editor', (Join-Path $samples $f), '--json') | Out-Null
  Start-Sleep 6
  $s = Run @('plugin', 'shot', $Key, '--window', '--out', (Join-Path $Out "window\$f.png"), '--json')
  if ($s.Code -eq 0) { $winsOk++ }
}
Check 'finished renders captured from open tabs' ($winsOk -eq $wins) "$winsOk / $wins window captures"

$logs = (Run @('plugin', 'logs', $Key)).Text
$logs | Out-File -Encoding utf8 (Join-Path $Out 'logs\plugin.log')
$errLines = @($logs -split "`r?`n" | Where-Object { $_ -match ' error ' })
Check 'no error lines in the plugin log' ($errLines.Count -eq 0) ("$($errLines.Count) error lines " + (($errLines | Select-Object -First 3) -join ' | '))

# --- The installer removes it again ------------------------------------------------------------------
$un = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pkg 'installer\windows\file-preview.ps1') uninstall -Yes -Orca $Orca 2>&1 | Out-String
$gone = -not ((Run @('plugin', 'list')).Text -match 'file-preview')
Check 'uninstall with installer\windows\file-preview.ps1 -Yes' (($LASTEXITCODE -eq 0) -and $gone) ((($un -split "`r?`n") | Where-Object { $_ -match 'Removed|ERROR' }) -join ' ')
Finish
