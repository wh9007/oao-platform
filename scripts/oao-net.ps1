# Shared network helpers for OAO local launchers (ASCII-only)
function Test-OaoLocalListen {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) { return $true }
    } catch {}
    $hit = netstat -ano 2>$null | Select-String (':' + $Port) | Select-String 'LISTENING'
    return [bool]$hit
}

function Get-OaoNavProxy {
    foreach ($name in @('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'User') }
        if ($value) { return $value.Trim() }
    }
    try {
        $settings = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
        if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
            $raw = [string]$settings.ProxyServer
            if ($raw -match 'https?=') {
                $httpsPart = ($raw -split ';' | Where-Object { $_ -match '^https=' } | Select-Object -First 1)
                $httpPart = ($raw -split ';' | Where-Object { $_ -match '^http=' } | Select-Object -First 1)
                $raw = if ($httpsPart) { $httpsPart -replace '^https=', '' } elseif ($httpPart) { $httpPart -replace '^http=', '' } else { $raw }
            }
            if ($raw -and $raw -notmatch '^https?://' -and $raw -notmatch '^socks') { $raw = 'http://' + $raw }
            if ($raw) { return $raw.Trim() }
        }
    } catch {}
    foreach ($port in @(10808, 10809, 7890, 7891, 7897, 20171, 1080)) {
        if (Test-OaoLocalListen -Port $port) { return ('http://127.0.0.1:' + $port) }
    }
    return ''
}

function Set-OaoNavProxyEnv {
    $proxy = Get-OaoNavProxy
    if ($proxy) {
        $env:HTTP_PROXY = $proxy
        $env:HTTPS_PROXY = $proxy
        $env:ALL_PROXY = $proxy
    }
    $env:NODE_USE_ENV_PROXY = '1'
    if (-not $env:NO_PROXY) { $env:NO_PROXY = 'localhost,127.0.0.1,::1' }
    return $proxy
}

function Stop-OaoListenPort {
    param([int]$Port)
    $procIds = @()
    try {
        $procIds = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {}
    if (-not $procIds.Count) {
        netstat -ano 2>$null | Select-String (':' + $Port) | Select-String 'LISTENING' | ForEach-Object {
            if ($_.Line -match '\s(\d+)\s*$') { $procIds += [int]$Matches[1] }
        }
        $procIds = @($procIds | Select-Object -Unique)
    }
    $failed = @()
    foreach ($procId in $procIds) {
        if ($procId -le 4) { continue }
        $stopped = $false
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            $stopped = $true
        } catch {}
        if (-not $stopped) {
            cmd.exe /c "taskkill /F /PID $procId" | Out-Null
            Start-Sleep -Milliseconds 250
            try {
                Get-Process -Id $procId -ErrorAction Stop | Out-Null
                $failed += $procId
            } catch {
                $stopped = $true
            }
        }
    }
    Start-Sleep -Milliseconds 400
    return [pscustomobject]@{
        Port = $Port
        Attempted = $procIds
        Failed = $failed
        StillListening = (Test-OaoLocalListen -Port $Port)
    }
}

function Test-OaoHttpOk {
    param(
        [string]$Uri,
        [string]$MustMatch = '',
        [int]$TimeoutSec = 3
    )
    try {
        $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $TimeoutSec
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) { return $false }
        if ($MustMatch -and $response.Content -notmatch $MustMatch) { return $false }
        return $true
    } catch {
        return $false
    }
}

function Test-OaoNavSites {
    param(
        [string]$Base = 'http://127.0.0.1:8777',
        [int]$TimeoutSec = 12
    )
    $out = Join-Path $env:TEMP 'oao-nav-sites-check.csv'
    $code = 0
    try {
        $line = & curl.exe -sS --max-time $TimeoutSec -o $out -w '%{http_code}' ($Base.TrimEnd('/') + '/nav-sites') 2>$null
        if ($line -match '(\d{3})$') { $code = [int]$Matches[1] }
    } catch {
        return [pscustomobject]@{ Ok = $false; Rows = 0; Status = 0; Detail = 'curl failed' }
    }
    if ($code -ne 200 -or -not (Test-Path -LiteralPath $out)) {
        $detail = ''
        if (Test-Path -LiteralPath $out) { $detail = (Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue) }
        return [pscustomobject]@{ Ok = $false; Rows = 0; Status = $code; Detail = $detail }
    }
    $text = Get-Content -LiteralPath $out -Raw -ErrorAction SilentlyContinue
    if (-not $text -or $text -match 'nav_sheet_unreachable' -or $text -match '^\s*<' -or $text -match '^\s*\{') {
        return [pscustomobject]@{ Ok = $false; Rows = 0; Status = $code; Detail = $text }
    }
    $rows = @(Get-Content -LiteralPath $out | Where-Object { $_.Trim() -ne '' })
    $count = [Math]::Max(0, $rows.Count - 1)
    return [pscustomobject]@{ Ok = ($count -gt 0); Rows = $count; Status = $code; Detail = '' }
}
