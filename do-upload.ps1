$ErrorActionPreference = 'Continue'
$Log = Join-Path $PSScriptRoot 'upload-log.txt'
function Log($msg) { Add-Content -Path $Log -Value $msg -Encoding UTF8; Write-Host $msg }

Set-Content -Path $Log -Value "=== OAO upload $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" -Encoding UTF8
Set-Location $PSScriptRoot

$User = 'wh9007'
$Repo = 'oao-platform'
$GitName = 'wh9007'
$GitEmail = 'wh9007@users.noreply.github.com'

$tokenFile = Join-Path $PSScriptRoot 'git-token.txt'
if (-not (Test-Path $tokenFile)) {
    Log '[FAIL] git-token.txt not found. Run upload bat first.'
    exit 1
}

$token = $null
Get-Content $tokenFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $token -and $line -match '^ghp_') { $token = $line }
}
if (-not $token) {
    Log '[FAIL] No valid ghp_ token in git-token.txt'
    exit 1
}
Log '[OK] Token loaded'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Log '[FAIL] Git not installed: https://git-scm.com/download/win'
    exit 1
}

function Invoke-OaoGit {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
    & git -c "user.name=$GitName" -c "user.email=$GitEmail" @GitArgs
}

if (-not (Test-Path '.git')) { Invoke-OaoGit init | Out-Null }
Invoke-OaoGit branch -M main | Out-Null

$origin = "https://github.com/$User/$Repo.git"
$remotes = @(Invoke-OaoGit remote 2>&1)
if ($remotes -contains 'origin') {
    Invoke-OaoGit remote set-url origin $origin | Out-Null
} else {
    Invoke-OaoGit remote add origin $origin | Out-Null
}

$uploadList = @(
    'OAO.html',
    'index.html',
    'oao-meeting-signal.js',
    '.nojekyll',
    '.gitignore',
    '使用说明.txt',
    'git-token.txt.example',
    'local-config.example.txt',
    '打开OAO.bat',
    '启动Tunnel.bat',
    '一键上传GitHub.bat',
    'do-upload.ps1',
    'cloudflare/oao-ai-worker.js',
    'cloudflare/meeting-room.js',
    'cloudflare/wrangler.toml.example',
    'cloudflare/tunnel-token.txt.example',
    'cloudflare/说明.txt',
    'ipfs-ens/index.html'
)

foreach ($f in $uploadList) {
    $full = Join-Path $PSScriptRoot $f
    if (Test-Path -LiteralPath $full) {
        Invoke-OaoGit add -- $full | Out-Null
    }
}

$pending = Invoke-OaoGit status --porcelain 2>&1 | Out-String
if ($pending.Trim()) {
    Invoke-OaoGit commit -m "Update OAO site $(Get-Date -Format 'yyyy-MM-dd HH:mm')" 2>&1 | ForEach-Object { Log $_ }
} else {
    Log '[INFO] No local changes, still syncing with remote...'
}

$pushUrl = "https://${User}:$token@github.com/${User}/${Repo}.git"
Log '[INFO] Fetching remote...'
Invoke-OaoGit fetch $pushUrl main 2>&1 | ForEach-Object { Log $_ }

Invoke-OaoGit pull $pushUrl main --rebase --autostash 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) {
    Log '[INFO] Rebase failed, trying merge...'
    Invoke-OaoGit rebase --abort 2>$null | Out-Null
    Invoke-OaoGit fetch $pushUrl main 2>&1 | Out-Null
    Invoke-OaoGit pull $pushUrl main --no-rebase --autostash 2>&1 | ForEach-Object { Log $_ }
}

Log '[INFO] Pushing to GitHub...'
Invoke-OaoGit push $pushUrl main 2>&1 | ForEach-Object { Log $_ }
$pushExit = $LASTEXITCODE

Invoke-OaoGit remote set-url origin $origin | Out-Null

if ($pushExit -eq 0) {
    Log ''
    Log '=========================================='
    Log '[OK] Uploaded to GitHub'
    Log 'Site: https://wh9007.github.io/oao-platform/'
    Log 'Wait ~2 minutes then refresh the site'
    Log '=========================================='
    exit 0
}

Log ''
Log '=========================================='
Log '[FAIL] Upload failed. See messages above.'
Log 'Try a new GitHub Token, then run upload bat again.'
Log 'Or send upload-log.txt screenshot to Cursor assistant.'
Log '=========================================='
exit 1
