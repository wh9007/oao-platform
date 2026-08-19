@echo off
cd /d "%~dp0"
title OAO Local Test
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-oao.ps1"
exit /b %ERRORLEVEL%
