// The chain reads: what the wrapper asks the games set for a game in each status, and what it builds
// from the answers. Every read is the one the status calls for, the events are read from the game's
// creation block with the topics that name the game and the kind, and nothing is asked of a game that
// has ended.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import { chainOf } from "../scoring/test/rule-helpers";
import { readDisputeRecords, readGame, readStartReadings, type Evm } from "./chain";
import { GAME_REPORTED_TOPIC, KIND_DISPUTE, KIND_START, topicOf } from "./lib";
import { COIN, GAMES, REPORTER, creationOf, fakeChain, refusedOf } from "./test-helpers";

const SELECTORS = {
	getGameStatus: "0x0f1bf454",
	getGameStart: "0xc235a5c7",
	getGameDisputedAt: "0x2978940d",
};

const RECORD_A = [
	{ seat: 1, kind: 2 as const, homeScore: 114, awayScore: 106 },
	{ seat: 2, kind: 2 as const, homeScore: 114, awayScore: 106 },
	{ seat: 3, kind: 0 as const, homeScore: 0, awayScore: 0 },
	{ seat: 4, kind: 2 as const, homeScore: 110, awayScore: 106 },
];
const RECORD_B = RECORD_A.map((r) => (r.seat === 4 ? { ...r, homeScore: 114 } : r));

describe("the chain reads", () => {
	test("an unverified game: its status, and nothing more", () => {
		const base = chainOf("nfl not final");
		const game: ChainGame = { ...base, status: "unverified", start: null, startReadings: null, dispute: null };
		const chain = fakeChain(game, base.start! - 3600);
		const read = readGame(chain, GAMES, creationOf(game), refusedOf([REPORTER]));
		expect(read).toEqual({ ...game, payoutRefused: refusedOf([REPORTER]) });
		expect(chain.calls.map((c) => c.selector)).toEqual([SELECTORS.getGameStatus]);
		expect(chain.queries).toEqual([]);
	});

	test("a verified game: its start, and the start report's readings from the games set's event", () => {
		const game = chainOf("nba final, read after the game");
		const creation = creationOf(game, [REPORTER], 96_000_000n);
		const chain = fakeChain(game, game.start! + 60, { latestBlock: 96_123_456n });
		const read = readGame(chain, GAMES, creation, refusedOf([REPORTER]));
		expect(read.status).toBe("verified");
		expect(read.start).toBe(game.start);
		expect(read.startReadings).toEqual(game.startReadings);
		expect(read.dispute).toBeNull();
		expect(chain.calls.map((c) => c.selector)).toEqual([SELECTORS.getGameStatus, SELECTORS.getGameStart]);
		expect(chain.queries).toEqual([
			{ address: GAMES, topics: [GAME_REPORTED_TOPIC, topicOf(BigInt(game.id)), null, topicOf(KIND_START)], fromBlock: 96_000_000n, toBlock: 96_123_456n },
		]);
	});

	test("a disputed game: when its record was written, and every dispute report in order", () => {
		const base = chainOf("nba final, read after the game");
		const game: ChainGame = { ...base, status: "disputed", dispute: { at: base.start! + 7200, records: [RECORD_A, RECORD_B] } };
		const chain = fakeChain(game, base.start! + 10_000);
		const read = readGame(chain, GAMES, creationOf(game), refusedOf([REPORTER]));
		expect(read.dispute).toEqual({ at: base.start! + 7200, records: [RECORD_A, RECORD_B] });
		expect(read.startReadings).toEqual(base.startReadings);
		expect(chain.calls.map((c) => c.selector)).toEqual([SELECTORS.getGameStatus, SELECTORS.getGameStart, SELECTORS.getGameDisputedAt]);
		expect(chain.queries.map((q) => q.topics[3])).toEqual([topicOf(KIND_START), topicOf(KIND_DISPUTE)]);
	});

	test("a game that has ended: its status, and nothing more", () => {
		for (const status of ["scored", "voided", "released"] as const) {
			const game: ChainGame = { ...chainOf("nba final, read after the game"), status };
			const chain = fakeChain(game, game.start! + 90_000);
			const read = readGame(chain, GAMES, creationOf(game), refusedOf([REPORTER]));
			expect([read.status, read.start, read.startReadings, read.dispute]).toEqual([status, null, null, null]);
			expect(chain.calls.length).toBe(1);
			expect(chain.queries.length).toBe(0);
		}
	});

	test("a start report that is not on the chain reads null, so the program decides nothing on it", () => {
		const game: ChainGame = { ...chainOf("nba final, read after the game"), startReadings: null };
		const chain = fakeChain(game, game.start! + 60);
		expect(readStartReadings(chain, GAMES, BigInt(game.id), 1n, 2_000_000_000n)).toBeNull();
		expect(readDisputeRecords(chain, GAMES, BigInt(game.id), 1n, 2_000_000_000n)).toEqual([]);
	});

	test("the identity and the terms come from the creation event, the refusals from the reads", () => {
		const game = chainOf("nba final, read after the game");
		const creation = { ...creationOf(game), league: "nhl", home: "H", away: "A", date: 123, hints: [{ seat: 3, id: "x" }], terms: { window: 100, day7Clock: 200, day30Clock: 300, fee: 0n } };
		const read = readGame(fakeChain(game, game.start! + 60), GAMES, creation, refusedOf([REPORTER], COIN));
		expect([read.league, read.home, read.away, read.date, read.hints, read.n, read.day7]).toEqual(["nhl", "H", "A", 123, [{ seat: 3, id: "x" }], 100, 200]);
		expect(read.payoutRefused).toEqual(refusedOf([REPORTER], COIN));
	});

	test("a status the games set does not have is refused", () => {
		const bad: Evm = {
			call: () => `0x${"7".padStart(64, "0")}`,
			logs: () => [],
			latest: () => ({ number: 1n, timestamp: 1 }),
		};
		expect(() => readGame(bad, GAMES, creationOf(chainOf("nba final")), refusedOf([REPORTER]))).toThrow("status");
	});
});
