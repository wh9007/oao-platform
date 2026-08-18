@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title OAO Server - Remote AI
rem Start Docker + SearXNG + Ollama + AnythingLLM + Tunnel
rem Args: menu  check  v2ray
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\oao-remote-server.ps1" %*
if errorlevel 1 ( echo. & echo [错误] OAO 服务器异常退出 & pause )
exit /b %ERRORLEVEL%
