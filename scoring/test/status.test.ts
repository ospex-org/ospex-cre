// Each seat's status, mapped. Postponed and cancelled, in the feed's own words, ride on the reading's
// `recorded`, and after n a void may rest on two of them (rule.ts); they never make a final. Scheduled
// and the words each feed names for a game short of a final are an answer, never a void's vote; a word
// the reader does not know is silent, kept verbatim on the reading; no word is no status, which
// reads silent.

import { describe, expect, test } from "bun:test";
import { resolveFeedTeam } from "../src/pick";
import { toRecord as seat1 } from "../src/readers/seat1";
import { toRecord as seat2 } from "../src/readers/seat2";
import { toRecord as seat4 } from "../src/readers/seat4";
import { CASES, MID, NOW } from "./cases";
import { at as at2, copy, readSaved, type Derive } from "./fixtures";

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
		["unknown", "no_status"],
		["cancelled", "unrecognized"], // not one of the nine: a word the reader does not know, kept verbatim
		["FINAL", "unrecognized"],
	];
	test("each state, over a real record whose older field says Final", () => {
		const derive = (state: string): Derive => (seat, _p, body) => {
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) if (g.id === 21717859) g.status_state = state;
			return b;
		};
		for (const [state, want] of states) {
			const r = readSaved(1, lakers.game, NOW, derive(state)).reading;
			// A final is a final; postponed and canceled ride on `recorded`; the five other words the feed
			// names are an answer that carries none; no status is silence, and so is a word the reader does
			// not know, the word verbatim on the reading.
			const kind = want === "final" ? "final" : want === "no_status" || want === "unrecognized" ? "silent" : "no_final";
			const recorded = want === "postponed" || want === "canceled" ? want : null;
			const detail = want === "unrecognized" ? `unrecognized status ${JSON.stringify(state)}` : r.detail;
			expect({ state, kind: r.kind, recorded: r.recorded, detail: r.detail }).toEqual({ state, kind, recorded, detail });
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
		// The older field's word for a game not yet played is one the reader does not know: silent, verbatim.
		expect(readSaved(1, bears.game, NOW, drop).reading).toMatchObject({ kind: "silent", detail: 'unrecognized status "10/22 - 8:15 PM EDT"' });
	});

	test("the feed's postponed flag, as a boolean and as the word: either is postponed, beside a status that says Final", () => {
		// A real record with status_state removed, its older field saying Final and period 4: postponed by
		// the flag alone, written true or "true"; "false" and false are not postponed, and the final stands.
		const flagged = (postponed: unknown): Derive => (seat, _p, body) => {
			if (seat !== 1) return body;
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) if (g.id === 21717859) Object.assign(g, { status_state: undefined, status: "Final", period: 4, postponed });
			return b;
		};
		for (const postponed of [true, "true", "True"]) {
			const r = readSaved(1, lakers.game, NOW, flagged(postponed)).reading;
			expect({ postponed, kind: r.kind, recorded: r.recorded }).toEqual({ postponed, kind: "no_final", recorded: "postponed" });
		}
		for (const postponed of [false, "false", null, undefined]) {
			const r = readSaved(1, lakers.game, NOW, flagged(postponed)).reading;
			expect({ postponed, kind: r.kind, home: r.home, away: r.away }).toEqual({ postponed, kind: "final", home: 127, away: 105 });
		}
	});

	test("the fallback in hockey and college, on the seat's real records", () => {
		const drop: Derive = (seat, _p, body) => {
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) delete g.status_state;
			return b;
		};
		// Hockey: game_state OFF is its final word.
		const bruins = byName("nhl final, read the next afternoon");
		expect(readSaved(1, bruins.game, bruins.now, drop).reading).toMatchObject({ kind: "final", home: 6, away: 0 });
		const live: Derive = (seat, p, body) => {
			const b = drop(seat, p, body) as { data: Record<string, unknown>[] };
			for (const g of b.data) g.game_state = "LIVE";
			return b;
		};
		expect(readSaved(1, bruins.game, bruins.now, live).reading).toMatchObject({ kind: "silent", detail: 'unrecognized status "LIVE"' });
		// College's older field says "post" for a final, a postponed and a cancelled game alike, so
		// without status_state even "post" is not final: a word the reader does not know, verbatim.
		for (const prefix of ["ncaaf final, read the next afternoon", "ncaab final, read with seat 1"]) {
			const c = byName(prefix);
			expect({ prefix, ...readSaved(1, c.game, c.now, drop).reading }).toMatchObject({ prefix, kind: "silent", detail: 'unrecognized status "post"' });
			// The control: with status_state present, college reads like every league.
			expect({ prefix, kind: readSaved(1, c.game, c.now).reading.kind }).toEqual({ prefix, kind: "final" });
		}
	});

	test("the older field's final word with any overtimes it names", () => {
		const drop = (status: string): Derive => (seat, _p, body) => {
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) {
				delete g.status_state;
				g.status = status;
			}
			return b;
		};
		const sf = byName("nfl final").game;
		for (const word of ["Final", "Final/OT", "Final/2OT", "Final/3OT"]) {
			expect({ word, ...readSaved(1, lakers.game, NOW, drop(word)).reading }).toMatchObject({ word, kind: "final", home: 127, away: 105 });
			expect({ word, ...readSaved(1, sf, NOW, drop(word)).reading }).toMatchObject({ word, kind: "final", home: 23, away: 17 });
		}
		for (const word of ["Final/", "Final/OTT", "final", "Final OT", "Final/2", "Final/5"]) {
			expect({ word, ...readSaved(1, lakers.game, NOW, drop(word)).reading }).toMatchObject({ word, kind: "silent", detail: `unrecognized status ${JSON.stringify(word)}` });
		}
	});

	test("a final short of the feed's own count of a whole game reads silent, league by league", () => {
		// Real finals, each changed only in the one field that counts the game's parts.
		const set = (id: number, fields: Record<string, unknown>): Derive => (seat, _p, body) => {
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) if (g.id === id) Object.assign(g, fields);
			return b;
		};
		const rows: [string, number, Record<string, unknown>, string][] = [
			["nba final", 21717859, { period: 3 }, "final; period 3 of 4"],
			["nhl final, read the next afternoon", 3328202, { period: 2 }, "final; period 2 of 3"],
			["ncaab final, read with seat 1", 2798585, { period: 1 }, "final; period 1 of 2"],
			["mlb final: Cleveland at Tampa", 15467429, { period: 8 }, "final; period 8 of 9"],
			["nba final", 21717859, { period: null }, "final; no period count"],
			["nfl final", 1392308, { home_team_q4: null }, "final; not every quarter scored"],
			["ncaaf final, read the next afternoon", 458424, { away_score_q3: null }, "final; not every quarter scored"],
		];
		for (const [prefix, id, fields, detail] of rows) {
			const c = byName(prefix);
			expect({ prefix, ...readSaved(1, c.game, c.now, set(id, fields)).reading }).toMatchObject({ prefix, kind: "silent", detail });
			// The control: the record as saved is final.
			expect({ prefix, kind: readSaved(1, c.game, c.now).reading.kind }).toEqual({ prefix, kind: "final" });
		}
		// Five innings, the runs set apart from the line score: still not final at five.
		const marlins = byName("mlb final: Arizona at Miami");
		const five = set(5058793, { period: 5, home_team_data: { runs: 9, inning_scores: [0, 1, 0, 1, 0] }, away_team_data: { runs: 1, inning_scores: [0, 0, 0, 0, 0] } });
		expect(readSaved(1, marlins.game, marlins.now, five).reading).toMatchObject({ kind: "silent", detail: "final; period 5 of 9" });
		// Extra innings and overtime count as a whole game: the real 10-inning and overtime finals read.
		expect(readSaved(1, byName("ncaab final, read with seat 1").game, MID).reading).toMatchObject({ kind: "final", home: 89, away: 84 });
	});

	test("a team is named by its full name and school, never its city", () => {
		// A real college football final, with a city given that is another school's name.
		const app = byName("ncaaf final, read the next afternoon");
		const city: Derive = (seat, _p, body) => {
			const b = copy(body) as { data: Record<string, Record<string, unknown>>[] };
			for (const g of b.data) {
				if (g.id as unknown as number !== 458424) continue;
				g.home_team.city = "Columbia";
				g.visitor_team.city = "Harrisonburg";
			}
			return b;
		};
		expect(readSaved(1, app.game, app.now, city).reading).toMatchObject({ kind: "final", home: 34, away: 31 });
		// The record's names: full name and school, nothing else.
		const g = { id: 1, date: "2026-10-22T23:00:00.000Z", status_state: "scheduled", home_team: { full_name: "Missouri Tigers", college: "Missouri", city: "Columbia" }, visitor_team: { full_name: "Alabama Crimson Tide", college: "Alabama", city: "Tuscaloosa" } };
		expect(seat1("ncaaf", g)!.teams.map((t) => t.names)).toEqual([["Missouri Tigers", "Missouri"], ["Alabama Crimson Tide", "Alabama"]]);
	});

	test("a team's names must all mean the one team: one the program can't resolve leaves it unresolved", () => {
		const team = (names: string[]) => resolveFeedTeam("ncaaf", { names, points: null });
		expect(team(["Miami (OH) RedHawks", "Miami (OH)"])).toBe("miami-oh-redhawks");
		expect(team(["Miami"])).toBe("miami-hurricanes"); // seat 1's own list: Miami alone is Florida's
		expect(team(["Miami (OH) RedHawks", "Miami"])).toBeNull(); // two schools
		expect(team(["Miami Hurricanes", "Miami Univ."])).toBeNull(); // one name no list carries
		expect(team([])).toBeNull();
	});
});

describe("seat 2: final is final once its period count shows a whole game; canceled and postponed are recorded", () => {
	test("each status", () => {
		const base = { gameId: 1, schedule: { date: "2026-10-22T02:00:00.000Z", tbaTime: false }, teams: { home: { team: "a" }, away: { team: "b" } }, scoreboard: { currentPeriod: 4, score: { home: 1, away: 0 } } };
		for (const [status, state] of [
			["final", "final"],
			["canceled", "canceled"],
			["postponed", "postponed"],
			["scheduled", "not_final"],
			["in progress", "not_final"],
			["delayed", "not_final"],
			["suspended", "not_final"],
			["Final", "unrecognized"],
			["", "no_status"],
		]) {
			expect({ status, state: seat2("nba", { ...base, status })?.state }).toEqual({ status, state });
		}
	});

	test("a final short of the league's regulation periods is short, and reads silent", () => {
		const base = { gameId: 1, status: "final", schedule: { date: "2026-10-22T02:00:00.000Z", tbaTime: false }, teams: { home: { team: "a" }, away: { team: "b" } } };
		const at = (league: string, currentPeriod: unknown) => seat2(league, { ...base, scoreboard: { currentPeriod, score: { home: 1, away: 0 } } })!;
		for (const [league, least] of [["nfl", 4], ["nba", 4], ["nhl", 3], ["mlb", 9], ["ncaaf", 4], ["ncaab", 2]] as const) {
			expect({ league, state: at(league, least).state }).toEqual({ league, state: "final" });
			expect({ league, state: at(league, least + 1).state }).toEqual({ league, state: "final" }); // overtime, extra innings
			expect({ league, ...at(league, least - 1) }).toMatchObject({ league, state: "short", status: `final; period ${least - 1} of ${least}` });
		}
		expect(at("nba", null)).toMatchObject({ state: "short", status: "final; no period count" });
		expect(at("nba", "4")).toMatchObject({ state: "short", status: "final; no period count" });
		expect(at("wnba", 4)).toMatchObject({ state: "short", status: "final; league unknown" });
		// A real final cut to its first half: status final, period 1, the first half's points.
		const florida = byName("ncaab final: Santa Clara at Kentucky");
		const half: Derive = (seat, _p, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results: Record<string, Record<string, unknown>>[] };
			for (const g of b.results) {
				if ((g.gameId as unknown) !== 338857) continue;
				g.scoreboard = { currentPeriod: 1, score: { home: 60, away: 21, homePeriods: [60], awayPeriods: [21] } };
			}
			return b;
		};
		const game = { ...florida.game, home: "Florida", away: "Prairie View A&M", start: at2("2026-03-21T00:00:00Z") };
		expect(readSaved(2, game, NOW, half).reading).toMatchObject({ kind: "silent", detail: "final; period 1 of 2" });
		expect(readSaved(2, game, NOW).reading).toMatchObject({ kind: "final", home: 114, away: 55 });
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
		// A FinalType the reader does not know, or Finished under a final flag it does not know: silent, verbatim.
		[{ Final: true, FinalType: "Abandoned", HomeScore: "10", AwayScore: "7" }, "silent", null],
		[{ Final: false, FinalType: "Finished", HomeScore: "24", AwayScore: "20" }, "silent", null],
		[{ Final: "false", FinalType: "Finished", HomeScore: "24", AwayScore: "20" }, "silent", null],
		[{ Final: true, FinalType: "NotFinished", HomeScore: "24", AwayScore: "20" }, "no_final", null],
	];
	test("each combination", () => {
		for (const [fields, kind, recorded] of cases) {
			const r = readSaved(3, bears.game, NOW, withResult(fields)).reading;
			expect({ fields, kind: r.kind, recorded: r.recorded }).toEqual({ fields, kind, recorded });
			if (kind === "final") expect([r.home, r.away]).toEqual([24, 20]);
		}
		const words = (fields: Record<string, unknown>) => readSaved(3, bears.game, NOW, withResult(fields)).reading.detail;
		expect(words({ Final: true, FinalType: "Abandoned" })).toBe('unrecognized status "Abandoned"');
		expect(words({ Final: "TRUE", FinalType: "Finished", HomeScore: "24", AwayScore: "20" })).toBe('unrecognized final flag "TRUE"');
		expect(words({ Final: false, FinalType: "Finished", HomeScore: "24", AwayScore: "20" })).toBe("unrecognized final flag false");
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
			["true", "unrecognized"],
			[null, "no_status"],
			[undefined, "no_status"],
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

	test("points: the entry's name is compared the way team names are, so spacing and case don't hide it", () => {
		// The real Lakers final, its score entry's name given a trailing space, then another case.
		const spaced = (name: (s: string) => string): Derive => (seat, _p, body) => {
			if (seat !== 4) return body;
			return (copy(body) as Record<string, unknown>[]).map((e) =>
				e.id === "6fff70f4bf196dba25060a5775a03b54" ? { ...e, scores: (e.scores as Record<string, unknown>[]).map((s) => ({ ...s, name: name(s.name as string) })) } : e,
			);
		};
		for (const [what, f] of [["a trailing space", (s: string) => `${s} `], ["upper case", (s: string) => s.toUpperCase()]] as const) {
			expect({ what, ...readSaved(4, lakers.game, NOW, spaced(f)).reading }).toMatchObject({ what, kind: "final", home: 127, away: 105 });
		}
		// The control: an entry under another team's name is not this team's.
		expect(readSaved(4, lakers.game, NOW, spaced((s) => `${s} B`)).reading).toMatchObject({ kind: "silent", detail: "final without points" });
	});
});
