# 下载 OAO 审计 embed 所需前端依赖到 vendor/（离线可用）
$ErrorActionPreference = 'Stop'
$Embed = Join-Path (Split-Path $PSScriptRoot -Parent) 'embed'
$Vendor = Join-Path $Embed 'vendor'
New-Item -ItemType Directory -Force -Path $Vendor | Out-Null

$downloads = @(
    @{
        Path = 'pdfjs-dist/build/pdf.min.js'
        Url  = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
    },
    @{
        Path = 'pdfjs-dist/build/pdf.worker.min.js'
        Url  = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
    },
    @{
        Path = 'xlsx/xlsx.full.min.js'
        Url  = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    },
    @{
        Path = 'mammoth/mammoth.browser.min.js'
        Url  = 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js'
    }
)

Write-Host "=== OAO Audit Vendor Fetch ===" -ForegroundColor Cyan
Write-Host "Target: $Vendor"
Write-Host ""

foreach ($item in $downloads) {
    $dest = Join-Path $Vendor $item.Path
    $dir = Split-Path $dest -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 1000)) {
        Write-Host "[SKIP] $($item.Path)" -ForegroundColor DarkGray
        continue
    }
    Write-Host "[GET]  $($item.Url)" -ForegroundColor Yellow
    Invoke-WebRequest -Uri $item.Url -OutFile $dest -UseBasicParsing
    Write-Host "[OK]   $($item.Path)" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Done. index.html prefers vendor/ scripts with CDN fallback.' -ForegroundColor Cyan
