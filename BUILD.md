# Rebuilding the fingerprint

A Chainlink workflow's fingerprint is its workflow id. The games set approves a reporter that
fixes one workflow id, so "what was approved is what was announced" holds only if anyone can
rebuild that id from this repository. These are the steps, and what has and has not been checked.

## What the id is

`cre workflow deploy` registers

```
id = sha256(owner ‖ name ‖ binary ‖ config ‖ secretsURL), with the first byte set to 0
```

* **owner:** the workflow owner's 20 bytes. A deploy with `--unsigned` takes it from the target's
  `account.workflow-owner-address` in `project.yaml`.
* **name:** the target's `workflow-name` in the workflow's `workflow.yaml`.
* **binary:** the compiled wasm, compressed with the CLI's own Brotli encoder (`andybalholm/brotli`
  v1.2.1 at its defaults). It is not the raw wasm, and not the base64 text of `binary.wasm.br.b64`.
* **config:** the config file's exact bytes.
* **secretsURL:** empty.

Sources: cre-cli v1.22.0, `cmd/workflow/deploy/prepare.go` and `cmd/workflow/hash/hash.go`;
chainlink-common at `87b1e75d2c33`, `pkg/workflows/utils.go`.

## The steps

Tools, pinned: the CRE CLI **v1.22.0**, **Bun 1.3.14**, and each workflow's committed
`bun.lock`. The compiler, `cre-compile` from `@chainlink/cre-sdk` 1.13.0, comes from the
lockfile. It bundles with Bun and compiles with javy v8.1.0, which it downloads per platform
from javy's GitHub release, checking the release's SHA-256.

```bash
git clone https://github.com/ospex-org/ospex-cre && cd ospex-cre
(cd oracle && bun install --frozen-lockfile)
bun build/fingerprint.ts build/v2-osverify.json
```

`build/fingerprint.ts` does three things:

1. It writes the config from the committed template (`build/config.ts`): the template parsed, the
   spec's values set, written back as two-space JSON with LF line endings and one trailing newline.
   A checkout's line endings never reach the bytes.
2. It runs `cre workflow hash` with `--public_key <owner>`. That command compiles the workflow from
   source and hashes it the way a deploy does. Nothing is registered, signed or sent.
3. It prints the config hash, the binary hash and the id, each against the spec's expected value.

Expected for v2's live workflow, `osverify`:

| | |
|---|---|
| config | `9a7ab7e33948b572aa6dd0c9762f444573cadd564addb804f594536b57d4724b` (310 bytes) |
| binary | `5929b9c675ae03ec67e6a5b4adba8ff2be5164e41e7dcdbe7b670954638da755` |
| id | `0x0097efdade80ff0a9557d927a1c07075a453bba9cd0fae7e22519c613ec47805`, the id the registry holds |

For a new deploy, set every field of the spec's `config` on the command line, and the owner. A
field left out keeps v2's value. A deploy script does this with the reporter's predicted address:

```bash
bun build/fingerprint.ts <spec.json> --set receiverAddress=0x... --set eventAddress=0x... \
  --set secretOwner=0x... --owner 0x... --json
```

The script refuses an unknown flag, a second spec path and a flag without its value, so a mistyped
flag can't fall back to the spec's own values and report them as matching. `--set=key=value` and
`--owner=0x...` read the same as the spaced forms.

## What this rebuild covers

The steps above rebuild v2's live workflow, `oracle/`, which does not import `scoring/`. So the id
shows the method, and nothing about the scoring program. The scoring program enters an id only
through the workflow that imports it, and that workflow's id is rebuilt the same way once it
exists. Its own check: change one count in `AGREE` (`scoring/src/rule.ts`) and rebuild, and the id
moves; restore it, and the id comes back.

## The games workflow

The live v3 workflow, `osgames`, is rebuilt from `build/v3-osgames.json` the same way, at the commit
that set its values (`ad8d194`, merged as `d8263c2`; main `1058f20` changed nothing under `games/` or
`scoring/`). Later commits build `osgames2`, the workflow with the run-line, registered beside it under
its own name: at those commits `games/workflow.yaml` names `osgames2`, so the fingerprint script refuses
the `osgames` spec there, and `osgames2` has its own spec (the next section). The `osgames` spec carries
the deploy's addresses (the reporter and the games set as the deploy script predicted them from the
deployer's nonce on 31 Oct 2026, the workflow owner, the secret owner, which is the same wallet, and
the payout wallet) and the hashes expected of them. The committed template keeps its placeholders;
the spec's values are set over it, and the owner is given:

```bash
bun build/fingerprint.ts build/v3-osgames.json --owner 0x89fe160bBBe59eAF428f23F095B71E5C0EdCDfa3
```

Expected for v3's games workflow, `osgames`, at the commit that set these values:

| | |
|---|---|
| config | `752fa64b5aa480fd382b419622a193b780279ffc595ec3565ed2f665402b1905` (397 bytes) |
| binary | `817f4734bbe65b2af0db614a15d5237f4a3226c817094e2ee0a48a979025a41e` |
| id | `0x000411d08fb9976d6e7c8695b591783fbc060b1f1648dd8113271fb618193119` |

A build with other addresses, such as the rehearsal's stand-ins (`games/rehearsal/README.md`), names
each with `--set` and the owner with `--owner`; the spec's expected values then do not apply, since
they belong to the spec's own inputs:

```bash
bun build/fingerprint.ts build/v3-osgames.json --set receiverAddress=0x... --set eventAddress=0x... \
  --set secretOwner=0x... --set payoutAddress=0x... --owner 0x... --json
```

The template also carries the tick's schedule and shard count. They are not set on the command line:
a change to either is an edit to the committed template, and a new id with it.

The scoring program is inside this workflow's binary, so its id moves with the program. Checked
on 27 Oct 2026 (Windows 11, Bun 1.3.14, CLI v1.22.0), with stand-in addresses: changing one count
in `AGREE` (`scoring/src/rule.ts`, `afterN` 2 to 3) moved the binary hash and the id, and restoring
it brought both back.

## The games workflow with the run-line

`osgames2`, registered beside `osgames` on 12 Nov 2026, is rebuilt from `build/v3-osgames2.json` at
the commit that adds that spec, or at a later one that changes no input of the build. The inputs
are the spec, the files the compile reads under `games/` and `scoring/`, `games/workflow.yaml` and
the config template, `project.yaml`, `games/bun.lock` with the packages it fixes, the code under
`build/` that writes the config and runs the hash, and the pinned tools. A commit that edits only a
README changes none of them, and that case has been rebuilt (the last section). Any other
later commit is compared with this list before its rebuild is called the registered one. The spec
names the owner, so the command gives none:

```bash
(cd games && bun install --frozen-lockfile)
bun build/fingerprint.ts build/v3-osgames2.json
```

Expected for `osgames2`:

| | |
|---|---|
| config | `b845f3d347c4dfdbad302d79b69b59b505babd03706a65c4fd6b586780606092` (475 bytes) |
| binary | `5de5819df15a78af5928a6504cffe79bc3575ebb5ba824b435563ba580b2db46` |
| id | `0x0025a0d42363aacf20a721fbb0fddd6cbe01c3a12a4489f1c9f4c42544784989`, the id the registry holds |

The spec sets five values over the template. The games set, the secret owner and the payout wallet
are `osgames`'s, and so is the owner. The reporter is a second one, approved beside the first on
12 Nov 2026: its address was planned on 11 Nov 2026, before the registration, from the deployer's
address and a salt through the CreateX factory's `deployCreate3`, not from a nonce. The fifth value
is the run-line's route, the table's Data API URL.

This id was registered before it was published. The registry lists an id once, for the first linked
owner that registers it, so the registration was sent from main at `1f9573c` with the spec in the
working tree, and the spec was committed after the registry held the id. That commit changes nothing
under `games/` or `scoring/`: the binary is `1f9573c`'s.

The order that deploy ran in, step by step, and the procedure for the next version are in
`DEPLOY.md`.

## CLI versions

Two versions of the CRE CLI are used, each for its own commands.

* **`cre-1.22.0` compiles, hashes, deploys and simulates.** The registered workflow's binary hash,
  config hash and id are bound to v1.22.0's build. Don't run `cre update` (it also times out on
  Starlink); install a version by hand.
* **`cre`, v1.39.0, is for the Vault secrets commands only.** On v1.22.0, `secrets create` and
  `secrets list` send the allowlist transaction but fail to decode the reply
  (`proto: unknown field "requestId"`).
* **`simulate` and `deploy` print different binary hashes for the same source.** `simulate` prints
  the SHA-256 of the raw wasm; `deploy` and `workflow hash` print the SHA-256 of the
  Brotli-compressed wasm.
* **On Windows, run in Git Bash.** Run the fingerprint step as
  `CRE_BIN=cre-1.22.0 bun build/fingerprint.ts …`. The script runs the CLI that `CRE_BIN` names, or
  `cre` when it is unset, and prints which binary it ran and the version that binary reports. Pass
  paths as `"$(cygpath -w …)"`, and bridge the seat keys in front of the command as
  `SEAT1_KEY="$OSPEX_SEAT1_KEY" …`: names only, never values.

## Traps

* **`cre workflow hash` without `--public_key` hashes under the wrong owner.** On v1.22.0 the
  `hash` command skips the target's `workflow-owner-address` and falls back to the address of
  `CRE_ETH_PRIVATE_KEY`. That is how the same build once read as `0x00539e3e…`. The script always
  passes the owner.
* **The config's bytes are the fingerprint's.** A CRLF checkout of the template is 319 bytes, not
  310, and gives a different id. The script writes the config itself for that reason.
* **The CLI's Brotli encoder is part of the build.** Python's Brotli (the C library 1.2.0) did not
  reproduce the compressed bytes at any quality from 0 to 11. Hash with the CLI.
* **A deploy's usage report carries the workflow id.** On v1.22.0, signed in, `workflow deploy` sends
  Chainlink a usage report when the command ends. The report carries the workflow id from the moment
  the build is hashed, before anything is uploaded or registered (`cmd/workflow/deploy/deploy.go`,
  `internal/telemetry/emitter.go`). `CRE_TELEMETRY_DISABLED=true` switches the report off, and
  `osgames2` was registered with it set. `workflow hash` loads no sign-in and so sends no report
  (`cmd/root.go`, `internal/telemetry/sender.go`): the fingerprint step is the same with or without
  the switch.

## What has been checked, and where

On Windows 11, Bun 1.3.14, CLI v1.22.0, on 22 Oct 2026:

* The id was rebuilt three ways: from the deploy's own `binary.wasm.br.b64`; from a clean clone of
  main compiled from source; and with `build/fingerprint.ts` from the committed template. A clone
  checked out with LF sources gave the same id as a CRLF one: source line endings do not reach
  the wasm.
* The deploy's 19:39 compile on 28 Jun and today's are byte-identical, both the wasm (`5434b2f3…`)
  and Bun's bundle (`95e04a91…`).

On Linux, Bun 1.3.14, CLI v1.21.0, on 24 Oct 2026: one independent rebuild matched all three values
above.

On Linux, Bun 1.3.14, CLI v1.22.0, on 31 Oct 2026: one independent rebuild from main at `d8263c2`
matched `osgames`'s three values.

On Windows 11, Bun 1.3.14, CLI v1.22.0, on 11 and 12 Nov 2026: `osgames2`'s three values, from main at
`1f9573c` with the spec in the working tree, the tree the registration was sent from. A clean export
of `1f9573c` gave the same binary hash under a stand-in reporter address.

On Linux, Bun 1.3.14, CLI v1.22.0, on 11 Nov 2026: one independent rebuild from `1f9573c` matched
`osgames2`'s three values.

On Linux, Bun 1.3.14, CLI v1.22.0, on 13 Nov 2026: one independent rebuild matched `osgames2`'s
three values at a commit that differs from `faf8a11` in no input of the build: under `games/` it
changes one sentence of the README.

Not yet checked:

* `osverify` on Linux with the pinned CLI v1.22.0: its Linux rebuild above used v1.21.0. javy is a
  different binary there, and so is the CLI.
* Any CLI after v1.22.0. A newer encoder could change the compressed bytes, and the id with them.
