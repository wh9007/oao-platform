# OAO 远程 Tunnel 连通性检测（供 remote-ai-start / oao-server 共用）
param()

function Get-OaoRemoteConfig {
    param([string]$Root)
    $CfDir = Join-Path $Root 'cloudflare'
    $ConfigFile = Join-Path $CfDir 'remote-access.config.json'
    if (-not (Test-Path $ConfigFile)) {
        return [pscustomobject]@{
            worker_url = 'https://oao-ai.wh529007.workers.dev'
            llm_tunnel_hostname = 'llm.wh9007.dpdns.org'
            ollama_tunnel_hostname = 'ollama.wh9007.dpdns.org'
        }
    }
    return Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Test-RemoteTunnelReachable {
    param(
        [string]$WorkerUrl = 'https://oao-ai.wh529007.workers.dev',
        [int]$TimeoutSec = 15
    )
    $urls = @(
        "$WorkerUrl/api/ping",
        "https://llm.wh9007.dpdns.org/api/ping"
    )
    foreach ($url in $urls) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $TimeoutSec
            $body = [string]$r.Content
            if ($body -match 'Error 1033|Cloudflare Tunnel error|upstream_unreachable') {
                return @{ ok = $false; url = $url; reason = 'tunnel_offline'; status = $r.StatusCode }
            }
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
                return @{ ok = $true; url = $url; status = $r.StatusCode }
            }
            return @{ ok = $false; url = $url; reason = "http_$($r.StatusCode)"; status = $r.StatusCode }
        } catch {
            $msg = $_.Exception.Message
            if ($_.Exception.Response) {
                try {
                    $code = [int]$_.Exception.Response.StatusCode
                    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                    $body = $reader.ReadToEnd()
                    $reader.Close()
                    if ($body -match 'Error 1033|Cloudflare Tunnel error|upstream_unreachable') {
                        return @{ ok = $false; url = $url; reason = 'tunnel_offline'; status = $code }
                    }
                    return @{ ok = $false; url = $url; reason = "http_$code"; status = $code; detail = $msg }
                } catch {
                    return @{ ok = $false; url = $url; reason = $msg }
                }
            }
            if ($msg -match '1033|530|Tunnel') {
                return @{ ok = $false; url = $url; reason = 'tunnel_offline'; detail = $msg }
            }
        }
    }
    return @{ ok = $false; reason = 'unreachable' }
}

function Stop-StaleCloudflared {
    param([switch]$Force)
    $procs = @(Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { return 0 }
    if (-not $Force) { return $procs.Count }
    foreach ($p in $procs) {
        Write-Host "  (重启) 结束旧 cloudflared PID=$($p.Id)" -ForegroundColor Yellow
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    return 0
}

function Ensure-CloudflaredTunnelRunning {
    param(
        [string]$Root,
        [string]$TokenFile,
        [switch]$AutoRestartStale
    )
    $cfg = Get-OaoRemoteConfig -Root $Root
    $health = Test-RemoteTunnelReachable -WorkerUrl $cfg.worker_url
    if ($health.ok) {
        $running = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
        if ($running) {
            Write-Host "  (正常) Tunnel 已连通，cloudflared PID=$($running[0].Id)" -ForegroundColor Green
        } else {
            Write-Host '  (正常) Tunnel 外网可达（cloudflared 可能在其他会话运行）' -ForegroundColor Green
        }
        return @{ action = 'ok'; health = $health }
    }

    $running = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
    if ($running -and $AutoRestartStale) {
        Write-Host '  (警告) cloudflared 进程存在但 Tunnel 未连通（Error 1033）' -ForegroundColor Yellow
        Write-Host '         正在结束旧进程并重新启动…' -ForegroundColor Yellow
        Stop-StaleCloudflared -Force | Out-Null
        return @{ action = 'restart'; health = $health }
    }
    if ($running) {
        Write-Host "  (警告) cloudflared PID=$($running[0].Id) 在运行，但外网仍 Error 1033" -ForegroundColor Yellow
        Write-Host '         请关闭旧 Tunnel 窗口后重新选 [1]，或输入 Y 自动重启' -ForegroundColor Yellow
        return @{ action = 'stale'; health = $health; pid = $running[0].Id }
    }
    return @{ action = 'start'; health = $health }
}
