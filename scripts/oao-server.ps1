# OAO 服务器主菜单 - 中文界面
param(
    [ValidateSet('', 'all', 'services', 'tunnel', 'build', 'worker', 'check', 'setup')]
    [string]$Action = ''
)

$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

$Root = Split-Path $PSScriptRoot -Parent
$Lib = Join-Path $Root 'scripts\lib.cmd'
$TokenFile = Join-Path $Root 'cloudflare\tunnel-token.txt'

function Show-Prereq {
    Write-Host ''
    cmd /c "call `"$Lib`" CheckOllamaPort" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host ' [提示] Ollama 11434 未响应 - 请运行 ollama serve' -ForegroundColor Yellow
    } else {
        Write-Host ' [正常] Ollama 11434' -ForegroundColor Green
    }
    cmd /c "call `"$Lib`" CheckAnythingLLMPort" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host ' [提示] AnythingLLM 3001 未响应 - 请打开 AnythingLLM 桌面版' -ForegroundColor Yellow
    } else {
        Write-Host ' [正常] AnythingLLM 3001' -ForegroundColor Green
    }
}

function Show-Menu {
    Write-Host ''
    Write-Host ' ============================================================' -ForegroundColor Cyan
    Write-Host '   OAO 服务器 - 外网远程访问本机 AI' -ForegroundColor Cyan
    Write-Host ' ============================================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  链路: 外网用户 -> Cloudflare Worker -> Tunnel -> 本机'
    Write-Host '  本机需运行: Ollama 端口 11434 + AnythingLLM 端口 3001'
    Write-Host ''
    Write-Host '  1 = 启动全部 - 后台服务 + Tunnel 推荐'
    Write-Host '  2 = 仅后台服务 - Ollama / 翻译 / 主页'
    Write-Host '  3 = 仅 Tunnel - 须保持本窗口打开'
    Write-Host '  4 = 构建翻译服务 端口 3011 可选'
    Write-Host '  5 = 部署 Worker（快速）'
    Write-Host '  6 = 检测远程 AI 连通性'
    Write-Host '  7 = 一键配置远程 Worker（首次必做）'
    Write-Host '  0 = 退出'
    Write-Host ''
    $c = Read-Host '请选择 1-7 或 0'
    switch ($c) {
        '1' { return 'all' }
        '2' { return 'services' }
        '3' { return 'tunnel' }
        '4' { return 'build' }
        '5' { return 'worker' }
        '6' { return 'check' }
        '7' { return 'setup' }
        '0' { return 'exit' }
        default { return 'menu' }
    }
}

function Start-Services {
    Write-Host ''
    Write-Host ' 正在启动 OAO 后台服务...'
    $svc = Join-Path $Root 'scripts\oao-services.ps1'
    Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$svc`"" -WindowStyle Minimized
    Start-Sleep -Seconds 3
    Write-Host ' 已启动后台服务窗口，可最小化但不要关闭。'
}

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $warp = "${env:ProgramFiles}\Cloudflare\Cloudflare WARP\cloudflared.exe"
    if (Test-Path $warp) { return $warp }
    return $null
}

function Start-Tunnel {
    Show-Prereq
    $cf = Find-Cloudflared
    if (-not $cf) {
        Write-Host ''
        Write-Host ' [错误] 未找到 cloudflared' -ForegroundColor Red
        Write-Host ' 安装: winget install Cloudflare.cloudflared'
        Read-Host '按回车退出'
        exit 1
    }
    if (-not (Test-Path $TokenFile)) {
        Write-Host ''
        Write-Host " [提示] 请先配置 Tunnel Token: $TokenFile" -ForegroundColor Yellow
        $example = Join-Path $Root 'cloudflare\tunnel-token.txt.example'
        if (Test-Path $example) { Copy-Item $example $TokenFile -Force }
        Start-Process notepad $TokenFile
        Read-Host '按回车退出'
        exit 1
    }
    $token = (Get-Content $TokenFile -Raw).Trim()
    if (-not $token) {
        Write-Host ' [错误] Token 为空' -ForegroundColor Red
        Read-Host '按回车退出'
        exit 1
    }

    . (Join-Path $PSScriptRoot 'tunnel-health.ps1')
    $cfg = Get-OaoRemoteConfig -Root $Root
    $tunnelState = Ensure-CloudflaredTunnelRunning -Root $Root -TokenFile $TokenFile -AutoRestartStale
    if ($tunnelState.action -eq 'ok') {
        Write-Host ''
        Write-Host ' [正常] 远程 Tunnel 已连通，外网可访问本机 AI' -ForegroundColor Green
        Write-Host " 页面: $($cfg.github_pages_url)"
        Read-Host '按回车关闭（无需重复启动 Tunnel）'
        return
    }
    if ($tunnelState.action -eq 'stale') {
        $ans = Read-Host ' cloudflared 在运行但 Tunnel 未连通。输入 Y 重启，或回车退出'
        if ($ans -match '^[Yy]') {
            Stop-StaleCloudflared -Force | Out-Null
        } else {
            return
        }
    }

    Write-Host ''
    Write-Host ' --- Tunnel 启动前 DNS 检测 ---' -ForegroundColor Cyan
    $xray = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.InterfaceAlias -match 'xray|v2ray|clash|sing-box' }
    if ($xray) {
        Write-Host ' [警告] 检测到 V2Ray/Xray TUN 网卡，可能导致 Tunnel DNS 失败' -ForegroundColor Yellow
        Write-Host ' 请先运行 OAO服务器.bat v2ray 按说明添加 Cloudflare 直连规则' -ForegroundColor Yellow
        Write-Host ' 或启动 Tunnel 前暂时关闭 V2Ray' -ForegroundColor Yellow
    }
    $dnsScript = Join-Path $Root 'cloudflare\check-dns.ps1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $dnsScript
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host ' [错误] DNS 无法解析 Cloudflare Tunnel 域名' -ForegroundColor Red
        Read-Host '按回车退出'
        exit 1
    }

    Write-Host ''
    Write-Host ' ========================================'
    Write-Host '  Cloudflare Tunnel 运行中'
    Write-Host '  请勿关闭本窗口'
    Write-Host ' ========================================'
    Write-Host '  成功标志: 日志出现 Registered tunnel connection'
    Write-Host '  若仍 Error 1033: 另开窗口选 6 检测'
    Write-Host ' ========================================'
    Write-Host ''
    & $cf tunnel run --token $token
    Write-Host ''
    Write-Host ' Tunnel 已退出'
    Read-Host '按回车关闭'
}

function Start-All {
    $unified = Join-Path $Root 'scripts\oao-remote-server.ps1'
    if (Test-Path $unified) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $unified
        return
    }
    Show-Prereq
    Write-Host ''
    Write-Host ' [1/2] 正在启动后台服务...'
    Start-Services
    Write-Host ' [2/2] 正在启动 Cloudflare Tunnel...'
    Write-Host ' [重要] 请保持本窗口打开，不要关闭' -ForegroundColor Yellow
    Write-Host ''
    Start-Tunnel
}

function Start-Check {
    Show-Prereq
    Write-Host ''
    Write-Host ' --- 远程 AI 连通性检测 ---' -ForegroundColor Cyan
    $script = Join-Path $Root 'cloudflare\check-remote-ai.ps1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $script
    Read-Host '按回车关闭'
}

function Start-Build {
    $td = Join-Path $Root 'oao-translate\server'
    if (-not (Test-Path (Join-Path $td 'package.json'))) {
        Write-Host ' [错误] 未找到 oao-translate\server' -ForegroundColor Red
        Read-Host '按回车退出'
        exit 1
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host ' [错误] 请先安装 Node.js LTS' -ForegroundColor Red
        Read-Host '按回车退出'
        exit 1
    }
    Write-Host ''
    Write-Host ' 正在构建 OAO 翻译服务 端口 3011'
    Push-Location $td
    npm install; if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
    npm run build; if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
    Pop-Location
    Write-Host ' 构建完成，请重新运行选项 1 或 2'
    Read-Host '按回车关闭'
}

function Start-Worker {
    $script = Join-Path $Root 'cloudflare\deploy-worker-quick.ps1'
    if (-not (Test-Path $script)) {
        Write-Host ' [错误] 未找到 cloudflare\deploy-worker-quick.ps1' -ForegroundColor Red
        Read-Host '按回车退出'
        exit 1
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $script
}

function Start-SetupRemote {
    $script = Join-Path $Root 'cloudflare\setup-remote-access.ps1'
    if (-not (Test-Path $script)) {
        Write-Host ' [错误] 未找到 setup-remote-access.ps1' -ForegroundColor Red
        Read-Host '按回车退出'
        exit 1
    }
    & powershell -NoProfile -ExecutionPolicy Bypass -File $script
}

# main
if (-not $Action) {
    do {
        $Action = Show-Menu
        if ($Action -eq 'menu') { continue }
        if ($Action -eq 'exit') { exit 0 }
        break
    } while ($true)
}

switch ($Action) {
    'all' { Start-All }
    'services' { Show-Prereq; Start-Services; Read-Host '按回车关闭' }
    'tunnel' { Start-Tunnel }
    'build' { Start-Build }
    'worker' { Start-Worker }
    'check' { Start-Check }
    'setup' { Start-SetupRemote }
    default { Write-Host '未知参数' -ForegroundColor Red; exit 1 }
}
