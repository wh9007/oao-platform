@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ============================================================
echo    OAO — 部署 Cloudflare Worker（智谱 GLM 中转）
echo  ============================================================
echo.
echo  架构: GitHub Pages 前端 ^→ Worker ^→ 智谱 GLM-4.7-Flash
echo  API Key 只保存在 Cloudflare Secrets，不会进入 GitHub。
echo.

where node >nul 2>&1 || (
    echo  [错误] 请先安装 Node.js LTS
    pause
    exit /b 1
)

if not exist "wrangler.toml" (
    echo  [提示] 未找到 wrangler.toml
    echo  1. 复制 wrangler.toml.example 为 wrangler.toml
    echo  2. 填写 account_id
    echo.
    copy /Y "wrangler.toml.example" "wrangler.toml" >nul
    notepad "wrangler.toml"
)

echo  [步骤 1/3] 登录 Cloudflare（浏览器授权，按提示操作）...
call npx wrangler login
if errorlevel 1 (
    echo  [错误] wrangler login 失败
    pause
    exit /b 1
)

echo.
echo  [步骤 2/3] 设置智谱 API Key（粘贴后回车，输入不会显示）...
echo  获取地址: https://open.bigmodel.cn/usercenter/apikeys
echo.
call npx wrangler secret put ZHIPU_API_KEY
if errorlevel 1 (
    echo  [错误] 设置 ZHIPU_API_KEY 失败
    pause
    exit /b 1
)

echo.
echo  [步骤 3/3] 部署 Worker...
call npx wrangler deploy
if errorlevel 1 (
    echo  [错误] 部署失败
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   [完成] 请访问: https://你的worker域名/glm/health
echo   应返回 ok:true 且 model: glm-4.7-flash
echo   然后在 OAO.html 外网页面测试 AI 对话与小O会议纪要
echo  ============================================================
echo.
pause
