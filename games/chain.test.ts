// The chain reads: what the wrapper asks the games set for, from state, and what it builds from the
// answers. The open list is a page per read and carries what the tick decides on, a shard reading its
// own pages, its first every tick and the rest in turn; a game's identity, its readings and its
// reporters are one read each, asked for the one game a full read is about; a game before any report
// is the creation event's, and a game that has ended is read no further than its status. Nothing is
// read from a log past the trigger's own.

import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, type AbiParameter } from "viem";
import type { ChainGame } from "../scoring/src/chain";
import { lastRecorded } from "../scoring/src/rule";
import { chainOf } from "../scoring/test/rule-helpers";
import INTERFACE from "./abi/IOspexGames.json";
import { gameOfCreation, gameOfState, readIdentity, readOpenGames, readReadings, readReporters, recordOfVotes, type Evm, type OpenGame } from "./chain";
import { GAMES, REPORTER, RETIRED, creationOf, fakeChain, fakeChainOf } from "./test-helpers";

const RECORD_A = [
	{ seat: 1, kind: 2 as const, homeScore: 114, awayScore: 106 },
	{ seat: 2, kind: 2 as const, homeScore: 114, awayScore: 106 },
	{ seat: 3, kind: 0 as const, homeScore: 0, awayScore: 0 },
	{ seat: 4, kind: 2 as const, homeScore: 110, awayScore: 106 },
];
const RECORD_B = RECORD_A.map((r) => (r.seat === 4 ? { ...r, homeScore: 114 } : r));
const SEATS4 = [1, 2, 3, 4] as const;

function rowOf(g: ChainGame): OpenGame {
	return {
		gameId: BigInt(g.id),
		status: g.status,
		start: g.start,
		window: g.n,
		day7Clock: g.day7,
		disputedAt: g.dispute?.at ?? null,
		league: g.league,
		date: g.date,
	};
}

describe("the chain reads, from state", () => {
	test("the open list: every game not ended, a page per read, with its clocks, its date and its league", () => {
		const a = chainOf("nba final, read after the game");
		const b: ChainGame = { ...chainOf("nfl not final"), id: "7", status: "unverified", start: null, startReadings: null, dispute: null };
		const c: ChainGame = { ...a, id: "9", status: "disputed", dispute: { at: a.start! + 7_200, records: [RECORD_A] } };
		const ended: ChainGame = { ...a, id: "11", status: "scored" };
		const chain = fakeChainOf([a, b, c, ended], 1);
		const { rows, reads, total, pages } = readOpenGames(chain, GAMES, { index: 0, count: 1 }, [0], 2);
		expect([reads, total, pages]).toEqual([2, 3, { own: 2, read: 2 }]);
		expect(rows.map((r) => [r.gameId, r.status, r.start, r.disputedAt])).toEqual([
			[7n, "unverified", null, null],
			[9n, "disputed", a.start, a.start! + 7_200],
			[42n, "verified", a.start, null],
		]);
		expect(rows[0]).toEqual({ gameId: 7n, status: "unverified", start: null, window: b.n, day7Clock: b.day7, disputedAt: null, league: b.league, date: b.date });
		expect(rows[2]).toEqual({ gameId: 42n, status: "verified", start: a.start, window: a.n, day7Clock: a.day7, disputedAt: null, league: a.league, date: a.date });
		expect(chain.names()).toEqual(["getOpenGames", "getOpenGames"]);
		expect(chain.calls.map((c) => c.args)).toEqual([[0n, 2n], [2n, 2n]]);
	});

	test("a page encoded by the games set's own interface decodes to the row's fields by name, in its order", () => {
		// The answer is built from the interface's ABI file, not from lib.ts, with every field a value of
		// its own (the date two hours from the start, the clocks apart), so a field read from another's
		// slot shows.
		const getOpenGames = INTERFACE.abi.find((e) => e.type === "function" && e.name === "getOpenGames") as { outputs: readonly AbiParameter[] };
		const row = { gameId: 77n, status: 2, start: 1_700_000_000n, window: 86_400n, day7Clock: 604_800n, disputedAt: 1_700_010_000n, league: "nhl", date: 1_700_007_200n };
		const answer = encodeAbiParameters(getOpenGames.outputs, [[row], 1n]);
		const evm: Evm = { call: () => answer, latest: () => ({ number: 1n, timestamp: 1 }) };
		const { rows, total } = readOpenGames(evm, GAMES);
		expect(total).toBe(1);
		expect(rows).toEqual([{ gameId: 77n, status: "verified", start: 1_700_000_000, window: 86_400, day7Clock: 604_800, disputedAt: 1_700_010_000, league: "nhl", date: 1_700_007_200 }]);
	});

	test("an empty open list is one read, and a list that fits a page is one read", () => {
		expect(readOpenGames(fakeChainOf([], 1), GAMES)).toEqual({ rows: [], reads: 1, total: 0, pages: { own: 0, read: 0 } });
		const a = chainOf("nba final, read after the game");
		expect(readOpenGames(fakeChainOf([a], 1), GAMES)).toMatchObject({ reads: 1, total: 1, pages: { own: 1, read: 1 } });
	});

	test("a shard reads its own pages only: its first every tick, and of the rest the page each turn names, so every page is read over the turns", () => {
		const a = chainOf("nba final, read after the game");
		const games = Array.from({ length: 11 }, (_, i) => ({ ...a, id: String(i + 1) }));
		// Pages of 2: six pages (the last of one row). Shard 1 of 3 owns pages 1 and 4 (rows 3,4 and 9,10); shard 2 owns 2 and 5 (rows 5,6 and 11); shard 0 owns 0 and 3.
		const one = readOpenGames(fakeChainOf(games, 1), GAMES, { index: 1, count: 3 }, [0], 2);
		expect([one.reads, one.total, one.pages, one.rows.map((r) => r.gameId)]).toEqual([2, 11, { own: 2, read: 2 }, [3n, 4n, 9n, 10n]]);
		const two = readOpenGames(fakeChainOf(games, 1), GAMES, { index: 2, count: 3 }, [0], 2);
		expect([two.reads, two.pages, two.rows.map((r) => r.gameId)]).toEqual([2, { own: 2, read: 2 }, [5n, 6n, 11n]]);
		// A shard past the list's pages: one read, nothing.
		const past = readOpenGames(fakeChainOf(games.slice(0, 2), 1), GAMES, { index: 2, count: 3 }, [0], 2);
		expect([past.reads, past.total, past.pages, past.rows]).toEqual([1, 2, { own: 0, read: 0 }, []]);
		// One shard owning six pages reads its first and the page the turn names: over five turns, every other page once, in order.
		const seen: bigint[][] = [];
		for (let turn = 0; turn < 5; turn++) {
			const chain = fakeChainOf(games, 1);
			const t = readOpenGames(chain, GAMES, { index: 0, count: 1 }, [turn], 2);
			expect([t.reads, t.pages]).toEqual([2, { own: 6, read: 2 }]);
			expect(t.rows.slice(0, 2).map((r) => r.gameId)).toEqual([1n, 2n]);
			expect(chain.calls.map((c) => c.args)).toEqual([[0n, 2n], [BigInt(2 * (1 + turn)), 2n]]);
			seen.push(t.rows.slice(2).map((r) => r.gameId));
		}
		expect(seen).toEqual([[3n, 4n], [5n, 6n], [7n, 8n], [9n, 10n], [11n]]);
		// Two turns read the two pages they name, wrapping; two turns naming one page read it once.
		const chain = fakeChainOf(games, 1);
		const three = readOpenGames(chain, GAMES, { index: 0, count: 1 }, [4, 5], 2);
		expect([three.reads, three.pages, chain.calls.map((c) => c.args)]).toEqual([3, { own: 6, read: 3 }, [[0n, 2n], [10n, 2n], [2n, 2n]]]);
		const same = readOpenGames(fakeChainOf(games, 1), GAMES, { index: 0, count: 1 }, [7, 2], 2);
		expect([same.reads, same.pages, same.rows.slice(2).map((r) => r.gameId)]).toEqual([2, { own: 6, read: 2 }, [7n, 8n]]);
		expect(() => readOpenGames(fakeChainOf(games, 1), GAMES, { index: 0, count: 1 }, [], 2)).toThrow();
		expect(() => readOpenGames(fakeChainOf(games, 1), GAMES, { index: 3, count: 3 }, [0], 2)).toThrow();
	});

	test("the identity, the readings and the reporters: one read each, lowercase addresses, the last vote per seat", () => {
		const a = chainOf("nba final, read after the game");
		const c: ChainGame = { ...a, status: "disputed", dispute: { at: a.start! + 7_200, records: [RECORD_A, RECORD_B] } };
		const chain = fakeChainOf([c], 1, { reporters: { [c.id]: [REPORTER, RETIRED] } });
		expect(readIdentity(chain, GAMES, 42n)).toEqual({ league: a.league, home: a.home, away: a.away, date: a.date, hints: a.hints });
		// The votes come one per seat that voted, in the games set's order (the fake lists the last first); seat 3 never voted.
		expect(readReadings(chain, GAMES, 42n)).toEqual({ startReadings: a.startReadings!, votes: [RECORD_B[3], RECORD_B[1], RECORD_B[0]], disputedAt: a.start! + 7_200 });
		expect(recordOfVotes([RECORD_B[3], RECORD_B[1], RECORD_B[0]])).toEqual(lastRecorded([RECORD_A, RECORD_B], SEATS4));
		expect(recordOfVotes([])).toEqual(SEATS4.map((seat) => ({ seat, kind: 0, homeScore: 0, awayScore: 0 })));
		expect(readReporters(chain, GAMES, 42n)).toEqual([REPORTER, RETIRED]);
		expect(chain.names()).toEqual(["getGameIdentity", "getGameReadings", "getGameReporters"]);
	});

	test("a game before any report is the creation event's identity and terms, unverified", () => {
		const a = chainOf("nba final, read after the game");
		const creation = { ...creationOf(a), league: "nhl", home: "H", away: "A", date: 123, hints: [{ seat: 3, id: "x" }], terms: { window: 100, day7Clock: 200, day30Clock: 300, fee: 0n } };
		expect(gameOfCreation(creation)).toEqual({ id: a.id, league: "nhl", home: "H", away: "A", date: 123, hints: [{ seat: 3, id: "x" }], n: 100, day7: 200, status: "unverified", start: null, startReadings: null, dispute: null });
	});

	test("a verified game from state: its start and the start report's kinds as readings, no dispute", () => {
		const a = chainOf("nba final, read after the game");
		const chain = fakeChain(a, 1);
		const game = gameOfState(rowOf(a), readIdentity(chain, GAMES, 42n), readReadings(chain, GAMES, 42n));
		const { payoutRefused: _, ...expected } = a;
		expect(game).toEqual(expected);
	});

	test("a disputed game from state: one record of each seat's last vote, with the clock the record set", () => {
		const a = chainOf("nba final, read after the game");
		const c: ChainGame = { ...a, status: "disputed", dispute: { at: a.start! + 7_200, records: [RECORD_A, RECORD_B] } };
		const chain = fakeChain(c, 1);
		const game = gameOfState(rowOf(c), readIdentity(chain, GAMES, 42n), readReadings(chain, GAMES, 42n));
		expect(game.status).toBe("disputed");
		expect(game.dispute).toEqual({ at: a.start! + 7_200, records: [lastRecorded([RECORD_A, RECORD_B], SEATS4)] });
		expect(game.startReadings).toEqual(a.startReadings);
	});

	test("a game that has ended, or is not yet verified, is read no further than its status", () => {
		const a = chainOf("nba final, read after the game");
		for (const status of ["scored", "voided", "released", "unverified"] as const) {
			const g: ChainGame = { ...a, status, start: status === "unverified" ? null : a.start };
			const chain = fakeChain(g, 1);
			const game = gameOfState(rowOf(g), readIdentity(chain, GAMES, 42n), readReadings(chain, GAMES, 42n));
			expect([game.status, game.start, game.startReadings, game.dispute]).toEqual([status, null, null, null]);
		}
	});

	test("a status or a reading kind the games set does not have is refused", () => {
		const bad = (word: string): Evm => ({
			call: () => `0x${"20".padStart(64, "0")}${"1".padStart(64, "0")}${word.padStart(64, "0")}`,
			latest: () => ({ number: 1n, timestamp: 1 }),
		});
		expect(() => readOpenGames(bad("7"), GAMES)).toThrow();
		const chain = fakeChain(chainOf("nba final"), 1);
		expect(() => readReadings({ ...chain, call: () => chain.call(GAMES, "0x") }, GAMES, 42n)).toThrow();
	});
});
