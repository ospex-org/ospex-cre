// Never: "The hour-24 void posts beside a reading that is neither clean silence nor an affirmative row,
// or on fewer than two counting seats' affirmative answers."
//
// The hour-24 void is every void a run decides before a dispute record (a day-7 void can hold
// finals, 2-2 among them, and is held to day 7's own line in never-day7.test.ts). An affirmative
// answer is the game's own row whose status in the feed's own words says the game will not or did not
// play: postponed or cancelled, and nothing else (the reading's `recorded`), read as the game and not
// chosen by its hint beside another row that could be the game; a row that says the game is scheduled
// or in play is an answer, not a void's vote. A void is held to the finals' count after n: two counting
// seats or more affirm, and the rest of the counting seats are silent. And the void's silence is only
// clean silence (types.ts, answer "nothing"): an answer that held nothing of the game, because it was
// empty, the game was absent from it or its record outside the window, the request failed before any
// row arrived, or the seat is past its window by date arithmetic. Every other reading that is not an
// affirmative row holds the void, whatever the word was: an answer the reader could not use (a row of
// the game without a usable id, a status word or points, a word it does not recognize, a final short of
// a whole game, a part of the game, a row that would not parse, a failure or the reader's own cap
// partway through the seat's reads after rows arrived, two rows that could be the game, two answers
// that disagree about it), or the game's row chosen by its hint beside another that could be the game;
// the run waits, its line naming the seat and the class, and a status word the reader does not know
// verbatim (`seat 1 answered but could not be used: unrecognized status "PPD"`).
//
// Counted by hand over ten states a seat can read (silent, clean; none, an answer in play; sched, the
// game's row scheduled, an answer all the same; off, a postponed answer; the finals A and B; and four
// answers the reader could not use: dup, the result listed twice; nopts, a final without points; null,
// a row that would not parse; bare, a row without a status. The spare is never off, since its feed has
// no such word, but it reads each of the four): a void needs no final at any seat, every silence clean,
// two or more counting seats off, the rest of the counting seats silent, and the window closed. Seat 3
// counting: two off and the third silent (3) or three off (1), the spare silent, in play or scheduled
// (3): 12. The spare standing in for seat 3 (counting 1, 2 and 4): seats 1 and 2 off, the spare
// silent, seat 3 silent, in play, scheduled or off (4): 4. Sixteen in all, all after n, of 10 x 10 x 10
// x 9 states x 2 counting sets x 2 clocks = 36,000; the four unusable states add none, at a counting
// seat or not: none is clean silence, none is an affirmative row. Inside n, none. A scheduled row adds
// no void anywhere: it is never a vote.
//
// The breaks that turn this red:
//   rule.ts, decide: the class ignored by the void,
//     if (finals.length === 0 && held.length > 0) {
//     ->  if (false) {
//   with which seat 3's result listed twice, a final without points, a row without a status, and the
//   rest of the unusable answers void beside two affirmative rows;
//   run.ts, runSync and runAsync: a reader exiting on a cap or a throw after rows arrived read as clean silence,
//     const dropped = (detail: string): Reading => (delivered > 0 ? silent(seat, detail) : clean(seat, detail));
//     ->  const dropped = (detail: string): Reading => clean(seat, detail);
//   with which a transport that throws after the first page, and the reader's own cap after it, void
//   beside two affirmative rows;
//   rule.ts, decide: the void's count taken from any answer,
//     const affirmed = counted.filter(affirmsNoFinal).length;
//     ->  const affirmed = answeredCounted;
//   with which two answers in play, or two scheduled rows, void the game at hour 24;
//   rule.ts, decide: the rest-silent clause dropped,
//     if (affirmed >= AGREE.afterN && answeredCounted === affirmed) return { action: "void", ...
//     ->  if (affirmed >= AGREE.afterN) return { action: "void", ...
//   with which two postponed rows void beside a third counting seat that says the game is on;
//   pick.ts, readingOf: a scheduled row read as a void's vote,
//     const recorded = r.state === "postponed" || r.state === "canceled" ? r.state : null;
//     ->  const recorded = r.state === "postponed" || r.state === "canceled" ? r.state : r.status === "scheduled" ? "postponed" : null;
//   with which the rainout voids on seat 1 postponed beside seat 2 scheduled, and two scheduled rows void.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { scoreGameSync } from "../src/program";
import { affirmsNoFinal, decide } from "../src/rule";
import type { HttpRequest, HttpResponse, Reading, Seat } from "../src/types";
import { CASES, NOW } from "./cases";
import { KEY, copy, locate, saved, type Derive } from "./fixtures";
import { PAYOUT, SEATS4, chainOf, reading, type State } from "./rule-helpers";

const SETS: readonly (readonly Seat[])[] = [
	[1, 2, 3],
	[1, 2, 4],
];
const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

/** The sweep's four states and six more: sched; off, the one affirmative answer without a final; and four answers the reader could not use. */
type Ten = State | "sched" | "off" | "dup" | "nopts" | "null" | "bare";
const TEN: readonly Ten[] = ["silent", "none", "sched", "off", "A", "B", "dup", "nopts", "null", "bare"];
/** The spare's feed has no word that a game will not play: it is never off. */
const SPARE_STATES: readonly Ten[] = ["silent", "none", "sched", "A", "B", "dup", "nopts", "null", "bare"];
/** What each unusable state's reader wrote for it (seat 3's words for the first; the class is what the rule reads). */
const UNUSABLE: Readonly<Record<"dup" | "nopts" | "null" | "bare", string>> = { dup: "duplicate result", nopts: "final without points", null: "unreadable record", bare: "no status" };
/** For the edges: the game's postponed row, chosen by its hint beside another row that could be the game. */
type Edge = Ten | "chosen";

function of(seat: Seat, s: Edge): Reading {
	if (s === "off") return { seat, kind: "no_final", home: null, away: null, recorded: "postponed", detail: "postponed", record: { id: `r${seat}`, time: null }, answer: "the game" };
	if (s === "chosen") return { ...of(seat, "off"), answer: "chosen" };
	if (s === "sched") return { seat, kind: "no_final", home: null, away: null, recorded: null, detail: "scheduled", record: { id: `r${seat}`, time: null }, answer: "the game" };
	if (s === "dup" || s === "nopts" || s === "null" || s === "bare") return { ...reading(seat, "silent"), detail: UNUSABLE[s], answer: "unusable" };
	return reading(seat, s);
}

/** Every assignment of a state to each seat: 10 x 10 x 10 x 9 = 9,000. */
function* everyTen(): Generator<readonly [Ten, Ten, Ten, Ten]> {
	for (const a of TEN) for (const b of TEN) for (const c of TEN) for (const d of SPARE_STATES) yield [a, b, c, d];
}

/** A reading that holds the void: silence that is not clean, or the game's row chosen beside another. */
const holds = (r: Reading): boolean => (r.kind === "silent" && r.answer !== "nothing") || r.answer === "chosen";

describe("never: the hour-24 void beside a reading that is neither clean silence nor an affirmative row, or on fewer than two affirmative answers", () => {
	test("no void in the sweep has a final, a silence that is not clean, or fewer than two counting seats postponed with the rest silent; none comes inside the window, none rests on a scheduled row, and the voids are the ones counted by hand", () => {
		const voids = { inside: 0, after: 0 };
		let swept = 0;
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const states of everyTen()) {
					swept++;
					const readings = SEATS4.map((s, i) => of(s, states[i]));
					const d = decide(readings, counting, inside);
					if (d.action !== "void") continue;
					voids[inside ? "inside" : "after"]++;
					const where = { counting, inside, states };
					expect({ ...where, finals: readings.filter((r) => r.kind === "final").map((r) => r.seat), held: readings.filter(holds).map((r) => r.seat) }).toEqual({ ...where, finals: [], held: [] });
					expect({ ...where, clean: readings.filter((r) => r.kind === "silent").every((r) => r.answer === "nothing") }).toEqual({ ...where, clean: true });
					const counted = counting.map((s) => readings[s - 1]);
					const affirmed = counted.filter(affirmsNoFinal).length;
					const otherAnswers = counted.filter((r) => r.kind !== "silent" && !affirmsNoFinal(r)).length;
					expect({ ...where, enough: affirmed >= 2, restSilent: otherAnswers === 0, scheduledCounting: counted.some((r) => r.detail === "scheduled") }).toEqual({ ...where, enough: true, restSilent: true, scheduledCounting: false });
				}
			}
		}
		expect({ swept, voids }).toEqual({ swept: 36_000, voids: { inside: 0, after: 16 } });
	});

	test("the edges, by name", () => {
		const d = (counting: readonly Seat[], inside: boolean, states: Edge[]) => decide(SEATS4.map((s, i) => of(s, states[i])), counting, inside).action;
		const rows: [readonly Seat[], boolean, Edge[], string][] = [
			[[1, 2, 3], false, ["off", "off", "silent", "silent"], "void"],
			[[1, 2, 3], false, ["off", "off", "off", "none"], "void"], // the spare in play does not count, and never blocks
			[[1, 2, 3], false, ["off", "off", "silent", "sched"], "void"], // the spare scheduled: the same
			[[1, 2, 3], false, ["off", "off", "none", "silent"], "wait"], // a counting seat in play holds the void, as it would a score
			[[1, 2, 3], false, ["off", "off", "sched", "silent"], "wait"], // a counting seat scheduled holds it the same way
			[[1, 2, 3], false, ["off", "sched", "silent", "silent"], "wait"], // one postponed beside one scheduled: one vote
			[[1, 2, 3], false, ["sched", "sched", "silent", "silent"], "wait"], // two scheduled rows are no votes
			[[1, 2, 3], false, ["off", "none", "silent", "silent"], "wait"], // one affirmative answer
			[[1, 2, 3], false, ["none", "none", "silent", "silent"], "wait"], // two answers in play are no void's votes
			[[1, 2, 3], false, ["off", "silent", "silent", "silent"], "wait"], // fewer than two counting seats answer
			[[1, 2, 3], false, ["off", "off", "silent", "A"], "dispute"], // the spare's final: no void, a disagreement
			[[1, 2, 4], false, ["off", "off", "A", "silent"], "dispute"], // seat 3 does not count here, but it answers with a final
			[[1, 2, 4], false, ["off", "off", "silent", "silent"], "void"],
			[[1, 2, 4], false, ["off", "off", "sched", "silent"], "void"], // seat 3 silent for the game: its row does not count
			[[1, 2, 4], false, ["off", "off", "silent", "sched"], "wait"], // the counting spare scheduled holds the void
			[[1, 2, 3], true, ["off", "off", "off", "silent"], "wait"], // never inside the window
			// The void's silence is only clean silence: an answer the reader could not use holds it, at any seat asked.
			[[1, 2, 3], false, ["off", "off", "dup", "silent"], "wait"], // seat 3's result listed twice
			[[1, 2, 3], false, ["nopts", "off", "off", "silent"], "wait"], // seat 1's final without points
			[[1, 2, 3], false, ["off", "null", "off", "silent"], "wait"], // seat 2's row that would not parse
			[[1, 2, 3], false, ["off", "off", "bare", "silent"], "wait"], // seat 3's row without a status: silence to a score, not to the void
			[[1, 2, 3], false, ["off", "off", "silent", "bare"], "wait"], // the spare, not counting, with a row without a status: it holds the void
			[[1, 2, 3], false, ["off", "off", "silent", "nopts"], "wait"], // the spare, not counting, with a final without points: the same
			[[1, 2, 4], false, ["off", "off", "silent", "dup"], "wait"], // the spare standing in
			[[1, 2, 4], false, ["off", "off", "nopts", "silent"], "wait"], // a reading for seat 3 handed to the rule while it does not count: it holds here too
			[[1, 2, 3], false, ["dup", "off", "silent", "silent"], "wait"], // one affirmative answer beside an unusable one: a wait either way
			[[1, 2, 3], true, ["off", "off", "dup", "silent"], "wait"], // never inside the window
			// The game's postponed row chosen by its hint beside another row that could be the game: an answer to a score, and it holds the void.
			[[1, 2, 3], false, ["chosen", "off", "off", "silent"], "wait"],
			[[1, 2, 3], false, ["off", "chosen", "silent", "silent"], "wait"],
			// Scoring unchanged: silent to the score, an unusable answer neither makes a final nor blocks one.
			[[1, 2, 3], false, ["A", "A", "dup", "silent"], "score"], // two finals, the rest silent
			[[1, 2, 3], false, ["A", "A", "bare", "silent"], "score"],
			[[1, 2, 3], false, ["A", "dup", "off", "silent"], "dispute"], // a final beside an answer without one: the record, as before
			[[1, 2, 3], false, ["A", "B", "nopts", "silent"], "dispute"], // two finals that differ
			[[1, 2, 3], false, ["A", "chosen", "silent", "silent"], "dispute"], // a final beside the chosen postponed row: an answer, the record
			[[1, 2, 3], true, ["A", "A", "nopts", "silent"], "wait"], // inside n, a silent counting seat blocks, as before
		];
		for (const [counting, inside, states, want] of rows) {
			expect({ counting, inside, states, got: d(counting, inside, states) }).toEqual({ counting, inside, states, got: want });
		}
		// The line of a run that waits on the count says what each seat gave.
		const one = decide(SEATS4.map((s, i) => of(s, (["off", "sched", "silent", "silent"] as Edge[])[i])), [1, 2, 3], false);
		expect([one.action, one.why]).toEqual(["wait", "after n: 1 counting seat says the game will not or did not play, two needed; seat 1 postponed, seat 2 scheduled, seat 3 silence (silent), seat 4 silence (silent)"]);
		const none = decide(SEATS4.map((s, i) => of(s, (["sched", "sched", "silent", "none"] as Edge[])[i])), [1, 2, 3], false);
		expect([none.action, none.why]).toEqual(["wait", "after n: 0 counting seats say the game will not or did not play, two needed; seat 1 scheduled, seat 2 scheduled, seat 3 silence (silent), seat 4 in progress"]);
		// The line of a run that waits on the class names the seat and what the reader did with the answer.
		const word = decide(SEATS4.map((s, i) => of(s, (["off", "off", "dup", "silent"] as Edge[])[i])), [1, 2, 3], false);
		expect([word.action, word.why]).toEqual(["wait", "after n: seat 3 answered but could not be used: duplicate result"]);
		const words = decide(SEATS4.map((s, i) => of(s, (["nopts", "off", "dup", "silent"] as Edge[])[i])), [1, 2, 3], false);
		expect([words.action, words.why]).toEqual(["wait", "after n: seat 1 answered but could not be used: final without points; seat 3 answered but could not be used: duplicate result"]);
		const chosen = decide(SEATS4.map((s, i) => of(s, (["chosen", "off", "off", "silent"] as Edge[])[i])), [1, 2, 3], false);
		expect([chosen.action, chosen.why]).toEqual(["wait", "after n: seat 1 answered by its hint beside another row that could be the game: postponed"]);
	});

	// The artifact, on real answers: Atlanta at the White Sox, 11 Jun, rained out. Seat 1 reads it
	// postponed and seat 2 cancelled, at its own time; the game was created without a seat 3 hint, so
	// the spare counts in seat 3's place, and the spare keeps three days, so on 22 Oct it is silent.
	const rainout = chainOf("mlb postponed");

	test("end to end: a postponed game voids after its window on two affirmative rows; a scheduled row is no vote, and with one the run waits; a final at any seat stops the void", () => {
		const out = (derive?: Derive) => {
			const t = saved(derive, NOW);
			const o = scoreGameSync(rainout, KEYS, PAYOUT, NOW, t.send);
			expect(t.misses).toEqual([]);
			return { action: o.decision.action, why: o.decision.why, kind: o.report?.kind ?? null, readings: o.report?.readings.map((r) => [r.seat, r.kind]) ?? null };
		};
		const seat1 = (fields: Record<string, unknown>): Derive => (s, p, body) => {
			if (s !== 1 || !p.includes("/mlb/v1/games")) return body;
			const b = copy(body) as { data: Record<string, any>[] };
			for (const g of b.data) if (g.id === 5058800) Object.assign(g, fields);
			return b;
		};
		const seat2 = (fields: Record<string, unknown>): Derive => (s, p, body) => {
			if (s !== 2 || !p.includes("league=MLB")) return body;
			const b = copy(body) as { results: Record<string, any>[] };
			for (const g of b.results) if (g.gameId === 336995) Object.assign(g, fields);
			return b;
		};
		const both = (...ds: Derive[]): Derive => (s, p, b) => ds.reduce((acc, f) => f(s, p, acc), b);
		expect(out()).toMatchObject({ action: "void", kind: 3, readings: [[1, 1], [2, 1], [3, 0], [4, 0]] });
		// Seat 2 saying the game is scheduled, in its own word: an answer, not a vote; one affirmative row,
		// and the run waits, its line saying what each seat gave.
		const scheduled = out(seat2({ status: "scheduled" }));
		expect([scheduled.action, scheduled.kind, scheduled.why]).toEqual(["wait", null, "after n: 1 counting seat says the game will not or did not play, two needed; seat 1 postponed, seat 2 scheduled, seat 3 silence (silent for the game), seat 4 silence (closed: past its window)"]);
		// Both seats saying scheduled, the rest silent: no vote at all, and the run waits.
		const twoScheduled = out(both(seat1({ status_state: "scheduled" }), seat2({ status: "scheduled" })));
		expect([twoScheduled.action, twoScheduled.kind, twoScheduled.why]).toEqual(["wait", null, "after n: 0 counting seats say the game will not or did not play, two needed; seat 1 scheduled, seat 2 scheduled, seat 3 silence (silent for the game), seat 4 silence (closed: past its window)"]);
		// Seat 2 saying the game is in play: the same, one vote beside an answer.
		const inPlay = out(seat2({ status: "in progress", scoreboard: { currentPeriod: 3, score: { home: 2, away: 1 } } }));
		expect([inPlay.action, inPlay.kind, inPlay.why]).toEqual(["wait", null, "after n: 1 counting seat says the game will not or did not play, two needed; seat 1 postponed, seat 2 in progress, seat 3 silence (silent for the game), seat 4 silence (closed: past its window)"]);
		// Seat 2's row without a status: a partial row, silence to a score; the void waits on it, the line naming the seat.
		const partial = out(seat2({ status: undefined }));
		expect([partial.action, partial.kind, partial.why]).toEqual(["wait", null, "after n: seat 2 answered but could not be used: no status"]);
		// Seat 2's row with a word the reader does not know: silent, the word verbatim in the line.
		const ppd = out(seat2({ status: "PPD" }));
		expect([ppd.action, ppd.kind, ppd.why]).toEqual(["wait", null, 'after n: seat 2 answered but could not be used: unrecognized status "PPD"']);
		// Derived from the real answer: seat 2 marks the rained-out game final, 3-1, after nine innings
		// (a final needs the feed's period count to reach the league's regulation).
		expect(out(seat2({ status: "final", scoreboard: { currentPeriod: 9, score: { home: 3, away: 1 } } }))).toMatchObject({ action: "dispute", kind: 4, readings: [[1, 1], [2, 2], [3, 0], [4, 0]] });
	});

	test("the rainout's case is real: its game sits in the readers' cases with the readings the void rests on", () => {
		const c = CASES.find((x) => x.name.startsWith("mlb postponed"))!;
		expect([c.expect[1]?.detail, c.expect[2]?.detail, c.expect[4]?.detail]).toEqual(["postponed", "canceled", "past retention"]);
		expect([c.expect[1]?.recorded, c.expect[2]?.recorded]).toEqual(["postponed", "canceled"]);
	});

	// The routes by which an answer that touched the game reaches the rule, through the readers at hour
	// 24: New England at Chicago, saved before the game with its seat 3 hint bound, the other two counting
	// seats derived to their feeds' own postponed and cancelled, the clock at start + n + ten minutes,
	// the saved answers as of the capture. At each counting seat, and at the spare standing in for seat 3
	// (the game re-read without its seat 3 hint). Each form waits, nothing written, the line naming the
	// seat and the class; the intact final disputes; the control without the row, and the controls whose
	// silence is clean, void.
	const bears = chainOf("nfl not final");
	const spareIn = chainOf("nfl not final", { hints: [] });
	const H24 = (bears.start as number) + bears.n + 600;
	const IDS = { 1: 1392309, 2: 340175, 3: "edcfd41f-1773-4bc9-a349-aa50931a0278", 4: "ffebea881c1d7b2dfb85b3e590c35985" } as const;
	const ID_KEY = { 1: "id", 2: "gameId", 3: "ID", 4: "id" } as const;
	const isOwn = (seat: Seat, r: Record<string, any>): boolean => (seat === 1 ? r.id === IDS[1] : seat === 2 ? r.gameId === IDS[2] : seat === 3 ? String(r.ID).toLowerCase() === IDS[3] : r.id === IDS[4]);
	const ownPath = (seat: Seat, p: string): boolean => (seat === 1 ? p.includes("/nfl/v1/games") : seat === 2 ? p.includes("league=NFL") : seat === 3 ? p === `/results/${IDS[3]}` : p.includes("americanfootball_nfl/scores"));
	/** The game's own row in a seat's saved answer, replaced by what `change` gives for it: none, one or two rows. */
	const rowsAt = (seat: Seat, change: (row: Record<string, any>) => Record<string, any>[]): Derive => (s, p, body) => {
		if (s !== seat || !ownPath(seat, p)) return body;
		const list = (rows: Record<string, any>[]) => rows.flatMap((r) => (isOwn(seat, r) ? change(copy(r)) : [r]));
		if (seat === 1) return { ...(body as object), data: list((body as { data: Record<string, any>[] }).data) };
		if (seat === 2) return { ...(body as object), results: list((body as { results: Record<string, any>[] }).results) };
		return list(body as Record<string, any>[]);
	};
	type Send = (q: HttpRequest) => HttpResponse;
	/** A seat's answer as sent, after the saved answers' filter, changed by `mutate` on the requests `when` picks by path. */
	const afterSend = (seat: Seat, when: (path: string) => boolean, mutate: (body: any) => unknown) => (send: Send): Send => (q) => {
		const res = send(q);
		const at = locate(q);
		if (at === null || at.seat !== seat || res.status !== 200 || !when(at.path)) return res;
		const body = JSON.parse(res.body);
		const out = mutate(body);
		return { status: 200, body: JSON.stringify(out === undefined ? body : out) };
	};
	/** A row the reader can't parse, after the rows of a seat's answer as sent (the saved answers are filtered to the game before they are served, so the row goes on after). */
	const thenNull = (seat: Seat) => afterSend(seat, (p) => ownPath(seat, p), (body) => void (seat === 1 ? body.data : seat === 2 ? body.results : body).push(null));
	/** A transport that throws on the requests `when` picks, and answers the rest. */
	const throwing = (seat: Seat, when: (path: string) => boolean) => (send: Send): Send => (q) => {
		const at = locate(q);
		if (at !== null && at.seat === seat && when(at.path)) throw new Error("the transport failed");
		return send(q);
	};
	const refusing = (seat: Seat, status: number) => (send: Send): Send => (q) => (locate(q)?.seat === seat ? { status, body: "" } : send(q));
	const both = (...ds: Derive[]): Derive => (s, p, b) => ds.reduce((acc, f) => f(s, p, acc), b);
	const wrap = (...ws: ((send: Send) => Send)[]) => (send: Send): Send => ws.reduce((acc, w) => w(acc), send);
	/** Each feed's own final for the game, 24-17 Chicago, whole by its own count. */
	const FINAL: Readonly<Record<Seat, Record<string, unknown>>> = {
		1: { status_state: "final", home_team_score: 24, visitor_team_score: 17, home_team_q1: 7, home_team_q2: 7, home_team_q3: 7, home_team_q4: 3, visitor_team_q1: 7, visitor_team_q2: 3, visitor_team_q3: 7, visitor_team_q4: 0 },
		2: { status: "final", scoreboard: { currentPeriod: 4, score: { home: 24, away: 17 } } },
		3: { Final: true, FinalType: "Finished", HomeScore: "24", AwayScore: "17" },
		4: { completed: true, scores: [{ name: "Chicago Bears", score: "24" }, { name: "New England Patriots", score: "17" }] },
	};
	/** The same final without its points. */
	const NO_POINTS: Readonly<Record<Seat, Record<string, unknown>>> = {
		1: { ...FINAL[1], home_team_score: null, visitor_team_score: null },
		2: { status: "final", scoreboard: { currentPeriod: 4, score: { home: null, away: null } } },
		3: { Final: true, FinalType: "Finished", HomeScore: null, AwayScore: null },
		4: { completed: true, scores: null },
	};
	/** A second copy of the final that differs: other points. */
	const OTHER: Readonly<Record<Seat, Record<string, unknown>>> = {
		1: { home_team_score: 27 },
		2: { scoreboard: { currentPeriod: 4, score: { home: 27, away: 17 } } },
		3: { HomeScore: "27" },
		4: { scores: [{ name: "Chicago Bears", score: "27" }, { name: "New England Patriots", score: "17" }] },
	};
	/** Each feed's own word that the game will not play. */
	const OFF: Readonly<Record<1 | 2 | 3, Record<string, unknown>>> = { 1: { status_state: "postponed" }, 2: { status: "canceled" }, 3: { FinalType: "Postponed" } };
	const off = (seat: 1 | 2 | 3): Derive => rowsAt(seat, (r) => [{ ...r, ...OFF[seat] }]);

	const run = (game: ChainGame, derive: Derive, around: (send: Send) => Send = (s) => s) => {
		const t = saved(derive, NOW);
		const o = scoreGameSync(game, KEYS, PAYOUT, H24, around(t.send));
		expect(t.misses).toEqual([]);
		return { action: o.decision.action, why: o.decision.why, kind: o.report?.kind ?? null, readings: o.report?.readings.map((r) => [r.seat, r.kind]) ?? null };
	};
	const VOID = "after n: two counting seats or more say the game will not or did not play, the rest silent, and no seat shows a final";
	const waits = (seat: Seat, detail: string) => ({ action: "wait", why: `after n: seat ${seat} answered but could not be used: ${detail}`, kind: null, readings: null });
	// For each seat under test: the game, the other two counting seats' affirmative rows, and the seats a report lists.
	const table: [Seat, ChainGame, Derive, number[][]][] = [
		[1, bears, both(off(2), off(3)), [[1, 0], [2, 1], [3, 1], [4, 1]]],
		[2, bears, both(off(1), off(3)), [[1, 1], [2, 0], [3, 1], [4, 1]]],
		[3, bears, both(off(1), off(2)), [[1, 1], [2, 1], [3, 0], [4, 1]]],
		[4, spareIn, both(off(1), off(2)), [[1, 1], [2, 1], [3, 0], [4, 0]]],
	];

	test("end to end, at hour 24: a final the reader could not score, at each counting seat and at the spare standing in, holds the void; the intact final disputes; without the row, the void", () => {
		for (const [seat, game, others, voidReadings] of table) {
			const at = { seat };
			const form = (change: (row: Record<string, any>) => Record<string, any>[]) => both(others, rowsAt(seat, change));
			// The control: no row of the game at this seat, clean silence, the other two affirmative: the void.
			expect({ ...at, ...run(game, form(() => [])) }).toEqual({ ...at, action: "void", why: VOID, kind: 3, readings: voidReadings });
			// The intact final: a final beside two answers without one, the dispute record.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...FINAL[seat] }])) }).toMatchObject({ ...at, action: "dispute", why: "after n: finals beside answers without a final", kind: 4 });
			// The final without points: the reader can't score it, and it holds the void.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...NO_POINTS[seat] }])) }).toEqual({ ...at, ...waits(seat, "final without points") });
			// The final followed by a row the reader can't parse: the answer is refused whole.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...FINAL[seat] }]), thenNull(seat)) }).toEqual({ ...at, ...waits(seat, "unreadable record") });
			// The final twice. Seat 3's reader refuses a result listed twice; the seats read by team hold two
			// identical copies to be one record (pick.ts), so the final reads and disputes as the intact one does,
			// and two copies that differ are two answers that disagree about the game.
			const twice = run(game, form((r) => [{ ...r, ...FINAL[seat] }, { ...r, ...FINAL[seat] }]));
			const differing = run(game, form((r) => [{ ...r, ...FINAL[seat] }, { ...r, ...FINAL[seat], ...OTHER[seat] }]));
			if (seat === 3) {
				expect({ ...at, twice, differing }).toEqual({ ...at, twice: waits(3, "duplicate result"), differing: waits(3, "duplicate result") });
			} else {
				expect({ ...at, twice: [twice.action, twice.kind], differing }).toEqual({ ...at, twice: ["dispute", 4], differing: waits(seat, "inconsistent records") });
			}
		}
		// The spare that does not count, saying final without points beside two affirmative counting rows and
		// seat 3 silent: it holds the void, as its scorable final would by a dispute.
		expect(run(bears, both(off(1), off(2), rowsAt(3, () => []), rowsAt(4, (r) => [{ ...r, ...NO_POINTS[4] }])))).toEqual(waits(4, "final without points"));
		expect(run(bears, both(off(1), off(2), rowsAt(3, () => []), rowsAt(4, (r) => [{ ...r, ...FINAL[4] }])))).toMatchObject({ action: "dispute", kind: 4 });
	});

	test("end to end, at hour 24: every other route by which an answer that touched the game reaches the rule holds the void, the line naming the seat and the class, and the word verbatim", () => {
		const seat1 = table[0];
		const seat2 = table[1];
		const seat3 = table[2];
		const spare = table[3];
		// The final row without a usable feed id, at the seats read by team: a row the reader can't parse.
		for (const [seat, game, others] of [seat1, seat2, spare]) {
			const idless = run(game, both(others, rowsAt(seat, (r) => [{ ...r, ...FINAL[seat], [ID_KEY[seat]]: undefined }])));
			expect({ seat, ...idless }).toEqual({ seat, ...waits(seat, "unreadable record") });
		}
		// A short final in one of seat 2's two answers, the game's row cancelled in the other, in either order:
		// two answers that disagree about the game.
		const bearsFirst = (p: string) => p.includes("team=Chicago");
		const patsFirst = (p: string) => p.includes("team=New");
		const setRow = (fields: Record<string, unknown>) => (body: any) => {
			for (const g of body.results) if (g.gameId === IDS[2]) Object.assign(g, fields);
		};
		const short = { status: "final", scoreboard: { currentPeriod: 1, score: { home: 7, away: 0 } } };
		for (const [first, second] of [
			[bearsFirst, patsFirst],
			[patsFirst, bearsFirst],
		]) {
			const o = run(bears, both(off(1), off(3)), wrap(afterSend(2, first, setRow(short)), afterSend(2, second, setRow({ status: "canceled" }))));
			expect(o).toEqual(waits(2, "inconsistent records"));
		}
		// The transport throwing after the first page carried the game's row: partway through the seat's
		// reads, and the void holds it; throwing on the seat's first request is clean silence, and the void posts.
		const paged = afterSend(1, (p) => !p.includes("cursor="), (body) => void (body.meta = { ...(body.meta ?? {}), next_cursor: "p2" }));
		expect(run(bears, both(off(2), off(3)), wrap(paged, throwing(1, (p) => p.includes("cursor="))))).toEqual(waits(1, "transport"));
		expect(run(bears, both(off(2), off(3)), throwing(1, () => true))).toMatchObject({ action: "void", kind: 3 });
		// Seat 2's second request throwing after the first carried the game's row: the same.
		expect(run(bears, both(off(1), off(3)), throwing(2, patsFirst))).toEqual(waits(2, "transport"));
		expect(run(bears, both(off(1), off(3)), throwing(2, () => true))).toMatchObject({ action: "void", kind: 3 });
		// The reader's own cap: a cursor on every page, twelve requests, and the reader exits after the game's row arrived.
		const endless = afterSend(1, () => true, (body) => void (body.meta = { ...(body.meta ?? {}), next_cursor: "more" }));
		expect(run(bears, both(off(2), off(3)), endless)).toEqual(waits(1, "request bound"));
		// A refusal before any row, at the seat under test: clean silence, and the void posts; a refusal of
		// the second page, after the game's row arrived: the void waits.
		expect(run(bears, both(off(1), off(2), rowsAt(3, () => [])), refusing(3, 503))).toMatchObject({ action: "void", kind: 3 });
		expect(run(bears, both(off(2), off(3)), wrap(paged, (send) => (q) => (locate(q)?.seat === 1 && q.url.includes("cursor=") ? { status: 500, body: "" } : send(q))))).toEqual(waits(1, "http 500"));
		// A final under another id beside the hinted row postponed, the same teams and time, at seats 1 and 2:
		// the hint picks the postponed row to score, and the other row holds the void.
		for (const [seat, , others] of [seat1, seat2]) {
			const hinted = chainOf("nfl not final", { hints: [...bears.hints, { seat, id: String(IDS[seat]) }] });
			const rival = rowsAt(seat, (r) => [{ ...r, ...OFF[seat as 1 | 2] }, { ...r, ...FINAL[seat], [ID_KEY[seat]]: seat === 1 ? 9_999_001 : 9_999_002 }]);
			expect({ seat, ...run(hinted, both(others, rival)) }).toEqual({ seat, action: "wait", why: `after n: seat ${seat} answered by its hint beside another row that could be the game: ${seat === 1 ? "postponed" : "canceled"}`, kind: null, readings: null });
			// The control: the hinted row alone, postponed, and the void posts.
			expect({ seat, ...run(hinted, both(others, off(seat as 1 | 2))) }).toMatchObject({ seat, action: "void", kind: 3 });
		}
		// Spellings the readers do not know, alone and beside a row the reader can't parse, each counting seat
		// and the spare standing in: the line carries the word verbatim.
		const spelt: [Seat, ChainGame, Derive, Record<string, unknown>, string][] = [
			[1, seat1[1], seat1[2], { status_state: "Final" }, 'unrecognized status "Final"'],
			[1, seat1[1], seat1[2], { status_state: "PPD" }, 'unrecognized status "PPD"'],
			[2, seat2[1], seat2[2], { status: "FINAL" }, 'unrecognized status "FINAL"'],
			[2, seat2[1], seat2[2], { status: "final " }, 'unrecognized status "final "'],
			[3, seat3[1], seat3[2], { Final: true, FinalType: "Finished " }, 'unrecognized status "Finished "'],
			[3, seat3[1], seat3[2], { Final: "TRUE", FinalType: "Finished", HomeScore: "24", AwayScore: "17" }, 'unrecognized final flag "TRUE"'],
			[4, spare[1], spare[2], { completed: "true" }, 'unrecognized status "true"'],
		];
		for (const [seat, game, others, fields, detail] of spelt) {
			expect({ seat, fields, ...run(game, both(others, rowsAt(seat, (r) => [{ ...r, ...fields }]))) }).toEqual({ seat, fields, ...waits(seat, detail) });
			expect({ seat, fields, ...run(game, both(others, rowsAt(seat, (r) => [{ ...r, ...fields }])), thenNull(seat)) }).toEqual({ seat, fields, ...waits(seat, "unreadable record") });
		}
		// The finished half and the finished part of the game under seat 3's hint: the game was played, and
		// the void waits (it posted before this pass).
		for (const part of ["FirstHalf", "FirstInnings"]) {
			expect({ part, ...run(bears, both(off(1), off(2), rowsAt(3, (r) => [{ ...r, ...FINAL[3], OddType: part }]))) }).toEqual({ part, ...waits(3, "hint names a part of the game") });
		}
		// Two affirmative rows beside a third seat's empty answer: clean silence, and the void posts.
		expect(run(bears, both(off(1), off(2)), afterSend(3, (p) => ownPath(3, p), () => []))).toMatchObject({ action: "void", kind: 3 });
		expect(run(spareIn, both(off(1), off(2)), afterSend(4, (p) => ownPath(4, p), () => []))).toMatchObject({ action: "void", kind: 3 });
	});
});
