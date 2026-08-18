# OAO Audit Module Smoke Test
$ErrorActionPreference = 'Continue'
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $Root 'OAO.html'))) {
    $Root = 'c:\Users\wh-90\Desktop\Html 代码\OAO.eth 20260612 更新测试'
}
$Embed = Join-Path $Root 'oao-audit\embed'
$Base = 'http://127.0.0.1:8777'

function Test-Case {
    param([string]$Id, [string]$Name, [scriptblock]$Test)
    try {
        $ok = & $Test
        if ($ok) {
            Write-Host "[PASS] $Id $Name" -ForegroundColor Green
            return @{ id = $Id; pass = $true }
        }
        Write-Host "[FAIL] $Id $Name" -ForegroundColor Red
        return @{ id = $Id; pass = $false }
    } catch {
        Write-Host "[FAIL] $Id $Name - $($_.Exception.Message)" -ForegroundColor Red
        return @{ id = $Id; pass = $false }
    }
}

Write-Host ""
Write-Host "=== OAO Audit Smoke Test ===" -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host ""

$results = @()

$results += Test-Case -Id 'T01' -Name 'embed files' -Test {
    @('index.html','app.js','audit-ai.js','audit-store.js','audit-parser.js','templates\special.json') |
        ForEach-Object { Test-Path (Join-Path $Embed $_) } | Where-Object { $_ -eq $false } | Measure-Object |
        Select-Object -ExpandProperty Count | ForEach-Object { $_ -eq 0 }
}

$results += Test-Case -Id 'T02' -Name 'embed HTTP 200' -Test {
    (Invoke-WebRequest -Uri "$Base/oao-audit/embed/index.html" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200
}

$results += Test-Case -Id 'T03' -Name 'Ollama tags' -Test {
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
    @($r.models | Where-Object { $_.name -eq 'qwen2.5:7b' }).Count -ge 1
}

$results += Test-Case -Id 'T04' -Name 'AnythingLLM ping' -Test {
    (Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/ping' -TimeoutSec 5).online -eq $true
}

$results += Test-Case -Id 'T05' -Name 'Ollama chat' -Test {
    $body = '{"model":"qwen2.5:7b","stream":false,"messages":[{"role":"user","content":"OK"}]}'
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/chat' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 90
    [bool]$r.message.content
}

$results += Test-Case -Id 'T06' -Name 'OAO.html audit entry' -Test {
    $h = Get-Content (Join-Path $Root 'OAO.html') -Raw -Encoding UTF8
    ($h -match 'oaoToolAudit') -and ($h -match 'ollama_base') -and ($h -match 'ai_base')
}

$results += Test-Case -Id 'T07' -Name 'script order' -Test {
    $i = Get-Content (Join-Path $Embed 'index.html') -Raw -Encoding UTF8
    ($i.IndexOf('audit-roles.js') -lt $i.IndexOf('app.js'))
}

$results += Test-Case -Id 'T08' -Name 'DB v4' -Test {
    (Get-Content (Join-Path $Embed 'audit-store.js') -Raw) -match 'DB_VERSION = 4'
}

$results += Test-Case -Id 'T09' -Name 'audit-kb module' -Test {
    (Test-Path (Join-Path $Embed 'audit-kb.js')) -and
    (Get-Content (Join-Path $Embed 'index.html') -Raw) -match 'audit-kb.js'
}

$results += Test-Case -Id 'T10' -Name 'import + vendor loader' -Test {
    (Test-Path (Join-Path $Embed 'audit-import.js')) -and
    (Test-Path (Join-Path $Embed 'audit-vendor.js')) -and
    (Get-Content (Join-Path $Embed 'audit-bundle.js') -Raw) -match 'version: 4'
}

$pass = @($results | Where-Object { $_.pass }).Count
$fail = @($results | Where-Object { -not $_.pass }).Count
Write-Host ""
Write-Host "--- Result: $pass passed / $fail failed / $($results.Count) total ---" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 }
exit 0
