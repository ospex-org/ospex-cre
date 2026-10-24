// Every seat reads every saved real game the way the case says, from the saved answers alone.

import { describe, expect, test } from "bun:test";
import { LEAGUES, readGameSync } from "../src/index";
import type { Seat } from "../src/types";
import { CASES, PENDING } from "./cases";
import { KEY, readSaved, saved } from "./fixtures";

const SEATS: Seat[] = [1, 2, 3, 4];

describe("each seat reads the real games", () => {
	for (const c of CASES) {
		for (const seat of SEATS) {
			const want = c.expect[seat];
			if (want === undefined) continue;
			test(`seat ${seat}: ${c.name}`, () => {
				const { reading, misses } = readSaved(seat, c.game, c.now);
				expect(misses).toEqual([]);
				expect({
					kind: reading.kind,
					home: reading.home,
					away: reading.away,
					recorded: reading.recorded,
					detail: reading.detail,
					id: reading.record?.id ?? null,
				}).toEqual(want);
				if (reading.kind === "final" && seat !== 3) {
					// At seats 1, 2 and 4 a final rests on a record inside the window. Seat 3's record
					// has no time (it is read by hint); never-window.test.ts pins that.
					expect(reading.record!.time >= c.game.start && reading.record!.time < c.game.start + c.game.n).toBe(true);
				}
			});
		}
	}

	test("the seats that answer a final agree on it, team by team", () => {
		for (const c of CASES) {
			const finals = SEATS.map((s) => c.expect[s]).filter((e) => e?.kind === "final");
			for (const f of finals) expect({ name: c.name, home: f!.home, away: f!.away }).toEqual({ name: c.name, home: finals[0]!.home, away: finals[0]!.away });
		}
	});

	test("reading a whole game asks every seat, and each answers as it does alone", () => {
		for (const c of CASES) {
			const keys = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
			const t = saved(undefined, c.now);
			const r = readGameSync(c.game, keys, c.now, (req) => {
				try {
					return t.send(req);
				} catch {
					return { status: 599, body: "" };
				}
			});
			expect(r.offered).toBe(true);
			expect(r.readings.map((x) => x.seat)).toEqual([1, 2, 3, 4]);
			for (const seat of SEATS) {
				const want = c.expect[seat];
				if (want !== undefined) expect({ name: c.name, seat, kind: r.readings[seat - 1].kind }).toEqual({ name: c.name, seat, kind: want.kind });
			}
		}
	});
});

describe("coverage: every seat, every league, a final and a game not final, or the written reason", () => {
	const leagues = Object.keys(LEAGUES);
	const has = (seat: Seat, league: string, test: (k: string, recorded: string | null) => boolean): boolean =>
		CASES.some((c) => c.game.league === league && c.expect[seat] !== undefined && test(c.expect[seat]!.kind, c.expect[seat]!.recorded));

	test("finals", () => {
		const gaps: string[] = [];
		for (const seat of SEATS) {
			for (const league of leagues) {
				const covered = has(seat, league, (k) => k === "final");
				const reason = PENDING[seat][league] ?? PENDING[seat].final;
				if (!covered && reason === undefined) gaps.push(`seat ${seat} ${league}`);
				if (covered && PENDING[seat][league] !== undefined) gaps.push(`seat ${seat} ${league} is covered but marked pending`);
			}
		}
		expect(gaps).toEqual([]);
	});

	test("games not final", () => {
		const gaps: string[] = [];
		for (const seat of SEATS) {
			for (const league of leagues) {
				const covered = has(seat, league, (k, recorded) => k === "no_final" && recorded === null);
				if (!covered && PENDING[seat][league] === undefined) gaps.push(`seat ${seat} ${league}`);
			}
		}
		expect(gaps).toEqual([]);
	});

	test("each recorded postponed or cancelled state", () => {
		const gaps: string[] = [];
		for (const seat of SEATS) {
			for (const state of ["postponed", "canceled"] as const) {
				const covered = CASES.some((c) => c.expect[seat]?.recorded === state);
				if (!covered && PENDING[seat][state] === undefined) gaps.push(`seat ${seat} ${state}`);
			}
		}
		expect(gaps).toEqual([]);
	});
});
