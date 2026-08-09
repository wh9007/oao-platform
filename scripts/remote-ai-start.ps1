# 兼容入口 — 统一转发到 oao-remote-server.ps1

param(

    [switch]$Menu,

    [switch]$CheckOnly,

    [switch]$SkipDnsCheck

)



$argsList = @()

if ($Menu) { $argsList += '-Menu' }

if ($CheckOnly) { $argsList += '-CheckOnly' }

if ($SkipDnsCheck) { $argsList += '-SkipDnsCheck' }



& (Join-Path $PSScriptRoot 'oao-remote-server.ps1') @argsList

exit $LASTEXITCODE

