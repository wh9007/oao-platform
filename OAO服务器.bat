@echo off
chcp 65001 >nul 2>&1
title OAO 服务器 — 外网访问本机 AI
cd /d "%~dp0"

rem 一键启动：本机 AI + Tunnel（保持本窗口打开）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\oao-remote-server.ps1" %*

if errorlevel 1 (
    echo.
    echo [错误] OAO 服务器异常退出
    pause
)
exit /b %ERRORLEVEL%
