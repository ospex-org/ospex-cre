// Writes the hinted call plan for one attestation as JSON, for the Foundry tests to read.
// usage: node tools/plan.mjs <attestation file> <out.json>
import { writeFileSync } from "node:fs";
import { base, documentFields, imageHash, loadAttestation } from "./lib.mjs";

const [file, out] = process.argv.slice(2);
if (!file || !out) {
  console.error("usage: node tools/plan.mjs <attestation file> <out.json>");
  process.exit(2);
}
const att = loadAttestation(file);
const plan = base.prepareHintedAttestationCalls(att, {});
const doc = documentFields(att);
const certs = plan.cold.slice(0, -1).map((t) => ({
  cert: t.args.cert,
  parentCertHash: t.args.parentCertHash,
  hints: t.args.signatureHints,
}));
const last = plan.cold[plan.cold.length - 1].args;
writeFileSync(out, JSON.stringify({
  timestampSeconds: Number(doc.timestampMs / 1000n),
  imageHash: imageHash(att),
  caCerts: certs.slice(0, -1),
  leaf: certs[certs.length - 1],
  attestationTbs: last.attestationTbs,
  signature: last.signature,
  attestationHints: last.attestationHints,
}, null, 1));
console.log(`wrote ${out}`);
