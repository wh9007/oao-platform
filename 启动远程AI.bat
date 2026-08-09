@echo off
rem 兼容旧名称 — 与 OAO服务器.bat 相同
cd /d "%~dp0"
call "%~dp0OAO服务器.bat" %*
exit /b %ERRORLEVEL%
