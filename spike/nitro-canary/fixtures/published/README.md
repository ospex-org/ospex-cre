# A published RISC Zero proof of a Nitro attestation

`sepolia-a51069ab.*` are the journal and the seal from Sepolia transaction
[`0xa51069abda599f4443f151c9341bb068e7bdc754e3309d2a36fef69a3bd63e9e`](https://eth-sepolia.blockscout.com/tx/0xa51069abda599f4443f151c9341bb068e7bdc754e3309d2a36fef69a3bd63e9e)
(block 10,242,231, 2026-02-12), a `verify(output, 1, proofBytes)` call to Automata's
NitroEnclaveVerifier at `0x08e49F31Ab11b17f3a5BaA36e6744E9B532bC87B`, decoded from its input.

- Guest program id: `0x3f836c01f54526864b30333d462b252ddfeb8458f13865da287daa9a62d1f963`, the
  RISC Zero verifier id that contract is configured with (`getZkConfig(1)`), an earlier build of
  Automata's guest than the ELF at commit 65c4a42.
- Seal selector `0x73c457ba`: RISC Zero 3.0, the same control root as risc0-ethereum v3.0.1.
- The journal: a production enclave (PCR0-2 non-zero), module `i-038915b6426c60ee7-enc019c3941480eeedb`,
  attestation time 1770856108088 ms, only the root trusted, a 65-byte `public_key`.
