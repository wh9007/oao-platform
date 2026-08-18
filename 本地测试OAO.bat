@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title OAO Local Test
rem Local preview: http://127.0.0.1:8777/OAO.html (no Tunnel / Docker)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-oao.ps1"
exit /b %ERRORLEVEL%
