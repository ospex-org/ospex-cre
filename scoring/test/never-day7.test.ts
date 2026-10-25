// Never: "A disputed game settles on fewer than three agreeing recorded sources."
//
// A disputed game is decided on every seat's vote: its most recent answer while it is open (the
// program still asks it), its last answer once it is closed (rule.ts). Day 7 is the deadline; by then
// every seat is closed, so day 7 reads the votes on record. It settles only when all four sources have a vote,
// none silent, and at least three give the same final. Anything else is a void: 2-2, a silent
// fourth, or a league with fewer than four feeds. Before day 7, and on day 7 alike, a 2-2 on the
// record stays a 2-2 until a seat changes its vote: it never scores on two.
//
// The sweep gives every seat every fresh state and every recorded state: 16 per seat, 65,536 in
// all. Counted by hand: a seat's vote is its fresh answer when it gives one (12 of its 16 pairs),
// otherwise its vote on record (4), so each of the three answering states is the vote in 5 pairs and
// silent in 1. A settle needs four votes from {A, B, answered without a final} with at least three of
// one final: four of it (1 way) or three of it and one other (4 seats x 2 = 8), so 9 per final and 18
// in all, each reached by 5^4 = 625 pairs: 11,250 settles.
//
// The break that turns this red (rule.ts, decideDay7):
//   if (best !== null && best.count >= AGREE.day7Agree) {
//   ->  if (best !== null && best.count >= AGREE.afterN) {

import { describe, expect, test } from "bun:test";
import type { ChainGame, ReportReading } from "../src/chain";
import { scoreGameSync } from "../src/program";
import { decideDay7, decideDisputed, lastRecorded, votesOf } from "../src/rule";
import type { Reading, Seat } from "../src/types";
import { KEY, at, copy, locate, saved, type Derive } from "./fixtures";
import { PAYOUT, SEATS4, STATES, W, chainOf, reading, reportReading, type State } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

/** Day 7 on the votes a seat holds: its fresh answer, else its vote on record. */
const day7Of = (fresh: readonly Reading[], recorded: readonly ReportReading[], seats: readonly Seat[] = SEATS4, down: Seat | null = null) =>
	decideDay7(votesOf(fresh, recorded, seats, down, W), seats, down);

describe("never: a disputed game settles on fewer than three agreeing recorded sources", () => {
	test("every settle in the sweep rests on four votes, none silent, three or more with the same final, each the seat's latest answer", () => {
		let settles = 0;
		let total = 0;
		const wrong: unknown[] = [];
		const pairs: [State, State][] = [];
		for (const f of STATES) for (const r of STATES) pairs.push([f, r]);
		for (const p1 of pairs) for (const p2 of pairs) for (const p3 of pairs) for (const p4 of pairs) {
			const ps = [p1, p2, p3, p4];
			const fresh = SEATS4.map((s, i) => reading(s, ps[i][0]));
			const recorded = SEATS4.map((s, i) => reportReading(s, ps[i][1]));
			const d = day7Of(fresh, recorded);
			total++;
			// Every source is the seat's vote: its answer when it gave one, else what the record holds.
			const sources = d.readings.map((got) => (got.kind === "silent" ? "silent" : got.kind === "no_final" ? "none" : got.home === 27 && got.away === 20 ? "A" : "B"));
			const latest = ps.map(([f, r]) => (f !== "silent" ? f : r));
			if (sources.join() !== latest.join()) wrong.push({ ps, sources, latest });
			// Day 7 ends the game: a score or a void, never a wait or another dispute record.
			if (d.action !== "score" && d.action !== "void") wrong.push({ ps, action: d.action });
			if (d.action !== "score") continue;
			settles++;
			const silent = d.readings.filter((r) => r.kind === "silent").length;
			const agree = d.readings.filter((r) => r.kind === "final" && r.home === d.home && r.away === d.away).length;
			if (silent !== 0 || agree < 3) wrong.push({ ps, silent, agree });
		}
		expect(wrong).toEqual([]);
		expect({ total, settles }).toEqual({ total: 65_536, settles: 11_250 });
	});

	test("the edges, by name", () => {
		const day7 = (fresh: State[], recorded: State[], seats: readonly Seat[] = SEATS4) => {
			const d = day7Of(
				seats.map((s, i) => reading(s, fresh[i])),
				seats.map((s, i) => reportReading(s, recorded[i])),
				seats,
			);
			return d.action === "score" ? `score ${d.home}-${d.away}` : `${d.action}: ${d.why}`;
		};
		const S = "silent" as const;
		expect(day7(["A", "A", "A", "B"], [S, S, S, S])).toBe("score 27-20"); // three and one dissenting
		expect(day7(["A", "A", "A", "none"], [S, S, S, S])).toBe("score 27-20"); // answered without a final dissents; it is not silent
		expect(day7(["A", "A", "A", S], [S, S, S, S])).toBe("void: day 7: a source is silent"); // a silent fourth
		expect(day7(["A", "A", "B", "B"], [S, S, S, S])).toBe("void: day 7: no three sources agree"); // 2-2
		expect(day7(["A", "A", S, S], [S, S, "A", S])).toBe("void: day 7: a source is silent");
		// The spare keeps three days: its vote on record counts.
		expect(day7(["A", "A", "A", S], [S, S, S, "A"])).toBe("score 27-20");
		// An answer replaces the vote on record: a vendor correction counts.
		expect(day7(["A", "A", "A", "A"], ["B", "B", "B", "B"])).toBe("score 27-20");
		expect(day7(["B", "B", "A", "A"], ["A", "A", "A", "A"])).toBe("void: day 7: no three sources agree");
		// A final taken back is a vote of no final: B three times on record, then three take-backs.
		expect(day7(["none", "none", "none", S], ["B", "B", "B", "A"])).toBe("void: day 7: no three sources agree");
		// A league with three feeds voids, even three to nothing.
		expect(day7(["A", "A", "A"], [S, S, S], [1, 2, 3])).toBe("void: day 7: fewer than four feeds");
	});

	// The three cases the reviews named, on the rule alone: each settles on the votes or voids, and
	// never on fewer than three agreeing votes.
	const C = [1, 2, 3] as const;
	const run = (fresh: State[], records: State[][], day7: boolean, inside = false) => {
		const d = decideDisputed(
			SEATS4.map((s, i) => reading(s, fresh[i])),
			lastRecorded(records.map((r) => SEATS4.map((s, i) => reportReading(s, r[i]))), SEATS4),
			C,
			inside,
			day7,
			SEATS4,
			null,
			W,
		);
		return { action: d.action, why: d.why, readings: d.readings.map((r) => (r.kind === "silent" ? "silent" : r.kind === "no_final" ? "none" : r.home === 27 ? "A" : "B")) };
	};
	const S = "silent" as const;

	test("a 2-2 on the record never scores on two: the seats that hold B fall silent, and day 6 waits; day 7 voids", () => {
		// The record holds A at seats 1 and 2, B at seats 3 and 4. By day 6 seats 3 and 4 are past their
		// windows and read silent; seats 1 and 2 still answer A. The votes are A, A, B, B.
		const record = [["A", "A", "B", "B"]] as State[][];
		const day6 = run(["A", "A", S, S], record, false);
		expect([day6.action, day6.why, day6.readings]).toEqual(["wait", "disputed: no seat's vote has changed since the record", ["A", "A", "B", "B"]]);
		const day7 = run([S, S, S, S], record, true);
		expect([day7.action, day7.why]).toEqual(["void", "day 7: no three sources agree"]);
		// The control: one of the B seats corrects to A before its window closes, and the votes are three to one.
		const corrected = run(["A", "A", "A", S], record, false);
		expect(corrected.action).toBe("dispute");
		expect(run([S, S, S, S], [...record, ["A", "A", "A", S]], true).action).toBe("score");
	});

	test("B, B, B, A on the record, then three take-backs: one update, never a score on the taken-back B", () => {
		// Seats 1 to 3 then show the game without a final; the spare still shows A.
		const record = [["B", "B", "B", "A"]] as State[][];
		const update = run(["none", "none", "none", "A"], record, false);
		expect([update.action, update.why, update.readings]).toEqual(["dispute", "an update: a vote changed, at seat 1 and 2 and 3", ["none", "none", "none", "A"]]);
		// The same answers again: nothing changed, nothing written.
		const updated = [...record, update.readings as State[]];
		expect(run(["none", "none", "none", "A"], updated, false).action).toBe("wait");
		// Day 7 reads the votes: three of no final and the spare's A. One feed alone doesn't score a game.
		const day7 = run([S, S, S, S], updated, true);
		expect([day7.action, day7.why, day7.readings]).toEqual(["void", "day 7: no three sources agree", ["none", "none", "none", "A"]]);
		// The control: without the take-backs on record, day 7 settles on the three B's.
		expect(run([S, S, S, S], record, true)).toMatchObject({ action: "score" });
	});

	test("A, A, B, A on the record, then seat 1 takes its final back and goes quiet: its vote stays no final, and day 7 voids", () => {
		const record = [["A", "A", "B", "A"]] as State[][];
		const retraction = run(["none", "A", "B", "A"], record, false);
		expect([retraction.action, retraction.why]).toEqual(["dispute", "an update: a vote changed, at seat 1"]);
		const updated = [...record, retraction.readings as State[]];
		// Seat 1 unavailable for a while: silence leaves its vote of no final where it was.
		expect(run([S, "A", S, S], updated, false).action).toBe("wait");
		// Day 7, seats 3 and 4 long past their windows: the votes are no final, A, B, A. Two A's are not three.
		const day7 = run([S, S, S, S], updated, true);
		expect([day7.action, day7.why, day7.readings]).toEqual(["void", "day 7: no three sources agree", ["none", "A", "B", "A"]]);
		// The control: had seat 1 not taken its final back, its A would be the third.
		expect(run([S, S, S, S], record, true)).toMatchObject({ action: "score" });
	});

	// The artifact: a real game, disputed, read on the saved answers. Washington at San Francisco,
	// 20 Oct 00:15 UTC, 23-17. The dispute record lands at 06:00 that morning, so day 7 opens at 06:00
	// on 27 Oct, when seats 3 and 4 are long past their windows (five days and 66 hours).
	const DISPUTED_AT = at("2026-10-20T06:00:00Z");
	const DEADLINE = DISPUTED_AT + 7 * 86_400;
	const DAY7_RUN = at("2026-10-27T07:00:00Z");
	const WSF: ReportReading = { seat: 0, kind: 2, homeScore: 23, awayScore: 17 };
	const final = (seat: number): ReportReading => ({ ...WSF, seat });
	const flipped = (seat: number): ReportReading => ({ seat, kind: 2, homeScore: 17, awayScore: 23 });
	// Seat 2 dissents fresh, at 17-23, so the votes don't agree and day 7's own rule decides.
	const seat2Off: Derive = (s, p, b) => {
		if (s !== 2 || !p.startsWith("/games?league=NFL")) return b;
		const c = copy(b) as { results: Record<string, any>[] };
		for (const g of c.results) if (g.teams?.home?.team === "San Francisco 49ers" && g.status === "final") g.scoreboard.score = { home: 17, away: 23 };
		return c;
	};
	const ID = "00000000-0000-4000-8000-000000000000";
	const disputed = (records: ReportReading[][], seat3: 0 | 1 = 1): ChainGame => {
		const base = chainOf("nfl final");
		return {
			...base,
			hints: [{ seat: 3, id: ID }],
			startReadings: base.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: seat3 } : r)),
			status: "disputed",
			dispute: { at: DISPUTED_AT, records },
		};
	};
	function go(game: ChainGame, now: number, derive: Derive = seat2Off) {
		const t = saved(derive, DAY7_RUN);
		const o = scoreGameSync(game, KEYS, PAYOUT, now, t.send);
		expect(t.misses).toEqual([]);
		return {
			action: o.decision.action,
			why: o.decision.why,
			kind: o.report?.kind ?? null,
			report: o.report,
			votes: o.decision.readings.map((r) => `${r.seat}:${r.kind === "final" ? `${r.home}-${r.away}` : r.detail}`),
			asked: t.asked.map((q) => locate(q)!.seat),
		};
	}

	test("end to end: the 2-2 on a real game waits on day 6, where it once scored on two, and voids on day 7, asking no seat", () => {
		const game = disputed([[final(1), final(2), flipped(3), flipped(4)]]);
		// Day 6: seats 1 and 2 still answer 23-17, as saved; seats 3 and 4 are past their windows and not asked.
		const day6 = go(game, DEADLINE - 86_400, (_s, _p, b) => b);
		expect([day6.action, day6.votes, [...new Set(day6.asked)]]).toEqual(["wait", ["1:23-17", "2:23-17", "3:17-23", "4:17-23"], [1, 2]]);
		const day7 = go(game, DEADLINE, (_s, _p, b) => b);
		expect([day7.action, day7.why, day7.kind, day7.asked]).toEqual(["void", "day 7: no three sources agree", 3, []]);
	});

	test("end to end: day 7 settles on the votes on record; a seat that never answered on record is silent there, whatever it would say", () => {
		// Seat 3's final and the spare's are on the first record; seats 1 and 2 had not answered.
		const game = disputed([[reportReading(1, "silent"), reportReading(2, "silent"), final(3), final(4)]]);
		// At day 7 no seat is asked, and seats 1 and 2 have no vote: a void.
		const bare = go(game, DAY7_RUN);
		expect([bare.action, bare.why, bare.asked, bare.votes]).toEqual(["void", "day 7: a source is silent", [], ["1:closed: day 7", "2:closed: day 7", "3:23-17", "4:23-17"]]);
		// A second before the day-7 clock seats 1 and 2 are asked; their votes change, so an update is posted.
		const early = go(game, DEADLINE - 1);
		expect([early.action, early.why, early.kind, [...new Set(early.asked)]]).toEqual(["dispute", "an update: a vote changed, at seat 1 and 2", 4, [1, 2]]);
		const updated = disputed([...game.dispute!.records, early.report!.readings]);
		expect(go(updated, DEADLINE - 1).action).toBe("wait");
		// At the clock's instant, counted from the first record, day 7 runs on four votes: three agree.
		const onTime = go(updated, DEADLINE);
		expect([onTime.action, onTime.why, onTime.kind, onTime.asked, onTime.report?.homeScore, onTime.report?.awayScore]).toEqual([
			"score",
			"day 7: three sources or more, the same final",
			2,
			[],
			23,
			17,
		]);
		expect(onTime.votes).toEqual(["1:23-17", "2:17-23", "3:23-17", "4:23-17"]);
	});

	test("end to end: a seat silent for the game is never asked, and a final on record for it never counts on day 7", () => {
		// Seat 3's hint failed at verification: the start report recorded it silent. The record carries
		// seats 1, 2 and 4, and a final for seat 3 from somewhere other than this program.
		const record = [final(1), flipped(2), final(3), final(4)];
		const seat3Final: Derive = (s, p, b) =>
			s === 3 && p === `/results/${ID}` ? [{ ID, OddType: "Game", Final: true, FinalType: "Finished", HomeScore: "23", AwayScore: "17" }] : seat2Off(s, p, b);
		const down = disputed([record], 0);
		const early = go(down, DEADLINE - 1, seat3Final);
		expect(early.asked.filter((s) => s === 3)).toEqual([]);
		const d = go(down, DEADLINE, seat3Final);
		expect([d.action, d.why, d.votes]).toEqual(["void", "day 7: a source is silent", ["1:23-17", "2:17-23", "3:silent for the game", "4:23-17"]]);
		// The control: the same record with seat 3 counting settles on its vote.
		const counting = go(disputed([record], 1), DEADLINE, seat3Final);
		expect([counting.action, counting.why, counting.votes]).toEqual(["score", "day 7: three sources or more, the same final", ["1:23-17", "2:17-23", "3:23-17", "4:23-17"]]);
	});

	test("a vote on record without a final keeps its points in day 7's readings, and still dissents", () => {
		const d = day7Of(
			[reading(1, "A"), reading(2, "A"), reading(3, "A"), reading(4, "silent")],
			[reportReading(1, "silent"), reportReading(2, "silent"), reportReading(3, "silent"), { seat: 4, kind: 1, homeScore: 14, awayScore: 10 }],
		);
		expect([d.action, d.readings[3]]).toEqual(["score", { seat: 4, kind: "no_final", home: 14, away: 10, recorded: null, detail: "its vote on record", record: null }]);
	});

	test("end to end: the same game created without a seat 3 hint voids on day 7, as a league with three feeds does", () => {
		const base = chainOf("nfl final");
		const game: ChainGame = { ...base, status: "disputed", dispute: { at: DISPUTED_AT, records: [[final(1), flipped(2), reportReading(3, "silent"), final(4)]] } };
		expect(go(game, DAY7_RUN)).toMatchObject({ action: "void", why: "day 7: a source is silent", kind: 3, asked: [], votes: ["1:23-17", "2:17-23", "3:silent for the game", "4:23-17"] });
	});

	test("a seat with no answer now and none on record is silent for this run's reason; one with a final on record takes the record's", () => {
		const fresh = [reading(1, "A"), reading(2, "A"), { ...reading(3, "silent"), detail: "http 503" }, reading(4, "A")];
		const none = day7Of(fresh, SEATS4.map((s) => reportReading(s, "silent")));
		expect([none.action, none.why, none.readings[2].kind, none.readings[2].detail]).toEqual(["void", "day 7: a source is silent", "silent", "http 503"]);
		const recorded = day7Of(fresh, SEATS4.map((s) => reportReading(s, s === 3 ? "A" : "silent")));
		expect([recorded.action, recorded.readings[2].kind, recorded.readings[2].detail]).toEqual(["score", "final", "its vote on record"]);
	});

	test("the seat silent for the game is silent on day 7, whatever the dispute record carries for it", () => {
		// Built by hand: seats 1, 2 and 4 agree, seat 3's recorded final would make a fourth source.
		const fresh = [reading(1, "A"), reading(2, "B"), reading(3, "silent"), reading(4, "silent")];
		const recorded = [reportReading(1, "silent"), reportReading(2, "silent"), reportReading(3, "A"), reportReading(4, "A")];
		const down = day7Of(fresh, recorded, SEATS4, 3);
		expect([down.action, down.why, down.readings[2].detail]).toEqual(["void", "day 7: a source is silent", "silent for the game"]);
		// The control: the same readings with seat 3 counting settle on three.
		const counting = day7Of(fresh, recorded, SEATS4, null);
		expect(counting.action === "score" ? [counting.home, counting.away] : counting.action).toEqual([27, 20]);
	});

	test("end to end: seat 3 silent for the game, the spare closed: an update before day 7, never a score on the dissent; a void at day 7", () => {
		const base = chainOf("nfl final");
		const game: ChainGame = { ...base, status: "disputed", dispute: { at: DISPUTED_AT, records: [[reportReading(1, "silent"), reportReading(2, "silent"), reportReading(3, "silent"), final(4)]] } };
		// The spare keeps a game 66 hours: by then it is not asked, and its vote on record stands.
		expect(DEADLINE - base.start!).toBeGreaterThan(66 * 3600);
		const early = go(game, DEADLINE - 1);
		expect([early.action, early.why, [...new Set(early.asked)]]).toEqual(["dispute", "an update: a vote changed, at seat 1 and 2", [1, 2]]);
		for (const now of [DEADLINE, DEADLINE + 1]) {
			expect({ now: now - DEADLINE, got: go(game, now) }).toMatchObject({ now: now - DEADLINE, got: { action: "void", why: "day 7: a source is silent", asked: [] } });
		}
	});
});
