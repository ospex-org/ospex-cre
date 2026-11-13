# A new version of the scoring program, beside the live one

A changed scoring program goes live as a second workflow with a second reporter, while the workflow
and the reporter before it keep running. `BUILD.md` says how a workflow's id is rebuilt. This file
says in what order a new one is registered, created, published and approved: who runs each step,
what it is for, what it checks and where it stops.

It is written from the deploy of `osgames2` on 11 and 12 Nov 2026, with what the two days showed
wrong put right. It is not that deploy's order in every place, and not every check in it has been
run: one step stands in a different place, and some checks are new. "Where this file differs from
what ran", near the end, names each of them, after that deploy's own record. The deploy-day
checklist in ospex-contracts-v2's README is for a games set's first deploy. This file is for each
version of the program after it.

## What "beside" means

* The new version has a name of its own, so its registration adds a row at Chainlink's workflow
  registry and replaces none. Under the live name the same command would replace the live workflow
  in place.
* It writes through a reporter of its own, which fixes its workflow id for good. The Polygon timelock
  approves that reporter beside the ones already approved.
* A game copies the approved reporters at its creation. A game made before the approval keeps the
  reporters it had, and a game made after it carries the new one too. No game is moved, and no
  workflow or reporter is retired or paused as part of this.
* Beside has a limit, in two places. The registry gives an owner a number of active workflows in a
  DON family (`getMaxWorkflowsPerUserDON`): three for this owner in this family when it was read on
  11 Nov 2026, and `osgames` and `osgames2` are two. The games set holds a fixed number of approved
  reporters at most (`MAX_REPORTERS`). Both are read before the day, and again where the spending
  starts (step 0, blocks (b) and (c)).
* Retiring an older version is a change of its own, with its own approval, and room is never made
  for a new version on the day by removing an old one. A retired reporter reports on no game
  afterwards, the games that carry it alone included (`retireReporter` and `report` in
  `OspexGames.sol`, ospex-contracts-v2). So a retirement first settles what becomes of those games.

## Why the order is what it is

A workflow's id is a hash of its owner, its name, its binary and its config (`BUILD.md`). At the
registry, any linked owner may register any id that is not listed yet, an id that is listed is
refused whoever asks, and the id is a value the registry is given and never computes
(`upsertWorkflow` in the registry's verified source: `OwnershipLinkDoesNotExist`,
`WorkflowIDAlreadyExists`). So an id is held by whoever registers it first. A reporter takes a
report only when it names the reporter's owner and its id together, so a reporter that fixes an id
another owner holds takes no report at all.

Before a deploy, every input of the new id is public or can be worked out: the owner, the name in
`games/workflow.yaml`, the binary this repository rebuilds, the config template, and the addresses
of the live deploy. A reporter's address planned from the deployer's next nonce can be worked out
too. So the procedure keeps one input out of public view until the registry holds the id, and the
order follows from that:

1. The reporter's address is planned from a salt that is kept on one machine, through a factory. It
   does not turn on a nonce.
2. The id is registered before it is published anywhere, through a route that keeps the transaction
   out of the public list of pending transactions.
3. Nothing is created and nothing is published until the registration is final under the owner.
4. Then the reporter is created at the planned address, the spec is published, and the reporter is
   approved.

The principle: a value that has to be claimed is not published before it is claimed.

The first three follow from that, and ran in that order. The last three are not all bound the same
way. The creation needs the gate. The publication and the approval each need the creation, and
neither needs the other. On 12 Nov 2026 the approval came first and the publication after it. This
file puts the publication first, so that the id a reporter fixes can be rebuilt from this repository
before that reporter is approved. In that order the two steps have not been run. Its cost is time:
the timers of step 1 stay off until the pull request is merged as well.

## Who

| | |
|---|---|
| The operator | Holds the workflow owner's key and the timelock's key. Runs the route's rehearsal and the registration, signs the schedule, and merges. Each step starts on the operator's word. |
| The writer | Prepares the spec, the fingerprint, the call data and every block. Signs nothing and sends nothing. |
| The verifier | Works on the box, the machine that holds the operator's working wallet. Makes the salt, rebuilds each value from its own reads before comparing it with the writer's, runs the gate, and sends the creation and the execute from the working wallet. |

One private record of the deploy holds the order, each ruling, each time and each value as it is
made. A value is read from the record, never from memory or from notes. The record is private, not
sealed: whoever can read it, and whatever stores or handles it, holds each value written there.

## Rules for every step

A live line is a line that signs, sends, registers or deploys.

1. **A live line sits alone in a function that a person types.** The function refuses unless every
   check before it passed, it was typed at a terminal, and a phrase naming the thing sent was typed
   in answer. Loading a block, or pasting it, sends nothing.
2. **That guard stops an accident, not a program.** A terminal can be imitated, and software can
   type a phrase. What holds is the key's own approval: for the timelock's key, the device the key
   lives on. No check in a block is a reason to read that device less closely.
3. **A live line binds what it sends.** The chain, the nonce, the value, the gas limit and the fee
   limits are arguments on the line, and the nonce is read again just before it. The CRE tool's two
   lines cannot do this: the tool takes its nonce and its fees from the node and has no argument for
   either (cre-cli v1.22.0, `cmd/client/tx.go`, `cmd/client/eth_client.go`). Their blocks read the
   owner's count just before, the cost the tool prints is compared at its question, and the gate
   checks what was mined. No block passes the tool's argument that skips its question.
4. **An error from a live line means unknown, not failed.** After a timeout, a refused read, a
   missing receipt or "already known", the transaction may have gone and may still be mined. Keep
   the hash and the nonce, read the chain, and send nothing a second time by reflex. A second send
   is a new decision, made on what the first one's own receipt and its effect read as. Two equal
   counts at a node do not read it: a transaction a private route holds, or one handed to a wallet
   and not yet signed, shows in neither.
5. **A block is a file, run by one line** that checks the file's SHA-256 and then loads it. A post
   that shows the line and then the file's text says so: the line is what is run, the text is for
   reading. On 12 Nov the line was run and then the text was pasted, and the rehearsal went out
   twice.
6. **A paste that holds a question ends at that line.** Whatever follows a `read` or the tool's own
   question in a paste is taken as the answer.
7. **A trial copy of a block holds no live line.** It is made by removing every line that names the
   sending tool, by the tool's name and not by line numbers, and it is checked for that name before
   it runs. On 12 Nov a cut by line numbers kept the registration's line, and the line started. It
   ended at once, in a folder that held no project: the folder stopped it, not a guard.
8. **A read that decides something is made at one named block**, with the block's hash read before
   and after. A count of waiting transactions cannot be read at a past block, so the two counts
   are read at the head as well, last.
9. **The tools are the pinned ones, named by path.** The fingerprint takes the CRE tool from
   `CRE_BIN`; the operator's machine and the box install it under different names. Nothing is
   updated on the day.
10. **A send is written down before it goes.** The line names the chain, the sender, the recipient,
    the nonce, the value, the limits, the hash of the call data and the block the checks were made
    at. It is appended to a file, forced to disk and read back, and a send whose line could not be
    written does not go (`record`). What the send printed is written the same way when it returns.
    A hash that could not be saved is an unresolved attempt until it is.
11. **A wallet that a program also sends from is used under that program's own lock.** The timers
    are stopped and the service they start has ended. The lock is the one the program takes, and it
    is taken before the nonce is read and kept until the transaction is read back. The program's
    own list of attempts shows none unfinished. A file made for the day is not that lock, and an
    idle service is not that list.
12. **A load and its send are one attempt.** A block's values are fixed when it is loaded. READY
    and the typed phrase are no leave to change an address, an id, the bytes, a fee or a path
    afterwards, in the shell or in the file. After any change, or a pause, the block is loaded
    again, which makes every check again. Each function compares what it is about to send with
    what the load checked (`seal`) and refuses if they differ. That stops an accident too, and
    nothing more: a shell's variables are not sealed.

## The order

| | Step | Who | It ends when |
|---|---|---|---|
| 0 | Before the day | all three | the program is merged under its new name, what it reads from outside is accepted, there is room for one more, and one game is simulated |
| 1 | The private values | the verifier, the writer | two machines print the same three hashes |
| 2 | The route: its check and its rehearsal | the operator | the rehearsal's transaction reads as included |
| 3 | The registration | the operator | the tool reports the workflow deployed |
| 4 | The gate | the verifier | the id is under the owner at a finalized block, by the route's answer and by three public nodes' |
| 5 | The creation | the verifier | the planned address holds the reporter's code |
| 6 | The publication | the writer, the operator | a fresh clone of the merge commit prints three matches |
| 7 | The approval | the writer, the verifier, the operator | both reporters are on the approved list |
| 8 | The canary | the verifier | a game that carries both reporters is scored through the new one |

On 12 Nov 2026 steps 0 to 5 ran in this order, then step 7, then step 6.

### 0. Before the day

* **The program's change is merged**, reviewed, under the new name: `workflow-name` in
  `games/workflow.yaml`, `WORKFLOW_NAME` in `games/runline.ts`, and the tests that pin the name.
  From this commit the binary is fixed. The spec that follows changes no file the build reads.
* **There is room for one more.** The owner's limit in the DON family against its active workflows,
  and the games set's `MAX_REPORTERS` against its approved list (the reads are under "The blocks").
  Either one at its limit: stop here. Which older version makes room, and what becomes of the games
  that carry its reporter alone, is the change of its own named above, and it comes first.
* **What the new version reads from outside is in place and accepted first**: a table, a Vault
  value. A migration is applied by the database's owner in the database's own editor. The
  operator's shell holds no database connection, and a deploy adds none.
* **"In place" is not the test.** The test is made as the identity the workflow will use, which
  has the least it needs: what it must do is tried and succeeds, and what it must not do is tried
  and refused. For the run-line's table, on 11 Nov 2026, these were read in the database's own
  catalog: the table's key, that row-level security is on, the writing role's grants and policies
  (it may insert, and read the key columns, and nothing else), and that the role has no grant on
  any other table. A read with no key was refused. Then, from outside, with the writing key: a
  read of the key columns was answered, and a read of a data column, a read of another table, an
  update and a delete were each refused. A dependency a later version adds is accepted the same
  way before the day.
* **A Vault value is stored by name under the owner** (`games/secrets.yaml` holds the names), and
  the store is checked:
  * A value with a known shape is refused unless it has that shape, at the first store and at every
    rotation, and the refusal ends the run. A line that only prints "refused" goes on to store the
    value. For the run-line's `RUN_LINE_APIKEY`: take `supabaseAnonKey` from
    `https://api.ospex.org/v1/config/public`, require `^sb_publishable_[A-Za-z0-9_-]{8,}$`, and
    store nothing if the fetch, the parse or the match fails. Never a copy from a dashboard, and
    never a local value.
  * A secret pasted at a hidden prompt is still on the clipboard. `clip.exe < /dev/null` does not
    clear it (it prints its usage line). `printf 'x' | clip.exe` overwrites it. A dashboard that
    copies a secret only after revealing it has shown it on the screen.
  * `cre secrets list` asks which target unless it is given `--target production-settings`.
  * For the run-line's two keys the workflow supplies the Vault names and the header templates, and
    the enclave fills the values into the outbound request with no `getSecret` read by the
    workflow. A response or an error can still echo a value back, so what a run prints is scanned
    all the same.
* **A key has a life, and the run-line stops with it.** The writing key is a token signed with one
  of the database platform's signing secrets. It is good until its own expiry, and only while the
  platform trusts that secret. When either ends, the push is refused: from then on rows are
  missing. Scoring is not held, because the push is outside the report's path and a failed push
  stops nothing (`games/runline.ts`). The cure needs no new version: a key signed under a secret
  the platform trusts is stored under the same Vault name, and the next run uses it. The id does
  not change, since a Vault value is no input of it. The publishable key is replaced the same way,
  through its shape check. A rotation is finished only when the acceptance test above has been
  made with the new key: a key that was stored has not been tried.
* **One game is simulated** with the merged program, under a stand-in reporter address: a
  simulation's config never holds a planned address. Its checks: no key, keyed URL or unfilled
  stand-in in the output; the table's rows equal the run's own lines, column for column; a replay
  of the same run writes nothing. A simulation's rows stay in the table. They are told apart by
  time: a row of a workflow that was received before that workflow was registered is a
  simulation's.
* **A simulation does not show everything.** That the Vault holds the two names under the owner,
  that the enclave fills both into one request, the request's own time limit, and the DON's clock
  in the samples are first seen at the first live run (step 8). The three hashes show none of this
  either: they say the build is the registered one, not that a key still works or that the table
  still takes its rows.

### 1. The private values, and the rule that ends at the registry

**Who.** The verifier makes the salt and the address on the box. The writer makes the spec and the
fingerprint. The verifier reproduces the fingerprint and rehearses on a fork.

**What for.** One input of the id stays out of public view until the registry holds the id.

1. **The timers stop.** Whatever sends from the working wallet on a timer (the game creator) is
   stopped and disabled, and stays so until the approval is read back in step 7. The service the
   timer starts is read as ended: a stopped timer does not end a run that has begun. Two reasons:
   none of its sends meets the creation's or the execute's, and a game it made before the approval
   would carry the old reporters alone. If the day ends before the registration, the timer goes
   back on, and is stopped again before the next session.
2. **The salt is made once**: 32 bytes, the working wallet's 20, then one zero byte, then 11 from
   the operating system's randomness. It goes to one file on the box that only its owner reads,
   outside every repository, and the command that makes it refuses if the file exists. The shape is
   the factory's rule (CreateX, `_guard`): for a salt that starts with the sender's address the
   factory mixes the sender into the address, so the same salt sent by anyone else lands somewhere
   else. A salt without that start can be used by whoever sees it first, and since this address
   does not turn on the code, they could put other code there. The zero byte asks for no separation
   by chain, so the creation names chain 137 on its line.
3. **The address is worked out with no node**:

   ```
   guarded = keccak256(abi.encode(deployer, salt))
   proxy   = the CREATE2 address of (factory, guarded, the factory's fixed proxy code)
   address = the CREATE address of (proxy, nonce 1)
   ```

   The real salt reaches a tool on its standard input, never as an argument, which a process list
   shows, and in an environment that names no node. The sum is first shown right on a made-up salt,
   against the factory's own answer to an `eth_call` with that made-up salt. A plain salted
   creation (CREATE2) cannot serve here: its address turns on the code, the code holds the id, the
   id turns on the config, and the config holds the address.
4. **The spec** is written on main at the merged commit, in the working tree only: the planned
   address, the live deploy's other addresses, and the owner. The fingerprint is run twice, first
   with no expectation and then with the three hashes pinned. The spec's bytes, its SHA-256 and the
   three hashes go to the record. The file stays untracked until step 6.
5. **The second machine** builds a tree of its own at the same commit, takes the spec from the
   record byte for byte, and must print the same three hashes, in a run with no network route (the
   fingerprint asks no node: `BUILD.md`). A control comes first, with a stand-in address set over
   the spec, so that a fault in that machine's build shows before the planned address is used.
6. **The fork rehearsal** runs the factory route with a stand-in salt and a stand-in id, never the
   real ones. A fork fetches what it has not cached from its upstream node, so a real value given
   to a fork is given to that node. The rehearsal shows five things. The working wallet's call
   lands at the address worked out offline. The same salt from another sender lands elsewhere. A
   creation that fails (a zero id, too little gas) leaves the address free, and the same salt then
   succeeds. The timelock's `approveReporter` is taken. A game created after it copies both
   reporters, and a game from before keeps its own. Last, the runtime code hash that the approval will
   name is taken with the real id, on a fork whose upstream has been cut and read back as cut.

**The rule.** From the moment the salt exists until the gate of step 4 passes, the salt, the planned
address, the spec, the generated config, the three hashes and the id are in three places only: the
box, the operator's working tree, and the private record. The salt is not the only one that counts:
the planned address or the config is enough to work the id out. They are in no repository, CI, chat
or shared log. No node, explorer or fork with a live upstream is sent anything that names or
carries them: no code or balance read at the address, no estimate, no call to the factory with the
real salt. So before the gate nobody has checked that the planned address is empty: the made-up
salt proves the sum, not the vacancy.

The private record is the widest of the three places: the values written there are held by every
reader of it and by whatever stores or handles it, for as long as the day runs between the salt
and the gate.

Two disclosures are part of the registration itself. They are accepted, and no other is. Before the
tool asks its question it has uploaded the binary and the config to Chainlink's storage, and it has
given the route's node the whole registration call for a gas estimate. After Yes the route has the
signed transaction.

The rule ends when the gate passes, with one opening inside the gate: once the registration is
shown to be in a block that public nodes hold, three of them are asked about the id (step 4).

**Resuming after a stop.** Before a session that takes the day up again, these are read, and none
has changed: the spec's SHA-256 and the tree it lies in (the same commit, nothing new but the
spec); the salt file's owner, mode, size and time, without opening it; the reporter build's
checkout, clean at its commit. The timer is stopped and disabled again and its service has ended.
The working wallet's two counts are equal, its ledger shows no unfinished attempt, and its balance
covers the ceilings. The route answers a read of its `finalized` block, a request that names
nothing of ours. On 12 Nov 2026 these were read before the route's rehearsal.

**Check.** The same three hashes on two machines. The fork's five results. The runtime code hash.

**Stop.** Any sign that one of the values reached a place outside the three: make a new salt.
Before a registration has been sent, nothing of this version is on a chain, so a new salt costs a
new address, a new spec and two fingerprint runs. Once a registration has been sent, this stop is
not enough by itself: that attempt is reconciled first (step 3).

### 2. The route: its check and its rehearsal

**Who.** The operator, with block (a).

**What for.** A registration sent the ordinary way sits in the public list of pending transactions
with the id in it. The tool sends through whatever node address it is given, so for this one
command it is given a private-submission endpoint.

* **How the address is given.** `-E <file>`, a one-line file that names the endpoint as
  `ETH_MAINNET_RPC_URL`. The capital matters: `-E` adds the file over `.env`, and `-e` takes it in
  place of `.env`. A shell variable does not work, because the tool writes `.env`'s values over the
  shell's. The file lives outside the repository's folder and its parents. The sign that it took
  effect is the tool's own warning that the name "is defined in both env files", and no run goes on
  without that line.
* **What the endpoint must do.** Say in its own documents that a transaction sent to it is not
  shared with the public pool. Answer every read the tool makes: one endpoint measured on 11 Nov
  2026 refused `eth_call`, so the tool cannot use it as its only node. Report a transaction's
  inclusion at a status address. Which endpoint a deploy uses is in that deploy's record.
* **The check** is the tool's own reads, twelve of them, three rounds in a row, just before the
  tool runs (`route_reads`). A check of `eth_chainId` alone is not one: on 12 Nov the route
  answered it, and seconds later answered the tool's fourth read with a 504. The check is a sample
  of whether the route answers. It does not show that the route keeps a transaction out of public
  view, that its answers are right, or that it will answer in the next minute.
* **The rehearsal** is one transaction that registers nothing, sent by the same binary through the
  same sending code: `secrets list`, which sends one allowlist request from the owner
  (`executeTransactionByTxType` in `cmd/client`, the function the registration goes through). On
  v1.22.0 the command then fails to read the Vault's reply (`BUILD.md`, CLI versions). That comes
  after the transaction and changes nothing. Run it once: each run leaves an allowlisted request at
  the registry, for two days by the tool's default. Block (a) asks for 30 minutes
  (`--timeout`, `cmd/secrets/list/list.go`): that is this file's change, read from the tool's
  source and not run. A shorter time shortens how long a new request stays allowed. It takes no
  request back, and the registry's source has no call that does: a request stays until its time is
  up.

**Check.** The both-files warning. The tool's details name Ethereum mainnet, the registry and
`AllowlistRequest`. After Yes the transaction is confirmed, and the status address reads it as
included.

**Stop.**

* `route_reads` reports a read with no result: wait ten minutes and load the block again. A second
  stop: the registration does not go by this route today, and the next step is a ruling, not
  another endpoint chosen on the spot.
* No both-files warning, or the tool's details differ: answer No.
* After Yes, no confirmation within five minutes: do not run it again. Type `owner_state`, and read
  the status address.
* The status address does not read the transaction as included, twice, a minute apart: the
  registration does not go by this route.

### 3. The registration

**Who.** The operator, with block (b), once step 1's three hashes agree on two machines, the fork
rehearsal has passed, and step 2's transaction reads as included.

**What for.** The registry holds the id under the owner before anyone else can know it.

**What the block checks before the tool runs.** The tree is at the merged commit and holds nothing
new but the untracked spec. The spec's SHA-256 is the record's. The fingerprint prints the three
hashes as matches. The generated config's SHA-256 is the config hash. The route file is the one
line, and the route answers the tool's reads. The owner has nothing waiting, and the registry has
no row of the new name. The owner has room for one more active workflow: its limit in the family
against its active count, read before the upload, since the tool's own estimate would find a full
quota only after it. The tool's usage report is off (`CRE_TELEMETRY_DISABLED=true`: `BUILD.md`,
Traps). The function writes the attempt down before it starts the tool (rule 10): the owner's
count, and the spec by its SHA-256, not the id.

**What the tool does, in order** (cre-cli v1.22.0, `cmd/workflow/deploy`). It compiles and prints
the three hashes. It reads the owner's link and the row for the name. **It uploads the binary and
the config to Chainlink's storage.** It reads the owner's limit. It estimates the registration's gas
through the node, with the whole call. It prints the details and the cost. **Only then does it ask
its question.** So:

* The tool does not pause between printing the hashes and uploading. The comparison that can still
  stop the upload is the block's own, before the tool starts.
* Answering No sends no transaction and takes nothing back: the files are already at Chainlink.
* After Yes it reads the nonce and the fees, signs, sends, and waits up to five minutes for the
  receipt. It does not wait for finality.

**At the tool's question.** The chain is Ethereum mainnet, the address is the registry's, and the
function is `UpsertWorkflow`. The inputs are the name twice, the id, 0, the DON family, the two
storage addresses, an empty value and false. The cost is under the ceiling given for it. Then Yes.

**Stop.**

* Any `STOP` line, or no both-files warning: the tool is not started, or is answered No.
* "Workflow ... already exists" and a question about overwriting: No. No such row should exist.
* A line saying the gas estimate failed, or no cost: No. The call would be refused on chain, which
  is what a taken id looks like.
* `WorkflowIDAlreadyExists`: somebody holds the id. Stop. A new salt gives a new address, a new
  config and a new id over the same binary. No reporter exists yet, so none is wasted. What is
  spent stays spent: the rehearsal's gas, and the gas and the owner's count of a registration that
  was mined and refused.
* A stop before the upload: load the block again.
* A stop after the upload and before the send (a failed read, or a No): the files are at Chainlink
  with no row at the registry, and nothing takes an upload back. Loading the block again as soon
  as its checks pass shortens that time. It does not close it. The block builds the same bytes and
  the same id, and the tool skips an upload that is already there. Ask no other node.
* A stop at the send or in the wait is unknown, not failed, and nothing is loaded again on the
  operator's own decision. Keep the attempt as it was written down, with every line the tool
  printed and the hash if it printed one (`note`). Type `owner_state`, and `route_status` with the
  hash.
  * A row of the name for the owner: it is registered. Go to the gate, which reads the transaction
    itself. Do not load the block again.
  * No row, and the mined count is still the attempt's: the transaction is not mined. That is not
    the same as gone. A transaction a private route holds need not show in a node's waiting count,
    so two equal counts say nothing about it. Read again each minute.
  * No row, and the mined count is past the attempt's: the count was spent by a transaction that
    did not register the name. It may be the attempt, mined and refused, or another transaction of
    the owner's. Find it and read its receipt before anything else.
  * In both of the last two the next move is a ruling, not a reload. The tool takes its nonce from
    the node at the moment it sends and has no argument that holds it to the attempt's. A second
    run is therefore a second transaction, and it takes the first one's place only if it happens to
    get the same count. How long the route keeps a transaction it has not got mined is not known.

### 4. The gate

**Who.** The verifier. Four sources are asked: the route the registration went by, and three public
Ethereum nodes run by three different operators. Which three is in the deploy's record. Until part
2 passes, no node but the route's is asked anything that names the id.

**What for.** "Transaction confirmed", the route's "included" and two rows at `latest` can all come
before finality. If the block that holds the registration were dropped after the id had been seen,
someone else could claim the id. Waiting does not hide a transaction that has been mined once. It
keeps the creation from resting on a row that could still be dropped. One node's answer is one
operator's word, and the reads that decide are therefore asked of four. Nothing is created or
published on an included registration, only on one that four sources hold as final.

1. **The transaction, on the route.** Chain 1, from the owner, to the registry, value 0, the nonce
   the block printed, and the whole call data equal to `upsertWorkflow` built from the name, the
   id, the family and the two storage addresses. Its receipt's status is 1, and the receipt names
   the inclusion block.
2. **The inclusion is public.** Each public node is asked for the inclusion block by its number,
   a request that names nothing of ours. The block's hash is the receipt's, and its list of
   transactions holds the registration's hash. From here the id is in a block that anyone reads,
   and asking a public node about it tells nobody anything new. Before this part passes, nothing
   that names the id goes to a public node.
3. **The anchor.** Each of the four is asked for its `finalized` block, again each minute, until
   every one is at or past the inclusion block. The four need not agree on the newest. The anchor
   is the lowest of the four, which every one of them holds as final.
4. **At the anchor, on each of the four.** The anchor's hash and the inclusion block's hash. The
   registration, by its hash: its block, its status, its nonce and its call data. Each earlier
   transaction of the day, by its hash: mined, with its nonce. The new row, whole: the id, the
   owner, a creation time equal to the inclusion block's, active, the name, the two storage
   addresses, the tag, empty attributes, the family. Each old row, whole: unchanged in every field
   from the read before the day. The owner's list: the old rows and the new one and no other, in a
   page that came back less than full, with the registry's own count of the owner's active
   workflows equal to the active rows in it. The owner's count: the count before the day, plus the
   day's transactions. Then both hashes again.
5. **The four answers are equal**, every field of every read, and one of them is read against the
   record. Then, and only then, step 5. The same reads are made again before step 6's push.

**Stop.** A null, a `finalized` read or a read at the anchor that a node does not support, a source
still behind the inclusion, an owner that is not ours, an unexpected row, a block hash that changed,
or any difference between two sources is a hold. One source against three is a hold: no vote
decides, and a source is not left out because its answer does not fit. A node that cannot answer is
replaced only on the operator's word, written in the record, and the node that replaces it makes
every read. Three addresses that lead to one operator are one source. No second registration and no
other id is tried on the verifier's own decision.

**What a passed gate does not show.** It lowers the trust placed in one route's answer. It is not a
proof of finality: four nodes can share a provider or a fault. It does not close the time between
inclusion and finality. It does not make the route or Chainlink's storage a secret. And the owner's
count at the anchor does not show that nothing else was ever sent: a transaction that was dropped,
refused before it was mined, or is still held somewhere is not in it.

On 12 Nov 2026 the anchor came 17 minutes after the inclusion, which is one measurement and not a
promise. That gate asked the route alone. Three public nodes were first asked about four hours
later, before the publication, and gave the gate's rows. Asking them at the gate is this file's
change, and has not been run as a gate.

**The rule for the private values ends here.** The id is public from the inclusion, and the planned
address soon will be. Both are still read from the record, not from notes.

### 5. The creation

**Who.** The verifier, from the working wallet, with block (c), on the operator's word for one send
and a ceiling for its cost.

**What for.** The reporter exists at the planned address, fixing the id the registry now holds.

The call is the factory's `deployCreate3(bytes32 salt, bytes initCode)`, sent to the factory with
value 0. `initCode` is the pinned build's whole creation code followed by the four constructor
arguments, ABI-encoded: the forwarder, the workflow owner, the workflow id, the games set. The
reporter's constructor reads neither its sender nor its origin, and the contract has no owner, no
setter and no storage, so the factory's one-use proxy, which becomes its creator, has no part in it
afterwards (`OspexChainlinkReporter.sol` in ospex-contracts-v2).

**What the block checks before the send.** `cast` is the build the trial copy ran with. The
keystore gives the working wallet, and the checkout of the reporter's build is clean. The timers
are stopped and their service has ended. The block takes the box's own lock on the working wallet
and keeps it, and the wallet's ledger shows no unfinished attempt (rule 11). The salt has its shape
and gives the planned address, worked out again with no node. The creation code hashes as the
pinned build's.

Then the reads that decide, at one named block, its hash read before and after (rule 8): the
factory's code hashes as pinned; the planned address and the proxy hold no code and have nonce 0;
the games set's approved list has room for one more; the exact call's estimate is within the gas
limit; the working wallet's count. After them, at the head: the count has not moved, and nothing is
waiting. The priority fee is within the fee limit, and the gas limit times the fee limit is within
the ceiling. The attempts file takes a line and gives it back.

**The send** is one line that sends the bytes the checks were made on, with the chain, the nonce,
value 0, the gas limit and both fee limits on it. The gas limit is 1,000,000: the creation used
607,482 on 12 Nov 2026. It is a call to the factory, not a creation by the wallet. Before it, the
function compares its values with the load's, reads the waiting count once more, and writes the
attempt down. A line that could not be written stops it. What `cast` printed is written down when
it returns (rule 10).

**Check, after.** The transaction read back by its hash: the chain, the sender, the factory, the
nonce, value 0, the gas limit, both fee limits and the whole call data as prepared. Receipt status
1. The factory's two events name the proxy and the planned address. The receipt's `contractAddress`
is empty, as for any call to a factory, and is not the test. Then, at the block that holds the
creation, its hash read before and after: the code at the address hashes to the runtime code hash
from the fork rehearsal, the four getters return the four constructor arguments, and `fixedValues()`
is the forwarder, the owner and the id. Only then is the lock released (`release_wallet`). The
timers stay off.

**Stop.**

* The attempt could not be written down: nothing is sent.
* What `cast` printed could not be written down, or no hash came back: unresolved. The attempt's
  line holds the nonce and the call data's hash, and the transaction is found by them. The lock is
  kept.
* A timeout, an RPC error, a missing receipt, "already known" or "replacement transaction
  underpriced": unknown. Keep the hash and the nonce, and read. No send at a new nonce, no new
  salt, no new registration, and no fee bump without a new word.
* A receipt with status 0: the wallet's nonce is spent and the creation rolled back. The address
  and the proxy must still be empty. Find the reason before anything else. A retry, if the operator
  gives one, uses the same salt, the same init code and the same planned address.
* Code already at the address: stop. Check the whole code and the transaction that put it there.
  Matching code is something to reconcile, not a reason to call the factory again.

**What is not a stop.** A balance at the planned address or at the proxy: anyone can send coin to
an address, and it is no collision (shown on a fork with one wei at each). The working wallet's
nonce having moved since the plan: the address does not turn on it, and a moved nonce is never a
reason to change the salt, the spec or the id.

**If the factory cannot be used**, the reporter is created by a wallet made for that one creation,
and the wallet is given coin only after the gate has passed. Its address appears nowhere before
that.

### 6. The publication

**Who.** The writer commits and opens the pull request. The operator merges.

**What for.** Anyone can rebuild the registered id from this repository (`BUILD.md`).

On 12 Nov 2026 this step came after the approval. Here it comes before it ("Why the order is what
it is").

* **Before the push**, the registry is read again at a finalized block, on three public nodes asked
  about one block. Both rows equal the gate's in every field, the owner's list is the same, and the
  owner's count has not moved.
* **One commit**: the spec, and `BUILD.md`'s lines for the new workflow. No file the build reads,
  no lockfile, no template and no tool pin is in it. A build of other bytes cannot become the
  registered workflow afterwards. `BUILD.md`'s lines say of the reporter what is true when they
  are written: before the approval, that it is created and not yet approved.
* **The fingerprint prints three matches**, before the push and on a fresh clone of the pushed
  branch. Its values are compared with the record and with the id the registry holds, not only with
  the spec's own `expect` block, which moves with the file.
* **After the merge**, a fresh clone of the merge commit: its tree is the branch head's tree, and
  the fingerprint prints the same three matches. The record names that merge commit as the one
  deployed.
* **This repository runs no CI.** The three suites (`build`, `games`, `scoring`) are run on the
  fresh clone of the pushed branch, and the pull request says so. On 12 Nov the clone of the merge
  commit ran the fingerprint and not the suites: its tree was the branch head's.
* **The working trees go back to main.** After the merge, each tree that sat on the merged branch
  is switched to main and pulled. Step 1's check of the commit would stop a later deploy that
  started from the wrong tree. This keeps one from getting that far.
* The run-line's route is written in the spec and nowhere else. `BUILD.md`, the commit message and
  the pull request call it the run-line's route.

**Stop.** A registry row that differs from the gate's, or a hash that does not match the record and
the registry: nothing is pushed.

### 7. The approval: schedule and execute

**Who.** The writer builds the call data. The verifier rebuilds it from its own reads before
reading the writer's, and the two must be equal byte for byte. The operator signs the schedule with
the timelock's key, with block (d). The verifier sends the execute from the working wallet, with
block (e).

**What for.** New games copy the new reporter beside the old.

**The values.**

* The inner call, to the games set: `approveReporter(reporter, kind, codeHash)`. `kind` is the kind
  the live reporter holds (1, first-n). `codeHash` is the keccak256 of the code read from the chain
  at the reporter's address after the creation, and it equals the fork rehearsal's. The games set
  checks that hash against the address itself when the call runs.
* The delay is read from the timelock on the day (`getMinDelay()`), never carried from an earlier
  read.
* The salt is the approval's own: `keccak256(abi.encode("approve reporter", reporter))`. It is
  never the creation's salt, and the two never share a variable in a block (`CREATION_SALT`,
  `APPROVAL_SALT`). It is derived so that a second party can rebuild it. It is no secret: only the
  timelock's proposer can schedule.
* The predecessor is zero and both values are 0. The operation id is checked against the timelock's
  own `hashOperation`.

**Reads before the schedule, at one block.** The code at the reporter and its hash. `getReporter`
of the new reporter (not approved) and of the old (unchanged). The approved list. The timelock's
code hash, its delay, the key's proposer role, and that the operation is not scheduled. Two dry
calls that each answer `0x`: the inner call as from the timelock, and the schedule as from the key.
And the controls, which must each refuse: the inner call as from the key, the old reporter approved
again, a code hash one digit off, the schedule as from another address, the execute before any
schedule.

These reads are the writer's and the verifier's own. They are made before block (d) is filled, and
their answers are in the record. Block (d) makes a few of them again as it loads, at a block it
names: the code hash, the delay, the operation id, that the operation is not scheduled, the two dry
calls and the key's count. That is a last look and not the proof. Block (d) does not read the
roles, the old reporter or the list, and it makes none of the controls. Its READY says nothing
about them.

**The schedule** is one signature. Before the line, in the wallet that holds the key: the key's
account is the selected one, and the chain for this caller is Polygon. To the wallet a terminal is
a caller of its own, with its own chain, and a new caller starts on Ethereum. The block's last
check asks the wallet its chain. Then, on the device:

1. The chain is Polygon, 137. The same key signs for a timelock on Ethereum.
2. The recipient is the timelock, the amount is 0, and the nonce is the one the block printed.
3. The call is `schedule` with its six values: the games set, 0, the inner call, a predecessor of
   zeros, the salt, the delay. On 12 Nov 2026 the device showed the call that way, value by value
   (the operator's recollection: nobody wrote the screens down).
4. **Inside the inner call, the reporter's address and the code hash are read whole,** every
   character, against the record. An address or a hash that agrees at both ends is cheap to make.
5. A second request waiting, or anything that differs: decline. Declining sends nothing.

What counts is the device's own screen. The terminal and the wallet's window are on one machine,
and a machine that shows a wrong value in one can show it in the other: reading both is not reading
two witnesses, and a record opened on that same machine is not a third. The wallet's window is
still the place to read the long values first, where nothing is timed, before pressing Sign: once
it is pressed, the device's answer is waited for in tries of 60 seconds (from the wallet's source,
not seen). If the device does not give the time to read a value whole, decline. `cast` gives a
wallet 45 seconds by default and then reports an error, while the wallet still sends if it is
signed later (measured with a stand-in for the wallet). The block gives it 15 minutes, and an error
from that line is still "unknown".

**The execute.** The timelock's executor role is open: once the operation is ready, anyone may
execute it, and the result is the same approval. So the approval may run earlier than our own send,
in someone else's transaction. The approval's place on the chain is where it ran, not where we
meant to send it (step 8).

The verifier sends it when the timelock's own `isOperationReady(id)` is true at a named block. The
first second is the schedule block's time plus the delay, not a count from the signing. Block (e)
takes the lock and reads the ledger as block (c) does (rule 11). Before the send, the schedule's
transaction is read back by its hash, and its call data is the schedule's bytes. Then, at the named
block: the reporter's code hash; the new reporter's whole entry (no kind, not retired, no code
hash); the approved list and each old reporter's whole entry, as the record holds them from before
the schedule; and a dry call of the execute. Fresh fee limits are given under a ceiling for this
send. The line sends the checked bytes themselves, not a second encoding of them, after the attempt
is written down (rule 10).

**Check, after, at the execute's block.** The transaction read back by its hash: the chain, the
sender, the timelock, the nonce, value 0, the gas limit, both fee limits and the whole call data as
prepared. The receipt's status is 1, its block's hash is the hash the node gives for that block,
and it holds the games set's `ReporterApproved` naming the reporter and the timelock's
`CallExecuted` naming the id. `isOperationDone(id)` is true. `getReporter(new)` is the kind and the
code hash. `getApprovedReporters()` is the old reporters and then the new. `getReporter(old)`, the
old reporter's code hash and its `fixedValues()` are what they were. The block, the transaction's
place in it and the place of `ReporterApproved` among its events go to the record: step 8 starts
from them. Then the lock is released, and the timers of step 1 go back on.

**Stop.**

* A check of the block says STOP, or the wallet answers on another chain: nothing is handed over.
* An error from the schedule's line: type `schedule_state`, and look in the wallet for a request
  still waiting, before anything else. A request left waiting can be signed later, and is then
  sent. Two equal counts do not prove that nothing went out.
* The execute fails, or is refused before it is sent, because the operation is already done:
  someone ran it first. Find that transaction by the timelock's `CallExecuted` event for the id,
  and read it and its block as if it were ours: the same after-reads, at its block. They decide. It
  is never a reason to schedule again, and the timelock refuses a second schedule of the same
  operation.

### 8. The canary

**Who.** The verifier reads.

**What for.** Proof that the new version scores a real game through its own reporter.

The canary is the first game created after the approval whose stored reporter arrays hold both
reporters (`getGameReporters`), and then its score: an accepted report that names the new reporter,
with the run-line's rows for that run in the table.

* **Where "after the approval" begins.** The approval takes effect at one place on the chain: the
  games set's `ReporterApproved` event, by its block and its place among that block's events, in
  whichever transaction executed the operation. It is read from that transaction's receipt, not
  taken from the time we meant to send. A game created earlier in that same block carries the old
  reporters alone, and one created later in it carries both. So the search for creations starts at
  the approval's block, not at the block after it, and a creation in that block is placed before or
  after the approval by its place among the events. The games set numbers its games in the order
  they are made, so its count at the end of that block says which game is the first after it.
* It is told by the arrays, not by a matchup, a date or who created it. Creating a game is open to
  anyone, before the approval as well, and stopping our own timer stops nobody else. A game made
  before the approval carries the old reporters alone, for good.
* A game that carries the old reporters alone is not counted as proof of the new version. Neither
  is the registration, the creation or the approval. Nothing is rewritten, and no older reporter is
  retired, to make a canary.
* The first such game comes with the first creation after the approval. On 12 Nov 2026 the
  creator's catch-up run made none, because the day's games existed already. The first was made at
  the next day's first run.
* The first live run is also where the things a simulation cannot show are first seen (step 0).
  The rows say whether the push was taken.

**Check.** The approval's block and place, from the receipt. The games set's count before that
block and at its end, and each creation in that block placed before or after the approval. The game
is the first one numbered above that count. The arrays at the game's creation block and at the read
block: both reporters, both kinds. Then, once the game has ended: the report's reporter, and the
rows.

**Stop.** There is none to make. Until a game with both reporters is scored through the new one,
the version is deployed and not yet proven.

## The blocks

Each block is text, to be made into a file for one deploy, outside this repository, with its values
filled from the record. Nothing here runs as it stands: a value written as `'<...>'` is a
placeholder, and a block with one left in stops at a check. The writer fills a block, tries a copy
that holds no live line (rule 7), and posts the file's SHA-256 with the one line that loads it:

```bash
F='<the block file>'; if [ "$(sha256sum "$F" | cut -c1-64)" = '<its SHA-256>' ]; then . "$F"; else echo 'STOP: the block file is not the one posted'; fi
```

Loading a block makes its checks and prints READY or NOT READY. Its live line is in a function that
is typed afterwards. The function asks for a phrase, compares its values with the load's, reads the
nonce once more, writes the attempt down, and only then sends. A block is loaded in a shell of its
own, and loaded again after any change (rule 12).

### The helpers

Every block starts with these lines.

```bash
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
PY=python          # python3 on the box
READY=yes
want()   { if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "STOP  $1: wanted ${3:0:90}, got ${2:0:90}"; READY=no; fi; }
holds()  { local label="$1"; shift; if "$@" >/dev/null 2>&1; then echo "ok    $label"; else echo "STOP  $label"; READY=no; fi; }
first()  { head -n 1 | cut -d' ' -f1; }
flat()   { tr '\n' ' ' | sed -e 's/  */ /g' -e 's/ $//'; }                    # an answer of several lines, as one
stamp()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
seal()   { printf '%s\n' "$@" | sha256sum | cut -c1-64; }                     # one hash over the values a send goes out with (rule 12)
record() {   # record '<one line>': appended to the attempts file, forced to disk and read back. False unless all three held (rule 10).
  printf '%s\n' "$1" | dd of="$ATTEMPTS" oflag=append conv=notrunc,fsync status=none || return 1
  [ "$(tail -n 1 "$ATTEMPTS")" = "$1" ]
}
note()   { record "noted $(stamp): $*" && echo 'Saved to the attempts file.' || echo 'NOT SAVED: write it into the record by hand before anything else.'; }
cast_build() { cast --version 2>&1 | grep -o -E 'Commit SHA: [0-9a-f]+' | cut -d' ' -f3; }
lower()  { printf '%s' "$1" | tr 'A-F' 'a-f'; }
atmost() { "$PY" -c 'import sys; a, b = int(sys.argv[1], 0), int(sys.argv[2], 0); print("yes" if 0 <= a <= b else "no")' "$1" "$2" 2>/dev/null || echo no; }
within() { "$PY" -c 'import sys; a, b, c = (int(x, 0) for x in sys.argv[1:4]); print("yes" if a > 0 and b > 0 and a * b <= c else "no")' "$1" "$2" "$3" 2>/dev/null || echo no; }
typed()  {   # typed '<phrase>': true only when every check passed and a person types the phrase at a terminal
  [ "$READY" = yes ] || { echo 'STOP: a check above did not pass. Nothing was sent.'; return 1; }
  { [ -t 0 ] && [ -t 1 ]; } || { echo 'STOP: this was not typed at a terminal. Nothing was sent.'; return 1; }
  local answer=''
  read -r -p "To send, type:  $1  > " answer || answer=''
  [ "$answer" = "$1" ] || { echo 'STOP: the phrase was not typed. Nothing was sent.'; return 1; }
}
```

### Room for one more

Step 0's reads, typed one at a time on any machine. They name the owner and the games set, which
are public, and nothing of the new version.

```bash
ETH='<an Ethereum node>'
POLY='<a Polygon node>'
REGISTRY=0x4Ac54353FA4Fa961AfcC5ec4B118596d3305E7e5
OWNER=0x89fe160bBBe59eAF428f23F095B71E5C0EdCDfa3
GAMES=0x1b424d0dDB5C4aa4551845898093ae8D58052fD3
FAMILY=zone-a
ROW='(bytes32,address,uint64,uint8,string,string,string,string,bytes,string)'    # id, owner, created, status, name, binary, config, tag, attributes, family
cast call "$REGISTRY" 'getMaxWorkflowsPerUserDON(address,string)(uint32)' "$OWNER" "$FAMILY" --rpc-url "$ETH"             # the owner limit in the family
cast call "$REGISTRY" "getWorkflowListByOwner(address,uint256,uint256)($ROW[])" "$OWNER" 0 100 --json --rpc-url "$ETH"    # the owner rows: those with status 0 in that family count against the limit
cast call "$REGISTRY" 'getMaxWorkflowsPerDON(string)(uint32,uint32)' "$FAMILY" --rpc-url "$ETH"                           # the limit of the family itself, then its default for an owner
cast call "$REGISTRY" 'totalActiveWorkflowsOnDON(string)(uint256)' "$FAMILY" --rpc-url "$ETH"                             # counts against the limit of the family
cast call "$GAMES" 'MAX_REPORTERS()(uint256)' --rpc-url "$POLY"                                                           # the most reporters the approved list holds
cast call "$GAMES" 'getApprovedReporters()(address[],uint8[])' --rpc-url "$POLY"                                          # the list: fewer than that
```

There is room when the owner's active rows in the family are fewer than its limit, the family's
active workflows are fewer than its own limit, and the approved list is shorter than
`MAX_REPORTERS`. Block (b) reads the owner's limit again before the upload, and block (c) reads
the list again before the creation.

### The route's lines

Blocks (a) and (b) carry these after the helpers. Git Bash, on the operator's machine.

```bash
CRE=cre-1.22.0
OWNER=0x89fe160bBBe59eAF428f23F095B71E5C0EdCDfa3
REGISTRY=0x4Ac54353FA4Fa961AfcC5ec4B118596d3305E7e5
NAME='<the new workflow name>'
ROUTE_URL='<the private endpoint, from the record>'
ROUTE_STATUS='<its status address, from the record: a transaction hash is put after it>'
ROUTE_FILE='<the route file, outside the repository folder and its parents>'
ATTEMPTS='<a file on this machine, outside the repository folder and its parents, that each attempt is written to before it goes>'
OWNER_WORD="000000000000000000000000$(lower "${OWNER#0x}")"
rpc() { curl -sS -m 20 -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,$1}" "$ROUTE_URL" | tr -d ' \r\n' | sed -n -E 's/.*"result":"(0x[0-9a-fA-F]*)".*/\1/p'; }
route_status() { curl -sS -m 20 "$ROUTE_STATUS${1:-}"; echo; }
route_reads() {   # the tool's own twelve reads, three rounds: they name the owner and the registry, and nothing else of ours
  local r body out n=0 bad=0
  for r in 1 2 3; do
    while IFS= read -r body; do
      n=$((n+1))
      out="$(curl -sS -m 20 -w ' HTTP=%{http_code}' -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":$n,$body}" "$ROUTE_URL" 2>&1 | tr -d ' \r\n')"
      case "$out" in
        *'"result":"0x'*HTTP=200|*'"result":{'*HTTP=200) ;;
        *) bad=$((bad+1)); echo "  round $r: no result for ${body%%,*} (${out: -8})" ;;
      esac
    done <<READS
"method":"eth_chainId","params":[]
"method":"eth_getTransactionCount","params":["$OWNER","latest"]
"method":"eth_call","params":[{"from":"$OWNER","to":"$REGISTRY","input":"0x181f5a77"},"latest"]
"method":"eth_call","params":[{"from":"$OWNER","to":"$REGISTRY","input":"0x0987294c$OWNER_WORD"},"latest"]
"method":"eth_call","params":[{"from":"$OWNER","to":"$REGISTRY","input":"0xbe674333${OWNER_WORD}000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000067a6f6e652d610000000000000000000000000000000000000000000000000000"},"latest"]
"method":"eth_call","params":[{"from":"$OWNER","to":"$REGISTRY","input":"0x8c42ffc5${OWNER_WORD}000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c8"},"latest"]
"method":"eth_estimateGas","params":[{"from":"$OWNER","to":"$REGISTRY","value":"0x0","input":"0x181f5a77"}]
"method":"eth_gasPrice","params":[]
"method":"eth_getTransactionCount","params":["$OWNER","pending"]
"method":"eth_getBlockByNumber","params":["latest",false]
"method":"eth_maxPriorityFeePerGas","params":[]
"method":"eth_getCode","params":["$REGISTRY","pending"]
READS
  done
  [ "$bad" = 0 ] && echo "ok    the route answered all $n reads, three rounds in a row" || { echo "STOP  the route gave no result for $bad of $n reads"; return 1; }
}
owner_state() {   # after any stop at a send or in a wait: the owner's two counts, and whether the registry lists the name
  local a b q rows
  a="$(rpc "\"method\":\"eth_getTransactionCount\",\"params\":[\"$OWNER\",\"latest\"]")"
  b="$(rpc "\"method\":\"eth_getTransactionCount\",\"params\":[\"$OWNER\",\"pending\"]")"
  q="$(cast calldata 'getWorkflowListByOwnerAndName(address,string,uint256,uint256)' "$OWNER" "$NAME" 0 200)"
  rows="$(rpc "\"method\":\"eth_call\",\"params\":[{\"to\":\"$REGISTRY\",\"input\":\"$q\"},\"latest\"]")"
  if [ -n "$a" ] && [ -n "$b" ]; then echo "owner count: mined $((a)), with waiting ones $((b))"; else echo 'owner count: NO ANSWER'; fi
  if [ -z "$rows" ]; then echo 'registry: NO ANSWER'; elif [ "${#rows}" -gt 130 ]; then echo "registry: HOLDS a row named $NAME for the owner"; else echo "registry: no row named $NAME for the owner"; fi
}
cd '<the repository folder>' || READY=no
want 'the route file is the one line' "$(cat "$ROUTE_FILE" 2>&1)" "ETH_MAINNET_RPC_URL=$ROUTE_URL"
holds '.env names the node address, so the tool will say which file won' grep -q -E '^(export +)?ETH_MAINNET_RPC_URL=' .env
want 'the route is on Ethereum' "$(rpc '"method":"eth_chainId","params":[]')" 0x1
route_reads || READY=no
MINED="$(rpc "\"method\":\"eth_getTransactionCount\",\"params\":[\"$OWNER\",\"latest\"]")"
holds 'the owner count was read' test -n "$MINED"
want 'the owner has nothing waiting' "$(rpc "\"method\":\"eth_getTransactionCount\",\"params\":[\"$OWNER\",\"pending\"]")" "$MINED"
NEXT=$((MINED))
still_next() { [ "$(rpc "\"method\":\"eth_getTransactionCount\",\"params\":[\"$OWNER\",\"pending\"]")" = "$MINED" ] || { echo 'STOP: the owner count moved since the checks. Nothing was sent. Load the block again.'; return 1; }; }
```

### (a) The route's rehearsal

After the helpers and the route's lines.

```bash
holds 'the attempts file takes a line and gives it back' record "loaded: rehearsal, the owner count $NEXT, $(stamp)"
SEAL="$(seal "$OWNER" "$REGISTRY" "$ROUTE_URL" "$ROUTE_FILE" "$NEXT")"
send_rehearsal() {
  typed "rehearse $NEXT" || return 1
  [ "$(seal "$OWNER" "$REGISTRY" "$ROUTE_URL" "$ROUTE_FILE" "$NEXT")" = "$SEAL" ] || { echo 'STOP: a value changed since the checks. Nothing was sent. Load the block again.'; return 1; }
  still_next || return 1
  record "attempt: rehearsal, one allowlist request, chain 1, from $OWNER, to $REGISTRY, the owner count $NEXT, $(stamp)" || { echo 'STOP: the attempt could not be written down. Nothing was sent.'; return 1; }
  CRE_TELEMETRY_DISABLED=true "$CRE" secrets list --namespace main --target production-settings --timeout 30m -E "$(cygpath -w "$ROUTE_FILE")"
  local rc=$?
  record "returned: rehearsal, the owner count $NEXT, the tool ended with $rc, $(stamp)" || echo 'NOT SAVED: write into the record by hand that the tool ended, and how.'
  echo "The tool ended with $rc. Whatever it printed, next type: note 0x<the hash it printed>   then: owner_state   and: route_status 0x<the hash>"
}
[ "$READY" = yes ] && echo "READY. Nothing has been sent. The rehearsal takes the owner count $NEXT. To send it, type: send_rehearsal" || echo 'NOT READY: a line above says STOP. send_rehearsal will refuse.'
```

### (b) The registration

After the helpers and the route's lines.

```bash
COMMIT='<the commit the program was merged as, 40 characters>'
SPEC='<the spec file, as build/....json>'
SPEC_SHA256='<from the record>'
CONFIG_OUT='<the generated config, as build/out/....config.json>'
CONFIG_HASH='<from the record, without 0x>'
BINARY_HASH='<from the record, without 0x>'
ID='<from the record, with 0x>'
want 'the tree is at the merged commit' "$(git rev-parse HEAD 2>&1)" "$COMMIT"
want 'the tree holds nothing new but the spec' "$(git status --porcelain 2>&1 | tr -d '\r')" "?? $SPEC"
want 'the spec is the one in the record' "$(sha256sum "$SPEC" 2>&1 | cut -c1-64)" "$SPEC_SHA256"
FP="$(CRE_BIN="$CRE" CRE_TELEMETRY_DISABLED=true bun build/fingerprint.ts "$SPEC" 2>&1 | tr -d '\r')"; printf '%s\n' "$FP"
want 'the fingerprint prints the three hashes, each a match' "$(printf '%s\n' "$FP" | grep -c -E "^  (config  $CONFIG_HASH|binary  $BINARY_HASH|id      $ID)  matches\$")" 3
want 'the config file is the one fingerprinted' "$(sha256sum "$CONFIG_OUT" 2>&1 | cut -c1-64)" "$CONFIG_HASH"
want 'the registry has no row of this name for the owner' "$(owner_state | tail -n 1)" "registry: no row named $NAME for the owner"
FAMILY=zone-a                                  # the DON family the registration names
LIMIT_HEX="$(rpc "\"method\":\"eth_call\",\"params\":[{\"to\":\"$REGISTRY\",\"input\":\"$(cast calldata 'getMaxWorkflowsPerUserDON(address,string)' "$OWNER" "$FAMILY")\"},\"latest\"]")"
ACTIVE_HEX="$(rpc "\"method\":\"eth_call\",\"params\":[{\"to\":\"$REGISTRY\",\"input\":\"$(cast calldata 'totalActiveWorkflowsByOwner(address)' "$OWNER")\"},\"latest\"]")"
want 'the owner limit and the owner active count were read' "${#LIMIT_HEX}/${#ACTIVE_HEX}" 66/66
want "the owner has room for one more active workflow ($((ACTIVE_HEX)) active in all families, limit $((LIMIT_HEX)) in $FAMILY)" "$(atmost "$((ACTIVE_HEX + 1))" "$((LIMIT_HEX))")" yes
holds 'the attempts file takes a line and gives it back' record "loaded: registration of $NAME, the owner count $NEXT, $(stamp)"
SEAL="$(seal "$OWNER" "$REGISTRY" "$ROUTE_URL" "$ROUTE_FILE" "$NEXT" "$NAME" "$ID" "$SPEC" "$SPEC_SHA256" "$CONFIG_OUT" "$CONFIG_HASH")"
send_registration() {
  typed "register $NAME ${ID: -8}" || return 1
  [ "$(seal "$OWNER" "$REGISTRY" "$ROUTE_URL" "$ROUTE_FILE" "$NEXT" "$NAME" "$ID" "$SPEC" "$SPEC_SHA256" "$CONFIG_OUT" "$CONFIG_HASH")" = "$SEAL" ] || { echo 'STOP: a value changed since the checks. Nothing was sent. Load the block again.'; return 1; }
  [ "$(sha256sum "$CONFIG_OUT" 2>&1 | cut -c1-64)" = "$CONFIG_HASH" ] || { echo 'STOP: the config file changed since the checks. Nothing was sent. Load the block again.'; return 1; }
  still_next || return 1
  record "attempt: registration of $NAME, chain 1, from $OWNER, to $REGISTRY, the owner count $NEXT, the spec with SHA-256 $SPEC_SHA256, $(stamp)" || { echo 'STOP: the attempt could not be written down. Nothing was sent or uploaded.'; return 1; }
  CRE_TELEMETRY_DISABLED=true "$CRE" workflow deploy ./games --target production-settings --config "$(cygpath -w "$PWD/$CONFIG_OUT")" -E "$(cygpath -w "$ROUTE_FILE")"
  local rc=$?
  record "returned: registration of $NAME, the owner count $NEXT, the tool ended with $rc, $(stamp)" || echo 'NOT SAVED: write into the record by hand that the tool ended, and how.'
  echo "The tool ended with $rc. Whatever it printed, next type: note 0x<the hash it printed>   then: owner_state   Nothing is run a second time before that."
}
[ "$READY" = yes ] && echo "READY. Nothing has been sent or uploaded. The registration takes the owner count $NEXT. To start the tool, type: send_registration" || echo 'NOT READY: a line above says STOP. send_registration will refuse.'
```

### The gate's reads

On the box, after the helpers. Reads only. The lines are typed one part at a time, and no part is
started before the one above it has passed.

```bash
ROUTE='<the private endpoint, from the record>'                    # the route the registration went by
PUBLIC=('<a public Ethereum node>' '<a second, run by another operator>' '<a third, run by another operator>')
OUT='<a private folder on the box for the answers>'
REGISTRY=0x4Ac54353FA4Fa961AfcC5ec4B118596d3305E7e5
OWNER=0x89fe160bBBe59eAF428f23F095B71E5C0EdCDfa3
NAME='<the new workflow name>'
FAMILY=zone-a
ID='<the new id>'
OLD_IDS=('<the live id>')                                           # one for each workflow the owner had before the day
TX='<the registration hash>'
EARLIER=('<the rehearsal hash>')                                    # every other transaction the owner sent since the count before the day
BINARY_URL='<the binary address the tool printed at the upload>'    # 12 Nov: https://storage.cre.chain.link/artifacts/<the id without 0x>/binary.wasm
CONFIG_URL='<the config address the tool printed at the upload>'    # 12 Nov: the same folder, /config
ROW='(bytes32,address,uint64,uint8,string,string,string,string,bytes,string)'    # id, owner, created, status, name, binary, config, tag, attributes, family

# 1. the transaction, on the route and on no other node
UPSERT="$(cast calldata 'upsertWorkflow(string,string,bytes32,uint8,string,string,string,bytes,bool)' "$NAME" "$NAME" "$ID" 0 "$FAMILY" "$BINARY_URL" "$CONFIG_URL" 0x false)"
cast tx "$TX" --json --rpc-url "$ROUTE"              # chainId 0x1, from the owner, to the registry, value 0x0, the nonce the block printed
[ "$(cast tx "$TX" input --rpc-url "$ROUTE")" = "$UPSERT" ] && echo 'call data: equal, every byte' || echo 'HOLD: the call data differs'
cast receipt "$TX" --json --rpc-url "$ROUTE"         # status 0x1; its blockNumber and blockHash are the inclusion
I='<the inclusion block number, from the receipt>'
I_HASH='<the inclusion block hash, from the receipt>'

# 2. the inclusion is public: each public node is asked for that block by its number, and for nothing that names the id
for n in "${PUBLIC[@]}"; do
  if [ "$(cast block "$I" -f hash --rpc-url "$n" | first)" = "$I_HASH" ] && cast block "$I" --json --rpc-url "$n" | grep -q -i -F "$TX"; then echo 'ok    a public node holds the inclusion block, with the registration in it'; else echo 'HOLD  a public node does not hold that block with the registration in it'; fi
done

# 3. the anchor: the lowest finalized block of the four, once every one of them is at or past the inclusion
SOURCES=("$ROUTE" "${PUBLIC[@]}")
anchor() {
  local n f low='' k=0
  for n in "${SOURCES[@]}"; do
    k=$((k+1)); f="$(cast block finalized -f number --rpc-url "$n" | first)"
    case "$f" in ''|*[!0-9]*) echo "HOLD  source $k gave no finalized block"; return 1 ;; esac
    echo "source $k: finalized block $f"
    if [ -z "$low" ] || [ "$f" -lt "$low" ]; then low="$f"; fi
  done
  if [ "$low" -ge "$I" ]; then echo "Every source is at or past the inclusion. The anchor is the lowest: $low"; else echo "Not yet: the lowest is $low and the inclusion is $I. Again in a minute."; fi
}
anchor                            # again, a minute apart, until it names the anchor
E='<the anchor>'

# 4. at the anchor: the same reads from each source, as one text
gate_reads() {   # gate_reads <a source>
  local n="$1" t
  echo "anchor $E: $(cast block "$E" -f hash --rpc-url "$n" | first)"
  echo "inclusion $I: $(cast block "$I" -f hash --rpc-url "$n" | first), time $(cast block "$I" -f timestamp --rpc-url "$n" | first)"
  for t in "$TX" "${EARLIER[@]}"; do
    echo "transaction $t: block $(cast receipt "$t" blockNumber --rpc-url "$n" | first), receipts with status 0x1: $(cast receipt "$t" --json --rpc-url "$n" | tr -d ' ' | grep -c '"status":"0x1"'), from $(cast tx "$t" from --rpc-url "$n" | first), nonce $(cast tx "$t" nonce --rpc-url "$n" | first), call data keccak $(cast keccak "$(cast tx "$t" input --rpc-url "$n")" | first)"
  done
  echo "the new row: $(cast call "$REGISTRY" "getWorkflowById(bytes32)($ROW)" "$ID" --block "$E" --json --rpc-url "$n")"
  for t in "${OLD_IDS[@]}"; do echo "an old row: $(cast call "$REGISTRY" "getWorkflowById(bytes32)($ROW)" "$t" --block "$E" --json --rpc-url "$n")"; done
  echo "the owner list, a page of 100: $(cast call "$REGISTRY" "getWorkflowListByOwner(address,uint256,uint256)($ROW[])" "$OWNER" 0 100 --block "$E" --json --rpc-url "$n")"
  echo "the owner active workflows, by the registry count: $(cast call "$REGISTRY" 'totalActiveWorkflowsByOwner(address)(uint256)' "$OWNER" --block "$E" --rpc-url "$n" | first)"
  echo "the owner count: $(cast nonce "$OWNER" --block "$E" --rpc-url "$n" | first)"
  echo "anchor $E, after: $(cast block "$E" -f hash --rpc-url "$n" | first)"
  echo "inclusion $I, after: $(cast block "$I" -f hash --rpc-url "$n" | first)"
}
k=0; for n in "${SOURCES[@]}"; do k=$((k+1)); gate_reads "$n" > "$OUT/gate.$k.txt" 2> "$OUT/gate.$k.err"; echo "source $k: $(sha256sum "$OUT/gate.$k.txt" | cut -c1-64), $(wc -c < "$OUT/gate.$k.err" | tr -d ' ') bytes of errors"; done

# 5. the four lines above show one hash and 0 bytes of errors. Then one answer is read against the record, field by field.
cat "$OUT/gate.1.txt"
echo "the registration call data, as built here: keccak $(cast keccak "$UPSERT")"
```

In the answer: the registration's call data keccak is the one built here. The new row's creation
time is the inclusion block's time. The owner's count is the count before the day plus the
transactions listed, each with status 1 and its own nonce. A different hash on any of the four
lines, or any bytes of errors, is a hold, and the two answers are compared to find where
(`diff "$OUT/gate.1.txt" "$OUT/gate.2.txt"`).

### The box's lines

Blocks (c) and (e) carry these after the helpers, with `PY=python3`. They are the working wallet's
side of rules 10 and 11. The lock is the file the box's own sender locks with `flock` before it
sends. Where it is, and how the timers and the ledger are read, is in the box's own record and not
in this file.

```bash
RPC='<the Polygon node the box sends through, taken from the box settings and never printed>'
KEYSTORE_ACCOUNT='<the working wallet keystore name>'
PASSWORD_FILE='<the keystore password file>'
ATTEMPTS='<a file on the box, outside every repository, that each send is written to before it goes>'
WALLET_LOCK='<the lock file the box own sender takes before it sends from the working wallet>'
DEPLOYER=0x16Dc5D67D080a5521ef2c79680dBfC2aBf724D30
GAMES=0x1b424d0dDB5C4aa4551845898093ae8D58052fD3
timers_state()        { '<the box own line: it prints stopped when the timer is stopped and disabled and the service it starts has ended>'; }
unfinished_attempts() { '<the box own line: it prints how many attempts in the wallet ledger are not finished, and writes nothing>'; }
hold_wallet() {   # takes the lock for this shell and keeps it: the file is opened to read, never written
  [ -r "$WALLET_LOCK" ] || return 1
  exec 9< "$WALLET_LOCK" || return 1
  flock -n -x 9
}
release_wallet() { exec 9<&-; echo 'The lock on the working wallet is released.'; }
box_checks() {   # the timers, the lock, the ledger, the keystore, the chain
  holds 'the timers are stopped, and the service they start has ended' test "$(timers_state 2>&1)" = stopped
  holds 'the lock on the working wallet is taken, and kept until release_wallet' hold_wallet
  want 'the wallet ledger shows no unfinished attempt' "$(unfinished_attempts 2>&1)" 0
  want 'the keystore gives the working wallet' "$(lower "$(cast wallet address --account "$KEYSTORE_ACCOUNT" --password-file "$PASSWORD_FILE" 2>&1 | first)")" "$(lower "$DEPLOYER")"
  want 'the node is on Polygon' "$(cast chain-id --rpc-url "$RPC" 2>&1 | first)" 137
}
name_block() {   # names the block the deciding reads are made at: B and HASH_BEFORE
  B="$(cast block-number --rpc-url "$RPC" 2>&1 | first)"
  HASH_BEFORE="$(cast block "$B" -f hash --rpc-url "$RPC" 2>&1 | first)"
  want 'a block is named for the reads' "$([[ "$B" =~ ^[0-9]+$ && "$HASH_BEFORE" =~ ^0x[0-9a-f]{64}$ ]] && echo yes || echo no)" yes
}
same_block() { want 'the block read is still that block' "$(cast block "$B" -f hash --rpc-url "$RPC" 2>&1 | first)" "$HASH_BEFORE"; }
```

### (c) The creation

On the box, after the helpers and the box's lines.

```bash
cd '<a clean checkout of ospex-contracts-v2 at the reporter build>' || READY=no
SALT_FILE='<the salt file>'
GATE_ANCHOR='<the gate anchor from the record: its block number and its hash>'
FACTORY=0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed
FACTORY_CODE_HASH=0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f
FORWARDER=0x76c9cf548b4179F8901cda1f8623568b58215E62
WORKFLOW_OWNER=0x89fe160bBBe59eAF428f23F095B71E5C0EdCDfa3
CREATION_CODE_HASH=0x4bc8a79df07ef940c527370b48917168593cd338c7dc3225e4395a28c3f8d825    # the reporter as built at ospex-contracts-v2 3fe47cb
WORKFLOW_ID='<the id the gate read at the finalized block>'
P='<the planned address, from the record>'
GAS_LIMIT=1000000
MAX_FEE_WEI='<the fee limit given for this send, in wei>'             # 12 Nov: the larger of eth_gasPrice and twice the base fee plus the priority fee
PRIORITY_FEE_WEI='<the priority fee given for this send, in wei>'
CEILING_WEI='<the most this send may cost, in wei>'

want 'cast is the build the trial copy ran with' "$(cast_build)" '<the commit of that cast build>'
holds 'the checkout is clean' test -z "$(git status --porcelain 2>&1)"
box_checks
read -r CREATION_SALT < "$SALT_FILE"
DEPLOYER_LC="$(lower "${DEPLOYER#0x}")"
want 'the salt has its shape: the deployer, 00, eleven bytes' "$([[ "$(lower "$CREATION_SALT")" =~ ^0x${DEPLOYER_LC}00[0-9a-f]{22}$ ]] && echo yes || echo no)" yes
GUARDED="$(cast keccak "$(cast abi-encode 'f(address,bytes32)' "$DEPLOYER" "$CREATION_SALT")")"
PROXY="$(cast create2 --deployer "$FACTORY" --salt "$GUARDED" --init-code 0x67363d3d37363d34f03d5260086018f3)"
want 'the salt gives the planned address, worked out with no node' "$(lower "$(cast compute-address "$PROXY" --nonce 1 | cut -d' ' -f3)")" "$(lower "$P")"
CREATION_CODE="$(jq -er .bytecode.object out/OspexChainlinkReporter.sol/OspexChainlinkReporter.json)"
want 'the creation code is the pinned build' "$(cast keccak "$CREATION_CODE")" "$CREATION_CODE_HASH"
INIT_CODE="${CREATION_CODE}$(cast abi-encode 'f(address,address,bytes32,address)' "$FORWARDER" "$WORKFLOW_OWNER" "$WORKFLOW_ID" "$GAMES" | cut -c3-)"
CALL="$(cast calldata 'deployCreate3(bytes32,bytes)' "$CREATION_SALT" "$INIT_CODE")"
CALL_KECCAK="$(cast keccak "$CALL")"
name_block                                     # the reads that decide, all at block B
want 'the factory is the pinned code' "$(cast keccak "$(cast code "$FACTORY" --block "$B" --rpc-url "$RPC" 2>&1)" 2>&1 | first)" "$FACTORY_CODE_HASH"
want 'the planned address is empty' "$(cast code "$P" --block "$B" --rpc-url "$RPC" 2>&1 | first)/$(cast nonce "$P" --block "$B" --rpc-url "$RPC" 2>&1 | first)" 0x/0
want 'the factory proxy is empty' "$(cast code "$PROXY" --block "$B" --rpc-url "$RPC" 2>&1 | first)/$(cast nonce "$PROXY" --block "$B" --rpc-url "$RPC" 2>&1 | first)" 0x/0
APPROVED_COUNT="$(cast call "$GAMES" 'getApprovedReporters()(address[],uint8[])' --block "$B" --rpc-url "$RPC" 2>&1 | head -n 1 | grep -o -E '0x[0-9a-fA-F]{40}' | wc -l | tr -d ' ')"
want 'the approved list was read: it is never empty' "$(atmost 1 "$APPROVED_COUNT")" yes
want "the games set has room for one more reporter ($APPROVED_COUNT approved)" "$(atmost "$((APPROVED_COUNT + 1))" "$(cast call "$GAMES" 'MAX_REPORTERS()(uint256)' --block "$B" --rpc-url "$RPC" 2>&1 | first)")" yes
ESTIMATE="$(cast estimate "$FACTORY" "$CALL" --from "$DEPLOYER" --value 0 --block "$B" --rpc-url "$RPC" 2>&1 | first)"
want "the exact call's estimate ($ESTIMATE) is within the gas limit" "$(atmost "$ESTIMATE" "$GAS_LIMIT")" yes
SEND_NONCE="$(cast nonce "$DEPLOYER" --block "$B" --rpc-url "$RPC" 2>&1 | first)"
same_block
want 'the wallet count has not moved since that block' "$(cast nonce "$DEPLOYER" --rpc-url "$RPC" 2>&1 | first)" "$SEND_NONCE"
want 'the working wallet has nothing waiting' "$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC" 2>&1 | first)" "$SEND_NONCE"
want 'the priority fee is within the fee limit' "$(atmost "$PRIORITY_FEE_WEI" "$MAX_FEE_WEI")" yes
want 'the gas limit times the fee limit is within the ceiling' "$(within "$GAS_LIMIT" "$MAX_FEE_WEI" "$CEILING_WEI")" yes
holds 'the attempts file takes a line and gives it back' record "loaded: creation, chain 137, checked at block $B $HASH_BEFORE, call data keccak $CALL_KECCAK, $(stamp)"
SEAL="$(seal "$FACTORY" "$DEPLOYER" "$P" "$SEND_NONCE" "$GAS_LIMIT" "$MAX_FEE_WEI" "$PRIORITY_FEE_WEI" "$CEILING_WEI" "$RPC" "$KEYSTORE_ACCOUNT" "$CALL")"
send_creation() {
  typed "create ${P: -8}" || return 1
  [ "$(seal "$FACTORY" "$DEPLOYER" "$P" "$SEND_NONCE" "$GAS_LIMIT" "$MAX_FEE_WEI" "$PRIORITY_FEE_WEI" "$CEILING_WEI" "$RPC" "$KEYSTORE_ACCOUNT" "$CALL")" = "$SEAL" ] || { echo 'STOP: a value changed since the checks. Nothing was sent. Load the block again.'; return 1; }
  [ "$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC" 2>&1 | first)" = "$SEND_NONCE" ] || { echo 'STOP: the wallet count moved since the checks. Nothing was sent. Load the block again.'; return 1; }
  record "attempt: creation, chain 137, from $DEPLOYER, to $FACTORY, nonce $SEND_NONCE, value 0, call data keccak $CALL_KECCAK, gas limit $GAS_LIMIT, fee limit $MAX_FEE_WEI, priority $PRIORITY_FEE_WEI, checked at block $B $HASH_BEFORE, gate $GATE_ANCHOR, $(stamp)" || { echo 'STOP: the attempt could not be written down. Nothing was sent.'; return 1; }
  local out rc
  out="$(cast send "$FACTORY" "$CALL" --from "$DEPLOYER" --account "$KEYSTORE_ACCOUNT" --password-file "$PASSWORD_FILE" \
    --chain 137 --nonce "$SEND_NONCE" --value 0 --gas-limit "$GAS_LIMIT" \
    --gas-price "$MAX_FEE_WEI" --priority-gas-price "$PRIORITY_FEE_WEI" \
    --rpc-url "$RPC" --async)"; rc=$?
  printf '%s\n' "$out"
  record "returned: creation, nonce $SEND_NONCE, cast ended with $rc and printed: $(printf '%s' "$out" | flat)" || echo 'UNRESOLVED: what cast printed could not be written down. Copy the line above into the record by hand before anything else.'
  echo "cast ended with $rc. A line of 0x and 64 characters above is the transaction. Whatever it printed, next: the reads after the creation. The lock is kept until release_wallet."
}
[ "$READY" = yes ] && echo "READY. Nothing has been sent. The creation takes the wallet count $SEND_NONCE. To send it, type: send_creation" || echo 'NOT READY: a line above says STOP. send_creation will refuse. Type release_wallet before leaving this shell.'
```

The reads after the creation, in the same shell, typed one at a time:

```bash
TX='<the hash the send printed>'
cast tx "$TX" --json --rpc-url "$RPC"         # chainId 0x89, from the working wallet, to the factory, the nonce, value 0x0, the gas limit and both fee limits as sent
[ "$(cast tx "$TX" input --rpc-url "$RPC")" = "$CALL" ] && echo 'call data: equal, every byte' || echo 'STOP: the call data differs'
cast receipt "$TX" --json --rpc-url "$RPC"    # status 0x1; contractAddress null; two logs from the factory: one names the proxy, one names the planned address
C='<the receipt blockNumber>'
RUNTIME_HASH='<the runtime code hash from the fork rehearsal>'
cast block "$C" -f hash --rpc-url "$RPC"      # the receipt's blockHash
[ "$(cast keccak "$(cast code "$P" --block "$C" --rpc-url "$RPC")")" = "$RUNTIME_HASH" ] && echo 'the code at the address is the reporter' || echo 'STOP: the code hash differs'
cast call "$P" 'i_forwarder()(address)' --block "$C" --rpc-url "$RPC"
cast call "$P" 'i_workflowOwner()(address)' --block "$C" --rpc-url "$RPC"
cast call "$P" 'i_workflowId()(bytes32)' --block "$C" --rpc-url "$RPC"
cast call "$P" 'i_games()(address)' --block "$C" --rpc-url "$RPC"
cast call "$P" 'fixedValues()(bytes)' --block "$C" --rpc-url "$RPC"      # the forwarder, the owner and the id, each as one 32-byte word
cast block "$C" -f hash --rpc-url "$RPC"      # unchanged
note "creation read back: $TX in block $C"
release_wallet                                # only after every read above is as the record expects
```

### (d) The schedule

Git Bash, on the operator's machine, after the helpers.

```bash
WALLET='<the local address the key wallet listens on, from the record>'
READ='<a public Polygon node>'                 # project.yaml names one for polygon-mainnet
ATTEMPTS='<a file on this machine, outside the repository folder and its parents, that each attempt is written to before it goes>'
TL=0x8CED8e82cf1488B7365C0726aEeD795b6C07582C
KEY=0x3BD1e22Dc38376b776072a20c581DDb716e21d8E
GAMES=0x1b424d0dDB5C4aa4551845898093ae8D58052fD3
ZERO=0x0000000000000000000000000000000000000000000000000000000000000000
P='<the reporter, from the record>'
CODE_HASH='<the code hash read at the reporter after the creation>'
DELAY='<the delay read from the timelock today>'
ID='<the operation id, from the record>'
SCHED_KECCAK='<the keccak256 of the schedule call data, from the record>'
KEY_NONCE='<the key count on Polygon, from the record>'
GAS_LIMIT=150000                               # the schedule used 67,476 on 12 Nov 2026; a fork had said 57,396
MAX_FEE_WEI='<the fee limit given for this send, in wei>'
PRIORITY_FEE_WEI='<the priority fee given for this send, in wei>'
CEILING_WEI='<the most this send may cost, in wei>'

want 'cast is the build the trial copy ran with' "$(cast_build)" '<the commit of that cast build>'
INNER="$(cast calldata 'approveReporter(address,uint8,bytes32)' "$P" 1 "$CODE_HASH")"
APPROVAL_SALT="$(cast keccak "$(cast abi-encode 'f(string,address)' 'approve reporter' "$P")")"
SCHED="$(cast calldata 'schedule(address,uint256,bytes,bytes32,bytes32,uint256)' "$GAMES" 0 "$INNER" "$ZERO" "$APPROVAL_SALT" "$DELAY")"
want 'the call data is the one in the record (keccak)' "$(cast keccak "$SCHED" 2>&1 | first)" "$SCHED_KECCAK"
want 'the read node is on Polygon' "$(cast chain-id --rpc-url "$READ" 2>&1 | first)" 137
B="$(cast block-number --rpc-url "$READ" 2>&1 | first)"                                   # the last look, all at block B
HASH_BEFORE="$(cast block "$B" -f hash --rpc-url "$READ" 2>&1 | first)"
want 'a block is named for the reads' "$([[ "$B" =~ ^[0-9]+$ && "$HASH_BEFORE" =~ ^0x[0-9a-f]{64}$ ]] && echo yes || echo no)" yes
want 'the code at the reporter hashes as the approval names' "$(cast keccak "$(cast code "$P" --block "$B" --rpc-url "$READ" 2>&1)" 2>&1 | first)" "$CODE_HASH"
want 'the timelock delay is the one the schedule carries' "$(cast call "$TL" 'getMinDelay()(uint256)' --block "$B" --rpc-url "$READ" 2>&1 | first)" "$DELAY"
want 'the timelock gives the operation id in the record' "$(cast call "$TL" 'hashOperation(address,uint256,bytes,bytes32,bytes32)(bytes32)' "$GAMES" 0 "$INNER" "$ZERO" "$APPROVAL_SALT" --block "$B" --rpc-url "$READ" 2>&1 | first)" "$ID"
want 'the operation is not scheduled yet' "$(cast call "$TL" 'getTimestamp(bytes32)(uint256)' "$ID" --block "$B" --rpc-url "$READ" 2>&1 | first)" 0
want 'dry call: the games set takes the approval from the timelock' "$(cast call "$GAMES" "$INNER" --from "$TL" --block "$B" --rpc-url "$READ" 2>&1 | first)" 0x
want 'dry call: the timelock takes the schedule from the key' "$(cast call "$TL" "$SCHED" --from "$KEY" --block "$B" --rpc-url "$READ" 2>&1 | first)" 0x
want 'the key count at that block is the nonce this sends with' "$(cast nonce "$KEY" --block "$B" --rpc-url "$READ" 2>&1 | first)" "$KEY_NONCE"
want 'the block read is still that block' "$(cast block "$B" -f hash --rpc-url "$READ" 2>&1 | first)" "$HASH_BEFORE"
want 'the key count has not moved since that block' "$(cast nonce "$KEY" --rpc-url "$READ" 2>&1 | first)" "$KEY_NONCE"
want 'the key has nothing waiting' "$(cast nonce "$KEY" --block pending --rpc-url "$READ" 2>&1 | first)" "$KEY_NONCE"
want 'the priority fee is within the fee limit' "$(atmost "$PRIORITY_FEE_WEI" "$MAX_FEE_WEI")" yes
want 'the gas limit times the fee limit is within the ceiling' "$(within "$GAS_LIMIT" "$MAX_FEE_WEI" "$CEILING_WEI")" yes
echo "info  the key holds $(cast balance "$KEY" --ether --rpc-url "$READ" 2>&1 | first) for the fee"
want 'the wallet answers on Polygon' "$(cast chain-id --rpc-url "$WALLET" 2>&1 | first)" 137
holds 'the attempts file takes a line and gives it back' record "loaded: schedule, chain 137, checked at block $B $HASH_BEFORE, call data keccak $SCHED_KECCAK, $(stamp)"
SEAL="$(seal "$TL" "$KEY" "$P" "$CODE_HASH" "$ID" "$KEY_NONCE" "$GAS_LIMIT" "$MAX_FEE_WEI" "$PRIORITY_FEE_WEI" "$CEILING_WEI" "$WALLET" "$SCHED")"
schedule_state() {   # reads the public node only; asks the wallet nothing
  local t
  echo "key count: mined $(cast nonce "$KEY" --rpc-url "$READ" 2>&1 | first), with waiting ones $(cast nonce "$KEY" --block pending --rpc-url "$READ" 2>&1 | first)   (the nonce above is $KEY_NONCE)"
  t="$(cast call "$TL" 'getTimestamp(bytes32)(uint256)' "$ID" --rpc-url "$READ" 2>&1 | first)"
  case "$t" in
    0) echo 'operation: NOT scheduled' ;;
    1) echo 'operation: DONE, the approval has been executed' ;;
    *[!0-9]*|'') echo "operation: NO ANSWER ($t)" ;;
    *) echo "operation: SCHEDULED, may be executed from unix time $t; the timelock says ready: $(cast call "$TL" 'isOperationReady(bytes32)(bool)' "$ID" --rpc-url "$READ" 2>&1 | first)" ;;
  esac
  [ -n "${1:-}" ] && cast receipt "$1" --rpc-url "$READ" 2>&1 | grep -E '^(status|blockNumber|gasUsed) '
  return 0
}
send_schedule() {
  typed "schedule ${ID: -8}" || return 1
  [ "$(seal "$TL" "$KEY" "$P" "$CODE_HASH" "$ID" "$KEY_NONCE" "$GAS_LIMIT" "$MAX_FEE_WEI" "$PRIORITY_FEE_WEI" "$CEILING_WEI" "$WALLET" "$SCHED")" = "$SEAL" ] || { echo 'STOP: a value changed since the checks. Nothing was handed to the wallet. Load the block again.'; return 1; }
  [ "$(cast keccak "$SCHED" 2>&1 | first)" = "$SCHED_KECCAK" ] || { echo 'STOP: the call data is not the one in the record. Nothing was handed to the wallet.'; return 1; }
  [ "$(cast nonce "$KEY" --block pending --rpc-url "$READ" 2>&1 | first)" = "$KEY_NONCE" ] || { echo 'STOP: the key count moved since the checks. Nothing was handed to the wallet.'; return 1; }
  record "attempt: schedule, chain 137, from $KEY, to $TL, nonce $KEY_NONCE, value 0, call data keccak $SCHED_KECCAK, gas limit $GAS_LIMIT, fee limit $MAX_FEE_WEI, priority $PRIORITY_FEE_WEI, checked at block $B $HASH_BEFORE, $(stamp)" || { echo 'STOP: the attempt could not be written down. Nothing was handed to the wallet.'; return 1; }
  echo 'Handed to the wallet. It and then the device must show:'
  echo "  chain  Polygon, 137        value  0        nonce  $KEY_NONCE"
  echo "  from   $KEY"
  echo "  to     $TL"
  echo "  schedule: target $GAMES, value 0, predecessor all zeros, delay $DELAY"
  echo "            salt $APPROVAL_SALT"
  echo "            data $INNER"
  echo "  inside the data, read whole on the device: the reporter $P and the code hash $CODE_HASH"
  echo 'Anything else, or a second request waiting: decline. This line waits up to 15 minutes.'
  local out rc
  out="$(cast send --unlocked --from "$KEY" --chain 137 --nonce "$KEY_NONCE" --value 0 --gas-limit "$GAS_LIMIT" \
    --gas-price "$MAX_FEE_WEI" --priority-gas-price "$PRIORITY_FEE_WEI" \
    --rpc-url "$WALLET" --rpc-timeout 900 --async "$TL" "$SCHED")"; rc=$?
  printf '%s\n' "$out"
  record "returned: schedule, nonce $KEY_NONCE, cast ended with $rc and printed: $(printf '%s' "$out" | flat)" || echo 'UNRESOLVED: what cast printed could not be written down. Copy the line above into the record by hand before anything else.'
  echo "cast ended with $rc. A line of 0x and 64 characters above is the transaction. Whatever it printed, next type: schedule_state"
}
[ "$READY" = yes ] && echo 'READY. Nothing has been handed to the wallet. To hand the schedule over, type: send_schedule' || echo 'NOT READY: a line above says STOP. send_schedule will refuse.'
```

### (e) The execute

On the box, after the helpers and the box's lines.

```bash
TL=0x8CED8e82cf1488B7365C0726aEeD795b6C07582C
ZERO=0x0000000000000000000000000000000000000000000000000000000000000000
P='<the reporter, from the record>'
CODE_HASH='<the code hash the schedule named>'
DELAY='<the delay the schedule carried>'
ID='<the operation id, from the record>'
SCHED_KECCAK='<the keccak256 of the schedule call data, from the record>'
EXEC_KECCAK='<the keccak256 of the execute call data, from the record>'
SCHEDULE_TX='<the schedule hash>'
APPROVED_BEFORE='<the approved list before the schedule, from the record, as one line: [the reporters] [their kinds]>'
OLD='<a reporter approved before>'                                  # for more than one, the two lines that name OLD are repeated for each
OLD_ENTRY='<its entry before the schedule, from the record, as one line: kind retired codehash>'
GAS_LIMIT=300000                               # the execute used 136,612 on 12 Nov 2026
MAX_FEE_WEI='<the fee limit given for this send, in wei>'
PRIORITY_FEE_WEI='<the priority fee given for this send, in wei>'
CEILING_WEI='<the most this send may cost, in wei>'

INNER="$(cast calldata 'approveReporter(address,uint8,bytes32)' "$P" 1 "$CODE_HASH")"
APPROVAL_SALT="$(cast keccak "$(cast abi-encode 'f(string,address)' 'approve reporter' "$P")")"
SCHED="$(cast calldata 'schedule(address,uint256,bytes,bytes32,bytes32,uint256)' "$GAMES" 0 "$INNER" "$ZERO" "$APPROVAL_SALT" "$DELAY")"
EXEC="$(cast calldata 'execute(address,uint256,bytes,bytes32,bytes32)' "$GAMES" 0 "$INNER" "$ZERO" "$APPROVAL_SALT")"
want 'cast is the build the trial copy ran with' "$(cast_build)" '<the commit of that cast build>'
want 'the schedule call data is the one in the record (keccak)' "$(cast keccak "$SCHED" 2>&1 | first)" "$SCHED_KECCAK"
want 'the execute call data is the one in the record (keccak)' "$(cast keccak "$EXEC" 2>&1 | first)" "$EXEC_KECCAK"
box_checks
want 'the schedule that was mined carries those bytes' "$(cast tx "$SCHEDULE_TX" input --rpc-url "$RPC" 2>&1 | first)" "$SCHED"
want 'the schedule succeeded' "$(cast receipt "$SCHEDULE_TX" --json --rpc-url "$RPC" 2>&1 | tr -d ' ' | grep -c '"status":"0x1"')" 1
name_block                                     # the reads that decide, all at block B
want 'the code at the reporter hashes as the schedule named' "$(cast keccak "$(cast code "$P" --block "$B" --rpc-url "$RPC" 2>&1)" 2>&1 | first)" "$CODE_HASH"
want 'the timelock gives the operation id in the record' "$(cast call "$TL" 'hashOperation(address,uint256,bytes,bytes32,bytes32)(bytes32)' "$GAMES" 0 "$INNER" "$ZERO" "$APPROVAL_SALT" --block "$B" --rpc-url "$RPC" 2>&1 | first)" "$ID"
want 'the timelock says the operation is ready' "$(cast call "$TL" 'isOperationReady(bytes32)(bool)' "$ID" --block "$B" --rpc-url "$RPC" 2>&1 | first)" true
want 'the reporter has no entry yet: no kind, not retired, no code hash' "$(cast call "$GAMES" 'getReporter(address)(uint8,bool,bytes32)' "$P" --block "$B" --rpc-url "$RPC" 2>&1 | flat)" "0 false $ZERO"
want 'the approved list is the one before the schedule' "$(cast call "$GAMES" 'getApprovedReporters()(address[],uint8[])' --block "$B" --rpc-url "$RPC" 2>&1 | flat)" "$APPROVED_BEFORE"
want 'the old reporter entry is the one before the schedule' "$(cast call "$GAMES" 'getReporter(address)(uint8,bool,bytes32)' "$OLD" --block "$B" --rpc-url "$RPC" 2>&1 | flat)" "$OLD_ENTRY"
want 'the old reporter code hashes as its entry says' "$(cast keccak "$(cast code "$OLD" --block "$B" --rpc-url "$RPC" 2>&1)" 2>&1 | first)" "${OLD_ENTRY##* }"
want 'dry call: the timelock takes the execute from the working wallet' "$(cast call "$TL" "$EXEC" --from "$DEPLOYER" --block "$B" --rpc-url "$RPC" 2>&1 | first)" 0x
ESTIMATE="$(cast estimate "$TL" "$EXEC" --from "$DEPLOYER" --value 0 --block "$B" --rpc-url "$RPC" 2>&1 | first)"
want "the estimate ($ESTIMATE) is within the gas limit" "$(atmost "$ESTIMATE" "$GAS_LIMIT")" yes
SEND_NONCE="$(cast nonce "$DEPLOYER" --block "$B" --rpc-url "$RPC" 2>&1 | first)"
same_block
want 'the wallet count has not moved since that block' "$(cast nonce "$DEPLOYER" --rpc-url "$RPC" 2>&1 | first)" "$SEND_NONCE"
want 'the working wallet has nothing waiting' "$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC" 2>&1 | first)" "$SEND_NONCE"
want 'the priority fee is within the fee limit' "$(atmost "$PRIORITY_FEE_WEI" "$MAX_FEE_WEI")" yes
want 'the gas limit times the fee limit is within the ceiling' "$(within "$GAS_LIMIT" "$MAX_FEE_WEI" "$CEILING_WEI")" yes
holds 'the attempts file takes a line and gives it back' record "loaded: execute, chain 137, checked at block $B $HASH_BEFORE, call data keccak $EXEC_KECCAK, $(stamp)"
SEAL="$(seal "$TL" "$DEPLOYER" "$P" "$ID" "$SEND_NONCE" "$GAS_LIMIT" "$MAX_FEE_WEI" "$PRIORITY_FEE_WEI" "$CEILING_WEI" "$RPC" "$KEYSTORE_ACCOUNT" "$EXEC")"
send_execute() {
  typed "execute ${ID: -8}" || return 1
  [ "$(seal "$TL" "$DEPLOYER" "$P" "$ID" "$SEND_NONCE" "$GAS_LIMIT" "$MAX_FEE_WEI" "$PRIORITY_FEE_WEI" "$CEILING_WEI" "$RPC" "$KEYSTORE_ACCOUNT" "$EXEC")" = "$SEAL" ] || { echo 'STOP: a value changed since the checks. Nothing was sent. Load the block again.'; return 1; }
  [ "$(cast call "$TL" 'isOperationReady(bytes32)(bool)' "$ID" --rpc-url "$RPC" 2>&1 | first)" = true ] || { echo 'STOP: the timelock does not say ready now. Nothing was sent. Read the state: it may be done already.'; return 1; }
  [ "$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC" 2>&1 | first)" = "$SEND_NONCE" ] || { echo 'STOP: the wallet count moved since the checks. Nothing was sent. Load the block again.'; return 1; }
  record "attempt: execute, chain 137, from $DEPLOYER, to $TL, nonce $SEND_NONCE, value 0, call data keccak $EXEC_KECCAK, gas limit $GAS_LIMIT, fee limit $MAX_FEE_WEI, priority $PRIORITY_FEE_WEI, checked at block $B $HASH_BEFORE, schedule $SCHEDULE_TX, $(stamp)" || { echo 'STOP: the attempt could not be written down. Nothing was sent.'; return 1; }
  local out rc
  out="$(cast send "$TL" "$EXEC" --from "$DEPLOYER" --account "$KEYSTORE_ACCOUNT" --password-file "$PASSWORD_FILE" \
    --chain 137 --nonce "$SEND_NONCE" --value 0 --gas-limit "$GAS_LIMIT" \
    --gas-price "$MAX_FEE_WEI" --priority-gas-price "$PRIORITY_FEE_WEI" \
    --rpc-url "$RPC" --async)"; rc=$?
  printf '%s\n' "$out"
  record "returned: execute, nonce $SEND_NONCE, cast ended with $rc and printed: $(printf '%s' "$out" | flat)" || echo 'UNRESOLVED: what cast printed could not be written down. Copy the line above into the record by hand before anything else.'
  echo "cast ended with $rc. A line of 0x and 64 characters above is the transaction. Whatever it printed, next: the reads after the execute. The lock is kept until release_wallet."
}
[ "$READY" = yes ] && echo "READY. Nothing has been sent. The execute takes the wallet count $SEND_NONCE. To send it, type: send_execute" || echo 'NOT READY: a line above says STOP. send_execute will refuse. Type release_wallet before leaving this shell.'
```

The reads after the execute, in the same shell, typed one at a time:

```bash
TX='<the hash the send printed>'
cast tx "$TX" --json --rpc-url "$RPC"          # chainId 0x89, from the working wallet, to the timelock, the nonce, value 0x0, the gas limit and both fee limits as sent
[ "$(cast tx "$TX" input --rpc-url "$RPC")" = "$EXEC" ] && echo 'call data: equal, every byte' || echo 'STOP: the call data differs'
cast receipt "$TX" --json --rpc-url "$RPC"     # status 0x1; ReporterApproved from the games set, topic 1 the reporter; CallExecuted from the timelock, topic 1 the id
X='<the receipt blockNumber>'
cast block "$X" -f hash --rpc-url "$RPC"       # equals the receipt blockHash
cast call "$TL" 'isOperationDone(bytes32)(bool)' "$ID" --block "$X" --rpc-url "$RPC"                     # true
cast call "$TL" 'getTimestamp(bytes32)(uint256)' "$ID" --block "$X" --rpc-url "$RPC"                     # 1
cast call "$GAMES" 'getReporter(address)(uint8,bool,bytes32)' "$P" --block "$X" --rpc-url "$RPC"         # 1, false, the code hash
cast call "$GAMES" 'getApprovedReporters()(address[],uint8[])' --block "$X" --rpc-url "$RPC"             # the old reporters, then the new; their kinds
cast call "$GAMES" 'getReporter(address)(uint8,bool,bytes32)' "$OLD" --block "$X" --rpc-url "$RPC"       # as before the approval
cast keccak "$(cast code "$OLD" --block "$X" --rpc-url "$RPC")"                                           # as before the approval
cast call "$OLD" 'fixedValues()(bytes)' --block "$X" --rpc-url "$RPC"                                    # as before the approval
cast call "$P" 'fixedValues()(bytes)' --block "$X" --rpc-url "$RPC"                                      # the forwarder, the owner, the new id
cast block "$X" -f hash --rpc-url "$RPC"       # unchanged
note "execute read back: $TX in block $X"      # the block, the transaction index and the log index of ReporterApproved go to the record: step 8 starts from them
release_wallet                                 # only after every read above is as the record expects

# If the execute was refused or failed because the operation was done already: whoever executed it is found by the event, and read as above with its hash as TX.
EXECUTED=0xc2617efa69bab66782fa219543714338489c4e9e178271560a91b82c3f612b58     # topic 0 of the timelock event CallExecuted, as it stands in the execute receipt of 12 Nov 2026
cast logs --address "$TL" --from-block '<the schedule block>' --to-block latest "$EXECUTED" "$ID" --json --rpc-url "$RPC"      # one log: its transactionHash and blockNumber
```

### The canary's reads

```bash
RPC='<a Polygon node>'
GAMES=0x1b424d0dDB5C4aa4551845898093ae8D58052fD3
CREATED=0x2864961d97a95a96d81c0fe43deac7845080b2717dbb63f09dbc55b339b0b1b7      # topic 0 of the games set creation event, as it stands in the creation receipt of game 169
APPROVED=0x7c3ebe3bf1bd6b4c803c5c8ea19e3e2e6fda69fb869c983be87e2e433cdb38c9     # topic 0 of the games set event ReporterApproved, as it stands in the execute receipt of 12 Nov 2026
X='<the block the approval ran in, from the receipt of the transaction that executed it>'
GAME='<the game>'
G='<the creation block of that game>'

# the approval: one log in block X. Its transactionIndex and logIndex are where "after the approval" begins.
cast logs --address "$GAMES" --from-block "$X" --to-block "$X" "$APPROVED" --json --rpc-url "$RPC"
# games are numbered in the order they are made. The count at the end of the block before X, and at the end of X:
cast call "$GAMES" 'gameCount()(uint256)' --block "$((X - 1))" --rpc-url "$RPC"
cast call "$GAMES" 'gameCount()(uint256)' --block "$X" --rpc-url "$RPC"
# a game numbered above the first count and up to the second was made in block X. Its creation is in this answer,
# and a lower logIndex than the approval puts it before the approval: it carries the old reporters alone.
cast logs --address "$GAMES" --from-block "$X" --to-block "$X" "$CREATED" --json --rpc-url "$RPC"
# every game numbered above the second count was made after block X. The first of them is the first game after the approval.
cast call "$GAMES" 'getGameReporters(uint256)(address[],uint8[])' "$GAME" --block "$G" --rpc-url "$RPC"                  # both reporters, both kinds
cast call "$GAMES" 'getGameReporters(uint256)(address[],uint8[])' "$GAME" --block '<the read block>' --rpc-url "$RPC"    # the same
cast call "$GAMES" 'getGameStatus(uint256)(uint8)' "$GAME" --block '<the read block>' --rpc-url "$RPC"
# a second way to the same answer, where the node answers a search over that many blocks: every creation from X to the game
cast logs --address "$GAMES" --from-block "$X" --to-block "$G" "$CREATED" --json --rpc-url "$RPC"
```

## As it ran: `osgames2`, 11 and 12 Nov 2026

Times are UTC. Each hash and block here can be read on its chain.

| When | What |
|---|---|
| 12 Nov, 00:42 | The program's change merged: main `1f9573c`. |
| 12 Nov, 01:16 | One game simulated (game 144), under a stand-in reporter address. Its four rows were received at 01:16:52 under the run key `osgames2:creation:0xca9e74ae35ead69f2c3d1a17d8635469e47214e17a7e018fbd801064d4032a01:753`. They are the simulation's, written from the operator's machine with that machine's clock in their samples, and they are still in the table. Every `osgames2` row received before 12 Nov, 17:09:59 is a simulation's. |
| 12 Nov, 01:31 to 02:48 | The game creator's timer stopped. The salt made, the address planned, the spec written and fingerprinted, the three hashes printed again on Linux with no network route, and the fork rehearsal passed. |
| 12 Nov, 07:30 | The day stopped before the registration. The timer went back on for the night. |
| 12 Nov, 15:59 | The timer stopped again. |
| 12 Nov, 16:09 | The rehearsal's first try stopped before any transaction: the route answered the tool's fourth read with a 504. The cause was not found. From 16:17 the route answered 300 of 300 measured reads. The check of step 2 dates from here. |
| 12 Nov, about 17:00 | The rehearsal, twice within three minutes (rule 5): the owner's nonces 45 and 46, both read as included. |
| 12 Nov, 17:09:59 | The registration: `0x1a4c1a94be41b6fb9439b77f08927051ebbbd14f938e0a9e5c8d88d72be640fa`, the owner's nonce 47, Ethereum block 26400267. |
| 12 Nov, 17:26:58 | The gate's anchor: finalized Ethereum block 26400287, asked of the route alone. The new row under the owner, active; the old row unchanged; two rows; the owner's count 48. |
| 12 Nov, 17:35:09 | The creation: `0xa1f679749c33c67eacd29c8b40cf13ad8817700068dd715ad272f6bf6c14e25e`, Polygon block 97199635, 607,482 gas. The reporter is at `0x4FAAE0DD3882F95D464BFf85441EA0946D3a6937`: 2,302 bytes, code hash `0x5c7854363ca993885e01b29b38943f458928111a7d32a0b185473dfe0eb4d67a`. |
| 12 Nov, 20:34:22 | The schedule: `0x9f7ca4c2dab5c376a722001e99283c663f91fbf8d2005f7dcb6aa8811435b9d5`, the key's nonce 1, Polygon block 97206804, 67,476 gas, delay 60 seconds. Operation `0x6ace177908a7090297b23b88e2b3b6e1cff81f7b95fa7a0ed461355748e274f8`. |
| 12 Nov, 20:44:45 | The execute: `0xd86d5b1572154bc8958603427c7a51c87525998af143d450c4c1a932dce47dab`, Polygon block 97207219, 136,612 gas. The approved list: `0x2Fa61B65Cd1CC04b2B910fB665FCc48237561c01` and the new reporter, kinds 1 and 1. |
| 12 Nov, 20:46:50 | The timer back on, after 4 hours 47 minutes. Its catch-up run made no game: the day's 14 existed already and carry the old reporter alone. |
| 12 Nov, 21:24 to 21:58 | The registry read on three public nodes at three finalized blocks, twice before the push and once after the merge: both rows as the gate's, the owner's count 48. |
| 12 Nov, 21:56:34 | The publication merged: main `faf8a11`. A fresh clone of it printed three matches. |
| 13 Nov, 05:00:55 | The first game with both reporters: game 169, `0x2cc400b561d0107007ad440f10e5318a8c458f148b7b9fb8ccaebcb160cea7ab`, Polygon block 97227066. Its score, the canary's second half, had not come when this was written. |

## Where this file differs from what ran

**The order.** Steps 0 to 5 ran in this file's order. Then came the approval (step 7), and the
publication after it (step 6).

**What ran on those days as the steps describe it**, by hand or by that day's files, not by the
text of the blocks above:

* the acceptance of the table and of its key, and the simulation with its three checks;
* the salt, the address worked out with no node, the three hashes on two machines, and the fork
  rehearsal;
* the reads before the day was taken up again;
* the route's reads after the first fault, the rehearsal and the registration;
* the gate's transaction, anchor and rows, asked of the route;
* the creation: its reads at one named block, its attempt written down and forced to disk before
  the send, and its readback;
* the reads before the schedule with their controls, and the schedule;
* the execute: under the box's lock, its reads at one named block, its attempt written down first,
  and its readback, the transaction itself included;
* the registry read on three public nodes before the push and after the merge, and the three
  matches on a fresh clone of the pushed branch and of the merge commit;
* the canary's arrays.

**What is new in this file, and has not been run:**

* The publication before the approval.
* The gate's three public nodes, and the question about the block alone that comes before them.
* The typed phrase, the terminal check and the comparison of values in every block. The live lines
  of 12 Nov were behind none of them.
* The schedule's line with its nonce, value and fee limits on it. On 12 Nov it bound none.
* The rehearsal's 30 minutes. On 12 Nov each request was left for the tool's default two days.
* The creation sent as the bytes that were checked. On 12 Nov it went as a function and its
  arguments.
* The lock, the timers and the ledger read by the block itself. On 12 Nov they were read by hand.
  For the execute the record says the lock was held. For the creation it says the timer was off,
  the service ended and the ledger empty, and does not say the lock was held.
* An attempt written down on the operator's machine. On 12 Nov the tool's two lines and the
  schedule's had none.
* The reads for room as a step of their own. On those days the tool made its own read of the
  owner's limit, after the upload.
* The canary's start taken from the approval's own block and the games set's count. On 12 and
  13 Nov it was taken from two searches for creation events, which covered that block between
  them: one from the schedule's block to past the execute's, and one from the block after the
  execute's to the game's. Both were empty.
* The replacement of a key. None has been replaced yet.
* Every stop that follows a send. None was met on those days, so what steps 3, 5 and 7 say to do
  after one has not been done once.

## What is tried, and what is not

* **What ran, ran once**, on 11 and 12 Nov 2026, on Windows 11 (the operator's machine) and Linux
  (the box), with cre-cli v1.22.0, Bun 1.3.14 and Foundry's `cast`. "Where this file differs from
  what ran" says which checks those are, and which are new.
* **The blocks above are not the files that ran.** They are those files rewritten with the guard,
  the bindings, the lock, the record of an attempt and the placeholders, and they have not been run
  as written here. No line that signs, sends or deploys has been tried, in a block or in a cut of
  one.
* **Tried on this text, with lines that send nothing:**
  * Each block parses as a copy with its live lines removed.
  * The address from a salt, the approval's salt and operation id, and the schedule's and the
    execute's call data, built by the blocks' own lines, equal the values of 12 Nov. The
    registration's, the creation's and the execute's call data, built the same way, equal the mined
    transactions' inputs byte for byte.
  * The helpers, run alone in Git Bash and on Linux. The guard refuses in a shell that is not a
    terminal, with the phrase piped in as well. `record` is true for a line it wrote and read back,
    and false for a full device, a folder that does not exist and a file whose last line is
    another writer's; a function behind it does not reach its next line. `seal` gives another hash
    when a fee changes by one. A first form of `record` used `sync` on the file, which Git Bash
    refuses: every load there would have stopped.
  * The lock's lines, on Linux, on a lock file made for the trial: taken; refused to a second
    taker, by `flock` and by the exclusive no-wait `flock` call the box's sender makes; still held
    after a child process ended; free after `release_wallet`; the file unchanged. With another
    process holding it, the block's check says STOP. The two placeholders for the timers and the
    ledger stop a block when they are left in.
  * The gate's lines, on 13 Nov, with the public values of 12 Nov and a fourth public node standing
    in for the route. On one set of four nodes: four equal answers and no error, the new row's
    creation time equal to the inclusion block's, the owner's count 48. On another set, one node's
    `finalized` block was 64 behind the others'; at the anchor that gave, a second node refused
    the state as too old and the lagging one answered some reads with errors. The lines showed
    different hashes and bytes of errors: a hold, as written.
  * The deciding reads of block (c), at the block the creation's checks were made at on 12 Nov, on
    a public node, with the mined call in place of the build's: every one passed, and the estimate
    was 624,300. Those of block (e), at that day's block: every one passed, and the estimate was
    137,737; at the head of 13 Nov they stopped on readiness, the entry, the list and the dry
    call. In both, the two counts read at the head stopped, as they must once the wallet has sent
    again. An independent run with `cast` 1.5.1 gave the same two estimates at the same two blocks.
  * The canary's lines, with the blocks of 12 and 13 Nov: the approval's event in block 97207219;
    the count 168 before that block and at its end, and no creation in it; 168 at the block before
    game 169's and 169 at its own. A search for creations over 2,000 blocks did not come back from
    a public node within 90 seconds.
  * The reads for room, on 13 Nov: the owner's limit 3 with 2 active, and `MAX_REPORTERS` 8 with
    2 approved.
  * `route_reads` and `owner_state` answered against a public Ethereum node, and `route_reads`
    stopped on a host that does not exist.
  * On the box's `cast` 1.5.1, in an independent check: `cast tx <hash> input`,
    `cast block finalized -f number`, `cast receipt <hash> --json`, and the keystore's address from
    its account and password file.
* **Not tried:** any block as written; the typed phrase in a real terminal; `--timeout 30m` on the
  rehearsal (from the tool's source); `--nonce`, `--value`, `--gas-limit` and the fee limits passed
  through `cast send --unlocked` to a wallet (on 12 Nov `cast` filled them itself); the creation
  sent as raw call data (the execute was, on 12 Nov); `hold_wallet` on the box's real lock, and the
  box's own lines for the timers and the ledger; `record` on the box; `cast tx <hash> from` and
  `nonce` and `cast receipt <hash> blockNumber` on `cast` 1.5.1 (run here on 1.6.0); the gate's
  lines on the route itself.
* **Not known:** what the fault of 12 Nov, 16:09 was; how long the route keeps a transaction it has
  not got mined; whether its node counts its own waiting transaction in `pending`; whether the tool
  prints a hash when its wait ends with no receipt.
