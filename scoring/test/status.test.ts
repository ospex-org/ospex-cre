// Each seat's status, mapped to final or not final. Postponed and cancelled are recorded and
// decide nothing: they never make a final.

import { describe, expect, test } from "bun:test";
import { toRecord as seat1 } from "../src/readers/seat1";
import { toRecord as seat2 } from "../src/readers/seat2";
import { toRecord as seat4 } from "../src/readers/seat4";
import { CASES, NOW } from "./cases";
import { copy, readSaved, type Derive } from "./fixtures";

const byName = (prefix: string) => CASES.find((c) => c.name.startsWith(prefix))!;
const lakers = byName("nba final");
const bears = byName("nfl not final");

describe("seat 1: the nine-state status_state decides where present", () => {
	const states: [string, string][] = [
		["final", "final"],
		["postponed", "postponed"],
		["canceled", "canceled"],
		["scheduled", "not_final"],
		["in_progress", "not_final"],
		["delayed", "not_final"],
		["suspended", "not_final"],
		["abandoned", "not_final"],
		["unknown", "not_final"],
		["cancelled", "not_final"], // not one of the nine: not final
		["FINAL", "not_final"],
	];
	test("each state, over a real record whose older field says Final", () => {
		const derive = (state: string): Derive => (seat, _p, body) => {
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) if (g.id === 21717859) g.status_state = state;
			return b;
		};
		for (const [state, want] of states) {
			const r = readSaved(1, lakers.game, NOW, derive(state)).reading;
			const kind = want === "final" ? "final" : "no_final";
			const recorded = want === "postponed" || want === "canceled" ? want : null;
			expect({ state, kind: r.kind, recorded: r.recorded }).toEqual({ state, kind, recorded });
		}
	});

	test("where a record lacks it, the league's older field decides, and only its own final word makes a final", () => {
		const drop: Derive = (seat, _p, body) => {
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) delete g.status_state;
			return b;
		};
		// Real records, status_state removed: the older field's final word still reads final.
		expect(readSaved(1, lakers.game, NOW, drop).reading).toMatchObject({ kind: "final", home: 127, away: 105, detail: "final" });
		const sf = byName("nfl final").game;
		expect(readSaved(1, sf, NOW, drop).reading).toMatchObject({ kind: "final", home: 23, away: 17 });
		const rays = byName("mlb final: Cleveland at Tampa").game;
		expect(readSaved(1, rays, NOW, drop).reading).toMatchObject({ kind: "final", home: 7, away: 3 });
		const rainout = byName("mlb postponed").game;
		expect(readSaved(1, rainout, NOW, drop).reading).toMatchObject({ kind: "no_final", recorded: "postponed" });
		expect(readSaved(1, bears.game, NOW, drop).reading).toMatchObject({ kind: "no_final", detail: "no status_state; 10/22 - 8:15 PM EDT" });
	});

	test("the fallback, league by league, on the seat's documented records (hockey and college wait on the paid tier)", () => {
		// Hockey, from the seat's documentation: game_state OFF is its final word.
		const nhl = { id: 7, start_time_utc: "2024-10-09T23:30:00.000Z", home_team: { full_name: "Pittsburgh Penguins" }, away_team: { full_name: "New York Rangers" }, home_score: 0, away_score: 6, game_state: "OFF" };
		expect(seat1("nhl", nhl)?.state).toBe("final");
		expect(seat1("nhl", { ...nhl, game_state: "LIVE" })?.state).toBe("not_final");
		// College football, the documented record with no status_state ("pre"): not final.
		const pre = { id: 47672, date: "2025-10-11T20:00:00.000Z", status: "pre", home_team: { full_name: "Temple Owls" }, visitor_team: { full_name: "Navy Midshipmen" }, home_score: 0, away_score: 0 };
		expect(seat1("ncaaf", pre)).toMatchObject({ state: "not_final", status: "no status_state; pre" });
		// College's older field says "post" for a final, a postponed and a cancelled game alike, so
		// without status_state even "post" is not final.
		expect(seat1("ncaaf", { ...pre, status: "post", home_score: 31, away_score: 14 })?.state).toBe("not_final");
		expect(seat1("ncaab", { ...pre, status: "post", home_team: { full_name: "Maryland Terrapins" }, visitor_team: { full_name: "Michigan Wolverines" } })?.state).toBe("not_final");
		// With status_state present, college reads like every league.
		expect(seat1("ncaab", { ...pre, status: "post", status_state: "final" })?.state).toBe("final");
	});
});

describe("seat 2: final is final; canceled and postponed are recorded", () => {
	test("each status", () => {
		const base = { gameId: 1, schedule: { date: "2026-10-22T02:00:00.000Z", tbaTime: false }, teams: { home: { team: "a" }, away: { team: "b" } }, scoreboard: { score: { home: 1, away: 0 } } };
		for (const [status, state] of [
			["final", "final"],
			["canceled", "canceled"],
			["postponed", "postponed"],
			["scheduled", "not_final"],
			["in progress", "not_final"],
			["delayed", "not_final"],
			["suspended", "not_final"],
			["Final", "not_final"],
			["", "not_final"],
		]) {
			expect({ status, state: seat2({ ...base, status })?.state }).toEqual({ status, state });
		}
	});

	test("the real rainout reads cancelled at its own time, and the real makeup final", () => {
		expect(readSaved(2, byName("mlb postponed").game, NOW).reading).toMatchObject({ kind: "no_final", recorded: "canceled" });
		expect(readSaved(2, byName("mlb final: the makeup").game, NOW).reading).toMatchObject({ kind: "final", home: 0, away: 2 });
	});
});

describe("seat 3: final only when Final is true and FinalType is Finished", () => {
	// Derived from the real answers: the Bears' game, still on the board, given each result.
	const withResult = (fields: Record<string, unknown>): Derive => (seat, path, body) => {
		if (seat !== 3 || !path.startsWith("/results/")) return body;
		const b = copy(body) as Record<string, unknown>[];
		const row = b.find((r) => r.ID === bears.expect[3]!.id && r.OddType === "Game")!;
		Object.assign(row, fields);
		return b;
	};
	const cases: [Record<string, unknown>, string, string | null][] = [
		[{ Final: true, FinalType: "Finished", HomeScore: "24", AwayScore: "20" }, "final", null],
		[{ Final: "true", FinalType: "Finished", HomeScore: "24", AwayScore: "20" }, "final", null],
		[{ Final: "True", FinalType: "Finished", HomeScore: "24", AwayScore: "20" }, "final", null],
		[{ Final: true, FinalType: "Postponed", HomeScore: null, AwayScore: null }, "no_final", "postponed"],
		[{ Final: true, FinalType: "Canceled", HomeScore: "0", AwayScore: "0" }, "no_final", "canceled"],
		[{ Final: true, FinalType: "Abandoned", HomeScore: "10", AwayScore: "7" }, "no_final", null],
		[{ Final: false, FinalType: "Finished", HomeScore: "24", AwayScore: "20" }, "no_final", null],
		[{ Final: "false", FinalType: "Finished", HomeScore: "24", AwayScore: "20" }, "no_final", null],
		[{ Final: true, FinalType: "NotFinished", HomeScore: "24", AwayScore: "20" }, "no_final", null],
	];
	test("each combination", () => {
		for (const [fields, kind, recorded] of cases) {
			const r = readSaved(3, bears.game, NOW, withResult(fields)).reading;
			expect({ fields, kind: r.kind, recorded: r.recorded }).toEqual({ fields, kind, recorded });
			if (kind === "final") expect([r.home, r.away]).toEqual([24, 20]);
		}
	});

	test("a final whose points do not read is silent", () => {
		for (const pts of [{ HomeScore: null, AwayScore: "20" }, { HomeScore: "null", AwayScore: "20" }, { HomeScore: "-2", AwayScore: "20" }, { HomeScore: "", AwayScore: "20" }]) {
			const r = readSaved(3, bears.game, NOW, withResult({ Final: true, FinalType: "Finished", ...pts })).reading;
			expect({ pts, kind: r.kind, detail: r.detail }).toEqual({ pts, kind: "silent", detail: "final without points" });
		}
	});
});

describe("seat 4: completed is final; it records no postponed or cancelled state", () => {
	test("each value", () => {
		const base = { id: "x", commence_time: "2026-10-22T02:00:00Z", home_team: "a", away_team: "b", scores: [{ name: "a", score: "1" }, { name: "b", score: "0" }] };
		for (const [completed, state] of [
			[true, "final"],
			[false, "not_final"],
			["true", "not_final"],
			[null, "not_final"],
			[undefined, "not_final"],
		] as const) {
			expect({ completed, state: seat4({ ...base, completed })?.state }).toEqual({ completed, state });
		}
	});

	test("points: a team takes exactly the one entry under its own name", () => {
		const base = { id: "x", commence_time: "2026-10-22T02:00:00Z", home_team: "a", away_team: "b", completed: true };
		expect(seat4({ ...base, scores: [{ name: "b", score: "3" }, { name: "a", score: "5" }] })?.teams.map((t) => t.points)).toEqual([5, 3]);
		expect(seat4({ ...base, scores: [{ name: "a", score: "5" }, { name: "a", score: "6" }, { name: "b", score: "3" }] })?.teams.map((t) => t.points)).toEqual([null, 3]);
		expect(seat4({ ...base, scores: null })?.teams.map((t) => t.points)).toEqual([null, null]);
		expect(seat4({ ...base, scores: [] })?.teams.map((t) => t.points)).toEqual([null, null]);
	});
});
