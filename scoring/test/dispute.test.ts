// The dispute record (rule.ts): a record, not a lock.
//
//   The first record   Any two finals that differ, from any seat, post it at once, inside n or after
//                      (decide). From start + n, finals beside answers without one post it too.
//   After it           The game scores the moment the counting seats agree, by the same rule a game
//                      without a record scores by. Until then a run posts an update whenever a seat's
//                      final appears or changes against the record, and writes nothing otherwise
//                      (decideDisputed). Day 7, counted from the first record, is the deadline.
//
// Counted by hand, each over the 256 ways the four seats can read (silent, answered without a final,
// or one of two different finals) and, after a record, each of the 256 ways the record can hold them.
//
//   First record: two finals differ in 256 - 81 - 81 + 16 = 110 ways (every way, less those with no
//   A, less those with no B, plus those with neither). All 110 post the record, inside n and after,
//   for each counting set.
//
//   After a record: a seat's fresh reading "moves" when it is a final the record doesn't hold for that
//   seat: 6 of its 16 (fresh, recorded) pairs (fresh A beside recorded silent, none or B; fresh B the
//   same way). A fresh state with k finals is one of 16 * C(4, k), and moves beside 256 - 4^(4-k) of
//   the 256 records. Over all fresh states that is 65,536 - 16 * 5^4 = 55,536 moving pairs.
//   The scores are decide's, whatever the record (never-score-count.test.ts): inside n, 6 fresh
//   states for each counting set, 4 with three finals and 2 with four; after n, 24: 12 with two, 10
//   with three, 2 with four. Each of them takes all 256 records.
//     inside n   scores 6 * 256 = 1,536; updates 55,536 - (4 * 252 + 2 * 255) = 54,018;
//                waits 65,536 - 1,536 - 54,018 = 9,982
//     after n    scores 24 * 256 = 6,144; updates 55,536 - (12 * 240 + 10 * 252 + 2 * 255) = 49,626;
//                waits 65,536 - 6,144 - 49,626 = 9,766
//
// The breaks that turn this red (rule.ts):
//   decide, the record at once inside n:  return { action: "dispute", readings, why: "two finals differ" };
//                                     ->  return { action: inside ? "wait" : "dispute", readings, why: "two finals differ" };
//   decideDisputed, the score:            if (agreed.action === "score") return
//                                     ->  if (false) return
//   decideDisputed, never per tick:       if (moved.length > 0) {   ->   if (true) {

import { describe, expect, test } from "bun:test";
import { READING_KIND, type ReportReading } from "../src/chain";
import { scoreGameSync } from "../src/program";
import { decide, decideDay7, decideDisputed, lastRecorded } from "../src/rule";
import type { Seat } from "../src/types";
import { LATE } from "./cases";
import { KEY, copy, saved, type Derive } from "./fixtures";
import { PAYOUT, SEATS4, STATES, chainOf, everyFour, reading, reportReading, type State } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const SETS: readonly (readonly Seat[])[] = [
	[1, 2, 3],
	[1, 2, 4],
];
const readings = (states: readonly State[]) => SEATS4.map((s, i) => reading(s, states[i]));
const record = (states: readonly State[]): ReportReading[] => SEATS4.map((s, i) => reportReading(s, states[i]));

describe("the first record: posted at the first disagreement, inside n or after", () => {
	test("every disagreement in the sweep posts the record at once, counted by hand", () => {
		const count: Record<string, number> = {};
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const states of everyFour()) {
					const finals = states.filter((s) => s === "A" || s === "B");
					if (!(finals.includes("A") && finals.includes("B"))) continue;
					const d = decide(readings(states), counting, inside);
					const key = `${counting.join("")} ${inside ? "inside" : "after"} ${d.action}`;
					count[key] = (count[key] ?? 0) + 1;
				}
			}
		}
		expect(count).toEqual({ "123 inside dispute": 110, "123 after dispute": 110, "124 inside dispute": 110, "124 after dispute": 110 });
	});

	test("the edges, by name", () => {
		const d = (counting: readonly Seat[], inside: boolean, states: State[]) => {
			const r = decide(readings(states), counting, inside);
			return `${r.action}: ${r.why}`;
		};
		const RECORD = "dispute: two finals differ";
		const rows: [readonly Seat[], boolean, State[], string][] = [
			[[1, 2, 3], true, ["A", "B", "none", "none"], RECORD], // two seats still catching up: posted all the same
			[[1, 2, 3], true, ["A", "A", "none", "B"], RECORD], // the spare dissents while seat 3 has no final yet
			[[1, 2, 3], true, ["A", "B", "A", "silent"], RECORD],
			[[1, 2, 4], true, ["A", "B", "silent", "none"], RECORD],
			[[1, 2, 3], false, ["A", "B", "silent", "silent"], RECORD],
			[[1, 2, 3], false, ["A", "A", "none", "silent"], "dispute: after n: finals beside answers without a final"],
			[[1, 2, 3], true, ["A", "A", "none", "silent"], "wait: inside n: not every counting seat has a final yet"], // no disagreement inside n
		];
		for (const [counting, inside, states, want] of rows) {
			expect({ counting, inside, states, got: d(counting, inside, states) }).toEqual({ counting, inside, states, got: want });
		}
	});
});

describe("after the record: a score the moment the counting seats agree, an update when a final moves, and nothing else", () => {
	test("every fresh reading beside every record, before day 7, decided as counted by hand", () => {
		const count: Record<string, number> = {};
		const wrong: unknown[] = [];
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const f of everyFour()) {
					const fresh = readings(f);
					const plain = decide(fresh, counting, inside);
					for (const r of everyFour()) {
						const d = decideDisputed(fresh, record(r), counting, inside, false, SEATS4, null);
						const key = `${counting.join("")} ${inside ? "inside" : "after"} ${d.action}`;
						count[key] = (count[key] ?? 0) + 1;
						// A score exactly when decide scores, on the same points.
						const scored = plain.action === "score";
						if (scored !== (d.action === "score")) wrong.push({ counting, inside, f, r, d: d.action, plain: plain.action });
						if (scored && d.action === "score" && (d.home !== plain.home || d.away !== plain.away)) wrong.push({ f, r, points: true });
						// Otherwise an update exactly when a fresh final isn't the seat's recorded final.
						const moves = f.some((s, i) => (s === "A" || s === "B") && r[i] !== s);
						if (!scored && moves !== (d.action === "dispute")) wrong.push({ counting, inside, f, r, d: d.action, moves });
						// Never a void before day 7, and an update carries every fresh reading.
						if (d.action === "void") wrong.push({ counting, inside, f, r, void: true });
						if (d.action === "dispute" && d.readings !== fresh) wrong.push({ f, r, readings: true });
					}
				}
			}
		}
		expect(wrong).toEqual([]);
		expect(count).toEqual({
			"123 inside score": 1_536,
			"123 inside dispute": 54_018,
			"123 inside wait": 9_982,
			"123 after score": 6_144,
			"123 after dispute": 49_626,
			"123 after wait": 9_766,
			"124 inside score": 1_536,
			"124 inside dispute": 54_018,
			"124 inside wait": 9_982,
			"124 after score": 6_144,
			"124 after dispute": 49_626,
			"124 after wait": 9_766,
		});
	});

	test("from the day-7 clock: a score when the counting seats agree, and otherwise day 7's own rule", () => {
		const wrong: unknown[] = [];
		for (const counting of SETS) {
			for (const f of everyFour()) {
				const fresh = readings(f);
				const plain = decide(fresh, counting, false);
				for (const r of everyFour()) {
					const d = decideDisputed(fresh, record(r), counting, false, true, SEATS4, null);
					const want = plain.action === "score" ? plain : decideDay7(fresh, record(r), SEATS4, null);
					if (d.action !== want.action || (d.action === "score" && want.action === "score" && (d.home !== want.home || d.away !== want.away))) {
						wrong.push({ counting, f, r, got: d.action, want: want.action });
					}
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	test("the cases the second looks raised, by name", () => {
		const after = (counting: readonly Seat[], inside: boolean, f: State[], records: State[][], day7 = false) => {
			const d = decideDisputed(readings(f), lastRecorded(records.map(record), SEATS4), counting, inside, day7, SEATS4, null);
			return d.action === "score" ? `score ${d.home}-${d.away}` : d.action;
		};
		const C = [1, 2, 3] as const;
		// A dissent seen once is on record, and the game scores when the counting seats agree: the
		// spare's B inside n beside seat 3 not final posts the record; the next run, the spare silent and
		// seat 3 final A, scores A.
		expect(decide(readings(["A", "A", "none", "B"]), C, true).action).toBe("dispute");
		expect(after(C, true, ["A", "A", "A", "silent"], [["A", "A", "none", "B"]])).toBe("score 27-20");
		// The spare still answering B: the counting seats agree, but a final differs on this run, as it
		// would for a game without a record. Nothing new, so nothing is written.
		expect(after(C, true, ["A", "A", "A", "B"], [["A", "A", "A", "B"]])).toBe("wait");
		// One against three, then the three correct. The record holds A, B, B, B; the correction is an
		// update; then every counting seat agrees on A, and the game scores.
		expect(after(C, true, ["A", "B", "A", "A"], [["A", "B", "B", "B"]])).toBe("dispute");
		expect(after(C, true, ["A", "A", "A", "A"], [["A", "B", "B", "B"], ["A", "B", "A", "A"]])).toBe("score 27-20");
		// If seat 2 never corrects and seats 3 and 4 age out, day 7 reads their last recorded finals,
		// the corrected ones: it settles on A, never on the retracted B.
		expect(after(C, false, ["A", "B", "silent", "silent"], [["A", "B", "B", "B"], ["A", "B", "A", "A"]], true)).toBe("score 27-20");
		// Seat 3's final kept on record though it later falls silent: seats 1 and 2 differ, seat 3 A, the
		// spare not final. After n, seat 2 corrected and seat 3 silent: two counting seats agree, the
		// rest silent, and the game scores. At day 7 with seat 2 still B, seat 3's recorded A is a source.
		expect(after(C, false, ["A", "A", "silent", "A"], [["A", "B", "A", "none"]])).toBe("score 27-20");
		expect(after(C, false, ["A", "B", "silent", "A"], [["A", "B", "A", "none"]], true)).toBe("score 27-20");
		// Posted at start + n with seat 3 not final and the spare silent; a minute later all four agree.
		expect(decide(readings(["A", "A", "none", "silent"]), C, false).action).toBe("dispute");
		expect(after(C, false, ["A", "A", "A", "A"], [["A", "A", "none", "silent"]])).toBe("score 27-20");
	});

	test("never per tick: an update only when a seat's final appears or changes against the record", () => {
		const rec = [["A", "B", "none", "none"]] as State[][];
		const why = (f: State[], records = rec) => {
			const d = decideDisputed(readings(f), lastRecorded(records.map(record), SEATS4), [1, 2, 3], true, false, SEATS4, null);
			return `${d.action}: ${d.why}`;
		};
		const NOTHING = "wait: disputed: no seat's final has appeared or changed since the record";
		expect(why(["A", "B", "none", "none"])).toBe(NOTHING); // the same readings again
		expect(why(["A", "B", "silent", "silent"])).toBe(NOTHING); // seats falling silent move no final
		expect(why(["silent", "silent", "none", "none"])).toBe(NOTHING);
		expect(why(["A", "B", "A", "none"])).toBe("dispute: an update: a final the record doesn't hold, at seat 3"); // a final appears
		expect(why(["A", "A", "none", "B"])).toBe("dispute: an update: a final the record doesn't hold, at seat 2 and 4"); // one changes, one appears
		// A seat whose final regresses to no final moves nothing; the record still holds its final.
		expect(why(["none", "B", "none", "none"])).toBe(NOTHING);
		// Measured against the last final each seat gave on record, across every update.
		expect(why(["A", "A", "none", "none"], [["A", "B", "none", "none"], ["A", "A", "none", "none"]])).toBe("wait: disputed: no seat's final has appeared or changed since the record");
	});

	test("what the record holds for each seat: its last final on record, else its last answer, else silent", () => {
		const r = (seat: number, kind: 0 | 1 | 2, h = 0, a = 0): ReportReading => ({ seat, kind, homeScore: h, awayScore: a });
		const first = [r(1, 2, 27, 20), r(2, 2, 20, 27), r(3, 1, 3, 1), r(4, 0)];
		const update = [r(1, 1, 27, 20), r(2, 2, 27, 20), r(3, 0), r(4, 0)];
		expect(lastRecorded([first, update], SEATS4)).toEqual([
			r(1, 2, 27, 20), // a later answer without a final doesn't erase the final
			r(2, 2, 27, 20), // the later final stands
			r(3, 1, 3, 1), // no final on record: its last answer
			r(4, 0), // nothing on record: silent
		]);
		expect(lastRecorded([], SEATS4)).toEqual(SEATS4.map((s) => r(s, READING_KIND.silent)));
	});
});

describe("end to end, on the saved answers", () => {
	// Cleveland at Philadelphia, inside its window at 03:32, 114-106 at every seat in the saved answers.
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
	const run = (game: typeof g, derive: Derive, now = LATE) => {
		const t = saved(derive, LATE);
		const o = scoreGameSync(game, KEYS, PAYOUT, now, t.send);
		expect(t.misses).toEqual([]);
		return { got: [o.decision.action, o.decision.why, o.report?.kind ?? null], report: o.report };
	};

	test("a feed off by a point posts the record at once; the game scores the moment the counting seats agree", () => {
		// Seats 1 and 2 differ, seats 3 and 4 still catching up: the record is posted now.
		const first = run(g, both(seat2Off, behind));
		expect(first.got).toEqual(["dispute", "two finals differ", 4]);
		const disputed = { ...g, status: "disputed" as const, dispute: { at: LATE, records: [first.report!.readings] } };
		// The next run, nothing moved: nothing is written.
		expect(run(disputed, both(seat2Off, behind)).got).toEqual(["wait", "disputed: no seat's final has appeared or changed since the record", null]);
		// Seats 3 and 4 catch up, seat 2 still off: their finals appear, and an update is posted.
		const update = run(disputed, seat2Off);
		expect(update.got).toEqual(["dispute", "an update: a final the record doesn't hold, at seat 3 and 4", 4]);
		// Seat 2 corrects: every counting seat has the same final, and the game scores, inside n.
		const updated = { ...disputed, dispute: { at: LATE, records: [first.report!.readings, update.report!.readings] } };
		expect(run(updated, (_s, _p, b) => b).got).toEqual(["score", "after the dispute record, inside n: every counting seat, the same final", 2]);
	});

	test("the day-7 clock runs from the first record, and an update never moves it", () => {
		const firstAt = LATE;
		const later = LATE + 3600;
		const off = { ...g, status: "disputed" as const };
		const records = [
			SEATS4.map((s) => (s === 2 ? { seat: 2, kind: 2 as const, homeScore: 115, awayScore: 106 } : { seat: s, kind: 2 as const, homeScore: 114, awayScore: 106 })),
			SEATS4.map((s) => ({ seat: s, kind: 2 as const, homeScore: s === 2 ? 115 : 114, awayScore: 106 })),
		];
		// Two records, the first at 03:32, the update an hour later. Seat 2 still off: no score.
		const game = { ...off, dispute: { at: firstAt, records } };
		const deadline = firstAt + g.day7;
		expect(later + g.day7).toBeGreaterThan(deadline);
		// A second before the first record's day 7: nothing moved, nothing written.
		expect(run(game, seat2Off, deadline - 1).got[0]).toBe("wait");
		// At it: day 7's rule. Every seat answers, three agree: it settles, without waiting for the update's day 7.
		expect(run(game, seat2Off, deadline).got).toEqual(["score", "day 7: three sources or more, the same final", 2]);
	});
});
