# OAO 服务器 — 一键启动：Docker + SearXNG + 本机 AI + Cloudflare Tunnel
# 双击 OAO服务器.bat 即可；外网通过 Worker -> Tunnel 访问本机 AnythingLLM / Ollama / SearXNG
param(
    [switch]$Menu,
    [switch]$CheckOnly,
    [switch]$SkipDnsCheck
)

# Windows PowerShell 5.1 + chcp 65001 会把中文打成「服服务务器器」。
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $utf8 = [Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
}
$ErrorActionPreference = 'Continue'

$Root = Split-Path $PSScriptRoot -Parent
foreach ($arg in $args) {
    switch ($arg.ToLower()) {
        'menu'  { $Menu = $true }
        'check' { $CheckOnly = $true }
        'v2ray' {
            $fix = Join-Path $Root 'cloudflare\v2ray-tunnel-fix.ps1'
            if (Test-Path $fix) { & $fix } else { Write-Host '  (错误) 未找到 v2ray-tunnel-fix.ps1' -ForegroundColor Red }
            exit 0
        }
    }
}
$CfDir = Join-Path $Root 'cloudflare'
$TokenFile = Join-Path $CfDir 'tunnel-token.txt'
$ConfigFile = Join-Path $CfDir 'remote-access.config.json'
$ReadyMarker = Join-Path $CfDir '.remote-ai-ready'
$ServicesScript = Join-Path $Root 'scripts\oao-services.ps1'

$Host.UI.RawUI.WindowTitle = 'OAO 服务器 — 外网访问本机 AI'

. (Join-Path $PSScriptRoot 'tunnel-health.ps1')
. (Join-Path $PSScriptRoot 'oao-ai-gateway.ps1')

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
    Write-Host '  OAO 服务器 · 远程本机 AI' -ForegroundColor Cyan
    Write-Host ' ============================================================' -ForegroundColor Cyan
    Write-Host "  页面  $($Cfg.github_pages_url)"
    Write-Host '  链路  浏览器 → Worker → Tunnel → 本机 AnythingLLM :3001'
    Write-Host '  本机  AnythingLLM :3001 · Ollama :11434 · SearXNG :8080'
    Write-Host '  关闭本窗口 = 外网无法使用本机 AI'
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
    Write-Host '  (启动) OAO 后台服务（Ollama / 翻译）…' -ForegroundColor Yellow
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ServicesScript`""
    ) -WindowStyle Minimized
    Start-Sleep -Seconds 3
    Write-Host '  (完成) 后台服务已启动（可最小化，勿关闭）' -ForegroundColor Green
}

function Start-SearXngBackground {
    Write-Host ''
    Write-Host ' [3/4] SearXNG 联网搜索 (:8080，后台)' -ForegroundColor Cyan
    $searxScript = Join-Path $PSScriptRoot 'searxng-start.ps1'
    if (-not (Test-Path $searxScript)) {
        Write-Host '  (跳过) 未找到 searxng-start.ps1' -ForegroundColor Yellow
        return
    }
    if (Test-LocalPort -Port 8080 -Path '/search?q=test&format=json') {
        Write-Host '  (正常) SearXNG 已在 :8080 运行' -ForegroundColor Green
        return
    }
    Write-Host '  (后台) 已在后台启动 SearXNG，AI 对话/知识库不会因此等待。' -ForegroundColor Yellow
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$searxScript`""
    ) -WindowStyle Hidden
}

function Ensure-SearXNGService {
    Write-Host ''
    Write-Host ' [3/4] Docker + SearXNG 联网搜索 (:8080)' -ForegroundColor Cyan
    $searxScript = Join-Path $PSScriptRoot 'searxng-start.ps1'
    if (-not (Test-Path $searxScript)) {
        Write-Host '  (跳过) 未找到 searxng-start.ps1' -ForegroundColor Yellow
        return $false
    }
    try {
        . $searxScript
        $ok = Ensure-SearXNG
        if (-not $ok) {
            Write-Host '  (提示) SearXNG 未就绪 — AI联网 将不可用或质量较差' -ForegroundColor Yellow
            Write-Host '         1) 确认 Docker Desktop 托盘为 Running' -ForegroundColor Yellow
            Write-Host '         2) 浏览器测试 http://127.0.0.1:8080/search?q=test&format=json' -ForegroundColor Yellow
            Write-Host '         3) 或配置 Serper Key: local-config.js → OAO_SERPER_API_KEY' -ForegroundColor Yellow
        }
        return $ok
    } catch {
        Write-Host "  (警告) SearXNG 启动异常: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host '         请确认 Docker Desktop 已运行后重新双击 OAO服务器.bat' -ForegroundColor Yellow
        return $false
    }
}

function Ensure-Ollama {
    Write-Host ''
    Write-Host ' [1/4] Ollama (:11434)' -ForegroundColor Cyan
    if (Test-HttpJsonService -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1) {
        Write-Host '  (正常) 已运行' -ForegroundColor Green
        return $true
    }
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Write-Host '  (提示) 未安装 Ollama — https://ollama.com' -ForegroundColor Yellow
        return $false
    }
    Write-Host '  (启动) ollama serve…' -ForegroundColor Yellow
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-HttpJsonService -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1) {
            Write-Host '  (正常) 已启动' -ForegroundColor Green
            return $true
        }
    }
    Write-Host '  (警告) 启动超时，Tunnel 仍继续' -ForegroundColor Yellow
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

function Wait-AnythingLLMReady {
    param([int]$Seconds = 15)
    $deadline = [datetime]::UtcNow.AddSeconds($Seconds)
    $n = 0
    while ([datetime]::UtcNow -lt $deadline) {
        $port = Get-AnythingLLMReadyPort
        if ($port) {
            Write-Host "  (正常) 已就绪 :$port" -ForegroundColor Green
            return $true
        }
        $n++
        if ($n -eq 1 -or ($n % 6 -eq 0)) {
            Write-Host '  (等待) 桌面版启动中…' -ForegroundColor DarkGray
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Ensure-AnythingLLM {
    Write-Host ''
    Write-Host ' [2/4] AnythingLLM 桌面版' -ForegroundColor Cyan
    $port = Get-AnythingLLMReadyPort
    if ($port) {
        Write-Host "  (正常) 已运行 :$port" -ForegroundColor Green
        return $true
    }

    $running = @(Get-Process -Name 'AnythingLLM' -ErrorAction SilentlyContinue)
    if ($running.Count -gt 0) {
        Write-Host '  (等待) 进程已在，探测 API…' -ForegroundColor DarkGray
        if (Wait-AnythingLLMReady -Seconds 12) { return $true }
        Write-Host '  (提示) 桌面版已打开但 :3001/:3002 未响应，跳过重复启动' -ForegroundColor Yellow
        return $false
    }

    if (Test-OaoAiGateway) {
        Write-Host '  (整理) 释放 :3001 上的本地网关，供桌面版使用' -ForegroundColor Yellow
        Stop-OaoAiGatewayProcess | Out-Null
    }

    $exe = Find-AnythingLLMExe
    if (-not $exe) {
        Write-Host '  (提示) 未找到 AnythingLLM，请先安装桌面版' -ForegroundColor Yellow
        return $false
    }

    Write-Host '  (启动) 打开桌面版…' -ForegroundColor Yellow
    Start-Process -FilePath $exe
    if (Wait-AnythingLLMReady -Seconds 20) { return $true }

    Write-Host '  (提示) API 尚未就绪；工作区请用 oaoeth / Query。Tunnel 照常启动。' -ForegroundColor Yellow
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
    Write-Host ' [配置] 首次运行 — Cloudflare Worker（仅一次）' -ForegroundColor Cyan
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
    $xray = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.InterfaceAlias -match 'xray|v2ray|clash|sing-box' }
    if ($xray) {
        Write-Host '  (提示) 检测到代理适配器，若 Tunnel 失败可暂时关闭 V2Ray' -ForegroundColor DarkGray
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

function Test-XrayTunActive {
    $adapter = Get-NetAdapter -Name 'xray_tun' -ErrorAction SilentlyContinue
    return $null -ne $adapter -and $adapter.Status -eq 'Up'
}

function Suspend-XrayTunForTunnel {
    if (-not (Test-XrayTunActive)) { return $false }
    Write-Host ''
    Write-Host '  [Tunnel 兼容] 检测到 xray_tun 正在运行，会拦截 Cloudflare Tunnel DNS。' -ForegroundColor Yellow
    try {
        Disable-NetAdapter -Name 'xray_tun' -Confirm:$false -ErrorAction Stop | Out-Null
        Write-Host '  [Tunnel 兼容] 已临时关闭 xray_tun；OAO服务器退出后会自动恢复。' -ForegroundColor Green
        return $true
    } catch {
        Write-Host '  [Tunnel 兼容] 自动关闭 xray_tun 失败（可能缺少管理员权限）。' -ForegroundColor Red
        Write-Host '  请先右键「OAO服务器.bat」选择“以管理员身份运行”，或暂时退出 V2Ray/Xray。' -ForegroundColor Yellow
        return $false
    }
}

function Restore-XrayTun {
    if ($global:OAO_XRAY_WAS_DISABLED) {
        try {
            Enable-NetAdapter -Name 'xray_tun' -Confirm:$false -ErrorAction Stop | Out-Null
            Write-Host '  [Tunnel 兼容] xray_tun 已恢复。' -ForegroundColor Green
        } catch {
            Write-Host '  [Tunnel 兼容] 请手动重新启用 xray_tun。' -ForegroundColor Yellow
        }
        $global:OAO_XRAY_WAS_DISABLED = $false
    }
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
    Write-Host ' [4/4] 启动 Cloudflare Tunnel' -ForegroundColor Cyan
    Show-RunningBanner -Cfg $Cfg -Mode 'tunnel'

    $global:OAO_XRAY_WAS_DISABLED = $false
    if (Test-XrayTunActive) {
        if (Suspend-XrayTunForTunnel) {
            $global:OAO_XRAY_WAS_DISABLED = $true
        } else {
            Write-Host '  [重要] 当前 Tunnel 无法在 xray_tun 运行时连接。' -ForegroundColor Red
            Write-Host '  请右键「OAO服务器.bat」选择“以管理员身份运行”，或暂时退出 V2Ray/Xray 后重试。' -ForegroundColor Yellow
            return $false
        }
    }

    try {
        & $cf tunnel run --token $Token --protocol http2
    } finally {
        Restore-XrayTun
    }
    Write-Host ''
    Write-Host ' Tunnel 已退出' -ForegroundColor Yellow
    return $true
}

function Invoke-CheckOnly {
    param($Cfg)
    Ensure-Ollama | Out-Null
    Ensure-AnythingLLM | Out-Null
    Ensure-OaoAiGateway | Out-Null
    Ensure-SearXNGService | Out-Null
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

    Ensure-Ollama | Out-Null
    Ensure-AnythingLLM | Out-Null
    Ensure-OaoAiGateway | Out-Null
    Ensure-BackgroundServices
    Start-SearXngBackground
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
