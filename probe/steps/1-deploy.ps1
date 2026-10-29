# The forwarder probe, step 1: name the consumer in the workflow's config, deploy the probe
# workflow to the private registry, and list it. Nothing is sent on chain.
#
#   powershell -ExecutionPolicy Bypass -File "<this file>" -Consumer 0x<the probe consumer on Polygon>

param(
    [Parameter(Mandatory = $true)][string]$Consumer
)

$ErrorActionPreference = "Stop"
$probe = Split-Path -Parent $PSScriptRoot
Set-Location $probe
$configPath = Join-Path $probe "workflow\config.json"

# --- Command 1 of 4: refuse anything but a filled Polygon address

if ($Consumer -notmatch '^0x[0-9a-fA-F]{40}$' -or $Consumer -eq '0x0000000000000000000000000000000000000000') {
    Write-Host "refused: not a filled address: $Consumer"
    exit 1
}

# --- Command 2 of 4: write workflow/config.json with the consumer and the tag osprobe-a (LF, no BOM)

$lines = @(
    '{',
    ('  "consumerAddress": "' + $Consumer + '",'),
    '  "chainSelectorName": "polygon-mainnet",',
    '  "chainId": 137,',
    '  "schedule": "0 */10 * * * *",',
    '  "tag": "osprobe-a"',
    '}'
)
$text = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText($configPath, $text, (New-Object System.Text.UTF8Encoding $false))
Get-Content $configPath
$written = [System.IO.File]::ReadAllText($configPath)
Write-Host ("config names the consumer: " + $written.Contains($Consumer))
Write-Host ("config carries the tag osprobe-a: " + $written.Contains('"tag": "osprobe-a"'))

# --- Command 3 of 4: deploy osprobe to the private registry (the screen shows the derived owner, the three hashes and the workflow id, E1)

cre workflow deploy ./workflow --target probe-settings

# --- Command 4 of 4: list the private registry (the listing can trail the deploy by minutes)

cre workflow list --registry private
