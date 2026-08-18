@echo off
chcp 65001 >nul
cd /d "%~dp0"
title OAO 一键上传 GitHub
rem 上传后若 cloudflare/ 有变更，会自动部署 Worker
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\ensure-ps1-bom.ps1" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\upload-github.ps1" -NoPause
exit /b %ERRORLEVEL%
