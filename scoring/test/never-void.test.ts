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
// clean silence (types.ts, answer "nothing"): the body was empty (an empty list, or no result for the
// id), or was a readable list of rows none of which is the game by id or by its names and time, or the
// request failed, whatever its status, with no list holding the game's row in its body, or the seat was
// never asked or is past its window by date arithmetic; the class is per seat and the worst of its
// reads. Status decides nothing; the body does: a 2xx body is read by these rules whatever its status, a
// status outside 2xx is a failure, clean, unless its body is the feed's list holding the game's row, and
// an error body, a page or an empty body on any status is a failure. Every other reading that is not an
// affirmative row holds the void, whatever the word was: a non-empty body that is not the feed's list
// (a single object, a wrong envelope, not a list), a by-id answer that is not the requested game (seat
// 3's row without a usable id, the spare's row under another id where no slate stands behind it), and
// any row for the game of any shape (a row the reader could not use: no usable id, no status word, a
// word it does not recognize, a final without points, a short final, a part of the game; a row that
// would not parse; the game's row inside a failed answer (`the game's row in a 503`); a failure or the
// reader's own cap partway through the seat's reads after rows arrived; two
// rows that could be the game; two answers that disagree about it), or the game's row chosen by its
// hint beside another that could be the game. The run waits, its line naming the seat and the class, a
// status word the reader does not know verbatim (`seat 1 answered but could not be used: unrecognized
// status "PPD"`), and the game's row's word beside a row it could not parse, whether the bad row came
// first or second.
//
// Where scoring lives: two agreeing finals after n score over any single answer at the third seat that
// is not a competing final (in play, unrecognized, unusable, postponed, cancelled); that answer neither
// votes nor disputes. A dispute is between finals that differ, or a lone final against two didn't-play
// votes. Inside n, three finals.
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
//   request.ts, failed: a failed answer holding the game's row declared clean,
//     if (held !== null) return silent(seat, held);
//     ->  deleted
//   with which the game's intact final in a 500 or 503 body voids beside two affirmative rows, at every seat;
//   seat3.ts, read: a result id of any shape accepted,
//     if (id === null || !ID.test(id)) {
//     ->  if (id === null) {
//   with which seat 3's final under the id "0" or "not-a-feed-id" reads as no result for the hint, and voids;
//   seat1.ts, read: a clean declaration on a non-empty body that is not the feed's list,
//     if (!Array.isArray(data)) return silent(SEAT, "unreadable");
//     ->  if (!Array.isArray(data)) return clean(SEAT, "unreadable");
//   with which a single object, a wrong envelope or a string at seat 1 voids beside two affirmative rows;
//   seat4.ts, read: the spare's slate overwriting its id answer,
//     return r.kind === "silent" && held !== null ? held : r;
//     ->  return r;
//   with which the spare's id answer it could not use, then an empty slate, voids;
//   rule.ts, decide: an answer in play disputing two finals after n,
//     if (finalsCounted >= AGREE.afterN) {
//     ->  if (finalsCounted >= AGREE.afterN && answeredCounted - finalsCounted > 0) return { action: "dispute", readings, why: "after n: finals beside answers without a final" };
//         if (finalsCounted >= AGREE.afterN) {
//   with which two finals beside a third seat in play dispute where they score;
//   verify.ts, decideStart: seat 3's result the reader could not use not standing down,
//     if (seen.result.kind === "silent" && !unusable(seen.result) && !RESULT_ANSWERED.has(seen.result.detail)) return wait(
//     ->  if (seen.result.kind === "silent" && !RESULT_ANSWERED.has(seen.result.detail)) return wait(
//   with which a result listed twice at the first tick writes no start (verify.test.ts);
//   rule.ts, decide: the class ignored by the void,
//     if (held.length > 0) return { action: "wait", readings, why: `after n: ${held.map(holding).join("; ")}` };
//     ->  deleted
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
			[[1, 2, 3], false, ["off", "off", "silent", "A"], "dispute"], // the spare's final against two votes: no void, the record
			[[1, 2, 4], false, ["off", "off", "A", "silent"], "dispute"], // seat 3 does not count here, but its final is a lone final against two votes
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
			// Where scoring lives: two agreeing finals after n score over a third answer that is not a competing final.
			[[1, 2, 3], false, ["A", "A", "none", "silent"], "score"], // in play
			[[1, 2, 3], false, ["A", "A", "off", "silent"], "score"], // postponed
			[[1, 2, 3], false, ["A", "A", "dup", "silent"], "score"], // an answer the reader could not use
			[[1, 2, 3], false, ["A", "A", "bare", "silent"], "score"],
			[[1, 2, 3], false, ["A", "A", "silent", "silent"], "score"],
			[[1, 2, 4], false, ["A", "silent", "sched", "A"], "score"], // the spare standing in, seat 2 silent, seat 3's row not counting
			[[1, 2, 3], false, ["A", "A", "B", "silent"], "dispute"], // two finals that differ
			[[1, 2, 3], false, ["A", "A", "silent", "B"], "dispute"], // the spare's final differs
			[[1, 2, 3], false, ["A", "off", "off", "silent"], "dispute"], // a lone final against two votes
			[[1, 2, 3], false, ["A", "none", "silent", "silent"], "wait"], // a lone final beside an answer in play waits for a second
			[[1, 2, 3], false, ["A", "off", "silent", "silent"], "wait"], // a lone final beside one vote: the same
			[[1, 2, 3], false, ["A", "dup", "off", "silent"], "wait"], // a lone final beside an unusable answer and one vote: the same
			[[1, 2, 3], false, ["A", "chosen", "silent", "silent"], "wait"], // a lone final beside the chosen row: the same
			[[1, 2, 3], false, ["A", "B", "nopts", "silent"], "dispute"], // two finals that differ
			[[1, 2, 3], true, ["A", "A", "none", "silent"], "wait"], // inside n, two finals beside anything: no score
			[[1, 2, 3], true, ["A", "A", "nopts", "silent"], "wait"],
			[[1, 2, 3], true, ["A", "A", "silent", "silent"], "wait"],
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
		// The lines where scoring lives.
		const scored = decide(SEATS4.map((s, i) => of(s, (["A", "A", "none", "silent"] as Edge[])[i])), [1, 2, 3], false);
		expect([scored.action, scored.why]).toEqual(["score", "after n: two counting seats or more, the same final"]);
		const lone = decide(SEATS4.map((s, i) => of(s, (["A", "off", "off", "silent"] as Edge[])[i])), [1, 2, 3], false);
		expect([lone.action, lone.why]).toEqual(["dispute", "after n: a final against two counting seats that say the game will not or did not play"]);
		const second = decide(SEATS4.map((s, i) => of(s, (["A", "none", "silent", "silent"] as Edge[])[i])), [1, 2, 3], false);
		expect([second.action, second.why]).toEqual(["wait", "after n: one final, no second, and the answers beside it neither vote nor dispute; seat 1 a final, seat 2 in progress, seat 3 silence (silent), seat 4 silence (silent)"]);
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
		// Derived from the real answer: seat 2 marks the rained-out game final, 3-1, after nine innings (a
		// final needs the feed's period count to reach the league's regulation): a lone final beside one
		// vote, which waits for a second, never a void.
		const lone = out(seat2({ status: "final", scoreboard: { currentPeriod: 9, score: { home: 3, away: 1 } } }));
		expect([lone.action, lone.kind, lone.why]).toEqual(["wait", null, "after n: one final, no second, and the answers beside it neither vote nor dispute; seat 1 postponed, seat 2 a final, seat 3 silence (silent for the game), seat 4 silence (closed: past its window)"]);
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
	/** A seat's answer built by hand, in place of the saved one, on the requests `when` picks. */
	const replace = (seat: Seat, when: (path: string) => boolean, body: unknown) => (send: Send): Send => (q) => {
		const at = locate(q);
		return at !== null && at.seat === seat && when(at.path) ? { status: 200, body: JSON.stringify(body) } : send(q);
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
	/** The word the refusal carries for each feed's own final row beside a row the reader can't parse. */
	const FINAL_WORD: Readonly<Record<Seat, string>> = { 1: 'unreadable record; the game\'s row says "final"', 2: 'unreadable record; the game\'s row says "final"', 3: 'unreadable record; the hint\'s row says "Finished", Final true', 4: 'unreadable record; the game\'s row says "completed"' };

	const run = (game: ChainGame, derive: Derive, around: (send: Send) => Send = (s) => s, clock = H24) => {
		const t = saved(derive, NOW);
		const o = scoreGameSync(game, KEYS, PAYOUT, clock, around(t.send));
		expect(t.misses).toEqual([]);
		return { action: o.decision.action, why: o.decision.why, kind: o.report?.kind ?? null, readings: o.report?.readings.map((r) => [r.seat, r.kind]) ?? null };
	};
	const VOID = "after n: two counting seats or more say the game will not or did not play, the rest silent, and no seat shows a final";
	const LONE = "after n: a final against two counting seats that say the game will not or did not play";
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
			// The intact final: a lone final against two counting seats that say the game will not or did not play, the record.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...FINAL[seat] }])) }).toMatchObject({ ...at, action: "dispute", why: LONE, kind: 4 });
			// The final without points: the reader can't score it, and it holds the void.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...NO_POINTS[seat] }])) }).toEqual({ ...at, ...waits(seat, "final without points") });
			// The final followed by a row the reader can't parse: the answer is refused whole, the final's word on the line.
			expect({ ...at, ...run(game, form((r) => [{ ...r, ...FINAL[seat] }]), thenNull(seat)) }).toEqual({ ...at, ...waits(seat, FINAL_WORD[seat]) });
			// The final twice. Seat 3's reader refuses a result listed twice; the seats read by team hold two
			// identical copies to be one record (pick.ts), so the final reads as the intact one does, and two
			// copies that differ are two answers that disagree about the game.
			const twice = run(game, form((r) => [{ ...r, ...FINAL[seat] }, { ...r, ...FINAL[seat] }]));
			const differing = run(game, form((r) => [{ ...r, ...FINAL[seat] }, { ...r, ...FINAL[seat], ...OTHER[seat] }]));
			if (seat === 3) {
				expect({ ...at, twice, differing }).toEqual({ ...at, twice: waits(3, "duplicate result"), differing: waits(3, "duplicate result") });
			} else {
				expect({ ...at, twice: [twice.action, twice.kind], differing }).toEqual({ ...at, twice: ["dispute", 4], differing: waits(seat, "inconsistent records") });
			}
		}
		// The spare that does not count, saying final without points beside two affirmative counting rows and
		// seat 3 silent: it holds the void, as its scorable final would by the record.
		expect(run(bears, both(off(1), off(2), rowsAt(3, () => []), rowsAt(4, (r) => [{ ...r, ...NO_POINTS[4] }])))).toEqual(waits(4, "final without points"));
		expect(run(bears, both(off(1), off(2), rowsAt(3, () => []), rowsAt(4, (r) => [{ ...r, ...FINAL[4] }])))).toMatchObject({ action: "dispute", why: LONE, kind: 4 });
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
		// and the spare standing in: the line carries the word verbatim, beside the bad row too.
		const spelt: [Seat, ChainGame, Derive, Record<string, unknown>, string, string][] = [
			[1, seat1[1], seat1[2], { status_state: "Final" }, 'unrecognized status "Final"', "Final"],
			[1, seat1[1], seat1[2], { status_state: "PPD" }, 'unrecognized status "PPD"', "PPD"],
			[2, seat2[1], seat2[2], { status: "FINAL" }, 'unrecognized status "FINAL"', "FINAL"],
			[2, seat2[1], seat2[2], { status: "final " }, 'unrecognized status "final "', "final "],
			[3, seat3[1], seat3[2], { Final: true, FinalType: "Finished " }, 'unrecognized status "Finished "', "Finished "],
			[3, seat3[1], seat3[2], { Final: "TRUE", FinalType: "Finished", HomeScore: "24", AwayScore: "17" }, 'unrecognized final flag "TRUE"', "Finished"],
			[4, spare[1], spare[2], { completed: "true" }, 'unrecognized status "true"', "true"],
		];
		for (const [seat, game, others, fields, detail, word] of spelt) {
			expect({ seat, fields, ...run(game, both(others, rowsAt(seat, (r) => [{ ...r, ...fields }]))) }).toEqual({ seat, fields, ...waits(seat, detail) });
			const beside = seat === 3 ? `unreadable record; the hint's row says ${JSON.stringify(word)}, Final ${JSON.stringify(fields.Final)}` : `unreadable record; the game's row says ${JSON.stringify(word)}`;
			expect({ seat, fields, ...run(game, both(others, rowsAt(seat, (r) => [{ ...r, ...fields }])), thenNull(seat)) }).toEqual({ seat, fields, ...waits(seat, beside) });
		}
		// The finished half and the finished part of the game under seat 3's hint: the game was played, and
		// the void waits (it posted before the seventh pass).
		for (const part of ["FirstHalf", "FirstInnings"]) {
			expect({ part, ...run(bears, both(off(1), off(2), rowsAt(3, (r) => [{ ...r, ...FINAL[3], OddType: part }]))) }).toEqual({ part, ...waits(3, "hint names a part of the game") });
		}
		// Two affirmative rows beside a third seat's empty answer: clean silence, and the void posts.
		expect(run(bears, both(off(1), off(2)), afterSend(3, (p) => ownPath(3, p), () => []))).toMatchObject({ action: "void", kind: 3 });
		expect(run(spareIn, both(off(1), off(2)), afterSend(4, (p) => ownPath(4, p), () => []))).toMatchObject({ action: "void", kind: 3 });
	});

	test("the clean sites, audited: a by-id answer that is not the requested game, a non-empty body that is not the feed's list, and the spare's id answer held over its slate each hold the void; the bodies that are clean still void", () => {
		// The spare by its id, standing in for seat 3: its id answer the game's row without points, then an
		// empty slate, or a slate without the game: the id answer survives (the class is the worst of the
		// seat's reads). An empty id answer and an empty slate: clean, and the void posts.
		const spareById = chainOf("nfl not final", { hints: [{ seat: 4, id: IDS[4] }] });
		const byId = (p: string) => p.includes("eventIds=");
		const slate = (p: string) => ownPath(4, p) && !p.includes("eventIds=");
		const idRow = (fields: Record<string, unknown>) => afterSend(4, byId, (body: Record<string, any>[]) => body.map((r) => (isOwn(4, r) ? { ...r, ...fields } : r)));
		for (const [what, after] of [
			["an empty slate", afterSend(4, slate, () => [])],
			["a slate without the game", afterSend(4, slate, (body: Record<string, any>[]) => body.filter((r) => !isOwn(4, r)))],
		] as const) {
			expect({ what, ...run(spareById, both(off(1), off(2)), wrap(idRow(NO_POINTS[4]), after)) }).toEqual({ what, ...waits(4, "final without points") });
			expect({ what, ...run(spareById, both(off(1), off(2)), wrap(idRow({ completed: undefined }), after)) }).toEqual({ what, ...waits(4, "no status") });
			expect({ what, ...run(spareById, both(off(1), off(2)), wrap(idRow({ completed: "TRUE" }), after)) }).toEqual({ what, ...waits(4, 'unrecognized status "TRUE"') });
		}
		expect(run(spareById, both(off(1), off(2)), wrap(afterSend(4, byId, () => []), afterSend(4, slate, () => [])))).toMatchObject({ action: "void", kind: 3 });
		// The spare that does not count, by its id, beside seat 3 silent: the same.
		const bearsById = chainOf("nfl not final", { hints: [...bears.hints, { seat: 4, id: IDS[4] }] });
		expect(run(bearsById, both(off(1), off(2), rowsAt(3, () => [])), wrap(idRow(NO_POINTS[4]), afterSend(4, slate, () => [])))).toEqual(waits(4, "final without points"));
		// The spare's id answer a final of the game under another id, where no slate stands behind the id
		// (college basketball): a by-id answer that is not the requested record, and it holds the void. The
		// answers are built by hand: the saved college answers do not carry this game's rows at seat 1.
		const kentucky = chainOf("ncaab final: Santa Clara at Kentucky", { hints: [{ seat: 4, id: "0123456789abcdef0123456789abcdef" }] });
		const start = kentucky.start as number;
		const iso = (t: number) => new Date(t * 1000).toISOString();
		const seat1Off = replace(1, (p) => p.includes("/ncaab/v1/games"), { data: [{ id: 1, date: iso(start), status_state: "postponed", period: 0, home_team: { college: "Kentucky" }, visitor_team: { college: "Santa Clara" }, home_score: null, away_score: null }], meta: {} });
		const seat2Off = replace(2, (p) => p.includes("league=NCAAB"), { results: [{ gameId: 1, schedule: { date: iso(start), tbaTime: false }, status: "canceled", teams: { home: { team: "Kentucky" }, away: { team: "Santa Clara" } }, scoreboard: { currentPeriod: 0, score: {} } }] });
		const spareSays = (rows: unknown[]) => replace(4, (p) => p.includes("basketball_ncaab") && p.includes("eventIds="), rows);
		const otherId = [{ id: "ffffffffffffffffffffffffffffffff", commence_time: iso(start), home_team: "Kentucky", away_team: "Santa Clara", completed: true, scores: [{ name: "Kentucky", score: "89" }, { name: "Santa Clara", score: "84" }] }];
		const college = (rows: unknown[]) => run(kentucky, (s, p, b) => b, wrap(seat1Off, seat2Off, spareSays(rows)), start + kentucky.n + 600);
		expect(college(otherId)).toEqual(waits(4, "the id's row is not the requested record"));
		// The controls: nothing for the id, and a row of another game, are clean, and the void posts.
		expect(college([])).toMatchObject({ action: "void", kind: 3 });
		expect(college([{ ...otherId[0], home_team: "Kansas", away_team: "Baylor", scores: [] }])).toMatchObject({ action: "void", kind: 3 });
		// A non-empty body that is not the feed's list of rows, at all four seats: a single object (the game's
		// own row), a wrong envelope, and not a list at all.
		for (const [seat, game, others] of table) {
			const own = (body: any): Record<string, any> => (seat === 1 ? body.data : seat === 2 ? body.results : body).find((r: Record<string, any>) => isOwn(seat, r));
			for (const [what, shape] of [
				["a single object", (body: any) => own(body)],
				["a wrong envelope", (body: any) => ({ games: [own(body)] })],
				["not a list", () => "busy"],
			] as const) {
				expect({ seat, what, ...run(game, others, afterSend(seat, (p) => ownPath(seat, p), shape)) }).toEqual({ seat, what, ...waits(seat, "unreadable") });
			}
		}
		// Seat 3's result as an empty object, or with a missing, empty or object id: a by-id answer that is
		// not the requested game, and it holds the void, the line carrying an id that is there; a row under
		// another seat 3 id is absence, and the void posts.
		for (const [what, rows, detail] of [
			["an empty object", () => [{}], "result without an id"],
			["the id missing", (r: Record<string, any>) => [{ ...r, ...FINAL[3], ID: undefined }], "result without an id"],
			["the id empty", (r: Record<string, any>) => [{ ...r, ...FINAL[3], ID: "" }], 'result without a usable id: ""'],
			["the id an object", (r: Record<string, any>) => [{ ...r, ...FINAL[3], ID: { id: IDS[3] } }], `result without a usable id: {"id":"${IDS[3]}"}`],
		] as const) {
			expect({ what, ...run(bears, both(off(1), off(2)), afterSend(3, (p) => ownPath(3, p), (body: Record<string, any>[]) => rows(body[0] ?? {}))) }).toEqual({ what, ...waits(3, detail) });
		}
		expect(run(bears, both(off(1), off(2)), afterSend(3, (p) => ownPath(3, p), (body: Record<string, any>[]) => body.map((r) => ({ ...r, ...FINAL[3], ID: "00000000-0000-4000-8000-000000000000" }))))).toMatchObject({ action: "void", kind: 3 });
		// The hint's row beside a row without an id: the refusal carries the hint's row's word and its final flag.
		expect(run(bears, both(off(1), off(2)), afterSend(3, (p) => ownPath(3, p), (body: Record<string, any>[]) => [...body, {}]))).toEqual(waits(3, 'result without an id; the hint\'s row says "NotFinished", Final false'));
	});

	test("status decides nothing; the body does: the game's intact final in a 500 or 503 body holds the void at each counting seat and at the spare in either role, a 201 reads as a 200 does, and an error body, a page or an empty body under a failed status is a clean failure; seat 3's result under an id that is not a seat 3 id holds the void, and under another seat 3 id is absence", () => {
		/** A seat's own answer as sent, under another status, its body kept. */
		const coded = (seat: Seat, status: number) => (send: Send): Send => (q) => {
			const res = send(q);
			const at = locate(q);
			return at !== null && at.seat === seat && ownPath(seat, at.path) ? { status, body: res.body } : res;
		};
		/** A seat's own request answered with `body` under `status`, in place of the saved answer. */
		const bodied = (seat: Seat, status: number, body: string) => (send: Send): Send => (q) => {
			const at = locate(q);
			return at !== null && at.seat === seat && ownPath(seat, at.path) ? { status, body } : send(q);
		};
		const VOIDS = { action: "void", kind: 3 };
		// Each counting seat, the spare standing in for seat 3, and the spare that does not count beside seat 3 silent.
		const roles: [string, Seat, ChainGame, Derive][] = [
			...table.map(([seat, game, others]): [string, Seat, ChainGame, Derive] => [seat === 4 ? "the spare standing in" : `seat ${seat}`, seat, game, others]),
			["the spare not counting", 4, bears, both(off(1), off(2), rowsAt(3, () => []))],
		];
		for (const [role, seat, game, others] of roles) {
			const final = both(others, rowsAt(seat, (r) => [{ ...r, ...FINAL[seat] }]));
			// The intact final as a 200: a lone final against two votes, the record. As a 201: the same. In a
			// 500 or 503 body: the game's row in a failed answer, which the reader could not use; the void waits,
			// the line naming the seat and the status.
			const as200 = run(game, final);
			expect({ role, ...as200 }).toMatchObject({ role, action: "dispute", why: LONE, kind: 4 });
			expect({ role, status: 201, ...run(game, final, coded(seat, 201)) }).toEqual({ role, status: 201, ...as200 });
			for (const status of [500, 503]) {
				expect({ role, status, ...run(game, final, coded(seat, status)) }).toEqual({ role, status, ...waits(seat, `the game's row in a ${status}`) });
			}
			// The normal list under a 201: read as a 200 is.
			expect({ role, ...run(game, others, coded(seat, 201)) }).toEqual({ role, ...run(game, others) });
			// An error body, a page or an empty body under a failed status: a clean failure, and the void posts.
			// The same bodies under a 201 are read as a 200's are: an empty body is clean, and the void posts; a
			// body that is not the feed's list is an answer the reader could not use.
			const bodies: [number, string, object][] = [
				[500, '{"error":"rate limited"}', VOIDS],
				[500, "<html>busy</html>", VOIDS],
				[500, "", VOIDS],
				[503, '{"error":"rate limited"}', VOIDS],
				[503, "<html>busy</html>", VOIDS],
				[503, "", VOIDS],
				[201, "", VOIDS],
				[201, '{"error":"rate limited"}', waits(seat, "unreadable")],
				[201, "<html>busy</html>", waits(seat, "unreadable")],
			];
			for (const [status, body, want] of bodies) {
				expect({ role, status, body, ...run(game, others, bodied(seat, status, body)) }).toMatchObject({ role, status, body, ...want });
			}
		}
		// Seat 3's result under an id that is not a seat 3 id: a result without a usable id, the id on the line,
		// and the void waits; under another seat 3 id, absence by design (a result carries no names or time to
		// bind it by), and the void posts.
		const resultId = (id: unknown) => afterSend(3, (p) => ownPath(3, p), (body: Record<string, any>[]) => body.map((r) => ({ ...r, ...FINAL[3], ID: id })));
		const ids: [unknown, string][] = [
			["0", 'result without a usable id: "0"'],
			["not-a-feed-id", 'result without a usable id: "not-a-feed-id"'],
			["  ", 'result without a usable id: "  "'],
			[null, "result without a usable id: null"],
			[0, "result without a usable id: 0"],
			[12345678, "result without a usable id: 12345678"],
		];
		for (const [id, detail] of ids) {
			expect({ id, ...run(bears, both(off(1), off(2)), resultId(id)) }).toEqual({ id, ...waits(3, detail) });
		}
		expect(run(bears, both(off(1), off(2)), resultId("00000000-0000-4000-8000-000000000000"))).toMatchObject(VOIDS);
		// A failed answer at seat 3 whose rows are under another seat 3 id, or under no usable id: no row of the
		// hint's, a clean failure, and the void posts; the hint's row in it holds (above).
		expect(run(bears, both(off(1), off(2)), wrap(resultId("0"), coded(3, 503)))).toMatchObject(VOIDS);
		expect(run(bears, both(off(1), off(2)), wrap(resultId("00000000-0000-4000-8000-000000000000"), coded(3, 503)))).toMatchObject(VOIDS);
	});

	test("where scoring lives: two agreeing finals after n score over a third answer that is not a competing final, kind 2, and the game once scored is never read again; finals that differ, and a lone final against two votes, dispute; inside n, two finals beside anything wait", () => {
		const final = (seat: Seat): Derive => rowsAt(seat, (r) => [{ ...r, ...FINAL[seat] }]);
		const scored = (game: ChainGame, derive: Derive, around?: (send: Send) => Send) => {
			const t = saved(derive, NOW);
			const o = scoreGameSync(game, KEYS, PAYOUT, H24, around === undefined ? t.send : around(t.send));
			expect(t.misses).toEqual([]);
			return { action: o.decision.action, kind: o.report?.kind ?? null, points: o.decision.action === "score" ? [o.decision.home, o.decision.away] : null };
		};
		// The third seat's answers: in play in a word the reader knows, a word it does not, an answer it could
		// not use, postponed, cancelled; and at each third seat, the other two counting seats final.
		const thirds: [Seat, string, Record<string, unknown> | null][] = [
			[1, "in play", { status_state: "in_progress" }],
			[1, "unrecognized", { status_state: "Final" }],
			[1, "unusable", NO_POINTS[1]],
			[1, "postponed", { status_state: "postponed" }],
			[1, "cancelled", { status_state: "canceled" }],
			[2, "in play", { status: "in progress" }],
			[2, "unrecognized", { status: "FINAL" }],
			[2, "unusable", NO_POINTS[2]],
			[2, "postponed", { status: "postponed" }],
			[2, "cancelled", { status: "canceled" }],
			[3, "in play", { Final: false, FinalType: "NotFinished" }],
			[3, "unrecognized", { Final: true, FinalType: "Finished " }],
			[3, "unusable", NO_POINTS[3]],
			[3, "postponed", { FinalType: "Postponed" }],
			[3, "cancelled", { FinalType: "Canceled" }],
			[4, "in play", { completed: false }],
			[4, "unrecognized", { completed: "true" }],
			[4, "unusable", NO_POINTS[4]],
		];
		for (const [third, what, fields] of thirds) {
			const game = third === 4 ? spareIn : bears;
			const counting: Seat[] = third === 4 ? [1, 2, 4] : [1, 2, 3];
			const finals = counting.filter((s) => s !== third).map((s) => final(s));
			const derive = both(...finals, rowsAt(third, (r) => [{ ...r, ...(fields ?? {}) }]));
			expect({ third, what, ...scored(game, derive) }).toEqual({ third, what, action: "score", kind: 2, points: [24, 17] });
			// Once scored, the game has ended: the program reads nothing more of it, on day 7 or ever.
			const t = saved(derive, NOW);
			const later = scoreGameSync({ ...game, status: "scored" }, KEYS, PAYOUT, (game.start as number) + 8 * 86_400, t.send);
			expect({ third, what, later: [later.decision.action, later.decision.why, later.report, t.asked.length] }).toEqual({ third, what, later: ["wait", "the game has ended", null, 0] });
		}
		// Two finals that differ: the record. A lone final against two votes: the record.
		expect(scored(bears, both(final(1), rowsAt(2, (r) => [{ ...r, ...FINAL[2], ...OTHER[2] }])))).toEqual({ action: "dispute", kind: 4, points: null });
		expect(scored(bears, both(final(1), off(2), off(3)))).toEqual({ action: "dispute", kind: 4, points: null });
		// Inside n, two finals beside anything: no score.
		const inside = (derive: Derive) => {
			const t = saved(derive, NOW);
			const o = scoreGameSync(bears, KEYS, PAYOUT, (bears.start as number) + bears.n - 600, t.send);
			expect(t.misses).toEqual([]);
			return [o.decision.action, o.decision.why, o.report];
		};
		expect(inside(both(final(1), final(2)))).toEqual(["wait", "inside n: not every counting seat has a final yet", null]);
		expect(inside(both(final(1), final(2), rowsAt(3, () => [])))).toEqual(["wait", "inside n: a counting seat is silent", null]);
		expect(inside(both(final(1), final(2), rowsAt(3, (r) => [{ ...r, ...NO_POINTS[3] }])))).toEqual(["wait", "inside n: a counting seat is silent", null]);
		expect(inside(both(final(1), final(2), off(3)))).toEqual(["wait", "inside n: not every counting seat has a final yet", null]);
	});
});
