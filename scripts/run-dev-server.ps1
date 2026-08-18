# OAO 本地服务器启动器：由 open-oao.ps1 / oao-services.ps1 以隐藏窗口启动
$Root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
$server = Join-Path $Root 'scripts\dev-server.js'
& $node $server
