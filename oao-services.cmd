@echo off
setlocal EnableExtensions
chcp 65001 >nul
title OAO 后台服务
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "TD=%ROOT%\oao-translate"

where python >nul 2>&1 && set "PY=python" || set "PY=py -3"

echo ========================================
echo  OAO 后台服务
echo  关闭本窗口将停止所有服务
echo ========================================
echo.
echo  主页  http://127.0.0.1:8777/OAO.html
echo  翻译  http://127.0.0.1:3000
echo.

echo [运行中] 主页服务 :8777
start /B "" %PY% -m http.server 8777 --bind 127.0.0.1

where ollama >nul 2>&1
if not errorlevel 1 (
    echo [运行中] Ollama :11434
    start /B "" ollama serve >nul 2>&1
)

if exist "%TD%\server\package.json" (
    echo [运行中] OAO翻译 Server :3011
    start /B "" cmd /c "cd /d ""%TD%\server"" && npm run dev"
    echo [运行中] OAO翻译 Web :3000
    start /B "" cmd /c "cd /d ""%TD%\web"" && npm run dev"
)

echo.
echo  全部服务已启动。请保持本窗口开启。
echo.

:hold
timeout /t 86400 >nul
goto hold
