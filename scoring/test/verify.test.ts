// The start's rule (verify.ts): proposed on the PR, with Vince's rulings of 10/22 in it. Seat 3's
// hint is checked against its board; a hint that fails makes seat 3 silent for the game and the
// spare stands in; the start is the earliest counting seat's scheduled time when the counting seats
// lie within an hour, and nothing is written when they lie further apart; the spare's time never
// sets it.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { readerFor } from "../src/index";
import { scoreGameSync } from "../src/program";
import { checkBoard, type BoardCheck } from "../src/readers/board3";
import { runSync } from "../src/run";
import type { Game, HttpResponse, Reading, Seat } from "../src/types";
import { START_BOUND, START_SPREAD, decideStart } from "../src/verify";
import { NOW } from "./cases";
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

	test("Golden State at the Lakers, created without a seat 3 hint: seat 3 is silent for the game and the spare stands in", () => {
		const v = verify(unverified("nba final"));
		expect([v.action, v.why, v.start, v.seats[2], v.report?.readings]).toEqual([
			"start",
			"seats 1 and 2 list the game within an hour, and the spare stands in for seat 3",
			"2026-10-22T02:00:00Z",
			"3:silent for the game: no hint",
			[[1, 2], [2, 2], [3, 0], [4, 2]],
		]);
	});

	test("Nashville at Boston: seat 1 refuses the league (its tier), so nothing is written and a later run tries again", () => {
		const v = verify(unverified("nhl not final"));
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 1 is silent: http 401", null]);
	});

	test("seat 2 silent, or not listing the game, writes nothing either; the spare never stands in for seats 1 or 2", () => {
		const t = saved(undefined, NOW);
		const o = scoreGameSync(unverified("nfl not final"), KEYS, PAYOUT, NOW, (q) => (locate(q)?.seat === 2 ? { status: 503, body: "" } : t.send(q)));
		expect([o.decision.action, o.decision.why, o.report]).toEqual(["wait", "seat 2 is silent: http 503", null]);
		// Seat 2 answers, but lists no game of the two teams: it answered, and it does not list the game.
		const empty: Derive = (s, p, b) => (s === 2 && p.startsWith("/games?league=NFL") ? { ...(b as object), results: [] } : b);
		const v = verify(unverified("nfl not final"), empty);
		expect([v.action, v.why]).toEqual(["wait", "seat 2 does not list the game within a day of its date"]);
	});
});

describe("seat 3's hint, checked against its board (ruling 2)", () => {
	const flip = (r: Record<string, unknown>) => ({ ...r, HomeTeam: r.AwayTeam, AwayTeam: r.HomeTeam });
	const cases: [string, Derive, string][] = [
		["the hint's row lists the teams the other way round", board("NFL", BEARS, flip), "home and away the other way round"],
		["the hint's row is gone from the board", board("NFL", BEARS, () => null), "hint not on the board"],
		["the hint's row names two other teams", board("NFL", BEARS, (r) => ({ ...r, HomeTeam: "Detroit Lions", AwayTeam: "Green Bay Packers" })), "other teams"],
		["the hint's row has the home team right and another away team", board("NFL", BEARS, (r) => ({ ...r, AwayTeam: "Green Bay Packers" })), "other teams"],
		["the hint's row has the away team right and another home team", board("NFL", BEARS, (r) => ({ ...r, HomeTeam: "Detroit Lions" })), "other teams"],
		["the hint's row has no time", board("NFL", BEARS, (r) => ({ ...r, MatchTime: null })), "no time"],
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
		// No seat 3 key is the same: a run that cannot ask, not a hint that failed.
		const t = saved(undefined, NOW);
		const o = scoreGameSync(unverified("nfl not final"), { 1: KEY, 2: KEY, 4: KEY }, PAYOUT, NOW, t.send);
		expect([o.decision.action, o.decision.why]).toEqual(["wait", "seat 3's board is silent: no key"]);
	});
});

describe("the start's time (ruling 3)", () => {
	// Oklahoma City at San Antonio, 20 Oct, the one game of D1's 138 where the seats differed: seat 1
	// kept the scheduled 01:30 UTC, seat 2 moved to 01:50, and the spare's time is the actual tip-off,
	// 01:52:15. Read with each seat's real saved answer; seat 3's board had dropped the finished game.
	const okc: Game = { league: "nba", home: "San Antonio Spurs", away: "Oklahoma City Thunder", start: at("2026-10-21T01:30:00Z"), n: 86_400, hints: [] };
	const read = (seat: Seat, game: Game = okc, derive?: Derive): Reading => {
		const t = saved(derive, NOW);
		const r = runSync(seat, readerFor(seat)({ game, now: NOW, key: KEY, near: at("2026-10-21T01:30:00Z") }), t.send);
		expect(t.misses).toEqual([]);
		return r;
	};
	const failed: BoardCheck = { kind: "fails", why: "hint not on the board" };

	test("the real times: 01:30 and 01:50 differ by minutes, the earliest is written, and the spare's 01:52:15 never sets it", () => {
		const seen = { 1: read(1), 2: read(2), 3: failed, 4: read(4) };
		expect([1, 2, 4].map((s) => iso(seen[s as 1 | 2 | 4].record!.time!))).toEqual(["2026-10-21T01:30:00Z", "2026-10-21T01:50:00Z", "2026-10-21T01:52:15Z"]);
		const d = decideStart({ date: at("2026-10-21T01:30:00Z") }, seen);
		expect([d.action, d.action === "start" ? iso(d.start) : null]).toEqual(["start", "2026-10-21T01:30:00Z"]);
	});

	test("the spare's time never sets the start, even when it is the earliest", () => {
		const r1 = read(1);
		const shift = (r: Reading, by: number): Reading => ({ ...r, record: { id: r.record!.id, time: r.record!.time! + by } });
		const d = decideStart({ date: r1.record!.time! }, { 1: r1, 2: read(2), 3: failed, 4: shift(read(4), -40 * 60) });
		expect([d.action, d.action === "start" ? iso(d.start) : null]).toEqual(["start", "2026-10-21T01:30:00Z"]);
	});

	test("the hour is measured across every counting seat: seat 3 and the spare must each be within it of both seats 1 and 2", () => {
		// The real times: seat 1 at 01:30, seat 2 at 01:50. A time can be inside the hour of one and outside it of the other.
		const r1 = read(1);
		const r2 = read(2);
		const t1 = r1.record!.time!;
		const g = { date: t1 };
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
			const d = decideStart({ date }, { 1: at(t1), 2: { ...read(2), record: { id: "y", time: t1 } }, 3: { kind: "listed", id: "z", time: t1 }, 4: read(4) });
			expect({ date: iso(date), got: [d.action, d.action === "start" ? iso(d.start) : null, d.readings[2].kind] }).toEqual({ date: iso(date), got: ["start", "2026-10-21T01:30:00Z", "no_final"] });
		}
		// One second further, and seat 1 no longer lists the game.
		const past = decideStart({ date: t1 + START_BOUND + 1 }, { 1: at(t1), 2: { ...read(2), record: { id: "y", time: t1 } }, 3: { kind: "listed", id: "z", time: t1 }, 4: read(4) });
		expect([past.action, past.why]).toEqual(["wait", "seat 1 does not list the game within a day of its date"]);
	});

	test("the range is the games set's fixed day, whatever the game's n: a game with a longer n is held to the same day", () => {
		// The game's n doesn't reach verification at all: the run builds its own range from START_BOUND.
		const long: ChainGame = { ...unverified("nfl not final"), n: 3 * 86_400 };
		const v = verify(long);
		expect([v.action, v.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		// The date a day and a minute before the real 00:15: inside this game's n, outside the games set's day.
		const t = saved(undefined, NOW);
		const far = scoreGameSync({ ...long, date: at("2026-10-23T00:15:00Z") - START_BOUND - 60, hints: [] }, KEYS, PAYOUT, NOW, t.send);
		expect(t.misses).toEqual([]);
		expect([far.decision.action, far.decision.why]).toEqual(["wait", "seat 1 does not list the game within a day of its date"]);
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
		const run = (by: number) => decideStart({ date: t1 }, { 1: r1, 2: at2(by), 3: failed, 4: { ...read(4), record: { id: "x", time: t1 } } });
		expect(START_SPREAD).toBe(3600);
		expect([run(3600).action, run(3601).action, run(3601).why]).toEqual(["start", "wait", "seats 1 and 2 list the game more than an hour apart"]);
		expect([run(-3600).action, run(-3601).action]).toEqual(["start", "wait"]);
	});

	test("with seat 3 silent for the game, the spare must list the game within the hour, and is checked, never written", () => {
		const r1 = read(1);
		const t1 = r1.record!.time!;
		const g = { date: t1 };
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
		const d = decideStart({ date: t1 + 86_400 + 1 }, { 1: r1, 2: read(2), 3: failed, 4: read(4) });
		expect([d.action, d.why]).toEqual(["wait", "seat 1 does not list the game within a day of its date"]);
	});

	test("seat 3's board time within the hour but more than a day from the date never sets the start", () => {
		// Seats 1 and 2 at 01:30 and 01:50, the date exactly n after 01:30. The board's 01:20 is within
		// the hour of both but outside [date - n, date + n]: writing it would be refused, so seat 3 stands down.
		const r1 = read(1);
		const t1 = r1.record!.time!;
		const g = { date: t1 + 86_400 };
		const d = decideStart(g, { 1: r1, 2: read(2), 3: { kind: "listed", id: "x", time: t1 - 600 }, 4: read(4) });
		expect([d.action, d.action === "start" ? iso(d.start) : null, d.readings[2].detail]).toEqual(["start", "2026-10-21T01:30:00Z", "silent for the game: board time not at the start"]);
		expect(d.action === "start" && d.start >= g.date - START_BOUND).toBe(true);
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

	test("the record nearest the date is the game; two at the same distance leave the seat silent", () => {
		const first = verify(unverified("nfl not final", { date: at("2026-10-23T00:15:00Z") }), dh);
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
});
