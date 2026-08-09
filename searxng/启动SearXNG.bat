@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OAO SearXNG (8080)
echo.
echo  启动 SearXNG — 供 AI联网 使用
echo  请先打开 Docker Desktop，首次拉取镜像约 2~5 分钟
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\searxng-start.ps1"
echo.
echo  测试: http://127.0.0.1:8080/search?q=新闻&format=json
echo.
pause
