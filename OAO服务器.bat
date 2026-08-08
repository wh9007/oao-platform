@echo off
title OAO 远程 AI
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" 2>nul
if /I "%~1"=="menu" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remote-ai-start.ps1" -Menu
    exit /b %ERRORLEVEL%
)
if /I "%~1"=="check" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remote-ai-start.ps1" -CheckOnly
    exit /b %ERRORLEVEL%
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remote-ai-start.ps1"
exit /b %ERRORLEVEL%
