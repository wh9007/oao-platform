@echo off
cd /d "%~dp0"
echo.
echo  已合并到「启动远程AI.bat」
echo  首次运行会自动配置 Worker，日常请直接双击: 启动远程AI.bat
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\setup-remote-access.ps1"
exit /b %ERRORLEVEL%
