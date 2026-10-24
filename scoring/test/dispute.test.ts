// When the dispute record is posted (rule.ts, decide). Inside n, two finals that differ post it only
// once every seat the run reads shows a final: each counting seat and the spare, less a seat silent
// for the whole game. Until then the run waits, so a feed still catching up never has its "no final"
// frozen into the record day 7 reads. From start + n, two finals that differ post it at once.
//
// Counted by hand, over the 256 ways the four seats can read (silent, answered without a final, or
// one of two different finals), for each counting set. Two finals differ in 256 - 81 - 81 + 16 = 110
// of them: every way, less those with no A, less those with no B, plus those with neither.
//
//   inside n, seats 1 to 3 counting   every seat read is all four: all four final, not all the same:
//                                     2^4 - 2 = 14 records; the other 96 wait.
//   inside n, the spare standing in   every seat read is 1, 2 and 4: those three final (8 ways), seat 3
//                                     in any of its 4 states, less the 6 where nothing differs (seats
//                                     1, 2 and 4 the same final, seat 3 silent, without a final or that
//                                     same final): 32 - 6 = 26 records; the other 84 wait.
//   after n                           all 110 post the record, in each set: 220.
//
// The break that turns this red (rule.ts, decide):
//   if (inside && read.some((s) => of(s).kind !== "final")) {
//   ->  if (false) {

import { describe, expect, test } from "bun:test";
import { scoreGameSync } from "../src/program";
import { decide } from "../src/rule";
import type { Seat } from "../src/types";
import { LATE } from "./cases";
import { KEY, copy, saved, type Derive } from "./fixtures";
import { PAYOUT, SEATS4, chainOf, everyFour, reading, type State } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const SETS: readonly (readonly Seat[])[] = [
	[1, 2, 3],
	[1, 2, 4],
];

describe("the dispute record: inside n only once every seat read shows a final; from start + n at once", () => {
	test("every disagreement in the sweep, inside n and after, decided as counted by hand", () => {
		const count: Record<string, number> = {};
		const wrong: unknown[] = [];
		for (const counting of SETS) {
			const read = counting.includes(3) ? [1, 2, 3, 4] : [1, 2, 4];
			for (const inside of [true, false]) {
				for (const states of everyFour()) {
					const d = decide(SEATS4.map((s, i) => reading(s, states[i])), counting, inside);
					const finals = states.filter((s) => s === "A" || s === "B");
					const differ = finals.includes("A") && finals.includes("B");
					const key = `${counting.join("")} ${inside ? "inside" : "after"} ${d.action}`;
					if (differ) count[key] = (count[key] ?? 0) + 1;
					// Inside n, a record is posted only on a disagreement with every seat read final.
					if (inside && d.action === "dispute") {
						const allRead = read.every((s) => states[s - 1] === "A" || states[s - 1] === "B");
						if (!differ || !allRead) wrong.push({ counting, inside, states });
					}
					if (!inside && differ && d.action !== "dispute") wrong.push({ counting, inside, states, action: d.action });
				}
			}
		}
		expect(wrong).toEqual([]);
		expect(count).toEqual({
			"123 inside dispute": 14,
			"123 inside wait": 96,
			"123 after dispute": 110,
			"124 inside dispute": 26,
			"124 inside wait": 84,
			"124 after dispute": 110,
		});
	});

	test("the edges, by name", () => {
		const d = (counting: readonly Seat[], inside: boolean, states: State[]) => {
			const r = decide(SEATS4.map((s, i) => reading(s, states[i])), counting, inside);
			return `${r.action}: ${r.why}`;
		};
		const WAIT = "wait: inside n: two finals differ, and a seat has no final yet";
		const RECORD = "dispute: two finals differ";
		const rows: [readonly Seat[], boolean, State[], string][] = [
			[[1, 2, 3], true, ["A", "B", "none", "none"], WAIT], // two seats still catching up
			[[1, 2, 3], true, ["A", "B", "A", "silent"], WAIT], // the spare silent this run
			[[1, 2, 3], true, ["A", "A", "A", "B"], RECORD], // every seat final; the spare dissents
			[[1, 2, 3], true, ["A", "B", "A", "B"], RECORD],
			[[1, 2, 4], true, ["A", "B", "silent", "A"], RECORD], // seat 3 is silent for the game: not waited for
			[[1, 2, 4], true, ["A", "B", "silent", "none"], WAIT],
			[[1, 2, 3], false, ["A", "B", "silent", "silent"], RECORD], // after n, at once
			[[1, 2, 3], false, ["A", "B", "none", "none"], RECORD],
		];
		for (const [counting, inside, states, want] of rows) {
			expect({ counting, inside, states, got: d(counting, inside, states) }).toEqual({ counting, inside, states, got: want });
		}
	});

	test("end to end: a feed that corrects its final minutes later is not frozen into a record", () => {
		// Cleveland at Philadelphia, inside its window at 03:32, 114-106 at every seat in the saved
		// answers. Derived: seat 2's home points one more, and seats 3 and 4 not yet final.
		const g = chainOf("nba final, read after the game");
		const seat2Off: Derive = (s, p, b) => {
			if (s !== 2 || !p.startsWith("/games?league=NBA")) return b;
			const c = copy(b) as { results: Record<string, any>[] };
			for (const x of c.results) if (x.gameId === 340484) x.scoreboard.score.home = 115;
			return c;
		};
		const behind: Derive = (s, p, b) => {
			if (s === 3 && p === "/results/cc394a49-c3d1-4b8c-bba2-8ebbb8326c09") return (copy(b) as Record<string, unknown>[]).map((r) => ({ ...r, Final: false }));
			if (s === 4 && p.includes("basketball_nba")) return (copy(b) as Record<string, any>[]).map((x) => (x.id === "110e33c79c5ec8c0377702aff685f83b" ? { ...x, completed: false } : x));
			return b;
		};
		const both = (...ds: Derive[]): Derive => (s, p, b) => ds.reduce((acc, f) => f(s, p, acc), b);
		const at = (derive: Derive) => {
			const t = saved(derive, LATE);
			const o = scoreGameSync(g, KEYS, PAYOUT, LATE, t.send);
			expect(t.misses).toEqual([]);
			return [o.decision.action, o.decision.why, o.report?.kind ?? null];
		};
		// Seats 1 and 2 differ, seats 3 and 4 still catching up: no record yet.
		expect(at(both(seat2Off, behind))).toEqual(["wait", "inside n: two finals differ, and a seat has no final yet", null]);
		// Seats 3 and 4 catch up and seat 2 has corrected its points: the game scores.
		expect(at((_s, _p, b) => b)).toEqual(["score", "inside n: every counting seat, the same final", 2]);
		// Seats 3 and 4 catch up and seat 2 still differs: now the record is posted, with every seat's final.
		expect(at(seat2Off)).toEqual(["dispute", "two finals differ", 4]);
	});
});
