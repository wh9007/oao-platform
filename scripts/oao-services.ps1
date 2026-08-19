# OAO 后台服务 - 中文界面
if ($PSVersionTable.PSVersion.Major -ge 6) {
    $utf8 = [Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = $utf8
    $OutputEncoding = $utf8
}

$Root = Split-Path $PSScriptRoot -Parent
$Td = Join-Path $Root 'oao-translate'
$Log = Join-Path $Root 'oao-services.log'

. (Join-Path $PSScriptRoot 'oao-ai-gateway.ps1')

$Host.UI.RawUI.WindowTitle = 'OAO 后台服务'

$node = Get-Command node -ErrorAction SilentlyContinue

Add-Content -Path $Log -Value "========================================"
Add-Content -Path $Log -Value " OAO 后台服务 $(Get-Date)"
Add-Content -Path $Log -Value "========================================"

Write-Host '========================================'
Write-Host ' OAO 后台服务'
Write-Host ' 关闭本窗口将停止全部服务'
Write-Host '========================================'
Write-Host ''
Write-Host ' 主页  请用 本地测试OAO.bat'
Write-Host ' AI    AnythingLLM 3001 + Ollama 11434（可选 SearXNG 8080）'
Write-Host ' 翻译  可选中继 3011'
Write-Host ''

Write-Host '(提示) 本地主页请用 本地测试OAO.bat（避免管理员进程占用 8777）'

if (Get-Command ollama -ErrorAction SilentlyContinue) {
    try {
        $null = Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -UseBasicParsing -TimeoutSec 1
        Write-Host '(正常) Ollama 11434 已运行'
    } catch {
        Write-Host '(运行中) 启动 Ollama 11434'
        Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
    }
} else {
    Write-Host '(提示) 未检测到 Ollama - 请安装 https://ollama.com'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '(提示) 未检测到 Node.js - 翻译中继 3011 不可用'
    Add-Content -Path $Log -Value '(提示) 未检测到 Node.js'
} elseif (Test-Path (Join-Path $Td 'server\package.json')) {
    $serverDir = Join-Path $Td 'server'
    if (-not (Test-Path (Join-Path $serverDir 'node_modules'))) {
        Write-Host '(后台) 首次安装 OAO翻译 AI 依赖...'
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d `"$serverDir`" && npm install >> `"$Log`" 2>&1" -WindowStyle Hidden
        Start-Sleep -Seconds 2
    }
    if (Test-Path (Join-Path $serverDir 'dist\index.js')) {
        Write-Host '(运行中) OAO翻译中继 3011 生产模式'
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d `"$serverDir`" && npm run start >> `"$Log`" 2>&1" -WindowStyle Hidden
    } else {
        Write-Host '(运行中) OAO翻译中继 3011 开发模式'
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "cd /d `"$serverDir`" && npm run dev >> `"$Log`" 2>&1" -WindowStyle Hidden
    }
}

Write-Host ''
Write-Host ' 远程 AI：双击「OAO服务器.bat」启动 Tunnel（保持窗口打开）'
Write-Host " 日志: $Log"
Write-Host ''
Write-Host ' 本窗口请保持打开...'

while ($true) { Start-Sleep -Seconds 86400 }
