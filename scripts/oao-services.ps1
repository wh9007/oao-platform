# OAO 后台服务 - 中文界面
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)

$Root = Split-Path $PSScriptRoot -Parent
$Td = Join-Path $Root 'oao-translate'
$Log = Join-Path $Root 'oao-services.log'

$Host.UI.RawUI.WindowTitle = 'OAO 后台服务'

$py = $null
if (Get-Command python -ErrorAction SilentlyContinue) { $py = 'python' }
elseif (Get-Command py -ErrorAction SilentlyContinue) { $py = 'py -3' }

Add-Content -Path $Log -Value "========================================"
Add-Content -Path $Log -Value " OAO 后台服务 $(Get-Date)"
Add-Content -Path $Log -Value "========================================"

Write-Host '========================================'
Write-Host ' OAO 后台服务'
Write-Host ' 关闭本窗口将停止全部服务'
Write-Host '========================================'
Write-Host ''
Write-Host ' 主页  http://127.0.0.1:8777/OAO.html'
Write-Host ' AI    Ollama 11434 + AnythingLLM 3001'
Write-Host ' 翻译  可选中继 3011'
Write-Host ''

$listening8777 = netstat -ano 2>$null | Select-String ':8777' | Select-String 'LISTENING'
if ($listening8777) {
    Write-Host '(跳过) 主页 8777 已由其他启动器运行'
} elseif ($py) {
    Write-Host '(运行中) 主页服务 8777'
    if ($py -eq 'py -3') {
        Start-Process -FilePath 'py' -ArgumentList '-3','-m','http.server','8777','--bind','127.0.0.1' -WindowStyle Hidden
    } else {
        Start-Process -FilePath 'python' -ArgumentList '-m','http.server','8777','--bind','127.0.0.1' -WindowStyle Hidden
    }
}

if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Host '(运行中) Ollama 11434'
    Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden
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
Write-Host ' 远程 AI 还需另开「OAO服务器.bat」选 1 或 3 启动 Tunnel'
Write-Host " 日志: $Log"
Write-Host ''
Write-Host ' 本窗口请保持打开...'

while ($true) { Start-Sleep -Seconds 86400 }
