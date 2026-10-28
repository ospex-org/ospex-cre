// Never: "The hour-24 void posts while any answering feed shows a final, or on fewer than two counting
// seats' affirmative answers."
//
// The hour-24 void is every void a run decides before a dispute record (a day-7 void can hold
// finals, 2-2 among them, and is held to day 7's own line in never-day7.test.ts). "Any answering
// feed" is any seat asked, the spare and a seat that does not count included. An affirmative answer
// is the game's own row whose status in the feed's own words says the game will not or did not play:
// postponed or cancelled, and nothing else (the reading's `recorded`); a row that says the game is
// scheduled or in play is an answer, not a void's vote; absence and a partial row are silence
// (never-affirmative.test.ts). A void is held to the finals' count after n: two counting seats or
// more affirm, and the rest of the counting seats are silent.
//
// Counted by hand over six states a seat can read (silent; none, an answer in play; sched, the game's
// row scheduled, an answer all the same; off, a postponed answer; the finals A and B; the spare never
// off, since its feed has no such word): a void needs no final at any seat, two or more counting
// seats off, the rest of the counting seats silent, and the window closed. Seat 3 counting: two off
// and the third silent (3) or three off (1), the spare silent, in play or scheduled (3): 12. The
// spare standing in for seat 3 (counting 1, 2 and 4): seats 1 and 2 off, the spare silent, seat 3
// silent, in play, scheduled or off (4): 4. Sixteen in all, all after n. Inside n, none. A scheduled
// row adds no void anywhere: it is never a vote.
//
// The breaks that turn this red:
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
import { scoreGameSync } from "../src/program";
import { affirmsNoFinal, decide } from "../src/rule";
import type { Reading, Seat } from "../src/types";
import { CASES, NOW } from "./cases";
import { KEY, copy, saved, type Derive } from "./fixtures";
import { PAYOUT, SEATS4, chainOf, reading, type State } from "./rule-helpers";

const SETS: readonly (readonly Seat[])[] = [
	[1, 2, 3],
	[1, 2, 4],
];
const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

/** The sweep's four states and two more: sched, the game's row scheduled, and off, postponed, the one affirmative answer without a final. */
type Six = State | "sched" | "off";
const SIX: readonly Six[] = ["silent", "none", "sched", "off", "A", "B"];
/** The spare's feed has no word that a game will not play: it is never off. */
const SPARE_STATES: readonly Six[] = ["silent", "none", "sched", "A", "B"];

function of(seat: Seat, s: Six): Reading {
	if (s === "off") return { seat, kind: "no_final", home: null, away: null, recorded: "postponed", detail: "postponed", record: { id: `r${seat}`, time: null } };
	if (s === "sched") return { seat, kind: "no_final", home: null, away: null, recorded: null, detail: "scheduled", record: { id: `r${seat}`, time: null } };
	return reading(seat, s);
}

/** Every assignment of a state to each seat: 6 x 6 x 6 x 5 = 1,080. */
function* everySix(): Generator<readonly [Six, Six, Six, Six]> {
	for (const a of SIX) for (const b of SIX) for (const c of SIX) for (const d of SPARE_STATES) yield [a, b, c, d];
}

describe("never: the hour-24 void while any answering feed shows a final, or on fewer than two affirmative answers", () => {
	test("no void in the sweep has a final at any seat or fewer than two counting seats postponed with the rest silent, none comes inside the window, none rests on a scheduled row, and the voids are the ones counted by hand", () => {
		const voids = { inside: 0, after: 0 };
		let swept = 0;
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const states of everySix()) {
					swept++;
					const readings = SEATS4.map((s, i) => of(s, states[i]));
					const d = decide(readings, counting, inside);
					if (d.action !== "void") continue;
					voids[inside ? "inside" : "after"]++;
					const where = { counting, inside, states };
					expect({ ...where, finals: readings.filter((r) => r.kind === "final").map((r) => r.seat) }).toEqual({ ...where, finals: [] });
					const counted = counting.map((s) => readings[s - 1]);
					const affirmed = counted.filter(affirmsNoFinal).length;
					const otherAnswers = counted.filter((r) => r.kind !== "silent" && !affirmsNoFinal(r)).length;
					expect({ ...where, enough: affirmed >= 2, restSilent: otherAnswers === 0, scheduledCounting: counted.some((r) => r.detail === "scheduled") }).toEqual({ ...where, enough: true, restSilent: true, scheduledCounting: false });
				}
			}
		}
		expect({ swept, voids }).toEqual({ swept: 4_320, voids: { inside: 0, after: 16 } });
	});

	test("the edges, by name", () => {
		const d = (counting: readonly Seat[], inside: boolean, states: Six[]) => decide(SEATS4.map((s, i) => of(s, states[i])), counting, inside).action;
		const rows: [readonly Seat[], boolean, Six[], string][] = [
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
		];
		for (const [counting, inside, states, want] of rows) {
			expect({ counting, inside, states, got: d(counting, inside, states) }).toEqual({ counting, inside, states, got: want });
		}
		// The line of a run that waits on the count says what each seat gave.
		const one = decide(SEATS4.map((s, i) => of(s, (["off", "sched", "silent", "silent"] as Six[])[i])), [1, 2, 3], false);
		expect([one.action, one.why]).toEqual(["wait", "after n: 1 counting seat says the game will not or did not play, two needed; seat 1 postponed, seat 2 scheduled, seat 3 silence (silent), seat 4 silence (silent)"]);
		const none = decide(SEATS4.map((s, i) => of(s, (["sched", "sched", "silent", "none"] as Six[])[i])), [1, 2, 3], false);
		expect([none.action, none.why]).toEqual(["wait", "after n: 0 counting seats say the game will not or did not play, two needed; seat 1 scheduled, seat 2 scheduled, seat 3 silence (silent), seat 4 in progress"]);
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
});
