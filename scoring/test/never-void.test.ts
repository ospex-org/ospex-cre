// Never: "The hour-24 void posts while any answering feed shows a final, or on fewer than two counting
// seats' affirmative answers."
//
// The hour-24 void is every void a run decides before a dispute record (a day-7 void can hold
// finals, 2-2 among them, and is held to day 7's own line in never-day7.test.ts). "Any answering
// feed" is any seat asked, the spare and a seat that does not count included. An affirmative answer
// is the game's own row whose status in the feed's own words says the game will not or did not play
// (postponed, cancelled, not started: the reading's `recorded`); a row in play is an answer, not a
// void's vote; absence and a partial row are silence (never-affirmative.test.ts). A void is held to
// the finals' count after n: two counting seats or more affirm, and the rest of the counting seats
// are silent.
//
// Counted by hand over five states a seat can read (silent; none, an answer in play; off, a
// postponed answer; the finals A and B; the spare never off, since its feed has no such word): a
// void needs no final at any seat, two or more counting seats off, the rest of the counting seats
// silent, and the window closed. Seat 3 counting: two off and the third silent (3) or three off
// (1), the spare silent or none (2): 8. The spare standing in for seat 3 (counting 1, 2 and 4):
// seats 1 and 2 off, the spare silent, seat 3 silent, none or off (3): 3. Eleven in all, all after
// n. Inside n, none.
//
// The breaks that turn this red (rule.ts, decide):
//   const affirmed = counted.filter(affirmsNoFinal).length;
//   ->  const affirmed = answeredCounted;
// with which two answers in play void the game at hour 24; and
//   if (affirmed >= AGREE.afterN && answeredCounted === affirmed) return { action: "void", ...
//   ->  if (affirmed >= AGREE.afterN) return { action: "void", ...
// with which two postponed rows void beside a third counting seat that says the game is on.

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

/** The sweep's four states and one more: off, the game's own row postponed, an affirmative answer without a final. */
type Five = State | "off";
const FIVE: readonly Five[] = ["silent", "none", "off", "A", "B"];
/** The spare's feed has no word that a game will not play: it is never off. */
const SPARE_STATES: readonly Five[] = ["silent", "none", "A", "B"];

function of(seat: Seat, s: Five): Reading {
	if (s === "off") return { seat, kind: "no_final", home: null, away: null, recorded: "postponed", detail: "postponed", record: { id: `r${seat}`, time: null } };
	return reading(seat, s);
}

/** Every assignment of a state to each seat: 5 x 5 x 5 x 4 = 500. */
function* everyFive(): Generator<readonly [Five, Five, Five, Five]> {
	for (const a of FIVE) for (const b of FIVE) for (const c of FIVE) for (const d of SPARE_STATES) yield [a, b, c, d];
}

describe("never: the hour-24 void while any answering feed shows a final, or on fewer than two affirmative answers", () => {
	test("no void in the sweep has a final at any seat or fewer than two counting seats affirming with the rest silent, none comes inside the window, and the voids are the ones counted by hand", () => {
		const voids = { inside: 0, after: 0 };
		let swept = 0;
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const states of everyFive()) {
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
					expect({ ...where, enough: affirmed >= 2, restSilent: otherAnswers === 0 }).toEqual({ ...where, enough: true, restSilent: true });
				}
			}
		}
		expect({ swept, voids }).toEqual({ swept: 2_000, voids: { inside: 0, after: 11 } });
	});

	test("the edges, by name", () => {
		const d = (counting: readonly Seat[], inside: boolean, states: Five[]) => {
			const r = decide(SEATS4.map((s, i) => of(s, states[i])), counting, inside);
			return r.action;
		};
		const rows: [readonly Seat[], boolean, Five[], string][] = [
			[[1, 2, 3], false, ["off", "off", "silent", "silent"], "void"],
			[[1, 2, 3], false, ["off", "off", "off", "none"], "void"], // the spare in play does not count, and never blocks
			[[1, 2, 3], false, ["off", "off", "none", "silent"], "wait"], // a counting seat in play holds the void, as it would a score
			[[1, 2, 3], false, ["off", "none", "silent", "silent"], "wait"], // one affirmative answer
			[[1, 2, 3], false, ["none", "none", "silent", "silent"], "wait"], // two answers in play are no void's votes
			[[1, 2, 3], false, ["off", "silent", "silent", "silent"], "wait"], // fewer than two counting seats answer
			[[1, 2, 3], false, ["off", "off", "silent", "A"], "dispute"], // the spare's final: no void, a disagreement
			[[1, 2, 4], false, ["off", "off", "A", "silent"], "dispute"], // seat 3 does not count here, but it answers with a final
			[[1, 2, 4], false, ["off", "off", "silent", "silent"], "void"],
			[[1, 2, 4], false, ["off", "off", "none", "silent"], "void"], // seat 3 silent for the game: its row does not count
			[[1, 2, 4], false, ["off", "off", "silent", "none"], "wait"], // the counting spare in play holds the void
			[[1, 2, 3], true, ["off", "off", "off", "silent"], "wait"], // never inside the window
		];
		for (const [counting, inside, states, want] of rows) {
			expect({ counting, inside, states, got: d(counting, inside, states) }).toEqual({ counting, inside, states, got: want });
		}
		// The line of a run that waits on the count says what each seat gave.
		const one = decide(SEATS4.map((s, i) => of(s, (["off", "none", "silent", "silent"] as Five[])[i])), [1, 2, 3], false);
		expect([one.action, one.why]).toEqual(["wait", "after n: 1 counting seat says the game will not or did not play, two needed; seat 1 postponed, seat 2 in progress, seat 3 silence (silent), seat 4 silence (silent)"]);
		const none = decide(SEATS4.map((s, i) => of(s, (["none", "none", "silent", "none"] as Five[])[i])), [1, 2, 3], false);
		expect([none.action, none.why]).toEqual(["wait", "after n: 0 counting seats say the game will not or did not play, two needed; seat 1 in progress, seat 2 in progress, seat 3 silence (silent), seat 4 in progress"]);
	});

	// The artifact, on real answers: Atlanta at the White Sox, 11 Jun, rained out. Seat 1 reads it
	// postponed and seat 2 cancelled, at its own time; the game was created without a seat 3 hint, so
	// the spare counts in seat 3's place, and the spare keeps three days, so on 22 Oct it is silent.
	const rainout = chainOf("mlb postponed");

	test("end to end: a postponed game voids after its window on two affirmative rows; with one it waits; a final at any seat stops the void", () => {
		const out = (derive?: Derive) => {
			const t = saved(derive, NOW);
			const o = scoreGameSync(rainout, KEYS, PAYOUT, NOW, t.send);
			expect(t.misses).toEqual([]);
			return { action: o.decision.action, why: o.decision.why, kind: o.report?.kind ?? null, readings: o.report?.readings.map((r) => [r.seat, r.kind]) ?? null };
		};
		const seat2 = (fields: Record<string, unknown>): Derive => (s, p, body) => {
			if (s !== 2 || !p.includes("league=MLB")) return body;
			const b = copy(body) as { results: Record<string, any>[] };
			for (const g of b.results) if (g.gameId === 336995) Object.assign(g, fields);
			return b;
		};
		expect(out()).toMatchObject({ action: "void", kind: 3, readings: [[1, 1], [2, 1], [3, 0], [4, 0]] });
		// Seat 2 saying not started, in its own word: still two affirmative rows, still the void.
		expect(out(seat2({ status: "scheduled" }))).toMatchObject({ action: "void", kind: 3 });
		// Seat 2 saying the game is in play: one affirmative row beside an answer in play, and the run waits,
		// its line saying what each seat gave.
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
