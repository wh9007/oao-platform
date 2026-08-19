# OAO Ollama runtime check: llama-server.exe + tags + embed
param(
    [switch]$Repair,
    [switch]$NoPause
)

$ErrorActionPreference = 'Continue'
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
}

$OllamaRoot = Join-Path $env:LOCALAPPDATA 'Programs\Ollama'
$LlamaServer = Join-Path $OllamaRoot 'lib\ollama\llama-server.exe'
$OllamaExe = Join-Path $OllamaRoot 'ollama.exe'

function Write-Step($ok, $msg) {
    if ($ok) { Write-Host "  [OK] $msg" -ForegroundColor Green }
    else { Write-Host "  [X]  $msg" -ForegroundColor Red }
}

function Test-OllamaTags {
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 8
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Start-OllamaIfNeeded {
    if (Test-OllamaTags) { return $true }
    if (-not (Test-Path $OllamaExe) -and -not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        Write-Step $false 'ollama.exe not found'
        return $false
    }
    $exe = if (Test-Path $OllamaExe) { $OllamaExe } else { 'ollama' }
    Write-Host '  (start) ollama serve...' -ForegroundColor Yellow
    Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden
    for ($i = 1; $i -le 15; $i++) {
        Start-Sleep -Seconds 2
        if (Test-OllamaTags) { return $true }
    }
    return $false
}

function Repair-OllamaRuntime {
    Write-Host '  (repair) winget reinstall Ollama to restore lib\ollama\llama-server.exe' -ForegroundColor Yellow
    winget install --id Ollama.Ollama --exact --force --accept-package-agreements --accept-source-agreements
    return (Test-Path -LiteralPath $LlamaServer)
}

function Test-OllamaEmbed {
    $req = Join-Path $env:TEMP 'oao-ollama-embed.json'
    $res = Join-Path $env:TEMP 'oao-ollama-embed-res.json'
    Set-Content -Path $req -Value '{"model":"nomic-embed-text","input":"OAO embedding health"}' -Encoding ASCII -NoNewline
    $code = & curl.exe -sS --max-time 120 -o $res -w '%{http_code}' http://127.0.0.1:11434/api/embed -H 'Content-Type: application/json' --data-binary "@$req"
    if ("$code" -ne '200') { return $false }
    $raw = Get-Content -LiteralPath $res -Raw -ErrorAction SilentlyContinue
    return ($raw -match '"embeddings"')
}

Write-Host ''
Write-Host '--- OAO Ollama check ---' -ForegroundColor Cyan
Write-Host "  install dir: $OllamaRoot"

$hasCli = (Test-Path $OllamaExe) -or [bool](Get-Command ollama -ErrorAction SilentlyContinue)
Write-Step $hasCli 'ollama.exe CLI'

$hasServer = Test-Path -LiteralPath $LlamaServer
Write-Step $hasServer 'lib\ollama\llama-server.exe'
if (-not $hasServer) {
    Write-Host '  embed load will fail: llama-server.exe missing' -ForegroundColor Yellow
    if ($Repair) {
        $hasServer = Repair-OllamaRuntime
        Write-Step $hasServer 'llama-server.exe after repair'
    } else {
        Write-Host '  run: powershell -File scripts\check-ollama.ps1 -Repair' -ForegroundColor DarkGray
    }
}

$apiOk = Start-OllamaIfNeeded
Write-Step $apiOk 'Ollama API :11434 /api/tags'

$embedOk = $false
if ($apiOk) {
    $embedOk = Test-OllamaEmbed
    Write-Step $embedOk 'nomic-embed-text /api/embed'
    if (-not $embedOk -and $Repair -and $hasServer) {
        Write-Host '  llama-server exists but embed failed; pull nomic-embed-text' -ForegroundColor Yellow
    }
}

$ok = $hasCli -and $hasServer -and $apiOk -and $embedOk
if ($ok) {
    Write-Host '  Ollama runtime OK. Local models are usable.' -ForegroundColor Green
} else {
    Write-Host '  Ollama is not fully ready.' -ForegroundColor Yellow
}

exit $(if ($ok) { 0 } else { 1 })
