// The production forwarder's calling convention, built here as the DON builds it, so a rehearsal
// delivers through the forwarder's own bytecode on a fork: a raw report of a 109-byte header and the
// report, f + 1 signatures over keccak256(keccak256(rawReport) || reportContext), and the one call,
// report(receiver, rawReport, reportContext, signatures). The forwarder hands the receiver bytes 45
// to 109 of the raw report as its metadata (the workflow id, the name, the owner, the report id), and
// the rest as the report; it records a refused delivery with result false and does not revert.
//
// Source: KeystoneForwarder 1.0.0 (chainlink-evm, contracts/cre/src/v1/KeystoneForwarder.sol).

import { createHash } from "node:crypto";
import { concat, keccak256, numberToHex, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { sign } from "viem/accounts";

/** Chainlink's KeystoneForwarder 1.0.0 on Polygon mainnet. */
export const FORWARDER: Address = "0x76c9cf548b4179F8901cda1f8623568b58215E62";

export const FORWARDER_ABI = parseAbi([
	"function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)",
	"function setConfig(uint32 donId, uint32 configVersion, uint8 f, address[] signers)",
	"function owner() view returns (address)",
	"function typeAndVersion() view returns (string)",
	"event ReportProcessed(address indexed receiver, bytes32 indexed workflowExecutionId, bytes2 indexed reportId, bool result)",
]);

/**
 * The ten bytes of the workflow name as the forwarder carries them: the first ten hex characters of
 * SHA-256 of the name, as ASCII. Measured on the probe's deliveries (osprobe -> "8c7d198fad").
 */
export function nameBytes(name: string): Hex {
	return stringToHex(createHash("sha256").update(name).digest("hex").slice(0, 10));
}

export interface Header {
	readonly executionId: Hex;
	readonly timestamp: number;
	readonly donId: number;
	readonly configVersion: number;
	readonly workflowId: Hex;
	readonly name: string;
	readonly owner: Address;
	readonly reportId: number;
}

/** The raw report: version 1, the execution id, the timestamp, the DON id and config version, then the 64 bytes of metadata, then the report. */
export function rawReportOf(h: Header, report: Hex): Hex {
	return concat([
		"0x01",
		h.executionId,
		numberToHex(h.timestamp, { size: 4 }),
		numberToHex(h.donId, { size: 4 }),
		numberToHex(h.configVersion, { size: 4 }),
		h.workflowId,
		nameBytes(h.name),
		h.owner,
		numberToHex(h.reportId, { size: 2 }),
		report,
	]);
}

/** The metadata a receiver is handed: bytes 45 to 109 of the raw report. */
export function metadataOf(rawReport: Hex): Hex {
	return `0x${rawReport.slice(2 + 45 * 2, 2 + 109 * 2)}`;
}

/** The report context the DON signs beside the report. The forwarder only hashes it; any bytes do. */
export const CONTEXT: Hex = `0x${"00".repeat(96)}`;

/** f + 1 signatures over the complete hash, 65 bytes each, the last byte the parity (the forwarder adds 27). */
export async function signaturesOf(rawReport: Hex, keys: readonly Hex[]): Promise<Hex[]> {
	const complete = keccak256(concat([keccak256(rawReport), CONTEXT]));
	const out: Hex[] = [];
	for (const privateKey of keys) {
		const s = await sign({ hash: complete, privateKey, to: "object" });
		const parity = s.yParity ?? Number(s.v) - 27;
		out.push(concat([s.r, s.s, numberToHex(parity, { size: 1 })]));
	}
	return out;
}
