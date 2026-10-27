# The forwarder probe, step 3: delete osprobe from the private registry, then list it. The CLI
# shows what it found for the name and asks to confirm. Nothing is sent on chain; the consumer
# stays where it is.
#
#   powershell -ExecutionPolicy Bypass -File "<this file>"

$ErrorActionPreference = "Stop"
$probe = Split-Path -Parent $PSScriptRoot
Set-Location $probe

# --- Command 1 of 3: delete (answer the confirmation the CLI prints)

cre workflow delete ./workflow --target probe-settings

# --- Command 2 of 3: delete again: the registry answering "workflow not found" is the proof it is gone

cre workflow delete ./workflow --target probe-settings --non-interactive --yes

# --- Command 3 of 3: list the private registry (the listing is an index that can keep showing a deleted workflow long after; the registry's answer above is what counts)

cre workflow list --registry private
