@echo off
cd /d "%~dp0"
title OAO Server
rem Start Ollama + AnythingLLM + SearXNG + Tunnel
rem Args: menu  check  v2ray
fltmc >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\oao-remote-server.ps1" %*
if errorlevel 1 ( echo. & echo [错误] OAO 服务器异常退出 & pause )
exit /b %ERRORLEVEL%
