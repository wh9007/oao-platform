@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-ps1-bom.ps1" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-worker.ps1"
exit /b %ERRORLEVEL%
