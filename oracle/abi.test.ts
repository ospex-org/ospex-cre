import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, decodeAbiParameters, toEventSelector, type Hex } from "viem";
import {
	EVENT_SIG,
	NONINDEXED_EVENT_ARGS,
	REPORT_ENVELOPE_ABI,
	VERIFY_PAYLOAD_ABI,
	MARKET_PAYLOAD_ABI,
	SCORE_PAYLOAD_ABI,
} from "./lib";

// Regression tests for the on-chain ABI contract with CreOracleReceiver. The shapes are imported from
// ./lib — the SAME definitions main.ts uses to build the event topic and encode reports — so any drift
// in the event signature, field order, width, or signedness fails here before it can reach the chain.

const typesOf = (abi: readonly { type: string }[]): string[] => abi.map((p) => p.type);

describe("CreOracleRequested event", () => {
	test("signature + topic0 are stable (must match CreOracleReceiver.CreOracleRequested)", () => {
		expect(EVENT_SIG).toBe("CreOracleRequested(uint256,uint8,uint64,string,string,string)");
		// keccak256 of the signature — the log-trigger topic0 the receiver emits.
		expect(toEventSelector(EVENT_SIG)).toBe(
			"0x4f87bb7693b160e2a4cc75317884456f7724fb81951fa3e33cf76574737492fe",
		);
	});

	test("non-indexed args = (uint64 requestNonce, string rundownId, string sportspageId, string jsonoddsId)", () => {
		expect(typesOf(NONINDEXED_EVENT_ARGS)).toEqual(["uint64", "string", "string", "string"]);
		const data = encodeAbiParameters(NONINDEXED_EVENT_ARGS, [7n, "rid", "sid", "jid"]);
		const [nonce, rid, sid, jid] = decodeAbiParameters(NONINDEXED_EVENT_ARGS, data);
		expect(nonce).toBe(7n); // uint64 -> bigint
		expect([rid, sid, jid]).toEqual(["rid", "sid", "jid"]);
	});
});

describe("report envelope", () => {
	test("shape = (uint8 requestType, uint256 chainId, address receiver, uint64 requestNonce, bytes payload)", () => {
		expect(typesOf(REPORT_ENVELOPE_ABI)).toEqual([
			"uint8",
			"uint256",
			"address",
			"uint64",
			"bytes",
		]);
	});

	test("encode -> decode roundtrip preserves all five fields and their JS types", () => {
		const receiver = "0xabcdef0123456789abcdef0123456789abcdef01" as Hex; // synthetic (lowercase)
		const inner = "0xdeadbeef" as Hex;
		const enc = encodeAbiParameters(REPORT_ENVELOPE_ABI, [2, 80002n, receiver, 9n, inner]);
		const [requestType, chainId, recv, nonce, payload] = decodeAbiParameters(REPORT_ENVELOPE_ABI, enc);
		expect(requestType).toBe(2); // uint8 -> number
		expect(chainId).toBe(80002n); // uint256 -> bigint
		expect((recv as string).toLowerCase()).toBe(receiver.toLowerCase());
		expect(nonce).toBe(9n); // uint64 -> bigint
		expect(payload).toBe(inner); // bytes -> hex
	});
});

describe("verify payload", () => {
	test("shape = (uint256 contestId, uint8 leagueId, uint32 startTime, uint16 version)", () => {
		expect(typesOf(VERIFY_PAYLOAD_ABI)).toEqual(["uint256", "uint8", "uint32", "uint16"]);
	});

	test("encode -> decode roundtrip", () => {
		const enc = encodeAbiParameters(VERIFY_PAYLOAD_ABI, [123n, 3, 1782317400, 1]);
		const [contestId, leagueId, startTime, version] = decodeAbiParameters(VERIFY_PAYLOAD_ABI, enc);
		expect(contestId).toBe(123n);
		expect(leagueId).toBe(3);
		expect(startTime).toBe(1782317400);
		expect(version).toBe(1);
	});
});

describe("market payload", () => {
	test("shape = (uint256, uint16, uint16, int32, uint16, uint16, int32, uint16, uint16, uint16)", () => {
		expect(typesOf(MARKET_PAYLOAD_ABI)).toEqual([
			"uint256",
			"uint16",
			"uint16",
			"int32",
			"uint16",
			"uint16",
			"int32",
			"uint16",
			"uint16",
			"uint16",
		]);
	});

	test("roundtrip preserves SIGNED int32 spread/total ticks (negative survives)", () => {
		// TEX -1.5 runline example: spreadTicks = -15 (signed), totalTicks = 75.
		const enc = encodeAbiParameters(MARKET_PAYLOAD_ABI, [2n, 180, 207, -15, 240, 163, 75, 195, 187, 1]);
		const dec = decodeAbiParameters(MARKET_PAYLOAD_ABI, enc);
		expect(dec).toEqual([2n, 180, 207, -15, 240, 163, 75, 195, 187, 1]);
		expect(dec[3]).toBe(-15); // int32 spread tick stays negative (not wrapped to a huge uint)
	});
});

describe("score payload", () => {
	test("shape = (uint256 contestId, uint32 awayScore, uint32 homeScore, uint16 version)", () => {
		expect(typesOf(SCORE_PAYLOAD_ABI)).toEqual(["uint256", "uint32", "uint32", "uint16"]);
	});

	test("encode -> decode roundtrip", () => {
		const enc = encodeAbiParameters(SCORE_PAYLOAD_ABI, [2n, 2, 4, 1]);
		const [contestId, away, home, version] = decodeAbiParameters(SCORE_PAYLOAD_ABI, enc);
		expect(contestId).toBe(2n);
		expect(away).toBe(2);
		expect(home).toBe(4);
		expect(version).toBe(1);
	});
});
