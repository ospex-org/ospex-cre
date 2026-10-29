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
import { LATE, MID, NOW } from "./cases";
import { KEY, at, copy, locate, saved, type Derive } from "./fixtures";
import { PAYOUT, chainOf } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000", "");

function unverified(caseName: string, over: Partial<ChainGame> = {}): ChainGame {
	return { ...chainOf(caseName), status: "unverified", start: null, startReadings: null, ...over };
}

/** Runs verification on the saved answers; `board`, when given, is the answer to the board's one-game request as sent. */
function verify(game: ChainGame, derive?: Derive, now = NOW, board?: unknown[]) {
	const t = saved(derive, now);
	const o = scoreGameSync(game, KEYS, PAYOUT, now, (q) => (board !== undefined && q.method === "POST" ? { status: 200, body: JSON.stringify(board) } : t.send(q)));
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

/** The hint's row as the saved board lists it, and one other row, for an answer to the board's one-game request built by hand. */
const boardRows = (): { own: Record<string, unknown>; other: Record<string, unknown> } => {
	const rows = JSON.parse(saved(undefined, NOW).send(request(3, "/odds/NFL?oddType=Game", KEY)).body) as Record<string, unknown>[];
	return { own: rows.find((r) => r.ID === BEARS)!, other: rows.find((r) => r.ID !== BEARS)! };
};

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
		// Seat 2 answers, listing a game of the two teams a day and a half past the date and not this one:
		// it answered, and it does not list the game within a day of its date. An answer with nothing in it
		// would be silence, never absence (src/pick.ts).
		const sixers = unverified("nba not final");
		const names = new Set([sixers.home, sixers.away]);
		const unlisted: Derive = (s, p, b) => {
			if (s !== 2 || !p.startsWith("/games?league=NBA")) return b;
			const c = copy(b) as { results: Record<string, any>[] };
			for (const g of c.results) if (names.has(g.teams?.home?.team) && names.has(g.teams?.away?.team)) Object.assign(g, { gameId: 9_990_484, schedule: { date: "2026-10-24T10:00:00.000Z", tbaTime: false } });
			return c;
		};
		const v = verify(sixers, unlisted);
		// Absence is silence: the two teams' record outside the range is silence, with its reason, and no start is written on it.
		expect([v.action, v.why, v.seats[1]]).toEqual(["wait", "seat 2 is silent: outside window", "2:outside window"]);
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
		// The board's answer to the one-game request, a row that is not an object.
		const v = verify(unverified("nfl not final"), undefined, NOW, [null]);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 3's board is silent: unreadable record", null]);
	});

	test("an id the board row doesn't give as text, or a hinted row whose teams or time can't be read, makes the run wait", () => {
		// The hinted row's own id, null or a number, could be the hint's: nothing is learned. So could
		// another row's in the same answer, so any row's unreadable id waits, the hinted row's or not. The
		// answers are built by hand from the saved board's rows: the board's one-game request is answered
		// with the rows as given.
		const OTHER = "a row that is not the hint's";
		const { own, other } = boardRows();
		const forms: [string, unknown[]][] = [
			["the hinted row's id null", [{ ...own, ID: null }]],
			["the hinted row's id a number", [{ ...own, ID: 7 }]],
			["the hinted row's id empty", [{ ...own, ID: " " }]],
			["the hinted row's id missing", [(({ ID: _, ...r }) => r)(own)]],
			[`${OTHER}: its id null`, [own, { ...other, ID: null }]],
			["the hinted row's home team null", [{ ...own, HomeTeam: null }]],
			["the hinted row's away team a number", [{ ...own, AwayTeam: 12 }]],
			["the hinted row's time null", [{ ...own, MatchTime: null }]],
			["the hinted row's time TBD", [{ ...own, MatchTime: "TBD" }]],
			["the hinted row's time a number", [{ ...own, MatchTime: 1792714500 }]],
		];
		for (const [what, rows] of forms) {
			const v = verify(unverified("nfl not final"), undefined, NOW, rows);
			expect({ what, got: [v.action, v.why, v.report] }).toEqual({ what, got: ["wait", "seat 3's board is silent: unreadable record", null] });
		}
		// The control: another row's time unreadable says nothing about the hint, and the hint still binds.
		const v = verify(unverified("nfl not final"), undefined, NOW, [own, { ...other, MatchTime: "TBD" }]);
		expect([v.action, v.start, v.report?.readings[2]]).toEqual(["start", "2026-10-23T00:15:00Z", [3, 1]]);
	});

	test("an id in text that isn't a seat 3 id makes the run wait: padded either side, a number, cut short, or one character more", () => {
		// Each of these used to read as text, miss the hint, and fail it: seat 3 stood down for good, and
		// the game later scored without seat 3's dissent. Now nothing is learned, and the run waits.
		const forms: [string, string][] = [
			["a space before", ` ${BEARS}`],
			["a space after", `${BEARS} `],
			["a number in text", "7"],
			["cut short", BEARS.slice(0, 35)],
			["one character more", `${BEARS}0`],
		];
		const { own, other } = boardRows();
		for (const [what, id] of forms) {
			const v = verify(unverified("nfl not final"), undefined, NOW, [{ ...own, ID: id }]);
			expect({ what, got: [v.action, v.why, v.report] }).toEqual({ what, got: ["wait", "seat 3's board is silent: unreadable record", null] });
		}
		// Another row's id in such a form, in the same answer, waits too: it could be the hint's own row.
		expect(verify(unverified("nfl not final"), undefined, NOW, [own, { ...other, ID: "7" }]).why).toBe("seat 3's board is silent: unreadable record");
		// The control: the hint's own id, as the board gives it and in capitals, binds.
		for (const id of [BEARS, BEARS.toUpperCase()]) {
			const v = verify(unverified("nfl not final"), undefined, NOW, [{ ...own, ID: id }]);
			expect({ id, got: [v.action, v.report?.readings[2]] }).toEqual({ id, got: ["start", [3, 1]] });
		}
	});

	test("the teams are checked before the time: a row of other teams fails whatever its time says; the game's own row waits for one", () => {
		const otherTeams = (time: unknown) => board("NFL", BEARS, (r) => ({ ...r, HomeTeam: "Detroit Lions", AwayTeam: "Green Bay Packers", MatchTime: time }));
		for (const time of ["TBD", null, "2026-10-23T00:15:00"]) {
			const v = verify(unverified("nfl not final"), otherTeams(time));
			expect({ time, got: [v.action, v.seats[2], v.report?.readings[2]] }).toEqual({ time, got: ["start", "3:silent for the game: other teams", [3, 0]] });
		}
		// The game's own teams with no time: nothing is learned about the hint, and the run waits.
		const own = verify(unverified("nfl not final"), board("NFL", BEARS, (r) => ({ ...r, MatchTime: "TBD" })));
		expect([own.action, own.why]).toEqual(["wait", "seat 3's board is silent: unreadable record"]);
	});

	test("a hint the board does not list fails at once, whatever the date, and the spare stands in: the board is asked for the hint's row by its id, and answers it or nothing", () => {
		// The hint's row gone from the saved board the one-game answer is drawn from: no row for the hint,
		// so seat 3 stands down and the spare stands in, with the creator's date wherever it lies. The
		// board's one-game request carries the hint's id, the league's code and the game's own odds type.
		for (const date of [at("2026-10-23T00:20:00Z"), at("2026-10-23T00:15:00Z")]) {
			const t = saved(board("NFL", BEARS, () => null), NOW);
			const o = scoreGameSync(unverified("nfl not final", { date }), KEYS, PAYOUT, NOW, t.send);
			expect(t.misses).toEqual([]);
			expect([o.decision.action, o.decision.readings[2].detail]).toEqual(["start", "silent for the game: hint not on the board"]);
			const boardAsk = t.asked.filter((q) => q.method === "POST");
			expect(boardAsk.map((q) => [locate(q)?.path, q.headers["content-type"]])).toEqual([[`POST /odds/bygames {"GameIDs":["${BEARS}"],"Sport":"NFL","OddType":"Game"}`, "application/json"]]);
		}
		// An answer with no row at all, by hand: the same.
		const empty = verify(unverified("nfl not final"), undefined, NOW, []);
		expect([empty.action, empty.seats[2]]).toEqual(["start", "3:silent for the game: hint not on the board"]);
	});

	test("a hinted row for a part of the game fails the check, in its own field or its odds'; the board's own rows bind", () => {
		const rows: [string, (r: Record<string, unknown>) => Record<string, unknown>][] = [
			["the row's own OddType a half", (r) => ({ ...r, OddType: "1st Half" })],
			["an odds entry for a half", (r) => ({ ...r, Odds: (r.Odds as Record<string, unknown>[]).map((o) => ({ ...o, OddType: "FirstHalf" })) })],
			["one odds entry of two for a period", (r) => ({ ...r, Odds: [...(r.Odds as Record<string, unknown>[]), { ...(r.Odds as Record<string, unknown>[])[0], OddType: "FirstPeriod" }] })],
		];
		for (const [what, change] of rows) {
			const v = verify(unverified("nfl not final"), board("NFL", BEARS, change));
			expect({ what, got: [v.action, v.seats[2], v.report?.readings[2]] }).toEqual({ what, got: ["start", "3:silent for the game: hint names a part of the game", [3, 0]] });
		}
		// The control: the row as saved (no OddType of its own, "Game" on its odds), and one that says "Game" itself.
		for (const change of [(r: Record<string, unknown>) => r, (r: Record<string, unknown>) => ({ ...r, OddType: "Game" })]) {
			const v = verify(unverified("nfl not final"), board("NFL", BEARS, change));
			expect([v.action, v.report?.readings[2]]).toEqual(["start", [3, 1]]);
		}
	});

	test("a hinted row whose teams the board hasn't named yet waits; one whose named side makes it another game fails", () => {
		const rows: [string, string, string, string][] = [
			["both placeholders, the time too", "TBD", "TBD", "wait"],
			["the home side not named yet", "TBD", "New England Patriots", "wait"],
			["the away side not named yet", "Chicago Bears", "To Be Determined", "wait"],
			["the away side in other words", "Chicago Bears", "tba", "wait"],
			["the game's away team named as home", "New England Patriots", "TBD", "home and away the other way round"],
			["another team named", "Detroit Lions", "TBD", "other teams"],
			["a name the lists don't know beside a placeholder", "Chicago Bearz", "TBD", "a team name the lists don't know"],
		];
		for (const [what, home, away, want] of rows) {
			const v = verify(unverified("nfl not final"), board("NFL", BEARS, (r) => ({ ...r, HomeTeam: home, AwayTeam: away, MatchTime: "TBD" })));
			const got = v.action === "wait" ? v.why : v.seats[2];
			expect({ what, got }).toEqual({ what, got: want === "wait" ? "seat 3's board is silent: the hint's row names no team yet" : `3:silent for the game: ${want}` });
		}
		// End to end: the row named later binds, and seat 3 counts. Before, the placeholder stood it down for good.
		const named = verify(unverified("nfl not final"));
		expect([named.action, named.report?.readings[2]]).toEqual(["start", [3, 1]]);
	});

	test("with seat 3 counting, the spare listing the game more than an hour from the counting seats writes nothing: scoring would read it by that record", () => {
		// New England at Chicago at 00:15 at seats 1 to 3. The spare lists, in turn: only a second game at
		// 04:15, the next evening's game at 23:15, and the game itself at an hour and a second off.
		const spareAt = (time: string, id = "ffebea881c1d7b2dfb85b3e590c35985"): Derive => (s, p, b) =>
			s === 4 && p.includes("americanfootball_nfl") ? (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, id, commence_time: time, completed: false, scores: null } : g)) : b;
		const WAIT = "the spare lists the game more than an hour from the counting seats";
		for (const [what, derive] of [
			["only the second game, at 04:15", spareAt("2026-10-23T04:15:00Z", "dh-second")],
			["the next evening's game", spareAt("2026-10-23T23:15:00Z", "next-day")],
			["an hour and a second after the counting seats", spareAt("2026-10-23T01:15:01Z")],
		] as const) {
			const v = verify(unverified("nfl not final"), derive);
			expect({ what, got: [v.action, v.why] }).toEqual({ what, got: ["wait", WAIT] });
		}
		// The control: an hour exactly, and the spare's real time.
		for (const derive of [spareAt("2026-10-23T01:15:00Z"), undefined]) {
			const v = verify(unverified("nfl not final"), derive);
			expect([v.action, v.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		}
	});

	test("with seat 3 counting, its result read again must read: silent, a part of the game, or no result, and nothing is written", () => {
		const result = (change: (rows: Record<string, unknown>[]) => unknown): Derive => (s, p, b) => (s === 3 && p === `/results/${BEARS}` ? change(copy(b) as Record<string, unknown>[]) : b);
		// An answer the reader could not use (a part of the game, the row twice) and clean silence (no row
		// for the hint) alike write nothing; the line says which.
		const rows: [string, Derive, string][] = [
			["a half's row", result((rs) => rs.map((r) => ({ ...r, OddType: "FirstHalf" }))), "seat 3 answered but could not be used: hint names a part of the game"],
			["no row for the hint", result(() => []), "seat 3 can't be read as scoring will: no result for the hint"],
			["the row twice", result((rs) => [...rs, ...rs]), "seat 3 answered but could not be used: duplicate result"],
		];
		for (const [what, derive, why] of rows) {
			const v = verify(unverified("nfl not final"), derive);
			expect({ what, got: [v.action, v.why] }).toEqual({ what, got: ["wait", why] });
		}
		// The hint's finished row twice, or beside a row the reader can't parse: an answer the reader could
		// not use, and no start is written (types.ts, answer), as for a finished row without points.
		const finished = (r: Record<string, unknown>): Record<string, unknown> => ({ ...r, Final: true, FinalType: "Finished", HomeScore: "24", AwayScore: "17" });
		const said: [string, Derive, string][] = [
			["the finished row twice", result((rs) => [...rs.map(finished), ...rs.map(finished)]), "duplicate result"],
			["the finished row, then a row the reader can't parse", result((rs) => [...rs.map(finished), null]), 'unreadable record; the hint\'s row says "Finished", Final true'],
		];
		for (const [what, derive, detail] of said) {
			const v = verify(unverified("nfl not final"), derive);
			expect({ what, got: [v.action, v.why, v.report] }).toEqual({ what, got: ["wait", `seat 3 answered but could not be used: ${detail}`, null] });
		}
		const t = saved(undefined, NOW);
		const o = scoreGameSync(unverified("nfl not final"), KEYS, PAYOUT, NOW, (q) => (q.url.includes("/results/") ? { status: 503, body: "" } : t.send(q)));
		expect([o.decision.action, o.decision.why]).toEqual(["wait", "seat 3 can't be read as scoring will: http 503"]);
		// The control: the result as saved, the game not yet final.
		expect(verify(unverified("nfl not final")).action).toBe("start");
	});

	test("the two-stage case end to end: a malformed board row writes no start, and the normal start then disputes a dissenting seat 3", () => {
		// Stage 1, at 17:30 on 22 Oct: the hinted row's id null makes the run wait, with no start report.
		const malformed = verify(unverified("nfl not final"), undefined, NOW, [{ ...boardRows().own, ID: null }]);
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

	test("the board check on its own: the hint's row listed binds; no row for it fails as missing, whatever date the game is given", () => {
		const check = (hints: Game["hints"], date: number, derive?: Derive): BoardCheck => {
			const t = saved(derive, NOW);
			const game: Game = { league: "nfl", home: "Chicago Bears", away: "New England Patriots", start: date - 86_400, n: 2 * 86_400 + 1, hints };
			const run = checkBoard({ game, now: NOW, key: KEY, near: date });
			let step = run.next(undefined as unknown as HttpResponse);
			while (!step.done) step = run.next(t.send(step.value));
			expect(t.misses).toEqual([]);
			return step.value;
		};
		const own = [{ seat: 3, id: BEARS }];
		expect(check(own, at("2026-10-23T00:15:00Z"))).toEqual({ kind: "listed", id: BEARS, time: at("2026-10-23T00:15:00Z") });
		// A hint the board has no row for fails as missing on a game dated weeks ahead and on one dated at the row's time alike.
		const missing = [{ seat: 3, id: "00000000-0000-4000-8000-000000000000" }];
		for (const date of [at("2026-11-20T00:15:00Z"), at("2026-11-01T17:00:00Z"), at("2026-10-23T00:15:00Z")]) {
			expect({ date, got: check(missing, date) }).toEqual({ date, got: { kind: "fails", why: "hint not on the board", missing: true } });
		}
		// An empty answer is the board's answer about the hint, not a reading of the game: missing.
		expect(check(own, at("2026-10-23T00:15:00Z"), (s, p, b) => (s === 3 && p === "/odds/NFL?oddType=Game" ? [] : b))).toEqual({ kind: "fails", why: "hint not on the board", missing: true });
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
		// Asked for the two teams over that range, seat 1's answer holds no game of theirs within a day of
		// the date (src/pick.ts: a team's own answer with nothing in it is the game's absence). Nothing is
		// written; the range's own edges are the test above.
		const t = saved(undefined, NOW);
		const far = scoreGameSync({ ...long, date: at("2026-10-23T00:15:00Z") - START_BOUND - 60, hints: [] }, KEYS, PAYOUT, NOW, t.send);
		expect(t.misses).toEqual([]);
		expect([far.decision.action, far.decision.why]).toEqual(["wait", "seat 1 is silent: outside window"]);
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
		expect([between.action, between.why]).toEqual(["wait", "seat 1 answered but could not be used: ambiguous"]);
	});

	test("the nearest decides among the two teams' records; one of the game's teams beside an unknown name counts only where scoring would see it", () => {
		// The doubleheader again, created for the second game, with a third record at seat 1. Seat 1 has
		// no hint, so the only-one rule decides.
		//   * One of the game's teams beside a name the lists don't know: ignored near the date, as at
		//     scoring outside the window. At 22:15 the evening before it sits inside the range
		//     verification reads and outside the second game's window, so the start is written and
		//     scoring reads the game. At 06:00 it is inside the window: the re-read reads seat 1 as
		//     scoring will, sees it, and nothing is written.
		//   * The two teams with no game time: could be the game anywhere, near the date as in the window.
		const beside = (third: (g: Record<string, any>) => Record<string, any>): Derive => (seat, path, body) => {
			const b = dh(seat, path, body);
			if (seat !== 1 || !path.startsWith("/nfl/v1/games?")) return b;
			const c = b as { data: Record<string, any>[] };
			const g = c.data.find((x) => x.id === 1392309);
			if (g) c.data.push(third({ ...g, id: 9_999_003 }));
			return c;
		};
		const unknownAt = (date: string) => beside((g) => ({ ...g, date, visitor_team: { ...g.visitor_team, full_name: "Springfield Isotopes" } }));
		const game = unverified("nfl not final", { date: at("2026-10-23T04:00:00Z"), hints: [] });
		const rows: [string, Derive, string, string | null][] = [
			["the doubleheader alone", dh, "start", "2026-10-23T04:15:00Z"],
			["beside one team and an unknown name, at 22:15 the evening before", unknownAt("2026-10-22T22:15:00.000Z"), "start", "2026-10-23T04:15:00Z"],
			["beside one team and an unknown name, at 06:00, inside the window", unknownAt("2026-10-23T06:00:00.000Z"), "wait", "seat 1 answered but could not be used: ambiguous"],
			["beside the two teams with no time", beside((g) => ({ ...g, date: null })), "wait", "seat 1 answered but could not be used: ambiguous"],
		];
		const got = rows.map(([what, derive]) => {
			const v = verify(game, derive);
			return [what, v.action, v.action === "start" ? v.start : v.why];
		});
		expect(got).toEqual(rows.map(([what, , action, then]) => [what, action, then]));
	});

	test("the saved 2 Nov college basketball answers: two schools the lists can't place at 23:00 no longer keep seats 1 and 2 from the games after them", () => {
		// West Florida against Southeastern Baptist at 23:00 on 2 Nov (seat 1 id 10882497, seat 2 id 342404),
		// neither school on the lists, is a day before Memphis at Iowa State and Morehead State at Western
		// Kentucky, inside the range verification reads near each date. Asked for each game's own two
		// teams, neither seat's answer carries the two schools' record at all, and each reads the game. 1 Nov
		// was never saved: every range here asks it, so it is dropped from the dates asked.
		const games: [string, string, string, string, Record<1 | 2, string>][] = [
			["Memphis at Iowa State", "Iowa State", "Memphis", "2026-11-03T00:00:00Z", { 1: "10882536", 2: "341752" }],
			["Morehead State at Western Kentucky", "Western Kentucky", "Morehead State", "2026-11-03T00:30:00Z", { 1: "10882439", 2: "342166" }],
		];
		const read = (seat: 1 | 2, home: string, away: string, date: number) => {
			const t = saved(undefined, MID);
			const probe: Game = { league: "ncaab", home, away, start: date - START_BOUND, n: 2 * START_BOUND + 1, hints: [] };
			const r = runSync(seat, readerFor(seat)({ game: probe, now: MID, key: KEY, near: date }), (q) => t.send({ ...q, url: q.url.replace("dates[]=2026-11-01&", "").replace("date=2026-11-01,", "date=2026-11-02,") }));
			expect(t.misses).toEqual([]);
			// The setup: the two schools' record is on the 2 Nov slate the answers are drawn from, and in none of
			// the answers, which hold the two teams' games alone.
			const asked = t.asked.map((q) => JSON.parse(t.send(q).body) as Record<string, Record<string, any>[]>);
			const records = asked.flatMap((b) => b[seat === 1 ? "data" : "results"] ?? []);
			const slate = JSON.parse(saved(undefined, MID).send(request(seat, seat === 1 ? "/ncaab/v1/games?dates[]=2026-11-02&per_page=100" : "/games?league=NCAAB&date=2026-11-02", KEY)).body) as Record<string, Record<string, any>[]>;
			const onSlate = (slate[seat === 1 ? "data" : "results"] ?? []).some((g) => (seat === 1 ? g.id === 10882497 : g.gameId === 342404));
			const inAnswers = records.some((g) => (seat === 1 ? g.id === 10882497 : g.gameId === 342404));
			expect({ seat, onSlate, inAnswers, records: records.length > 0 }).toEqual({ seat, onSlate: true, inAnswers: false, records: true });
			return r;
		};
		for (const [what, home, away, date, own] of games) {
			for (const seat of [1, 2] as const) {
				const r = read(seat, home, away, at(date));
				expect({ what, seat, got: [r.kind, r.record?.id] }).toEqual({ what, seat, got: ["no_final", own[seat]] });
			}
		}
	});

	test("a record pairing one of the game's teams with a side the feed marks outside the league, the evening before, stops nothing near the date", () => {
		// Seat 2's real 2 Nov answer for Memphis at Iowa State (00:00 on 3 Nov), and a copy of it at 23:30
		// the evening before whose home side the feed gives no conference, which marks it outside the
		// league. A marked side never resolves, so the copy is a record the lists can't place: one of the
		// game's teams beside a team marked outside. It is inside the range verification reads, earlier
		// than the game, and before the window from the game's start, so scoring would never weigh it:
		// near the date it stops nothing either.
		const iowa = { home: "Iowa State", away: "Memphis", date: at("2026-11-03T00:00:00Z") };
		const marked: Derive = (s, p, b) => {
			if (s !== 2 || !p.startsWith("/games?league=NCAAB&date=2026-11-02")) return b;
			const c = copy(b) as { results: Record<string, any>[] };
			// The game is filed under 2 Nov at seat 2; the copy goes on the page that holds it.
			const g = c.results.find((x) => x.gameId === 341752);
			if (g) c.results.push({ ...copy(g), gameId: 9_999_201, schedule: { ...g.schedule, date: "2026-11-02T23:30:00.000Z" }, teams: { ...g.teams, home: { ...g.teams.home, conference: undefined } } });
			return c;
		};
		const t = saved(marked, MID);
		const probe: Game = { league: "ncaab", home: iowa.home, away: iowa.away, start: iowa.date - START_BOUND, n: 2 * START_BOUND + 1, hints: [] };
		const r = runSync(2, readerFor(2)({ game: probe, now: MID, key: KEY, near: iowa.date }), (q) => t.send({ ...q, url: q.url.replace("date=2026-11-01,", "date=2026-11-02,") }));
		expect(t.misses).toEqual([]);
		// The setup: the copy is in the answer (Iowa State's own, asked for by its name), marked, inside the
		// range and earlier than the game.
		const asked = t.asked.map((q) => (JSON.parse(t.send(q).body) as { results: Record<string, any>[] }).results ?? []).flat();
		const copyOf = asked.find((g) => g.gameId === 9_999_201);
		expect([copyOf?.schedule?.date, copyOf?.teams?.home?.conference]).toEqual(["2026-11-02T23:30:00.000Z", undefined]);
		expect([r.kind, r.record?.id ?? null]).toEqual(["no_final", "341752"]);
	});

	test("a record the lists can't place stops verification only where it would stop scoring: in the window from the start chosen", () => {
		// The readers' only-one rule, a record whose two names the lists don't know, inside the window
		// and earlier than a record of the two teams, is weighed at verification where scoring weighs it:
		// in the window from the start chosen, when every seat is read again as scoring will read it.
		// The read near the date, a day either side, doesn't weigh it. So a record before the window
		// starts nothing waiting, nor does one the first game's hints step past at scoring. One inside the
		// window and earlier than the seat's own record of the game makes the run wait, as scoring would.
		// The extra record sits at seat 1, and every row's other seats are as saved or as the doubleheader.
		const unplacedAt = (base: Derive | undefined, time: string): Derive => (seat, path, body) => {
			const b = base === undefined ? body : base(seat, path, body);
			if (seat !== 1 || !path.startsWith("/nfl/v1/games?")) return b;
			const c = copy(b) as { data: Record<string, any>[] };
			const g = c.data.find((x) => x.id === 1392309);
			if (g) {
				c.data.push({
					...g,
					id: 9_999_003,
					date: time,
					home_team: { ...g.home_team, full_name: "Shelbyville Shelbyvillians" },
					visitor_team: { ...g.visitor_team, full_name: "Springfield Isotopes" },
				});
			}
			return c;
		};
		const one = unverified("nfl not final");
		const first = unverified("nfl not final", { date: at("2026-10-23T00:15:00Z"), hints: [{ seat: 3, id: BEARS }, ...FIRST] });
		const second = unverified("nfl not final", { date: at("2026-10-23T04:00:00Z"), hints: [] });
		// Seat 1 lists the one game at 00:20, five minutes after seats 2 and 3: the start is 00:15, and seat
		// 1's own record sits inside the window, five minutes in.
		const seat1At2020: Derive = (seat, path, body) => {
			if (seat !== 1 || !path.startsWith("/nfl/v1/games?")) return body;
			const c = copy(body) as { data: Record<string, any>[] };
			for (const g of c.data) if (g.id === 1392309) g.date = "2026-10-23T00:20:00.000Z";
			return c;
		};
		const WAIT = "seat 1 answered but could not be used: ambiguous";
		const rows: [string, ChainGame, Derive | undefined, string, string][] = [
			["one game, as saved", one, undefined, "start", "2026-10-23T00:15:00Z"],
			["one game, an unplaced record at 22:15 the evening before, before the window", one, unplacedAt(undefined, "2026-10-22T22:15:00.000Z"), "start", "2026-10-23T00:15:00Z"],
			["one game, an unplaced record at 02:00, after it", one, unplacedAt(undefined, "2026-10-23T02:00:00.000Z"), "start", "2026-10-23T00:15:00Z"],
			["the doubleheader's first game", first, dh, "start", "2026-10-23T00:15:00Z"],
			["the doubleheader's first game, an unplaced record at 02:00, which its hints step past at scoring", first, unplacedAt(dh, "2026-10-23T02:00:00.000Z"), "start", "2026-10-23T00:15:00Z"],
			["the doubleheader's first game, an unplaced record at 06:00, after both", first, unplacedAt(dh, "2026-10-23T06:00:00.000Z"), "start", "2026-10-23T00:15:00Z"],
			["the doubleheader's second game", second, dh, "start", "2026-10-23T04:15:00Z"],
			["the doubleheader's second game, an unplaced record at 22:15 the evening before, before the window", second, unplacedAt(dh, "2026-10-22T22:15:00.000Z"), "start", "2026-10-23T04:15:00Z"],
			["the doubleheader's second game, an unplaced record at 04:15, the nearest record's own instant", second, unplacedAt(dh, "2026-10-23T04:15:00.000Z"), "start", "2026-10-23T04:15:00Z"],
			["the doubleheader's second game, an unplaced record at 06:00, after both", second, unplacedAt(dh, "2026-10-23T06:00:00.000Z"), "start", "2026-10-23T04:15:00Z"],
			["one game, seat 1 at 00:20", one, seat1At2020, "start", "2026-10-23T00:15:00Z"],
			["one game, seat 1 at 00:20, an unplaced record at 00:17, inside the window and earlier", one, unplacedAt(seat1At2020, "2026-10-23T00:17:00.000Z"), "wait", WAIT],
			["one game, seat 1 at 00:20, an unplaced record at 00:15, the window's first instant", one, unplacedAt(seat1At2020, "2026-10-23T00:15:00.000Z"), "wait", WAIT],
			["one game, seat 1 at 00:20, an unplaced record a second before the window", one, unplacedAt(seat1At2020, "2026-10-23T00:14:59.000Z"), "start", "2026-10-23T00:15:00Z"],
			["one game, seat 1 at 00:20, an unplaced record at 00:20, seat 1's own instant", one, unplacedAt(seat1At2020, "2026-10-23T00:20:00.000Z"), "start", "2026-10-23T00:15:00Z"],
		];
		const got = rows.map(([what, game, derive]) => {
			const v = verify(game, derive);
			return [what, v.action, v.action === "start" ? v.start : v.why];
		});
		expect(got).toEqual(rows.map(([what, , , action, then]) => [what, action, then]));
	});
});

describe("seat 3's result the reader could not use, at verification", () => {
	test("the board without the hint's row and the result listed twice: seat 3 stands down exactly as it does for no result, the spare stands in, and the start is written; a final there holds the start; the spare ambiguous holds it too", () => {
		const result = (change: (rows: Record<string, unknown>[]) => unknown): Derive => (s, p, b) => (s === 3 && p === `/results/${BEARS}` ? change(copy(b) as Record<string, unknown>[]) : b);
		const stood = ["start", "seats 1 and 2 list the game within an hour, and the spare stands in for seat 3", "2026-10-23T00:15:00Z", "3:silent for the game: hint not on the board"];
		for (const [what, change] of [
			["the row twice", (rs: Record<string, unknown>[]) => [...rs, ...rs]],
			["the row without points, finished", (rs: Record<string, unknown>[]) => rs.map((r) => ({ ...r, Final: true, FinalType: "Finished", HomeScore: null, AwayScore: null }))],
			["a half's row", (rs: Record<string, unknown>[]) => rs.map((r) => ({ ...r, OddType: "FirstHalf" }))],
			["no row for the hint", () => []],
		] as const) {
			const v = verify(unverified("nfl not final"), result(change), NOW, []);
			expect({ what, got: [v.action, v.why, v.start, v.seats[2]] }).toEqual({ what, got: stood });
		}
		// A final there: the game is over, and nothing is written.
		const finished = verify(unverified("nfl not final"), result((rs) => rs.map((r) => ({ ...r, Final: true, FinalType: "Finished", HomeScore: "24", AwayScore: "17" }))), NOW, []);
		expect([finished.action, finished.why]).toEqual(["wait", "seat 3 shows the game final"]);
		// A read that failed teaches nothing: the run waits.
		const t = saved(result((rs) => [...rs, ...rs]), NOW);
		const failed = scoreGameSync(unverified("nfl not final"), KEYS, PAYOUT, NOW, (q) => (q.method === "POST" ? { status: 200, body: "[]" } : q.url.includes("/results/") ? { status: 503, body: "" } : t.send(q)));
		expect([failed.decision.action, failed.decision.why]).toEqual(["wait", "seat 3's result is silent: http 503"]);
		// The spare's ambiguity rules still hold the start: a second row of the two teams at the same time under
		// another id, and seat 3 stood down for a spare that cannot say which row is the game.
		const twoRows: Derive = (s, p, b) => {
			if (s === 3 && p === `/results/${BEARS}`) return [...(b as unknown[]), ...(b as unknown[])];
			if (s !== 4 || !p.includes("americanfootball_nfl")) return b;
			const rows = copy(b) as Record<string, any>[];
			const own = rows.find((r) => r.id === "ffebea881c1d7b2dfb85b3e590c35985");
			if (own) rows.push({ ...own, id: "0000000000000000000000000000000f" });
			return rows;
		};
		const ambiguous = verify(unverified("nfl not final"), twoRows, NOW, []);
		expect([ambiguous.action, ambiguous.why, ambiguous.report]).toEqual(["wait", "seat 3 is silent for the game and the spare is silent: ambiguous", null]);
	});
});
