# The forwarder probe

One question, answered on Polygon mainnet before the v3 workflow is built: what does a consumer
receive when a workflow writes to it through the production forwarder, and under which owner, when
the workflow is managed on Chainlink's private registry?

The simulator cannot answer it: its stand-in forwarder hands a receiver placeholder metadata (an
owner of `0xaaaa…`, an id of `0x1111…`), so a simulation never meets the checks the games set's
Chainlink reporter makes. A run through the real forwarder needs a registered workflow, and the
organisation's one linked key is held by v2's timelock until the cutover. The private registry
(Chainlink-hosted, off-chain, three workflows per organisation, no wallet, no gas) is the way to
run one now. Its owner is not a wallet of ours: it is an address Chainlink derives for the
organisation. So this proves the forwarder path and what a consumer is handed under that owner, and
nothing about v3's own plain-wallet owner, which cannot be tried before the cutover.

Everything here is temporary. The workflow is deleted at the end; the consumer stays on chain,
holding nothing and able to do nothing but keep what the forwarder hands it.

## What is here

| Path | What |
|---|---|
| `consumer/src/ForwarderProbe.sol` | the probe consumer: only the one forwarder fixed at deploy may call `onReport`; every delivery is kept whole (metadata, report, sender, block) and the metadata is also read as the reporter reads it (id at bytes 0–32, name hash at 32–42, owner at 42–62, report id at 62–64) |
| `consumer/test/ForwarderProbe.t.sol` | its tests, with no library: a stranger is refused, the delivery is kept as handed and read as the reporter reads it, deliveries keep their order, short and long metadata are kept, the forwarder route (ERC-165 then `onReport`) delivers and bubbles a refusal; on a Polygon fork, the fixed address is `KeystoneForwarder 1.0.0` and a call from it is kept |
| `workflow/` | the probe workflow: a cron fires, the DON signs `abi.encode(uint64 firedAt, string tag)` and writes it to the consumer; `config.json` names the consumer, the chain and the tag |
| `spare/` | a no-op workflow (the cron logs a line) used to try each lifecycle command on the private registry with the pinned CLI before the probe is deployed |
| `project.yaml` | a CRE project root of its own; the one RPC is Polygon, for the simulator |
| `steps/` | the hand-run steps, one file each |

The consumer imports nothing and the tests declare the few cheatcodes they use, so `consumer/` builds
with Foundry alone. The workflows share `package.json`, `bun.lock` (a copy of `oracle/`'s, the same
pinned packages) and `tsconfig.json`.

## Build and test

```bash
cd probe/consumer && forge build && forge test
POLYGON_RPC_URL=https://polygon-bor-rpc.publicnode.com forge test --match-test theFixedAddressIsTheLiveForwarder

cd probe && bun install --frozen-lockfile && bun run typecheck
cre workflow build ./workflow --target probe-settings
cre workflow build ./spare --target probe-settings
cre workflow simulate ./spare --target probe-settings --non-interactive --trigger-index 0
```

The probe workflow simulates the same way once `config.json` names a consumer (the loader refuses
the zero address); without `--broadcast` the write is logged and nothing is sent. Do not simulate
with `--broadcast`: that sends a real transaction from the key in `.env` through the simulator's
mock forwarder.

Measured on 27 Oct 2026, Windows 11, Foundry 1.6.0-nightly, Bun 1.3.14, CLI v1.22.0:

* consumer tests 9 of 9, the fork test included; runtime 3,440 bytes, initcode 3,611;
* the consumer's deploy on a local anvil: **799,185 gas**. At 36.5 gwei that is 0.029 POL; at the
  216 gwei read that night, 0.173 POL. Read Polygon's gas price on the day.

## What the spare showed (CLI v1.22.0, the private registry, 27 Oct 2026)

The docs describe CLI 1.38.0 and say the private registry needs 1.15.0 or later. Everything below
was run here on 1.22.0, nothing sent on chain, the spare deleted after.

* `cre registry list` shows the private registry as `private`, type off-chain. The target in
  `workflow.yaml` selects it with `deployment-registry: "private"` under `user-workflow`; no
  `workflow-owner-address`, no `.env`, no Ethereum RPC and no key were needed for any command.
* **The owner the private registry derives for this organisation is
  `0x48bA031941af7e8657B5C8B8Ea130717A9d7c443`.** `cre workflow hash` on a private target hashes
  under it without `--public_key` (passing that address gives the same hash; a control owner gives
  another), `deploy` prints it as `Owner Address: … (derived)`, and `list --output json` carries it
  as `ownerAddress`. The address holds no code on Polygon or Ethereum.
* `cre workflow deploy ./spare --target probe-settings` compiles, uploads the binary and config to
  Chainlink's storage, and registers at once: `Status: Active`, DON family `zone-a`, no
  transaction. `--non-interactive --yes` runs it without a prompt.
* `cre workflow list --registry private --output json` lists it with `name`, `workflowId`,
  `ownerAddress`, `status`, `registry`. `cre workflow get ./spare --target probe-settings` reads the
  one workflow the target names.
* `pause` and `activate` work and print the id and the new status.
* A redeploy with one byte of the config changed is an **update**: the CLI says "This will update
  the existing workflow", registers the new id (the binary hash unchanged, the config hash and the
  id moved), and keeps the status the workflow had (paused stays paused; an active one stays
  active).
* `delete` lists what it found for the name, with its id and status, and deletes it;
  `--non-interactive --yes` skips the confirmation.
* **The listing is an index, and it can go stale.** After the update, `list` and `get` kept showing
  the pre-update id and status; after the delete they kept showing the workflow, still the old id,
  for over ten minutes, while `delete` run again answered "workflow not found" from the registry
  itself. Read the deploy's own output for the id, and take the registry's answer (a second
  `delete`, or `pause`/`activate`) as the state; `list` and `get` are not it.

## The run

The consumer first, then the workflow, since the workflow's config names the consumer.

### The consumer: one Polygon send, by the operator

From `probe/consumer`, with the operator's working wallet as the sender and a Polygon RPC:

```bash
forge build
forge create src/ForwarderProbe.sol:ForwarderProbe --rpc-url <polygon rpc> --account <wallet> --broadcast \
  --constructor-args 0x76c9cf548b4179F8901cda1f8623568b58215E62
```

(`--constructor-args` last: it takes every argument after it.) The forwarder is Polygon's
`KeystoneForwarder 1.0.0`, the address v2's live reports arrive through and the one the tenant's
`supported-chains` lists for polygon-mainnet. The send costs 799,185 gas. Record the address, the
transaction hash, and the read-back:

```bash
cast call <probe> "i_forwarder()(address)" --rpc-url <polygon rpc>    # 0x76c9…5E62
cast call <probe> "count()(uint256)" --rpc-url <polygon rpc>          # 0
```

### The workflow: on the Chainlink account

Each step is a file in `steps/`, run by one line from PowerShell; each prints what it did and what
to look for. The CLI is signed in on this machine (`cre whoami`).

1. **Deploy** (`steps/1-deploy.ps1 -Consumer <probe address>`): writes the consumer's address into
   `workflow/config.json` with the tag `osprobe-a`, deploys `osprobe` to the private registry, and
   lists it. The screen shows `Registry: private`, `Owner Address: 0x48bA… (derived)`, the three
   hashes, `Workflow registered in private registry`, `Status: Active`. The workflow id on that
   screen is the first id, E1.
2. **Wait for a delivery.** The cron is `0 */10 * * * *`: every ten minutes at the minute mark.
   Nothing says how long the DON takes to pick up a new private-registry workflow; v2's log
   triggers took five to ten minutes. The read-back (below) shows `count()` turn 1. If it is still
   0 after thirty minutes, run `steps/read.ps1` and `cre workflow get ./workflow --target
   probe-settings` and report what they show.
3. **Update** (`steps/2-update.ps1`): changes the tag to `osprobe-b` and deploys again. The screen
   says "This will update the existing workflow" and shows a new workflow id, E2, under the same
   owner, `Status: Active`. The next delivery carries E2 and the tag `osprobe-b`.
4. **Delete** (`steps/3-delete.ps1`): after the second delivery is read back, deletes `osprobe` and
   lists the registry. The listing may still show it for some minutes.

### The read-back

`steps/read.ps1` prints, for every delivery kept: the sender, the block, the four metadata fields
as the reporter reads them, the lengths, and the report decoded as `(uint64 firedAt, string tag)`.
What to expect from a live delivery:

* the sender is the forwarder;
* the metadata is 64 bytes: the workflow id (E1, then E2 after the update), the name hash (the
  first ten hex characters of SHA-256 of `osprobe`, as ASCII bytes), the owner
  `0x48bA031941af7e8657B5C8B8Ea130717A9d7c443`, and a two-byte report id;
* the report decodes to the cron's fire time and the tag.

The same read, by hand:

```bash
cast call <probe> "count()(uint256)" --rpc-url <polygon rpc>
cast call <probe> "fields(uint256)(bytes32,bytes10,address,bytes2,uint256,uint256)" 0 --rpc-url <polygon rpc>
cast call <probe> "delivery(uint256)((bytes,bytes,address,uint64,uint64,bytes32,bytes10,address,bytes2))" 0 --rpc-url <polygon rpc>
```

The id is rebuilt from source the way BUILD.md describes, with the derived owner:
`cre workflow hash ./workflow --target probe-settings --public_key 0x48bA031941af7e8657B5C8B8Ea130717A9d7c443`
with `workflow/config.json` as deployed must print E1 (and, with the tag changed, E2).

## What this does and does not prove

It proves the path: a workflow on the private registry writes to Polygon through the production
forwarder; the forwarder calls `onReport` with 64 bytes of metadata; what those bytes hold; that an
update is a new id under the same owner; and that the consumer, not the transaction, is the receipt
(the forwarder records a refused delivery without reverting). It does not prove v3's own owner: the
reporter fixes an owner and an id, and v3's owner is a plain wallet that takes the organisation's one
linked-key slot at the cutover. That run is the cutover's.
