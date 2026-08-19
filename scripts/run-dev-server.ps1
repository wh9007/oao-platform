# Used when a hidden helper must start the static server.
$Root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
$server = Join-Path $Root 'scripts\dev-server.js'
if (-not $env:HTTP_PROXY -and -not $env:HTTPS_PROXY) {
    foreach ($p in @(10808, 7890)) {
        $hit = netstat -ano 2>$null | Select-String (':' + $p) | Select-String 'LISTENING'
        if ($hit) {
            $env:HTTP_PROXY = "http://127.0.0.1:$p"
            $env:HTTPS_PROXY = $env:HTTP_PROXY
            break
        }
    }
}
$env:NODE_USE_ENV_PROXY = '1'
if (-not $env:NO_PROXY) { $env:NO_PROXY = 'localhost,127.0.0.1,::1' }
& $node $server
