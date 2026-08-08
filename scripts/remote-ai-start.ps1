# OAO 远程 AI 一键启动 — 每次运行即可让外网访问本机模型
param(
    [switch]$Menu,
    [switch]$CheckOnly,
    [switch]$SkipDnsCheck
)

$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Continue'

$Root = Split-Path $PSScriptRoot -Parent
$Lib = Join-Path $Root 'scripts\lib.cmd'
$CfDir = Join-Path $Root 'cloudflare'
$TokenFile = Join-Path $CfDir 'tunnel-token.txt'
$ConfigFile = Join-Path $CfDir 'remote-access.config.json'
$ReadyMarker = Join-Path $CfDir '.remote-ai-ready'

if ($Menu) {
    & (Join-Path $Root 'scripts\oao-server.ps1')
    exit $LASTEXITCODE
}

function Get-RemoteConfig {
    if (-not (Test-Path $ConfigFile)) {
        $ex = Join-Path $CfDir 'remote-access.config.example.json'
        if (Test-Path $ex) { Copy-Item $ex $ConfigFile -Force }
    }
    if (Test-Path $ConfigFile) {
        return Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    return [pscustomobject]@{
        worker_url = 'https://oao-ai.wh529007.workers.dev'
        llm_tunnel_hostname = 'llm.wh9007.dpdns.org'
        ollama_tunnel_hostname = 'ollama.wh9007.dpdns.org'
        github_pages_url = 'https://wh9007.github.io/oao-platform/OAO.html'
    }
}

function Test-LocalPort([int]$Port, [string]$Path = '/') {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:${Port}${Path}" -UseBasicParsing -TimeoutSec 3
        return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
    } catch { return $false }
}

function Find-CloudflaredPath {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $npm = Join-Path $env:APPDATA 'npm\cloudflared.cmd'
    if (Test-Path $npm) { return $npm }
    $warp = Join-Path ${env:ProgramFiles} 'Cloudflare\Cloudflare WARP\cloudflared.exe'
    if (Test-Path $warp) { return $warp }
    return $null
}

function Show-Banner($cfg) {
    Write-Host ''
    Write-Host ' ============================================================' -ForegroundColor Cyan
    Write-Host '   OAO 远程 AI 一键启动' -ForegroundColor Cyan
    Write-Host ' ============================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  外网用户打开:' $cfg.github_pages_url
    Write-Host '  链路: 浏览器 -> Worker -> Tunnel -> 本机 AI'
    Write-Host ''
}

function Test-LocalAi {
    Write-Host ' (1/4) 检查本机 AI 服务...' -ForegroundColor Cyan
    $okAllm = Test-LocalPort -Port 3001 -Path '/api/ping'
    $okOllama = Test-LocalPort -Port 11434 -Path '/api/tags'
    if ($okAllm) {
        Write-Host '  (正常) AnythingLLM 3001' -ForegroundColor Green
    } else {
        Write-Host '  (提示) AnythingLLM 未运行 — 请先打开 AnythingLLM 桌面版' -ForegroundColor Yellow
        Write-Host '         工作区 oaoeth，聊天模式 Query'
    }
    if ($okOllama) {
        Write-Host '  (正常) Ollama 11434' -ForegroundColor Green
    } else {
        if (Get-Command ollama -ErrorAction SilentlyContinue) {
            Write-Host '  (启动) 正在启动 Ollama...' -ForegroundColor Yellow
            Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
            Start-Sleep -Seconds 4
            if (Test-LocalPort -Port 11434 -Path '/api/tags') {
                Write-Host '  (正常) Ollama 已启动' -ForegroundColor Green
                $okOllama = $true
            }
        } else {
            Write-Host '  (提示) 未安装 Ollama — 请从 https://ollama.com 安装' -ForegroundColor Yellow
        }
    }
    if (-not $okAllm) {
        Write-Host ''
        Write-Host '  AnythingLLM 必须手动打开后才能提供知识库 AI' -ForegroundColor Yellow
        $w = Read-Host '  已打开 AnythingLLM 后按回车继续，或输入 N 退出'
        if ($w -match '^[Nn]') { exit 1 }
    }
    return ($okAllm -and $okOllama)
}

function Test-NetworkForTunnel {
    if ($SkipDnsCheck) { return $true }
    Write-Host ''
    Write-Host ' (2/4) 检查 Tunnel 网络/DNS...' -ForegroundColor Cyan
    $xray = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.InterfaceAlias -match 'xray|v2ray|clash|sing-box' }
    if ($xray) {
        Write-Host '  (警告) 检测到 V2Ray/Xray — 可能导致 Tunnel 失败' -ForegroundColor Yellow
        Write-Host '         请运行「V2Ray与Tunnel共存.bat」添加 Cloudflare 直连，或暂时关闭 V2Ray'
    }
    $dnsScript = Join-Path $CfDir 'check-dns.ps1'
    if (Test-Path $dnsScript) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $dnsScript
        if ($LASTEXITCODE -ne 0) {
            Write-Host ''
            $ans = Read-Host '  DNS 未通过. 仍尝试启动 Tunnel? 输入 Y 继续'
            if ($ans -notmatch '^[Yy]') { exit 1 }
        }
    }
    return $true
}

function Ensure-RemoteReady {
    if (Test-Path $ReadyMarker) { return }
    Write-Host ''
    Write-Host ' (3/4) 首次运行 — 配置 Cloudflare Worker...' -ForegroundColor Cyan
    $setup = Join-Path $CfDir 'setup-remote-access.ps1'
    if (-not (Test-Path $setup)) {
        Write-Host '  (跳过) 未找到 setup-remote-access.ps1' -ForegroundColor Yellow
        return
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $setup
    if ($LASTEXITCODE -eq 0) {
        New-Item -ItemType File -Path $ReadyMarker -Force | Out-Null
    }
}

function Start-TunnelForeground($cfg) {
    Write-Host ''
    Write-Host ' (4/4) 启动 Cloudflare Tunnel...' -ForegroundColor Cyan
    $cf = Find-CloudflaredPath
    if (-not $cf) {
        Write-Host '  (错误) 未找到 cloudflared — 运行: winget install Cloudflare.cloudflared' -ForegroundColor Red
        Read-Host '按回车退出'
        exit 1
    }
    if (-not (Test-Path $TokenFile)) {
        Write-Host "  (错误) 缺少 Token 文件: $TokenFile" -ForegroundColor Red
        $ex = Join-Path $CfDir 'tunnel-token.txt.example'
        if (Test-Path $ex) { Copy-Item $ex $TokenFile -Force }
        Start-Process notepad $TokenFile
        Read-Host '填写 Token 后按回车'
    }
    $token = (Get-Content $TokenFile -Raw -ErrorAction SilentlyContinue).Trim()
    if (-not $token) {
        Write-Host '  (错误) Token 为空' -ForegroundColor Red
        Read-Host '按回车退出'
        exit 1
    }
    $running = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "  (提示) cloudflared 已在运行 PID=$($running[0].Id)" -ForegroundColor Green
        Write-Host '  若外网仍不可用，请先关闭旧 Tunnel 窗口再重新运行本脚本'
        Read-Host '按回车退出'
        exit 0
    }
    Write-Host ''
    Write-Host ' ============================================================' -ForegroundColor Green
    Write-Host '  Tunnel 运行中 — 请勿关闭本窗口' -ForegroundColor Green
    Write-Host ' ============================================================' -ForegroundColor Green
    Write-Host '  成功标志: Registered tunnel connection'
    Write-Host "  外网测试: $($cfg.github_pages_url)"
    Write-Host '  关闭本窗口 = 外网无法访问本机 AI'
    Write-Host ' ============================================================' -ForegroundColor Green
    Write-Host ''
    & $cf tunnel run --token $token --protocol http2
    Write-Host ''
    Write-Host ' Tunnel 已退出'
    Read-Host '按回车关闭'
}

# --- main ---
$cfg = Get-RemoteConfig
Show-Banner $cfg

if ($CheckOnly) {
    Test-LocalAi | Out-Null
    Test-NetworkForTunnel | Out-Null
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $CfDir 'check-remote-ai.ps1')
    Read-Host '按回车关闭'
    exit 0
}

Test-LocalAi | Out-Null
Test-NetworkForTunnel | Out-Null
Ensure-RemoteReady
Start-TunnelForeground $cfg
