@echo off
rem 兼容旧入口 — 已合并到「启动远程AI.bat」
call "%~dp0启动远程AI.bat" %*
exit /b %ERRORLEVEL%
