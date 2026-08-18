# OAO remote AI connectivity check
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Continue'

$CfDir = $PSScriptRoot
$ConfigFile = Join-Path $CfDir 'remote-access.config.json'
$WorkerUrl = 'https://oao-ai.wh529007.workers.dev'
$LlmHost = 'llm.wh9007.dpdns.org'
$OllamaHost = 'ollama.wh9007.dpdns.org'
$SearxHost = 'search.wh9007.dpdns.org'

if (Test-Path $ConfigFile) {
    try {
        $cfg = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.worker_url) { $WorkerUrl = $cfg.worker_url }
        if ($cfg.llm_tunnel_hostname) { $LlmHost = ($cfg.llm_tunnel_hostname -replace '^https?://', '') }
        if ($cfg.ollama_tunnel_hostname) { $OllamaHost = ($cfg.ollama_tunnel_hostname -replace '^https?://', '') }
        if ($cfg.searx_tunnel_hostname) { $SearxHost = ($cfg.searx_tunnel_hostname -replace '^https?://', '') }
    } catch {}
}

Write-Host ''
Write-Host '=== OAO 远程 AI 连通性诊断 ===' -ForegroundColor Cyan

function Test-Url($label, $url, [switch]$JsonOk) {
    Write-Host ("`n[{0}] {1}" -f $label, $url)
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
        Write-Host ("  正常 HTTP {0}" -f $r.StatusCode) -ForegroundColor Green
        $body = $r.Content.Trim()
        if ($JsonOk -and $body.StartsWith('{')) {
            try {
                $data = $body | ConvertFrom-Json
                if ($data.ok -eq $true -and $data.count -gt 0) {
                    Write-Host ("  搜索 OK: count={0}" -f $data.count) -ForegroundColor Green
                } elseif ($data.results -and $data.results.Count -gt 0) {
                    Write-Host ("  SearXNG OK: results={0}" -f $data.results.Count) -ForegroundColor Green
                } elseif ($data.error) {
                    Write-Host ("  业务错误: {0}" -f $data.error) -ForegroundColor Yellow
                    if ($data.hint) { Write-Host ("  提示: {0}" -f $data.hint) -ForegroundColor Yellow }
                }
            } catch {}
        } elseif ($body.Length -lt 400) {
            Write-Host ("  返回: {0}" -f $body)
        }
        return $true
    } catch {
        $msg = $_.Exception.Message
        if ($_.Exception.Response) {
            $code = [int]$_.Exception.Response.StatusCode
            Write-Host ("  失败 HTTP {0}" -f $code) -ForegroundColor Red
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $errBody = $reader.ReadToEnd()
                if ($errBody -and $errBody.Length -lt 500) { Write-Host ("  返回: {0}" -f $errBody.Trim()) }
            } catch {}
        } else {
            Write-Host ("  失败: {0}" -f $msg) -ForegroundColor Red
        }
        if ($msg -match '1033|530|Tunnel') {
            Write-Host '  => Cloudflare Tunnel 错误 1033: Tunnel 未连接' -ForegroundColor Yellow
            Write-Host '     请先运行 OAO服务器.bat，并保持窗口打开' -ForegroundColor Yellow
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
    Write-Host '  => Tunnel 域名与 Worker 代理可能失败. 请双击 OAO服务器.bat' -ForegroundColor Yellow
}

$results = @{}
$results['local_gateway'] = Test-Url '本机 AI 网关' 'http://127.0.0.1:3001/health'
$results['local_anythingllm'] = Test-Url '本机 AnythingLLM' 'http://127.0.0.1:3002/api/ping'
$results['local_ollama'] = Test-Url '本机 Ollama' 'http://127.0.0.1:11434/api/tags'
$results['local_searx'] = Test-Url '本机 SearXNG' 'http://127.0.0.1:8080/search?q=test&format=json' -JsonOk
$results['tunnel_gateway'] = Test-Url 'Tunnel 统一网关' "https://$LlmHost/health"
$results['worker_llm'] = Test-Url 'Worker 代理本机 AI' "$WorkerUrl/api/ping"
$results['worker_ollama'] = Test-Url 'Worker 代理 Ollama' "$WorkerUrl/ollama/api/tags"
$results['worker_gateway'] = Test-Url 'Worker 网关健康' "$WorkerUrl/gateway/health"
$results['tunnel_ollama'] = Test-Url 'Tunnel Ollama 域名' "https://$OllamaHost/api/tags"
$results['tunnel_searx'] = Test-Url 'Tunnel SearXNG 域名' "https://$SearxHost/search?q=test&format=json" -JsonOk
$results['worker_websearch'] = Test-Url 'Worker 联网搜索' "$WorkerUrl/web-search?q=OpenAI" -JsonOk

Write-Host ''
Write-Host '--- 验收摘要 ---' -ForegroundColor Cyan
$pass = ($results.Values | Where-Object { $_ }).Count
$total = $results.Count
Write-Host ("  通过 {0}/{1} 项" -f $pass, $total) -ForegroundColor $(if ($pass -eq $total) { 'Green' } else { 'Yellow' })

Write-Host ''
Write-Host '外网用户访问: https://wh9007.github.io/oao-platform/OAO.html' -ForegroundColor Cyan
Write-Host '本机需满足:' -ForegroundColor Cyan
Write-Host '  1. OAO 本地 AI 网关已运行, 端口 3001'
Write-Host '  2. AnythingLLM 桌面版已打开, 端口 3002, 工作区 oaoeth'
Write-Host '  3. Ollama 已运行, 端口 11434'
Write-Host '  4. SearXNG 已运行, 端口 8080 (Docker, OAO服务器.bat 后台启动)'
Write-Host '  5. Tunnel 公网路由: llm.wh9007.dpdns.org -> http://127.0.0.1:3001'
Write-Host '  6. 双击 OAO服务器.bat，保持窗口打开'
Write-Host '  7. Worker 变量: LOCAL_AI_ORIGIN (统一入口)'
Write-Host '  8. 浏览器控制台: OAO_Diagnostic.testWebSearch()'
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
    Write-Host 'Tunnel DNS 失败时: WiFi DNS 改为 1.1.1.1 / 8.8.8.8, 运行 ipconfig /flushdns' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '联网搜索链路: 浏览器 -> Worker /web-search -> Tunnel(:3001 网关) -> SearXNG -> Ollama 总结' -ForegroundColor DarkGray
Write-Host ''

if (-not $results['local_gateway']) {
    Write-Host '[提示] 本地 AI 网关未运行 — 请双击 OAO服务器.bat（自动迁移 AnythingLLM 到 3002 并启动网关）' -ForegroundColor Yellow
}
if (-not $results['worker_gateway']) {
    Write-Host '[提示] Worker 无法访问本地 AI 网关 — 请确认 OAO服务器.bat 已运行，并部署最新 Worker' -ForegroundColor Yellow
}
if (-not $results['worker_websearch']) {
    Write-Host '[提示] Worker /web-search 失败 — 网关启动后即可恢复；也可在 Worker 配置 SERPER_API_KEY 作为云端备用' -ForegroundColor Yellow
}
