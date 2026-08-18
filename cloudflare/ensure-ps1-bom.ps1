# Ensure all ps1 under project root use UTF-8 BOM (ASCII-only script)
$Root = Split-Path $PSScriptRoot -Parent
$utf8 = [Text.UTF8Encoding]::new($false)
$utf8bom = [Text.UTF8Encoding]::new($true)
Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -eq '.ps1' } |
    Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' } |
    ForEach-Object {
        $bytes = [IO.File]::ReadAllBytes($_.FullName)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { return }
        $text = $utf8.GetString($bytes)
        [IO.File]::WriteAllText($_.FullName, $text, $utf8bom)
    }
