@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OAO Upload GitHub
rem Deploy Worker automatically when cloudflare/ changed
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\upload-github.ps1" -NoPause
exit /b %ERRORLEVEL%
