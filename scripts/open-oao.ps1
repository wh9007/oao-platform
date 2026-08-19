# OAO 本地测试：本窗口即页面服务，关闭窗口即停止。
$Root = Split-Path $PSScriptRoot -Parent
$Host.UI.RawUI.WindowTitle = 'OAO 本地测试'

if (-not (Test-Path -LiteralPath (Join-Path $Root 'OAO.html'))) {
    Write-Host ' [错误] 未找到 OAO.html'
    Write-Host " 目录: $Root"
    Read-Host '按回车退出'
    exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ' [错误] 未找到 Node.js，请安装 LTS：https://nodejs.org'
    Read-Host '按回车退出'
    exit 1
}

function Test-Listen([int]$Port) {
    return [bool](netstat -ano 2>$null | Select-String (':' + $Port) | Select-String 'LISTENING')
}

function Find-AnythingLLMUrl {
    $ports = New-Object System.Collections.Generic.List[int]
    foreach ($p in 3001, 3002) { $ports.Add($p) }
    netstat -ano 2>$null | Select-String 'LISTENING' | ForEach-Object {
        if ($_.Line -match '127\.0\.0\.1:(\d+)') {
            $n = [int]$Matches[1]
            if ($n -ge 3000 -and $n -ne 3001 -and $n -ne 8888 -and $n -ne 8777 -and $n -ne 8779 -and $n -ne 11434) {
                $ports.Add($n)
            }
        }
    }
    foreach ($port in $ports) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/ping" -UseBasicParsing -TimeoutSec 1
            if ($r.StatusCode -eq 200 -and $r.Content -match 'online') {
                return "http://127.0.0.1:$port"
            }
        } catch {}
    }
    return ''
}

$port = 8777
if (Test-Listen 8777) {
    if (Test-Listen 8779) {
        Write-Host ' [错误] 8777 与 8779 都被占用。请先关掉旧的 OAO 窗口。'
        Read-Host '按回车退出'
        exit 1
    }
    $port = 8779
    Write-Host ' [提示] 8777 被旧进程占用，改用 8779。请用下面打印的地址打开。'
}

if (-not $env:HTTP_PROXY -and -not $env:HTTPS_PROXY) {
    foreach ($p in @(10808, 7890)) {
        if (Test-Listen $p) {
            $env:HTTP_PROXY = "http://127.0.0.1:$p"
            $env:HTTPS_PROXY = $env:HTTP_PROXY
            break
        }
    }
}
$env:OAO_DEV_PORT = "$port"
$env:OAO_DEV_HOST = '127.0.0.1'
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
$env:NODE_USE_ENV_PROXY = '1'

$allm = Find-AnythingLLMUrl
$aiJson = Join-Path $Root 'local-ai.json'
$payload = @{
    anythingllm = $allm
    ollama = 'http://127.0.0.1:11434'
} | ConvertTo-Json -Compress
Set-Content -LiteralPath $aiJson -Value $payload -Encoding UTF8

$url = "http://127.0.0.1:$port/OAO.html"
Write-Host ''
Write-Host ' ============================================================'
Write-Host '   OAO 本地测试'
Write-Host ' ============================================================'
Write-Host " 页面: $url"
if ($env:HTTP_PROXY) {
    Write-Host " 代理: $($env:HTTP_PROXY) （Web3 导航将走此代理）"
} else {
    Write-Host ' 代理: 未检测到。Web3 导航需要 Clash/v2ray 混合端口（如 10808）'
}

try {
    $null = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 2
    Write-Host ' Ollama: 已就绪（:11434）'
} catch {
    Write-Host ' Ollama: 未运行'
}

if ($allm) {
    Write-Host " 知识库: 已就绪（$allm / 工作区 oaoeth）"
} else {
    Write-Host ' 知识库: 未检测到 AnythingLLM。若桌面版已打开，请关掉占用 3001 的 OAO 网关后再开 AnythingLLM。'
}

Write-Host ''
Write-Host ' 正在启动页面服务（关闭本窗口即停止）...'
Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-Command', "Start-Sleep -Seconds 2; Start-Process '$url'"
)

$server = Join-Path $Root 'scripts\dev-server.js'
& node $server
exit $LASTEXITCODE
