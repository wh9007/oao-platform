# 将所有 bat/cmd 转为 GBK，ps1 转为 UTF-8 BOM，修复 CMD 中文乱码
param(
    [string]$Root = (Split-Path $PSScriptRoot -Parent)
)

$utf8 = [Text.UTF8Encoding]::new($false)
$utf8bom = [Text.UTF8Encoding]::new($true)
$gbk = [Text.Encoding]::GetEncoding(936)

function Read-TextSmart([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        return $utf8bom.GetString($bytes, 3, $bytes.Length - 3)
    }
    try {
        $t = $utf8.GetString($bytes)
        if ($t -match '[\u0080-\uFFFF]') { return $t }
    } catch {}
    return $gbk.GetString($bytes)
}

$batCmd = Get-ChildItem -LiteralPath $Root -Recurse -Include *.bat,*.cmd -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' }
$ps1 = Get-ChildItem -LiteralPath $Root -Recurse -Include *.ps1 -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' }

$countBat = 0
$countPs1 = 0

foreach ($f in $batCmd) {
    $text = Read-TextSmart $f.FullName
    $lines = $text -split "`r?`n", -1
    $lines = $lines | Where-Object { $_ -notmatch '^\s*chcp\s+65001\s*>\s*nul\s*$' }
    $text = ($lines -join "`r`n").TrimEnd() + "`r`n"
    [IO.File]::WriteAllText($f.FullName, $text, $gbk)
    Write-Host "[GBK] $($f.FullName)"
    $countBat++
}

foreach ($f in $ps1) {
    $text = Read-TextSmart $f.FullName
    [IO.File]::WriteAllText($f.FullName, $text, $utf8bom)
    Write-Host "[UTF8-BOM] $($f.FullName)"
    $countPs1++
}

Write-Host ''
Write-Host "完成: $countBat 个 bat/cmd 已转 GBK, $countPs1 个 ps1 已转 UTF-8 BOM"
Write-Host '请重新双击 OAO服务器.bat 查看中文是否正常'
