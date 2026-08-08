# Tunnel DNS pre-check - exit 1 if argotunnel.com cannot resolve
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Continue'

$fail = $false

$hosts = @(
    'argotunnel.com',
    'cfd-features.argotunnel.com',
    'api.cloudflare.com',
    'region1.v2.argotunnel.com'
)

$srvName = '_v2-origintunneld._tcp.argotunnel.com'
$srvOk = $false
foreach ($dns in @('1.1.1.1', '8.8.8.8', '223.5.5.5')) {
    try {
        $null = Resolve-DnsName $srvName -Type SRV -Server $dns -ErrorAction Stop -DnsOnly
        Write-Host ("  [正常] Tunnel SRV 解析 via {0}" -f $dns) -ForegroundColor Green
        $srvOk = $true
        break
    } catch {}
}
if (-not $srvOk) {
    Write-Host '  [失败] Tunnel SRV 记录无法解析（V2Ray 常导致此问题）' -ForegroundColor Red
    $fail = $true
}

$xray = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -match 'xray|v2ray|clash|sing-box' }
if ($xray -and -not $srvOk) {
    Write-Host ''
    Write-Host '  检测到代理 TUN 网卡，请运行「V2Ray与Tunnel共存.bat」' -ForegroundColor Yellow
}

foreach ($h in $hosts) {
    try {
        $null = Resolve-DnsName $h -ErrorAction Stop -DnsOnly
        Write-Host ("  [正常] {0}" -f $h) -ForegroundColor Green
    } catch {
        Write-Host ("  [失败] {0} - 无法解析" -f $h) -ForegroundColor Red
        $fail = $true
    }
}

if ($fail) {
    Write-Host ''
    Write-Host '=== DNS 修复步骤 ===' -ForegroundColor Yellow
    Write-Host '1. 打开 Windows 设置 -> 网络和 Internet -> WLAN -> 当前 WiFi -> DNS'
    Write-Host '2. 编辑 DNS，选手动，IPv4 开启'
    Write-Host '3. 首选 DNS: 1.1.1.1   备用 DNS: 8.8.8.8'
    Write-Host '4. 保存后，以管理员身份打开 CMD，运行: ipconfig /flushdns'
    Write-Host '5. 若仍失败: 运行 V2Ray与Tunnel共存.bat，或暂时关闭 V2Ray'
    Write-Host '6. 修复后重新运行 OAO服务器.bat 选 1'
    Write-Host ''
    exit 1
}

Write-Host '  DNS 检测通过，正在启动 Tunnel...' -ForegroundColor Green
exit 0
