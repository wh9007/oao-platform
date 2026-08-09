# OAO 本地测试启动 - 中文界面
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

$Root = Split-Path $PSScriptRoot -Parent
$Lib = Join-Path $Root 'scripts\lib.cmd'
$Url = 'http://127.0.0.1:8777/OAO.html'

if (-not (Test-Path (Join-Path $Root 'OAO.html'))) {
    Write-Host ''
    Write-Host ' [错误] 未找到 OAO.html' -ForegroundColor Red
    Write-Host " 当前目录: $Root"
    Read-Host '按回车退出'
    exit 1
}

$py = $null
if (Get-Command python -ErrorAction SilentlyContinue) { $py = 'python' }
elseif (Get-Command py -ErrorAction SilentlyContinue) { $py = 'py -3' }
if (-not $py) {
    Write-Host ''
    Write-Host ' [错误] 未找到 Python 3.8+，请安装 Python' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host '   OAO 本地测试' -ForegroundColor Cyan
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host " 主页: $Url"
Write-Host ''
Write-Host ' 用途: 本地功能测试（AI / 小O会议 / OAO翻译）'
Write-Host ' 外网远程 AI: 请使用「启动远程AI.bat」'
Write-Host ' 版本发布: 请使用「一键上传GitHub.bat」'
Write-Host ''

& cmd /c "call `"$Lib`" FreePort 8777"
& cmd /c "call `"$Lib`" EnsureTranslateEnv"

& cmd /c "call `"$Lib`" CheckOllamaPort"
if ($LASTEXITCODE -ne 0) {
    Write-Host ' [提示] Ollama 未运行 — AI 对话将尝试 AnythingLLM' -ForegroundColor Yellow
} else {
    Write-Host ' [正常] Ollama 已就绪' -ForegroundColor Green
}
& cmd /c "call `"$Lib`" CheckAnythingLLMPort"
if ($LASTEXITCODE -ne 0) {
    Write-Host ' [提示] AnythingLLM 未运行 — 知识库检索不可用' -ForegroundColor Yellow
} else {
    Write-Host ' [正常] AnythingLLM 已就绪' -ForegroundColor Green
}

Write-Host ''
Write-Host ' 正在启动本地预览...'
if ($py -eq 'py -3') {
    Start-Process -FilePath 'py' -ArgumentList '-3','-m','http.server','8777','--bind','127.0.0.1' -WindowStyle Hidden
} else {
    Start-Process -FilePath 'python' -ArgumentList '-m','http.server','8777','--bind','127.0.0.1' -WindowStyle Hidden
}

$ok = $false
for ($i = 0; $i -lt 8; $i++) {
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $ok) { Write-Host ' [提示] 主页仍在启动，仍将打开浏览器...' -ForegroundColor Yellow }

Start-Process $Url
Write-Host ''
Write-Host ' 已打开 OAO 主页。测试完成后可直接关闭本窗口（会停止 8777 端口）。'
Read-Host '按回车关闭'
