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
| `main.ts` | the entry: the games set's creation event as the trigger, the chain through the EVM capability, the feeds through confidential HTTP, the write through the reporter |
| `lib.ts` | pure: the config schema, the chain table, the games set's event and read shapes, the one report shape as the reporter decodes it, the seat keys as the transport fills them |
| `chain.ts` | what the workflow reads about a game: the games set's status, start and dispute time, the start report's readings and every dispute report from the games set's own events, and what the games set refuses as a payout |
| `run.ts` | one run for one game: read, decide, write; written against interfaces so a test runs it with a fake chain and saved feed answers |
| `*.test.ts` | `bun test`: the ABI pins, the four never-lines' wrapper halves, the chain reads |
| `config.production.example.json` | the config template the reproducible build writes from; every address a placeholder |
| `secrets.yaml` | the four seat keys' names in the vault |
| `workflow.yaml` | the CRE target: `osgames` on the onchain registry |

## What the wrapper hands the program

* **The game**, from the chain: its identity and terms from the creation event (the games set does
  not store them), its status and start from the games set's reads, the start report's readings and
  every dispute report in order from the games set's `GameReported` events, read from the game's
  creation block.
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
the chain reads for every status; the report writer; the fingerprinted files with the payout as a
named placeholder; the never-line tests.

Waiting on a ruling: **what fires a run for a game past its start** (the score, the hour-24 void,
the dispute record and its updates, the day-7 result). A cron on the DON walks the open games; an
HTTP trigger from the operator's box carries the game id at the moment it matters. Either way the run
reads the game from the chain and decides on the feeds alone. Until it is ruled, `main.ts` has no
handler for a game past its start, and no file depends on which it will be: the second trigger, how
that run finds the game's creation event, and whatever the trigger needs in the config.

## Build and test

```bash
cd games && bun install --frozen-lockfile && bun run typecheck && bun test
cd .. && cre workflow build ./games --target production-settings
```

The id is rebuilt from `build/v3-osgames.json` the way `BUILD.md` describes, with every address set
on the command line and the owner given; nothing in the committed template is a real address.
