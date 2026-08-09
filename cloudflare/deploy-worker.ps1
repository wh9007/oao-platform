# 部署 Cloudflare Worker — 首次完整配置（可选智谱 Secret，日常请用 deploy-worker-quick.ps1）
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

Set-Location $PSScriptRoot

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host '   OAO — Worker 首次完整配置' -ForegroundColor Cyan
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host ' 日常仅更新代码请双击: 仅快速部署Worker.bat'
Write-Host ' 当前 OAO 前端已停用智谱 GLM（OAO_DISABLE_GLM=true）'
Write-Host ' 本脚本主要用于: wrangler login + Tunnel/Secrets 首次配置'
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
Write-Host ' [可选] 设置智谱 API Key（OAO 已停用 GLM，可跳过 — 直接回车或 Ctrl+C）...'
Write-Host ' 获取地址: https://open.bigmodel.cn/usercenter/apikeys'
$skipGlm = Read-Host '是否设置 ZHIPU_API_KEY? 输入 y 继续，其它键跳过'
if ($skipGlm -eq 'y' -or $skipGlm -eq 'Y') {
    cmd /c 'npx wrangler secret put ZHIPU_API_KEY'
    if ($LASTEXITCODE -ne 0) {
        Write-Host ' [警告] 设置 ZHIPU_API_KEY 失败，将继续部署（不影响 AI联网 / Tunnel）' -ForegroundColor Yellow
    }
} else {
    Write-Host ' 已跳过智谱 Key'
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
Write-Host '  [完成] 验证:'
Write-Host '  AI联网: https://oao-ai.wh529007.workers.dev/web-search?q=test'
Write-Host '  Tunnel: https://oao-ai.wh529007.workers.dev/api/ping'
Write-Host '  日常更新请用: 仅快速部署Worker.bat'
Write-Host ' ============================================================' -ForegroundColor Green
Read-Host '按回车关闭'
