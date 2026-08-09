# OAO 远程 AI 一键配置：Worker 变量 + 部署 + 连通性检测
param(
    [switch]$SkipDeploy,
    [switch]$SkipSecret
)

$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$CfDir = $PSScriptRoot
$ConfigFile = Join-Path $CfDir 'remote-access.config.json'
$ConfigExample = Join-Path $CfDir 'remote-access.config.example.json'
$LocalConfig = Join-Path $Root 'local-config.js'
$WranglerToml = Join-Path $CfDir 'wrangler.toml'

function Write-Step($msg) { Write-Host "`n>>> $msg" -ForegroundColor Cyan }

if (-not (Test-Path $ConfigFile)) {
    if (Test-Path $ConfigExample) {
        Copy-Item $ConfigExample $ConfigFile
        Write-Host "已创建 $ConfigFile ，请确认 Tunnel 域名后回车继续..." -ForegroundColor Yellow
        notepad $ConfigFile
        Read-Host '按回车继续'
    } else {
        throw "缺少 remote-access.config.json"
    }
}

$cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
$llmOrigin = 'https://{0}' -f ($cfg.llm_tunnel_hostname -replace '^https?://', '')
$ollamaOrigin = 'https://{0}' -f ($cfg.ollama_tunnel_hostname -replace '^https?://', '')
$searxHost = if ($cfg.searx_tunnel_hostname) { $cfg.searx_tunnel_hostname } else { 'search.wh9007.dpdns.org' }
$searxOrigin = 'https://{0}' -f ($searxHost -replace '^https?://', '')

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  OAO 远程 AI 一键配置' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host " Worker: $($cfg.worker_url)"
Write-Host " LLM Tunnel: $llmOrigin -> 本机 :3001"
Write-Host " Ollama Tunnel: $ollamaOrigin -> 本机 :11434"
Write-Host " SearXNG Tunnel: $searxOrigin -> 本机 :8080"
Write-Host " 外网页面: $($cfg.github_pages_url)"

# 从 local-config.js 读取 AnythingLLM API Key
$apiKey = ''
if (Test-Path $LocalConfig) {
    $lc = Get-Content $LocalConfig -Raw -Encoding UTF8
    if ($lc -match "OAO_ANYTHINGLLM_API_KEY\s*=\s*'([^']+)'") {
        $apiKey = $matches[1].Trim()
    }
}
if (-not $apiKey -or $apiKey -match '你的|placeholder|example') {
    Write-Host ''
    Write-Host ' [警告] 未在 local-config.js 找到有效的 OAO_ANYTHINGLLM_API_KEY' -ForegroundColor Yellow
    Write-Host ' 请先在 AnythingLLM 设置 -> API Keys 生成 Key，写入 local-config.js'
    $apiKey = Read-Host '或在此粘贴 AnythingLLM API Key'
}
if (-not $apiKey) { throw '缺少 AnythingLLM API Key，无法配置 Worker' }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '请先安装 Node.js LTS'
}

if (-not (Test-Path $WranglerToml)) {
    if (Test-Path (Join-Path $CfDir 'wrangler.toml.example')) {
        Copy-Item (Join-Path $CfDir 'wrangler.toml.example') $WranglerToml
    } else {
        throw '缺少 cloudflare/wrangler.toml'
    }
}

Write-Step '更新 wrangler.toml 中的 Tunnel 变量'
$toml = Get-Content $WranglerToml -Raw -Encoding UTF8

function Set-TomlVar([string]$content, [string]$name, [string]$value) {
    $escaped = $value -replace '"', '\"'
    if ($content -match "(?m)^$name\s*=") {
        return [regex]::Replace($content, "(?m)^$name\s*=.*$", "$name = `"$escaped`"")
    }
    if ($content -match '\[vars\]') {
        return $content -replace '\[vars\]', "[vars]`r`n$name = `"$escaped`""
    }
    return $content + "`r`n[vars]`r`n$name = `"$escaped`"`r`n"
}

$toml = Set-TomlVar $toml 'ZHIPU_MODEL' 'glm-4.7-flash'
$toml = Set-TomlVar $toml 'LLM_ORIGIN' $llmOrigin
$toml = Set-TomlVar $toml 'OLLAMA_ORIGIN' $ollamaOrigin
$toml = Set-TomlVar $toml 'SEARXNG_ORIGIN' $searxOrigin
[IO.File]::WriteAllText($WranglerToml, $toml, [Text.UTF8Encoding]::new($false))

Push-Location $CfDir
try {
    if (-not $SkipSecret) {
        Write-Step '写入 Worker Secret: ANYTHINGLLM_API_KEY'
        $apiKey | & npx --yes wrangler secret put ANYTHINGLLM_API_KEY 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { throw 'wrangler secret put ANYTHINGLLM_API_KEY 失败' }
    }

    if (-not $SkipDeploy) {
        Write-Step '部署 Worker 到 Cloudflare'
        & npx --yes wrangler deploy 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy 失败' }
    }
} finally {
    Pop-Location
}

Write-Step '检测 Worker 与 Tunnel 连通性'
Start-Sleep -Seconds 2
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $CfDir 'check-remote-ai.ps1')

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host '  配置完成 — 最后步骤（本机）' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host ''
Write-Host '1. Cloudflare Zero Trust -> 网络 -> Tunnel -> 公网路由 确认:'
Write-Host "   $($cfg.llm_tunnel_hostname)  -> http://127.0.0.1:3001"
Write-Host "   $($cfg.ollama_tunnel_hostname) -> http://127.0.0.1:11434"
Write-Host "   $searxHost -> http://127.0.0.1:8080"
Write-Host ''
Write-Host '2. 本机 SearXNG: OAO服务器.bat 会自动 docker compose 启动 searxng/ (需 Docker Desktop)'
Write-Host '   打开 AnythingLLM 桌面版 + Ollama'
Write-Host ''
Write-Host '3. 若 Tunnel DNS 报错，WiFi DNS 改为 1.1.1.1 / 8.8.8.8，V2Ray 对 cloudflare.com 直连'
Write-Host ''
Write-Host '4. 双击 OAO服务器.bat，保持窗口直到 Registered tunnel connection'
Write-Host ''
Write-Host "5. 外网测试: $($cfg.github_pages_url)"
Write-Host ''
$ReadyMarker = Join-Path $CfDir '.remote-ai-ready'
New-Item -ItemType File -Path $ReadyMarker -Force | Out-Null
Read-Host '按回车关闭'
