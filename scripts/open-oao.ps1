# OAO 本地测试启动 - 中文界面
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

$Root = Split-Path $PSScriptRoot -Parent
$Lib = Join-Path $Root 'scripts\lib.cmd'
$Url = 'http://127.0.0.1:8777/OAO.html'
$Host.UI.RawUI.WindowTitle = 'OAO 本地测试'

if (-not (Test-Path (Join-Path $Root 'OAO.html'))) {
    Write-Host ''
    Write-Host ' [错误] 未找到 OAO.html' -ForegroundColor Red
    Write-Host " 当前目录: $Root"
    Read-Host '按回车退出'
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ''
    Write-Host ' [错误] 未找到 Node.js，请先安装 Node.js LTS：https://nodejs.org' -ForegroundColor Red
    Read-Host '按回车退出'
    exit 1
}

. (Join-Path $PSScriptRoot 'oao-ai-gateway.ps1')

Write-Host ''
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host '   OAO 本地测试' -ForegroundColor Cyan
Write-Host ' ============================================================' -ForegroundColor Cyan
Write-Host " 主页: $Url"
Write-Host ''
Write-Host ' 用途: 本地功能测试（AI / 小O会议 / OAO翻译）'
Write-Host ' 外网远程 AI: OAO服务器.bat'
Write-Host ' 版本发布: 一键上传GitHub.bat'
Write-Host ''

Write-Host ' 正在确保本地 AI 网关 (3001 -> AnythingLLM 3002 / Ollama / SearXNG)...' -ForegroundColor Cyan
Ensure-OaoAiGateway | Out-Null

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
    Write-Host ' [正常] AnythingLLM 已就绪（统一网关 :3001 -> :3002）' -ForegroundColor Green
}

Write-Host ''
Write-Host ' 正在启动本地预览...'
$launcher = Join-Path $Root 'scripts\run-dev-server.ps1'
Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $launcher + '"') -WorkingDirectory $Root -WindowStyle Hidden

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
