# GitHub 一键上传 - 中文界面
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

$Root = Split-Path $PSScriptRoot -Parent
$TokenFile = Join-Path $Root 'git-token.txt'
$LogFile = Join-Path $Root 'upload-log.txt'

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host '   OAO 一键上传 GitHub（版本更新）' -ForegroundColor Cyan
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host ' [缺少 Git] 请先安装: https://git-scm.com/download/win' -ForegroundColor Red
    Read-Host '按回车关闭'
    exit 1
}

if (-not (Test-Path $TokenFile)) {
    New-Item -ItemType File -Path $TokenFile -Force | Out-Null
}

$hasToken = $false
if (Test-Path $TokenFile) {
    $lines = Get-Content $TokenFile -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        if ($line -match '^(ghp_|github_pat_)') { $hasToken = $true; break }
    }
}

if (-not $hasToken) {
    Write-Host ' 正在打开记事本，请粘贴 Token（一行，ghp_ 或 github_pat_ 开头），保存后关闭。'
    Write-Host ' 获取地址: https://github.com/settings/tokens/new?scopes=repo'
    Write-Host ' 请勾选 repo 权限（Classic Token 推荐）'
    Write-Host ''
    Start-Process notepad $TokenFile
    Start-Sleep -Seconds 2
    $hasToken = $false
    $lines = Get-Content $TokenFile -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        if ($line -match '^(ghp_|github_pat_)') { $hasToken = $true; break }
    }
}

if (-not $hasToken) {
    Write-Host ' [错误] 记事本里没有有效的 Token，请重新运行。' -ForegroundColor Red
    Read-Host '按回车关闭'
    exit 1
}

Write-Host ' 正在上传，请稍候（约 10~60 秒）...'
Write-Host " 详细过程见: upload-log.txt"
Write-Host ''

$uploadScript = Join-Path $Root 'do-upload.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $uploadScript
$ok = $LASTEXITCODE

Write-Host ''
if (Test-Path $LogFile) { Get-Content $LogFile }
Write-Host ''

if ($ok -eq 0) {
    Write-Host ' ============================================================' -ForegroundColor Green
    Write-Host '  [上传成功]'
    Write-Host '  约 2 分钟后访问: https://wh9007.github.io/oao-platform/'
    Write-Host '  若页面仍是旧版，请按 Ctrl+F5 强制刷新'
    Write-Host ' ============================================================' -ForegroundColor Green
    Start-Process 'https://wh9007.github.io/oao-platform/'
} else {
    Write-Host ' ============================================================' -ForegroundColor Red
    Write-Host '  [上传失败] 请看上方 upload-log.txt'
    Write-Host '  若提示 Token 无效，请重新生成 Classic Token（勾选 repo）'
    Write-Host ' ============================================================' -ForegroundColor Red
    Start-Process 'https://github.com/settings/tokens/new?scopes=repo'
}

Write-Host ''
Write-Host ' 看完结果后按回车关闭。'
Read-Host
