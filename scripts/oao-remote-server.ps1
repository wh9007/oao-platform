# OAO 服务器 — 一键启动：本机 AI + 后台服务 + Cloudflare Tunnel
# 双击 OAO服务器.bat 即可；外网通过 Worker -> Tunnel 访问本机 AnythingLLM / Ollama
param(
    [switch]$Menu,
    [switch]$CheckOnly,
    [switch]$SkipDnsCheck
)

$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Continue'

$Root = Split-Path $PSScriptRoot -Parent
$CfDir = Join-Path $Root 'cloudflare'
$TokenFile = Join-Path $CfDir 'tunnel-token.txt'
$ConfigFile = Join-Path $CfDir 'remote-access.config.json'
$ReadyMarker = Join-Path $CfDir '.remote-ai-ready'
$ServicesScript = Join-Path $Root 'scripts\oao-services.ps1'

$Host.UI.RawUI.WindowTitle = 'OAO 服务器 — 外网访问本机 AI'

. (Join-Path $PSScriptRoot 'tunnel-health.ps1')

function Wait-BeforeExit {
    param([int]$Code = 0)
    Write-Host ''
    Read-Host '按回车关闭窗口'
    exit $Code
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
        searx_tunnel_hostname = 'search.wh9007.dpdns.org'
        github_pages_url = 'https://wh9007.github.io/oao-platform/OAO.html'
    }
}

function Test-LocalPort {
    param([int]$Port, [string]$Path = '/')
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:${Port}${Path}" -UseBasicParsing -TimeoutSec 3
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
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

function Show-Banner {
    param($Cfg)
    Write-Host ''
    Write-Host ' ============================================================' -ForegroundColor Cyan
    Write-Host '   OAO 服务器 — 一键启动远程本机 AI' -ForegroundColor Cyan
    Write-Host ' ============================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  外网打开:' $Cfg.github_pages_url
    Write-Host '  链路: 浏览器 -> Worker -> Tunnel -> 本机 AI / SearXNG 联网'
    Write-Host '  只需保持本窗口打开，关闭 = 外网无法访问本机 AI'
    Write-Host '  高级菜单: OAO服务器.bat menu' -ForegroundColor DarkGray
    Write-Host ''
}

function Ensure-BackgroundServices {
    $listening8777 = netstat -ano 2>$null | Select-String ':8777' | Select-String 'LISTENING'
    $svcRunning = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*oao-services.ps1*' }
    if ($listening8777 -or $svcRunning) {
        Write-Host '  (正常) OAO 后台服务已在运行' -ForegroundColor Green
        return
    }
    if (-not (Test-Path $ServicesScript)) {
        Write-Host '  (跳过) 未找到 oao-services.ps1' -ForegroundColor Yellow
        return
    }
    Write-Host '  (启动) OAO 后台服务（Ollama / 主页 8777 / 翻译）…' -ForegroundColor Yellow
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ServicesScript`""
    ) -WindowStyle Minimized
    Start-Sleep -Seconds 3
    Write-Host '  (完成) 后台服务已启动（可最小化，勿关闭）' -ForegroundColor Green
}

function Ensure-SearXNGService {
    Write-Host ''
    Write-Host ' [1b/5] SearXNG 联网搜索 (8080)' -ForegroundColor Cyan
    $searxScript = Join-Path $PSScriptRoot 'searxng-start.ps1'
    if (-not (Test-Path $searxScript)) {
        Write-Host '  (跳过) 未找到 searxng-start.ps1' -ForegroundColor Yellow
        return $false
    }
    try {
        . $searxScript
        return (Ensure-SearXNG)
    } catch {
        Write-Host "  (警告) SearXNG 启动异常: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

function Ensure-Ollama {
    Write-Host ''
    Write-Host ' [1/5] Ollama (11434)' -ForegroundColor Cyan
    if (Test-LocalPort -Port 11434 -Path '/api/tags') {
        Write-Host '  (正常) Ollama 已运行' -ForegroundColor Green
        return $true
    }
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Write-Host '  (提示) 未安装 Ollama — https://ollama.com' -ForegroundColor Yellow
        return $false
    }
    Write-Host '  (启动) 正在启动 Ollama…' -ForegroundColor Yellow
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    for ($i = 1; $i -le 15; $i++) {
        Start-Sleep -Seconds 2
        if (Test-LocalPort -Port 11434 -Path '/api/tags') {
            Write-Host '  (正常) Ollama 已启动' -ForegroundColor Green
            return $true
        }
    }
    Write-Host '  (警告) Ollama 启动超时，继续尝试 Tunnel…' -ForegroundColor Yellow
    return $false
}

function Find-AnythingLLMExe {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\AnythingLLM\AnythingLLM.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\anythingllm-desktop\AnythingLLM.exe'),
        (Join-Path ${env:ProgramFiles} 'AnythingLLM\AnythingLLM.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'AnythingLLM\AnythingLLM.exe')
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Ensure-AnythingLLM {
    Write-Host ''
    Write-Host ' [2/5] AnythingLLM (3001)' -ForegroundColor Cyan
    if (Test-LocalPort -Port 3001 -Path '/api/ping') {
        Write-Host '  (正常) AnythingLLM 已运行' -ForegroundColor Green
        return $true
    }
    $exe = Find-AnythingLLMExe
    if ($exe) {
        Write-Host "  (启动) 正在打开 AnythingLLM…" -ForegroundColor Yellow
        Start-Process -FilePath $exe
        for ($i = 1; $i -le 30; $i++) {
            Start-Sleep -Seconds 2
            if (Test-LocalPort -Port 3001 -Path '/api/ping') {
                Write-Host '  (正常) AnythingLLM 已就绪' -ForegroundColor Green
                return $true
            }
            if ($i % 5 -eq 0) {
                Write-Host "  (等待) AnythingLLM 启动中… ${i}/30" -ForegroundColor DarkGray
            }
        }
    } else {
        Write-Host '  (提示) 未找到 AnythingLLM 安装路径，请手动打开桌面版' -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host '  AnythingLLM 需手动打开（工作区 oaoeth，模式 Query）' -ForegroundColor Yellow
    $w = Read-Host '  已打开后按回车继续，输入 N 退出'
    if ($w -match '^[Nn]') { return $false }
    if (Test-LocalPort -Port 3001 -Path '/api/ping') {
        Write-Host '  (正常) AnythingLLM 已连接' -ForegroundColor Green
        return $true
    }
    Write-Host '  (警告) 3001 仍无响应，Tunnel 可启动但知识库 AI 可能不可用' -ForegroundColor Yellow
    return $false
}

function Ensure-TunnelToken {
    if (-not (Test-Path $TokenFile)) {
        $ex = Join-Path $CfDir 'tunnel-token.txt.example'
        if (Test-Path $ex) { Copy-Item $ex $TokenFile -Force }
    }
    $token = ''
    if (Test-Path $TokenFile) {
        $token = (Get-Content $TokenFile -Raw -ErrorAction SilentlyContinue).Trim()
    }
    if ($token -and $token -notmatch '^#') { return $token }
    Write-Host ''
    Write-Host '  (首次) 需要 Cloudflare Tunnel Token' -ForegroundColor Yellow
    Write-Host "  文件: $TokenFile"
    Write-Host '  获取: Cloudflare Zero Trust -> Networks -> Tunnels -> Install connector -> Copy token'
    Start-Process notepad $TokenFile
    Read-Host '  粘贴 Token 并保存后按回车'
    $token = (Get-Content $TokenFile -Raw -ErrorAction SilentlyContinue).Trim()
    if (-not $token -or $token -match '^#') {
        Write-Host '  (错误) Token 仍为空' -ForegroundColor Red
        return $null
    }
    return $token
}

function Ensure-FirstTimeWorker {
    if (Test-Path $ReadyMarker) { return }
    Write-Host ''
    Write-Host ' [3/5] 首次运行 — 配置 Cloudflare Worker（仅需一次）' -ForegroundColor Cyan
    $setup = Join-Path $CfDir 'setup-remote-access.ps1'
    if (-not (Test-Path $setup)) {
        Write-Host '  (跳过) 未找到 setup-remote-access.ps1' -ForegroundColor Yellow
        return
    }
    try {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $setup
        if ($LASTEXITCODE -eq 0) {
            New-Item -ItemType File -Path $ReadyMarker -Force | Out-Null
            Write-Host '  (完成) Worker 配置完成' -ForegroundColor Green
        } else {
            Write-Host '  (警告) Worker 配置未完全成功，可稍后运行 cloudflare\setup-remote-access.ps1' -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  (警告) Worker 配置出错: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Test-NetworkForTunnel {
    if ($SkipDnsCheck) { return $true }
    Write-Host ''
    Write-Host ' [4/5] Tunnel 网络 / DNS' -ForegroundColor Cyan
    $xray = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.InterfaceAlias -match 'xray|v2ray|clash|sing-box' }
    if ($xray) {
        Write-Host '  (警告) 检测到 V2Ray/Xray — 可能导致 Tunnel 失败' -ForegroundColor Yellow
        Write-Host '         可运行「V2Ray与Tunnel共存.bat」，或暂时关闭 V2Ray'
    }
    $dnsScript = Join-Path $CfDir 'check-dns.ps1'
    if (-not (Test-Path $dnsScript)) { return $true }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $dnsScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host '  (警告) DNS 检测未通过，仍尝试启动 Tunnel…' -ForegroundColor Yellow
        Write-Host '         若失败：WiFi DNS 改为 1.1.1.1 / 8.8.8.8，运行 ipconfig /flushdns'
    }
    return $true
}

function Show-RunningBanner {
    param($Cfg, [string]$Mode = 'tunnel')
    Write-Host ''
    Write-Host ' ============================================================' -ForegroundColor Green
    if ($Mode -eq 'monitor') {
        Write-Host '  OAO 服务器运行中 — 外网可访问本机 AI' -ForegroundColor Green
    } else {
        Write-Host '  Cloudflare Tunnel 运行中 — 请勿关闭本窗口' -ForegroundColor Green
    }
    Write-Host ' ============================================================' -ForegroundColor Green
    Write-Host "  外网: $($Cfg.github_pages_url)"
    Write-Host '  成功标志: 日志出现 Registered tunnel connection'
    Write-Host '  关闭本窗口 = 外网无法访问本机 AI'
    Write-Host ' ============================================================' -ForegroundColor Green
    Write-Host ''
}

function Start-TunnelMonitor {
    param($Cfg)
    Show-RunningBanner -Cfg $Cfg -Mode 'monitor'
    $failCount = 0
    while ($true) {
        Start-Sleep -Seconds 45
        $health = Test-RemoteTunnelReachable -WorkerUrl $Cfg.worker_url -TimeoutSec 12
        if ($health.ok) {
            $failCount = 0
            Write-Host ("  [{0}] Tunnel 正常" -f (Get-Date -Format 'HH:mm:ss')) -ForegroundColor DarkGreen
            continue
        }
        $failCount++
        Write-Host ("  [{0}] Tunnel 异常 ({1})，第 {2} 次检测失败" -f (Get-Date -Format 'HH:mm:ss'), $health.reason, $failCount) -ForegroundColor Yellow
        if ($failCount -ge 2) {
            Write-Host '  正在尝试重启 Tunnel…' -ForegroundColor Yellow
            return 'restart'
        }
    }
}

function Start-TunnelCore {
    param($Cfg, [string]$Token)
    $cf = Find-CloudflaredPath
    if (-not $cf) {
        Write-Host ''
        Write-Host '  (错误) 未找到 cloudflared' -ForegroundColor Red
        Write-Host '  安装: winget install Cloudflare.cloudflared'
        return $false
    }

    $tunnelState = Ensure-CloudflaredTunnelRunning -Root $Root -TokenFile $TokenFile -AutoRestartStale
    if ($tunnelState.action -eq 'ok') {
        $mode = Start-TunnelMonitor -Cfg $Cfg
        if ($mode -ne 'restart') { return $true }
        Stop-StaleCloudflared -Force | Out-Null
    } elseif ($tunnelState.action -eq 'stale') {
        Write-Host ''
        Write-Host '  cloudflared 在运行但 Tunnel 未连通，自动重启…' -ForegroundColor Yellow
        Stop-StaleCloudflared -Force | Out-Null
    }

    Write-Host ''
    Write-Host ' [5/5] 启动 Cloudflare Tunnel' -ForegroundColor Cyan
    Show-RunningBanner -Cfg $Cfg -Mode 'tunnel'
    & $cf tunnel run --token $Token --protocol http2
    Write-Host ''
    Write-Host ' Tunnel 已退出' -ForegroundColor Yellow
    return $true
}

function Invoke-CheckOnly {
    param($Cfg)
    Ensure-Ollama | Out-Null
    Ensure-AnythingLLM | Out-Null
    Test-NetworkForTunnel | Out-Null
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $CfDir 'check-remote-ai.ps1')
    Wait-BeforeExit 0
}

# --- 高级菜单（可选）---
if ($Menu) {
    & (Join-Path $Root 'scripts\oao-server.ps1')
    Wait-BeforeExit $LASTEXITCODE
}

# --- 主流程 ---
try {
    $cfg = Get-RemoteConfig
    Show-Banner $cfg

    if ($CheckOnly) {
        Invoke-CheckOnly -Cfg $cfg
    }

    Ensure-BackgroundServices
    Ensure-Ollama | Out-Null
    Ensure-SearXNGService | Out-Null
    Ensure-AnythingLLM | Out-Null
    Ensure-FirstTimeWorker
    Test-NetworkForTunnel | Out-Null

    $token = Ensure-TunnelToken
    if (-not $token) { Wait-BeforeExit 1 }

    while ($true) {
        $started = Start-TunnelCore -Cfg $cfg -Token $token
        if (-not $started) { Wait-BeforeExit 1 }
        Write-Host ''
        Write-Host ' 5 秒后自动重连 Tunnel…' -ForegroundColor Yellow
        Start-Sleep -Seconds 5
        Stop-StaleCloudflared -Force | Out-Null
    }
} catch {
    Write-Host ''
    Write-Host (' [错误] {0}' -f $_.Exception.Message) -ForegroundColor Red
    Write-Host $_.ScriptStackTrace
    Wait-BeforeExit 1
}
