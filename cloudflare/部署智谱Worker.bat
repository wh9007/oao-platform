@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OAO Worker 首次完整配置
echo.
echo  提示: 日常仅更新 Worker 代码请用「仅快速部署Worker.bat」
echo  本脚本用于首次 wrangler login / 可选 Secret 配置
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-ps1-bom.ps1" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-worker.ps1"
exit /b %ERRORLEVEL%
