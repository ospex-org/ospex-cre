// The direct route on a public fixture, executed by a Polygon node without sending anything.
//
// Every step is its own simulated block (eth_simulateV1) on top of the node's latest block,
// state carried forward, each call capped at Polygon's per-transaction limit. The gas is
// Bor's own execution, so it carries Polygon's gas schedule, not Ethereum's.
//
// usage: node tools/sim-direct.mjs --rpc <url> --from <address> --fixture <file> --other <file>
//          [--grace <seconds>] [--out <json>]
import { writeFileSync } from "node:fs";
import {
  POLYGON_MAX_TX_GAS, base, calldata, createAddress, creation, decodeRevert, documentFields, fmt,
  imageHash, loadAttestation, rpcClient,
} from "./lib.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const rpcUrl = opt("rpc");
const from = opt("from");
const fixture = opt("fixture");
const otherFixture = opt("other");
const grace = BigInt(opt("grace", String(4 * 365 * 24 * 3600)));
const outFile = opt("out");
// --base-out <dir>: deploy base/nitro-validator's own build (owner and revoker kept) instead of the port.
const baseOut = opt("base-out");
if (!rpcUrl || !from || !fixture || !otherFixture) {
  console.error("usage: --rpc <url> --from <address> --fixture <file> --other <file> [--grace <s>] [--out <json>]");
  process.exit(2);
}

const rpc = rpcClient(rpcUrl);
const att = loadAttestation(fixture);
const other = loadAttestation(otherFixture);

const head = await rpc("eth_getBlockByNumber", ["latest", false]);
const chainId = parseInt(await rpc("eth_chainId", []), 16);
const nonce = parseInt(await rpc("eth_getTransactionCount", [from, head.number]), 16);
const a = {
  p384: createAddress(from, nonce),
  certManager: createAddress(from, nonce + 1),
  validator: createAddress(from, nonce + 2),
  canary: createAddress(from, nonce + 3),
};
const approvedImage = imageHash(att);

const plan = base.prepareHintedAttestationCalls(att, a);
const otherPlan = base.prepareHintedAttestationCalls(other, a);
const joinArgs = (p) => {
  const last = p.cold[p.cold.length - 1].args;
  return [last.attestationTbs, last.signature, last.attestationHints];
};
const join = (args) => calldata("join(bytes,bytes,bytes)", ["bytes", "bytes", "bytes"], args);

// A one-byte change inside the signed document: the hints no longer fit and the check refuses.
const tampered = (() => {
  const [tbs, sig, hints] = joinArgs(plan);
  const b = Buffer.from(tbs.slice(2), "hex");
  b[b.length - 40] ^= 0x01;
  return ["0x" + b.toString("hex"), sig, hints];
})();

const steps = [
  { kind: "deploy", label: "deploy P384Verifier", data: creation("P384Verifier.sol", "P384Verifier", [], [], baseOut) },
  baseOut
    ? {
      kind: "deploy", label: "deploy CertManagerDemo (Base's own, owner and revoker kept)",
      data: creation("CertManagerDemo.sol", "CertManagerDemo", ["address", "uint256"], [a.p384, grace], baseOut),
    }
    : {
      kind: "deploy", label: "deploy CertManager (ownerless; fixture clock)",
      data: creation("CertManagerFixtureClock.sol", "CertManagerFixtureClock", ["address", "uint256"], [a.p384, grace]),
    },
  {
    kind: "deploy", label: "deploy NitroValidator",
    data: creation("NitroValidator.sol", "NitroValidator", ["address", "address"], [a.certManager, a.p384], baseOut),
  },
  {
    kind: "deploy", label: "deploy NitroCanary",
    data: creation("NitroCanary.sol", "NitroCanary", ["address", "bytes32"], [a.validator, approvedImage]),
  },
  ...plan.cold.map((t) => ({ kind: "cold", label: `cold ${t.tx}: ${t.label}`, to: t.to, data: t.calldata })),
  { kind: "warm", label: "warm: the same document again, chain and leaf cached", to: a.validator, data: plan.warm[0].calldata },
  { kind: "control", label: "canary join, approved image", to: a.canary, data: join(joinArgs(plan)), expect: "BadPublicKey()" },
  { kind: "control", label: "validator, one byte of the document changed", to: a.validator, data: plan.warm[0].calldata.slice(0, 10) + calldata("x(bytes,bytes,bytes)", ["bytes", "bytes", "bytes"], tampered).slice(10), expect: "revert" },
  ...otherPlan.cold.slice(0, -1).map((t) => ({ kind: "other-cache", label: `other image, cache ${t.tx}: ${t.label}`, to: t.to, data: t.calldata })),
  { kind: "control", label: "canary join, other image", to: a.canary, data: join(joinArgs(otherPlan)), expect: "WrongImage()" },
];

const gasHex = "0x" + POLYGON_MAX_TX_GAS.toString(16);
const t0 = Date.now();
let blocks;
if (argv.includes("--send")) {
  // Local dev chains only (an unlocked `from`): send each step as a real transaction and read
  // its receipt. Used to run the same code under Ethereum's rules on anvil.
  blocks = [];
  for (const s of steps) {
    const tx = { from, ...(s.to ? { to: s.to } : {}), data: s.data, gas: gasHex };
    let hash;
    try {
      hash = await rpc("eth_sendTransaction", [tx]);
    } catch (err) {
      const m = /"data":"(0x[0-9a-fA-F]*)"/.exec(String(err.message));
      blocks.push({ number: "0x0", calls: [{ status: "0x0", gasUsed: "0x0", error: { data: m ? m[1] : "0x" } }] });
      continue;
    }
    let rc = null;
    for (let tries = 0; rc === null && tries < 100; tries++) {
      rc = await rpc("eth_getTransactionReceipt", [hash]);
      if (rc === null) await new Promise((r) => setTimeout(r, 100));
    }
    if (rc === null) throw new Error(`no receipt for ${hash}`);
    let errData = "0x";
    if (rc.status !== "0x1") {
      try { await rpc("eth_call", [tx, "latest"]); } catch (err) {
        const m = /"data":"(0x[0-9a-fA-F]*)"/.exec(String(err.message));
        if (m) errData = m[1];
      }
    }
    blocks.push({ number: rc.blockNumber, calls: [{ status: rc.status, gasUsed: rc.gasUsed, error: { data: errData } }] });
  }
} else {
  const body = {
    blockStateCalls: steps.map((s) => ({
      calls: [{ from, ...(s.to ? { to: s.to } : {}), data: s.data, gas: gasHex }],
    })),
    validation: false,
  };
  blocks = await rpc("eth_simulateV1", [body, head.number]);
}
const ms = Date.now() - t0;

const rows = steps.map((s, i) => {
  const call = blocks[i].calls[0];
  const ok = call.status === "0x1";
  const gas = BigInt(call.gasUsed);
  return {
    label: s.label, kind: s.kind, ok, gasUsed: gas.toString(),
    revert: ok ? null : decodeRevert(call.error?.data ?? call.returnData),
    expect: s.expect ?? null,
    simulatedBlock: parseInt(blocks[i].number, 16),
  };
});

const docs = { approved: documentFields(att), other: documentFields(other) };
const cold = rows.filter((r) => r.kind === "cold");
const sum = (xs) => xs.reduce((t, r) => t + BigInt(r.gasUsed), 0n);
const summary = {
  node: (await rpc("web3_clientVersion", [])),
  chainId, baseBlock: parseInt(head.number, 16), baseBlockTime: parseInt(head.timestamp, 16),
  blockGasLimit: parseInt(head.gasLimit, 16), perTxCap: POLYGON_MAX_TX_GAS.toString(),
  approvedImage, approvedModule: docs.approved.moduleId, otherModule: docs.other.moduleId,
  coldTotal: sum(cold).toString(), coldTxs: cold.length,
  coldMaxTx: cold.reduce((m, r) => (BigInt(r.gasUsed) > m ? BigInt(r.gasUsed) : m), 0n).toString(),
  newLeafTotal: sum(cold.slice(-2)).toString(),
  allColdOk: cold.every((r) => r.ok),
  simulateMs: ms,
};

for (const r of rows) {
  const g = fmt(r.gasUsed).padStart(12);
  const tail = r.ok ? "" : `  refused: ${r.revert}${r.expect ? `  (expected ${r.expect})` : ""}`;
  console.log(`${r.ok ? "ok  " : "FAIL"} ${g}  ${r.label}${tail}`);
}
console.log(JSON.stringify(summary, null, 1));
if (outFile) writeFileSync(outFile, JSON.stringify({ summary, rows, addresses: a }, null, 1));
