# Builds dist\FilePreviewSetup-<version>.exe: tools\setup-exe\FilePreviewSetup.cs compiled with the .NET
# Framework 4 C# compiler that ships with Windows, with the release zip (node tools/package-release.mjs)
# embedded. Unsigned: Windows SmartScreen may warn on first run ("More info" -> "Run anyway").
#   powershell -ExecutionPolicy Bypass -File tools\build-windows-exe.ps1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $Root 'plugin\orca-plugin.json') -Raw | ConvertFrom-Json
$ver = $manifest.version
$zip = Join-Path $Root "dist\orca-file-preview-$ver.zip"
if (-not (Test-Path $zip)) { throw "Missing $zip - run: node tools/package-release.mjs" }
$csc = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw 'The .NET Framework 4 C# compiler (csc.exe) was not found.' }
$work = Join-Path $env:TEMP "fp-exe-$PID"
New-Item -ItemType Directory -Force $work | Out-Null
$info = "static class BuildInfo { public const string Version = `"$ver`"; }"
[IO.File]::WriteAllText((Join-Path $work 'BuildInfo.cs'), $info)
$out = Join-Path $Root "dist\FilePreviewSetup-$ver.exe"
$fx = Split-Path $csc
& $csc /nologo /target:exe /optimize+ /platform:anycpu "/out:$out" `
  "/reference:$fx\System.IO.Compression.dll" "/reference:$fx\System.IO.Compression.FileSystem.dll" `
  "/resource:$zip,payload.zip" (Join-Path $Root 'tools\setup-exe\FilePreviewSetup.cs') (Join-Path $work 'BuildInfo.cs')
if ($LASTEXITCODE -ne 0) { throw "csc failed ($LASTEXITCODE)" }
Remove-Item -Recurse -Force $work
$hash = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLower()
"$hash  $(Split-Path -Leaf $out)" | Out-File -Encoding ascii "$out.sha256"
Write-Host ("{0}  {1:N1} MB  sha256 {2}" -f (Split-Path -Leaf $out), ((Get-Item $out).Length / 1MB), $hash)
