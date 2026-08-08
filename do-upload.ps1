# OAO GitHub upload — called by batch file
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$Log = Join-Path $Root 'upload-log.txt'
$TokenFile = Join-Path $Root 'git-token.txt'
$RepoUrl = 'https://github.com/wh9007/oao-platform.git'

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -LiteralPath $Log -Value $line -Encoding UTF8
    Write-Host $msg
}

function Invoke-Git([string[]]$GitArgs) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & git @GitArgs 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    $out | ForEach-Object { Log $_ }
    return $code
}

'' | Set-Content -LiteralPath $Log -Encoding UTF8

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Log 'ERROR: git not found — install from https://git-scm.com/download/win'
    exit 1
}

$token = (Get-Content -LiteralPath $TokenFile -Raw -ErrorAction SilentlyContinue).Trim()
if ($token -notmatch '^(ghp_|github_pat_)') {
    Log 'ERROR: invalid token in git-token.txt (must start with ghp_ or github_pat_)'
    exit 1
}

if (-not (Test-Path (Join-Path $Root '.git'))) {
    Invoke-Git @('init') | Out-Null
    Log 'git init'
}

Invoke-Git @('branch', '-M', 'main') | Out-Null

$hasOrigin = git remote 2>$null | Select-String -Pattern '^origin$'
if (-not $hasOrigin) { Invoke-Git @('remote', 'add', 'origin', $RepoUrl) | Out-Null }
else { Invoke-Git @('remote', 'set-url', 'origin', $RepoUrl) | Out-Null }

Invoke-Git @('add', '-A') | Out-Null

$status = git status --porcelain
if ($status) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $code = Invoke-Git -GitArgs @('-c', 'user.name=OAO Site', '-c', 'user.email=wh9007@users.noreply.github.com', 'commit', '-m', "Update OAO site $stamp")
    if ($code -ne 0) { exit 1 }
} else {
    Log 'No local changes; syncing remote only'
}

$authUrl = $RepoUrl -replace 'https://', "https://${token}@"

Log 'git fetch / pull --rebase'
Invoke-Git @('fetch', $authUrl) | Out-Null
$code = Invoke-Git @('pull', '--rebase', $authUrl, 'main')
if ($code -ne 0) {
    Invoke-Git @('pull', $authUrl, 'main', '--allow-unrelated-histories', '--no-edit') | Out-Null
    $code = Invoke-Git @('pull', '--rebase', $authUrl, 'main')
    if ($code -ne 0) { exit 1 }
}

Log 'git push'
$code = Invoke-Git @('push', $authUrl, 'main')
if ($code -ne 0) { exit 1 }
Log 'SUCCESS'
exit 0
