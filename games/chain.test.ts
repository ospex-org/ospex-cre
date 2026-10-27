// The chain reads: what the wrapper asks the games set for, from state, and what it builds from the
// answers. The open list is a page per read and carries what the tick decides on; a game's identity,
// its readings and its reporters are one read each, asked for the one game a full read is about; a
// game before any report is the creation event's, and a game that has ended is read no further than
// its status. Nothing is read from a log past the trigger's own.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import { lastRecorded } from "../scoring/src/rule";
import { chainOf } from "../scoring/test/rule-helpers";
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
		hints: g.hints,
	};
}

describe("the chain reads, from state", () => {
	test("the open list: every game not ended, a page per read, with its clocks, its league and its hints", () => {
		const a = chainOf("nba final, read after the game");
		const b: ChainGame = { ...chainOf("nfl not final"), id: "7", status: "unverified", start: null, startReadings: null, dispute: null };
		const c: ChainGame = { ...a, id: "9", status: "disputed", dispute: { at: a.start! + 7_200, records: [RECORD_A] } };
		const ended: ChainGame = { ...a, id: "11", status: "scored" };
		const chain = fakeChainOf([a, b, c, ended], 1);
		const { rows, reads } = readOpenGames(chain, GAMES, 2);
		expect(reads).toBe(2);
		expect(rows.map((r) => [r.gameId, r.status, r.start, r.disputedAt])).toEqual([
			[7n, "unverified", null, null],
			[9n, "disputed", a.start, a.start! + 7_200],
			[42n, "verified", a.start, null],
		]);
		expect(rows[2]).toEqual({ gameId: 42n, status: "verified", start: a.start, window: a.n, day7Clock: a.day7, disputedAt: null, league: a.league, hints: a.hints });
		expect(chain.names()).toEqual(["getOpenGames", "getOpenGames"]);
		expect(chain.calls.map((c) => c.args)).toEqual([[0n, 2n], [2n, 2n]]);
	});

	test("an empty open list is one read, and a list that fits a page is one read", () => {
		expect(readOpenGames(fakeChainOf([], 1), GAMES)).toEqual({ rows: [], reads: 1 });
		const a = chainOf("nba final, read after the game");
		expect(readOpenGames(fakeChainOf([a], 1), GAMES).reads).toBe(1);
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
