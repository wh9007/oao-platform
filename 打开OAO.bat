@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=8777"
set "PAGE=OAO.html"
set "URL=http://127.0.0.1:%PORT%/%PAGE%"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if not exist "%ROOT%\%PAGE%" (
    echo.
    echo  [错误] 未找到 %PAGE%，请确认脚本与网页在同一目录。
    echo  当前目录: %ROOT%
    echo.
    pause
    exit /b 1
)

set "PYCMD="
where python >nul 2>&1 && set "PYCMD=python"
if not defined PYCMD where py >nul 2>&1 && set "PYCMD=py -3"

if not defined PYCMD (
    echo.
    echo  [错误] 未找到 Python，无法启动网页服务
    echo  请安装 Python 3 并勾选 Add to PATH
    echo  https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

echo.
echo  正在释放端口 %PORT% ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr /I "LISTENING 监听"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo.
echo  ========================================
echo   OAO 本地站点
echo   主页: %URL%
echo   请使用 Chrome 或 Edge
echo  ========================================
echo.

where ollama >nul 2>&1
if not errorlevel 1 (
    powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2).StatusCode|Out-Null;exit 0}catch{exit 1}" >nul 2>&1
    if errorlevel 1 (
        echo  [提示] 正在尝试启动 Ollama...
        start "Ollama" /MIN cmd /k ollama serve
        timeout /t 2 /nobreak >nul
    ) else (
        echo  [OK] Ollama 本地模型已就绪
    )
    echo.
)

echo  正在启动本地预览服务...
start "OAO Preview Server" cmd /k "chcp 65001 >nul && cd /d ""%ROOT%"" && title OAO Preview Server && echo 服务目录: %ROOT% && echo 访问地址: %URL% && %PYCMD% -m http.server %PORT%"

set "TRIES=0"
:wait_server
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 400){exit 0}; exit 1}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto open_browser
set /a TRIES+=1
if %TRIES% GEQ 20 (
    echo.
    echo  [错误] 网页服务未就绪，请查看「OAO Preview Server」窗口中的报错。
    echo  也可手动在浏览器访问: %URL%
    echo.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_server

:open_browser
start "" "%URL%"

echo.
echo  已在浏览器打开: %URL%
echo  若页面空白或无法访问，请确认「OAO Preview Server」窗口仍在运行。
echo  关闭该窗口即可停止网页服务。
echo.
pause
