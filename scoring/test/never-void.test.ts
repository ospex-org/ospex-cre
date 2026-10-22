// Never: "The hour-24 void posts while any answering feed shows a final."
//
// The hour-24 void is every void a run decides before a dispute record (a day-7 void can hold
// finals, 2-2 among them, and is held to day 7's own line in never-day7.test.ts). "Any answering
// feed" is any seat asked, the spare and a seat that does not count included.
//
// Counted by hand: a void needs no final at any seat, at least two counting seats answering, and
// the window closed. Each seat is silent or answered without a final; the three counting seats
// answer at all three or at two of them (NNN, NN_, N_N, _NN: 4) and the fourth seat is silent or
// answered (2): 8 per counting set, 16 in all, all after n. Inside n, none.
//
// The break that turns this red (rule.ts, decide):
//   if (finals.length === 0) return { action: "void", ...
//   ->  if (finalsCounted === 0) return { action: "void", ...

import { describe, expect, test } from "bun:test";
import { scoreGameSync } from "../src/program";
import { decide } from "../src/rule";
import type { Seat } from "../src/types";
import { CASES, NOW } from "./cases";
import { KEY, copy, saved, type Derive } from "./fixtures";
import { PAYOUT, SEATS4, chainOf, everyFour, reading, type State } from "./rule-helpers";

const SETS: readonly (readonly Seat[])[] = [
	[1, 2, 3],
	[1, 2, 4],
];
const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

describe("never: the hour-24 void while any answering feed shows a final", () => {
	test("no void in the sweep has a final at any seat, none comes inside the window, and the voids are the ones counted by hand", () => {
		const voids = { inside: 0, after: 0 };
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const states of everyFour()) {
					const readings = SEATS4.map((s, i) => reading(s, states[i]));
					const d = decide(readings, counting, inside);
					if (d.action !== "void") continue;
					voids[inside ? "inside" : "after"]++;
					const where = { counting, inside, states };
					expect({ ...where, finals: readings.filter((r) => r.kind === "final").map((r) => r.seat) }).toEqual({ ...where, finals: [] });
					// "A silent feed blocks a void as it blocks a score": after n, at most one counting seat silent.
					const answered = counting.filter((s) => readings[s - 1].kind !== "silent").length;
					expect({ ...where, enough: answered >= 2 }).toEqual({ ...where, enough: true });
				}
			}
		}
		expect(voids).toEqual({ inside: 0, after: 16 });
	});

	test("the edges, by name", () => {
		const d = (counting: readonly Seat[], inside: boolean, states: State[]) => decide(SEATS4.map((s, i) => reading(s, states[i])), counting, inside).action;
		const rows: [readonly Seat[], boolean, State[], string][] = [
			[[1, 2, 3], false, ["none", "none", "none", "silent"], "void"],
			[[1, 2, 3], false, ["none", "none", "silent", "none"], "void"],
			[[1, 2, 3], false, ["none", "silent", "silent", "none"], "wait"], // two counting seats silent block a void
			[[1, 2, 3], true, ["none", "none", "none", "none"], "wait"], // never inside the window
			[[1, 2, 3], false, ["none", "none", "none", "A"], "dispute"], // the spare's final: no void, a disagreement
			[[1, 2, 4], false, ["none", "none", "A", "none"], "dispute"], // seat 3 does not count here, but it answers with a final
			[[1, 2, 3], false, ["none", "none", "A", "silent"], "dispute"],
		];
		for (const [counting, inside, states, want] of rows) {
			expect({ counting, inside, states, got: d(counting, inside, states) }).toEqual({ counting, inside, states, got: want });
		}
	});

	// The artifact, on real answers: Atlanta at the White Sox, 11 Jun, rained out. Seat 1 reads it
	// postponed and seat 2 cancelled, at its own time; the game was created without a seat 3 hint, so
	// the spare counts in seat 3's place, and the spare keeps three days, so on 22 Oct it is silent.
	const rainout = chainOf("mlb postponed");

	test("end to end: a postponed game voids after its window; a final at any seat stops the void", () => {
		const out = (derive?: Derive) => {
			const t = saved(derive, NOW);
			const o = scoreGameSync(rainout, KEYS, PAYOUT, NOW, t.send);
			expect(t.misses).toEqual([]);
			return { action: o.decision.action, kind: o.report?.kind ?? null, readings: o.report?.readings.map((r) => [r.seat, r.kind]) ?? null };
		};
		expect(out()).toEqual({ action: "void", kind: 3, readings: [[1, 1], [2, 1], [3, 0], [4, 0]] });
		// Derived from the real answer: seat 2 marks the rained-out game final, 3-1.
		const seat2Final: Derive = (s, p, body) => {
			if (s !== 2 || !p.includes("league=MLB")) return body;
			const b = copy(body) as { results: Record<string, any>[] };
			for (const g of b.results) {
				if (g.gameId === 336995) {
					g.status = "final";
					g.scoreboard = { score: { home: 3, away: 1 } };
				}
			}
			return b;
		};
		expect(out(seat2Final)).toEqual({ action: "dispute", kind: 4, readings: [[1, 1], [2, 2], [3, 0], [4, 0]] });
	});

	test("the rainout's case is real: its game sits in D1's cases with the readings the void rests on", () => {
		const c = CASES.find((x) => x.name.startsWith("mlb postponed"))!;
		expect([c.expect[1]?.detail, c.expect[2]?.detail, c.expect[4]?.detail]).toEqual(["postponed", "canceled", "past retention"]);
	});
});
