// Shared helpers for the spike's measurement scripts. Node 22, no dependencies beyond
// Base's vendored hint tools in ./base (MIT).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
export const base = {
  ...require("./base/hinted_attestation_calls.js"),
  ...require("./base/p384_hints.js"),
};

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const POLYGON_MAX_TX_GAS = 33_554_432n; // Bor params.MaxTxGas = 1 << 25

export function keccakHex(bytes) {
  return "0x" + Buffer.from(base.keccak256(Buffer.from(bytes))).toString("hex");
}

export function selector(signature) {
  return keccakHex(Buffer.from(signature, "ascii")).slice(0, 10);
}

// --- JSON-RPC ---------------------------------------------------------------

export function rpcClient(url) {
  let id = 0;
  return async function rpc(method, params) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${method}: HTTP ${res.status}, non-JSON body: ${text.slice(0, 200)}`);
    }
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 500)}`);
    return body.result;
  };
}

// --- ABI ---------------------------------------------------------------------

function word(hexNoPrefix) {
  return hexNoPrefix.padStart(64, "0");
}

// Encodes static args (address, uint*, bytes32) and dynamic `bytes` (Buffer or 0x-hex).
export function encodeArgs(types, values) {
  const head = [];
  const tail = [];
  let offset = types.length * 32;
  types.forEach((type, i) => {
    const v = values[i];
    if (type === "bytes") {
      const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v).replace(/^0x/, ""), "hex");
      const padded = Buffer.concat([b, Buffer.alloc((32 - (b.length % 32)) % 32)]);
      head.push(word(offset.toString(16)));
      tail.push(word(b.length.toString(16)) + padded.toString("hex"));
      offset += 32 + padded.length;
    } else if (type === "address" || type === "bytes32") {
      const h = String(v).replace(/^0x/, "").toLowerCase();
      head.push(type === "address" ? word(h) : h.padEnd(64, "0"));
    } else if (type.startsWith("uint")) {
      head.push(word(BigInt(v).toString(16)));
    } else {
      throw new Error(`unsupported type ${type}`);
    }
  });
  return head.join("") + tail.join("");
}

export function calldata(signature, types, values) {
  return selector(signature) + encodeArgs(types, values);
}

export function creation(contractFile, contractName, types = [], values = [], outDir = path.join(ROOT, "out")) {
  const art = JSON.parse(readFileSync(path.join(outDir, contractFile, `${contractName}.json`), "utf8"));
  const code = art.bytecode.object;
  if (!code || code === "0x") throw new Error(`no bytecode for ${contractName}`);
  return code + encodeArgs(types, values);
}

// CREATE address = keccak256(rlp([sender, nonce]))[12:]
export function createAddress(sender, nonce) {
  const s = Buffer.from(sender.replace(/^0x/, ""), "hex");
  let n;
  if (nonce === 0) n = Buffer.from([0x80]);
  else if (nonce < 0x80) n = Buffer.from([nonce]);
  else {
    let h = nonce.toString(16);
    if (h.length % 2) h = "0" + h;
    const nb = Buffer.from(h, "hex");
    n = Buffer.concat([Buffer.from([0x80 + nb.length]), nb]);
  }
  const payload = Buffer.concat([Buffer.from([0x80 + 20]), s, n]);
  const rlp = Buffer.concat([Buffer.from([0xc0 + payload.length]), payload]);
  return "0x" + keccakHex(rlp).slice(26);
}

// --- revert reasons ----------------------------------------------------------

const KNOWN_ERRORS = [
  "WrongImage()", "BadPublicKey()", "LeaseOver()", "StaleDocument()", "NotJoined()", "BadSignature()",
  "DebugImage()", "NotVerified(uint8)", "OnlyRiscZero()", "IncompleteCertChain()", "InvalidAsn1Tag()",
  "InvalidCertAlgorithm()", "InvalidSubjectPublicKey()", "VerificationFailed()", "SelectorMismatch(bytes4,bytes4)",
];
const ERROR_BY_SELECTOR = Object.fromEntries(KNOWN_ERRORS.map((e) => [selector(e), e]));

export function decodeRevert(data) {
  if (!data || data === "0x") return "(empty revert)";
  const sel = data.slice(0, 10);
  if (sel === "0x08c379a0") {
    const len = parseInt(data.slice(10 + 64, 10 + 128), 16);
    return Buffer.from(data.slice(10 + 128, 10 + 128 + len * 2), "hex").toString("utf8");
  }
  return ERROR_BY_SELECTOR[sel] ?? `custom error ${sel}`;
}

// --- attestation fields --------------------------------------------------------

export function loadAttestation(file) {
  const raw = readFileSync(file);
  const text = raw.toString("latin1").trim();
  return /^0x[0-9a-fA-F]+$/.test(text) ? Buffer.from(text.slice(2), "hex") : raw;
}

// Minimal CBOR reader, enough to pull the PCR map and timestamp out of a Nitro document.
function readItem(buf, at) {
  const ib = buf[at];
  const major = ib >> 5;
  const ai = ib & 0x1f;
  let p = at + 1;
  let val;
  if (ai < 24) val = BigInt(ai);
  else if (ai === 24) { val = BigInt(buf[p]); p += 1; }
  else if (ai === 25) { val = BigInt(buf.readUInt16BE(p)); p += 2; }
  else if (ai === 26) { val = BigInt(buf.readUInt32BE(p)); p += 4; }
  else if (ai === 27) { val = buf.readBigUInt64BE(p); p += 8; }
  else if (ai === 31) val = null; // indefinite
  else throw new Error("unsupported CBOR additional info");
  return { major, val, p };
}

function skip(buf, at) {
  const { major, val, p } = readItem(buf, at);
  if (major === 0 || major === 1 || major === 7) return p;
  if (major === 2 || major === 3) return p + Number(val);
  if (major === 6) return skip(buf, p);
  let q = p;
  if (val === null) {
    while (buf[q] !== 0xff) q = skip(buf, q);
    return q + 1;
  }
  const n = major === 5 ? Number(val) * 2 : Number(val);
  for (let i = 0; i < n; i++) q = skip(buf, q);
  return q;
}

export function documentFields(attestation) {
  const { payload } = base.parseAttestationSignature(attestation);
  const root = readItem(payload, 0);
  let q = root.p;
  const out = { pcrs: {} };
  const count = root.val === null ? Infinity : Number(root.val);
  for (let i = 0; i < count && payload[q] !== 0xff; i++) {
    const k = readItem(payload, q);
    const key = payload.subarray(k.p, k.p + Number(k.val)).toString("utf8");
    const vAt = k.p + Number(k.val);
    if (key === "pcrs") {
      const m = readItem(payload, vAt);
      let r = m.p;
      for (let j = 0; j < Number(m.val); j++) {
        const idx = readItem(payload, r);
        const v = readItem(payload, idx.p);
        out.pcrs[Number(idx.val)] = payload.subarray(v.p, v.p + Number(v.val));
        r = v.p + Number(v.val);
      }
    } else if (key === "timestamp") {
      out.timestampMs = readItem(payload, vAt).val;
    } else if (key === "module_id") {
      const v = readItem(payload, vAt);
      out.moduleId = payload.subarray(v.p, v.p + Number(v.val)).toString("utf8");
    }
    q = skip(payload, vAt);
  }
  return out;
}

export function imageHash(attestation) {
  const { pcrs } = documentFields(attestation);
  return keccakHex(Buffer.concat([pcrs[0], pcrs[1], pcrs[2]]));
}

export function fmt(n) {
  return BigInt(n).toLocaleString("en-US");
}
