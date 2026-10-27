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
| `chain.ts` | what the workflow reads about a game, from state: the games set's open list with each game's clocks, league and hints; a game's identity, its start readings and each seat's last vote, its reporters; and what the games set refuses as a payout |
| `run.ts` | one run for one game: decide, write; written against interfaces so a test runs it with a fake chain and saved feed answers |
| `tick.ts` | one cron fire for one shard of the open games: the clocks, the probe at seat 3, the full read on a final or a clock, under the platform's quotas |
| `*.test.ts` | `bun test`: the ABI pins, the four never-lines' wrapper halves, the chain reads, the tick |
| `config.production.example.json` | the config template the reproducible build writes from; every address a placeholder |
| `secrets.yaml` | the four seat keys' names in the vault |
| `workflow.yaml` | the CRE target: `osgames` on the onchain registry |
| `rehearsal/` | the fork delivery: the runs delivered through the production forwarder's own bytecode on a fork of Polygon, with its record |

## What the wrapper hands the program

* **The game**, from the chain. For a start, its identity and terms from the creation event, the
  trigger's own payload. For an end, from state: the open list's row (its status and clocks), its
  identity, the start report's readings and each seat's last vote folded into one record, and its
  reporters. Nothing is read from a log past the trigger's own.
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

**The tick.** Every five minutes (the schedule is config, inside the fingerprint) each shard reads the
games set's open list and takes the games whose id is its share. A game past its written start plus
the league's expected duration (a table in `lib.ts`) is probed: seat 3 by its hint, one request, or
the spare for a game created without a usable hint. The full read, the program's run, happens on a
final from the probe or on a clock from the chain's time: hour 24 (the start plus n) and day 7 (the
dispute record plus its clock), each on every tick for two hours and then on the hour's first tick; a
disputed game is probed for a change against its vote on record and read in full on the hour's first
tick too. A full read never runs on the tick itself.

**The quotas.** The platform allows a run 15 chain reads and 15 feed requests. A tick reads the header
and the open list, probes at no read, and runs at most one full read, started only with its six reads
and ten requests in hand; a final found without room waits for the next tick, where the probes begin
from another game. A request already made in a run is answered from memory, so the probe's answer at
seat 3 serves the full read, and a start, which the program confirms by reading every seat again in
the window, sends 11 distinct requests of the 18 it asks.

**Waiting.** The games set's change that stores a game's identity, its readings and the open list is
being written. Its identity and readings reads are coded to as posted; its open list is posted as ids
alone, which would cost the tick four reads per candidate, so `chain.ts` reads rows (the id, status,
clocks, league and hints) under that name until its shape is settled, and the names move in `lib.ts`
only. The rehearsal still reads the games set at contracts-v2 main from its events, on a fork
(`rehearsal/logs.ts`), until it is re-run against that games set. The first simulation on a college
slate, with the platform's limits enforced, is the next proof after the merge.

## Build and test

```bash
cd games && bun install --frozen-lockfile && bun run typecheck && bun test
cd .. && cre workflow build ./games --target production-settings
```

The id is rebuilt from `build/v3-osgames.json` the way `BUILD.md` describes, with every address set
on the command line and the owner given; nothing in the committed template is a real address.
