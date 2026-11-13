# A new version of the scoring program, beside the live one

A changed scoring program goes live as a second workflow with a second reporter, while the workflow
and the reporter before it keep running. `BUILD.md` says how a workflow's id is rebuilt. This file
says in what order a new one is registered, created, published and approved: who runs each step,
what it is for, what it checks and where it stops.

It is written from the deploy of `osgames2` on 11 and 12 Nov 2026, in the order that deploy ran, with
what the two days showed wrong put right. That deploy's own record is near the end. The deploy-day
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
  workflow or reporter is retired or paused as part of this. Retiring an older version is a change
  of its own.
* The registry allowed an owner three active workflows in this DON family when it was read on
  11 Nov 2026. `osgames` and `osgames2` are two.

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

## Who

| | |
|---|---|
| The operator | Holds the workflow owner's key and the timelock's key. Runs the route's rehearsal and the registration, signs the schedule, and merges. Each step starts on the operator's word. |
| The writer | Prepares the spec, the fingerprint, the call data and every block. Signs nothing and sends nothing. |
| The verifier | Works on the box, the machine that holds the operator's working wallet. Makes the salt, rebuilds each value from its own reads before comparing it with the writer's, runs the gate, and sends the creation and the execute from the working wallet. |

One private record of the deploy holds the order, each ruling, each time and each value as it is
made. A value is read from the record, never from memory or from notes.

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
   the hash and the nonce, read the chain, and send nothing a second time by reflex.
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
   and after.
9. **The tools are the pinned ones, named by path.** The fingerprint takes the CRE tool from
   `CRE_BIN`; the operator's machine and the box install it under different names. Nothing is
   updated on the day.

## The order

| | Step | Who | It ends when |
|---|---|---|---|
| 0 | Before the day | all three | the program is merged under its new name, and one game is simulated |
| 1 | The private values | the verifier, the writer | two machines print the same three hashes |
| 2 | The route: its check and its rehearsal | the operator | the rehearsal's transaction reads as included |
| 3 | The registration | the operator | the tool reports the workflow deployed |
| 4 | The gate | the verifier | the id is under the owner at a finalized block |
| 5 | The creation | the verifier | the planned address holds the reporter's code |
| 6 | The publication | the writer, the operator | a fresh clone of the merge commit prints three matches |
| 7 | The approval | the writer, the verifier, the operator | both reporters are on the approved list |
| 8 | The canary | the verifier | a game that carries both reporters is scored through the new one |

### 0. Before the day

* **The program's change is merged**, reviewed, under the new name: `workflow-name` in
  `games/workflow.yaml`, `WORKFLOW_NAME` in `games/runline.ts`, and the tests that pin the name.
  From this commit the binary is fixed. The spec that follows changes no file the build reads.
* **What the new version reads from outside is in place first**: a table, a Vault value. A
  migration is applied by the database's owner in the database's own editor. The operator's shell
  holds no database connection, and a deploy adds none.
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
* **One game is simulated** with the merged program, under a stand-in reporter address: a
  simulation's config never holds a planned address. Its checks: no key, keyed URL or unfilled
  stand-in in the output; the table's rows equal the run's own lines, column for column; a replay
  of the same run writes nothing. A simulation's rows stay in the table. They are told apart by
  time: a row of a workflow that was received before that workflow was registered is a
  simulation's.

### 1. The private values, and the rule that ends at the registry

**Who.** The verifier makes the salt and the address on the box. The writer makes the spec and the
fingerprint. The verifier reproduces the fingerprint and rehearses on a fork.

**What for.** One input of the id stays out of public view until the registry holds the id.

1. **The timers stop.** Whatever sends from the working wallet on a timer (the game creator) is
   stopped and disabled, and stays so until the approval is read back in step 7. Two reasons: none
   of its sends meets the creation's or the execute's, and a game it made before the approval would
   carry the old reporters alone. If the day ends before the registration, the timer goes back on,
   and is stopped again before the next session.
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
box, the operator's working tree, and the private record. They are in no repository, CI, chat or
shared log. No node, explorer or fork with a live upstream is sent anything that names or carries
them: no code or balance read at the address, no estimate, no call to the factory with the real
salt. So before the gate nobody has checked that the planned address is empty: the made-up salt
proves the sum, not the vacancy. Two disclosures are part of the registration itself: the tool
uploads the binary and the config to Chainlink before it sends, and the route sees the transaction.
They are accepted, and no other is. The rule ends when the gate passes.

**Check.** The same three hashes on two machines. The fork's five results. The runtime code hash.

**Stop.** Any sign that one of the values reached a place outside the three: make a new salt.
Nothing is on a chain yet, so a new salt costs a new address, a new spec and two fingerprint runs.

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
  answered it, and seconds later answered the tool's fourth read with a 504. The check cannot
  promise the next minute.
* **The rehearsal** is one transaction that registers nothing, sent by the same binary through the
  same sending code: `secrets list`, which sends one allowlist request from the owner
  (`executeTransactionByTxType` in `cmd/client`, the function the registration goes through). On
  v1.22.0 the command then fails to read the Vault's reply (`BUILD.md`, CLI versions). That comes
  after the transaction and changes nothing. Run it once: each run leaves an allowlisted request at
  the registry, for two days by the tool's default. Block (a) asks for 30 minutes
  (`--timeout`, `cmd/secrets/list/list.go`).

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
no row of the new name. The tool's usage report is off (`CRE_TELEMETRY_DISABLED=true`: `BUILD.md`,
Traps).

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
  config and a new id over the same binary, and nothing is lost on a chain, because nothing has
  been created.
* A stop before the upload: load the block again.
* A stop after the upload and before the send (a failed read, or a No): load the block again as
  soon as its checks pass. It builds the same bytes and the same id, and the tool skips an upload
  that is already there. Waiting undoes nothing. Ask no other node.
* A stop at the send or in the wait is unknown, not failed. Type `owner_state`.
  * A row of the name: it is registered. Go to the gate, and do not load the block again.
  * No row, and the waiting count above the mined one: the route still holds the transaction. Read
    again each minute.
  * No row, the two counts equal, and five minutes gone: load the block again. The new transaction
    takes the same nonce and the same call, so at most one of the two is mined.

### 4. The gate

**Who.** The verifier. Every read goes through the route the registration went by. Until the gate
passes, no other Ethereum node is asked about the id.

**What for.** "Transaction confirmed", the route's "included" and two rows at `latest` can all come
before finality. If the block that holds the registration were dropped after the id had been seen,
someone else could claim the id. So nothing is created or published on an included registration,
only on a final one.

1. **The transaction.** Chain 1, from the owner, to the registry, value 0, the nonce the block
   printed, and the whole call data equal to `upsertWorkflow` built from the name, the id, the
   family and the two storage addresses. Its receipt's status is 1.
2. **The finalized block.** Read the node's `finalized` block until its number is at or past the
   inclusion block. That block is the anchor. The inclusion block's hash is the receipt's. The
   anchor's hash is read again after part 3.
3. **At the anchor.** The new row: the owner, the id, active, the name and the tag, the family, and
   the two storage addresses. The old row: unchanged in every field. The owner's list: the old rows
   and the new one, and no other. The owner's count: the count before the day, plus the rehearsal
   and the registration, each of them read by its hash and found mined.
4. **Then, and only then, step 5.** The same reads are made again before step 6's push.

**Stop.** A null, a mismatch, a `finalized` read the node does not support, an owner that is not
ours, an unexpected row, or a block hash that changed is a hold. No public node is used in the
route's place. No second registration and no other id is tried on the verifier's own decision.

On 12 Nov 2026 the anchor came 17 minutes after the inclusion. A passed gate is not a proof against
a failure of Ethereum's consensus, and it does not make the route or Chainlink's storage a secret.

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

**What the block checks before the send.** The keystore gives the working wallet. The checkout of
the reporter's build is clean. The salt has its shape and gives the planned address, worked out
again with no node. The creation code hashes as the pinned build's. The node is on chain 137, and
the factory's code hashes as pinned. The planned address and the proxy hold no code and have nonce
0. The exact call's estimate is within the gas limit. The working wallet has nothing waiting. The
priority fee is within the fee limit, and the gas limit times the fee limit is within the ceiling.
`cast` is the build the trial copy ran with. Outside the block, the verifier holds the box's own
lock on the working wallet for the send, and reads its ledger of attempts: none is unfinished.

**The send** is one line, with the chain, the nonce just read, value 0, the gas limit and both fee
limits on it. The gas limit is 1,000,000: the creation used 607,482 on 12 Nov 2026. The attempt is
written down before it goes, and the hash when it comes back.

**Check, after.** The transaction read back by its hash: the chain, the sender, the factory, the
nonce, value 0 and the whole call data as prepared. Receipt status 1. The factory's two events name
the proxy and the planned address. The receipt's `contractAddress` is empty, as for any call to a
factory, and is not the test. Then, at the block that holds the creation, its hash read before and
after: the code at the address hashes to the runtime code hash from the fork rehearsal, the four
getters return the four constructor arguments, and `fixedValues()` is the forwarder, the owner and
the id.

**Stop.**

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

* **Before the push**, the registry is read again at a finalized block, on three public nodes asked
  about one block. Both rows equal the gate's in every field, the owner's list is the same, and the
  owner's count has not moved.
* **One commit**: the spec, and `BUILD.md`'s lines for the new workflow. No file the build reads,
  no lockfile, no template and no tool pin is in it. A build of other bytes cannot become the
  registered workflow afterwards.
* **The fingerprint prints three matches**, before the push and on a fresh clone of the pushed
  branch. Its values are compared with the record and with the id the registry holds, not only with
  the spec's own `expect` block, which moves with the file.
* **After the merge**, a fresh clone of the merge commit: its tree is the branch head's tree, and
  the fingerprint prints the same three matches. The record names that merge commit as the one
  deployed.
* **This repository runs no CI.** The three suites (`build`, `games`, `scoring`) are run on the
  fresh clone, and the pull request says so.
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

Read the long values in the wallet's window, where nothing is timed, before pressing Sign: once it
is pressed, the device's answer is waited for in tries of 60 seconds (from the wallet's source, not
seen). `cast` gives a wallet 45 seconds by default and then reports an error, while the wallet
still sends if it is signed later (measured with a stand-in for the wallet). The block gives it 15
minutes, and an error from that line is still "unknown".

**The execute.** The timelock's executor role is open: once the operation is ready, anyone may
execute it, and the result is the same approval. The verifier sends it when the timelock's own
`isOperationReady(id)` is true at a named block. The first second is the schedule block's time plus
the delay, not a count from the signing. Before the send: the schedule's transaction is read back
by its hash, and its call data is the schedule's bytes; the code hash, the approved list and the
old reporter are read again; fresh fee limits are given under a ceiling for this send. The line
sends the checked bytes themselves, not a second encoding of them.

**Check, after, at the execute's block.** The receipt's status is 1, with the games set's
`ReporterApproved` naming the reporter and the timelock's `CallExecuted` naming the id.
`isOperationDone(id)` is true. `getReporter(new)` is the kind and the code hash.
`getApprovedReporters()` is the old reporters and then the new. `getReporter(old)`, the old
reporter's code hash and its `fixedValues()` are what they were. Then the timers of step 1 go back
on.

**Stop.**

* A check of the block says STOP, or the wallet answers on another chain: nothing is handed over.
* An error from the schedule's line: type `schedule_state`, and look in the wallet for a request
  still waiting, before anything else. A request left waiting can be signed later, and is then
  sent. Two equal counts do not prove that nothing went out.
* The execute fails because the operation is already done: someone ran it first. Make the same
  reads, and they decide. It is never a reason to schedule again, and the timelock refuses a second
  schedule of the same operation.

### 8. The canary

**Who.** The verifier reads.

**What for.** Proof that the new version scores a real game through its own reporter.

The canary is the first game created after the execute's block whose stored reporter arrays hold
both reporters (`getGameReporters`), and then its score: an accepted report that names the new
reporter, with the run-line's rows for that run in the table.

* It is told by the arrays, not by a matchup, a date or who created it. Creating a game is open to
  anyone, before the approval as well, and stopping our own timer stops nobody else. A game made
  before the execute carries the old reporters alone, for good.
* A game that carries the old reporters alone is never adopted, rewritten or counted as proof of
  the new version, and no older reporter is retired to make one.
* The first such game comes with the first creation after the execute. On 12 Nov 2026 the creator's
  catch-up run made none, because the day's games existed already. The first was made at the next
  day's first run.

**Check.** No creation event between the execute's block and the game's own. The arrays at the
game's creation block and at the read block: both reporters, both kinds. Then, once the game has
ended: the report's reporter, and the rows.

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
is typed afterwards. The function asks for a phrase, reads the nonce once more, and only then sends.

### The helpers

Every block starts with these lines.

```bash
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
PY=python          # python3 on the box
READY=yes
want()   { if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "STOP  $1: wanted ${3:0:90}, got ${2:0:90}"; READY=no; fi; }
holds()  { local label="$1"; shift; if "$@" >/dev/null 2>&1; then echo "ok    $label"; else echo "STOP  $label"; READY=no; fi; }
first()  { head -n 1 | cut -d' ' -f1; }
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
send_rehearsal() {
  typed "rehearse $NEXT" || return 1
  still_next || return 1
  CRE_TELEMETRY_DISABLED=true "$CRE" secrets list --namespace main --target production-settings --timeout 30m -E "$(cygpath -w "$ROUTE_FILE")"
  echo "The tool ended with $?. Whatever it printed, next type: owner_state   and then: route_status 0x<the hash>"
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
send_registration() {
  typed "register $NAME ${ID: -8}" || return 1
  still_next || return 1
  CRE_TELEMETRY_DISABLED=true "$CRE" workflow deploy ./games --target production-settings --config "$(cygpath -w "$PWD/$CONFIG_OUT")" -E "$(cygpath -w "$ROUTE_FILE")"
  echo "The tool ended with $?. Whatever it printed, next type: owner_state   Nothing is run a second time before that."
}
[ "$READY" = yes ] && echo "READY. Nothing has been sent or uploaded. The registration takes the owner count $NEXT. To start the tool, type: send_registration" || echo 'NOT READY: a line above says STOP. send_registration will refuse.'
```

### The gate's reads

On the box. Reads only, typed one at a time, each answer compared by eye with the record.

```bash
export ETH_RPC_URL='<the private endpoint, from the record>'      # the route the registration went by, and no other node
REGISTRY=0x4Ac54353FA4Fa961AfcC5ec4B118596d3305E7e5
OWNER=0x89fe160bBBe59eAF428f23F095B71E5C0EdCDfa3
NAME='<the new workflow name>'
ID='<the new id>'
OLD_ID='<the live id: one read below for each live workflow>'
TX='<the registration hash>'
BINARY_URL='<the binary address the tool printed at the upload>'    # 12 Nov: https://storage.cre.chain.link/artifacts/<the id without 0x>/binary.wasm
CONFIG_URL='<the config address the tool printed at the upload>'    # 12 Nov: the same folder, /config
ROW='(bytes32,address,uint64,uint8,string,string,string,string,bytes,string)'    # id, owner, created, status, name, binary, config, tag, attributes, family

# 1. the transaction
UPSERT="$(cast calldata 'upsertWorkflow(string,string,bytes32,uint8,string,string,string,bytes,bool)' "$NAME" "$NAME" "$ID" 0 zone-a "$BINARY_URL" "$CONFIG_URL" 0x false)"
cast tx "$TX" --json              # chainId 0x1, from the owner, to the registry, value 0x0, the nonce the block printed
[ "$(cast tx "$TX" input)" = "$UPSERT" ] && echo 'call data: equal, every byte' || echo 'HOLD: the call data differs'
cast receipt "$TX" --json         # status 0x1; its blockNumber and blockHash are the inclusion

# 2. the finalized block
cast block finalized -f number    # again, a minute apart, until it is at or past the inclusion block
E='<that finalized block number>'
cast block "$E" -f hash           # the anchor, before
cast block '<the inclusion block>' -f hash      # equals the receipt's blockHash

# 3. at the anchor
cast call "$REGISTRY" "getWorkflowById(bytes32)($ROW)" "$ID" --block "$E" --json
cast call "$REGISTRY" "getWorkflowById(bytes32)($ROW)" "$OLD_ID" --block "$E" --json
cast call "$REGISTRY" "getWorkflowListByOwner(address,uint256,uint256)($ROW[])" "$OWNER" 0 100 --block "$E" --json
cast nonce "$OWNER" --block "$E"
cast block "$E" -f hash           # the anchor, after: unchanged
cast block '<the inclusion block>' -f hash      # unchanged
```

### (c) The creation

On the box, after the helpers with `PY=python3`.

```bash
cd '<a clean checkout of ospex-contracts-v2 at the reporter build>' || READY=no
RPC='<the Polygon node the box sends through, taken from the box settings and never printed>'
KEYSTORE_ACCOUNT='<the working wallet keystore name>'
PASSWORD_FILE='<the keystore password file>'
SALT_FILE='<the salt file>'
ATTEMPTS='<a file on the box, outside every repository, that each send is written to before it goes>'
DEPLOYER=0x16Dc5D67D080a5521ef2c79680dBfC2aBf724D30
FACTORY=0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed
FACTORY_CODE_HASH=0xbd8a7ea8cfca7b4e5f5041d7d4b17bc317c5ce42cfbc42066a00cf26b43eb53f
FORWARDER=0x76c9cf548b4179F8901cda1f8623568b58215E62
WORKFLOW_OWNER=0x89fe160bBBe59eAF428f23F095B71E5C0EdCDfa3
GAMES=0x1b424d0dDB5C4aa4551845898093ae8D58052fD3
CREATION_CODE_HASH=0x4bc8a79df07ef940c527370b48917168593cd338c7dc3225e4395a28c3f8d825    # the reporter as built at ospex-contracts-v2 3fe47cb
WORKFLOW_ID='<the id the gate read at the finalized block>'
P='<the planned address, from the record>'
GAS_LIMIT=1000000
MAX_FEE_WEI='<the fee limit given for this send, in wei>'             # 12 Nov: the larger of eth_gasPrice and twice the base fee plus the priority fee
PRIORITY_FEE_WEI='<the priority fee given for this send, in wei>'
CEILING_WEI='<the most this send may cost, in wei>'

want 'cast is the build the trial copy ran with' "$(cast_build)" '<the commit of that cast build>'
holds 'the checkout is clean' test -z "$(git status --porcelain 2>&1)"
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
want 'the keystore gives the working wallet' "$(lower "$(cast wallet address --account "$KEYSTORE_ACCOUNT" --password-file "$PASSWORD_FILE" 2>&1 | first)")" "$(lower "$DEPLOYER")"
want 'the node is on Polygon' "$(cast chain-id --rpc-url "$RPC" 2>&1 | first)" 137
want 'the factory is the pinned code' "$(cast keccak "$(cast code "$FACTORY" --rpc-url "$RPC" 2>&1)" 2>&1 | first)" "$FACTORY_CODE_HASH"
want 'the planned address is empty' "$(cast code "$P" --rpc-url "$RPC" 2>&1 | first)/$(cast nonce "$P" --rpc-url "$RPC" 2>&1 | first)" 0x/0
want 'the factory proxy is empty' "$(cast code "$PROXY" --rpc-url "$RPC" 2>&1 | first)/$(cast nonce "$PROXY" --rpc-url "$RPC" 2>&1 | first)" 0x/0
ESTIMATE="$(cast estimate "$FACTORY" "$CALL" --from "$DEPLOYER" --value 0 --rpc-url "$RPC" 2>&1 | first)"
want "the exact call's estimate ($ESTIMATE) is within the gas limit" "$(atmost "$ESTIMATE" "$GAS_LIMIT")" yes
SEND_NONCE="$(cast nonce "$DEPLOYER" --rpc-url "$RPC" 2>&1 | first)"
want 'the working wallet has nothing waiting' "$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC" 2>&1 | first)" "$SEND_NONCE"
want 'the priority fee is within the fee limit' "$(atmost "$PRIORITY_FEE_WEI" "$MAX_FEE_WEI")" yes
want 'the gas limit times the fee limit is within the ceiling' "$(within "$GAS_LIMIT" "$MAX_FEE_WEI" "$CEILING_WEI")" yes
holds 'the attempts file can be written' touch "$ATTEMPTS"
send_creation() {
  typed "create ${P: -8}" || return 1
  [ "$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC" 2>&1 | first)" = "$SEND_NONCE" ] || { echo 'STOP: the wallet count moved since the checks. Nothing was sent. Load the block again.'; return 1; }
  printf 'creation attempt: nonce %s, call data keccak %s, gas limit %s, fee limit %s, priority %s\n' "$SEND_NONCE" "$(cast keccak "$CALL")" "$GAS_LIMIT" "$MAX_FEE_WEI" "$PRIORITY_FEE_WEI" >> "$ATTEMPTS"
  cast send "$FACTORY" "$CALL" --from "$DEPLOYER" --account "$KEYSTORE_ACCOUNT" --password-file "$PASSWORD_FILE" \
    --chain 137 --nonce "$SEND_NONCE" --value 0 --gas-limit "$GAS_LIMIT" \
    --gas-price "$MAX_FEE_WEI" --priority-gas-price "$PRIORITY_FEE_WEI" \
    --rpc-url "$RPC" --async | tee -a "$ATTEMPTS"
  echo "cast ended with ${PIPESTATUS[0]}. A line of 0x and 64 characters above is the transaction. Whatever it printed, next: the reads after the creation."
}
[ "$READY" = yes ] && echo "READY. Nothing has been sent. The creation takes the wallet count $SEND_NONCE. To send it, type: send_creation" || echo 'NOT READY: a line above says STOP. send_creation will refuse.'
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
```

### (d) The schedule

Git Bash, on the operator's machine, after the helpers.

```bash
WALLET='<the local address the key wallet listens on, from the record>'
READ='<a public Polygon node>'                 # project.yaml names one for polygon-mainnet
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
want 'the code at the reporter hashes as the approval names' "$(cast keccak "$(cast code "$P" --rpc-url "$READ" 2>&1)" 2>&1 | first)" "$CODE_HASH"
want 'the timelock delay is the one the schedule carries' "$(cast call "$TL" 'getMinDelay()(uint256)' --rpc-url "$READ" 2>&1 | first)" "$DELAY"
want 'the timelock gives the operation id in the record' "$(cast call "$TL" 'hashOperation(address,uint256,bytes,bytes32,bytes32)(bytes32)' "$GAMES" 0 "$INNER" "$ZERO" "$APPROVAL_SALT" --rpc-url "$READ" 2>&1 | first)" "$ID"
want 'the operation is not scheduled yet' "$(cast call "$TL" 'getTimestamp(bytes32)(uint256)' "$ID" --rpc-url "$READ" 2>&1 | first)" 0
want 'dry call: the games set takes the approval from the timelock' "$(cast call "$GAMES" "$INNER" --from "$TL" --rpc-url "$READ" 2>&1 | first)" 0x
want 'dry call: the timelock takes the schedule from the key' "$(cast call "$TL" "$SCHED" --from "$KEY" --rpc-url "$READ" 2>&1 | first)" 0x
want 'the key count, mined, is the nonce this sends with' "$(cast nonce "$KEY" --rpc-url "$READ" 2>&1 | first)" "$KEY_NONCE"
want 'the key has nothing waiting' "$(cast nonce "$KEY" --block pending --rpc-url "$READ" 2>&1 | first)" "$KEY_NONCE"
want 'the priority fee is within the fee limit' "$(atmost "$PRIORITY_FEE_WEI" "$MAX_FEE_WEI")" yes
want 'the gas limit times the fee limit is within the ceiling' "$(within "$GAS_LIMIT" "$MAX_FEE_WEI" "$CEILING_WEI")" yes
echo "info  the key holds $(cast balance "$KEY" --ether --rpc-url "$READ" 2>&1 | first) for the fee"
want 'the wallet answers on Polygon' "$(cast chain-id --rpc-url "$WALLET" 2>&1 | first)" 137
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
  [ "$(cast keccak "$SCHED" 2>&1 | first)" = "$SCHED_KECCAK" ] || { echo 'STOP: the call data is not the one in the record. Nothing was handed to the wallet.'; return 1; }
  [ "$(cast nonce "$KEY" --block pending --rpc-url "$READ" 2>&1 | first)" = "$KEY_NONCE" ] || { echo 'STOP: the key count moved since the checks. Nothing was handed to the wallet.'; return 1; }
  echo 'Handed to the wallet. It and then the device must show:'
  echo "  chain  Polygon, 137        value  0        nonce  $KEY_NONCE"
  echo "  from   $KEY"
  echo "  to     $TL"
  echo "  schedule: target $GAMES, value 0, predecessor all zeros, delay $DELAY"
  echo "            salt $APPROVAL_SALT"
  echo "            data $INNER"
  echo "  inside the data, read whole: the reporter $P and the code hash $CODE_HASH"
  echo 'Anything else, or a second request waiting: decline. This line waits up to 15 minutes.'
  cast send --unlocked --from "$KEY" --chain 137 --nonce "$KEY_NONCE" --value 0 --gas-limit "$GAS_LIMIT" \
    --gas-price "$MAX_FEE_WEI" --priority-gas-price "$PRIORITY_FEE_WEI" \
    --rpc-url "$WALLET" --rpc-timeout 900 --async "$TL" "$SCHED"
  echo "cast ended with $?. A line of 0x and 64 characters above is the transaction. Whatever it printed, next type: schedule_state"
}
[ "$READY" = yes ] && echo 'READY. Nothing has been handed to the wallet. To hand the schedule over, type: send_schedule' || echo 'NOT READY: a line above says STOP. send_schedule will refuse.'
```

### (e) The execute

On the box, after the helpers with `PY=python3`.

```bash
RPC='<the Polygon node the box sends through, taken from the box settings and never printed>'
KEYSTORE_ACCOUNT='<the working wallet keystore name>'
PASSWORD_FILE='<the keystore password file>'
ATTEMPTS='<the file each send is written to before it goes>'
DEPLOYER=0x16Dc5D67D080a5521ef2c79680dBfC2aBf724D30
TL=0x8CED8e82cf1488B7365C0726aEeD795b6C07582C
GAMES=0x1b424d0dDB5C4aa4551845898093ae8D58052fD3
ZERO=0x0000000000000000000000000000000000000000000000000000000000000000
P='<the reporter, from the record>'
CODE_HASH='<the code hash the schedule named>'
DELAY='<the delay the schedule carried>'
ID='<the operation id, from the record>'
SCHED_KECCAK='<the keccak256 of the schedule call data, from the record>'
EXEC_KECCAK='<the keccak256 of the execute call data, from the record>'
SCHEDULE_TX='<the schedule hash>'
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
want 'the node is on Polygon' "$(cast chain-id --rpc-url "$RPC" 2>&1 | first)" 137
want 'the schedule that was mined carries those bytes' "$(cast tx "$SCHEDULE_TX" input --rpc-url "$RPC" 2>&1 | first)" "$SCHED"
want 'the schedule succeeded' "$(cast receipt "$SCHEDULE_TX" --json --rpc-url "$RPC" 2>&1 | tr -d ' ' | grep -c '"status":"0x1"')" 1
B="$(cast block-number --rpc-url "$RPC" 2>&1 | first)"
HASH_BEFORE="$(cast block "$B" -f hash --rpc-url "$RPC" 2>&1 | first)"
want 'the code at the reporter hashes as the schedule named' "$(cast keccak "$(cast code "$P" --block "$B" --rpc-url "$RPC" 2>&1)" 2>&1 | first)" "$CODE_HASH"
want 'the timelock gives the operation id in the record' "$(cast call "$TL" 'hashOperation(address,uint256,bytes,bytes32,bytes32)(bytes32)' "$GAMES" 0 "$INNER" "$ZERO" "$APPROVAL_SALT" --block "$B" --rpc-url "$RPC" 2>&1 | first)" "$ID"
want 'the timelock says the operation is ready' "$(cast call "$TL" 'isOperationReady(bytes32)(bool)' "$ID" --block "$B" --rpc-url "$RPC" 2>&1 | first)" true
want 'the reporter is not approved yet' "$(cast call "$GAMES" 'getReporter(address)(uint8,bool,bytes32)' "$P" --block "$B" --rpc-url "$RPC" 2>&1 | first)" 0
want 'dry call: the timelock takes the execute from the working wallet' "$(cast call "$TL" "$EXEC" --from "$DEPLOYER" --block "$B" --rpc-url "$RPC" 2>&1 | first)" 0x
want 'the block read is still that block' "$(cast block "$B" -f hash --rpc-url "$RPC" 2>&1 | first)" "$HASH_BEFORE"
want 'the keystore gives the working wallet' "$(lower "$(cast wallet address --account "$KEYSTORE_ACCOUNT" --password-file "$PASSWORD_FILE" 2>&1 | first)")" "$(lower "$DEPLOYER")"
ESTIMATE="$(cast estimate "$TL" "$EXEC" --from "$DEPLOYER" --value 0 --rpc-url "$RPC" 2>&1 | first)"
want "the estimate ($ESTIMATE) is within the gas limit" "$(atmost "$ESTIMATE" "$GAS_LIMIT")" yes
SEND_NONCE="$(cast nonce "$DEPLOYER" --rpc-url "$RPC" 2>&1 | first)"
want 'the working wallet has nothing waiting' "$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC" 2>&1 | first)" "$SEND_NONCE"
want 'the priority fee is within the fee limit' "$(atmost "$PRIORITY_FEE_WEI" "$MAX_FEE_WEI")" yes
want 'the gas limit times the fee limit is within the ceiling' "$(within "$GAS_LIMIT" "$MAX_FEE_WEI" "$CEILING_WEI")" yes
holds 'the attempts file can be written' touch "$ATTEMPTS"
send_execute() {
  typed "execute ${ID: -8}" || return 1
  [ "$(cast call "$TL" 'isOperationReady(bytes32)(bool)' "$ID" --rpc-url "$RPC" 2>&1 | first)" = true ] || { echo 'STOP: the timelock does not say ready now. Nothing was sent. Read the state: it may be done already.'; return 1; }
  [ "$(cast nonce "$DEPLOYER" --block pending --rpc-url "$RPC" 2>&1 | first)" = "$SEND_NONCE" ] || { echo 'STOP: the wallet count moved since the checks. Nothing was sent. Load the block again.'; return 1; }
  printf 'execute attempt: nonce %s, call data keccak %s, gas limit %s, fee limit %s, priority %s\n' "$SEND_NONCE" "$EXEC_KECCAK" "$GAS_LIMIT" "$MAX_FEE_WEI" "$PRIORITY_FEE_WEI" >> "$ATTEMPTS"
  cast send "$TL" "$EXEC" --from "$DEPLOYER" --account "$KEYSTORE_ACCOUNT" --password-file "$PASSWORD_FILE" \
    --chain 137 --nonce "$SEND_NONCE" --value 0 --gas-limit "$GAS_LIMIT" \
    --gas-price "$MAX_FEE_WEI" --priority-gas-price "$PRIORITY_FEE_WEI" \
    --rpc-url "$RPC" --async | tee -a "$ATTEMPTS"
  echo "cast ended with ${PIPESTATUS[0]}. A line of 0x and 64 characters above is the transaction. Whatever it printed, next: the reads after the execute."
}
[ "$READY" = yes ] && echo "READY. Nothing has been sent. The execute takes the wallet count $SEND_NONCE. To send it, type: send_execute" || echo 'NOT READY: a line above says STOP. send_execute will refuse.'
```

The reads after the execute, in the same shell, typed one at a time:

```bash
TX='<the hash the send printed>'
OLD='<a reporter approved before: one set of reads for each>'
cast receipt "$TX" --json --rpc-url "$RPC"     # status 0x1; ReporterApproved from the games set, topic 1 the reporter; CallExecuted from the timelock, topic 1 the id
X='<the receipt blockNumber>'
cast block "$X" -f hash --rpc-url "$RPC"
cast call "$TL" 'isOperationDone(bytes32)(bool)' "$ID" --block "$X" --rpc-url "$RPC"                     # true
cast call "$TL" 'getTimestamp(bytes32)(uint256)' "$ID" --block "$X" --rpc-url "$RPC"                     # 1
cast call "$GAMES" 'getReporter(address)(uint8,bool,bytes32)' "$P" --block "$X" --rpc-url "$RPC"         # 1, false, the code hash
cast call "$GAMES" 'getApprovedReporters()(address[],uint8[])' --block "$X" --rpc-url "$RPC"             # the old reporters, then the new; their kinds
cast call "$GAMES" 'getReporter(address)(uint8,bool,bytes32)' "$OLD" --block "$X" --rpc-url "$RPC"       # as before the approval
cast keccak "$(cast code "$OLD" --block "$X" --rpc-url "$RPC")"                                           # as before the approval
cast call "$OLD" 'fixedValues()(bytes)' --block "$X" --rpc-url "$RPC"                                    # as before the approval
cast call "$P" 'fixedValues()(bytes)' --block "$X" --rpc-url "$RPC"                                      # the forwarder, the owner, the new id
cast block "$X" -f hash --rpc-url "$RPC"       # unchanged
```

### The canary's reads

```bash
CREATED=0x2864961d97a95a96d81c0fe43deac7845080b2717dbb63f09dbc55b339b0b1b7     # topic 0 of the games set's creation event, as it stands in game 169's creation receipt
cast call "$GAMES" 'gameCount()(uint256)' --block '<the execute block>' --rpc-url "$RPC"
cast logs --address "$GAMES" --from-block '<the execute block, plus one>' --to-block '<the block before the game was created>' "$CREATED" --json --rpc-url "$RPC"      # []
cast call "$GAMES" 'getGameReporters(uint256)(address[],uint8[])' '<the game>' --block '<its creation block>' --rpc-url "$RPC"      # both reporters, both kinds
cast call "$GAMES" 'getGameReporters(uint256)(address[],uint8[])' '<the game>' --block '<the read block>' --rpc-url "$RPC"          # the same
cast call "$GAMES" 'getGameStatus(uint256)(uint8)' '<the game>' --block '<the read block>' --rpc-url "$RPC"
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
| 12 Nov, 17:26:58 | The gate's anchor: finalized Ethereum block 26400287. The new row under the owner, active; the old row unchanged; two rows; the owner's count 48. |
| 12 Nov, 17:35:09 | The creation: `0xa1f679749c33c67eacd29c8b40cf13ad8817700068dd715ad272f6bf6c14e25e`, Polygon block 97199635, 607,482 gas. The reporter is at `0x4FAAE0DD3882F95D464BFf85441EA0946D3a6937`: 2,302 bytes, code hash `0x5c7854363ca993885e01b29b38943f458928111a7d32a0b185473dfe0eb4d67a`. |
| 12 Nov, 20:34:22 | The schedule: `0x9f7ca4c2dab5c376a722001e99283c663f91fbf8d2005f7dcb6aa8811435b9d5`, the key's nonce 1, Polygon block 97206804, 67,476 gas, delay 60 seconds. Operation `0x6ace177908a7090297b23b88e2b3b6e1cff81f7b95fa7a0ed461355748e274f8`. |
| 12 Nov, 20:44:45 | The execute: `0xd86d5b1572154bc8958603427c7a51c87525998af143d450c4c1a932dce47dab`, Polygon block 97207219, 136,612 gas. The approved list: `0x2Fa61B65Cd1CC04b2B910fB665FCc48237561c01` and the new reporter, kinds 1 and 1. |
| 12 Nov, 20:46:50 | The timer back on, after 4 hours 47 minutes. Its catch-up run made no game: the day's 14 existed already and carry the old reporter alone. |
| 12 Nov, 21:56:34 | The publication merged: main `faf8a11`. A fresh clone of it printed three matches. |
| 13 Nov, 05:00:55 | The first game with both reporters: game 169, `0x2cc400b561d0107007ad440f10e5318a8c458f148b7b9fb8ccaebcb160cea7ab`, Polygon block 97227066. Its score, the canary's second half, had not come when this was written. |

Where the two days differed from the steps above:

* The live lines of 12 Nov were not behind a typed phrase, and the schedule's line bound no nonce,
  value or fee of its own. The blocks above are those blocks with both put right.
* The rehearsal's request was left at the registry for the tool's default two days.
* The creation was sent as a function and its arguments. Block (c) sends the bytes it checked.

## What is tried, and what is not

* **The order, and each check in it, ran once**, on 11 and 12 Nov 2026, on Windows 11 (the
  operator's machine) and Linux (the box), with cre-cli v1.22.0, Bun 1.3.14 and Foundry's `cast`.
* **The blocks above are not the files that ran.** They are those files rewritten with the guard,
  the bindings and the placeholders, and they have not been run as written here. On this text: the
  address from a salt, the approval's salt, id and two call datas, and the registry's read calls
  were recomputed with the blocks' own lines and equal the values of 12 Nov. The registration's and
  the creation's call data, built by the blocks' own lines, equal the mined transactions' inputs
  byte for byte. Each block parses as a copy with its live lines removed. The helper functions were
  run alone: the guard refuses in a shell that is not a terminal, with the phrase piped in as well.
  `route_reads` and `owner_state` answered against a public Ethereum node, and `route_reads`
  stopped on a host that does not exist.
* **Not tried:** the typed phrase in a real terminal; `--timeout 30m` on the rehearsal (from the
  tool's source); `--nonce`, `--value`, `--gas-limit` and the fee limits passed through
  `cast send --unlocked` to a wallet (on 12 Nov `cast` filled them itself); the creation sent as
  raw call data (the execute was, on 12 Nov); the keystore check with a real keystore.
* **Not known:** what the fault of 12 Nov, 16:09 was; how long the route keeps a transaction it has
  not got mined; whether its node counts its own waiting transaction in `pending`.
