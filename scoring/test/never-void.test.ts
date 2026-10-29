// Never: "The hour-24 void posts while any answering feed shows a final, scorable or not, or on fewer
// than two counting seats' affirmative answers."
//
// The hour-24 void is every void a run decides before a dispute record (a day-7 void can hold
// finals, 2-2 among them, and is held to day 7's own line in never-day7.test.ts). "Any answering
// feed" is any seat asked, the spare and a seat that does not count included. An affirmative answer
// is the game's own row whose status in the feed's own words says the game will not or did not play:
// postponed or cancelled, and nothing else (the reading's `recorded`); a row that says the game is
// scheduled or in play is an answer, not a void's vote; absence and a partial row are silence
// (never-affirmative.test.ts). A void is held to the finals' count after n: two counting seats or
// more affirm, and the rest of the counting seats are silent. And a seat that said the word final
// without a final its reader could score (its result listed twice, its final without points, its
// final beside a row the reader can't parse) reads silent and marked (types.ts, saysFinal): silent to
// the score, it holds the void all the same, the run waiting with its line naming the seat and why.
// The veto is the word, not the score.
//
// Counted by hand over nine states a seat can read (silent; none, an answer in play; sched, the game's
// row scheduled, an answer all the same; off, a postponed answer; the finals A and B; and three that
// say final without a final the reader could score: dup, the result listed twice; nopts, a final
// without points; null, a final beside a row the reader can't parse. The spare is never off, since its
// feed has no such word, but it reads each of the three, in its reader's own words for them): a void
// needs no final at any seat, no seat that said final, two or more counting seats off, the rest of the
// counting seats silent, and the window closed. Seat 3 counting: two off and the third silent (3) or
// three off (1), the spare silent, in play or scheduled (3): 12. The spare standing in for seat 3
// (counting 1, 2 and 4): seats 1 and 2 off, the spare silent, seat 3 silent, in play, scheduled or off
// (4): 4. Sixteen in all, all after n, of 9 x 9 x 9 x 8 states x 2 counting sets x 2 clocks = 23,328;
// the three says-final states add none, at a counting seat or not: none carries an affirmative row,
// and each holds the void. Inside n, none. A scheduled row adds no void anywhere: it is never a vote.
//
// The breaks that turn this red:
//   rule.ts, decide: the void ignoring a seat that said final,
//     if (finals.length === 0 && unscorable.length > 0) {
//     ->  if (false) {
//   with which seat 3's result listed twice voids beside seat 1 postponed and seat 2 cancelled, and so
//   does a final without points at any seat;
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

/** The sweep's four states and five more: sched, the game's row scheduled; off, postponed, the one affirmative answer without a final; and the three that say final without a final the reader could score. */
type Nine = State | "sched" | "off" | "dup" | "nopts" | "null";
const NINE: readonly Nine[] = ["silent", "none", "sched", "off", "A", "B", "dup", "nopts", "null"];
/** The spare's feed has no word that a game will not play: it is never off. */
const SPARE_STATES: readonly Nine[] = ["silent", "none", "sched", "A", "B", "dup", "nopts", "null"];
/** What each says-final state's reader wrote for it (seat 3's words for the first; the shape is what the rule reads). */
const SAID: Readonly<Record<"dup" | "nopts" | "null", string>> = { dup: "duplicate result", nopts: "final without points", null: "unreadable record" };

function of(seat: Seat, s: Nine): Reading {
	if (s === "off") return { seat, kind: "no_final", home: null, away: null, recorded: "postponed", detail: "postponed", record: { id: `r${seat}`, time: null } };
	if (s === "sched") return { seat, kind: "no_final", home: null, away: null, recorded: null, detail: "scheduled", record: { id: `r${seat}`, time: null } };
	if (s === "dup" || s === "nopts" || s === "null") return { ...reading(seat, "silent"), detail: SAID[s], saysFinal: true };
	return reading(seat, s);
}

/** Every assignment of a state to each seat: 9 x 9 x 9 x 8 = 5,832. */
function* everyNine(): Generator<readonly [Nine, Nine, Nine, Nine]> {
	for (const a of NINE) for (const b of NINE) for (const c of NINE) for (const d of SPARE_STATES) yield [a, b, c, d];
}

describe("never: the hour-24 void while any answering feed shows a final, scorable or not, or on fewer than two affirmative answers", () => {
	test("no void in the sweep has a final or a seat that said final at any seat, or fewer than two counting seats postponed with the rest silent; none comes inside the window, none rests on a scheduled row, and the voids are the ones counted by hand", () => {
		const voids = { inside: 0, after: 0 };
		let swept = 0;
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const states of everyNine()) {
					swept++;
					const readings = SEATS4.map((s, i) => of(s, states[i]));
					const d = decide(readings, counting, inside);
					if (d.action !== "void") continue;
					voids[inside ? "inside" : "after"]++;
					const where = { counting, inside, states };
					expect({ ...where, finals: readings.filter((r) => r.kind === "final").map((r) => r.seat), said: readings.filter((r) => r.saysFinal === true).map((r) => r.seat) }).toEqual({ ...where, finals: [], said: [] });
					const counted = counting.map((s) => readings[s - 1]);
					const affirmed = counted.filter(affirmsNoFinal).length;
					const otherAnswers = counted.filter((r) => r.kind !== "silent" && !affirmsNoFinal(r)).length;
					expect({ ...where, enough: affirmed >= 2, restSilent: otherAnswers === 0, scheduledCounting: counted.some((r) => r.detail === "scheduled") }).toEqual({ ...where, enough: true, restSilent: true, scheduledCounting: false });
				}
			}
		}
		expect({ swept, voids }).toEqual({ swept: 23_328, voids: { inside: 0, after: 16 } });
	});

	test("the edges, by name", () => {
		const d = (counting: readonly Seat[], inside: boolean, states: Nine[]) => decide(SEATS4.map((s, i) => of(s, states[i])), counting, inside).action;
		const rows: [readonly Seat[], boolean, Nine[], string][] = [
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
			// A seat that said final without a final the reader could score: the word holds the void.
			[[1, 2, 3], false, ["off", "off", "dup", "silent"], "wait"], // seat 3's result listed twice
			[[1, 2, 3], false, ["nopts", "off", "off", "silent"], "wait"], // seat 1's final without points
			[[1, 2, 3], false, ["off", "null", "off", "silent"], "wait"], // seat 2's final beside a row the reader can't parse
			[[1, 2, 3], false, ["off", "off", "silent", "nopts"], "wait"], // the spare, not counting, said final: it holds the void as its scorable final would (a dispute)
			[[1, 2, 4], false, ["off", "off", "silent", "dup"], "wait"], // the spare standing in
			[[1, 2, 4], false, ["off", "off", "nopts", "silent"], "wait"], // a reading for seat 3 handed to the rule while it does not count: the word holds here too
			[[1, 2, 3], false, ["dup", "off", "silent", "silent"], "wait"], // one affirmative answer beside the word: a wait either way
			[[1, 2, 3], true, ["off", "off", "dup", "silent"], "wait"], // never inside the window
			// Scoring unchanged: silent to the score, the mark neither makes a final nor blocks one.
			[[1, 2, 3], false, ["A", "A", "dup", "silent"], "score"], // two finals, the rest silent
			[[1, 2, 3], false, ["A", "dup", "off", "silent"], "dispute"], // a final beside an answer without one: the record, as before
			[[1, 2, 3], false, ["A", "B", "nopts", "silent"], "dispute"], // two finals that differ
			[[1, 2, 3], true, ["A", "A", "nopts", "silent"], "wait"], // inside n, a silent counting seat blocks, as before
		];
		for (const [counting, inside, states, want] of rows) {
			expect({ counting, inside, states, got: d(counting, inside, states) }).toEqual({ counting, inside, states, got: want });
		}
		// The line of a run that waits on the count says what each seat gave.
		const one = decide(SEATS4.map((s, i) => of(s, (["off", "sched", "silent", "silent"] as Nine[])[i])), [1, 2, 3], false);
		expect([one.action, one.why]).toEqual(["wait", "after n: 1 counting seat says the game will not or did not play, two needed; seat 1 postponed, seat 2 scheduled, seat 3 silence (silent), seat 4 silence (silent)"]);
		const none = decide(SEATS4.map((s, i) => of(s, (["sched", "sched", "silent", "none"] as Nine[])[i])), [1, 2, 3], false);
		expect([none.action, none.why]).toEqual(["wait", "after n: 0 counting seats say the game will not or did not play, two needed; seat 1 scheduled, seat 2 scheduled, seat 3 silence (silent), seat 4 in progress"]);
		// The line of a run that waits on the word names the seat and why the final could not score.
		const word = decide(SEATS4.map((s, i) => of(s, (["off", "off", "dup", "silent"] as Nine[])[i])), [1, 2, 3], false);
		expect([word.action, word.why]).toEqual(["wait", "after n: seat 3 says final, unscorable: duplicate result"]);
		const words = decide(SEATS4.map((s, i) => of(s, (["nopts", "off", "dup", "silent"] as Nine[])[i])), [1, 2, 3], false);
		expect([words.action, words.why]).toEqual(["wait", "after n: seat 1 says final, unscorable: final without points; seat 3 says final, unscorable: duplicate result"]);
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
		// Seat 2's row without a status: a partial row, silence; one counting seat answers, and the run waits.
		const partial = out(seat2({ status: undefined }));
		expect([partial.action, partial.kind, partial.why]).toEqual(["wait", null, "after n: fewer than two counting seats answer"]);
		// Derived from the real answer: seat 2 marks the rained-out game final, 3-1, after nine innings
		// (a final needs the feed's period count to reach the league's regulation).
		expect(out(seat2({ status: "final", scoreboard: { currentPeriod: 9, score: { home: 3, away: 1 } } }))).toMatchObject({ action: "dispute", kind: 4, readings: [[1, 1], [2, 2], [3, 0], [4, 0]] });
	});

	test("the rainout's case is real: its game sits in the readers' cases with the readings the void rests on", () => {
		const c = CASES.find((x) => x.name.startsWith("mlb postponed"))!;
		expect([c.expect[1]?.detail, c.expect[2]?.detail, c.expect[4]?.detail]).toEqual(["postponed", "canceled", "past retention"]);
		expect([c.expect[1]?.recorded, c.expect[2]?.recorded]).toEqual(["postponed", "canceled"]);
	});

	// The three forms of a final the reader could not score, through the readers at hour 24: New England
	// at Chicago, saved before the game with its seat 3 hint bound, the other two counting seats derived
	// to their feeds' own postponed and cancelled, the clock at start + n + ten minutes, the saved answers
	// as of the capture. At each counting seat, and at the spare standing in for seat 3 (the game re-read
	// without its seat 3 hint): the final listed twice, the final without points, the final followed by a
	// row the reader can't parse. Where the reader refuses the form, the run waits, nothing written, its
	// line naming the seat and why; the intact final disputes; the control without the row voids.
	const bears = chainOf("nfl not final");
	const spareIn = chainOf("nfl not final", { hints: [] });
	const H24 = (bears.start as number) + bears.n + 600;
	const IDS = { 1: 1392309, 2: 340175, 3: "edcfd41f-1773-4bc9-a349-aa50931a0278", 4: "ffebea881c1d7b2dfb85b3e590c35985" } as const;
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
	/** A row the reader can't parse, after the rows of a seat's answer as sent (the saved answers are filtered to the game before they are served, so the row goes on after). */
	const thenNull = (seat: Seat, send: (q: HttpRequest) => HttpResponse) => (q: HttpRequest): HttpResponse => {
		const res = send(q);
		const at = locate(q);
		if (at === null || at.seat !== seat || res.status !== 200 || !ownPath(seat, at.path)) return res;
		const body = JSON.parse(res.body);
		if (seat === 1) body.data.push(null);
		else if (seat === 2) body.results.push(null);
		else body.push(null);
		return { status: 200, body: JSON.stringify(body) };
	};
	const both = (...ds: Derive[]): Derive => (s, p, b) => ds.reduce((acc, f) => f(s, p, acc), b);
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

	const run = (game: ChainGame, derive: Derive, nullAt?: Seat) => {
		const t = saved(derive, NOW);
		const o = scoreGameSync(game, KEYS, PAYOUT, H24, nullAt === undefined ? t.send : thenNull(nullAt, t.send));
		expect(t.misses).toEqual([]);
		return { action: o.decision.action, why: o.decision.why, kind: o.report?.kind ?? null, readings: o.report?.readings.map((r) => [r.seat, r.kind]) ?? null };
	};

	test("end to end, at hour 24: a final the reader could not score, at each counting seat and at the spare standing in, holds the void; the intact final disputes; without the row, the void", () => {
		const VOID = "after n: two counting seats or more say the game will not or did not play, the rest silent, and no seat shows a final";
		// For each seat under test: the game, the other two counting seats' affirmative rows, and the seats a report lists.
		const table: [Seat, ChainGame, Derive, number[][]][] = [
			[1, bears, both(off(2), off(3)), [[1, 0], [2, 1], [3, 1], [4, 1]]],
			[2, bears, both(off(1), off(3)), [[1, 1], [2, 0], [3, 1], [4, 1]]],
			[3, bears, both(off(1), off(2)), [[1, 1], [2, 1], [3, 0], [4, 1]]],
			[4, spareIn, both(off(1), off(2)), [[1, 1], [2, 1], [3, 0], [4, 0]]],
		];
		for (const [seat, game, others, voidReadings] of table) {
			const at = { seat };
			const form = (change: (row: Record<string, any>) => Record<string, any>[]) => both(others, rowsAt(seat, change));
			// The control: no row of the game at this seat (silent), the other two affirmative: the void.
			expect({ ...at, ...run(game, form(() => [])) }).toEqual({ ...at, action: "void", why: VOID, kind: 3, readings: voidReadings });
			// The intact final: a final beside two answers without one, the dispute record.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...FINAL[seat] }])) }).toMatchObject({ ...at, action: "dispute", why: "after n: finals beside answers without a final", kind: 4 });
			// The final without points: the reader can't score it, and the word holds the void.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...NO_POINTS[seat] }])) }).toEqual({ ...at, action: "wait", why: `after n: seat ${seat} says final, unscorable: final without points`, kind: null, readings: null });
			// The final followed by a row the reader can't parse: the answer is refused whole, after the final was seen.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...FINAL[seat] }]), seat) }).toEqual({ ...at, action: "wait", why: `after n: seat ${seat} says final, unscorable: unreadable record`, kind: null, readings: null });
			// The final twice. Seat 3's reader refuses a result listed twice; the seats read by team hold two
			// identical copies to be one record (pick.ts), so the final reads and disputes as the intact one does,
			// and two copies that differ are refused as inconsistent records: the word holds the void.
			const twice = run(game, form((r) => [{ ...r, ...FINAL[seat] }, { ...r, ...FINAL[seat] }]));
			const differing = run(game, form((r) => [{ ...r, ...FINAL[seat] }, { ...r, ...FINAL[seat], ...OTHER[seat] }]));
			if (seat === 3) {
				expect({ ...at, twice, differing }).toEqual({ ...at, twice: { action: "wait", why: "after n: seat 3 says final, unscorable: duplicate result", kind: null, readings: null }, differing: { action: "wait", why: "after n: seat 3 says final, unscorable: duplicate result", kind: null, readings: null } });
			} else {
				expect({ ...at, twice: [twice.action, twice.kind], differing }).toEqual({ ...at, twice: ["dispute", 4], differing: { action: "wait", why: `after n: seat ${seat} says final, unscorable: inconsistent records`, kind: null, readings: null } });
			}
		}
		// The spare that does not count, saying final without points beside two affirmative counting rows and
		// seat 3 silent: its word holds the void, as its scorable final would by a dispute.
		const spareWord = run(bears, both(off(1), off(2), rowsAt(3, () => []), rowsAt(4, (r) => [{ ...r, ...NO_POINTS[4] }])));
		expect(spareWord).toEqual({ action: "wait", why: "after n: seat 4 says final, unscorable: final without points", kind: null, readings: null });
		// And its scorable final: the dispute, as before.
		expect(run(bears, both(off(1), off(2), rowsAt(3, () => []), rowsAt(4, (r) => [{ ...r, ...FINAL[4] }])))).toMatchObject({ action: "dispute", kind: 4 });
	});
});
