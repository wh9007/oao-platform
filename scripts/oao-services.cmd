@echo off
setlocal EnableExtensions
chcp 65001 >nul
title OAO 后台服务

set "ROOT=%~dp0.."
cd /d "%ROOT%"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "TD=%ROOT%\oao-translate"
set "LOG=%ROOT%\oao-services.log"

call "%ROOT%\scripts\lib.cmd" FindPython
if errorlevel 1 set "PY=py -3"

echo ========================================>> "%LOG%"
echo  OAO 后台服务 %DATE% %TIME%>> "%LOG%"
echo ========================================>> "%LOG%"

echo ========================================
echo  OAO 后台服务
echo  关闭本窗口将停止全部服务
echo ========================================
echo.
echo  主页  http://127.0.0.1:8777/OAO.html
echo  AI    Ollama :11434 + AnythingLLM :3001
echo  翻译  可选中继 :3011
echo.

netstat -ano | findstr ":8777" | findstr /I "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [跳过] 主页 :8777 已由其他启动器运行
) else (
    echo [运行中] 主页服务 :8777
    start /B "" %PY% -m http.server 8777 --bind 127.0.0.1
)

where ollama >nul 2>&1
if not errorlevel 1 (
    echo [运行中] Ollama :11434
    start /B "" ollama serve >nul 2>&1
) else (
    echo [提示] 未检测到 Ollama — 请安装 https://ollama.com 并执行 ollama pull qwen2.5
)

call "%ROOT%\scripts\lib.cmd" FindNode
if errorlevel 1 (
    echo [提示] 未检测到 Node.js — 翻译分享中继 :3011 不可用
    echo [提示] 未检测到 Node.js>> "%LOG%"
    goto :AfterTranslate
)

if exist "%TD%\server\package.json" if not exist "%TD%\server\node_modules" (
    echo [后台] 首次安装 OAO翻译 AI 依赖...
    start /B "" cmd /c "cd /d ""%TD%\server"" && npm install >> ""%LOG%"" 2>&1"
)

if exist "%TD%\server\package.json" (
    if exist "%TD%\server\dist\index.js" (
        echo [运行中] OAO翻译中继 :3011 ^(生产^)
        start /B "" cmd /c "cd /d ""%TD%\server"" && npm run start >> ""%LOG%"" 2>&1"
    ) else (
        echo [运行中] OAO翻译中继 :3011 ^(开发^)
        start /B "" cmd /c "cd /d ""%TD%\server"" && npm run dev >> ""%LOG%"" 2>&1"
    )
)

:AfterTranslate
echo.
echo  远程 AI 访问还需在本机另开「OAO服务器.bat」选项 3 启动 Tunnel。
echo  日志: %LOG%
echo.

:hold
timeout /t 86400 >nul
goto hold
