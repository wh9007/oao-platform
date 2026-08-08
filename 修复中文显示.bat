@echo off
cd /d "%~dp0"
echo.
echo  正在修复脚本编码（bat/cmd 转 GBK，ps1 转 UTF-8 BOM）...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cloudflare\fix-bat-encoding.ps1"
echo.
echo  修复完成。请重新双击 OAO服务器.bat 或 打开OAO.bat
pause
