@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

set "TD=%~dp0oao-translate\server"
if not exist "%TD%\package.json" (
    echo [错误] 未找到 oao-translate\server
    pause
    exit /b 1
)

where node >nul 2>&1 || (
    echo [错误] 请先安装 Node.js LTS: https://nodejs.org
    pause
    exit /b 1
)

echo.
echo  构建 OAO翻译 本地 AI 服务（可选，浏览器模式无需此步）
echo.

cd /d "%TD%"
call npm install
if errorlevel 1 (
    echo [错误] npm install 失败
    pause
    exit /b 1
)

call npm run build
if errorlevel 1 (
    echo [错误] npm run build 失败
    pause
    exit /b 1
)

echo.
echo  构建完成。请重启「OAO Services」以使用生产模式 :3011。
echo.
pause
