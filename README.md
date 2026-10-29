# ospex-cre

The Chainlink CRE (Chainlink Runtime Environment) oracle for the [Ospex](https://ospex.org) protocol — a
zero-vig peer-to-peer sports prediction protocol on Polygon. This workflow is the CRE successor to the
protocol's Chainlink Functions oracle: it resolves contests from multiple sports-data providers under DON
consensus and reports the result on-chain to the `CreOracleReceiver` contract.

The workflow lives in **[`oracle/`](./oracle)** — see [`oracle/README.md`](./oracle/README.md) for the
three request types, the report ABI contract, the determinism rules, and simulate/deploy details.

## Status

- **Polygon Amoy (testnet):** all three request types — verify, market-update, and score — have been
  proven end-to-end through the live DON.
- **Polygon mainnet:** **live (R5).** The CRE oracle has been deployed on Polygon mainnet since
  2026-06-28, reporting to the `CreOracleReceiver` at `0x06e3470012039797119Ae30e1236169304F9220C`
  (chain `137`). The EVM target is selected from config (`chainSelectorName`), and the workflow **fails
  closed** when `chainSelectorName` and `chainId` disagree — it is not hardcoded to a network. The
  committed `config.production.example.json` targets `polygon-mainnet` / `chainId` `137` and remains a
  **template**: operators copy it to the gitignored `config.production.json` and fill `receiverAddress`,
  `eventAddress`, and `secretOwner`. Before a (re)deploy, confirm the tenant/DON serves `polygon-mainnet`
  (`cre workflow supported-chains`); use `config.staging.example.json` for the Amoy slice.

## Layout

| Path | What |
|---|---|
| `oracle/main.ts` | workflow entry: EVM log trigger → confidential-HTTP provider fetch → DON consensus → report → `writeReport` |
| `oracle/lib.ts` | pure, unit-tested helpers + the ABI contract shared with `CreOracleReceiver` |
| `oracle/abi.test.ts`, `oracle/main.test.ts` | `bun test` ABI-regression + helper unit tests |
| `oracle/config.*.example.json` | per-target config templates — copy to `config.*.json` and fill |
| `oracle/workflow.yaml`, `project.yaml` | CRE CLI target settings |
| `secrets.yaml` | secret **names** mapped to env vars (no secret values) |
| `scoring/` | v3: the scoring program's feed table and its four readers, which import nothing from Chainlink — see [`scoring/README.md`](./scoring/README.md) |
| `games/` | v3: the Chainlink workflow, a thin wrapper on `scoring/` writing through the games set's reporter — see [`games/README.md`](./games/README.md) |
| `probe/` | the forwarder probe, run on 27 Oct 2026: what a consumer on Polygon receives through the production forwarder — see [`probe/README.md`](./probe/README.md) |

## Prerequisites

- **[Bun](https://bun.sh)** (package manager + test runner) and the **[CRE CLI](https://docs.chain.link/cre)** (`cre`).
- A gitignored **`.env`** with the provider API keys named in [`secrets.yaml`](./secrets.yaml). Never commit real keys.
- For on-chain CRE registry operations (`cre workflow deploy`, `cre workflow hash`, owner linking):
  - **`ETH_MAINNET_RPC_URL`** — the CRE WorkflowRegistry lives on Ethereum mainnet; it is referenced from
    `project.yaml`. Registry commands fail without it.
  - the workflow **owner address** and a **linked owner key** (or `--public_key`) for registry ownership.
  - a **Vault secret owner** (the CRE deploy wallet) under which the keys in `secrets.yaml` are created
    with `cre secrets create`.

## Setup

```bash
cd oracle
bun install --frozen-lockfile                       # reproducible deps -> stable WASM build hash
cp config.staging.example.json config.staging.json  # then fill receiverAddress / eventAddress / secretOwner
bun test                                            # ABI-regression + helper unit tests
bun run typecheck                                   # tsc --noEmit
cd .. && cre workflow build ./oracle                # compile to WASM
```

The config loader rejects unfilled (zero) addresses, so a freshly-copied config fails fast at run/simulate
until you fill it. See [`oracle/README.md`](./oracle/README.md) for simulate and deploy.
