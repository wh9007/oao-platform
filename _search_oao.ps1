$path = Join-Path $PSScriptRoot 'OAO.html'
$patterns = @{
  '1_profile' = 'userProfileLink|profile\.html'
  '2_wechat' = 'tryRestoreWeChat|applyWeChatSession|wechat.*session|restoreWeChat|WeChatSession'
  '3_logout' = 'logoutAll|clearSession'
  '4_load' = 'DOMContentLoaded|window\.onload|tryRestoreWalletSession'
}
$i = 0
Get-Content -LiteralPath $path -Encoding UTF8 | ForEach-Object {
  $i++
  $line = $_
  foreach ($key in $patterns.Keys | Sort-Object) {
    if ($line -match $patterns[$key]) {
      Write-Output "${key}|${i}|$line"
    }
  }
}
