// The chain reads: what the wrapper asks the games set for, from state, and what it builds from the
// answers. The open list is a page per read and carries what the tick decides on, a shard reading its
// own pages, its first every tick and the page each count handed in names (placeNamed), each row with
// its place; a game's identity, its readings and its reporters are one read each, asked for the one
// game a full read is about; a game before any report is the creation event's, and a game that has
// ended is read no further than its status. Nothing is read from a log past the trigger's own. A page
// whose rows are shorter than the interface's is refused whole, naming the row.
//
// The break that turns the short row's test red (chain.ts, checkRows): the check dropped from `page`,
//   ->  // checkRows(data, offset);
// with which a row that omits the date word decodes, its date the league string's length.

import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, type AbiParameter } from "viem";
import type { ChainGame } from "../scoring/src/chain";
import { lastRecorded } from "../scoring/src/rule";
import { chainOf } from "../scoring/test/rule-helpers";
import INTERFACE from "./abi/IOspexGames.json";
import { gameOfCreation, gameOfState, pageOfPlace, placeNamed, placeOf, readIdentity, readOpenGames, readReadings, readReporters, recordOfVotes, type Evm, type OpenGame } from "./chain";
import { readCall } from "./lib";
import { GAMES, READINGS_ANSWER, REPORTER, RETIRED, creationOf, fakeChain, fakeChainOf } from "./test-helpers";

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
		// Pages of 2, three open games: two pages; count 1 names place 1, on the second page.
		const { rows, reads, total, pages } = readOpenGames(chain, GAMES, { index: 0, count: 1 }, [1], 2);
		expect([reads, total, pages]).toEqual([2, 3, { own: 2, read: 2 }]);
		expect(rows.map((r) => [r.gameId, r.status, r.start, r.disputedAt])).toEqual([
			[7n, "unverified", null, null],
			[9n, "disputed", a.start, a.start! + 7_200],
			[42n, "verified", a.start, null],
		]);
		// Each row's place on the shard's walk: row i of page m is place i x own + m.
		expect(rows[0]).toEqual({ gameId: 7n, status: "unverified", start: null, window: b.n, day7Clock: b.day7, disputedAt: null, league: b.league, date: b.date, place: 0 });
		expect(rows[2]).toEqual({ gameId: 42n, status: "verified", start: a.start, window: a.n, day7Clock: a.day7, disputedAt: null, league: a.league, date: a.date, place: 1 });
		expect(rows.map((r) => r.place)).toEqual([0, 2, 1]);
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
		expect(rows).toEqual([{ gameId: 77n, status: "verified", start: 1_700_000_000, window: 86_400, day7Clock: 604_800, disputedAt: 1_700_010_000, league: "nhl", date: 1_700_007_200, place: 0 }]);
	});

	test("a row shorter than the interface's eight words is refused, naming the row, and nothing is decoded", () => {
		// The interface's row with its date word omitted, encoded as a games set of seven words would encode
		// it: the decoder would read it, the date as the league string's length (3 for "nba").
		const getOpenGames = INTERFACE.abi.find((e) => e.type === "function" && e.name === "getOpenGames") as { outputs: readonly AbiParameter[] };
		const rowsOut = getOpenGames.outputs[0] as AbiParameter & { components: readonly AbiParameter[] };
		const short = { ...rowsOut, components: rowsOut.components.filter((c) => c.name !== "date") };
		const row = { gameId: 1n, status: 1, start: 0n, window: 86_400n, day7Clock: 604_800n, disputedAt: 0n, league: "nba" };
		const answer = encodeAbiParameters([short, getOpenGames.outputs[1]], [[row], 1n] as never);
		const evm: Evm = { call: () => answer, latest: () => ({ number: 1n, timestamp: 1 }) };
		expect(() => readOpenGames(evm, GAMES)).toThrow("row 0 of the page at 0 is shorter than the interface's eight words: its league begins at byte 224");
		// A page of two rows, the second short: named by its number.
		const whole = { gameId: 2n, status: 1, start: 0n, window: 86_400n, day7Clock: 604_800n, disputedAt: 0n, league: "nba", date: 1_700_000_000n };
		const mixed = encodeAbiParameters(getOpenGames.outputs, [[whole], 2n]);
		// Built by hand: the whole row's bytes, then the short row's, under one array of two.
		const body = (hex: `0x${string}`) => hex.slice(2);
		const wholeRow = body(encodeAbiParameters([rowsOut], [[whole]] as never)).slice(64 * 3); // past the array offset, its length and the row's offset
		const shortRow = body(encodeAbiParameters([short], [[row]] as never)).slice(64 * 3);
		const words = (n: bigint) => n.toString(16).padStart(64, "0");
		const two = `0x${words(64n)}${words(2n)}${words(2n)}${words(64n)}${words(BigInt(64 + wholeRow.length / 2))}${wholeRow}${shortRow}` as `0x${string}`;
		void mixed;
		expect(() => readOpenGames({ ...evm, call: () => two }, GAMES)).toThrow("row 1 of the page at 0 is shorter than the interface's eight words");
		// The control: the interface's own row decodes (the test above), and a page of no rows passes.
		expect(readOpenGames({ ...evm, call: () => encodeAbiParameters(getOpenGames.outputs, [[], 0n]) }, GAMES).rows).toEqual([]);
	});

	test("an empty open list is one read, and a list that fits a page is one read", () => {
		expect(readOpenGames(fakeChainOf([], 1), GAMES)).toEqual({ rows: [], reads: 1, total: 0, pages: { own: 0, read: 0 } });
		const a = chainOf("nba final, read after the game");
		expect(readOpenGames(fakeChainOf([a], 1), GAMES)).toMatchObject({ reads: 1, total: 1, pages: { own: 1, read: 1 } });
	});

	test("a shard reads its own pages only: its first every tick, and the page each count names on its walk, so every page is read over the counts", () => {
		const a = chainOf("nba final, read after the game");
		const games = Array.from({ length: 11 }, (_, i) => ({ ...a, id: String(i + 1) }));
		// Pages of 2: six pages (the last of one row). Shard 1 of 3 owns pages 1 and 4 (rows 3,4 and 9,10); shard 2 owns 2 and 5 (rows 5,6 and 11); shard 0 owns 0 and 3.
		// Count 1 names place 1, on each shard's second page; count 0 names place 0, on its first, which is read anyway.
		const one = readOpenGames(fakeChainOf(games, 1), GAMES, { index: 1, count: 3 }, [1], 2);
		expect([one.reads, one.total, one.pages, one.rows.map((r) => [r.gameId, r.place])]).toEqual([2, 11, { own: 2, read: 2 }, [[3n, 0], [4n, 2], [9n, 1], [10n, 3]]]);
		const two = readOpenGames(fakeChainOf(games, 1), GAMES, { index: 2, count: 3 }, [1], 2);
		expect([two.reads, two.pages, two.rows.map((r) => r.gameId)]).toEqual([2, { own: 2, read: 2 }, [5n, 6n, 11n]]);
		expect(readOpenGames(fakeChainOf(games, 1), GAMES, { index: 1, count: 3 }, [0], 2).pages).toEqual({ own: 2, read: 1 });
		// A shard past the list's pages: one read, nothing.
		const past = readOpenGames(fakeChainOf(games.slice(0, 2), 1), GAMES, { index: 2, count: 3 }, [0], 2);
		expect([past.reads, past.total, past.pages, past.rows]).toEqual([1, 2, { own: 0, read: 0 }, []]);
		// One shard owning six pages: count c names place c mod 12, on page c mod 6; counts 1 to 5 read pages 1 to 5, in order.
		const seen: bigint[][] = [];
		for (let count = 1; count <= 5; count++) {
			const chain = fakeChainOf(games, 1);
			const t = readOpenGames(chain, GAMES, { index: 0, count: 1 }, [count], 2);
			expect([t.reads, t.pages]).toEqual([2, { own: 6, read: 2 }]);
			expect(t.rows.slice(0, 2).map((r) => r.gameId)).toEqual([1n, 2n]);
			expect(chain.calls.map((c) => c.args)).toEqual([[0n, 2n], [BigInt(2 * count), 2n]]);
			seen.push(t.rows.slice(2).map((r) => r.gameId));
		}
		expect(seen).toEqual([[3n, 4n], [5n, 6n], [7n, 8n], [9n, 10n], [11n]]);
		// The walk: twelve places, page c mod 6, row floor(c / 6); counts 6 and 11 name the second rows of pages 0 and 5.
		expect([0, 1, 5, 6, 7, 11, 12, -1].map((c) => placeNamed(c, 6, 2))).toEqual([0, 1, 5, 6, 7, 11, 0, 11]);
		expect([pageOfPlace(7, 6), pageOfPlace(11, 6), placeOf(1, 1, 6), placeOf(5, 1, 6)]).toEqual([1, 5, 7, 11]);
		// Two counts read the two pages they name; two counts naming one page read it once; a count naming the first page adds no read.
		const chain = fakeChainOf(games, 1);
		const three = readOpenGames(chain, GAMES, { index: 0, count: 1 }, [4, 5], 2);
		expect([three.reads, three.pages, chain.calls.map((c) => c.args)]).toEqual([3, { own: 6, read: 3 }, [[0n, 2n], [8n, 2n], [10n, 2n]]]);
		const same = readOpenGames(fakeChainOf(games, 1), GAMES, { index: 0, count: 1 }, [7, 1], 2);
		expect([same.reads, same.pages, same.rows.slice(2).map((r) => r.gameId)]).toEqual([2, { own: 6, read: 2 }, [3n, 4n]]);
		expect(readOpenGames(fakeChainOf(games, 1), GAMES, { index: 0, count: 1 }, [6, 12], 2).pages).toEqual({ own: 6, read: 1 });
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
		// The fake answers the readings as the games set does, in its four fields: the end's readings last, empty for a game not ended.
		const answer = fakeChainOf([c], 1).call(GAMES, readCall("getGameReadings", [42n]));
		expect(answer).toBe(encodeAbiParameters(READINGS_ANSWER, [a.startReadings!, [RECORD_B[3], RECORD_B[1], RECORD_B[0]], BigInt(a.start! + 7_200), []]));
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
