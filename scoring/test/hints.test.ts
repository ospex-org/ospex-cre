// The creation hints are hints, not locks: a hint that names the game is used, any other hint is
// dropped and the game is found by its teams, and a hint never pulls in a record outside the
// window or with other teams.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Game, Seat } from "../src/types";
import { CASES, NOW } from "./cases";
import { INDEX, ROOT, readSaved } from "./fixtures";

const byName = (prefix: string) => CASES.find((c) => c.name.startsWith(prefix))!;

function read(seat: Seat, game: Game) {
	const { reading, misses } = readSaved(seat, game, NOW);
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

		test(`seat ${seat}: no hint, and a hint naming the game, both read the game`, () => {
			expect(read(seat, marlins)).toEqual(final);
			expect(read(seat, hinted(ids[seat].game))).toEqual(final);
		});

		test(`seat ${seat}: a miss on a hint is not a miss on the game`, () => {
			expect(read(seat, hinted("does-not-exist"))).toEqual(final);
			expect(read(seat, hinted(""))).toEqual(final);
		});

		test(`seat ${seat}: a hint naming another pair of teams is dropped`, () => {
			expect(read(seat, hinted(ids[seat].otherTeams))).toEqual(final);
		});

		test(`seat ${seat}: a hint for another seat is not this seat's`, () => {
			expect(read(seat, hinted(ids[seat].dayBefore, seat === 1 ? 2 : 1))).toEqual(final);
		});

		test(`seat ${seat}: a hint naming the same teams' game outside the window reads no final, and nothing else is searched`, () => {
			// The search would find this game's final; the hint says the game is the day before's.
			expect(read(seat, hinted(ids[seat].dayBefore))).toEqual({
				kind: "no_final",
				home: null,
				away: null,
				detail: "outside window",
				id: ids[seat].dayBefore,
			});
		});
	}

	test("seat 4: a hint naming the game reads it", () => {
		const lakers = byName("nba final");
		const want = lakers.expect[4]!;
		expect(read(4, { ...lakers.game, hints: [{ seat: 4, id: want.id! }] })).toMatchObject({ kind: "final", id: want.id });
	});

	test("seat 3: a hint naming a finished result the board no longer lists is silent, never no final", () => {
		const entry = INDEX.find((e) => e.seat === 3 && e.path === "/results/NFL")!;
		const rows = JSON.parse(readFileSync(join(ROOT, entry.file), "utf8")) as Record<string, unknown>[];
		const finished = rows.find((r) => r.OddType === "Game" && r.FinalType === "Finished")!;
		const sf = byName("nfl final").game;
		expect(read(3, { ...sf, hints: [{ seat: 3, id: finished.ID as string }] })).toEqual({
			kind: "silent",
			home: null,
			away: null,
			detail: "hint has no teams or time",
			id: null,
		});
	});
});
