# GitHub 一键上传 - 中文界面
param(
    [switch]$NoPause
)

$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

$Root = Split-Path $PSScriptRoot -Parent
$TokenFile = Join-Path $Root 'git-token.txt'
$LogFile = Join-Path $Root 'upload-log.txt'

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host '   OAO 一键上传 GitHub（快速部署）' -ForegroundColor Cyan
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host ' [缺少 Git] 请先安装: https://git-scm.com/download/win' -ForegroundColor Red
    if (-not $NoPause) { Read-Host '按回车关闭' }
    exit 1
}

Set-Location -LiteralPath $Root

if (-not (Test-Path $TokenFile)) {
    New-Item -ItemType File -Path $TokenFile -Force | Out-Null
}

function Test-TokenInFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    foreach ($line in (Get-Content $Path -ErrorAction SilentlyContinue)) {
        if ($line -match '^(ghp_|github_pat_)') { return $true }
    }
    return $false
}

$hasToken = Test-TokenInFile $TokenFile

if (-not $hasToken) {
    Write-Host ' 正在打开记事本，请粘贴 Token（一行，ghp_ 或 github_pat_ 开头），保存后关闭。'
    Write-Host ' 获取地址: https://github.com/settings/tokens/new?scopes=repo'
    Write-Host ' 请勾选 repo 权限（Classic Token 推荐）'
    Write-Host ' 脚本将自动检测 Token（最多等待 2 分钟）…'
    Write-Host ''
    Start-Process notepad $TokenFile
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        if (Test-TokenInFile $TokenFile) {
            $hasToken = $true
            Write-Host ' 已检测到 Token，继续上传…' -ForegroundColor Green
            break
        }
    }
}

if (-not $hasToken) {
    Write-Host ' [错误] 未检测到有效 Token。请写入 git-token.txt 后重新运行。' -ForegroundColor Red
    if (-not $NoPause) { Read-Host '按回车关闭' }
    exit 1
}

$proxyHint = Join-Path $Root 'upload-proxy.txt'
if (-not (Test-Path $proxyHint)) {
    $proxyExample = Join-Path $Root 'upload-proxy.txt.example'
    if (Test-Path $proxyExample) {
        Write-Host ' 提示: 若 GitHub 连接失败，可复制 upload-proxy.txt.example -> upload-proxy.txt 并填写代理' -ForegroundColor DarkYellow
    }
}

Write-Host ' 正在上传，请稍候…'
Write-Host " 详细过程见: upload-log.txt"
Write-Host ''

$uploadScript = Join-Path $Root 'do-upload.ps1'
& $uploadScript
$ok = $LASTEXITCODE

Write-Host ''
if (Test-Path $LogFile) { Get-Content $LogFile -Tail 30 }
Write-Host ''

if ($ok -eq 0) {
    Write-Host ' ============================================================' -ForegroundColor Green
    Write-Host '  [上传成功]'
    Write-Host '  约 1~2 分钟后访问: https://wh9007.github.io/oao-platform/'
    Write-Host '  若页面仍是旧版，请按 Ctrl+F5 强制刷新'
    Write-Host ' ============================================================' -ForegroundColor Green
    Start-Process 'https://wh9007.github.io/oao-platform/'
} elseif ($ok -eq 2) {
    Write-Host ' ============================================================' -ForegroundColor Red
    Write-Host '  [上传失败] 无法连接 GitHub（网络/代理问题，不是 Token）'
    Write-Host '  1. 打开 Clash/V2Ray，确认浏览器能打开 https://github.com'
    Write-Host '  2. 复制 upload-proxy.txt.example -> upload-proxy.txt'
    Write-Host '     写入代理，例如: http://127.0.0.1:7890'
    Write-Host '  3. 重新运行本脚本'
    Write-Host '  本地 commit 已成功时，网络恢复后再次上传即可 push'
    Write-Host '  详情: upload-log.txt'
    Write-Host ' ============================================================' -ForegroundColor Red
} elseif ($ok -eq 3) {
    Write-Host ' ============================================================' -ForegroundColor Red
    Write-Host '  [上传失败] GitHub Token 无效或权限不足'
    Write-Host '  请重新生成 Classic Token（勾选 repo）写入 git-token.txt'
    Write-Host ' ============================================================' -ForegroundColor Red
    Start-Process 'https://github.com/settings/tokens/new?scopes=repo'
} else {
    Write-Host ' ============================================================' -ForegroundColor Red
    Write-Host '  [上传失败] 请看 upload-log.txt'
    Write-Host ' ============================================================' -ForegroundColor Red
}

Write-Host ''
if ($NoPause) {
    if ($ok -eq 0) {
        Write-Host ' 3 秒后自动关闭…'
        Start-Sleep -Seconds 3
    }
} else {
    Write-Host ' 看完结果后按回车关闭。'
    Read-Host
}

exit $ok
