@echo off
rem OAO 脚本公共库 — 由 本地测试OAO.bat / OAO服务器.bat 调用
rem 用法: call "%~dp0scripts\lib.cmd" <子程序名> [参数...]
if "%~1"=="" exit /b 1
goto %~1

:InitRoot
set "ROOT=%~2"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "TD=%ROOT%\oao-translate"
set "URL=http://127.0.0.1:8777/OAO.html"
exit /b 0

:FindPython
set "PY="
where python >nul 2>&1 && set "PY=python" && exit /b 0
where py >nul 2>&1 || exit /b 1
set "PY=py -3"
exit /b 0

:FindNode
where node >nul 2>&1
exit /b %ERRORLEVEL%

:FindCloudflared
set "CLOUDFLARED="
where cloudflared >nul 2>&1 && set "CLOUDFLARED=cloudflared" && exit /b 0
if exist "%ProgramFiles%\Cloudflare\Cloudflare WARP\cloudflared.exe" (
    set "CLOUDFLARED=%ProgramFiles%\Cloudflare\Cloudflare WARP\cloudflared.exe"
    exit /b 0
)
exit /b 1

:FreePort
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%~2" ^| findstr /I "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)
exit /b 0

:EnsureTranslateEnv
if not exist "%TD%\server" exit /b 0
if not exist "%TD%\server\.env" copy /Y "%TD%\server\.env.example" "%TD%\server\.env" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[System.IO.Path]::GetFullPath('%TD%');$s=Join-Path $d 'server\.env';if(Test-Path -LiteralPath $s){$c=Get-Content -LiteralPath $s -Raw -Encoding UTF8;if($c -match 'PORT=3001'){$c=$c -replace 'PORT=3001','PORT=3011';Set-Content -LiteralPath $s -Value $c -Encoding UTF8}}"
exit /b 0

:WaitForUrl
set "TARGET=%~2"
set "MAX=%~3"
set "SLEEP=%~4"
if "%SLEEP%"=="" set "SLEEP=1"
set "N=0"
:WaitLoop
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri '%TARGET%' -UseBasicParsing -TimeoutSec 1).StatusCode; exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 exit /b 0
set /a N+=1
if %N% GEQ %MAX% exit /b 1
timeout /t %SLEEP% /nobreak >nul
goto WaitLoop

:CheckOllamaPort
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2).StatusCode; exit 0}catch{exit 1}" >nul 2>&1
exit /b %ERRORLEVEL%

:CheckAnythingLLMPort
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/ping' -UseBasicParsing -TimeoutSec 3).StatusCode; exit 0}catch{exit 1}" >nul 2>&1
exit /b %ERRORLEVEL%
