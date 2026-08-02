@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "LIB=%ROOT%\scripts\lib.cmd"
set "TOKEN_FILE=%ROOT%\cloudflare\tunnel-token.txt"

call "%LIB%" InitRoot "%ROOT%"

if /I "%~1"=="all" goto :StartAll
if /I "%~1"=="services" goto :StartServices
if /I "%~1"=="tunnel" goto :StartTunnel
if /I "%~1"=="build" goto :BuildTranslate
if /I "%~1"=="worker" goto :DeployWorker
if not "%~1"=="" goto :UnknownArg

:Menu
echo.
echo  ============================================================
echo    OAO 服务器 — 支撑外网远程访问本机 AI
echo  ============================================================
echo.
echo   架构: 外网用户 ^→ Cloudflare Worker ^→ Tunnel ^→ 本机 AI
echo   本机需运行: Ollama(:11434) + AnythingLLM(:3001)
echo.
echo   [1] 启动全部（后台服务 + Tunnel，推荐）
echo   [2] 仅后台服务（Ollama / 翻译中继 / 主页）
echo   [3] 仅 Cloudflare Tunnel
echo   [4] 构建翻译 AI 服务（:3011，可选）
echo   [5] 部署智谱 Worker（一次性，GLM 备援）
echo   [0] 退出
echo.
choice /C 123450 /N /M "请选择 [1-5/0]: "
if errorlevel 6 exit /b 0
if errorlevel 5 goto :DeployWorker
if errorlevel 4 goto :BuildTranslate
if errorlevel 3 goto :StartTunnel
if errorlevel 2 goto :StartServices
if errorlevel 1 goto :StartAll
goto :Menu

:StartAll
call :PrintPrereq
echo.
echo  [1/2] 启动后台服务窗口...
if not exist "%ROOT%\scripts\oao-services.cmd" (
    echo  [错误] 未找到 scripts\oao-services.cmd
    pause
    exit /b 1
)
start "OAO Services" /MIN "%ROOT%\scripts\oao-services.cmd"
timeout /t 3 >nul
echo  [2/2] 启动 Cloudflare Tunnel（请保持本窗口运行）...
echo.
goto :StartTunnel

:StartServices
echo.
echo  启动 OAO 后台服务...
start "OAO Services" /MIN "%ROOT%\scripts\oao-services.cmd"
echo  已启动「OAO Services」窗口（可最小化，请勿关闭）。
echo.
timeout /t 3 >nul
exit /b 0

:StartTunnel
call :PrintPrereq
call "%LIB%" FindCloudflared
if errorlevel 1 (
    echo.
    echo  [错误] 未找到 cloudflared。
    echo  安装: winget install Cloudflare.cloudflared
    echo  或见: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    pause
    exit /b 1
)

if not exist "%TOKEN_FILE%" (
    echo.
    echo  [提示] 请先配置 Tunnel Token: %TOKEN_FILE%
    echo  1. 登录 https://one.dash.cloudflare.com/
    echo  2. Networks -^> Tunnels -^> Create a tunnel
    echo  3. Public Hostname 示例:
    echo       ollama.你的域名 -^> http://localhost:11434
    echo       llm.你的域名     -^> http://localhost:3001
    echo  4. 复制 Install connector 的 Token 到 tunnel-token.txt
    echo  5. Worker 变量 LLM_ORIGIN / OLLAMA_ORIGIN 指向上述域名
    echo.
    if exist "%ROOT%\cloudflare\tunnel-token.txt.example" copy /Y "%ROOT%\cloudflare\tunnel-token.txt.example" "%TOKEN_FILE%" >nul
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
echo   Cloudflare Tunnel 运行中
echo   请勿关闭本窗口
echo  ========================================
echo.

"%CLOUDFLARED%" tunnel run --token %TUNNEL_TOKEN%
echo.
echo  Tunnel 已退出。
pause
exit /b 0

:BuildTranslate
set "TD=%ROOT%\oao-translate\server"
if not exist "%TD%\package.json" (
    echo  [错误] 未找到 oao-translate\server
    pause
    exit /b 1
)
call "%LIB%" FindNode
if errorlevel 1 (
    echo  [错误] 请先安装 Node.js LTS: https://nodejs.org
    pause
    exit /b 1
)
echo.
echo  构建 OAO翻译 本地 AI / 分享中继（:3011）
echo.
cd /d "%TD%"
call npm install
if errorlevel 1 goto :BuildFail
call npm run build
if errorlevel 1 goto :BuildFail
echo.
echo  构建完成。请重新运行「OAO服务器.bat」选项 2 或 1。
echo.
pause
exit /b 0

:BuildFail
echo  [错误] 构建失败
pause
exit /b 1

:DeployWorker
if not exist "%ROOT%\cloudflare\部署智谱Worker.bat" (
    echo  [错误] 未找到 cloudflare\部署智谱Worker.bat
    pause
    exit /b 1
)
call "%ROOT%\cloudflare\部署智谱Worker.bat"
exit /b %ERRORLEVEL%

:PrintPrereq
echo.
call "%LIB%" CheckOllamaPort
if errorlevel 1 (
    echo  [提示] Ollama :11434 未响应 — 请安装并运行 ollama serve
) else (
    echo  [OK] Ollama :11434
)
call "%LIB%" CheckAnythingLLMPort
if errorlevel 1 (
    echo  [提示] AnythingLLM :3001 未响应 — 请启动并创建 oaoeth 工作区
) else (
    echo  [OK] AnythingLLM :3001
)
exit /b 0

:UnknownArg
echo  用法: OAO服务器.bat [all^|services^|tunnel^|build^|worker]
echo  不带参数进入交互菜单。
pause
exit /b 1
