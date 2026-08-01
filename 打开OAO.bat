@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "URL=http://127.0.0.1:8777/OAO.html"
set "TD=%ROOT%\oao-translate"

if not exist "%ROOT%\OAO.html" (
    echo.
    echo  [错误] 未找到 OAO.html
    echo  当前目录: %ROOT%
    echo.
    pause
    exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
    where py >nul 2>&1 || (
        echo.
        echo  [错误] 未找到 Python，请安装 Python 3.8+
        echo.
        pause
        exit /b 1
    )
)

echo.
echo  OAO 一键启动
echo  主页: %URL%
echo.

call :FreePort 8777
call :FreePort 3000
call :FreePort 3011
call :EnsureTranslateEnv
call :EnsureNodeModules

echo  正在启动服务（仅保留 1 个后台窗口）...
start "OAO Services" /MIN "%ROOT%\oao-services.cmd"

echo  等待主页就绪...
call :WaitForUrl "%URL%" 20

start "" "%URL%"
echo.
echo  已打开 OAO 主页。
echo  OAO翻译 在后台启动中，首次约需 1~3 分钟；可直接点击工具栏「OAO翻译」并等待连接。
echo  后台窗口: 「OAO Services」（关闭即停止全部服务）
echo.
timeout /t 3 >nul
exit /b 0

:FreePort
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%~1" ^| findstr /I "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
exit /b 0

:EnsureTranslateEnv
if not exist "%TD%\server" exit /b 0
if not exist "%TD%\server\.env" copy /Y "%TD%\server\.env.example" "%TD%\server\.env" >nul
if not exist "%TD%\web\.env.local" copy /Y "%TD%\web\.env.local.example" "%TD%\web\.env.local" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d=[System.IO.Path]::GetFullPath('%TD%');" ^
  "$s=Join-Path $d 'server\.env';" ^
  "if(Test-Path -LiteralPath $s){$c=Get-Content -LiteralPath $s -Raw -Encoding UTF8; if($c -match 'PORT=3001'){$c=$c -replace 'PORT=3001','PORT=3011'; Set-Content -LiteralPath $s -Value $c -Encoding UTF8}};" ^
  "$w=Join-Path $d 'web\.env.local';" ^
  "if(Test-Path -LiteralPath $w){$c=Get-Content -LiteralPath $w -Raw -Encoding UTF8; if($c -match ':3001'){$c=$c -replace ':3001',':3011'; Set-Content -LiteralPath $w -Value $c -Encoding UTF8}}"
exit /b 0

:EnsureNodeModules
if not exist "%TD%\server\package.json" exit /b 0
where node >nul 2>&1 || exit /b 0
if not exist "%TD%\server\node_modules" (
    echo  首次运行: 安装 OAO翻译 server 依赖...
    pushd "%TD%\server" && call npm install && popd
)
if not exist "%TD%\web\node_modules" (
    echo  首次运行: 安装 OAO翻译 web 依赖...
    pushd "%TD%\web" && call npm install && popd
)
exit /b 0

:WaitForUrl
set "TARGET=%~1"
set "MAX=%~2"
set "N=0"
:WaitLoop
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri '%TARGET%' -UseBasicParsing -TimeoutSec 3).StatusCode; exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 exit /b 0
set /a N+=1
if %N% GEQ %MAX% exit /b 1
timeout /t 2 /nobreak >nul
goto WaitLoop
