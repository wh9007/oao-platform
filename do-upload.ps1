# OAO GitHub upload — called by batch file
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$LogFile = Join-Path $Root 'upload-log.txt'
$TokenFile = Join-Path $Root 'git-token.txt'
$RepoUrl = 'https://github.com/wh9007/oao-platform.git'
$NetworkScript = Join-Path $Root 'scripts\upload-network.ps1'

function Write-UploadLog($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
    Write-Host $msg
}

function Invoke-Git {
    param(
        [string[]]$GitArgs,
        [string]$ProxyUrl = ''
    )
    $allArgs = @('-c', 'http.version=HTTP/1.1', '-c', 'http.postBuffer=524288000')
    if ($ProxyUrl) {
        $allArgs += @('-c', "http.proxy=$ProxyUrl", '-c', "https.proxy=$ProxyUrl")
    }
    $allArgs += $GitArgs

    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & git @allArgs 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    $out | ForEach-Object { Write-UploadLog $_ }
    return $code
}

function Invoke-GitWithRetry {
    param(
        [string[]]$GitArgs,
        [string]$ProxyUrl = '',
        [int]$MaxAttempts = 3,
        [string]$Label = 'git'
    )
    for ($i = 1; $i -le $MaxAttempts; $i++) {
        if ($i -gt 1) {
            Write-UploadLog "$Label 重试 $i/$MaxAttempts …"
            Start-Sleep -Seconds ([Math]::Min(8, 2 * $i))
        }
        $code = Invoke-Git -GitArgs $GitArgs -ProxyUrl $ProxyUrl
        if ($code -eq 0) { return 0 }
        $tail = Get-Content -LiteralPath $script:LogFile -Tail 6 -ErrorAction SilentlyContinue | Out-String
        if ($tail -notmatch 'Could not connect|curl 28|Failed to connect|timed out|Connection reset|RPC failed') {
            return $code
        }
    }
    return 1
}

function Test-AuthFailure {
    $tail = Get-Content -LiteralPath $script:LogFile -Tail 20 -ErrorAction SilentlyContinue | Out-String
    return ($tail -match 'Authentication failed|403|401|invalid credentials|Repository not found')
}

'' | Set-Content -LiteralPath $LogFile -Encoding UTF8

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-UploadLog 'ERROR: git not found — install from https://git-scm.com/download/win'
    exit 1
}

$token = (Get-Content -LiteralPath $TokenFile -Raw -ErrorAction SilentlyContinue).Trim()
if ($token -notmatch '^(ghp_|github_pat_)') {
    Write-UploadLog 'ERROR: invalid token in git-token.txt (must start with ghp_ or github_pat_)'
    exit 1
}

. $NetworkScript
$net = Find-WorkingGithubProxy -OnLog { param($m) Write-UploadLog $m }
if ($net.mode -eq 'failed') {
    Write-UploadLog 'ERROR: GitHub network unreachable'
    (Get-GithubNetworkHelp) -split "`n" | ForEach-Object { Write-UploadLog $_ }
    exit 2
}

$proxy = [string]$net.proxy
if ($proxy) { Write-UploadLog "使用代理上传: $proxy" }
else { Write-UploadLog '使用直连上传' }

if (-not (Test-Path (Join-Path $Root '.git'))) {
    Invoke-Git @('init') -ProxyUrl $proxy | Out-Null
    Write-UploadLog 'git init'
}

Invoke-Git @('branch', '-M', 'main') -ProxyUrl $proxy | Out-Null

$hasOrigin = git remote 2>$null | Select-String -Pattern '^origin$'
if (-not $hasOrigin) { Invoke-Git @('remote', 'add', 'origin', $RepoUrl) -ProxyUrl $proxy | Out-Null }
else { Invoke-Git @('remote', 'set-url', 'origin', $RepoUrl) -ProxyUrl $proxy | Out-Null }

Invoke-Git @('add', '-A') -ProxyUrl $proxy | Out-Null

$status = git status --porcelain
if ($status) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $code = Invoke-Git -GitArgs @('-c', 'user.name=OAO Site', '-c', 'user.email=wh9007@users.noreply.github.com', 'commit', '-m', "Update OAO site $stamp") -ProxyUrl $proxy
    if ($code -ne 0) { exit 1 }
} else {
    Write-UploadLog 'No local changes; syncing remote only'
}

$authUrl = $RepoUrl -replace 'https://', "https://${token}@"

Write-UploadLog 'git fetch / pull --rebase'
$code = Invoke-GitWithRetry -GitArgs @('fetch', $authUrl) -ProxyUrl $proxy -Label 'fetch'
if ($code -ne 0) {
    if (Test-AuthFailure) { Write-UploadLog 'ERROR: Token 无效或权限不足（需 repo 权限）'; exit 3 }
    (Get-GithubNetworkHelp) -split "`n" | ForEach-Object { Write-UploadLog $_ }
    exit 2
}

$code = Invoke-GitWithRetry -GitArgs @('pull', '--rebase', $authUrl, 'main') -ProxyUrl $proxy -Label 'pull'
if ($code -ne 0) {
    Invoke-Git @('pull', $authUrl, 'main', '--allow-unrelated-histories', '--no-edit') -ProxyUrl $proxy | Out-Null
    $code = Invoke-GitWithRetry -GitArgs @('pull', '--rebase', $authUrl, 'main') -ProxyUrl $proxy -Label 'pull'
    if ($code -ne 0) {
        if (Test-AuthFailure) { Write-UploadLog 'ERROR: Token 无效或权限不足（需 repo 权限）'; exit 3 }
        (Get-GithubNetworkHelp) -split "`n" | ForEach-Object { Write-UploadLog $_ }
        exit 2
    }
}

Write-UploadLog 'git push'
$code = Invoke-GitWithRetry -GitArgs @('push', $authUrl, 'main') -ProxyUrl $proxy -Label 'push'
if ($code -ne 0) {
    if (Test-AuthFailure) { Write-UploadLog 'ERROR: Token 无效或权限不足（需 repo 权限）'; exit 3 }
    (Get-GithubNetworkHelp) -split "`n" | ForEach-Object { Write-UploadLog $_ }
    exit 2
}

Write-UploadLog 'SUCCESS'
exit 0
