# The forwarder probe, step 2: change one byte of the config (the tag, osprobe-a to osprobe-b) and
# deploy again. On the private registry that is an update: a new workflow id, E2, under the same
# owner. The next delivery carries E2 and the new tag. Nothing is sent on chain.
#
#   powershell -ExecutionPolicy Bypass -File "<this file>"

$ErrorActionPreference = "Stop"
$probe = Split-Path -Parent $PSScriptRoot
Set-Location $probe
$configPath = Join-Path $probe "workflow\config.json"

# --- Command 1 of 3: refuse unless the config is step 1's (tag osprobe-a, a filled consumer)

$text = [System.IO.File]::ReadAllText($configPath)
if (-not $text.Contains('"tag": "osprobe-a"')) {
    Write-Host "refused: workflow/config.json does not carry the tag osprobe-a; run step 1 first"
    exit 1
}
if ($text.Contains('0x0000000000000000000000000000000000000000')) {
    Write-Host "refused: workflow/config.json does not name the consumer; run step 1 first"
    exit 1
}

# --- Command 2 of 3: write the tag osprobe-b (the one changed byte)

$text = $text.Replace('"tag": "osprobe-a"', '"tag": "osprobe-b"')
[System.IO.File]::WriteAllText($configPath, $text, (New-Object System.Text.UTF8Encoding $false))
Get-Content $configPath
Write-Host ("config carries the tag osprobe-b: " + ([System.IO.File]::ReadAllText($configPath)).Contains('"tag": "osprobe-b"'))

# --- Command 3 of 3: deploy again (the screen says it will update the existing workflow and shows the new id, E2)

cre workflow deploy ./workflow --target probe-settings
