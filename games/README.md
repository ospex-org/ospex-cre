# The games workflow

The v3 Chainlink workflow: a thin wrapper on the scoring program in [`../scoring`](../scoring),
which decides every start, score, void and dispute record, and which this folder never second-guesses.
The wrapper finds a game on the chain, hands the program what it reads there, and writes the program's
report through the games set's Chainlink reporter in the one report shape. Its config is the deploy's
addresses and the operator's payout wallet, and nothing else: no feed, no seat, no count and no rule
is in it, since those live in the program, inside the fingerprint.

## Files

| File | What |
|---|---|
| `main.ts` | the entry: the games set's creation event as the trigger for a start, the tick as a cron in shards for the ends, the chain through the EVM capability, the feeds through confidential HTTP, the write through the reporter |
| `lib.ts` | pure: the config schema, the chain table, the games set's event and read shapes, the one report shape as the reporter decodes it, the seat keys as the transport fills them, the tick's constants, the transport's memo and count |
| `chain.ts` | what the workflow reads about a game, from state: a shard's pages of the games set's open list, each game's clocks, date and league; a game's identity, its start readings and each seat's last vote, its reporters; and what the games set refuses as a payout |
| `run.ts` | one run for one game: decide, write; written against interfaces so a test runs it with a fake chain and saved feed answers |
| `tick.ts` | one cron fire for one shard of the open list: the clocks, the probe at seat 3, the full read on a final or a clock, the verification on the hour's first tick, under the platform's quotas |
| `abi/IOspexGames.json` | the games set's interface ABI as forge builds it at the commit the reads are coded to; `abi.test.ts` pins every read and the open list's row to it |
| `*.test.ts` | `bun test`: the ABI pins, the four never-lines' wrapper halves, the chain reads, the tick |
| `config.production.example.json` | the config template the reproducible build writes from; every address a placeholder |
| `secrets.yaml` | the four seat keys' names in the vault |
| `workflow.yaml` | the CRE target: `osgames` on the onchain registry |
| `rehearsal/` | the fork delivery: the runs delivered through the production forwarder's own bytecode on a fork of Polygon, with its record |

## What the wrapper hands the program

* **The game**, from the chain. For a start at creation, its identity and terms from the creation
  event, the trigger's own payload. For everything after, from state: the open list's row (its status,
  its clocks and its date), its identity, the start report's readings and each seat's last vote folded
  into one record, and its reporters. Nothing is read from a log past the trigger's own.
* **The clock**: the latest block's timestamp, never the node's.
* **The keys**: one per seat of the table. A seat whose key goes in a header gets the enclave's
  stand-in (`{{.SEAT1_KEY}}`), which confidential HTTP fills from the vault, so the key never enters
  the workflow. A seat whose key goes in the query gets the value read from the vault at the run,
  since the transport fills headers and bodies and not the URL; that key rides in the workflow's
  memory for the request, on every node.
* **The payout address**, from the config, which the id hashes. The config refuses a payout the
  games set would refuse for where it lies (zero, the reserved range, the reporter, the games set);
  the run hands the program what the games set refuses by what it is (the set, its coin, every
  reporter present or retired), and the program refuses such a payout before a report is sent.

## What is built, and what waits

Built: the creation event as the EVM log trigger, so a new game is verified and its start written;
the tick, a cron on the DON in shards, for the ends; the chain reads from state; the report writer;
the fingerprinted files with the payout as a named placeholder; the never-line tests; and the fork
delivery (`rehearsal/`), every report kind through the production forwarder's own bytecode into the
games set, with the game's state as the receipt.

**The tick.** Every five minutes (the schedule is config, inside the fingerprint) each shard reads its
own pages of the games set's open list: pages of 64 rows, shard k of n reading pages k, k + n, k + 2n
and so on, its first every tick and one other in turn, so no shard reads the whole list and a list
longer than a tick's pages is covered over ticks. A game past its written start plus the league's
expected duration (a table in `lib.ts`) is probed: its identity and its readings read, two chain reads,
then one request at the seat the start report shows readable: seat 3 by its hint, or the spare where
the start marked seat 3 silent for the game (no usable hint, or a hint that failed the board check),
the program's own rule for which seat counts. The full read, the
program's run, happens on a final from the probe or on a clock from the chain's time: hour 24 (the
start plus n) and day 7 (the dispute record plus its clock), each on every tick for two hours and then
on the hour's second tick; a disputed game is probed for a change against its vote on record and read
in full on the hour's second tick too. On the hour's first tick the full read is a verification: one
game the creation trigger's run left unverified (the feeds list a game days ahead, a creator may
create it months ahead), from seven days before its date until two days past it, in turn when there
are several, so a game is verified when the feeds first carry it. A full read never runs on the tick
itself.

**The quotas.** The platform allows a run 15 chain reads and 15 feed requests. A tick reads the header
and up to two pages, probes at two reads each (the identity and the readings), and runs at most one
full read, started only with its reads in hand (six, or the four a probe left to read) and the most
requests the program may send for that league, derived from the readers' own pagination (`lib.ts`,
`scoringRequests` and `verifyingRequests`; `budget.test.ts` derives the numbers by running the readers).
A scoring run reads the game's window, three filing dates for a day's window, one page a date at seats
1 and 2 for a league under a hundred teams, one request each at seats 3 and 4: 8. A verification reads
two days around the date by team and the window again from the start chosen, the board, seat 3's
result and the spare: 13. Day 7 asks no seat. College fills four pages a date or more, and each reader
stops at the program's own bound of twelve, so its worst case is 26 for a scoring run and 27 for a
verification, past the platform's 15: under that count a college game's full read waits every tick and
its verification every hour, nothing of it sent, until the per-execution quota is raised, which is the
platform's to do. A full read found without room waits for the next tick or its next turn, where the
probes begin from another game, holding the work. Should the count still stop a run, the readers raise
the cut rather than read the seat silent, the program decides nothing, nothing is written, and the
tick's line says cut. A request already made in a run is answered from memory, so the probe's answer
serves the full read, and a start, which the program confirms by reading every seat again in the
window, sends 11 distinct requests of the 18 it asks on the saved answers. Throughput: one full read
per tick per shard, so twelve finals an hour per shard, and one verification an hour per shard.

**Waiting.** The games set's change that stores a game's identity, its readings and the open list is
in review. Its reads are coded as its branch gives them: the interface's ABI at that branch's head is
committed as `abi/IOspexGames.json`, and `abi.test.ts` pins every read and the open list's row to it,
field for field in its order, so a row the games set changes fails the suite, never the tick. The
rehearsal still reads the games set at contracts-v2 main from its events, on a fork
(`rehearsal/logs.ts`), until it is re-run against that games set. The first simulation on a college
slate, with the platform's limits enforced, is the next proof after the merge.

## Build and test

```bash
cd games && bun install --frozen-lockfile && bun run typecheck && bun test
cd .. && cre workflow build ./games --target production-settings
```

The id is rebuilt from `build/v3-osgames.json` the way `BUILD.md` describes, with every address set
on the command line and the owner given; nothing in the committed template is a real address.
