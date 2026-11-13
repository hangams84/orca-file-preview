@echo off
rem Double-click to install File Preview into Orca.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0file-preview.ps1" install %*
set rc=%errorlevel%
echo.
pause
exit /b %rc%
