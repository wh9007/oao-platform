@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

if /I not "%~1"=="RUN" (
    cmd /k "%~f0" RUN
    exit /b 0
)

set "TOKEN_FILE=%~dp0git-token.txt"
set "LOG_FILE=%~dp0upload-log.txt"

echo.
echo  ============================================================
echo    OAO 一键上传到 GitHub
echo  ============================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo  [缺少 Git] 请先安装: https://git-scm.com/download/win
    goto :END
)

if not exist "%TOKEN_FILE%" echo.>"%TOKEN_FILE%"

findstr /R /C:"ghp_" "%TOKEN_FILE%" >nul 2>&1
if errorlevel 1 (
    echo  正在打开记事本，请粘贴 Token（ghp_ 开头），保存后关闭。
    echo  获取地址: https://github.com/settings/tokens/new?scopes=repo
    echo.
    notepad "%TOKEN_FILE%"
)

findstr /R /C:"ghp_" "%TOKEN_FILE%" >nul 2>&1
if errorlevel 1 (
    echo  [错误] 记事本里没有有效的 Token，请重新运行本文件。
    goto :END
)

echo  正在上传，请稍候（约 10~60 秒）...
echo  详细过程见: upload-log.txt
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0do-upload.ps1"
set "UPLOAD_OK=%ERRORLEVEL%"

echo.
type "%LOG_FILE%" 2>nul
echo.

if "%UPLOAD_OK%"=="0" (
    echo  ============================================================
    echo   [上传成功]
    echo   约 2 分钟后访问: https://wh9007.github.io/oao-platform/
    echo   若页面仍是旧版，请按 Ctrl+F5 强制刷新
    echo  ============================================================
    start "" "https://wh9007.github.io/oao-platform/"
) else (
    echo  ============================================================
    echo   [上传失败] 请看上方 upload-log.txt
    echo   可重新生成 Token 后再次双击本文件
    echo  ============================================================
    start "" "https://github.com/settings/tokens/new?scopes=repo"
)

:END
echo.
echo  本窗口会一直保持，看完结果后可直接关闭。
pause
