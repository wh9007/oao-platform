# OAO Worker 快速部署（不含智谱 GLM 配置）
param(
    [switch]$NoPause
)

$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

Set-Location $PSScriptRoot

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host '   OAO — 快速部署 Cloudflare Worker' -ForegroundColor Cyan
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host ' 用途: 更新 Worker 代码（AI联网 /web-search、Tunnel 代理等）'
Write-Host ' 说明: 智谱 GLM 已停用，本脚本不会要求设置 ZHIPU_API_KEY'
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ' [错误] 请先安装 Node.js LTS: https://nodejs.org' -ForegroundColor Red
    if (-not $NoPause) { Read-Host '按回车退出' }
    exit 1
}

if (-not (Test-Path 'wrangler.toml')) {
    Write-Host ' [错误] 未找到 wrangler.toml' -ForegroundColor Red
    Write-Host ' 请从 wrangler.toml.example 复制并填写 account_id 等配置'
    if (-not $NoPause) { Read-Host '按回车退出' }
    exit 1
}

if (-not (Test-Path 'node_modules')) {
    Write-Host ' [1/2] 首次安装依赖 npm install …'
    cmd /c 'npm install'
    if ($LASTEXITCODE -ne 0) {
        Write-Host ' [错误] npm install 失败' -ForegroundColor Red
        if (-not $NoPause) { Read-Host '按回车退出' }
        exit 1
    }
} else {
    Write-Host ' [1/2] 依赖已就绪，跳过 npm install'
}

Write-Host ' [2/2] npx wrangler deploy …'
cmd /c 'npx wrangler deploy'
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host ' [错误] 部署失败' -ForegroundColor Red
    Write-Host ' 若提示未登录，请先在本目录执行: npx wrangler login'
    Write-Host ' 若提示权限/account_id，请检查 wrangler.toml 中的 account_id'
    if (-not $NoPause) { Read-Host '按回车退出' }
    exit 1
}

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Green
Write-Host '  [部署成功]'
Write-Host '  验证 AI联网: https://oao-ai.wh529007.workers.dev/web-search?q=test'
Write-Host '  验证 Tunnel:  https://oao-ai.wh529007.workers.dev/api/ping'
Write-Host '  前端发布:     双击项目根目录「一键上传GitHub.bat」'
Write-Host ' ============================================================' -ForegroundColor Green

if ($NoPause) {
    Start-Sleep -Seconds 3
} else {
    Read-Host '按回车关闭'
}

exit 0
