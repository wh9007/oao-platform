$ErrorActionPreference = 'Continue'
$Log = Join-Path $PSScriptRoot 'upload-log.txt'
function Log($msg) { Add-Content -Path $Log -Value $msg -Encoding UTF8; Write-Host $msg }

Set-Content -Path $Log -Value "=== OAO 上传日志 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" -Encoding UTF8

$User = 'wh9007'
$Repo = 'oao-platform'
Set-Location $PSScriptRoot

$tokenFile = Join-Path $PSScriptRoot 'git-token.txt'
if (-not (Test-Path $tokenFile)) {
    Log '[失败] 找不到 git-token.txt，请先运行 一键上传GitHub.bat'
    exit 1
}

$token = $null
Get-Content $tokenFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $token -and $line -match '^ghp_') { $token = $line }
}
if (-not $token) {
    Log '[失败] git-token.txt 里没有有效的 ghp_ Token'
    exit 1
}
Log '[OK] 已读取 Token'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Log '[失败] 未安装 Git，请先安装 https://git-scm.com/download/win'
    exit 1
}

if (-not (Test-Path '.git')) { git init | Out-Null }
git branch -M main 2>$null | Out-Null
git remote remove origin 2>$null | Out-Null
git remote add origin "https://github.com/$User/$Repo.git" 2>$null | Out-Null

$files = @(
    'OAO.html', 'index.html', '.nojekyll', '.gitignore', 'DEPLOY.md',
    'cloudflare', 'oao-meeting-signal.js', '打开OAO.bat', '启动Tunnel.bat',
    '发布到GitHub.bat', '一键上传GitHub.bat', '使用说明-上传网站.txt', 'do-upload.ps1'
)
foreach ($f in $files) {
    if (Test-Path $f) { git add $f 2>&1 | Out-Null }
}

$commit = git commit -m "Upload OAO site" 2>&1
Log $commit

$pushUrl = "https://${User}:$token@github.com/${User}/${Repo}.git"
Log '[进行中] 正在上传到 GitHub...'
$pushOut = git push $pushUrl main 2>&1
Log ($pushOut | Out-String)

if ($LASTEXITCODE -ne 0) {
    Log '[提示] 首次推送失败，尝试同步后重试...'
    git fetch $pushUrl 2>&1 | ForEach-Object { Log $_ }
    git pull $pushUrl main --rebase 2>&1 | ForEach-Object { Log $_ }
    $pushOut2 = git push $pushUrl main 2>&1
    Log ($pushOut2 | Out-String)
}

git remote set-url origin "https://github.com/$User/$Repo.git" 2>$null | Out-Null

if ($LASTEXITCODE -eq 0) {
    Log ''
    Log '=========================================='
    Log '[成功] 代码已上传到 GitHub！'
    Log "仓库: https://github.com/$User/$Repo"
    Log '=========================================='
    exit 0
}

Log ''
Log '=========================================='
Log '[失败] 上传未成功，请查看上方错误信息'
Log '常见原因: Token 无效/过期，或网络问题'
Log '=========================================='
exit 1
