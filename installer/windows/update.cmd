@echo off
rem Double-click to update File Preview to the newest release.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0file-preview.ps1" update %*
set rc=%errorlevel%
echo.
pause
exit /b %rc%
