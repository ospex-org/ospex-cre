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
- **Polygon mainnet:** not yet deployed. The EVM chain target is currently hardcoded to Amoy
  (`AMOY_SELECTOR`, and `chainSelectorName` is a fixed `"polygon-testnet-amoy"` literal). Mainnet requires
  widening the chain selection, deriving the EVM client from `chainSelectorName`, and asserting
  `chainSelectorName ⇄ chainId` at startup. This is a known, tracked pre-mainnet gate. Until it lands,
  `config.production.example.json` is a **reserved, non-functional template** — it pairs a mainnet
  `chainId` with the Amoy selector and would fail fast (`WrongChainId`) if filled and run. Use
  `config.staging.example.json` for the Amoy slice.

## Layout

| Path | What |
|---|---|
| `oracle/main.ts` | workflow entry: EVM log trigger → confidential-HTTP provider fetch → DON consensus → report → `writeReport` |
| `oracle/lib.ts` | pure, unit-tested helpers + the ABI contract shared with `CreOracleReceiver` |
| `oracle/abi.test.ts`, `oracle/main.test.ts` | `bun test` ABI-regression + helper unit tests |
| `oracle/config.*.example.json` | per-target config templates — copy to `config.*.json` and fill |
| `oracle/workflow.yaml`, `project.yaml` | CRE CLI target settings |
| `secrets.yaml` | secret **names** mapped to env vars (no secret values) |

## Prerequisites

- **[Bun](https://bun.sh)** (package manager + test runner) and the **[CRE CLI](https://docs.chain.link/cre)** (`cre`).
- A gitignored **`.env`** with the provider API keys: `RAPIDAPI_KEY`, `JSONODDS_KEY`. Never commit real keys.
- For on-chain CRE registry operations (`cre workflow deploy`, `cre workflow hash`, owner linking):
  - **`ETH_MAINNET_RPC_URL`** — the CRE WorkflowRegistry lives on Ethereum mainnet; it is referenced from
    `project.yaml`. Registry commands fail without it.
  - the workflow **owner address** and a **linked owner key** (or `--public_key`) for registry ownership.
  - a **Vault secret owner** (the CRE deploy wallet) under which `RAPIDAPI_KEY` / `JSONODDS_KEY` are created
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
