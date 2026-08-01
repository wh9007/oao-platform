# OAO GitHub upload — called by batch file
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$Log = Join-Path $Root 'upload-log.txt'
$TokenFile = Join-Path $Root 'git-token.txt'
$RepoUrl = 'https://github.com/wh529007/oao-platform.git'

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -LiteralPath $Log -Value $line -Encoding UTF8
    Write-Host $msg
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
    git init | Out-Null
    Log 'git init'
}

git branch -M main 2>$null

$hasOrigin = git remote 2>$null | Select-String -Pattern '^origin$'
if (-not $hasOrigin) { git remote add origin $RepoUrl }
else { git remote set-url origin $RepoUrl }

git add -A 2>&1 | ForEach-Object { if ($_ -match '\S') { Log $_ } }

$status = git status --porcelain
if ($status) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    git -c user.name='OAO Site' -c user.email='wh529007@users.noreply.github.com' commit -m "Update OAO site $stamp" 2>&1 | ForEach-Object { Log $_ }
} else {
    Log 'No local changes; syncing remote only'
}

$authUrl = $RepoUrl -replace 'https://', "https://${token}@"

Log 'git fetch / pull --rebase'
git fetch $authUrl 2>&1 | ForEach-Object { Log $_ }
git pull --rebase $authUrl main 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) {
    git pull $authUrl main --allow-unrelated-histories --no-edit 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -eq 0) {
        git pull --rebase $authUrl main 2>&1 | ForEach-Object { Log $_ }
    }
}

Log 'git push'
git push $authUrl main 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { exit 1 }
Log 'SUCCESS'
exit 0
