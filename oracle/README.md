# Ospex CRE oracle workflow

A Chainlink CRE (Chainlink Runtime Environment) workflow that resolves Ospex contests from multiple
sports-data providers and reports the result on-chain to `CreOracleReceiver`. It is the CRE
successor to the protocol's Chainlink Functions oracle.

A single EVM **log trigger** (`CreOracleReceiver.CreOracleRequested`) drives three request types,
selected by the event's `requestType`:

- **verify** (`0`) — 3-of-3 agreement across TheRundown + Sportspage + JsonOdds on a contest's
  league, teams and start time; reports the league id + start time.
- **market-update** (`1`) — current moneyline / spread / total odds for the contest from JsonOdds;
  reports the eight odds/line fields.
- **score** (`2`) — 3-of-3 agreement on the final score; reports away + home scores.

The report envelope is `abi.encode(uint8 requestType, uint256 chainId, address receiver, uint64 requestNonce, bytes payload)`, fixed to match the receiver — `chainId` + `receiver` are domain separation, and `requestNonce` is echoed and enforced for market-update (the stale-odds guard). The three inner `payload` shapes mirror the `CreOracleReceiver` verify / market / score handlers exactly.

## Files

- `main.ts` — entry: log trigger → confidential-HTTP provider fetch → consensus → `runtime.report` → `writeReport`.
- `lib.ts` — pure, unit-tested helpers (deterministic UTC date parsing, packed cross-provider identity, odds-tick / spread math) **and the ABI contract** (event signature + report-envelope/payload shapes) shared with `CreOracleReceiver`.
- `main.test.ts` / `abi.test.ts` — `bun test` helper unit tests and ABI regression tests for the event/report encoding.
- `config.staging.example.json` / `config.production.example.json` — per-target config **templates**. Copy to `config.staging.json` / `config.production.json` (gitignored) and fill the receiver + event address and secret owner. The loader rejects zero/placeholder addresses, so an unfilled copy fails fast.
- `workflow.yaml` / `../project.yaml` — CRE CLI target settings.
- `../secrets.yaml` — secret **names** mapped to env vars (no secret values).

## Build / test (no secrets required)

```bash
cd oracle
bun install --frozen-lockfile           # reproducible deps -> stable WASM build hash
bun run typecheck                       # tsc --noEmit
bun test                                # lib.ts unit + ABI regression tests
cd .. && cre workflow build ./oracle    # compile to WASM
```

Full prerequisites (CRE CLI, `ETH_MAINNET_RPC_URL`, owner / secret-owner keys) are in the [root README](../README.md).

## Configuration

Copy the target template and fill it in (the real configs are gitignored):

```bash
cp config.staging.example.json config.staging.json   # fill receiverAddress / eventAddress / secretOwner
```

API keys (`RAPIDAPI_KEY`, `JSONODDS_KEY`) and the deployer/owner key live in a gitignored `.env`.
For simulation they are read from `.env`; for a live DON they are uploaded to the CRE Vault with
`cre secrets create` and referenced by name from `secrets.yaml`. **Never commit real keys.**

## Simulate

```bash
cre workflow simulate ./oracle --target staging-settings \
  --evm-tx-hash 0x<createTx> --evm-event-index <i>
```

## Deploy

Deploy the `CreOracleReceiver` contract first, set `receiverAddress` + `eventAddress` (and
`secretOwner`) in the target config, create the Vault secrets, then:

```bash
cre workflow deploy ./oracle --target staging-settings
```

Then emit a request (`CreOracleReceiver.createContestAndRequestVerify(...)`,
`requestMarketUpdate(...)`, or `requestScore(...)`) and confirm the contest transitions on-chain.

## Determinism

The workflow runs under DON consensus in a QuickJS/WASM runtime (not Node). All cross-node logic is
deterministic — integer/string math only, UTC date parsing independent of the host timezone, no
`Date.now` or `Math.random`. Verify and score require cross-provider agreement (3-of-3) before
reporting; market-update is single-source JsonOdds.
