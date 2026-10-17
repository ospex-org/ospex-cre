// The zero-knowledge route on a public fixture, executed by a Polygon node without sending
// anything (eth_simulateV1, one simulated block per step, each call capped at Polygon's
// per-transaction limit). Needs a journal and seal from prover/ (nitro-zk-prove prove).
//
// Deploys RISC Zero's direct Groth16 verifier (v3.0.1, no router), the ownerless wrapper port,
// Automata's own wrapper as shipped (owner = --from), and one canary on each.
//
// usage: node tools/sim-zk.mjs --rpc <url> --from <address> --fixture <attestation>
//          --journal <hex file> --seal <hex file> --guest-id <0x..> --automata-out <dir>
//          [--image <0x..>] [--approved-expect <error>] [--max-time-diff <seconds>] [--out <json>]
// --image overrides the image hash taken from --fixture (use it when only a journal is published).
import { readFileSync, writeFileSync } from "node:fs";
import {
  POLYGON_MAX_TX_GAS, calldata, createAddress, creation, decodeRevert, fmt, imageHash, loadAttestation,
  rpcClient,
} from "./lib.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const need = ["rpc", "from", "journal", "seal", "guest-id", "automata-out"];
if (!opt("fixture") && !opt("image")) {
  console.error("need --fixture or --image");
  process.exit(2);
}
for (const n of need) {
  if (!opt(n)) {
    console.error(`missing --${n}`);
    process.exit(2);
  }
}
const rpc = rpcClient(opt("rpc"));
const from = opt("from");
const att = opt("fixture") ? loadAttestation(opt("fixture")) : null;
const hex = (f) => "0x" + readFileSync(f, "utf8").trim().replace(/^0x/, "");
const journal = hex(opt("journal"));
const seal = hex(opt("seal"));
const guestId = opt("guest-id");
const automataOut = opt("automata-out");
const maxTimeDiff = BigInt(opt("max-time-diff", String(4 * 365 * 24 * 3600)));
const outFile = opt("out");

// AWS Nitro root: sha256 of its DER, as Automata's guest commits it to the journal.
const AWS_ROOT_SHA256 = "0x641a0321a3e244efe456463195d606317ed7cdcc3c1756e09893f3c68f79bb5b";
// risc0-ethereum v3.0.1 ControlID (contracts/src/groth16/ControlID.sol).
const CONTROL_ROOT = "0xa54dc85ac99f851c92d7c96d7318af41dbe7c0194edfcc37eb4d422a998c1f56";
const BN254_CONTROL_ID = "0x04446e66d300eb7fb45c9726bb53c793dda407a62e9601618bb43c5c14657ac0";
const RISC_ZERO = 1; // ZkCoProcessorType.RiscZero

const head = await rpc("eth_getBlockByNumber", ["latest", false]);
const nonce = parseInt(await rpc("eth_getTransactionCount", [from, head.number]), 16);
const a = {
  r0: createAddress(from, nonce),
  port: createAddress(from, nonce + 1),
  automata: createAddress(from, nonce + 2),
  canaryPort: createAddress(from, nonce + 3),
  canaryAutomata: createAddress(from, nonce + 4),
  portWrongGuest: createAddress(from, nonce + 5),
  canaryOtherImage: createAddress(from, nonce + 6),
};
const img = opt("image") ?? imageHash(att);
const approvedExpect = opt("approved-expect", "BadPublicKey()");
const otherImage = "0x" + "11".repeat(32);

const flip = (h, at) => {
  const b = Buffer.from(h.slice(2), "hex");
  b[at] ^= 0x01;
  return "0x" + b.toString("hex");
};
const verifyCall = (j, s) => calldata("verify(bytes,uint8,bytes)", ["bytes", "uint8", "bytes"], [j, RISC_ZERO, s]);
const joinCall = (j, s) => calldata("join(bytes,bytes)", ["bytes", "bytes"], [j, s]);
const portArgs = (id) => [["bytes32", "bytes32", "address", "uint64"], [AWS_ROOT_SHA256, id, a.r0, maxTimeDiff]];

const steps = [
  {
    kind: "deploy", label: "deploy RiscZeroGroth16Verifier v3.0.1 (direct, no router)",
    data: creation("RiscZeroGroth16Verifier.sol", "RiscZeroGroth16Verifier", ["bytes32", "bytes32"], [CONTROL_ROOT, BN254_CONTROL_ID]),
  },
  { kind: "deploy", label: "deploy NitroZkVerifier (ownerless port)", data: creation("NitroZkVerifier.sol", "NitroZkVerifier", ...portArgs(guestId)) },
  {
    kind: "deploy", label: "deploy Automata NitroEnclaveVerifier as shipped (owner = sender)",
    data: creation("NitroEnclaveVerifier.sol", "NitroEnclaveVerifier", ["address", "uint64", "uint256", "uint256"], [from, maxTimeDiff, 0x60, 0], automataOut),
  },
  { kind: "deploy", label: "deploy NitroZkCanary on the port", data: creation("NitroZkCanary.sol", "NitroZkCanary", ["address", "bytes32"], [a.port, img]) },
  { kind: "deploy", label: "deploy NitroZkCanary on Automata's", data: creation("NitroZkCanary.sol", "NitroZkCanary", ["address", "bytes32"], [a.automata, img]) },
  { kind: "deploy", label: "deploy NitroZkVerifier pinned to another guest program", data: creation("NitroZkVerifier.sol", "NitroZkVerifier", ...portArgs("0x" + "22".repeat(32))) },
  { kind: "deploy", label: "deploy NitroZkCanary pinned to another enclave image", data: creation("NitroZkCanary.sol", "NitroZkCanary", ["address", "bytes32"], [a.port, otherImage]) },
  { kind: "setup", label: "Automata setup: setRootCert (owner)", to: a.automata, data: calldata("setRootCert(bytes32)", ["bytes32"], [AWS_ROOT_SHA256]) },
  {
    kind: "setup", label: "Automata setup: setZkConfiguration (owner)", to: a.automata,
    data: calldata("setZkConfiguration(uint8,(bytes32,bytes32,address),bytes32)", ["uint8", "bytes32", "bytes32", "address", "bytes32"], [RISC_ZERO, guestId, "0x" + "00".repeat(32), a.r0, guestId]),
  },
  { kind: "check", label: "verifier alone: verify(seal, guest id, sha256(journal))", to: a.r0, data: null },
  { kind: "control", label: "verifier alone: corrupted seal", to: a.r0, data: null, expect: "revert" },
  { kind: "control", label: "port: one byte of the journal changed", to: a.port, data: verifyCall(flip(journal, 100), seal), expect: "revert" },
  { kind: "control", label: "port pinned to another guest program", to: a.portWrongGuest, data: verifyCall(journal, seal), expect: "revert" },
  { kind: "check", label: "port: verify (cold; caches the intermediates)", to: a.port, data: verifyCall(journal, seal) },
  { kind: "check", label: "Automata as shipped: verify (cold)", to: a.automata, data: verifyCall(journal, seal) },
  { kind: "control", label: "canary on the port, another enclave image", to: a.canaryOtherImage, data: joinCall(journal, seal), expect: "WrongImage()" },
  { kind: "control", label: "canary on the port, approved image", to: a.canaryPort, data: joinCall(journal, seal), expect: approvedExpect },
  { kind: "control", label: "canary on Automata's, approved image", to: a.canaryAutomata, data: joinCall(journal, seal), expect: approvedExpect },
];

// verify(bytes seal, bytes32 imageId, bytes32 journalDigest) on the RISC Zero verifier.
const { createHash } = await import("node:crypto");
const journalDigest = "0x" + createHash("sha256").update(Buffer.from(journal.slice(2), "hex")).digest("hex");
steps[9].data = calldata("verify(bytes,bytes32,bytes32)", ["bytes", "bytes32", "bytes32"], [seal, guestId, journalDigest]);
steps[10].data = calldata("verify(bytes,bytes32,bytes32)", ["bytes", "bytes32", "bytes32"], [flip(seal, 40), guestId, journalDigest]);

const gasHex = "0x" + POLYGON_MAX_TX_GAS.toString(16);
const body = {
  blockStateCalls: steps.map((s) => ({ calls: [{ from, ...(s.to ? { to: s.to } : {}), data: s.data, gas: gasHex }] })),
  validation: false,
};
const blocks = await rpc("eth_simulateV1", [body, head.number]);
const rows = steps.map((s, i) => {
  const call = blocks[i].calls[0];
  const ok = call.status === "0x1";
  return {
    label: s.label, kind: s.kind, ok, gasUsed: BigInt(call.gasUsed).toString(),
    revert: ok ? null : decodeRevert(call.error?.data ?? call.returnData), expect: s.expect ?? null,
    returnData: ok && s.kind === "check" ? (call.returnData ?? "").slice(0, 200) : undefined,
  };
});
for (const r of rows) {
  const tail = r.ok ? "" : `  refused: ${r.revert}${r.expect ? `  (expected ${r.expect})` : ""}`;
  console.log(`${r.ok ? "ok  " : "FAIL"} ${fmt(r.gasUsed).padStart(11)}  ${r.label}${tail}`);
}
const summary = {
  node: await rpc("web3_clientVersion", []), baseBlock: parseInt(head.number, 16),
  guestId, imageHash: img, journalBytes: (journal.length - 2) / 2, sealBytes: (seal.length - 2) / 2,
};
console.log(JSON.stringify(summary, null, 1));
if (outFile) writeFileSync(outFile, JSON.stringify({ summary, rows, addresses: a }, null, 1));
