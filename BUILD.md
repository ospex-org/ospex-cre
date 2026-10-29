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

The v3 workflow in `games/` is rebuilt from `build/v3-osgames.json` the same way. Every address in
that spec and in the committed template is a placeholder, so a build names them all, and the owner:

```bash
bun build/fingerprint.ts build/v3-osgames.json --set receiverAddress=0x... --set eventAddress=0x...   --set secretOwner=0x... --set payoutAddress=0x... --owner 0x... --json
```

The template also carries the tick's schedule and shard count. They are not set on the command line:
a change to either is an edit to the committed template, and a new id with it.

The scoring program is inside this workflow's binary, so its id moves with the program. Checked
on 27 Oct 2026 (Windows 11, Bun 1.3.14, CLI v1.22.0), with stand-in addresses: changing one count
in `AGREE` (`scoring/src/rule.ts`, `afterN` 2 to 3) moved the binary hash and the id, and restoring
it brought both back.

## Traps

* **`cre workflow hash` without `--public_key` hashes under the wrong owner.** On v1.22.0 the
  `hash` command skips the target's `workflow-owner-address` and falls back to the address of
  `CRE_ETH_PRIVATE_KEY`. That is how the same build once read as `0x00539e3e…`. The script always
  passes the owner.
* **The config's bytes are the fingerprint's.** A CRLF checkout of the template is 319 bytes, not
  310, and gives a different id. The script writes the config itself for that reason.
* **The CLI's Brotli encoder is part of the build.** Python's Brotli (the C library 1.2.0) did not
  reproduce the compressed bytes at any quality from 0 to 11. Hash with the CLI.

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

Not yet checked:

* Linux with the pinned CLI v1.22.0. javy is a different binary there, and so is the CLI.
* Any CLI after v1.22.0. A newer encoder could change the compressed bytes, and the id with them.
