# 部署 Cloudflare Worker - 智谱 GLM 中转
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

Set-Location $PSScriptRoot

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host '   OAO — 部署 Cloudflare Worker（智谱 GLM 中转）' -ForegroundColor Cyan
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host ' 架构: GitHub Pages 前端 -> Worker -> 智谱 GLM-4.7-Flash'
Write-Host ' API Key 只保存在 Cloudflare Secrets，不会进入 GitHub。'
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ' [错误] 请先安装 Node.js LTS' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

if (-not (Test-Path 'wrangler.toml')) {
    Write-Host ' [提示] 未找到 wrangler.toml，正在创建...' -ForegroundColor Yellow
    Copy-Item 'wrangler.toml.example' 'wrangler.toml' -Force -ErrorAction SilentlyContinue
    Start-Process notepad 'wrangler.toml'
}

Write-Host ' [步骤 1/3] 登录 Cloudflare（浏览器授权）...'
cmd /c 'npx wrangler login'
if ($LASTEXITCODE -ne 0) {
    Write-Host ' [错误] wrangler login 失败' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

Write-Host ''
Write-Host ' [步骤 2/3] 设置智谱 API Key（粘贴后回车，输入不会显示）...'
Write-Host ' 获取地址: https://open.bigmodel.cn/usercenter/apikeys'
cmd /c 'npx wrangler secret put ZHIPU_API_KEY'
if ($LASTEXITCODE -ne 0) {
    Write-Host ' [错误] 设置 ZHIPU_API_KEY 失败' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

Write-Host ''
Write-Host ' [步骤 3/3] 部署 Worker...'
cmd /c 'npx wrangler deploy'
if ($LASTEXITCODE -ne 0) {
    Write-Host ' [错误] 部署失败' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Green
Write-Host '  [完成] 请访问: https://你的worker域名/glm/health'
Write-Host '  应返回 ok:true 且 model: glm-4.7-flash'
Write-Host '  然后在 OAO.html 外网页面测试 AI 对话'
Write-Host ' ============================================================' -ForegroundColor Green
Read-Host '按回车关闭'
