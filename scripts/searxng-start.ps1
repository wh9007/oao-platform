# SearXNG 本地搜索服务 — 端口 8080（AI联网 / Tunnel search.*）
# 首次运行需拉取 Docker 镜像，可能需 2~5 分钟，请耐心等待

$Root = Split-Path -Parent $PSScriptRoot
$SearxDir = Join-Path $Root 'searxng'
$ComposeFile = Join-Path $SearxDir 'docker-compose.yml'

function Test-PortListening([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        return [bool]$conn
    } catch {
        return $false
    }
}

function Test-SearXNGHealth {
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/search?q=test&format=json' -UseBasicParsing -TimeoutSec 10
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Test-DockerDaemon {
    try {
        & docker info 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

function Invoke-DockerCompose {
    param(
        [string[]]$Args
    )
    Push-Location $SearxDir
    try {
        $prev = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & docker compose @Args 2>&1 | ForEach-Object { Write-Host $_ }
        $code = $LASTEXITCODE
        $ErrorActionPreference = $prev
        return $code
    } finally {
        Pop-Location
    }
}

function Ensure-SearXNG {
    if (-not (Test-Path $ComposeFile)) {
        Write-Host '[SearXNG] 未找到 searxng/docker-compose.yml，跳过' -ForegroundColor Yellow
        return $false
    }

    if (Test-SearXNGHealth) {
        Write-Host '[SearXNG] 已在 :8080 运行' -ForegroundColor Green
        return $true
    }

    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        Write-Host '[SearXNG] 未安装 Docker Desktop — AI联网将不可用或质量较差' -ForegroundColor Yellow
        Write-Host '         安装: https://www.docker.com/products/docker-desktop/' -ForegroundColor Yellow
        Write-Host '         或配置 local-config.js 中的 OAO_SERPER_API_KEY 作为云端搜索备用' -ForegroundColor Yellow
        return $false
    }

    if (-not (Test-DockerDaemon)) {
        Write-Host '[SearXNG] Docker Desktop 未运行，请先打开 Docker Desktop 再重试' -ForegroundColor Yellow
        Write-Host '         也可双击 searxng\启动SearXNG.bat 单独启动' -ForegroundColor Yellow
        return $false
    }

    Write-Host '[SearXNG] 正在拉取/启动容器 (8080)，首次约 2~5 分钟…' -ForegroundColor Cyan

    $pullCode = Invoke-DockerCompose -Args @('pull')
    if ($pullCode -ne 0) {
        Write-Host '[SearXNG] 镜像拉取失败 — 检查网络/代理，或手动: cd searxng && docker compose pull' -ForegroundColor Yellow
    }

    $upCode = Invoke-DockerCompose -Args @('up', '-d')
    if ($upCode -ne 0) {
        Write-Host '[SearXNG] 容器启动失败 — 运行 docker logs oao-searxng 查看详情' -ForegroundColor Yellow
        return $false
    }

    for ($i = 1; $i -le 24; $i++) {
        Start-Sleep -Seconds 5
        if (Test-SearXNGHealth) {
            Write-Host '[SearXNG] 启动成功 http://127.0.0.1:8080' -ForegroundColor Green
            return $true
        }
        if ($i % 4 -eq 0) {
            Write-Host "[SearXNG] 等待就绪… ($($i * 5)s)" -ForegroundColor DarkGray
        }
    }

    Write-Host '[SearXNG] 健康检查超时 — 请运行: docker logs oao-searxng' -ForegroundColor Yellow
    Write-Host '         浏览器测试: http://127.0.0.1:8080/search?q=test&format=json' -ForegroundColor Yellow
    return $false
}

if ($MyInvocation.InvocationName -ne '.') {
    Ensure-SearXNG | Out-Null
}
