@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OAO 快速部署 Worker
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-ps1-bom.ps1" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-worker-quick.ps1" -NoPause
exit /b %ERRORLEVEL%
