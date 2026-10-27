# The fork delivery

The wrapper's runs, decided by the scoring program on saved feed answers, delivered through the
production forwarder's own bytecode on a fork of Polygon, into the games set and its Chainlink
reporter as the deploy script deploys them. The receipt of every delivery is the game's state, never
the transaction: the forwarder records a refused report with a result of `false` and does not revert.

Carried from the reporter's reviews as this card's done criteria: the actual score lands, the fee
credits and a withdrawal pays; a refused delivery, a retry, a stale and an out-of-order delivery,
and destination separation each behave as the spec says.

## What makes it production-compatible

* **The forwarder is Chainlink's.** `KeystoneForwarder 1.0.0` at its Polygon address, on the fork,
  with a rehearsal DON set by its owner (impersonated): DON id 7777, config version 1, f = 1, four
  signers. Nothing of the forwarder is replaced; only its signer set is ours.
* **The raw report is built as the DON builds it** (`forwarder.ts`): a 109-byte header (version 1,
  the execution id, the timestamp, the DON id, the config version, the workflow id, the ten bytes of
  the name, the owner, the report id) and the report; f + 1 signatures over
  `keccak256(keccak256(rawReport) || reportContext)`; then `report(receiver, rawReport, reportContext,
  signatures)` from a transmitter. The forwarder hands the receiver bytes 45 to 109 as its metadata,
  as the probe measured on mainnet.
* **The contracts are the deploy script's.** The reporter and the games set from ospex-contracts-v2 at
  `4364295`, deployed by nonce as the script predicts them (the coin check at k, the reporter at k + 1,
  the games set at k + 2) with the launch terms and the chain's own timelock and coin. The reporter
  fixes the forwarder, the owner, the workflow id and the games set; the games set admits the reporter
  by its code hash.
* **The workflow id is the build's.** `build/fingerprint.ts` run for the predicted addresses, the
  rehearsal's owner and payout: `0x0012e8904208ea9f239ebc8a53c500d725086696ee91144b42a5129b4ecc3288`
  (binary `9d7713c6…`, config `7ef38827…`). The reporter takes a report only under that id and owner.
* **The runs are the wrapper's.** `runGame` with the chain read over the fork (`rpc.ts`, a
  synchronous JSON-RPC, since the wrapper's reads are synchronous as the CRE runtime is) and the
  program's saved feed answers (`scoring/test/fixtures.ts`) as of the saved cases' clocks; the fork's
  clock set to each case's moment; the write recorded and delivered by the harness.

## Files

| File | What |
|---|---|
| `fork.ts` | the harness: the forwarder's DON, the deploy, four games, the runs, the deliveries, every check |
| `forwarder.ts` | the forwarder's calling convention: the raw report's header, the signatures, the metadata slice |
| `rpc.ts` | the wrapper's chain interface over a node, with the log query a fork serves, counting its reads |
| `logs.ts` | a game past its creation read from the games set's events, as the games set at `4364295` lets a fork read it; the workflow reads from state once the games set stores it, and this stays with the rehearsal until it is re-run against that games set |
| `requests.ts` | how many feed requests a run makes, per saved case, against the per-execution quota |
| `transcript.txt` | the run of 27 Oct 2026, as printed |

These are run by bun and are not in the workflow's typecheck or its test suite.

## Run

```bash
anvil --fork-url <an archive RPC for Polygon> --fork-block-number 95989900 --port 8547 --chain-id 137
# in ospex-contracts-v2 at 4364295:
FOUNDRY_SRC=src/games FOUNDRY_TEST=test/games FOUNDRY_SCRIPT=none forge build
# in probe/consumer: forge build
bun build/fingerprint.ts build/v3-osgames.json \
  --set receiverAddress=0xB1F0EeB505f51cCb8A81f4DC8dE5bc0a0d136af8 --set eventAddress=0xCC7A40E86E80712379db9E974bA780a42048Bb56 \
  --set secretOwner=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --set payoutAddress=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
  --owner 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --json > workflow.json
cd games && REHEARSAL_WORKFLOW_JSON=../workflow.json CONTRACTS_OUT=<ospex-contracts-v2>/out bun rehearsal/fork.ts
```

The fork block is the saved cases' first clock (22 Oct 2026, 17:30 UTC); the fork must come from an
RPC that serves state at it. The predicted addresses follow the deployer's nonce at that block
(anvil's first account, 28,373), so a fork at another block predicts other addresses, and the id
with them. The accounts are anvil's: the owner is the second, the payout the third, the creator the
fourth, the transmitter the fifth, the signers the sixth to ninth.

## The run, 27 Oct 2026

Windows 11, anvil (Foundry 1.6.0-nightly), Bun 1.3.14, viem 2.34.0; 118 seconds; 51 checks, 22
deliveries, every one read back from the chain (`transcript.txt`).

| | Game | The program's run | Requests | Chain reads | Delivery | Gas |
|---|---|---|---|---|---|---|
| 1 | NBA | start, at the first clock | 18 | 4 calls, 1 header | verified; the start on chain is the program's | 127,169 |
| 2 | NFL | start | 18 | 4, 1 | verified | 127,169 |
| 3 | college football | wait (seat 1's answer for one date was not saved at that clock) | 7 | 4, 1 | the start written by hand | 127,181 |
| 4 | NHL | wait (seat 1 answered 401 in the saved answers) | 1 | 4, 1 | the start written by hand | 127,181 |
| 5 | NBA | dispute record (seat 4's final derived to differ) | 8 | 5 calls, 1 log query, 2 headers | disputed; the record's time read back | 132,428 |
| 6, 7 | college football | score, "inside n: every counting seat, the same final" | 8 | 5, 1, 2 | at 215,000 gas the forwarder reverts before routing; at 220,000 it routes and the score lands: 34-31, the fee credited, the withdrawal pays | 159,688 |
| 8 | | the same score again, a new execution | | | refused: an ended game takes no report | 108,723 |
| 9 | | the same score, the same execution | | | the forwarder reverts: already attempted | |
| 10 | | the record under another owner | | | refused by the reporter, recorded by the forwarder | 84,905 |
| 11 | | the record under another workflow id | | | refused | 84,993 |
| 12 | NFL | the start again | | | refused: a start is written once | 108,246 |
| 13 | NBA | an update, "a vote changed, at seat 2" | 8 | 6, 2, 2 | taken; the day-7 clock did not move | 124,372 |
| 14 | NHL | dispute record | 8 | 5, 1, 2 | disputed | 132,356 |
| 15 | NHL | an update, an hour later | 8 | 6, 2, 2 | taken | 124,312 |
| 16 | NHL | the first record again, after the update | | | taken as an update; the clock did not move | 124,288 |
| 17 | | the college score to the probe consumer | | | taken by it; the games set untouched | 826,037 |
| 18 | | the college score to a second reporter, same id and owner, another games set | | | refused: that set has no such game | 97,225 |
| 19 | NFL | void at hour 24, "every seat that answers shows no final" (the pre-game answers) | 8 | 5, 1, 2 | voided; the fee credited | 157,198 |
| 20 | NBA | day 7, "no three sources agree" | 0 | 6, 2, 2 | voided; the fee credited | 145,866 |
| 21 | NBA | the update after the end | | | refused | 108,526 |
| 22 | NHL | day 7, "three sources or more, the same final" | 0 | 6, 2, 2 | scored | 144,746 |

The payout address withdrew the four fees; the games set held no coin at the end. A delivery that
lands costs the transmitter 124,000 to 160,000 gas; a refused one 85,000 to 109,000. Re-run the same
afternoon, after the workflow's reads moved to state and the harness kept the event reads
(`logs.ts`): the same 51 checks and 22 deliveries, exit 0.

## What it showed beyond the list

* **The forwarder's gas floor covers the reporter.** The forwarder routes only with 160,000 gas left
  after its own validation (about 215,000 for the transaction, with two signatures), and at the first
  limit it routes with, the reporter and the games set finished a score. So a report this size cannot
  be starved at the receiver by the gas limit: the retry the forwarder allows (a transmission that
  neither succeeded nor met an invalid receiver) would follow a refusal, and the games set's refusals
  do not change on a retry. The wrapper's limit of 1,000,000 is six times what a score used.
* **An older dispute report after a newer one is the newest vote.** The games set takes a later
  dispute report as an update, writes nothing and emits it; the program reads the game's dispute
  reports in the order they landed. Delivered 16 put the first hockey record after the update, and
  day 7 then scored on three agreeing votes where, without it, the votes were 2-2 and the day-7
  result a void. Only f + 1 of the DON's signers can send such a report, under a new execution id
  (the forwarder refuses the same one after a success), and a run decides from a fresh read; so this
  is the DON signing an old decision again, which the chain cannot tell from a new decision that
  happens to match. Recorded for the card.
* **A start costs 18 feed requests** on the saved answers (3 by team near the creator's date at seats
  1 and 2, then every seat again in the window), measured by `requests.ts`; a scoring run at most 8.
  The saved transport has no cap; the DON's is 15 per run.

## What it does not show

* The DON's own signatures and owner: the probe showed the path on mainnet under the organisation's
  derived owner; v3's plain-wallet owner is the cutover's.
* The production reads: `chain.ts` reads the start report and the dispute records from the game's
  creation block, which anvil serves without a block limit and the DON's log queries do not (100
  blocks per query, 15 reads per run). What the ends read on the DON is under decision.
* The simulator: its stand-in forwarder hands a receiver placeholder metadata, so a simulated write
  cannot meet the reporter's checks; the probe and this fork are the two ways through.
* Two of the four starts were written by hand, where the program waited on the saved answers; the
  reporter and the games set took them as they take the program's.
