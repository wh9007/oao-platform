# OAO 本地 AI 统一网关 — 启动 / 迁移 AnythingLLM 端口
param(
    [ValidateSet('', 'ensure', 'migrate', 'start', 'status')]
    [string]$Action = '',
    [switch]$NoPause
)

# Windows PowerShell 5.1 + chcp 65001 会把中文打成「服服务务器器」。
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $utf8 = [Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
}
$ErrorActionPreference = 'Continue'

$Root = Split-Path $PSScriptRoot -Parent
$GatewayJs = Join-Path $PSScriptRoot 'oao-ai-gateway.js'
$GatewayPort = 3001
$AnythingLLMPort = 3002

function Find-AnythingLLMStorageEnv {
    $candidates = @(
        (Join-Path $env:APPDATA 'anythingllm-desktop\storage\.env'),
        (Join-Path $env:APPDATA 'AnythingLLM\storage\.env'),
        (Join-Path $env:APPDATA 'anythingllm\storage\.env'),
        (Join-Path $env:USERPROFILE '.anythingllm\storage\.env')
    )
    foreach ($path in $candidates) {
        if (Test-Path -LiteralPath $path) { return $path }
    }
    return $null
}

function Test-HttpJsonService {
    param(
        [string]$Uri,
        [string]$MustMatch = '',
        [int]$TimeoutSec = 3
    )
    try {
        $r = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $TimeoutSec
        if ($r.StatusCode -lt 200 -or $r.StatusCode -ge 300) { return $false }
        if ($MustMatch -and $r.Content -notmatch $MustMatch) { return $false }
        return $true
    } catch {
        return $false
    }
}

function Test-OaoAiGateway {
    return Test-HttpJsonService -Uri "http://127.0.0.1:${GatewayPort}/health" -MustMatch 'oao-ai-gateway'
}

function Test-AnythingLLMOnPort {
    param(
        [int]$Port,
        [int]$TimeoutSec = 2
    )
    return Test-HttpJsonService -Uri "http://127.0.0.1:${Port}/api/ping" -MustMatch 'online' -TimeoutSec $TimeoutSec
}

function Get-AnythingLLMReadyPort {
    foreach ($port in @($GatewayPort, $AnythingLLMPort)) {
        if (Test-AnythingLLMOnPort -Port $port -TimeoutSec 1) { return $port }
    }
    return 0
}

function Stop-OaoAiGatewayProcess {
    $killed = 0
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'oao-ai-gateway\.js' } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            $killed++
        }
    if ($killed -gt 0) {
        Start-Sleep -Milliseconds 400
        return $true
    }
    return $false
}

function Test-HttpPort {
    param(
        [int]$Port,
        [string]$Path = '/',
        [int]$TimeoutSec = 3
    )
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:${Port}${Path}" -UseBasicParsing -TimeoutSec $TimeoutSec
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function Get-PortOwner {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $conn) { return $null }
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
        return [pscustomobject]@{
            Pid = $conn.OwningProcess
            Name = $proc.Name
            CommandLine = $proc.CommandLine
        }
    } catch {
        return $null
    }
}

function Stop-AnythingLLMProcesses {
    $procs = @(Get-Process -Name 'AnythingLLM' -ErrorAction SilentlyContinue)
    foreach ($p in $procs) {
        Write-Host "  (迁移) 关闭旧 AnythingLLM PID=$($p.Id)" -ForegroundColor Yellow
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    if ($procs.Count -gt 0) { Start-Sleep -Seconds 3 }
}

function Migrate-AnythingLLMPort {
    # AnythingLLM 桌面版会占用 3001，且忽略 .env 里的 SERVER_PORT=3002。
    # 不要根据 .env 误报 3002，更不要每次启动都杀进程。
    if (Test-AnythingLLMOnPort -Port $GatewayPort) {
        Write-Host '  (正常) AnythingLLM 桌面版运行在 :3001' -ForegroundColor Green
        return $false
    }
    if (Test-AnythingLLMOnPort -Port $AnythingLLMPort) {
        Write-Host '  (正常) AnythingLLM 运行在 :3002' -ForegroundColor Green
        return $true
    }
    Write-Host '  (提示) 未检测到 AnythingLLM API，请打开桌面版' -ForegroundColor Yellow
    return $false
}

function Start-OaoAiGateway {
    if (-not (Test-Path -LiteralPath $GatewayJs)) {
        Write-Host '  (错误) 未找到 scripts\oao-ai-gateway.js' -ForegroundColor Red
        return $false
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host '  (错误) 未检测到 Node.js，无法启动本地 AI 网关' -ForegroundColor Red
        return $false
    }

    if (Test-OaoAiGateway) {
        Write-Host '  (正常) OAO 本地 AI 网关已运行 (:3001)' -ForegroundColor Green
        return $true
    }

    if (Test-AnythingLLMOnPort -Port $GatewayPort) {
        Write-Host '  (提示) AnythingLLM 桌面版占用 3001，本地不抢该端口' -ForegroundColor Yellow
        Write-Host '         前端将直连 Ollama :11434 与 AnythingLLM :3001' -ForegroundColor DarkGray
        return $false
    }

    $owner = Get-PortOwner -Port $GatewayPort
    if ($owner -and $owner.Name -match 'AnythingLLM') {
        Write-Host '  (提示) 端口 3001 仍由 AnythingLLM 占用，跳过网关启动' -ForegroundColor Yellow
        return $false
    }

    if ($owner -and $owner.CommandLine -notmatch 'oao-ai-gateway\.js') {
        Write-Host "  (警告) 端口 3001 被 $($owner.Name) 占用，无法启动网关" -ForegroundColor Yellow
        return $false
    }

    Write-Host '  (启动) 正在启动 OAO 本地 AI 网关…' -ForegroundColor Yellow
    $log = Join-Path $Root 'oao-services.log'
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    $cmd = "/c `"`"$node`" `"$GatewayJs`" >> `"$log`" 2>&1`""
    Start-Process -FilePath 'cmd.exe' -ArgumentList $cmd -WorkingDirectory $Root -WindowStyle Hidden

    for ($i = 1; $i -le 10; $i++) {
        Start-Sleep -Milliseconds 600
        if (Test-OaoAiGateway) {
            Write-Host '  (正常) OAO 本地 AI 网关已启动 (:3001)' -ForegroundColor Green
            return $true
        }
    }

    Write-Host '  (警告) OAO 本地 AI 网关启动超时，请查看 oao-services.log' -ForegroundColor Yellow
    return $false
}

function Ensure-OaoAiGateway {
    if (Test-AnythingLLMOnPort -Port $GatewayPort -TimeoutSec 1) {
        Write-Host '  (正常) AnythingLLM :3001 直连，无需本地网关' -ForegroundColor Green
        return $true
    }
    if (Test-AnythingLLMOnPort -Port $AnythingLLMPort -TimeoutSec 1) {
        return Start-OaoAiGateway
    }
    if (Test-OaoAiGateway) {
        Write-Host '  (提示) :3001 当前是 OAO 网关，AnythingLLM 桌面版未在线' -ForegroundColor Yellow
        return $false
    }
    Write-Host '  (跳过) AnythingLLM 未在线，不抢占 :3001' -ForegroundColor DarkGray
    return $false
}

function Show-OaoAiGatewayStatus {
    Write-Host ''
    Write-Host '--- OAO 本地 AI 统一网关 ---' -ForegroundColor Cyan
    Write-Host ' 网关      http://127.0.0.1:3001/health'
    Write-Host ' AnythingLLM http://127.0.0.1:3002/api/ping'
    Write-Host ' Ollama     http://127.0.0.1:11434/api/tags'
    Write-Host ' SearXNG    http://127.0.0.1:8080/search?q=test&format=json'
    Write-Host ''
    Write-Host ('  网关: ' + $(if (Test-OaoAiGateway) { 'OK' } else { '未运行' }))
    Write-Host ('  AnythingLLM: ' + $(if ((Test-AnythingLLMOnPort -Port $AnythingLLMPort) -or (Test-AnythingLLMOnPort -Port $GatewayPort)) { 'OK' } else { '未运行' }))
    Write-Host ('  Ollama: ' + $(if (Test-HttpPort -Port 11434 -Path '/api/tags') { 'OK' } else { '未运行' }))
    Write-Host ('  SearXNG: ' + $(if (Test-HttpPort -Port 8080 -Path '/search?q=test&format=json') { 'OK' } else { '未运行' }))
}

if ($MyInvocation.InvocationName -eq '.') { return }

switch ($Action) {
    'migrate' { Migrate-AnythingLLMPort | Out-Null; if (-not $NoPause) { Read-Host '按回车关闭' } }
    'start'   { Start-OaoAiGateway | Out-Null; if (-not $NoPause) { Read-Host '按回车关闭' } }
    'status'  { Show-OaoAiGatewayStatus; if (-not $NoPause) { Read-Host '按回车关闭' } }
    default   { Ensure-OaoAiGateway | Out-Null; if (-not $NoPause) { Read-Host '按回车关闭' } }
}
