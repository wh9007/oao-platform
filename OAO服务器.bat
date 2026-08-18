@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title OAO 服务器 — 外网访问本机 AI
rem 一键启动：Docker + SearXNG + Ollama + AnythingLLM + Tunnel
rem 可选参数：menu（高级菜单）  check（连通检测）  v2ray（V2Ray 共存说明）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\oao-remote-server.ps1" %*
if errorlevel 1 ( echo. & echo [错误] OAO 服务器异常退出 & pause )
exit /b %ERRORLEVEL%
