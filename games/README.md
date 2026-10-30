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
| `chain.ts` | what the workflow reads about a game, from state: a shard's pages of the games set's open list, each game's clocks, date, league and place on the shard's walk; a game's identity, its start readings and each seat's last vote, its reporters; and what the games set refuses as a payout. A page whose rows are shorter than the interface's is refused whole |
| `run.ts` | one run for one game: decide, write; written against interfaces so a test runs it with a fake chain and saved feed answers |
| `tick.ts` | one cron fire for one shard of the open list: the clocks, the probe at seat 3, the full read on a final or a clock, the verification on the hour's first tick, under the platform's quotas |
| `abi/IOspexGames.json` | the games set's interface ABI as forge builds it at the commit the reads are coded to; `abi.test.ts` pins every read and the open list's row to it |
| `*.test.ts` | `bun test`: the ABI pins, the four never-lines' wrapper halves, the chain reads, the tick, the worst case derived from the readers and the viability table (`budget.test.ts`), every game's entry within the bound on a stable 500-game list (`parity.test.ts`) |
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
own pages of the games set's open list: pages of 64 rows, shard k of n owning pages k, k + n, k + 2n
and so on. The page follows the game, never the game the page: each class of work (the verification
on the hour's first tick, the hour's reads on its second, the clocks in their windows and the probes
on the hour's other ten ticks) has its own count, the count names a place on the shard's walk over
its rows (row i of the shard's page m is place i × own + m), the tick reads its first page and the
page that holds the place, and the class begins its turn at the game there, then takes the rest in
turn by the count. So every game on the shard that is due for a class, and whose full read fits the
count, enters the program within own × 64 of the class's own ticks, hours for the hour's classes,
whatever factor the shard's places share with the hour (`parity.test.ts`: a stable 500-game list on
three shards, every game entered within 192, 192 and 128 own ticks). A game past its written start plus the league's
expected duration (a table in `lib.ts`) is probed: its identity and its readings read, two chain reads,
then one request at the seat the start report shows readable: seat 3 by its hint, or the spare where
the start marked seat 3 silent for the game (no usable hint, or a hint that failed the board check),
the program's own rule for which seat counts. The full read, the
program's run, happens on a final from the probe or on a clock from the chain's time: hour 24 (the
start plus n) and day 7 (the dispute record plus its clock), each on every tick for two hours and then
on the hour's second tick; a disputed game is probed for a change against its vote on record and read
in full on the hour's second tick too. On the hour's first tick the full read is a verification: one
game the creation trigger's run left unverified (the feeds list a game days ahead, a creator may
create it months ahead), from seven days before its date until the game leaves the list: first the
game at the place the hour's count names, whatever its date's distance, then the nearer games (not
yet two days past their date) in turn, then the rest in turn, so nearer-first orders the turn and
never keeps a game out of it, the bound above holds for every due game (`parity.test.ts`, the mixed
ages: a game dated three days behind among 499 dated a week ahead), and a game is verified when the
feeds first carry it, however late, and never skipped for good. A game whose full read cannot fit the count does not take the turn: its
line records the wait, and the next due game that fits takes the read the same tick. A full read
never runs on the tick itself.

**The quotas.** The platform allows a run 15 chain reads and 15 feed requests. A tick reads the header
and up to three pages, probes at two reads each (the identity and the readings), and runs at most one
full read, started only with its reads in hand (six, or the four a probe left to read) and the most
requests the program may send for it. The readers ask for one game at a time (seat 1 for the two
teams' games on the window's dates by its own ids for the teams, seat 2 for each team's games by its
own spelling, seat 3 for its result by hint and its board for the hint's row by its id, the spare for
the game by its id, else its slate where the league's fits), so the count turns on no league: a
scoring run is 1 + 2 + 1 + 1 = 5 (4 in college basketball without the spare's id, where the spare
asks nothing), and 6 behind an id the feed answers nothing for, with the slate behind it, the most a
full read is admitted on; a verification 9 (the range read at seats 1, 2 and the spare, the board's
row, then the window again at seats 1 and 2 and seat 3's result) and 10 behind such an id, the most;
day 7 none (`lib.ts`, `requestsFor`; `budget.test.ts` derives the numbers by running the readers and
the program in every league, college included, by each branch, and on the saved answers). The assumption behind them: a
team's games on a window's filing dates fit one page of a hundred rows. A feed that pages past it is
stopped by the program's own bound on a reader (twelve), and the tick's count cuts the run first: the
readers raise the cut rather than read the seat silent, the program decides nothing, nothing is
written, and the tick's line says cut. A request already made in a run is answered from memory, so the
probe's answer serves the full read: a scoring run after a probe sends 4 more. What one game's answer
weighs, per seat and league, is the viability table in `budget.test.ts`, from the saved answers: under
10 KB at seats 1 and 2 in every league saved, 200 bytes at seat 3's result and 579 at its board's row,
349 at the spare's row by its id, the spare's slate 0.6 to 20 KB where it is still read. No answer past
the platform's 25 KB is asked for: the board's slate is not read (its row for the hint is), and the
spare's slate for a college basketball game created without its id, in season past the size, is not
read either, the spare silent there without a request. That is the wrong feed for that read, reported,
not worked around: such a game is read at seats 1, 2 and 3 alone. Throughput: one
full read per tick per shard, so twelve finals an hour per shard, and one verification an hour per shard.

**Waiting.** The games set's change that stores a game's identity, its readings and the open list is
merged on contracts-v2 main (`3fe47cb`). The interface's ABI at that commit, as forge builds it, is
committed as `abi/IOspexGames.json`, and `abi.test.ts` pins every read and the open list's row to it,
field for field in its order, so a row the games set changes fails the suite, never the tick.
`getGameReadings` gives four fields and the workflow decodes all four; the fourth, `endReadings`,
goes unused, since it is empty until the game ends and the program decides nothing on a game that
has ended. A page whose rows are shorter than the interface's eight
words is refused whole, naming the row, and the
tick reads nothing (`chain.ts`, `checkRows`). The
rehearsal reads the games set from state, re-run against it at `3fe47cb` on 30 Oct 2026
(`rehearsal/README.md`); `rehearsal/logs.ts` stays behind `REHEARSAL_READS=events`. The first simulation on a pro slate, with the platform's limits enforced, is the next proof after the
merge; the live feeds' answers to the one-game requests (seat 1 by team ids, seat 2 by team name) are
the capture's to show, since no such answer is saved yet.

## Build and test

```bash
cd games && bun install --frozen-lockfile && bun run typecheck && bun test
cd .. && cre workflow build ./games --target production-settings
```

The id is rebuilt from `build/v3-osgames.json` the way `BUILD.md` describes, with every address set
on the command line and the owner given; nothing in the committed template is a real address.
