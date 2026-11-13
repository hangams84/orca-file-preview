@echo off
rem Double-click to remove File Preview from Orca.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0file-preview.ps1" uninstall %*
set rc=%errorlevel%
echo.
pause
exit /b %rc%
