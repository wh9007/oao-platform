# OAO 本地 AI 统一网关 — 启动 / 迁移 AnythingLLM 端口
param(
    [ValidateSet('', 'ensure', 'migrate', 'start', 'status')]
    [string]$Action = '',
    [switch]$NoPause
)

$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
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
    $envFile = Find-AnythingLLMStorageEnv
    if (-not $envFile) {
        Write-Host '  (提示) 未找到 AnythingLLM storage/.env，跳过端口迁移' -ForegroundColor Yellow
        return $true
    }

    $content = Get-Content -LiteralPath $envFile -Raw -Encoding UTF8
    if ($content -notmatch '(?m)^SERVER_PORT\s*=') {
        Write-Host '  (提示) AnythingLLM .env 无 SERVER_PORT，无需迁移' -ForegroundColor DarkGray
        return $true
    }

    if ($content -match '(?m)^SERVER_PORT\s*=\s*["'']?3002["'']?\s*$') {
        Write-Host '  (正常) AnythingLLM 已运行在端口 3002' -ForegroundColor Green
        return $true
    }

    $backup = "$envFile.oaobak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $envFile -Destination $backup -Force
    $updated = [regex]::Replace($content, '(?m)^SERVER_PORT\s*=\s*["'']?3001["'']?\s*$', "SERVER_PORT='$AnythingLLMPort'")
    [IO.File]::WriteAllText($envFile, $updated, [Text.UTF8Encoding]::new($false))
    Write-Host '  (迁移) 已将 AnythingLLM SERVER_PORT 从 3001 改为 3002' -ForegroundColor Yellow
    Write-Host "  (备份) $backup" -ForegroundColor DarkGray
    Stop-AnythingLLMProcesses
    return $true
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

    if (Test-HttpPort -Port $GatewayPort -Path '/health') {
        Write-Host '  (正常) OAO 本地 AI 网关已运行 (:3001)' -ForegroundColor Green
        return $true
    }

    $owner = Get-PortOwner -Port $GatewayPort
    if ($owner -and $owner.CommandLine -notmatch 'oao-ai-gateway\.js') {
        Write-Host '  (提示) 端口 3001 被旧 AnythingLLM 占用，正在迁移…' -ForegroundColor Yellow
        Migrate-AnythingLLMPort | Out-Null
        Stop-AnythingLLMProcesses
    }

    Write-Host '  (启动) 正在启动 OAO 本地 AI 网关…' -ForegroundColor Yellow
    $log = Join-Path $Root 'oao-services.log'
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    $cmd = "/c `"`"$node`" `"$GatewayJs`" >> `"$log`" 2>&1`""
    Start-Process -FilePath 'cmd.exe' -ArgumentList $cmd -WorkingDirectory $Root -WindowStyle Hidden

    for ($i = 1; $i -le 10; $i++) {
        Start-Sleep -Milliseconds 600
        if (Test-HttpPort -Port $GatewayPort -Path '/health') {
            Write-Host '  (正常) OAO 本地 AI 网关已启动 (:3001)' -ForegroundColor Green
            return $true
        }
    }

    Write-Host '  (警告) OAO 本地 AI 网关启动超时，请查看 oao-services.log' -ForegroundColor Yellow
    return $false
}

function Ensure-OaoAiGateway {
    Migrate-AnythingLLMPort | Out-Null
    return Start-OaoAiGateway
}

function Show-OaoAiGatewayStatus {
    Write-Host ''
    Write-Host '--- OAO 本地 AI 统一网关 ---' -ForegroundColor Cyan
    Write-Host ' 网关      http://127.0.0.1:3001/health'
    Write-Host ' AnythingLLM http://127.0.0.1:3002/api/ping'
    Write-Host ' Ollama     http://127.0.0.1:11434/api/tags'
    Write-Host ' SearXNG    http://127.0.0.1:8080/search?q=test&format=json'
    Write-Host ''
    Write-Host ('  网关: ' + $(if (Test-HttpPort -Port $GatewayPort -Path '/health') { 'OK' } else { '未运行' }))
    Write-Host ('  AnythingLLM: ' + $(if (Test-HttpPort -Port $AnythingLLMPort -Path '/api/ping') { 'OK' } else { '未运行' }))
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
