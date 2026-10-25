// The dispute record (rule.ts): a record, not a lock, and every seat's vote.
//
//   The first record   Any two finals that differ, from any seat, post it at once, inside n or after
//                      (decide). From start + n, finals beside answers without one post it too.
//   Votes              A seat's vote is its most recent answer while it is open (the program still
//                      asks it), and its last answer once it is closed. Silence leaves a vote where it was; an answer
//                      without a final after a final is a vote of no final (votesOf, lastRecorded).
//   After it           The game scores the moment the votes agree, by the same rule a game without a
//                      record scores by, with three or more of them that final. Until then a run posts
//                      an update whenever a seat's vote changes, and writes nothing otherwise
//                      (decideDisputed). Day 7, counted from the first record, is the deadline.
//
// Counted by hand, each over the 256 ways the four seats can read (silent, answered without a final,
// or one of two different finals) and, after a record, each of the 256 ways the record can hold
// their votes.
//
//   First record: two finals differ in 256 - 81 - 81 + 16 = 110 ways (every way, less those with no
//   A, less those with no B, plus those with neither). All 110 post the record, inside n and after,
//   for each counting set.
//
//   After a record, per seat, 16 (fresh, recorded) pairs. Its vote is the fresh answer when there is
//   one, else the recorded vote: A, B and no final are each the vote in 5 pairs (fresh, or fresh
//   silent beside it on record), silent in 1. Its vote changes when it answers and the record holds
//   something else: 3 of 4 pairs for each fresh answer, 9 in all, 7 unchanged (2 for each answer, 1
//   silent beside silent). A score is decide's on the votes, with three or more votes its final; a run
//   with no score posts an update when any seat's vote changes (16^4 - 7^4 = 63,135 runs have a
//   change) and waits otherwise. Of the 7 unchanged pairs, A, B and no final are each the vote in 2.
//     inside n   scores: the three counting votes one final, the fourth silent, no final or the same
//                final: (125 + 625 + 625) x 2 = 2,750, of which (8 + 16 + 16) x 2 = 80 change nothing.
//                updates 63,135 - (2,750 - 80) = 60,465; waits 2,401 - 80 = 2,321
//     after n    scores: the three counting votes one final (125 ways), the fourth silent, no final or
//                the same (1 + 5 + 5); or two counting votes one final and the third silent (3 x 25 =
//                75 ways), the fourth the same final (5), the third vote that makes three:
//                (125 x 11 + 75 x 5) x 2 = 3,500, of which (8 x 5 + 12 x 2) x 2 = 128 change nothing.
//                Two counting votes and the rest silent or not final are fewer than three agreeing
//                recorded sources, and wait.
//                updates 63,135 - (3,500 - 128) = 59,763; waits 2,401 - 128 = 2,273
//
// The breaks that turn this red (rule.ts):
//   decide, the record at once inside n:  return { action: "dispute", readings, why: "two finals differ" };
//                                     ->  return { action: inside ? "wait" : "dispute", readings, why: "two finals differ" };
//   decideDisputed, the score:            if (agreed.action === "score" && votesFor(
//                                     ->  if (false && votesFor(
//   decideDisputed, three agreeing:       votesFor(votes, agreed.home, agreed.away) >= AGREE.day7Agree) {
//                                     ->  votesFor(votes, agreed.home, agreed.away) >= AGREE.afterN) {
//   decideDisputed, never per tick:       if (changed.length > 0) {   ->   if (true) {
//   votesOf, the vote on record:          if (then !== undefined && then.kind !== READING_KIND.silent) return fromReportReading(
//                                     ->  if (false) return fromReportReading(
//   voteChanges, a take-back:             return then.kind === READING_KIND.final;   ->   return false;

import { describe, expect, test } from "bun:test";
import { READING_KIND, type ReportReading } from "../src/chain";
import { scoreGameSync } from "../src/program";
import { answers, decide, decideDay7, decideDisputed, lastRecorded, votesOf } from "../src/rule";
import type { Reading, Seat } from "../src/types";
import { LATE } from "./cases";
import { KEY, copy, saved, type Derive } from "./fixtures";
import { PAYOUT, SEATS4, W, chainOf, everyFour, reading, reportReading, type State } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const SETS: readonly (readonly Seat[])[] = [
	[1, 2, 3],
	[1, 2, 4],
];
const readings = (states: readonly State[]) => SEATS4.map((s, i) => reading(s, states[i]));
const record = (states: readonly State[]): ReportReading[] => SEATS4.map((s, i) => reportReading(s, states[i]));

/** A seat's vote, as the rule states it and built apart from rule.ts: its answer now, else what the record holds. */
const voteOf = (fresh: State, recorded: State): State => (fresh !== "silent" ? fresh : recorded);
/** Whether a seat's vote changes, as the rule states it: it answers, and the record holds something else. */
const changes = (fresh: State, recorded: State): boolean => fresh !== "silent" && fresh !== recorded;

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

describe("after the record: a score the moment the votes agree, an update when a vote changes, and nothing else", () => {
	test("every fresh reading beside every record, before day 7, decided as counted by hand", () => {
		const count: Record<string, number> = {};
		const wrong: unknown[] = [];
		for (const counting of SETS) {
			for (const inside of [true, false]) {
				for (const f of everyFour()) {
					const fresh = readings(f);
					for (const r of everyFour()) {
						const d = decideDisputed(fresh, record(r), counting, inside, false, SEATS4, null, W);
						const key = `${counting.join("")} ${inside ? "inside" : "after"} ${d.action}`;
						count[key] = (count[key] ?? 0) + 1;
						// A score exactly when decide scores on every seat's vote, on the same points, and three or
						// more of the votes are that final.
						const votes = SEATS4.map((_, i) => voteOf(f[i], r[i]));
						const plain = decide(readings(votes), counting, inside);
						const scored = plain.action === "score" && votes.filter((v) => v === (plain.home === 27 ? "A" : "B")).length >= 3;
						if (scored !== (d.action === "score")) wrong.push({ counting, inside, f, r, d: d.action, plain: plain.action });
						if (scored && d.action === "score" && (d.home !== plain.home || d.away !== plain.away)) wrong.push({ f, r, points: true });
						// Otherwise an update exactly when a seat's vote changes.
						const moves = f.some((s, i) => changes(s, r[i]));
						if (!scored && moves !== (d.action === "dispute")) wrong.push({ counting, inside, f, r, d: d.action, moves });
						// Never a void before day 7. An update carries every seat's answer this run; a score, the votes.
						if (d.action === "void") wrong.push({ counting, inside, f, r, void: true });
						if (d.action === "dispute" && d.readings.map((x) => x.kind).join() !== fresh.map((x) => x.kind).join()) wrong.push({ f, r, readings: true });
						if (d.action === "score" && d.readings.map((x) => x.kind).join() !== SEATS4.map((_, i) => reading(SEATS4[i], voteOf(f[i], r[i])).kind).join()) wrong.push({ f, r, votes: true });
					}
				}
			}
		}
		expect(wrong).toEqual([]);
		expect(count).toEqual({
			"123 inside score": 2_750,
			"123 inside dispute": 60_465,
			"123 inside wait": 2_321,
			"123 after score": 3_500,
			"123 after dispute": 59_763,
			"123 after wait": 2_273,
			"124 inside score": 2_750,
			"124 inside dispute": 60_465,
			"124 inside wait": 2_321,
			"124 after score": 3_500,
			"124 after dispute": 59_763,
			"124 after wait": 2_273,
		});
	});

	test("from the day-7 clock: a score when the votes agree with three or more that final, and otherwise day 7's own rule, on the same votes", () => {
		const wrong: unknown[] = [];
		for (const counting of SETS) {
			for (const f of everyFour()) {
				const fresh = readings(f);
				for (const r of everyFour()) {
					const d = decideDisputed(fresh, record(r), counting, false, true, SEATS4, null, W);
					const votes = readings(SEATS4.map((_, i) => voteOf(f[i], r[i])));
					const plain = decide(votes, counting, false);
					const three = plain.action === "score" && votes.filter((v) => v.kind === "final" && v.home === plain.home && v.away === plain.away).length >= 3;
					const want = three ? plain : decideDay7(votes, SEATS4, null);
					if (d.action !== want.action || (d.action === "score" && want.action === "score" && (d.home !== want.home || d.away !== want.away))) {
						wrong.push({ counting, f, r, got: d.action, want: want.action });
					}
				}
			}
		}
		expect(wrong).toEqual([]);
	});

	test("the cases the second and third looks raised, by name", () => {
		const after = (counting: readonly Seat[], inside: boolean, f: State[], records: State[][], day7 = false) => {
			const d = decideDisputed(readings(f), lastRecorded(records.map(record), SEATS4), counting, inside, day7, SEATS4, null, W);
			return d.action === "score" ? `score ${d.home}-${d.away}` : d.action;
		};
		const C = [1, 2, 3] as const;
		// A dissent seen once is a vote, and silence never takes it back: the spare's B inside n beside
		// seat 3 not final posts the record; the next run, the spare silent and seat 3 final A, is no
		// score while the spare's vote is B. Seat 3's vote changed, so it is an update.
		expect(decide(readings(["A", "A", "none", "B"]), C, true).action).toBe("dispute");
		expect(after(C, true, ["A", "A", "A", "silent"], [["A", "A", "none", "B"]])).toBe("dispute");
		expect(after(C, true, ["A", "A", "A", "silent"], [["A", "A", "none", "B"], ["A", "A", "A", "silent"]])).toBe("wait");
		// The spare still answering B: the votes don't agree, and nothing new, so nothing is written.
		expect(after(C, true, ["A", "A", "A", "B"], [["A", "A", "A", "B"]])).toBe("wait");
		// One against three, then the three correct. The record holds A, B, B, B; the correction is an
		// update; then every counting seat's vote is A, and the game scores.
		expect(after(C, true, ["A", "B", "A", "A"], [["A", "B", "B", "B"]])).toBe("dispute");
		expect(after(C, true, ["A", "A", "A", "A"], [["A", "B", "B", "B"], ["A", "B", "A", "A"]])).toBe("score 27-20");
		// If seat 2 never corrects, day 7 reads every vote on record: the corrected ones, A three times. It
		// settles on A, never on the retracted B.
		expect(after(C, false, ["silent", "silent", "silent", "silent"], [["A", "B", "B", "B"], ["A", "B", "A", "A"]], true)).toBe("score 27-20");
		// Seat 3's final is a vote though it later falls silent: seats 1 and 2 differ, seat 3 A, the spare
		// not final. After n, seat 2 corrected and seat 3 silent: every vote agrees, and the game scores.
		expect(after(C, false, ["A", "A", "silent", "A"], [["A", "B", "A", "none"]])).toBe("score 27-20");
		// Posted at start + n with seat 3 not final and the spare silent; a minute later all four agree.
		expect(decide(readings(["A", "A", "none", "silent"]), C, false).action).toBe("dispute");
		expect(after(C, false, ["A", "A", "A", "A"], [["A", "A", "none", "silent"]])).toBe("score 27-20");
		// A 2-2 on the record stays a 2-2 while the seats that hold B are silent: never a score on two.
		expect(after(C, false, ["A", "A", "silent", "silent"], [["A", "A", "B", "B"]])).toBe("wait");
		expect(after(C, false, ["A", "A", "silent", "silent"], [["A", "A", "B", "B"]], true)).toBe("void");
		// With the spare standing in: seat 3 silent for the game, the spare's B on record holds the score.
		const s = decideDisputed(readings(["A", "A", "silent", "silent"]), record(["A", "A", "silent", "B"]), [1, 2, 4], false, false, SEATS4, 3, W);
		expect(s.action).toBe("wait");
	});

	test("never per tick: an update only when a seat's vote changes, however many change on one run", () => {
		const rec = [["A", "B", "none", "none"]] as State[][];
		const why = (f: State[], records = rec) => {
			const d = decideDisputed(readings(f), lastRecorded(records.map(record), SEATS4), [1, 2, 3], true, false, SEATS4, null, W);
			return `${d.action}: ${d.why}`;
		};
		const NOTHING = "wait: disputed: no seat's vote has changed since the record";
		expect(why(["A", "B", "none", "none"])).toBe(NOTHING); // the same readings again
		expect(why(["A", "B", "silent", "silent"])).toBe(NOTHING); // seats falling silent change no vote
		expect(why(["silent", "silent", "none", "none"])).toBe(NOTHING);
		expect(why(["A", "B", "A", "none"])).toBe("dispute: an update: a vote changed, at seat 3"); // a final appears
		expect(why(["A", "A", "none", "B"])).toBe("dispute: an update: a vote changed, at seat 2 and 4"); // one changes, one appears: one report
		// A final taken back, the game shown without a final: a vote of no final, one update.
		expect(why(["none", "B", "none", "none"])).toBe("dispute: an update: a vote changed, at seat 1");
		// Measured against each seat's last answer on record, across every update.
		expect(why(["A", "A", "none", "none"], [["A", "B", "none", "none"], ["A", "A", "none", "none"]])).toBe(NOTHING);
		expect(why(["none", "B", "none", "none"], [["A", "B", "none", "none"], ["none", "B", "none", "none"]])).toBe(NOTHING);
		// One team's points alone moving is a change: seat 2 on record at 27-20, now 27-21 or 28-20.
		const recorded = lastRecorded([record(["A", "A", "none", "none"])], SEATS4);
		const seat = (n: Seat, r: Reading) => {
			const fresh = SEATS4.map((s) => (s === n ? r : reading(s, s <= 2 ? "A" : "none")));
			const d = decideDisputed(fresh, recorded, [1, 2, 3], true, false, SEATS4, null, W);
			return `${d.action}: ${d.why}`;
		};
		expect(seat(2, { ...reading(2, "A"), home: 27, away: 21 })).toBe("dispute: an update: a vote changed, at seat 2");
		expect(seat(2, { ...reading(2, "A"), home: 28, away: 20 })).toBe("dispute: an update: a vote changed, at seat 2");
		expect(seat(2, reading(2, "A"))).toBe(NOTHING);
		// A game still on moves its points every run: an answer without a final beside a vote of no final changes nothing.
		expect(seat(3, { ...reading(3, "none"), home: 31, away: 28 })).toBe(NOTHING);
	});

	test("silence is not an answer: a seat that doesn't give the game this run leaves its vote where it was", () => {
		// Seat 1's vote is A. On this run its feed lists no record of the game ("absent"), or one outside
		// the window, or is silent: none of them is an answer about the game.
		const w = { from: 1_000, to: 2_000 };
		const absent: Reading = { seat: 1, kind: "no_final", home: null, away: null, recorded: null, detail: "absent", record: null };
		const outside: Reading = { seat: 1, kind: "no_final", home: null, away: null, recorded: null, detail: "outside window", record: { id: "x", time: 2_000 } };
		const shown: Reading = { seat: 1, kind: "no_final", home: 3, away: 1, recorded: null, detail: "in progress", record: { id: "x", time: 1_999 } };
		expect([absent, outside, reading(1, "silent"), shown, reading(1, "A")].map((r) => answers(r, w))).toEqual([false, false, false, true, true]);
		const rec = record(["A", "B", "A", "A"]);
		for (const r of [absent, outside, reading(1, "silent")]) {
			const fresh = [r, reading(2, "B"), reading(3, "A"), reading(4, "A")];
			const votes = votesOf(fresh, rec, SEATS4, null, w);
			expect({ detail: r.detail, vote: [votes[0].kind, votes[0].home, votes[0].away] }).toEqual({ detail: r.detail, vote: ["final", 27, 20] });
			const d = decideDisputed(fresh, rec, [1, 2, 3], false, false, SEATS4, null, w);
			expect({ detail: r.detail, got: d.action }).toEqual({ detail: r.detail, got: "wait" });
		}
		// The control: the game's own record shown without a final is a vote of no final, and an update.
		const d = decideDisputed([shown, reading(2, "B"), reading(3, "A"), reading(4, "A")], rec, [1, 2, 3], false, false, SEATS4, null, w);
		expect([d.action, d.why, d.readings[0].kind]).toEqual(["dispute", "an update: a vote changed, at seat 1", "no_final"]);
		// An update writes a seat that gave no answer as silent, so its vote on record stays as it was:
		// here seat 3's vote changes, and seat 1's absent answer and seat 2's silence ride as silent.
		const u = decideDisputed([absent, reading(2, "silent"), reading(3, "B"), reading(4, "A")], rec, [1, 2, 3], false, false, SEATS4, null, w);
		expect([u.action, u.why, u.readings.map((r) => r.kind)]).toEqual(["dispute", "an update: a vote changed, at seat 3", ["silent", "silent", "final", "final"]]);
		expect(lastRecorded([rec, u.readings.map((r) => reportReading(r.seat, r.kind === "silent" ? "silent" : r.home === 27 ? "A" : "B"))], SEATS4).map((r) => r.kind)).toEqual([2, 2, 2, 2]);
	});

	test("the seat silent for the game has no vote: a final on record for it neither holds a score nor makes an update", () => {
		// Seat 3 silent for the game, so the spare counts. The record carries a B for seat 3 from somewhere
		// other than this program, which never asks that seat.
		const held = decideDisputed(readings(["A", "A", "silent", "A"]), record(["A", "A", "B", "A"]), [1, 2, 4], false, false, SEATS4, 3, W);
		expect([held.action, held.readings[2].detail]).toEqual(["score", "silent for the game"]);
		// An answer at that seat, which this program never builds, changes no vote either.
		const moved = decideDisputed(readings(["A", "B", "A", "silent"]), record(["A", "B", "silent", "silent"]), [1, 2, 4], false, false, SEATS4, 3, W);
		expect([moved.action, moved.why]).toEqual(["wait", "disputed: no seat's vote has changed since the record"]);
	});

	test("what the record holds for each seat: its last answer on record, a take-back included, else silent", () => {
		const r = (seat: number, kind: 0 | 1 | 2, h = 0, a = 0): ReportReading => ({ seat, kind, homeScore: h, awayScore: a });
		const first = [r(1, 2, 27, 20), r(2, 2, 20, 27), r(3, 1, 3, 1), r(4, 0)];
		const update = [r(1, 1, 27, 20), r(2, 2, 27, 20), r(3, 0), r(4, 0)];
		expect(lastRecorded([first, update], SEATS4)).toEqual([
			r(1, 1, 27, 20), // the final taken back: its vote is no final
			r(2, 2, 27, 20), // the later final stands
			r(3, 1, 3, 1), // silent on the update: its vote stays
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
		return { got: [o.decision.action, o.decision.why, o.report?.kind ?? null], report: o.report, asked: t.asked.length };
	};

	test("a feed off by a point posts the record at once; the game scores the moment the votes agree", () => {
		// Seats 1 and 2 differ, seats 3 and 4 still catching up: the record is posted now.
		const first = run(g, both(seat2Off, behind));
		expect(first.got).toEqual(["dispute", "two finals differ", 4]);
		const disputed = { ...g, status: "disputed" as const, dispute: { at: LATE, records: [first.report!.readings] } };
		// The next run, nothing moved: nothing is written.
		expect(run(disputed, both(seat2Off, behind)).got).toEqual(["wait", "disputed: no seat's vote has changed since the record", null]);
		// Seats 3 and 4 catch up, seat 2 still off: their votes change, and an update is posted.
		const update = run(disputed, seat2Off);
		expect(update.got).toEqual(["dispute", "an update: a vote changed, at seat 3 and 4", 4]);
		// Seat 2 corrects: every seat's vote is the same final, and the game scores, inside n.
		const updated = { ...disputed, dispute: { at: LATE, records: [first.report!.readings, update.report!.readings] } };
		const scored = run(updated, (_s, _p, b) => b);
		expect(scored.got).toEqual(["score", "after the dispute record, every seat's vote: inside n: every counting seat, the same final", 2]);
		// The score carries the votes it rests on, every one of them the final.
		expect(scored.report!.readings.map((r) => [r.seat, r.kind, r.homeScore, r.awayScore])).toEqual(SEATS4.map((s) => [s, 2, 114, 106]));
	});

	test("a disputed game never asks the seat silent for the game, inside that seat's own window too", () => {
		// Cleveland at Philadelphia with the start report showing seat 3 silent for the game, disputed at
		// 03:32 on seat 2's 115, read again the same night: seat 3's window is open, and it is still not asked.
		const down = { ...g, startReadings: g.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: 0 as const } : r)) };
		const record = SEATS4.map((s) => (s === 3 ? { seat: 3, kind: 0 as const, homeScore: 0, awayScore: 0 } : { seat: s, kind: 2 as const, homeScore: s === 2 ? 115 : 114, awayScore: 106 }));
		const disputed = { ...down, status: "disputed" as const, dispute: { at: LATE - 60, records: [record] } };
		const t = saved(seat2Off, LATE);
		const o = scoreGameSync(disputed, KEYS, PAYOUT, LATE, t.send);
		expect(t.misses).toEqual([]);
		expect(t.asked.filter((q) => q.url.includes("/results/"))).toEqual([]);
		expect([o.decision.action, o.decision.readings[2].detail]).toEqual(["wait", "silent for the game"]);
	});

	test("a seat that doesn't list the game is silent on the first record; the next run scores on the three finals beside it, the spare's the third", () => {
		// After n, seat 2's answer lists every NBA game of the night but this one: it answered, without a
		// final, so beside two finals the run disputes. On the record, a seat that gave no answer about the
		// game is silent, so it has no vote, and the next run reads two counting finals, the third silent,
		// and the spare's final the same: three agreeing recorded sources.
		const unlisted: Derive = (s, p, b) => {
			if (s !== 2 || !p.startsWith("/games?league=NBA")) return b;
			const c = copy(b) as { results: Record<string, any>[] };
			return { ...c, results: c.results.filter((x) => x.gameId !== 340484) };
		};
		const after = g.start! + g.n + 60;
		const first = run(g, unlisted, after);
		expect(first.got).toEqual(["dispute", "after n: finals beside answers without a final", 4]);
		expect(first.report!.readings.map((r) => [r.seat, r.kind])).toEqual([[1, 2], [2, 0], [3, 2], [4, 2]]);
		const disputed = { ...g, status: "disputed" as const, dispute: { at: after, records: [first.report!.readings] } };
		const scored = run(disputed, unlisted, after + 60);
		expect(scored.got).toEqual(["score", "after the dispute record, every seat's vote: after n: two counting seats or more, the same final, the rest silent", 2]);
		expect(scored.report!.readings.map((r) => [r.seat, r.kind])).toEqual([[1, 2], [2, 0], [3, 2], [4, 2]]);
		// The control: the spare still shows the game without a final. Two counting finals beside a silent
		// vote are fewer than three agreeing recorded sources, so nothing is written, and day 7, asking no
		// seat, voids on the silent vote.
		const spareOn: Derive = (s, p, b) => {
			if (s === 4 && p.includes("basketball_nba")) return (copy(b) as Record<string, any>[]).map((x) => (x.id === "110e33c79c5ec8c0377702aff685f83b" ? { ...x, completed: false } : x));
			return unlisted(s, p, b);
		};
		const firstOn = run(g, spareOn, after);
		expect(firstOn.got).toEqual(["dispute", "after n: finals beside answers without a final", 4]);
		expect(firstOn.report!.readings.map((r) => [r.seat, r.kind])).toEqual([[1, 2], [2, 0], [3, 2], [4, 1]]);
		const disputedOn = { ...g, status: "disputed" as const, dispute: { at: after, records: [firstOn.report!.readings] } };
		expect(run(disputedOn, spareOn, after + 60).got).toEqual(["wait", "disputed: no seat's vote has changed since the record", null]);
		const day7 = run(disputedOn, spareOn, after + g.day7);
		expect([...day7.got, day7.asked]).toEqual(["void", "day 7: a source is silent", 3, 0]);
	});

	test("the day-7 clock runs from the first record, an update never moves it, and the day-7 run asks no seat", () => {
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
		// A second before the first record's day 7: nothing changed, nothing written; seats 1 and 2 are still open.
		const early = run(game, seat2Off, deadline - 1);
		expect([early.got[0], early.asked > 0]).toEqual(["wait", true]);
		// At it: day 7's rule, on every vote on record, without asking any seat. Three agree: it settles,
		// without waiting for the update's day 7.
		const onTime = run(game, seat2Off, deadline);
		expect([...onTime.got, onTime.asked]).toEqual(["score", "day 7: three sources or more, the same final", 2, 0]);
	});
});
