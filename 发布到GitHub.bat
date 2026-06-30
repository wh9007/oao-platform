@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

set "GITHUB_USER=wh9007"
set "REPO_NAME=oao-platform"
set "REPO_URL=https://github.com/%GITHUB_USER%/%REPO_NAME%.git"

echo.
echo  ========================================
echo   OAO GitHub Pages 发布
echo   目标: https://%GITHUB_USER%.github.io/%REPO_NAME%/
echo  ========================================
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo  [错误] 未找到 git，请先安装 Git for Windows
    echo  https://git-scm.com/download/win
    pause
    exit /b 1
)

if not exist .git (
    git init
)

git branch -M main

git remote | findstr /I "^origin$" >nul 2>&1
if errorlevel 1 (
    git remote add origin "%REPO_URL%"
) else (
    git remote set-url origin "%REPO_URL%"
)

git add OAO.html index.html .nojekyll .gitignore DEPLOY.md cloudflare oao-meeting-signal.js "打开OAO.bat" "启动Tunnel.bat" "发布到GitHub.bat"
git status

echo.
set /p CONFIRM=确认提交并推送到 GitHub? (Y/N): 
if /I not "%CONFIRM%"=="Y" exit /b 0

git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Deploy OAO static site and Cloudflare configs"
) else (
    echo  [提示] 没有新的文件变更，继续尝试同步远程并推送...
)

echo.
echo  正在同步远程仓库...
git fetch origin 2>nul
git pull --rebase origin main 2>nul
if errorlevel 1 (
    echo  [提示] 普通 rebase 失败，尝试合并远程 README 初始化提交...
    git pull origin main --allow-unrelated-histories --no-edit 2>nul
    git pull --rebase origin main 2>nul
)

echo.
echo  正在推送到 GitHub...
git push -u origin main
if errorlevel 1 (
    echo.
    echo  ========================================
    echo  [推送失败] 常见原因与处理：
    echo  1. 远程仓库尚未创建
    echo     打开 https://github.com/new 创建 %REPO_NAME%
    echo     不要勾选 Add a README file
    echo.
    echo  2. 需要 GitHub Token 登录（不是账号密码）
    echo     https://github.com/settings/tokens/new
    echo     勾选 repo，生成后复制 Token
    echo     推送时：用户名=%GITHUB_USER%  密码=粘贴 Token
    echo.
    echo  3. 手动执行：
    echo     git remote set-url origin %REPO_URL%
    echo     git pull --rebase origin main
    echo     git push -u origin main
    echo  ========================================
    pause
    exit /b 1
)

echo.
echo  推送成功！
echo.
echo  请开启 GitHub Pages：
echo  https://github.com/%GITHUB_USER%/%REPO_NAME%/settings/pages
echo  Branch 选 main，目录选 / (root)
echo.
echo  约 1~3 分钟后访问：
echo  https://%GITHUB_USER%.github.io/%REPO_NAME%/
echo.
pause
