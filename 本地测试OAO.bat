@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title OAO 本地测试
rem 本地预览：http://127.0.0.1:8777/OAO.html（不启动 Tunnel / Docker）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-oao.ps1"
exit /b %ERRORLEVEL%
