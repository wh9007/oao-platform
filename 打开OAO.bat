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
    set "PY=py -3"
) else (
    set "PY=python"
)

echo.
echo  OAO 快速启动
echo  主页: %URL%
echo.

call :FreePort 8777
call :FreePort 3011
call :EnsureTranslateEnv

echo  正在启动主页...
start /B "" %PY% -m http.server 8777 --bind 127.0.0.1

echo  正在启动后台服务（可选本地 AI）...
start "OAO Services" /MIN "%ROOT%\oao-services.cmd"

echo  等待主页就绪...
call :WaitForUrl "%URL%" 8 1
if errorlevel 1 echo  [提示] 主页仍在启动，仍将打开浏览器...

start "" "%URL%"
echo.
echo  已打开 OAO 主页。
echo  OAO翻译：登录后点击左侧「OAO翻译」。
echo  分享/本地 AI 需保持「OAO Services」窗口开启（可选 Node.js + Ollama）。
echo.
timeout /t 2 >nul
exit /b 0

:FreePort
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%~1" ^| findstr /I "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)
exit /b 0

:EnsureTranslateEnv
if not exist "%TD%\server" exit /b 0
if not exist "%TD%\server\.env" copy /Y "%TD%\server\.env.example" "%TD%\server\.env" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[System.IO.Path]::GetFullPath('%TD%');$s=Join-Path $d 'server\.env';if(Test-Path -LiteralPath $s){$c=Get-Content -LiteralPath $s -Raw -Encoding UTF8;if($c -match 'PORT=3001'){$c=$c -replace 'PORT=3001','PORT=3011';Set-Content -LiteralPath $s -Value $c -Encoding UTF8}}"
exit /b 0

:WaitForUrl
set "TARGET=%~1"
set "MAX=%~2"
set "SLEEP=%~3"
if "%SLEEP%"=="" set "SLEEP=1"
set "N=0"
:WaitLoop
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri '%TARGET%' -UseBasicParsing -TimeoutSec 1).StatusCode; exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 exit /b 0
set /a N+=1
if %N% GEQ %MAX% exit /b 1
timeout /t %SLEEP% /nobreak >nul
goto WaitLoop
