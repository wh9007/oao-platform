# OAO Audit AnythingLLM E2E API Test (requires :3001 and local-config.js API Key)
$ErrorActionPreference = 'Continue'
$Root = 'c:\Users\wh-90\Desktop\Html 代码\OAO.eth 20260612 更新测试'
$Base = 'http://127.0.0.1:3001'
$configPath = Join-Path $Root 'local-config.js'

function Get-AllmApiKey {
    if (-not (Test-Path $configPath)) { return '' }
    $raw = Get-Content $configPath -Raw -Encoding UTF8
    if ($raw -match "OAO_ANYTHINGLLM_API_KEY\s*=\s*'([^']+)'") { return $Matches[1] }
    if ($raw -match 'OAO_ANYTHINGLLM_API_KEY\s*=\s*"([^"]+)"') { return $Matches[1] }
    return ''
}

function Test-Step {
    param([string]$Name, [scriptblock]$Action)
    try {
        $result = & $Action
        if ($result) {
            Write-Host "[PASS] $Name" -ForegroundColor Green
            return $true
        }
        Write-Host "[FAIL] $Name" -ForegroundColor Red
        return $false
    } catch {
        Write-Host "[FAIL] $Name - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

Write-Host ''
Write-Host '=== OAO Audit KB E2E ===' -ForegroundColor Cyan
Write-Host ''

$apiKey = Get-AllmApiKey
if (-not $apiKey) {
    Write-Host '[WARN] OAO_ANYTHINGLLM_API_KEY not found, skipping auth steps' -ForegroundColor Yellow
}

$headers = @{ Accept = 'application/json' }
if ($apiKey) { $headers.Authorization = "Bearer $apiKey" }

$slug = "audit-e2e-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
$passed = 0
$total = 0
$docLocation = $null

$total++
if (Test-Step 'Ping' { (Invoke-RestMethod -Uri "$Base/api/ping" -TimeoutSec 5).online -eq $true }) { $passed++ }

if ($apiKey) {
    $total++
    if (Test-Step 'Create workspace' {
        $body = @{ name = 'E2E Test'; slug = $slug; chatMode = 'query' } | ConvertTo-Json
        $h = $headers.Clone()
        $h['Content-Type'] = 'application/json'
        $r = Invoke-RestMethod -Uri "$Base/api/v1/workspace/new" -Method POST -Headers $h -Body $body -TimeoutSec 15
        [bool]($r.workspace.slug -eq $slug -or $r.slug -eq $slug)
    }) { $passed++ }

    $total++
    if (Test-Step 'Upload raw-text' {
        $md = "# E2E`nProcurement must compare three vendors."
        $bodyObj = @{ textContent = $md; metadata = @{ title = 'e2e-test.md' } }
        $body = $bodyObj | ConvertTo-Json -Depth 4
        $h = $headers.Clone()
        $h['Content-Type'] = 'application/json; charset=utf-8'
        $r = Invoke-RestMethod -Uri "$Base/api/v1/document/raw-text" -Method POST -Headers $h -Body $body -TimeoutSec 30
        $doc = $r.document
        if (-not $doc) { $doc = $r.documents[0] }
        $script:docLocation = $doc.location
        if (-not $script:docLocation) { $script:docLocation = $doc.url }
        if (-not $script:docLocation) { $script:docLocation = $doc.name }
        [bool]$script:docLocation
    }) { $passed++ }

    if ($docLocation) {
        $total++
        if (Test-Step 'Update embeddings' {
            $body = @{ adds = @($docLocation) } | ConvertTo-Json
            $h = $headers.Clone()
            $h['Content-Type'] = 'application/json'
            Invoke-RestMethod -Uri "$Base/api/v1/workspace/$slug/update-embeddings" -Method POST -Headers $h -Body $body -TimeoutSec 60 | Out-Null
            $true
        }) { $passed++ }

        $total++
        if (Test-Step 'RAG chat query' {
            $bodyObj = @{
                message   = 'What mandatory procurement rules exist in this project?'
                mode      = 'query'
                sessionId = 'oao_audit_e2e'
                stream    = $false
            }
            $body = $bodyObj | ConvertTo-Json
            $h = $headers.Clone()
            $h['Content-Type'] = 'application/json; charset=utf-8'
            $r = Invoke-RestMethod -Uri "$Base/api/v1/workspace/$slug/chat" -Method POST -Headers $h -Body $body -TimeoutSec 90
            $text = $r.textResponse
            if (-not $text) { $text = $r.response }
            [bool]$text
        }) { $passed++ }
    }
}

Write-Host ''
Write-Host "--- E2E: $passed / $total passed ---" -ForegroundColor Cyan
if ($passed -lt $total) { exit 1 }
exit 0
