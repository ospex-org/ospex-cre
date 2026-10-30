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
  `3fe47cb`, deployed by nonce as the script predicts them (the coin check at k, the reporter at k + 1,
  the games set at k + 2) with the launch terms and the chain's own timelock and coin. The reporter
  fixes the forwarder, the owner, the workflow id and the games set; the games set admits the reporter
  by its code hash.
* **The workflow id is the build's.** `build/fingerprint.ts` run for the predicted addresses, the
  rehearsal's owner and payout: `0x003674814d214455f3b9dad1012bb73236e5d667e420bea576188ca4fe1faf66`
  (binary `6ed83bc7…`, config `b57a9e0d…`). The reporter takes a report only under that id and owner.
* **The runs are the wrapper's.** `runGame` with the chain read over the fork (`rpc.ts`, a
  synchronous JSON-RPC, since the wrapper's reads are synchronous as the CRE runtime is) and the
  program's saved feed answers (`scoring/test/fixtures.ts`) as of the saved cases' clocks; the fork's
  clock set to each case's moment; the write recorded and delivered by the harness. A start reads its
  game from the creation event, as the creation handler does; every later run reads it from state, by
  `chain.ts`'s reads combined as the tick's full read combines them (the open list's row, the identity,
  the readings, the reporters).
* **One saved case is moved in time, by 133 days.** Of the saved cases, the program voids one after n
  at this head: the MLB game of 11 Jun 2026, Atlanta at the White Sox, rained out. The games set
  refuses every report to a game from its date plus the day-30 clock, so on this fork, whose clock
  starts on 22 Oct, that game as dated could not even be verified. It is created 133 days later
  instead (19 weeks, so on a Thursday again: 22 Oct 2026, 23:40 UTC), and its saved answers are served
  moved by 133 days: each date in a request moves back to the June date its answer was saved under,
  and each time in a game's row moves forward. Words, ids, statuses and points are served as saved,
  and so is a page's own time (when seat 2 answered, 22 Oct). The moved run is held to the case at its
  own clock: the same requests once moved back, the same decision, and the same readings, each
  record's time 133 days later.

## Files

| File | What |
|---|---|
| `fork.ts` | the harness: the forwarder's DON, the deploy, five games, the runs, the deliveries, every check |
| `forwarder.ts` | the forwarder's calling convention: the raw report's header, the signatures, the metadata slice |
| `rpc.ts` | the wrapper's chain interface over a node, with the log query a fork serves, counting its reads |
| `logs.ts` | a game past its creation read from the games set's events: the stand-in the rehearsal used while the games set stored nothing; a run reads from state, and `REHEARSAL_READS=events` runs with this instead, to compare |
| `requests.ts` | how many feed requests a run makes, per saved case, against the per-execution quota |
| `transcript.txt` | the run of 30 Oct 2026, as printed |

These are run by bun and are not in the workflow's typecheck or its test suite.

## Run

```bash
anvil --fork-url "$POLYGON_RPC_URL" --fork-block-number 95989900 --port 8547 --chain-id 137
# in ospex-contracts-v2 at 3fe47cb:
FOUNDRY_SRC=src/games FOUNDRY_TEST=test/games FOUNDRY_SCRIPT=none forge build
# in probe/consumer: forge build
bun build/fingerprint.ts build/v3-osgames.json \
  --set receiverAddress=0xB1F0EeB505f51cCb8A81f4DC8dE5bc0a0d136af8 --set eventAddress=0xCC7A40E86E80712379db9E974bA780a42048Bb56 \
  --set secretOwner=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --set payoutAddress=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
  --owner 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 --json > workflow.json
cd games && REHEARSAL_WORKFLOW_JSON=../workflow.json CONTRACTS_OUT=<ospex-contracts-v2>/out bun rehearsal/fork.ts
```

`$POLYGON_RPC_URL` is an archive RPC for Polygon, named and never written out; anvil prints it in its
banner, so anvil's log is not kept. `REHEARSAL_READS=events` reads a game past its creation from its
events (`logs.ts`) instead of state; `REHEARSAL_TRANSCRIPT=<path>` writes the transcript somewhere
other than `transcript.txt`.

The fork block is the saved cases' first clock (22 Oct 2026, 17:30 UTC); the fork must come from an
RPC that serves state at it. The predicted addresses follow the deployer's nonce at that block
(anvil's first account, 28,373), so a fork at another block predicts other addresses, and the id
with them. The accounts are anvil's: the owner is the second, the payout the third, the creator the
fourth, the transmitter the fifth, the signers the sixth to ninth.

## The run, 30 Oct 2026

Windows 11, anvil (Foundry 1.6.0-nightly), Bun 1.3.14, viem 2.34.0; ospex-cre at `64caaa6` with this
directory's harness, ospex-contracts-v2 at `3fe47cb`; 135 seconds; 61 checks, 25 deliveries, every
delivery read back from the chain; exit 0 (`transcript.txt`). Requests are what a run asked, by seat
1/2/3/4, and how many were distinct: the workflow's transport answers a request asked twice in one run
from memory, so the platform counts the distinct ones.

| | Game | The program's run | Requests | Chain reads | Delivery | Gas |
|---|---|---|---|---|---|---|
| 1 | NBA | start, at the first clock | 10 (2/4/2/2; 9 distinct) | 3 calls, 1 header | verified; the start on chain is the program's | 243,676 |
| 2 | NFL | start | 10 (2/4/2/2; 9) | 3, 1 | verified | 243,712 |
| 3 | college football | wait (seat 1's answer for one date was not saved at that clock) | 5 (1/2/1/1; 5) | 3, 1 | the start written by hand | 243,712 |
| 4 | NHL | wait (seat 1 answered 401 in the saved answers) | 1 (1/0/0/0; 1) | 3, 1 | the start written by hand | 243,676 |
| 5 | MLB, moved | not run: its saved answers hold the game only as postponed | | | the start written by hand | 243,878 |
| 6 | NBA | dispute record (seat 4's final derived to differ) | 5 (1/2/1/1; 5) | 7 calls, 1 header | disputed; the record's time read back | 278,103 |
| 7, 8, 9 | college football | score, "inside n: every counting seat, the same final" | 5 (1/2/1/1; 5) | 7, 1 | at 215,000 gas the forwarder reverts before routing; at 220,000 it routes and the receiver cannot finish: result false, nothing written; the retry of the same transmission lands: 34-31, the fee credited, the withdrawal pays | —; 213,285; 281,073 |
| 10 | | the same score again, a new execution | | | refused: an ended game takes no report | 108,741 |
| 11 | | the same score, the same execution | | | the forwarder reverts: already attempted | |
| 12 | | the record under another owner | | | refused by the reporter, recorded by the forwarder | 84,941 |
| 13 | | the record under another workflow id | | | refused | 85,017 |
| 14 | NFL | the start again | | | refused: a start is written once | 108,298 |
| 15 | NBA | an update, "a vote changed, at seat 2" | 5 (1/2/1/1; 5) | 7, 1 | taken; the day-7 clock did not move | 156,687 |
| 16 | NHL | dispute record | 5 (1/2/1/1; 5) | 7, 1 | disputed | 278,019 |
| 17 | NHL | an update, an hour later | 5 (1/2/1/1; 5) | 7, 1 | taken | 156,603 |
| 18 | NHL | the first record again, after the update | | | taken as an update, which writes each seat's vote as the report carries it: the votes read back are the first record's again; the clock did not move | 156,639 |
| 19 | | the college score to the probe consumer | | | taken by it; the games set untouched | 826,049 |
| 20 | | the college score to a second reporter, same id and owner, another games set | | | refused: that set has no such game | 97,282 |
| | NFL | hour 24, on the pre-game answers: wait, "0 counting seats say the game will not or did not play, two needed" | 5 (1/2/1/1; 5) | 7, 1 | not sent: the program wrote nothing; the game still verified, no fee credited | |
| 21 | NFL | hour 24, on the answers read after the game: score, "after n: two counting seats or more, the same final" | 5 (1/2/1/1; 5) | 7, 1 | scored 30-24; the fee credited; the withdrawal pays | 298,184 |
| 22 | MLB, moved | void after n, at hour 66: "two counting seats or more say the game will not or did not play, the rest silent, and no seat shows a final" | 3 (1/2/0/0; 3) | 7, 1 | voided; the fee credited | 285,258 |
| 23 | NBA | day 7, "no three sources agree" | 0 | 7, 1 | voided; the fee credited | 282,196 |
| 24 | NBA | the update after the end | | | refused | 108,573 |
| 25 | NHL | day 7, "three sources or more, the same final" | 0 | 7, 1 | scored | 265,295 |

The payout address withdrew the five fees in three withdrawals (the college score's; the NFL
score's; then the MLB void's, the NBA day-7 void's and the NHL day-7 score's together), and the games
set held no coin at the end. Of the 25 deliveries, two were forwarder reverts (7 and 11) and one was
routed and failed at the receiver (8). Every run asked at most 10 feed requests and made at most 7
calls and 1 header read.

An earlier run the same day, at this directory's first commit (`656b954`, before the MLB game and the
NFL game's end were added), had 52 checks, 4 failed (the NFL game's hour-24 decision and the three
checks that followed from it), and 22 deliveries. The same run with `REHEARSAL_READS=events` gave the
same decisions and check outcomes.

## What it showed beyond the list

* **At the forwarder's floor the receiver cannot finish a score.** The forwarder routes only with
  160,000 gas left after its own validation (about 215,000 for the transaction, with two signatures).
  At 220,000, the first limit it routes with, the reporter and the games set at `3fe47cb` cannot
  finish the college score: the forwarder records result false and nothing is written. The retry of
  the same transmission, which the forwarder allows when the first attempt neither succeeded nor met
  an invalid receiver, lands. A report that lands costs 156,603 to 298,184 gas here, now that the
  games set stores readings (the earlier run of the day reached 299,308), and a refused one 84,941 to
  108,741. The wrapper writes with a gas limit of 1,000,000 (`games/main.ts:112`), 3.3 times the
  largest.
* **An older dispute report after a newer one is the newest vote.** The games set takes a later
  dispute report as an update, and an update writes each seat's vote as the report carries it; the
  program reads the votes on record from state. Delivery 18 put the first hockey record after the
  update: the votes the update had changed were written back, as read from the games set, and day 7
  then scored on three agreeing votes where, without it, the votes were 2-2 and the day-7 result a
  void. Only f + 1 of the DON's signers can send such a report, under a new execution id (the
  forwarder refuses the same one after a success), and a run decides from a fresh read; so this is
  the DON signing an old decision again, which the chain cannot tell from a new decision that happens
  to match. Recorded for the card.
* **The NFL game waits at hour 24 on its pre-game answers.** On 27 Oct the program voided it there
  ("every seat that answers shows no final"). At this head a void rests only on counting seats whose
  own row says the game was postponed or cancelled, and a row that says it is scheduled or in play is
  an answer, not a void's vote (`scoring/src/rule.ts` lines 33–35; `decide` voids or waits at lines
  192–193). Every seat listed the game scheduled or not finished, so the program waits and writes
  nothing. This is the one expectation in the harness that changed; the check after it now says what
  follows from the wait (nothing written, the game still verified, no fee credited) where it said
  what followed from the void. The game then ends as it would in production: on the answers read
  after the game, at the same clock, the program scores it 30-24 after n.
* **Requests per run.** A start asks 10 feed requests on the saved answers, 9 of them distinct; a
  scoring run asks at most 5, and day 7 none. `requests.ts` over the 41 saved cases: a verification
  asks at most 10 and sends 9, a scoring run sends at most 5. The saved transport has no cap; the
  DON's is 15 per run.

## What it does not show

* The DON's own signatures and owner: the probe showed the path on mainnet under the organisation's
  derived owner; v3's plain-wallet owner is the cutover's.
* The DON's read limits: the reads are the workflow's own, through `rpc.ts`, but anvil serves them
  without the DON's limits (15 reads per run); every run here made 8 or fewer. The tick is not in the
  rehearsal: its runs are `runGame`'s, which the rehearsal delivers.
* The simulator: its stand-in forwarder hands a receiver placeholder metadata, so a simulated write
  cannot meet the reporter's checks; the probe and this fork are the two ways through.
* Three of the five starts were written by hand: the college and hockey games', where the program
  waited on the saved answers, and the MLB game's, whose saved answers hold it only as postponed. The
  reporter and the games set took them as they take the program's.
* The MLB game at hour 24: the void is shown after n at hour 66, the first second its seat 4 is past
  retention as it was when the case was saved (`scoring/src/readers/seat4.ts`: 66 hours). At hour 24
  seat 4 would be asked, and its answer at that moment was never saved. The answers served are the
  saved ones moved 133 days, checked against the case at its own clock, not against what the feeds
  would have said on those dates.
