# OAO 本地服务器启动器：由 open-oao.ps1 / oao-services.ps1 以隐藏窗口启动
$Root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
$server = Join-Path $Root 'scripts\dev-server.js'

if (-not $env:HTTPS_PROXY -and -not $env:HTTP_PROXY) {
    try {
        $settings = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
        if ($settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
            $raw = [string]$settings.ProxyServer
            if ($raw -match 'https?=') {
                $httpsPart = ($raw -split ';' | Where-Object { $_ -match '^https=' } | Select-Object -First 1)
                $httpPart = ($raw -split ';' | Where-Object { $_ -match '^http=' } | Select-Object -First 1)
                $raw = if ($httpsPart) { $httpsPart -replace '^https=', '' } elseif ($httpPart) { $httpPart -replace '^http=', '' } else { $raw }
            }
            if ($raw -and $raw -notmatch '^https?://') { $raw = 'http://' + $raw }
            if ($raw) {
                $env:HTTP_PROXY = $raw
                $env:HTTPS_PROXY = $raw
            }
        }
    } catch {}
}
$env:NODE_USE_ENV_PROXY = '1'
if (-not $env:NO_PROXY) { $env:NO_PROXY = 'localhost,127.0.0.1,::1' }

& $node $server
