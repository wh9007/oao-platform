# OAO 上传网络检测 — 代理自动发现与 GitHub 连通性测试
param()

function Normalize-ProxyUrl {
    param([string]$Raw)
    if (-not $Raw) { return $null }
    $s = $Raw.Trim()
    if (-not $s) { return $null }
    if ($s -match '^(\d+\.\d+\.\d+\.\d+:\d+)$') { return "http://$($matches[1])" }
    if ($s -match '^localhost:\d+$') { return "http://127.0.0.1:$($s.Split(':')[1])" }
    if ($s -notmatch '^https?://') { return "http://$s" }
    return $s
}

function Get-CandidateProxyUrls {
    $urls = New-Object System.Collections.Generic.List[string]

    $proxyFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'upload-proxy.txt'
    if (Test-Path $proxyFile) {
        Get-Content $proxyFile -ErrorAction SilentlyContinue | ForEach-Object {
            $line = ($_.Trim() -replace '#.*$', '').Trim()
            $u = Normalize-ProxyUrl $line
            if ($u) { [void]$urls.Add($u) }
        }
    }

    foreach ($name in @('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy')) {
        $val = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not $val) { $val = [Environment]::GetEnvironmentVariable($name, 'User') }
        $u = Normalize-ProxyUrl $val
        if ($u) { [void]$urls.Add($u) }
    }

    try {
        $reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
        if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
            $server = [string]$reg.ProxyServer
            if ($server -match ';') {
                foreach ($part in ($server -split ';')) {
                    if ($part -match '^https=(.+)$') { [void]$urls.Add((Normalize-ProxyUrl $matches[1])) }
                    elseif ($part -match '^http=(.+)$') { [void]$urls.Add((Normalize-ProxyUrl $matches[1])) }
                }
            } else {
                [void]$urls.Add((Normalize-ProxyUrl $server))
            }
        }
    } catch { }

    foreach ($port in @(7890, 7897, 10809, 10808, 1080, 8080, 6152, 33210)) {
        [void]$urls.Add("http://127.0.0.1:$port")
    }

    return @($urls | Select-Object -Unique)
}

function Test-GithubHttps {
    param(
        [string]$ProxyUrl = '',
        [int]$TimeoutSec = 10
    )
    try {
        $req = [System.Net.HttpWebRequest]::Create('https://github.com')
        $req.Method = 'HEAD'
        $req.Timeout = $TimeoutSec * 1000
        $req.UserAgent = 'OAO-Upload/1.0'
        if ($ProxyUrl) {
            $req.Proxy = New-Object System.Net.WebProxy($ProxyUrl, $true)
        }
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $resp.Close()
        return @{ ok = ($code -ge 200 -and $code -lt 500); status = $code; proxy = $ProxyUrl }
    } catch {
        $msg = $_.Exception.Message
        if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
        return @{ ok = $false; proxy = $ProxyUrl; error = $msg }
    }
}

function Find-WorkingGithubProxy {
    param([scriptblock]$OnLog = { param($m) Write-Host $m })
    & $OnLog '检测 GitHub 网络…'
    $direct = Test-GithubHttps -ProxyUrl '' -TimeoutSec 8
    if ($direct.ok) {
        & $OnLog 'GitHub 直连正常'
        return @{ mode = 'direct'; proxy = '' }
    }
    & $OnLog ("直连失败: {0}" -f ($direct.error -replace '\s+', ' '))

    foreach ($proxy in (Get-CandidateProxyUrls)) {
        $port = ($proxy -replace '^https?://', '' -replace '^127\.0\.0\.1:', '')
        try {
            $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port ([int]$port) -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
            if (-not $tcp.TcpTestSucceeded) { continue }
        } catch { continue }

        & $OnLog ("尝试代理: $proxy")
        $r = Test-GithubHttps -ProxyUrl $proxy -TimeoutSec 10
        if ($r.ok) {
            & $OnLog ("代理可用: $proxy")
            return @{ mode = 'proxy'; proxy = $proxy }
        }
    }

    return @{ mode = 'failed'; proxy = '' }
}

function Get-GithubNetworkHelp {
    return @(
        '无法连接 github.com:443（curl 28 超时），这是网络/代理问题，不是 Token 问题。',
        '',
        '请按顺序尝试：',
        '1. 打开 Clash / V2Ray / 系统 VPN，确保能浏览器打开 https://github.com',
        '2. 在项目根目录创建 upload-proxy.txt，写入一行代理地址，例如：',
        '   http://127.0.0.1:7890',
        '   （Clash 常见 7890，V2RayN 常见 10809）',
        '3. 保存后重新运行「一键上传GitHub.bat」',
        '4. 本地已 commit 成功时，网络恢复后再次上传即可 push，无需重复改代码',
        '',
        'Clash 用户：打开「系统代理」或 TUN 模式后再上传。',
        'V2Ray 用户：路由里 github.com 需走代理，不要误设为直连。'
    ) -join "`n"
}
