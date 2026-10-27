# The forwarder probe: read every delivery the consumer keeps. Reads only; nothing is sent.
#
#   powershell -ExecutionPolicy Bypass -File "<this file>" -Probe 0x<the probe consumer on Polygon>
#   (add -Rpc <url> to read through another Polygon node)

param(
    [Parameter(Mandatory = $true)][string]$Probe,
    [string]$Rpc = "https://polygon-bor-rpc.publicnode.com"
)

$ErrorActionPreference = "Continue"
$env:FOUNDRY_DISABLE_NIGHTLY_WARNING = "1"
$forwarder = "0x76c9cf548b4179F8901cda1f8623568b58215E62"

# --- Command 1 of 4: the fixed forwarder and the count

Write-Host ("i_forwarder: " + (cast call $Probe "i_forwarder()(address)" --rpc-url $Rpc))
Write-Host ("i_forwarder is the production forwarder: " + ((cast call $Probe "i_forwarder()(address)" --rpc-url $Rpc).Trim().ToLower() -eq $forwarder.ToLower()))
$count = [int](cast call $Probe "count()(uint256)" --rpc-url $Rpc)
Write-Host ("count: " + $count)

# --- Command 2 of 4: each delivery, the metadata fields as the reporter reads them, and the report decoded

for ($i = 0; $i -lt $count; $i++) {
    Write-Host ""
    Write-Host ("delivery " + $i)
    Write-Host "  fields (workflowId, workflowName, workflowOwner, reportId, metadataLength, reportLength):"
    cast call $Probe "fields(uint256)(bytes32,bytes10,address,bytes2,uint256,uint256)" $i --rpc-url $Rpc | ForEach-Object { Write-Host ("    " + $_) }
    Write-Host "  delivery (metadata, report, sender, blockNumber, blockTime, workflowId, workflowName, workflowOwner, reportId):"
    cast call $Probe "delivery(uint256)((bytes,bytes,address,uint64,uint64,bytes32,bytes10,address,bytes2))" $i --rpc-url $Rpc | ForEach-Object { Write-Host ("    " + $_) }
    $report = (cast call $Probe "reportOf(uint256)(bytes)" $i --rpc-url $Rpc).Trim()
    Write-Host "  report decoded as (uint64 firedAt, string tag):"
    cast abi-decode "x()(uint64,string)" $report | ForEach-Object { Write-Host ("    " + $_) }
}

# --- Command 3 of 4: the name hash a live delivery should carry: the first ten hex characters of SHA-256("osprobe"), as ASCII bytes

$sha = [System.Security.Cryptography.SHA256]::Create()
$hex = ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::ASCII.GetBytes("osprobe"))) -replace "-", "").ToLower()
$ten = $hex.Substring(0, 10)
$asBytes = "0x" + (([System.Text.Encoding]::ASCII.GetBytes($ten) | ForEach-Object { $_.ToString("x2") }) -join "")
Write-Host ""
Write-Host ("expected workflowName for osprobe: " + $asBytes + "  (ASCII '" + $ten + "')")
Write-Host "expected workflowOwner: 0x48bA031941af7e8657B5C8B8Ea130717A9d7c443 (the organisation's derived owner)"

# --- Command 4 of 4: the forwarder's own record of each delivery to this probe over the last 9,000 blocks (ReportProcessed: receiver, workflowExecutionId, reportId, result)

$latest = [int64](cast block-number --rpc-url $Rpc)
$from = $latest - 9000
if ($from -lt 0) { $from = 0 }
$topic1 = "0x" + ("0" * 24) + $Probe.Substring(2).ToLower()
Write-Host ""
Write-Host ("ReportProcessed logs for this probe, blocks " + $from + " to " + $latest + ":")
cast logs --rpc-url $Rpc --from-block $from --to-block $latest --address $forwarder "ReportProcessed(address,bytes32,bytes2,bool)" $topic1
