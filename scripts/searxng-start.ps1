# SearXNG 本地搜索服务（方案 A：SearXNG + Ollama）
# 端口 8080，供 Cloudflare Tunnel search.* 路由与本机 OAO 联网搜索使用

$ErrorActionPreference = 'Stop'
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
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/search?q=test&format=json' -UseBasicParsing -TimeoutSec 8
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Ensure-SearXNG {
  if (-not (Test-Path $ComposeFile)) {
    Write-Host '[SearXNG] 未找到 docker-compose.yml，跳过' -ForegroundColor Yellow
    return $false
  }

  if (Test-SearXNGHealth) {
    Write-Host '[SearXNG] 已在 :8080 运行' -ForegroundColor Green
    return $true
  }

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    Write-Host '[SearXNG] 未安装 Docker Desktop，无法自动启动 SearXNG' -ForegroundColor Yellow
    Write-Host '         请安装 Docker 后重试，或手动运行: cd searxng && docker compose up -d' -ForegroundColor Yellow
    return $false
  }

  Write-Host '[SearXNG] 正在启动 Docker 容器 (端口 8080)...' -ForegroundColor Cyan
  Push-Location $SearxDir
  try {
    & docker compose up -d 2>&1 | ForEach-Object { Write-Host $_ }
    Start-Sleep -Seconds 4
    if (Test-SearXNGHealth) {
      Write-Host '[SearXNG] 启动成功 http://127.0.0.1:8080' -ForegroundColor Green
      return $true
    }
    Write-Host '[SearXNG] 容器已启动但健康检查未通过，请稍候或查看 docker logs oao-searxng' -ForegroundColor Yellow
    return $false
  } finally {
    Pop-Location
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  Ensure-SearXNG | Out-Null
}
