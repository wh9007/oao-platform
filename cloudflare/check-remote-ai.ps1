# OAO remote AI connectivity check
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Continue'

Write-Host ''
Write-Host '=== OAO 远程 AI 连通性诊断 ===' -ForegroundColor Cyan

function Test-Url($label, $url) {
    Write-Host ("`n[{0}] {1}" -f $label, $url)
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 12
        Write-Host ("  正常 HTTP {0}" -f $r.StatusCode) -ForegroundColor Green
        if ($r.Content.Length -lt 400) { Write-Host ("  返回: {0}" -f $r.Content.Trim()) }
        return $true
    } catch {
        $msg = $_.Exception.Message
        if ($_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode
            Write-Host ("  失败 HTTP {0}" -f $code) -ForegroundColor Red
        } else {
            Write-Host ("  失败: {0}" -f $msg) -ForegroundColor Red
        }
        if ($msg -match '1033|530|Tunnel') {
            Write-Host '  => Cloudflare Tunnel 错误 1033: Tunnel 未连接' -ForegroundColor Yellow
            Write-Host '     请先运行 OAO服务器.bat，并保持窗口打开' -ForegroundColor Yellow
            Write-Host '     看到 Registered tunnel connection 后再检测' -ForegroundColor Yellow
        }
        return $false
    }
}

$cf = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
if ($cf) {
    Write-Host ("`n[Tunnel 进程] cloudflared 正在运行 PID={0}" -f $cf[0].Id) -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host '[Tunnel 进程] cloudflared 未运行' -ForegroundColor Red
    Write-Host '  => 这就是 Error 1033 的原因. 请双击 OAO服务器.bat 启动 Tunnel' -ForegroundColor Yellow
}

Test-Url '本机 AnythingLLM' 'http://127.0.0.1:3001/api/ping' | Out-Null
Test-Url '本机 Ollama' 'http://127.0.0.1:11434/api/tags' | Out-Null
Test-Url 'Worker 智谱健康' 'https://oao-ai.wh529007.workers.dev/glm/health' | Out-Null
Test-Url 'Tunnel 域名 LLM' 'https://llm.wh9007.dpdns.org/api/ping' | Out-Null
Test-Url 'Worker 代理本机 AI' 'https://oao-ai.wh529007.workers.dev/api/ping' | Out-Null
Test-Url 'Worker 代理 Ollama' 'https://oao-ai.wh529007.workers.dev/ollama/api/tags' | Out-Null
Test-Url 'Tunnel Ollama 域名' 'https://ollama.wh9007.dpdns.org/api/tags' | Out-Null

Write-Host ''
Write-Host '外网用户访问: https://wh9007.github.io/oao-platform/OAO.html' -ForegroundColor Cyan
Write-Host '本机需满足:' -ForegroundColor Cyan
Write-Host '  1. AnythingLLM 桌面版已打开, 端口 3001, 工作区 oaoeth'
Write-Host '  2. Ollama 已运行, 端口 11434'
Write-Host '  3. 双击 OAO服务器.bat，保持窗口打开'
Write-Host '  4. Worker 已配置 LLM_ORIGIN=https://llm.wh9007.dpdns.org'
Write-Host '              OLLAMA_ORIGIN=你的 ollama 隧道域名'
Write-Host '              ANYTHINGLLM_API_KEY=你的 API Key'
Write-Host ''

Write-Host ''
Write-Host '--- Tunnel 所需 DNS 检测 ---' -ForegroundColor Cyan
$dnsHosts = @('argotunnel.com', 'cfd-features.argotunnel.com', 'api.cloudflare.com', 'region1.v2.argotunnel.com')
$dnsFail = $false
foreach ($h in $dnsHosts) {
    try {
        $null = Resolve-DnsName $h -ErrorAction Stop -DnsOnly
        Write-Host ("  [正常] {0}" -f $h) -ForegroundColor Green
    } catch {
        Write-Host ("  [失败] {0}" -f $h) -ForegroundColor Red
        $dnsFail = $true
    }
}
if ($dnsFail) {
    Write-Host ''
    Write-Host 'Tunnel 日志若出现 lookup argotunnel.com: no such host, 是 DNS 问题' -ForegroundColor Yellow
    Write-Host '修复: 设置 -> 网络 -> WLAN -> DNS 手动 -> 1.1.1.1 / 8.8.8.8' -ForegroundColor Yellow
    Write-Host '然后管理员 CMD 运行 ipconfig /flushdns, 再选 1 启动 Tunnel' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '说明: 选项 6 只做检测, 不会启动 Tunnel' -ForegroundColor DarkGray
Write-Host '      远程 AI 要可用, 请先双击 OAO服务器.bat 并保持窗口不关' -ForegroundColor DarkGray
Write-Host ''