@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

set "TOKEN_FILE=cloudflare\tunnel-token.txt"
set "CLOUDFLARED="

where cloudflared >nul 2>&1 && set "CLOUDFLARED=cloudflared"
if not defined CLOUDFLARED if exist "%ProgramFiles%\Cloudflare\Cloudflare WARP\cloudflared.exe" set "CLOUDFLARED=%ProgramFiles%\Cloudflare\Cloudflare WARP\cloudflared.exe"

if not defined CLOUDFLARED (
    echo.
    echo  [错误] 未找到 cloudflared。
    echo  请先安装: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    echo  或使用: winget install Cloudflare.cloudflared
    echo.
    pause
    exit /b 1
)

if not exist "%TOKEN_FILE%" (
    echo.
    echo  [提示] 请先创建 %TOKEN_FILE%
    echo  1. 登录 https://one.dash.cloudflare.com/
    echo  2. Networks -^> Tunnels -^> Create a tunnel
    echo  3. 配置 Public Hostname:
    echo       ollama.你的域名.com  -^> http://localhost:11434
    echo       llm.你的域名.com     -^> http://localhost:3001
    echo  4. 复制 Install connector 的 Token，粘贴到:
    echo       %TOKEN_FILE%
    echo.
    copy /Y "cloudflare\tunnel-token.txt.example" "%TOKEN_FILE%" >nul
    notepad "%TOKEN_FILE%"
    pause
    exit /b 1
)

set /p TUNNEL_TOKEN=<"%TOKEN_FILE%"
for /f "tokens=* delims= " %%a in ("%TUNNEL_TOKEN%") do set "TUNNEL_TOKEN=%%a"

if "%TUNNEL_TOKEN%"=="" (
    echo  [错误] Token 为空，请编辑 %TOKEN_FILE%
    pause
    exit /b 1
)

echo.
echo  ========================================
echo   OAO Cloudflare Tunnel
echo   请保持本窗口运行，并确保本机已启动:
echo   - Ollama           :11434
echo   - AnythingLLM      :3001
echo  ========================================
echo.

"%CLOUDFLARED%" tunnel run --token %TUNNEL_TOKEN%

echo.
echo  Tunnel 已退出。
pause
