# nitro-canary (spike)

A measurement, not a product. It asks one question: can a Polygon contract with no owner check
an AWS Nitro Enclave attestation itself, accept a score signed by the key inside it, and refuse
one from any other enclave image, within Polygon's gas limits? It measures two ways of doing
the check:

- **direct**: the P-384 certificate chain and document signature checked on chain, with
  off-chain "hints", using an ownerless port of [base/nitro-validator](https://github.com/base/nitro-validator);
- **zero-knowledge**: Automata's guest program proves the same check in RISC Zero, and a
  Groth16 proof is checked on chain by RISC Zero's direct verifier (no router).

Nothing here is deployed by default, and nothing here touches mainnet.

## Layout

| path | what | source |
| -- | -- | -- |
| `src/direct/` | the checker, ownerless | base/nitro-validator `0ea0d12366b4fa44f9e07e4755f2ad36561cb674`, MIT. Every file is byte-identical except `CertManager.sol` and `ICertManager.sol`, where the owner, the revoker and the revocation set are removed (`git diff --no-index` against that commit shows only removals plus a header note). |
| `src/fixture/CertManagerFixtureClock.sol` | accepts expired certificates for a grace period, to replay old public fixtures on a live chain | same pattern as Base's `test/helpers/CertManagerDemo.sol`; fixture runs only |
| `src/NitroCanary.sol` | the canary on the direct route: image check, key, lease, score | new |
| `src/zk/NitroZkVerifier.sol` | ownerless port of Automata's `NitroEnclaveVerifier`, RISC Zero single path | automata-network/aws-nitro-enclave-attestation `65c4a4233029ea3bbe16110a80731fcfd47cf300`, Apache-2.0 (`src/zk/automata/LICENSE-automata`, `NOTICE-automata`) |
| `src/NitroZkCanary.sol` | the canary on the zero-knowledge route | new |
| `lib/risc0-ethereum` | `RiscZeroGroth16Verifier` | risc0-ethereum `v3.0.1` |
| `tools/base/` | Base's off-chain hint generator | base/nitro-validator at the same commit, MIT, byte-identical |
| `tools/sim-direct.mjs`, `tools/sim-zk.mjs` | run each route against a Polygon node with `eth_simulateV1`, nothing sent | new |
| `prover/` | runs Automata's committed guest ELF on one attestation and writes a Groth16 seal | new; risc0-zkvm `3.0.5` as in Automata's lockfile |
| `enclave/` | the enclave program for the real-machine run, and the parent's client | new |
| `fixtures/` | public attestations: Base's January 2026 document (with Base's documented three-byte repair applied), Automata's two samples | from those repos' tests and samples |
| `fixtures/published/` | the journal and seal of a RISC Zero proof of a real Nitro attestation, published in a Sepolia transaction to Automata's verifier | see its README |

## Run

```sh
git submodule update --init --recursive spike/nitro-canary/lib
forge build
forge test
node tools/sim-direct.mjs --rpc <polygon-or-amoy-rpc> --from <any address> \
  --fixture fixtures/base-2026-01-03.hex --other fixtures/automata-2023-09-28.report
```

The zero-knowledge route's on-chain check, with the published proof:

```sh
node tools/sim-zk.mjs --rpc <rpc> --from <any address> \
  --journal fixtures/published/sepolia-a51069ab.journal.hex \
  --seal fixtures/published/sepolia-a51069ab.seal.hex \
  --guest-id 0x3f836c01f54526864b30333d462b252ddfeb8458f13865da287daa9a62d1f963 \
  --image 0xc3828cd76fded559bffb839d7a083be87ac8c05b123c12b12c7b775da59b80ae \
  --approved-expect "LeaseOver()" \
  --automata-out <automata-network/aws-nitro-enclave-attestation at 65c4a42>/contracts/out
```

A new proof of your own needs the prover first (`prover/`, Docker on x86):

```sh
docker build -t nitro-zk-prove prover
docker run --rm -v <work>:/work nitro-zk-prove execute /work/risc0-verifier.elf /work/attestation.hex 1 /work/out
```

`prove` instead of `execute` makes the Groth16 proof; it also needs the Docker socket and
`RISC0_WORK_DIR` set to a directory the Docker daemon can mount, because RISC Zero's Groth16
step runs its own prover image.

## Status

Measured so far: both routes' on-chain checks, on fixtures and a published proof, run on a Polygon
node with `eth_simulateV1`. Not done yet: the run with a real enclave (the join and the score as
real Amoy transactions, the minutes end to end, the certificate life on a live document, the
second-image control), and a proof of our own, which needs a GPU; the local CPU attempt was stopped.
