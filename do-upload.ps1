$ErrorActionPreference = 'Continue'
$Log = Join-Path $PSScriptRoot 'upload-log.txt'
$logLines = New-Object System.Collections.Generic.List[string]

function Log([string]$msg) {
    $logLines.Add($msg)
    Write-Host $msg
}

function Flush-Log {
    $text = $logLines -join [Environment]::NewLine
    Set-Content -Path $Log -Value $text -Encoding UTF8
}

function Invoke-OaoGit {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
    & git -c "user.name=$script:GitName" -c "user.email=$script:GitEmail" @GitArgs
}

function Test-GitTracked([string]$Path) {
    $out = Invoke-OaoGit ls-files -- $Path 2>$null
    return -not [string]::IsNullOrWhiteSpace(($out | Out-String).Trim())
}

$exitCode = 0
try {
    $logLines.Add("=== OAO upload $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===")
    Set-Location -LiteralPath $PSScriptRoot

    $script:User = 'wh9007'
    $script:Repo = 'oao-platform'
    $script:GitName = 'wh9007'
    $script:GitEmail = 'wh9007@users.noreply.github.com'

    $tokenFile = Join-Path $PSScriptRoot 'git-token.txt'
    if (-not (Test-Path -LiteralPath $tokenFile)) {
        Log '[FAIL] git-token.txt not found. Run upload bat first.'
        $exitCode = 1
        throw 'missing token file'
    }

    $token = $null
    Get-Content -LiteralPath $tokenFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $token -and $line -match '^(ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)$') {
            $token = $line
        }
    }
    if (-not $token) {
        Log '[FAIL] No valid ghp_ or github_pat_ token in git-token.txt'
        Log 'Create one at: https://github.com/settings/tokens/new?scopes=repo'
        $exitCode = 1
        throw 'invalid token file'
    }
    Log '[OK] Token loaded'

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Log '[FAIL] Git is not installed'
        $exitCode = 1
        throw 'git missing'
    }

    $encodedToken = [uri]::EscapeDataString($token)
    $origin = "https://github.com/$($script:User)/$($script:Repo).git"
    $pushUrl = "https://$($script:User):${encodedToken}@github.com/$($script:User)/$($script:Repo).git"

    if (-not (Test-Path -LiteralPath '.git')) {
        Invoke-OaoGit init | Out-Null
    }
    Invoke-OaoGit branch -M main | Out-Null

    $remotes = @(Invoke-OaoGit remote 2>&1)
    if ($remotes -contains 'origin') {
        Invoke-OaoGit remote set-url origin $origin | Out-Null
    } else {
        Invoke-OaoGit remote add origin $origin | Out-Null
    }

    foreach ($p in @('upload-log.txt', 'git-inv-output.txt')) {
        if (Test-GitTracked $p) {
            Log "[INFO] Untrack $p"
            Invoke-OaoGit rm --cached --ignore-unmatch -- $p | Out-Null
        }
    }

    foreach ($p in @(
            'oao-translate/web/.next',
            'oao-translate/server/node_modules',
            'oao-translate/web/node_modules',
            'oao-translate/server/dist'
        )) {
        if (Test-Path -LiteralPath (Join-Path $PSScriptRoot $p)) {
            Invoke-OaoGit rm -r --cached --ignore-unmatch -- $p 2>$null | Out-Null
        }
    }

    $uploadList = @(
        'OAO.html',
        'index.html',
        'oao-meeting-signal.js',
        'oao-services.cmd',
        '.nojekyll',
        '.gitignore',
        'git-token.txt.example',
        'local-config.example.txt',
        'do-upload.ps1',
        'cloudflare/oao-ai-worker.js',
        'cloudflare/meeting-room.js',
        'cloudflare/wrangler.toml.example',
        'cloudflare/tunnel-token.txt.example',
        'ipfs-ens/index.html'
    )

    foreach ($f in $uploadList) {
        $full = Join-Path $PSScriptRoot $f
        if (Test-Path -LiteralPath $full) {
            Invoke-OaoGit add -- $f | Out-Null
        }
    }

    Get-ChildItem -Path $PSScriptRoot -File | Where-Object {
        $_.Name -match '\.(bat|txt|cmd)$' -and
        $_.Name -notin @('upload-log.txt', 'git-token.txt', 'git-inv-output.txt')
    } | ForEach-Object {
        Invoke-OaoGit add -- $_.Name | Out-Null
    }

    $cloudflareDir = Join-Path $PSScriptRoot 'cloudflare'
    if (Test-Path -LiteralPath $cloudflareDir) {
        Get-ChildItem -Path $cloudflareDir -File | Where-Object {
            $_.Name -notmatch '^(tunnel-token\.txt|wrangler\.toml)$' -and $_.Extension -ne '.json'
        } | ForEach-Object {
            Invoke-OaoGit add -- ("cloudflare/" + $_.Name) | Out-Null
        }
    }

    $oaoAddPaths = @(
        'oao-translate/README.md',
        'oao-translate/Dockerfile',
        'oao-translate/docker-compose.yml',
        'oao-translate/package.json',
        'oao-translate/nginx',
        'oao-translate/server/src',
        'oao-translate/server/package.json',
        'oao-translate/server/package-lock.json',
        'oao-translate/server/tsconfig.json',
        'oao-translate/server/.env.example',
        'oao-translate/web/app',
        'oao-translate/web/components',
        'oao-translate/web/hooks',
        'oao-translate/web/lib',
        'oao-translate/web/types',
        'oao-translate/web/public',
        'oao-translate/web/package.json',
        'oao-translate/web/package-lock.json',
        'oao-translate/web/tsconfig.json',
        'oao-translate/web/next.config.js',
        'oao-translate/web/next.config.mjs',
        'oao-translate/web/postcss.config.js',
        'oao-translate/web/postcss.config.mjs',
        'oao-translate/web/tailwind.config.ts',
        'oao-translate/web/tailwind.config.js',
        'oao-translate/web/.env.local.example'
    )
    foreach ($p in $oaoAddPaths) {
        $full = Join-Path $PSScriptRoot $p
        if (Test-Path -LiteralPath $full) {
            Invoke-OaoGit add -A -- $p | Out-Null
        }
    }
    Log '[OK] Staged OAO.html and oao-translate sources'

    $pending = (Invoke-OaoGit status --porcelain 2>&1 | Out-String).Trim()
    if ($pending) {
        Log '[INFO] Committing changes...'
        $commitMsg = 'Update OAO site ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
        Invoke-OaoGit commit -m $commitMsg 2>&1 | ForEach-Object { Log $_ }
        if ($LASTEXITCODE -ne 0) {
            $exitCode = 1
            throw 'git commit failed'
        }
    } else {
        Log '[INFO] No local changes to commit'
    }

    Flush-Log

    Log '[INFO] Validating GitHub token...'
    $env:GIT_TERMINAL_PROMPT = '0'
    Invoke-OaoGit ls-remote $pushUrl HEAD 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Log '[FAIL] Token invalid, expired, or missing repo scope'
        Log 'Create Classic token with repo scope at github.com/settings/tokens'
        $exitCode = 1
        throw 'token validation failed'
    }
    Log '[OK] Token validated'

    Log '[INFO] Fetching remote main...'
    Invoke-OaoGit fetch $pushUrl main 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) {
        $exitCode = 1
        throw 'git fetch failed'
    }

    Invoke-OaoGit pull $pushUrl main --rebase 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) {
        Log '[INFO] Rebase failed, trying merge...'
        Invoke-OaoGit rebase --abort 2>$null | Out-Null
        Invoke-OaoGit fetch $pushUrl main 2>&1 | Out-Null
        Invoke-OaoGit pull $pushUrl main --no-rebase 2>&1 | ForEach-Object { Log $_ }
        if ($LASTEXITCODE -ne 0) {
            $exitCode = 1
            throw 'git pull failed'
        }
    }

    Log '[INFO] Pushing to GitHub...'
    Invoke-OaoGit push $pushUrl main 2>&1 | ForEach-Object { Log $_ }
    if ($LASTEXITCODE -ne 0) {
        $exitCode = 1
        throw 'git push failed'
    }

    Invoke-OaoGit remote set-url origin $origin | Out-Null

    Log ''
    Log '=========================================='
    Log '[OK] Uploaded to GitHub'
    Log 'Site: https://wh9007.github.io/oao-platform/'
    Log 'Wait ~2 minutes then hard refresh (Ctrl+F5)'
    Log '=========================================='
    $exitCode = 0
}
catch {
    if ($exitCode -eq 0) { $exitCode = 1 }
    Log ''
    Log '=========================================='
    Log ('[FAIL] Upload failed: ' + $_.Exception.Message)
    Log 'Check token, network, and upload-log.txt'
    Log '=========================================='
}
finally {
    Flush-Log
}

exit $exitCode
