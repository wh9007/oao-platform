@echo off
title OAO 远程 AI
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\remote-ai-start.ps1" %*
exit /b %ERRORLEVEL%
