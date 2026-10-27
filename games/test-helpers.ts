// A fake chain for the wrapper's tests: it answers the games set's reads and events for one game, as
// the chain would, from a ChainGame the test chose, and records every call and every log query. The
// wrapper is run against it with the scoring program's saved feed answers, so a test sees exactly what
// the wrapper would write for a real game without a chain or a feed.

import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import type { ChainGame, PayoutRefused, ReportReading } from "../scoring/src/chain";
import type { Evm } from "./chain";
import { GAME_CREATED_TOPIC, GAME_REPORTED, GAME_REPORTED_TOPIC, GAMES_READS, type Creation, type RawLog } from "./lib";

export const GAMES: Address = "0x6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e";
export const COIN: Address = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export const REPORTER: Address = "0x4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e";
export const RETIRED: Address = "0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e";
export const ZERO: Address = "0x0000000000000000000000000000000000000000";

const STATUS_NUMBER: Record<ChainGame["status"], number> = { unverified: 1, verified: 2, disputed: 3, scored: 4, voided: 5, released: 6 };

function selector(data: Hex): string {
	return data.slice(0, 10).toLowerCase();
}

function selectorOf(name: (typeof GAMES_READS)[number]["name"]): string {
	// The selectors as cast computes them, so the fake answers the same calldata the chain would.
	const known: Record<string, string> = {
		getGameStatus: "0x0f1bf454",
		getGameStart: "0xc235a5c7",
		getGameDisputedAt: "0x2978940d",
		getApprovedReporters: "0xb9c5849e",
		getReporter: "0x732995af",
		i_token: "0x9608b232",
	};
	return known[name];
}

export function reportedLog(gameId: bigint, reporter: Address, kind: number, readings: readonly ReportReading[], blockNumber: bigint, start = 0): RawLog {
	const topics = encodeEventTopics({ abi: [GAME_REPORTED], eventName: "GameReported", args: { gameId, reporter, kind } }) as Hex[];
	const data = encodeAbiParameters(GAME_REPORTED.inputs.filter((i) => !("indexed" in i && i.indexed)), [BigInt(start), 0, 0, readings.map((r) => ({ ...r })), ZERO]);
	return { topics, data, blockNumber };
}

/** The creation event a ChainGame came from, as the trigger would hand it. */
export function creationOf(game: ChainGame, reporters: readonly Address[] = [REPORTER], blockNumber = 96_000_000n): Creation {
	return {
		gameId: BigInt(game.id),
		creator: "0x7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c",
		league: game.league,
		home: game.home,
		away: game.away,
		date: game.date,
		hints: game.hints,
		terms: { window: game.n, day7Clock: game.day7, day30Clock: 30 * 86_400, fee: 1_000_000n },
		reporters,
		kinds: reporters.map(() => 1),
		blockNumber,
	};
}

export interface FakeChain extends Evm {
	readonly calls: { to: Address; selector: string; data: Hex }[];
	readonly queries: { address: Address; topics: readonly (Hex | null)[]; fromBlock: bigint; toBlock: bigint }[];
}

/**
 * A chain holding one game: its status, start, start readings and dispute records come from `game`;
 * the approved list and whether a given address was ever a reporter from the arguments. The latest
 * block's timestamp is `now`.
 */
export function fakeChain(
	game: ChainGame,
	now: number,
	opts: { approved?: readonly Address[]; everApproved?: readonly Address[]; latestBlock?: bigint; coin?: Address } = {},
): FakeChain {
	const approved = opts.approved ?? [REPORTER];
	const everApproved = opts.everApproved ?? [...approved, RETIRED];
	const latestBlock = opts.latestBlock ?? 96_500_000n;
	const coin = opts.coin ?? COIN;
	const gameId = BigInt(game.id);
	const calls: FakeChain["calls"] = [];
	const queries: FakeChain["queries"] = [];
	return {
		calls,
		queries,
		call(to, data) {
			const s = selector(data);
			calls.push({ to, selector: s, data });
			if (to.toLowerCase() !== GAMES.toLowerCase()) throw new Error("a call to an address that is not the games set");
			if (s === selectorOf("i_token")) return encodeAbiParameters([{ type: "address" }], [coin]);
			if (s === selectorOf("getApprovedReporters")) return encodeAbiParameters([{ type: "address[]" }, { type: "uint8[]" }], [approved, approved.map(() => 1)]);
			if (s === selectorOf("getReporter")) {
				const who = (`0x${data.slice(34, 74)}`).toLowerCase();
				const was = everApproved.some((a) => a.toLowerCase() === who);
				return encodeAbiParameters([{ type: "uint8" }, { type: "bool" }, { type: "bytes32" }], [was ? 1 : 0, was && !approved.some((a) => a.toLowerCase() === who), topicOf32(was ? 9 : 0)]);
			}
			if (s === selectorOf("getGameStatus")) return encodeAbiParameters([{ type: "uint8" }], [STATUS_NUMBER[game.status]]);
			if (s === selectorOf("getGameStart")) {
				if (game.start === null) throw new Error("revert: the start is not written");
				return encodeAbiParameters([{ type: "uint64" }], [BigInt(game.start)]);
			}
			if (s === selectorOf("getGameDisputedAt")) {
				if (game.dispute === null) throw new Error("revert: no dispute record");
				return encodeAbiParameters([{ type: "uint64" }], [BigInt(game.dispute.at)]);
			}
			throw new Error(`a read the fake chain does not answer: ${s}`);
		},
		logs(address, topics, fromBlock, toBlock) {
			queries.push({ address, topics, fromBlock, toBlock });
			if (address.toLowerCase() !== GAMES.toLowerCase()) return [];
			if (topics[0] === GAME_CREATED_TOPIC) return [];
			if (topics[0] !== GAME_REPORTED_TOPIC) return [];
			const wantId = topics[1];
			const wantKind = topics[3];
			if (wantId !== null && wantId !== undefined && BigInt(wantId) !== gameId) return [];
			const out: RawLog[] = [];
			let block = 96_000_010n;
			if (game.startReadings !== null && (wantKind === null || wantKind === undefined || BigInt(wantKind) === 1n)) {
				out.push(reportedLog(gameId, REPORTER, 1, game.startReadings, block++, game.start ?? 0));
			}
			if (game.dispute !== null && (wantKind === null || wantKind === undefined || BigInt(wantKind) === 4n)) {
				for (const r of game.dispute.records) out.push(reportedLog(gameId, REPORTER, 4, r, block++));
			}
			return out.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
		},
		latest() {
			return { number: latestBlock, timestamp: now };
		},
	};
}

function topicOf32(n: number): Hex {
	return `0x${n.toString(16).padStart(64, "0")}`;
}

/** The refusals a fake chain's reads add up to, for an expectation. */
export function refusedOf(reporters: readonly Address[], coin: Address = COIN): PayoutRefused {
	return { gamesSet: GAMES, coin, reporters: [...reporters] };
}

/** A writer that records what it was handed and answers a fixed hash. */
export function recordingWriter(): { write: (report: Hex) => string | null; written: Hex[] } {
	const written: Hex[] = [];
	return {
		written,
		write(report) {
			written.push(report);
			return `0x${"ab".repeat(32)}`;
		},
	};
}
