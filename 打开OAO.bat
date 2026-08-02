@echo off

setlocal EnableExtensions

chcp 65001 >nul

cd /d "%~dp0"



set "ROOT=%~dp0"

if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "LIB=%ROOT%\scripts\lib.cmd"



call "%LIB%" InitRoot "%ROOT%"



if not exist "%ROOT%\OAO.html" (

    echo.

    echo  [错误] 未找到 OAO.html

    echo  当前目录: %ROOT%

    echo.

    pause

    exit /b 1

)



call "%LIB%" FindPython

if errorlevel 1 (

    echo.

    echo  [错误] 未找到 Python 3.8+，请安装 Python

    echo.

    pause

    exit /b 1

)



echo.

echo  ============================================================

echo    OAO 本地测试

echo  ============================================================

echo  主页: %URL%

echo.

echo  用途: 本地功能测试（AI / 小O会议 / OAO翻译）

echo  外网远程 AI: 请使用「OAO服务器.bat」

echo  版本发布: 请使用「一键上传GitHub.bat」

echo.



call "%LIB%" FreePort 8777

call "%LIB%" EnsureTranslateEnv



call "%LIB%" CheckOllamaPort

if errorlevel 1 (

    echo  [提示] Ollama 未运行 — AI 对话将尝试 AnythingLLM / 智谱备援

) else (

    echo  [OK] Ollama 已就绪

)

call "%LIB%" CheckAnythingLLMPort

if errorlevel 1 (

    echo  [提示] AnythingLLM 未运行 — 知识库检索不可用

) else (

    echo  [OK] AnythingLLM 已就绪

)



echo.

echo  正在启动本地预览...

start /B "" %PY% -m http.server 8777 --bind 127.0.0.1



call "%LIB%" WaitForUrl "%URL%" 8 1

if errorlevel 1 echo  [提示] 主页仍在启动，仍将打开浏览器...



start "" "%URL%"

echo.

echo  已打开 OAO 主页。测试完成后可直接关闭本窗口（会停止 :8777）。

echo.

pause


