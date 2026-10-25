// Never: "A score is written on fewer than two agreeing finals, or fewer than three inside the
// window, or while any reported final disagrees, except as day 7 provides."
//
// Day 7 has its own line and file (never-day7.test.ts). Here: every run before a dispute record. A
// game with a record scores by this same rule, on the run's own readings (dispute.test.ts).
//
// The sweep decides all 256 ways the four seats can read (silent, answered without a final, or one
// of two different finals), inside n and after, with seats 1 to 3 counting and with the spare
// standing in for seat 3. Every score it finds is held to the line. The number of scores is
// counted by hand, below, so a rule that scores too little fails as surely as one that scores too
// much:
//
//   inside n   the three counting seats all give the same final (2 finals to choose), and the
//              fourth seat is silent, answered without a final, or gives that same final (3):
//              2 x 3 = 6 per counting set, 12 in all.
//   after n    the counting seats give the same final at two or three of them and are silent at
//              the rest (XXX, XX_, X_X, _XX: 4 patterns x 2 finals), and the fourth seat is silent,
//              answered without a final, or gives that same final (3): 24 per set, 48 in all.
//
// The break that turns this red (rule.ts, decide):
//   if (finalsCounted === AGREE.insideN) {
//   ->  if (finalsCounted >= AGREE.afterN) {

import { describe, expect, test } from "bun:test";
import { scoreGameSync } from "../src/program";
import { decide } from "../src/rule";
import type { Seat } from "../src/types";
import { NOW } from "./cases";
import { KEY, at, copy, locate, saved, type Derive } from "./fixtures";
import { POINTS, PAYOUT, SEATS4, chainOf, everyFour, reading, type State } from "./rule-helpers";

const SETS: readonly (readonly Seat[])[] = [
	[1, 2, 3],
	[1, 2, 4],
];
const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

describe("never: a score on fewer than two agreeing finals, fewer than three inside the window, or while finals disagree", () => {
	test("every score in the sweep holds to the line, and the scores are exactly the ones counted by hand", () => {
		const scores = { inside: 0, after: 0 };
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const states of everyFour()) {
					const readings = SEATS4.map((s, i) => reading(s, states[i]));
					const d = decide(readings, counting, inside);
					if (d.action !== "score") continue;
					scores[inside ? "inside" : "after"]++;
					const finals = readings.filter((r) => r.kind === "final");
					const agree = counting.filter((s) => {
						const r = readings[s - 1];
						return r.kind === "final" && r.home === d.home && r.away === d.away;
					}).length;
					const where = { counting, inside, states };
					// No reported final disagrees, the spare's included.
					expect({ ...where, disagree: finals.filter((f) => f.home !== d.home || f.away !== d.away).length }).toEqual({ ...where, disagree: 0 });
					// Three inside the window; two after.
					expect({ ...where, enough: agree >= (inside ? 3 : 2) }).toEqual({ ...where, enough: true });
					// After n the rest are silent: a counting seat that answered without a final is not silent.
					const answeredNoFinal = counting.filter((s) => readings[s - 1].kind === "no_final").length;
					expect({ ...where, answeredNoFinal }).toEqual({ ...where, answeredNoFinal: 0 });
				}
			}
		}
		expect(scores).toEqual({ inside: 12, after: 48 });
	});

	test("one seat's reading given three times is one reading: three finals all labelled seat 1 wait, inside n and after", () => {
		const three = [reading(1, "A"), { ...reading(1, "A") }, { ...reading(1, "A") }];
		const inside = decide(three, [1, 2, 3], true);
		const after = decide(three, [1, 2, 3], false);
		expect([inside.action, inside.why, after.action, after.why]).toEqual(["wait", "inside n: a counting seat is silent", "wait", "after n: fewer than two counting seats answer"]);
		// The control: the same final at seats 1, 2 and 3 scores, inside n and after.
		const real = [reading(1, "A"), reading(2, "A"), reading(3, "A")];
		expect([decide(real, [1, 2, 3], true).action, decide(real, [1, 2, 3], false).action]).toEqual(["score", "score"]);
	});

	test("the edges, by name: what scores, what waits, and what is a disagreement", () => {
		const d = (counting: readonly Seat[], inside: boolean, states: readonly State[]) => {
			const r = decide(SEATS4.map((s, i) => reading(s, states[i])), counting, inside);
			return r.action === "score" ? `score ${r.home}-${r.away}` : r.action;
		};
		const [h, a] = POINTS.A;
		const A = `score ${h}-${a}`;
		const rows: [readonly Seat[], boolean, State[], string][] = [
			// Inside n: all three counting seats, the same final.
			[[1, 2, 3], true, ["A", "A", "A", "silent"], A],
			[[1, 2, 3], true, ["A", "A", "A", "none"], A],
			[[1, 2, 3], true, ["A", "A", "A", "A"], A],
			[[1, 2, 3], true, ["A", "A", "silent", "A"], "wait"], // a silent counting seat blocks; the spare does not stand in for it
			[[1, 2, 3], true, ["A", "A", "none", "A"], "wait"], // a seat still without a final, inside n: wait
			[[1, 2, 3], true, ["A", "A", "A", "B"], "dispute"], // the spare's final disagrees
			[[1, 2, 3], true, ["A", "B", "silent", "silent"], "dispute"], // two finals differ: the record at once, inside n too (dispute.test.ts)
			// After n: two, the third silent.
			[[1, 2, 3], false, ["A", "A", "silent", "silent"], A],
			[[1, 2, 3], false, ["silent", "A", "A", "none"], A], // the spare's answer without a final blocks nothing
			[[1, 2, 3], false, ["A", "A", "none", "silent"], "dispute"], // answered without a final is not silent
			[[1, 2, 3], false, ["A", "silent", "silent", "A"], "wait"], // one counting final and the spare's is not two
			[[1, 2, 3], false, ["A", "A", "silent", "B"], "dispute"],
			// The spare standing in for seat 3.
			[[1, 2, 4], true, ["A", "A", "silent", "A"], A],
			[[1, 2, 4], true, ["A", "A", "silent", "silent"], "wait"],
			[[1, 2, 4], true, ["A", "A", "B", "A"], "dispute"], // seat 3 does not count, but its final still disagrees
			[[1, 2, 4], false, ["A", "silent", "silent", "A"], A],
		];
		for (const [counting, inside, states, want] of rows) {
			expect({ counting, inside, states, got: d(counting, inside, states) }).toEqual({ counting, inside, states, got: want });
		}
	});

	// The artifact: the report the program builds from the real saved answers. Golden State at the
	// Lakers, 22 Oct, 127-105, created without a seat 3 hint, so the spare counts in seat 3's place.
	// The clock is 17:30 UTC, inside the window [02:00, 02:00 next day).
	const lakers = chainOf("nba final");
	const seat = (n: number, path: string) => (s: Seat, p: string) => s === n && p.startsWith(path);

	function run(now: number, derive?: Derive) {
		const t = saved(derive, now);
		const out = scoreGameSync(lakers, KEYS, PAYOUT, now, t.send);
		expect(t.misses).toEqual([]);
		const r = out.report;
		return r === null ? "no report" : `kind ${r.kind} ${r.homeScore}-${r.awayScore}`;
	}

	test("end to end: three agreeing finals inside the window write the score; one changed point writes the dispute record", () => {
		expect(run(NOW)).toBe("kind 2 127-105");
		// Derived from the real answer: seat 2's home points one fewer.
		const offByOne: Derive = (s, p, body) => {
			if (!seat(2, "/games?league=NBA")(s, p)) return body;
			const b = copy(body) as { results: Record<string, any>[] };
			for (const g of b.results) if (g.gameId === 340490) g.scoreboard.score.home -= 1;
			return b;
		};
		expect(run(NOW, offByOne)).toBe("kind 4 0-0");
	});

	test("end to end: one counting seat silent writes nothing inside the window, and the score after it", () => {
		// Seat 1 refuses every request; the others answer from the saved answers as of the run's clock.
		const silenced = (now: number) => {
			const t = saved(undefined, now);
			const out = scoreGameSync(lakers, KEYS, PAYOUT, now, (req) => (locate(req)?.seat === 1 ? { status: 503, body: "" } : t.send(req)));
			expect(t.misses).toEqual([]);
			const seat1 = out.decision.readings.find((r) => r.seat === 1);
			expect(seat1).toMatchObject({ kind: "silent", detail: "http 503" });
			return out.report === null ? out.decision.why : `kind ${out.report.kind} ${out.report.homeScore}-${out.report.awayScore}`;
		};
		expect(silenced(NOW)).toBe("inside n: a counting seat is silent");
		// The same answers a minute after the window closes: two agreeing finals, the third silent.
		expect(silenced(at("2026-10-23T02:01:00Z"))).toBe("kind 2 127-105");
	});

	test("end to end: the window's last second is inside n; start + n itself is after", () => {
		const why = (now: number) => {
			const t = saved(undefined, now);
			const out = scoreGameSync(lakers, KEYS, PAYOUT, now, (req) => (locate(req)?.seat === 1 ? { status: 503, body: "" } : t.send(req)));
			expect(t.misses).toEqual([]);
			return out.decision.why;
		};
		const end = lakers.start! + lakers.n;
		expect(why(end - 1)).toBe("inside n: a counting seat is silent");
		expect(why(end)).toBe("after n: two counting seats or more, the same final, the rest silent");
	});
});
