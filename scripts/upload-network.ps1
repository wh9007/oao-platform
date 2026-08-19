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

function Test-LocalProxyPort {
    param([int]$Port)
    if ($Port -le 0) { return $false }
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(400, $false)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch {
        return $false
    } finally {
        if ($client) { $client.Close() }
    }
}

function Test-GithubHttps {
    param(
        [string]$ProxyUrl = '',
        [int]$TimeoutSec = 10
    )
    # 必须用 curl.exe 探测：与 git 同一套网络栈。
    # .NET HttpWebRequest 会偷偷走系统代理，造成“直连正常”但 git fetch 超时。
    $curlArgs = @(
        '-sS', '-I', '-L', '--max-time', "$TimeoutSec",
        '-A', 'OAO-Upload/1.0',
        '-o', 'NUL', '-w', '%{http_code}'
    )
    if ($ProxyUrl) { $curlArgs = @('-x', $ProxyUrl) + $curlArgs }
    $curlArgs += 'https://github.com'
    $outFile = Join-Path $env:TEMP ("oao-upload-curl-out-{0}.txt" -f [guid]::NewGuid().ToString('N'))
    $errFile = Join-Path $env:TEMP ("oao-upload-curl-err-{0}.txt" -f [guid]::NewGuid().ToString('N'))
    try {
        $proc = Start-Process -FilePath 'curl.exe' -ArgumentList $curlArgs -Wait -PassThru -NoNewWindow -RedirectStandardOutput $outFile -RedirectStandardError $errFile
        $exit = $proc.ExitCode
        $outText = ''
        $errText = ''
        if (Test-Path $outFile) { $outText = [string](Get-Content $outFile -Raw -ErrorAction SilentlyContinue) }
        if (Test-Path $errFile) { $errText = [string](Get-Content $errFile -Raw -ErrorAction SilentlyContinue) }
        $http = 0
        [void][int]::TryParse($outText.Trim(), [ref]$http)
        $ok = ($exit -eq 0 -and $http -ge 200 -and $http -lt 500)
        $err = ''
        if (-not $ok) {
            $err = (($errText + ' ' + $outText) -replace '\s+', ' ').Trim()
            if (-not $err) { $err = "curl exit $exit" }
        }
        return @{ ok = $ok; status = $http; proxy = $ProxyUrl; error = $err }
    } finally {
        Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue
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
        if ($proxy -match '127\.0\.0\.1:(\d+)$' -or $proxy -match 'localhost:(\d+)$') {
            if (-not (Test-LocalProxyPort -Port ([int]$matches[1]))) { continue }
        }
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
