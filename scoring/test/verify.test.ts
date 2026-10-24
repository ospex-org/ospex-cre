// The start's rule (verify.ts). Seat 3's hint is checked against its board; a hint that fails makes
// seat 3 silent for the game and the spare stands in; the start is the earliest counting seat's
// scheduled time when the counting seats lie within an hour, and nothing is written when they lie
// further apart; the spare's time never sets it. Which record is the game, and the re-read as
// scoring will read it, are in identity.test.ts.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { readerFor } from "../src/index";
import { scoreGameSync } from "../src/program";
import { checkBoard, type BoardCheck } from "../src/readers/board3";
import { request } from "../src/readers/request";
import { runSync } from "../src/run";
import type { Game, HttpResponse, Reading, Seat } from "../src/types";
import { START_BOUND, START_SPREAD, decideStart } from "../src/verify";
import { LATE, NOW } from "./cases";
import { KEY, at, copy, locate, saved, type Derive } from "./fixtures";
import { PAYOUT, chainOf } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000", "");

function unverified(caseName: string, over: Partial<ChainGame> = {}): ChainGame {
	return { ...chainOf(caseName), status: "unverified", start: null, startReadings: null, ...over };
}

function verify(game: ChainGame, derive?: Derive, now = NOW) {
	const t = saved(derive, now);
	const o = scoreGameSync(game, KEYS, PAYOUT, now, t.send);
	// Every request was answered from the saved answers: no seat reads silent for want of a fixture.
	expect(t.misses).toEqual([]);
	return {
		action: o.decision.action,
		why: o.decision.why,
		start: o.decision.action === "start" ? iso(o.decision.start) : null,
		seats: o.decision.readings.map((r) => `${r.seat}:${r.kind === "silent" ? r.detail : r.record?.time ? iso(r.record.time) : r.kind}`),
		report: o.report === null ? null : { kind: o.report.kind, start: o.report.start, readings: o.report.readings.map((r) => [r.seat, r.kind]) },
		misses: t.misses,
	};
}

/** Derives seat 3's board for one league, changing the hint's row. */
const board = (league: string, id: string, change: (row: Record<string, unknown>) => Record<string, unknown> | null): Derive => (seat, path, body) => {
	if (seat !== 3 || path !== `/odds/${league}?oddType=Game`) return body;
	const rows = copy(body) as Record<string, unknown>[];
	return rows.flatMap((r) => (r.ID === id ? (change(r) === null ? [] : [change(r)]) : [r]));
};

const BEARS = "edcfd41f-1773-4bc9-a349-aa50931a0278";

describe("the start's rule, on the real saved answers", () => {
	test("New England at Chicago: seats 1, 2 and 3 list it at 00:15, so the start is 00:15, and the report carries the four readings", () => {
		const v = verify(unverified("nfl not final"));
		expect(v).toEqual({
			action: "start",
			why: "seats 1, 2 and 3 list the game within an hour",
			start: "2026-10-23T00:15:00Z",
			seats: ["1:2026-10-23T00:15:00Z", "2:2026-10-23T00:15:00Z", "3:2026-10-23T00:15:00Z", "4:2026-10-23T00:15:00Z"],
			report: { kind: 1, start: at("2026-10-23T00:15:00Z"), readings: [[1, 1], [2, 1], [3, 1], [4, 1]] },
			misses: [],
		});
	});

	test("Cleveland at Philadelphia: the same, at 23:00", () => {
		const v = verify(unverified("nba not final"));
		expect([v.action, v.start, v.report?.readings]).toEqual(["start", "2026-10-22T23:00:00Z", [[1, 1], [2, 1], [3, 1], [4, 1]]]);
	});

	test("Cleveland at Philadelphia, created without a seat 3 hint: seat 3 is silent for the game and the spare stands in", () => {
		const v = verify(unverified("nba not final", { hints: [] }));
		expect([v.action, v.why, v.start, v.seats[2], v.report?.readings]).toEqual([
			"start",
			"seats 1 and 2 list the game within an hour, and the spare stands in for seat 3",
			"2026-10-22T23:00:00Z",
			"3:silent for the game: no hint",
			[[1, 1], [2, 1], [3, 0], [4, 1]],
		]);
	});

	test("Golden State at the Lakers, read once the game is over: no start is written for a game already final", () => {
		const v = verify(unverified("nba final"));
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 1 shows the game final", null]);
	});

	test("Nashville at Boston: seat 1 refuses its key in that league, so the run decides nothing and asks nothing more", () => {
		const t = saved(undefined, NOW);
		const o = scoreGameSync(unverified("nhl not final"), KEYS, PAYOUT, NOW, t.send);
		expect([o.decision.action, o.decision.why, o.report]).toEqual(["wait", "seat 1's key was refused: http 401", null]);
		expect(t.asked.map((q) => locate(q)!.seat)).toEqual([1]);
	});

	test("with seat 3 counting, the spare silent stops nothing: it is read, and not needed", () => {
		const t = saved(undefined, NOW);
		const o = scoreGameSync(unverified("nfl not final"), KEYS, PAYOUT, NOW, (q) => (locate(q)?.seat === 4 ? { status: 503, body: "" } : t.send(q)));
		expect(t.misses).toEqual([]);
		expect([o.decision.action, o.decision.why, o.report?.readings.map((r) => [r.seat, r.kind])]).toEqual(["start", "seats 1, 2 and 3 list the game within an hour", [[1, 1], [2, 1], [3, 1], [4, 0]]]);
	});

	test("seat 2 silent, or not listing the game, writes nothing either; the spare never stands in for seats 1 or 2", () => {
		const t = saved(undefined, NOW);
		const o = scoreGameSync(unverified("nfl not final"), KEYS, PAYOUT, NOW, (q) => (locate(q)?.seat === 2 ? { status: 503, body: "" } : t.send(q)));
		expect([o.decision.action, o.decision.why, o.report]).toEqual(["wait", "seat 2 is silent: http 503", null]);
		// Seat 2 answers, but lists no game of the two teams: it answered, and it does not list the game.
		// An NBA game, so every date seat 2 asks still lists other games: a date that answers with
		// nothing at all leaves a seat silent, not "absent" (src/pick.ts), and NFL's off days do that.
		const sixers = unverified("nba not final");
		const names = new Set([sixers.home, sixers.away]);
		const unlisted: Derive = (s, p, b) => {
			if (s !== 2 || !p.startsWith("/games?league=NBA")) return b;
			const c = copy(b) as { results: Record<string, any>[] };
			return { ...c, results: c.results.filter((g) => !(names.has(g.teams?.home?.team) && names.has(g.teams?.away?.team))) };
		};
		const v = verify(sixers, unlisted);
		expect([v.action, v.why, v.seats[1]]).toEqual(["wait", "seat 2 does not list the game within a day of its date", "2:no_final"]);
	});
});

describe("seat 3's hint, checked against its board", () => {
	const flip = (r: Record<string, unknown>) => ({ ...r, HomeTeam: r.AwayTeam, AwayTeam: r.HomeTeam });
	const cases: [string, Derive, string][] = [
		["the hint's row lists the teams the other way round", board("NFL", BEARS, flip), "home and away the other way round"],
		["the hint's row is gone from the board", board("NFL", BEARS, () => null), "hint not on the board"],
		["the hint's row names two other teams", board("NFL", BEARS, (r) => ({ ...r, HomeTeam: "Detroit Lions", AwayTeam: "Green Bay Packers" })), "other teams"],
		["the hint's row has the home team right and another away team", board("NFL", BEARS, (r) => ({ ...r, AwayTeam: "Green Bay Packers" })), "other teams"],
		["the hint's row has the away team right and another home team", board("NFL", BEARS, (r) => ({ ...r, HomeTeam: "Detroit Lions" })), "other teams"],
		["the hint's row is listed twice", (s, p, b) => (s === 3 && p === "/odds/NFL?oddType=Game" ? [...(b as unknown[]), (b as Record<string, unknown>[]).find((r) => r.ID === BEARS)] : b), "hint listed twice on the board"],
		["the hint's row is more than an hour from seats 1 and 2", board("NFL", BEARS, (r) => ({ ...r, MatchTime: "2026-10-23T01:16:00" })), "board time not at the start"],
	];
	for (const [what, derive, why] of cases) {
		test(`${what}: seat 3 is silent for the game, never wrong, and the spare stands in`, () => {
			const v = verify(unverified("nfl not final"), derive);
			expect([v.action, v.start, v.seats[2], v.report?.readings]).toEqual(["start", "2026-10-23T00:15:00Z", `3:silent for the game: ${why}`, [[1, 1], [2, 1], [3, 0], [4, 1]]]);
		});
	}

	test("a team name the lists don't know fails the check: it is never read as the game", () => {
		const v = verify(unverified("nfl not final"), board("NFL", BEARS, (r) => ({ ...r, HomeTeam: "Chicago Bearz" })));
		expect([v.action, v.seats[2], v.report?.readings[2]]).toEqual(["start", "3:silent for the game: a team name the lists don't know", [3, 0]]);
	});

	test("the board check on its own: a game whose own teams the lists don't know is never bound to a row", () => {
		// In a run, seats 1 and 2 refuse such a game first; the check keeps its own guard all the same.
		const check = (home: string, away: string): BoardCheck => {
			const t = saved(undefined, NOW);
			const game: Game = { league: "nfl", home, away, start: at("2026-10-22T00:15:00Z"), n: 2 * 86_400 + 1, hints: [{ seat: 3, id: BEARS }] };
			const run = checkBoard({ game, now: NOW, key: KEY });
			let step = run.next(undefined as unknown as HttpResponse);
			while (!step.done) step = run.next(t.send(step.value));
			expect(t.misses).toEqual([]);
			return step.value;
		};
		expect(check("Chicago Bears", "New England Patriots")).toMatchObject({ kind: "listed" });
		expect(check("Chicago Bearz", "New England Patriots")).toEqual({ kind: "fails", why: "game teams unknown" });
		expect(check("Chicago Bears", "Chicago Bears")).toEqual({ kind: "fails", why: "game teams unknown" });
	});

	test("a board row that isn't readable makes the run wait; it never stands seat 3 down", () => {
		const nulled: Derive = (s, p, b) => (s === 3 && p === "/odds/NFL?oddType=Game" ? (b as Record<string, unknown>[]).map((r) => (r.ID === BEARS ? null : r)) : b);
		const v = verify(unverified("nfl not final"), nulled);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 3's board is silent: unreadable record", null]);
	});

	test("an id the board row doesn't give as text, or a hinted row whose teams or time can't be read, makes the run wait", () => {
		// The hinted row's own id, null or a number, could be the hint's: nothing is learned. So could
		// another row's, so any row's unreadable id waits, the hinted row's or not.
		const OTHER = "a row that is not the hint's";
		const anyRow = (change: (r: Record<string, unknown>) => Record<string, unknown>): Derive => (s, p, b) => {
			if (s !== 3 || p !== "/odds/NFL?oddType=Game") return b;
			const rows = copy(b) as Record<string, unknown>[];
			const i = rows.findIndex((r) => r.ID !== BEARS);
			rows[i] = change(rows[i]);
			return rows;
		};
		const forms: [string, Derive][] = [
			["the hinted row's id null", board("NFL", BEARS, (r) => ({ ...r, ID: null }))],
			["the hinted row's id a number", board("NFL", BEARS, (r) => ({ ...r, ID: 7 }))],
			["the hinted row's id empty", board("NFL", BEARS, (r) => ({ ...r, ID: " " }))],
			["the hinted row's id missing", board("NFL", BEARS, ({ ID: _, ...r }) => r)],
			[`${OTHER}: its id null`, anyRow((r) => ({ ...r, ID: null }))],
			["the hinted row's home team null", board("NFL", BEARS, (r) => ({ ...r, HomeTeam: null }))],
			["the hinted row's away team a number", board("NFL", BEARS, (r) => ({ ...r, AwayTeam: 12 }))],
			["the hinted row's time null", board("NFL", BEARS, (r) => ({ ...r, MatchTime: null }))],
			["the hinted row's time TBD", board("NFL", BEARS, (r) => ({ ...r, MatchTime: "TBD" }))],
			["the hinted row's time a number", board("NFL", BEARS, (r) => ({ ...r, MatchTime: 1792714500 }))],
		];
		for (const [what, derive] of forms) {
			const v = verify(unverified("nfl not final"), derive);
			expect({ what, got: [v.action, v.why, v.report] }).toEqual({ what, got: ["wait", "seat 3's board is silent: unreadable record", null] });
		}
		// The control: another row's time unreadable says nothing about the hint, and the hint still binds.
		const v = verify(unverified("nfl not final"), anyRow((r) => ({ ...r, MatchTime: "TBD" })));
		expect([v.action, v.start, v.report?.readings[2]]).toEqual(["start", "2026-10-23T00:15:00Z", [3, 1]]);
	});

	test("the two-stage case end to end: a malformed board row writes no start, and the normal start then disputes a dissenting seat 3", () => {
		// Stage 1, at 17:30 on 22 Oct: the hinted row's id null makes the run wait, with no start report.
		const malformed = verify(unverified("nfl not final"), board("NFL", BEARS, (r) => ({ ...r, ID: null })));
		expect([malformed.action, malformed.report]).toEqual(["wait", null]);
		// The board as saved writes the start, with seat 3 counting.
		const t = saved(undefined, NOW);
		const start = scoreGameSync(unverified("nfl not final"), KEYS, PAYOUT, NOW, t.send);
		expect([start.decision.action, start.report?.readings.map((r) => [r.seat, r.kind])]).toEqual(["start", [[1, 1], [2, 1], [3, 1], [4, 1]]]);
		// Stage 2, the same game read at 03:32 on 23 Oct with that start report and seat 3's result derived to 31-24.
		const seat3Dissents: Derive = (s, p, b) => (s === 3 && p === `/results/${BEARS}` ? (copy(b) as Record<string, unknown>[]).map((r) => ({ ...r, HomeScore: "31" })) : b);
		const game: ChainGame = { ...chainOf("nfl final, read after the game"), startReadings: start.report!.readings };
		const t2 = saved(seat3Dissents, LATE);
		const o = scoreGameSync(game, KEYS, PAYOUT, LATE, t2.send);
		expect(t2.misses).toEqual([]);
		expect([o.decision.action, o.decision.why, o.decision.readings.map((r) => (r.kind === "final" ? `${r.seat}:${r.home}-${r.away}` : `${r.seat}:${r.detail}`))]).toEqual([
			"dispute",
			"two finals differ",
			["1:30-24", "2:30-24", "3:31-24", "4:30-24"],
		]);
	});

	test("a hint the board doesn't list fails only once the board reaches the game's date; before that the run waits", () => {
		// The board as saved at 17:30 on 22 Oct lists NFL games from this one, at 00:15 on 23 Oct, to 3 Nov.
		// Derived: the hint's row gone and every row at or after the date gone with it, which leaves none,
		// so one game is added a second before the date. With or without one more at the date itself.
		const date = at("2026-10-23T00:15:00Z");
		const timeOf = (r: Record<string, unknown>) => at(`${String(r.MatchTime).trim()}Z`);
		const saved3 = (derive: Derive): Record<string, unknown>[] => JSON.parse(saved(derive, NOW).send(request(3, "/odds/NFL?oddType=Game", KEY)).body);
		const other = saved3((_s, _p, b) => b).find((r) => r.ID !== BEARS)!;
		const cut = (addAtDate: boolean): Derive => (s, p, b) => {
			if (s !== 3 || p !== "/odds/NFL?oddType=Game") return b;
			const rows = (copy(b) as Record<string, unknown>[]).filter((r) => r.ID !== BEARS && timeOf(r) < date);
			const before = { ...other, ID: "a game a second before the date", MatchTime: "2026-10-23T00:14:59" };
			// The game at the date goes first and the earlier one last: the board's latest game is found
			// wherever it sits, not read off its last row.
			return addAtDate ? [{ ...other, ID: "a game at the date", MatchTime: "2026-10-23T00:15:00" }, ...rows, before] : [...rows, before];
		};
		const latest = (derive: Derive) => Math.max(...saved3(derive).map(timeOf));
		// Short of the date by a second: the board doesn't reach it yet, and the run waits.
		expect(saved3(cut(false)).length).toBeGreaterThan(0);
		expect(latest(cut(false))).toBe(date - 1);
		const waits = verify(unverified("nfl not final"), cut(false));
		expect([waits.action, waits.why, waits.report]).toEqual(["wait", "seat 3's board is silent: the board doesn't reach the game's date yet", null]);
		// One game at the date itself: the board reaches it, and the hint fails.
		expect(latest(cut(true))).toBe(date);
		const fails = verify(unverified("nfl not final"), cut(true));
		expect([fails.action, fails.seats[2], fails.report?.readings[2]]).toEqual(["start", "3:silent for the game: hint not on the board", [3, 0]]);
		// And the saved board as it stands, which lists games well past the date.
		expect(latest(board("NFL", BEARS, () => null))).toBeGreaterThan(date + 7 * 86_400);
		const gone = verify(unverified("nfl not final"), board("NFL", BEARS, () => null));
		expect([gone.action, gone.seats[2]]).toEqual(["start", "3:silent for the game: hint not on the board"]);
	});

	test("the board's own ways of writing an id and a time still bind the hint", () => {
		const forms: [string, (r: Record<string, unknown>) => Record<string, unknown>, string][] = [
			["the id in capitals", (r) => ({ ...r, ID: BEARS.toUpperCase() }), "2026-10-23T00:15:00Z"],
			["a time with its zone", (r) => ({ ...r, MatchTime: "2026-10-22T20:15:00-04:00" }), "2026-10-23T00:15:00Z"],
			["a time with a trailing space", (r) => ({ ...r, MatchTime: "2026-10-23T00:10:00 " }), "2026-10-23T00:10:00Z"],
		];
		for (const [what, change, start] of forms) {
			const v = verify(unverified("nfl not final"), board("NFL", BEARS, change));
			expect({ what, got: [v.action, v.start, v.report?.readings[2]] }).toEqual({ what, got: ["start", start, [3, 1]] });
		}
	});

	test("the control: a board time within the hour passes, and an earlier one sets the start", () => {
		const v = verify(unverified("nfl not final"), board("NFL", BEARS, (r) => ({ ...r, MatchTime: "2026-10-23T00:05:00" })));
		expect([v.action, v.start, v.seats[2]]).toEqual(["start", "2026-10-23T00:05:00Z", "3:2026-10-23T00:05:00Z"]);
	});

	test("a board that could not be read this time teaches nothing about the hint: the run waits", () => {
		for (const [status, body, why] of [
			[503, "", "http 503"],
			[200, "<html>", "unreadable"],
			[200, "{}", "unreadable"],
		] as const) {
			const refuse: Derive = (s, p, b) => (s === 3 && p === "/odds/NFL?oddType=Game" ? (status === 200 ? (body === "{}" ? {} : "<html>") : b) : b);
			const game = unverified("nfl not final");
			const t = saved(refuse, NOW);
			const o = scoreGameSync(game, KEYS, PAYOUT, NOW, (req) => (status !== 200 && req.url.includes("/odds/") ? { status, body } : t.send(req)));
			expect([o.decision.action, o.decision.why]).toEqual(["wait", `seat 3's board is silent: ${why}`]);
		}
		// No seat 3 key: a run that cannot ask decides nothing and asks nothing, not a hint that failed.
		const t = saved(undefined, NOW);
		const o = scoreGameSync(unverified("nfl not final"), { 1: KEY, 2: KEY, 4: KEY }, PAYOUT, NOW, t.send);
		expect([o.decision.action, o.decision.why, t.asked.length]).toEqual(["wait", "seat 3 has no key", 0]);
	});

	test("the board check on its own, at the horizon: a missing hint waits on a board short of the date and fails on one that reaches it", () => {
		const check = (near: number | undefined, derive?: Derive): BoardCheck => {
			const t = saved(derive, NOW);
			const game: Game = { league: "nfl", home: "Chicago Bears", away: "New England Patriots", start: at("2026-11-20T00:15:00Z") - 86_400, n: 2 * 86_400 + 1, hints: [{ seat: 3, id: "00000000-0000-4000-8000-000000000000" }] };
			const run = checkBoard({ game, now: NOW, key: KEY, near });
			let step = run.next(undefined as unknown as HttpResponse);
			while (!step.done) step = run.next(t.send(step.value));
			expect(t.misses).toEqual([]);
			return step.value;
		};
		// The saved board lists games to 3 Nov: a game on 20 Nov is past it; one on 1 Nov is not.
		expect(check(at("2026-11-20T00:15:00Z"))).toEqual({ kind: "silent", why: "the board doesn't reach the game's date yet" });
		expect(check(at("2026-11-01T17:00:00Z"))).toEqual({ kind: "fails", why: "hint not on the board" });
		// Without a date the board can't be held to one, so nothing is learned.
		expect(check(undefined)).toEqual({ kind: "silent", why: "the board doesn't reach the game's date yet" });
		// An empty board reaches no date.
		expect(check(at("2026-11-01T17:00:00Z"), (s, p, b) => (s === 3 && p === "/odds/NFL?oddType=Game" ? [] : b))).toEqual({ kind: "silent", why: "the board doesn't reach the game's date yet" });
	});
});

describe("the start's time", () => {
	// Oklahoma City at San Antonio, 20 Oct, the one game of the 138 saved where the seats differed:
	// seat 1 kept the scheduled 01:30 UTC, seat 2 moved to 01:50, and the spare's time is the actual
	// tip-off, 01:52:15. Read with each seat's real saved answer; seat 3's board had dropped the
	// finished game. The answers were saved after it ended, so each seat reads it final, and the
	// start's rule writes nothing for a game already final (identity.test.ts). These tests are about
	// the times, so each reading is handed on as a listing of the game: its record and time as read.
	const okc: Game = { league: "nba", home: "San Antonio Spurs", away: "Oklahoma City Thunder", start: at("2026-10-21T01:30:00Z"), n: 86_400, hints: [] };
	const read = (seat: Seat, game: Game = okc, derive?: Derive): Reading => {
		const t = saved(derive, NOW);
		const r = runSync(seat, readerFor(seat)({ game, now: NOW, key: KEY, near: at("2026-10-21T01:30:00Z") }), t.send);
		expect(t.misses).toEqual([]);
		expect({ seat, kind: r.kind }).toEqual({ seat, kind: "final" });
		return { ...r, kind: "no_final", detail: "listed" };
	};
	const failed: BoardCheck = { kind: "fails", why: "hint not on the board" };

	test("the real times: 01:30 and 01:50 differ by minutes, the earliest is written, and the spare's 01:52:15 never sets it", () => {
		const seen = { 1: read(1), 2: read(2), 3: failed, 4: read(4) };
		expect([1, 2, 4].map((s) => iso(seen[s as 1 | 2 | 4].record!.time!))).toEqual(["2026-10-21T01:30:00Z", "2026-10-21T01:50:00Z", "2026-10-21T01:52:15Z"]);
		const d = decideStart({ date: at("2026-10-21T01:30:00Z"), hints: [] }, seen);
		expect([d.action, d.action === "start" ? iso(d.start) : null]).toEqual(["start", "2026-10-21T01:30:00Z"]);
	});

	test("the spare's time never sets the start, even when it is the earliest", () => {
		const r1 = read(1);
		const shift = (r: Reading, by: number): Reading => ({ ...r, record: { id: r.record!.id, time: r.record!.time! + by } });
		const d = decideStart({ date: r1.record!.time!, hints: [] }, { 1: r1, 2: read(2), 3: failed, 4: shift(read(4), -40 * 60) });
		expect([d.action, d.action === "start" ? iso(d.start) : null]).toEqual(["start", "2026-10-21T01:30:00Z"]);
	});

	test("the hour is measured across every counting seat: seat 3 and the spare must each be within it of both seats 1 and 2", () => {
		// The real times: seat 1 at 01:30, seat 2 at 01:50. A time can be inside the hour of one and outside it of the other.
		const r1 = read(1);
		const r2 = read(2);
		const t1 = r1.record!.time!;
		const g = { date: t1, hints: [] };
		const board = (minutes: number): BoardCheck => ({ kind: "listed", id: "x", time: t1 + minutes * 60 });
		const run = (b: BoardCheck, r4: Reading = read(4)) => {
			const d = decideStart(g, { 1: r1, 2: r2, 3: b, 4: r4 });
			return [d.action, d.action === "start" ? iso(d.start) : null, d.readings[2].kind];
		};
		expect(run(board(-20))).toEqual(["start", "2026-10-21T01:10:00Z", "no_final"]); // 20 and 40 minutes: passes, and sets the start
		expect(run(board(55))).toEqual(["start", "2026-10-21T01:30:00Z", "no_final"]); // 55 and 35 minutes: passes
		expect(run(board(-45))).toEqual(["start", "2026-10-21T01:30:00Z", "silent"]); // 45 minutes from seat 1, 65 from seat 2
		expect(run(board(75))).toEqual(["start", "2026-10-21T01:30:00Z", "silent"]); // 55 minutes from seat 2, 75 from seat 1
		// The spare standing in, the same way.
		const spare = (minutes: number): Reading => ({ ...read(4), record: { id: "x", time: t1 + minutes * 60 } });
		const down: BoardCheck = { kind: "fails", why: "hint not on the board" };
		expect(run(down, spare(-45))[0]).toBe("wait");
		expect(run(down, spare(75))[0]).toBe("wait");
		expect(run(down, spare(55))).toEqual(["start", "2026-10-21T01:30:00Z", "silent"]);
	});

	test("both ends of the games set's range are in: a time at exactly date - START_BOUND or date + START_BOUND lists the game", () => {
		// START_BOUND is the games set's own fixed 24 hours (OspexGames.START_BOUND), not the game's n.
		expect(START_BOUND).toBe(86_400);
		const r1 = read(1);
		const t1 = r1.record!.time!;
		const at = (t: number): Reading => ({ ...r1, record: { id: "x", time: t } });
		for (const date of [t1 - START_BOUND, t1 + START_BOUND]) {
			const d = decideStart({ date, hints: [] }, { 1: at(t1), 2: { ...read(2), record: { id: "y", time: t1 } }, 3: { kind: "listed", id: "z", time: t1 }, 4: read(4) });
			expect({ date: iso(date), got: [d.action, d.action === "start" ? iso(d.start) : null, d.readings[2].kind] }).toEqual({ date: iso(date), got: ["start", "2026-10-21T01:30:00Z", "no_final"] });
		}
		// One second further, and seat 1 no longer lists the game.
		const past = decideStart({ date: t1 + START_BOUND + 1, hints: [] }, { 1: at(t1), 2: { ...read(2), record: { id: "y", time: t1 } }, 3: { kind: "listed", id: "z", time: t1 }, 4: read(4) });
		expect([past.action, past.why]).toEqual(["wait", "seat 1 does not list the game within a day of its date"]);
	});

	test("the range is the games set's fixed day, whatever the game's n: a game with a longer n is held to the same day", () => {
		// The range a seat must list the game in is built from START_BOUND, not the game's n; n sets only
		// the window the start is then read again in. 25 hours, so that window asks only saved dates.
		const long: ChainGame = { ...unverified("nfl not final"), n: 86_400 + 3_600 };
		const v = verify(long);
		expect([v.action, v.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		// The date a day and a minute before the real 00:15: inside this game's n, outside the games set's day.
		// Seat 1's answers for the other days in that range list no NFL game, and a date that answers
		// with nothing leaves a seat silent rather than saying the game is absent (src/pick.ts). Either
		// way nothing is written; the range's own edges are the test above.
		const t = saved(undefined, NOW);
		const far = scoreGameSync({ ...long, date: at("2026-10-23T00:15:00Z") - START_BOUND - 60, hints: [] }, KEYS, PAYOUT, NOW, t.send);
		expect(t.misses).toEqual([]);
		expect([far.decision.action, far.decision.why]).toEqual(["wait", "seat 1 is silent: empty listing"]);
	});

	test("a start report carries the zero address as its payout, whatever payout is handed in: a start pays nothing", () => {
		const v = verify(unverified("nfl not final"));
		const t = saved(undefined, NOW);
		const o = scoreGameSync(unverified("nfl not final"), KEYS, PAYOUT, NOW, t.send);
		expect([v.action, o.report?.payout]).toEqual(["start", "0x0000000000000000000000000000000000000000"]);
	});

	test("an hour apart is the most: at 3600 seconds the earliest is written, at 3601 nothing is", () => {
		const r1 = read(1);
		const t1 = r1.record!.time!;
		const at2 = (by: number): Reading => ({ ...read(2), record: { id: "340478", time: t1 + by } });
		const run = (by: number) => decideStart({ date: t1, hints: [] }, { 1: r1, 2: at2(by), 3: failed, 4: { ...read(4), record: { id: "x", time: t1 } } });
		expect(START_SPREAD).toBe(3600);
		expect([run(3600).action, run(3601).action, run(3601).why]).toEqual(["start", "wait", "seats 1 and 2 list the game more than an hour apart"]);
		expect([run(-3600).action, run(-3601).action]).toEqual(["start", "wait"]);
	});

	test("with seat 3 silent for the game, the spare must list the game within the hour, and is checked, never written", () => {
		const r1 = read(1);
		const t1 = r1.record!.time!;
		const g = { date: t1, hints: [] };
		const four = (r: Reading) => decideStart(g, { 1: r1, 2: read(2), 3: failed, 4: r });
		const r4 = read(4);
		expect(four({ ...r4, record: { id: "x", time: t1 + 3600 } }).action).toBe("start");
		expect([four({ ...r4, record: { id: "x", time: t1 + 3601 } }).action, four({ ...r4, record: { id: "x", time: t1 + 3601 } }).why]).toEqual([
			"wait",
			"seat 3 is silent for the game and the spare lists the game more than an hour from seats 1 and 2",
		]);
		expect(four({ ...r4, kind: "silent", detail: "past retention", record: null, home: null, away: null }).why).toBe("seat 3 is silent for the game and the spare is silent: past retention");
		expect(four({ ...r4, kind: "no_final", detail: "absent", record: null, home: null, away: null }).why).toBe("seat 3 is silent for the game and the spare does not list the game within a day of its date");
	});

	test("a seat listing the game more than a day (START_BOUND) from the creator's date does not list it: the games set would refuse that start", () => {
		const r1 = read(1);
		const t1 = r1.record!.time!;
		const d = decideStart({ date: t1 + 86_400 + 1, hints: [] }, { 1: r1, 2: read(2), 3: failed, 4: read(4) });
		expect([d.action, d.why]).toEqual(["wait", "seat 1 does not list the game within a day of its date"]);
	});

	test("seat 3's board time within the hour but more than a day from the date never sets the start", () => {
		// Seats 1 and 2 at 01:30 and 01:50, the date exactly n after 01:30. The board's 01:20 is within
		// the hour of both but outside [date - n, date + n]: writing it would be refused, so seat 3 stands down.
		const r1 = read(1);
		const t1 = r1.record!.time!;
		const g = { date: t1 + 86_400, hints: [] };
		const d = decideStart(g, { 1: r1, 2: read(2), 3: { kind: "listed", id: "x", time: t1 - 600 }, 4: read(4) });
		expect([d.action, d.action === "start" ? iso(d.start) : null, d.readings[2].detail]).toEqual(["start", "2026-10-21T01:30:00Z", "silent for the game: board time not at the start"]);
		expect(d.action === "start" && d.start >= g.date - START_BOUND).toBe(true);
	});

	test("the order the readings are handed in, in every one of the 24 orders, changes nothing", () => {
		const parts = { 1: read(1), 2: read(2), 3: { kind: "listed", id: "x", time: at("2026-10-21T01:20:00Z") } as BoardCheck, 4: read(4) };
		const g = { date: at("2026-10-21T01:30:00Z"), hints: [] };
		const base = decideStart(g, parts);
		expect([base.action, base.action === "start" ? iso(base.start) : null]).toEqual(["start", "2026-10-21T01:20:00Z"]);
		const orders: number[][] = [];
		const permute = (done: number[], left: number[]) => (left.length === 0 ? orders.push(done) : left.forEach((s, i) => permute([...done, s], [...left.slice(0, i), ...left.slice(i + 1)])));
		permute([], [1, 2, 3, 4]);
		expect(orders.length).toBe(24);
		for (const order of orders) {
			const seen = Object.fromEntries(order.map((s) => [s, parts[s as 1 | 2 | 3 | 4]])) as unknown as typeof parts;
			expect({ order, got: decideStart(g, seen) }).toEqual({ order, got: base });
		}
	});
});

describe("finding the game near the creator's date", () => {
	// A doubleheader, derived from the real answers: each by-team seat lists the same two teams
	// again four hours after the real game, under a new id. The creator's date picks which game.
	// Added beside the real game in whichever date's answer lists it; each seat files it under its own date.
	const dh: Derive = (seat, path, body) => {
		if (seat === 1 && path.startsWith("/nfl/v1/games?")) {
			const b = copy(body) as { data: Record<string, any>[] };
			const g = b.data.find((x) => x.id === 1392309);
			if (g) b.data.push({ ...g, id: 9_999_001, date: "2026-10-23T04:15:00.000Z" });
			return b;
		}
		if (seat === 2 && path.startsWith("/games?league=NFL&")) {
			const b = copy(body) as { results: Record<string, any>[] };
			const g = b.results.find((x) => x.gameId === 340175);
			if (g) b.results.push({ ...g, gameId: 9_999_002, schedule: { ...g.schedule, date: "2026-10-23T04:15:00.000Z" } });
			return b;
		}
		if (seat === 4 && path.includes("americanfootball_nfl")) {
			const b = copy(body) as Record<string, any>[];
			const g = b.find((x) => x.id === "ffebea881c1d7b2dfb85b3e590c35985");
			if (g) b.push({ ...g, id: "dh-second", commence_time: "2026-10-23T04:15:00Z" });
			return b;
		}
		return body;
	};
	const ids = (v: ReturnType<typeof verify>) => v.seats;
	// The first game's own records, by seat: what a creator gives to have it scored, since without them
	// its window holds the second game too (identity.test.ts).
	const FIRST = [{ seat: 1, id: "1392309" }, { seat: 2, id: "340175" }, { seat: 4, id: "ffebea881c1d7b2dfb85b3e590c35985" }];

	test("the record nearest the date is the game; two at the same distance leave the seat silent", () => {
		const first = verify(unverified("nfl not final", { date: at("2026-10-23T00:15:00Z"), hints: [{ seat: 3, id: BEARS }, ...FIRST] }), dh);
		expect([first.action, first.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		// Created for the second game, without a seat 3 hint (seat 3's board lists only the first).
		const second = verify(unverified("nfl not final", { date: at("2026-10-23T04:00:00Z"), hints: [] }), dh);
		expect([second.action, second.start, ids(second)]).toEqual([
			"start",
			"2026-10-23T04:15:00Z",
			["1:2026-10-23T04:15:00Z", "2:2026-10-23T04:15:00Z", "3:silent for the game: no hint", "4:2026-10-23T04:15:00Z"],
		]);
		const between = verify(unverified("nfl not final", { date: at("2026-10-23T02:15:00Z"), hints: [] }), dh);
		expect([between.action, between.why]).toEqual(["wait", "seat 1 is silent: ambiguous"]);
	});

	test("the nearest decides only when nothing else could be the game: a third record that could be leaves the seat silent", () => {
		// The doubleheader again, created for the second game, with a third record at seat 1 of a kind
		// the only-one rule counts: one of the game's teams beside a name the lists don't know, inside
		// the range verification reads, or the two teams with no game time. Seat 1 has no hint, so the
		// rule decides. The unknown name sits at 22:15 the evening before: inside the range, outside the
		// second game's window, so the re-read as scoring will read it can't refuse it and only the
		// nearest record's own guard can. (The record with no time is refused by both.)
		const beside = (third: (g: Record<string, any>) => Record<string, any>): Derive => (seat, path, body) => {
			const b = dh(seat, path, body);
			if (seat !== 1 || !path.startsWith("/nfl/v1/games?")) return b;
			const c = b as { data: Record<string, any>[] };
			const g = c.data.find((x) => x.id === 1392309);
			if (g) c.data.push(third({ ...g, id: 9_999_003 }));
			return c;
		};
		const game = unverified("nfl not final", { date: at("2026-10-23T04:00:00Z"), hints: [] });
		const rows: [string, Derive, string, string | null][] = [
			["the doubleheader alone", dh, "start", "2026-10-23T04:15:00Z"],
			[
				"beside one team and an unknown name",
				beside((g) => ({ ...g, date: "2026-10-22T22:15:00.000Z", visitor_team: { ...g.visitor_team, full_name: "Springfield Isotopes" } })),
				"wait",
				"seat 1 is silent: ambiguous",
			],
			["beside the two teams with no time", beside((g) => ({ ...g, date: null })), "wait", "seat 1 is silent: ambiguous"],
		];
		const got = rows.map(([what, derive]) => {
			const v = verify(game, derive);
			return [what, v.action, v.action === "start" ? v.start : v.why];
		});
		expect(got).toEqual(rows.map(([what, , action, then]) => [what, action, then]));
	});
});
