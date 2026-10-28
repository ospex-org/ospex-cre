// For seats 1, 2 and 4 a creation hint only chooses among records that pass both of the reader's
// tests, the game's two teams and a time inside the window. A hinted record that passes both is
// read; one that fails either is never read. A hint the feed doesn't have, or one under another
// pair of teams, is dropped and the game is found by its teams. A hinted record of the two teams
// outside the window leaves the seat silent while anything inside the window could be the game, and
// otherwise changes nothing. Two different hints say nothing. Seat 3 is read by its hint, because
// its results carry no team names and no time: the match is the hint, and the last block here shows
// what that does and does not check.

import { describe, expect, test } from "bun:test";
import type { Game, Seat } from "../src/types";
import { inWindow, windowOf } from "../src/window";
import { CASES, NOW } from "./cases";
import { at, copy, readSaved, type Derive } from "./fixtures";

const byName = (prefix: string) => CASES.find((c) => c.name.startsWith(prefix))!;

function read(seat: Seat, game: Game, derive?: Derive) {
	const { reading, misses } = readSaved(seat, game, NOW, derive);
	expect(misses).toEqual([]);
	return { kind: reading.kind, home: reading.home, away: reading.away, detail: reading.detail, id: reading.record?.id ?? null };
}

describe("hints", () => {
	// Arizona at Miami, 17:10 UTC on 11 Jun, 2-0. The same two teams played at 22:40 UTC on 10 Jun
	// (8-0 Miami), and that game is in the same answers, before this game's window.
	const marlins = byName("mlb final: Arizona at Miami").game;
	const ids: Record<1 | 2, { game: string; dayBefore: string; otherTeams: string }> = {
		1: { game: "5058793", dayBefore: "5058783", otherTeams: "5058800" },
		2: { game: "337004", dayBefore: "337007", otherTeams: "336995" },
	};

	for (const seat of [1, 2] as const) {
		const final = { kind: "final", home: 2, away: 0, detail: "final", id: ids[seat].game };
		const hinted = (id: string, hintSeat: number = seat) => ({ ...marlins, hints: [{ seat: hintSeat, id }] });
		const list = seat === 1 ? "data" : "results";
		// This game's own record taken out, as a feed that moved it would.
		const moved: Derive = (s, _p, body) => {
			if (s !== seat) return body;
			const b = copy(body) as Record<string, Record<string, unknown>[]>;
			b[list] = b[list].filter((g) => String(seat === 1 ? g.id : g.gameId) !== ids[seat].game);
			return b;
		};

		test(`seat ${seat}: no hint, and a hint naming the game, both read the game`, () => {
			expect(read(seat, marlins)).toEqual(final);
			expect(read(seat, hinted(ids[seat].game))).toEqual(final);
		});

		test(`seat ${seat}: a miss on a hint is not a miss on the game`, () => {
			expect(read(seat, hinted("does-not-exist"))).toEqual(final);
			expect(read(seat, hinted(""))).toEqual(final);
		});

		test(`seat ${seat}: a hint naming another pair of teams is dropped, though its record is inside the window`, () => {
			// The other pair is Atlanta at the White Sox, rained out at 23:40 UTC on 11 Jun: inside this
			// game's window, so only the teams test can turn the hinted record away.
			const rainout = byName("mlb postponed").game;
			expect(inWindow(rainout.start, windowOf(marlins))).toBe(true);
			expect(read(seat, hinted(ids[seat].otherTeams))).toEqual(final);
		});

		test(`seat ${seat}: a hint for another seat is not this seat's`, () => {
			expect(read(seat, hinted(ids[seat].dayBefore, seat === 1 ? 2 : 1))).toEqual(final);
		});

		test(`seat ${seat}: a hint naming the same teams' game outside the window, with the game itself inside it: silent`, () => {
			// The hint says the game is the day before's; the answer has this game's final inside the
			// window. The two disagree, so the seat can't say which is the game.
			expect(read(seat, hinted(ids[seat].dayBefore))).toEqual({ kind: "silent", home: null, away: null, detail: "ambiguous", id: null });
			// The control: with nothing else of the two teams inside the window, the hint is dropped and
			// the seat reads as it does unhinted: no final, outside the window. Never the hinted 8-0.
			const unhinted = readSaved(seat, marlins, NOW, moved);
			const withHint = readSaved(seat, hinted(ids[seat].dayBefore), NOW, moved);
			expect([unhinted.misses, withHint.misses]).toEqual([[], []]);
			expect({ kind: unhinted.reading.kind, detail: unhinted.reading.detail, id: unhinted.reading.record?.id }).toEqual({ kind: "silent", detail: "outside window", id: ids[seat].dayBefore });
			expect(withHint.reading).toEqual(unhinted.reading);
		});

		test(`seat ${seat}: a hinted record outside the window decides nothing by itself`, () => {
			// This game's record taken out and the next date's answer emptied. Asked for the two teams, the
			// seat's answer then holds their other records, every one outside the window, and the seat says
			// so. A hint naming the day before's game changes nothing: the hinted record is outside the
			// window, nothing inside it could be the game, and the hint is dropped.
			const emptied: Derive = (s, path, body) => {
				const b = moved(s, path, body);
				if (s !== seat || !path.includes("2026-06-12")) return b;
				return seat === 1 ? { ...(b as Record<string, unknown>), data: [], meta: {} } : { ...(b as Record<string, unknown>), results: [] };
			};
			const unhinted = read(seat, marlins, emptied);
			expect(unhinted).toMatchObject({ kind: "silent", home: null, away: null, detail: "outside window" });
			expect(read(seat, hinted(ids[seat].dayBefore), emptied)).toEqual(unhinted);
		});
	}

	describe("seat 4", () => {
		// Golden State at the Lakers, 02:00 UTC on 22 Oct, 127-105. Seat 4's answer also holds the
		// Clippers and the Kings at 02:43 that night (inside this window), and these two teams' game of
		// 31 Oct (outside it).
		const lakers = byName("nba final").game;
		const final = { kind: "final", home: 127, away: 105, detail: "final", id: "6fff70f4bf196dba25060a5775a03b54" };
		const clippers = "f6be3e587d43c3821d8f059c3a1f1967";
		const october31 = "761c15cdefb5a94e34f234e11d6e57ad";
		const hinted = (id: string) => ({ ...lakers, hints: [{ seat: 4, id }] });

		test("a hint naming the game reads it", () => {
			expect(read(4, hinted(final.id))).toEqual(final);
		});

		test("a hint naming another pair's game inside the window is dropped", () => {
			expect(inWindow(at("2026-10-22T02:43:44Z"), windowOf(lakers))).toBe(true);
			expect(read(4, hinted(clippers))).toEqual(final);
		});

		test("a hint naming the two teams' game outside the window: silent beside the game, and otherwise no change", () => {
			expect(read(4, hinted(october31))).toEqual({ kind: "silent", home: null, away: null, detail: "ambiguous", id: null });
			const moved: Derive = (s, _p, body) => (s === 4 ? (copy(body) as Record<string, unknown>[]).filter((g) => g.id !== final.id) : body);
			const unhinted = read(4, lakers, moved);
			expect(unhinted).toEqual({ kind: "silent", home: null, away: null, detail: "outside window", id: october31 });
			expect(read(4, hinted(october31), moved)).toEqual(unhinted);
		});
	});

});

describe("seat 3 is read by its hint", () => {
	const sixers = byName("nba not final");
	const id = sixers.expect[3]!.id!;
	const withHints = (hints: { seat: number; id: string }[]) => ({ ...sixers.game, hints });
	const asked = (game: Game) => readSaved(3, game, NOW).asked.length;

	test("the hint is read: the game still to play reads no final under its id", () => {
		expect(read(3, sixers.game)).toEqual({ kind: "no_final", home: null, away: null, detail: "NotFinished", id });
		expect(read(3, withHints([{ seat: 3, id: id.toUpperCase() }]))).toMatchObject({ kind: "no_final", id });
	});

	test("no hint, two hints, or a hint that is not a seat 3 id: silent, and nothing is asked", () => {
		const cases: [string, { seat: number; id: string }[], string][] = [
			["none", [], "no hint"],
			["another seat's only", [{ seat: 2, id }], "no hint"],
			["two", [{ seat: 3, id }, { seat: 3, id: "00000000-0000-4000-8000-000000000000" }], "two hints"],
			["a path", [{ seat: 3, id: "../odds/NFL" }], "hint is not a seat 3 id"],
			["a query", [{ seat: 3, id: `${id}?x=1` }], "hint is not a seat 3 id"],
			["a short id", [{ seat: 3, id: id.slice(0, 35) }], "hint is not a seat 3 id"],
			["empty", [{ seat: 3, id: "" }], "hint is not a seat 3 id"],
		];
		for (const [what, hints, detail] of cases) {
			const game = withHints(hints);
			expect({ what, ...read(3, game), asked: asked(game) }).toEqual({ what, kind: "silent", home: null, away: null, detail, id: null, asked: 0 });
		}
		// The same id given twice is one hint.
		expect(read(3, withHints([{ seat: 3, id }, { seat: 3, id }]))).toMatchObject({ kind: "no_final", id });
	});

	test("an id the seat has no result for reads silent, never no final: an unknown id, and ids 78 to 156 days old", () => {
		// The seat answers [] for each, the same bytes for an id that never existed as for a game
		// from May. In the answers saved on 22 Oct a result about four days old still answers by id (next test);
		// these do not.
		for (const old of [
			"00000000-0000-4000-8000-000000000000",
			"038769a6-0023-45d9-a6af-0774268a2804", // 5 Aug
			"0a8828ee-719d-4fb5-9954-ffd73e40b70e", // 8 Jul
			"acc4e59b-999e-469b-9137-a2ed1b45aab2", // 11 Jun
			"35cf5493-fdea-4b54-932b-4efc3ef2eb15", // 19 May
		]) {
			expect({ old, ...read(3, withHints([{ seat: 3, id: old }])) }).toEqual({ old, kind: "silent", home: null, away: null, detail: "no result for the hint", id: null });
		}
	});

	test("seat 3 checks no teams: a hint naming another game reads that game, so verification must check the hint", () => {
		// A finished NFL result from the seat's five-day list, which names no teams: not Sunday
		// night's 23-13 nor Monday night's 23-17, so a Sunday afternoon game about four days old.
		// Read under the Lakers' game, the reading is that other game's 26-19.
		const lakers = byName("nba final").game;
		expect(read(3, { ...lakers, hints: [{ seat: 3, id: "2c0b5786-b4f2-48de-8178-567ea27c9dbd" }] })).toEqual({
			kind: "final",
			home: 26,
			away: 19,
			detail: "final",
			id: "2c0b5786-b4f2-48de-8178-567ea27c9dbd",
		});
	});
});
