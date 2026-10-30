// The on-chain shapes, pinned: the one report shape as the reporter decodes it (abi.encode(Report) in
// Solidity, computed with cast), the games set's event topics and read selectors, and the decoders
// of the two events the workflow reads. Any drift in a field's order, width or signedness fails here
// before it reaches the chain.

import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type AbiParameter, type Hex } from "viem";
import type { Report } from "../scoring/src/chain";
import INTERFACE from "./abi/IOspexGames.json";
import { readReadings, type Evm } from "./chain";
import { GAMES } from "./test-helpers";
import {
	GAME_CREATED,
	GAME_CREATED_TOPIC,
	GAME_REPORTED,
	GAME_REPORTED_TOPIC,
	GAMES_READS,
	decodeGameCreated,
	decodeGameReported,
	decodeReport,
	encodeReport,
	readAnswer,
	readCall,
	topicOf,
} from "./lib";

/** A parameter as both the interface's ABI and lib.ts state it: its name (empty where unnamed), its type, its components in order, and whether indexed. */
interface Param {
	readonly name?: string;
	readonly type: string;
	readonly indexed?: boolean;
	readonly components?: readonly Param[];
}
function shape(p: Param): unknown {
	return { name: p.name ?? "", type: p.type, indexed: p.indexed ?? false, components: (p.components ?? []).map(shape) };
}
const entry = (type: string, name: string) => INTERFACE.abi.find((e) => e.type === type && e.name === name) as { inputs: Param[]; outputs?: Param[]; stateMutability?: string } | undefined;

// cast abi-encode "f((uint256,uint8,uint64,uint32,uint32,(uint8,uint8,uint32,uint32)[],address))" ...
const SCORE_GOLDEN =
	"0x0000000000000000000000000000000000000000000000000000000000000020" +
	"0000000000000000000000000000000000000000000000000000000000000007" +
	"0000000000000000000000000000000000000000000000000000000000000002" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000018" +
	"0000000000000000000000000000000000000000000000000000000000000011" +
	"00000000000000000000000000000000000000000000000000000000000000e0" +
	"0000000000000000000000001111111111111111111111111111111111111111" +
	"0000000000000000000000000000000000000000000000000000000000000004" +
	"0000000000000000000000000000000000000000000000000000000000000001" +
	"0000000000000000000000000000000000000000000000000000000000000002" +
	"0000000000000000000000000000000000000000000000000000000000000018" +
	"0000000000000000000000000000000000000000000000000000000000000011" +
	"0000000000000000000000000000000000000000000000000000000000000002" +
	"0000000000000000000000000000000000000000000000000000000000000002" +
	"0000000000000000000000000000000000000000000000000000000000000018" +
	"0000000000000000000000000000000000000000000000000000000000000011" +
	"0000000000000000000000000000000000000000000000000000000000000003" +
	"0000000000000000000000000000000000000000000000000000000000000002" +
	"0000000000000000000000000000000000000000000000000000000000000018" +
	"0000000000000000000000000000000000000000000000000000000000000011" +
	"0000000000000000000000000000000000000000000000000000000000000004" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000000";

const START_GOLDEN =
	"0x0000000000000000000000000000000000000000000000000000000000000020" +
	"0000000000000000000000000000000000000000000000000000000000000007" +
	"0000000000000000000000000000000000000000000000000000000000000001" +
	"000000000000000000000000000000000000000000000000000000006ae04740" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"00000000000000000000000000000000000000000000000000000000000000e0" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000004" +
	"0000000000000000000000000000000000000000000000000000000000000001" +
	"0000000000000000000000000000000000000000000000000000000000000001" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000002" +
	"0000000000000000000000000000000000000000000000000000000000000001" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000003" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000004" +
	"0000000000000000000000000000000000000000000000000000000000000001" +
	"0000000000000000000000000000000000000000000000000000000000000000" +
	"0000000000000000000000000000000000000000000000000000000000000000";

const ZERO = "0x0000000000000000000000000000000000000000";
const PAYOUT = "0x1111111111111111111111111111111111111111";
const FINAL = (seat: number): Report["readings"][number] => ({ seat, kind: 2, homeScore: 24, awayScore: 17 });

const SCORE: Report = { gameId: "7", kind: 2, start: 0, homeScore: 24, awayScore: 17, readings: [FINAL(1), FINAL(2), FINAL(3), { seat: 4, kind: 0, homeScore: 0, awayScore: 0 }], payout: PAYOUT };
const START: Report = {
	gameId: "7",
	kind: 1,
	start: 1793083200,
	homeScore: 0,
	awayScore: 0,
	readings: [
		{ seat: 1, kind: 1, homeScore: 0, awayScore: 0 },
		{ seat: 2, kind: 1, homeScore: 0, awayScore: 0 },
		{ seat: 3, kind: 0, homeScore: 0, awayScore: 0 },
		{ seat: 4, kind: 1, homeScore: 0, awayScore: 0 },
	],
	payout: ZERO,
};

describe("the one report shape", () => {
	test("a score encodes as abi.encode(Report) does in Solidity (cast's bytes)", () => {
		expect(encodeReport(SCORE)).toBe(SCORE_GOLDEN);
	});

	test("a start encodes the same way, payout zero", () => {
		expect(encodeReport(START)).toBe(START_GOLDEN);
	});

	test("the bytes decode back to the report, field for field", () => {
		expect(decodeReport(encodeReport(SCORE))).toEqual(SCORE);
		expect(decodeReport(encodeReport(START))).toEqual(START);
	});

	test("a field outside its width is refused here, never wrapped by the encoder", () => {
		expect(() => encodeReport({ ...SCORE, homeScore: 2 ** 32 })).toThrow("uint32");
		expect(() => encodeReport({ ...SCORE, readings: [{ seat: 256, kind: 2, homeScore: 1, awayScore: 1 }] })).toThrow("uint8");
		expect(() => encodeReport({ ...SCORE, readings: [{ seat: 1, kind: 3 as 2, homeScore: 1, awayScore: 1 }] })).toThrow("reading kind");
		expect(() => encodeReport({ ...SCORE, kind: 0 as 2 })).toThrow("report kind");
		expect(() => encodeReport({ ...SCORE, gameId: "0" })).toThrow("uint256");
		expect(() => encodeReport({ ...SCORE, gameId: "07" })).toThrow("uint256");
		expect(() => encodeReport({ ...SCORE, payout: "0x11" })).toThrow("address");
		expect(() => encodeReport({ ...SCORE, start: -1 })).toThrow("uint64");
	});
});

describe("the games set's interface, pinned to its ABI file", () => {
	test("every read the workflow makes is the interface's, inputs and outputs field for field in its order; the coin is the games set's own", () => {
		for (const fn of GAMES_READS) {
			if (fn.name === "i_token") {
				// A public immutable of the games set, not in its interface: its selector is pinned below.
				expect(entry("function", "i_token")).toBeUndefined();
				continue;
			}
			const theirs = entry("function", fn.name);
			expect(theirs, fn.name).toBeDefined();
			expect([fn.name, fn.inputs.map(shape), fn.outputs.map(shape), fn.stateMutability]).toEqual([fn.name, theirs!.inputs.map(shape), theirs!.outputs!.map(shape), theirs!.stateMutability]);
		}
	});

	test("getGameReadings is four fields in the games set's order, and the workflow declares all four; the fourth is the end's readings, a reading list as the start's is", () => {
		const theirs = entry("function", "getGameReadings")!.outputs!;
		expect(theirs.map((o) => [o.name, o.type])).toEqual([
			["startReadings", "tuple[]"],
			["votes", "tuple[]"],
			["disputedAt", "uint64"],
			["endReadings", "tuple[]"],
		]);
		expect(shape(theirs[3]!)).toEqual(shape({ ...theirs[0]!, name: "endReadings" }));
		expect(GAMES_READS.find((f) => f.name === "getGameReadings")!.outputs.map((o) => o.name)).toEqual(["startReadings", "votes", "disputedAt", "endReadings"]);
	});

	test("the games set's answer, all four fields as the interface encodes them, decodes all four back; the readings the program is given leave the end's out", () => {
		const four = entry("function", "getGameReadings")!.outputs! as readonly AbiParameter[];
		const start = [
			{ seat: 1, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 2, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 3, kind: 0, homeScore: 0, awayScore: 0 },
			{ seat: 4, kind: 1, homeScore: 0, awayScore: 0 },
		];
		const votes = [
			{ seat: 4, kind: 2, homeScore: 110, awayScore: 106 },
			{ seat: 2, kind: 2, homeScore: 114, awayScore: 106 },
		];
		// Values no other field holds, so a decoder that took them anywhere would show.
		const end = [
			{ seat: 1, kind: 2, homeScore: 31, awayScore: 28 },
			{ seat: 2, kind: 2, homeScore: 31, awayScore: 28 },
			{ seat: 3, kind: 2, homeScore: 31, awayScore: 28 },
		];
		const data = encodeAbiParameters(four, [start, votes, 1_793_090_400n, end]);
		// The workflow's declaration decodes all four, the end's readings last.
		expect(readAnswer("getGameReadings", data)).toEqual([start, votes, 1_793_090_400n, end]);
		// Decoded and unused: the readings the wrapper hands the program are the first three alone.
		const evm: Evm = { call: () => data, latest: () => ({ number: 1n, timestamp: 1 }) };
		expect(readReadings(evm, GAMES, 7n)).toEqual({ startReadings: start, votes, disputedAt: 1_793_090_400 });
	});

	test("the open list's row is OpenGame in the games set's order: gameId, status, start, window, day7Clock, disputedAt, league, date", () => {
		const theirs = entry("function", "getOpenGames")!.outputs![0] as Param;
		const ours = GAMES_READS.find((f) => f.name === "getOpenGames")!.outputs[0] as unknown as Param;
		const order = ["gameId", "status", "start", "window", "day7Clock", "disputedAt", "league", "date"];
		expect(theirs.components!.map((c) => c.name)).toEqual(order);
		expect(ours.components!.map((c) => [c.name, c.type])).toEqual(theirs.components!.map((c) => [c.name, c.type]));
	});

	test("the two events are the interface's, field for field", () => {
		expect(GAME_CREATED.inputs.map(shape)).toEqual(entry("event", "GameCreated")!.inputs.map(shape));
		expect(GAME_REPORTED.inputs.map(shape)).toEqual(entry("event", "GameReported")!.inputs.map(shape));
	});
});

describe("the games set's events and reads", () => {
	test("the topics are pinned to the interface at contracts-v2 main", () => {
		expect(GAME_CREATED_TOPIC).toBe("0x2864961d97a95a96d81c0fe43deac7845080b2717dbb63f09dbc55b339b0b1b7");
		expect(GAME_REPORTED_TOPIC).toBe("0xecc4786d20bf5136f8d61fb4845410bf2788353afe1816588a6efc287fef4d6d");
	});

	test("the read selectors are pinned", () => {
		expect(readCall("getGameStatus", [7n]).slice(0, 10)).toBe("0x0f1bf454");
		expect(readCall("getGameStart", [7n]).slice(0, 10)).toBe("0xc235a5c7");
		expect(readCall("getGameDisputedAt", [7n]).slice(0, 10)).toBe("0x2978940d");
		expect(readCall("getApprovedReporters", []).slice(0, 10)).toBe("0xb9c5849e");
		expect(readCall("getReporter", [PAYOUT]).slice(0, 10)).toBe("0x732995af");
		expect(readCall("i_token", []).slice(0, 10)).toBe("0x9608b232");
	});

	test("a read's answer decodes by its outputs", () => {
		expect(readAnswer("getGameStatus", encodeAbiParameters([{ type: "uint8" }], [3]))).toEqual([3]);
		expect(readAnswer("getApprovedReporters", encodeAbiParameters([{ type: "address[]" }, { type: "uint8[]" }], [[PAYOUT], [1]]))).toEqual([[PAYOUT], [1]]);
		expect(readAnswer("getReporter", encodeAbiParameters([{ type: "uint8" }, { type: "bool" }, { type: "bytes32" }], [1, true, topicOf(9)]))).toEqual([1, true, topicOf(9)]);
	});

	test("a GameCreated log decodes to the creation, with its block", () => {
		const topics = encodeEventTopics({ abi: [GAME_CREATED], eventName: "GameCreated", args: { gameId: 42n, creator: PAYOUT } }) as Hex[];
		const data = encodeAbiParameters(GAME_CREATED.inputs.filter((i) => !("indexed" in i && i.indexed)), [
			"nba",
			"Los Angeles Lakers",
			"Golden State Warriors",
			1_761_181_200n,
			[{ seat: 3, id: "00000000-0000-4000-8000-000000000000" }],
			{ window: 86_400n, day7Clock: 604_800n, day30Clock: 2_592_000n, fee: 1_000_000n },
			[PAYOUT],
			[1],
		]);
		const c = decodeGameCreated({ topics, data, blockNumber: 96_000_000n });
		expect(c).toEqual({
			gameId: 42n,
			creator: PAYOUT,
			league: "nba",
			home: "Los Angeles Lakers",
			away: "Golden State Warriors",
			date: 1_761_181_200,
			hints: [{ seat: 3, id: "00000000-0000-4000-8000-000000000000" }],
			terms: { window: 86_400, day7Clock: 604_800, day30Clock: 2_592_000, fee: 1_000_000n },
			reporters: [PAYOUT],
			kinds: [1],
			blockNumber: 96_000_000n,
		});
	});

	test("a GameReported log decodes to the report taken, readings as given", () => {
		const topics = encodeEventTopics({ abi: [GAME_REPORTED], eventName: "GameReported", args: { gameId: 42n, reporter: PAYOUT, kind: 4 } }) as Hex[];
		const data = encodeAbiParameters(GAME_REPORTED.inputs.filter((i) => !("indexed" in i && i.indexed)), [
			0n,
			0,
			0,
			[{ seat: 1, kind: 2, homeScore: 3, awayScore: 1 }, { seat: 2, kind: 1, homeScore: 2, awayScore: 1 }],
			ZERO,
		]);
		const r = decodeGameReported({ topics, data, blockNumber: 96_000_001n });
		expect(r.gameId).toBe(42n);
		expect(r.kind).toBe(4);
		expect(r.readings).toEqual([{ seat: 1, kind: 2, homeScore: 3, awayScore: 1 }, { seat: 2, kind: 1, homeScore: 2, awayScore: 1 }]);
		expect(r.payout).toBe(ZERO);
		expect(r.blockNumber).toBe(96_000_001n);
	});

	test("a topic of a number is 32 bytes", () => {
		expect(topicOf(1)).toBe("0x0000000000000000000000000000000000000000000000000000000000000001");
		expect(topicOf(42n).length).toBe(66);
	});
});
