// Never: "A disputed game settles on fewer than three agreeing recorded sources."
//
// Day 7 takes each seat's latest reading: fresh if the feed answers now, otherwise the one the
// dispute record carried; a seat with neither is silent. It settles only when all four sources are
// on record, none silent, and at least three give the same final. Anything else is a void: 2-2, a
// silent fourth, or a league with fewer than four feeds.
//
// The sweep gives every seat every fresh state and every recorded state: 16 per seat, 65,536 in
// all. Counted by hand: a seat's source is its fresh state when that is not silent (12 of its 16
// pairs), otherwise its recorded state (4), so each of the three answering states is the source in
// 5 pairs and silent in 1. A settle needs four sources from {A, B, answered without a final} with
// at least three of one final: four of it (1 way) or three of it and one other (4 seats x 2 = 8),
// so 9 per final and 18 in all, each reached by 5^4 = 625 pairs: 11,250 settles.
//
// The break that turns this red (rule.ts, decideDay7):
//   if (best !== null && best.count >= AGREE.day7Agree) {
//   ->  if (best !== null && best.count >= AGREE.afterN) {

import { describe, expect, test } from "bun:test";
import { READING_KIND } from "../src/chain";
import { scoreGameSync } from "../src/program";
import { decideDay7 } from "../src/rule";
import type { Seat } from "../src/types";
import { NOW } from "./cases";
import { KEY, at, saved } from "./fixtures";
import { PAYOUT, SEATS4, STATES, chainOf, reading, reportReading, type State } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

describe("never: a disputed game settles on fewer than three agreeing recorded sources", () => {
	test("every settle in the sweep rests on four sources, none silent, three or more with the same final, each the seat's latest", () => {
		let settles = 0;
		let total = 0;
		const wrong: unknown[] = [];
		const pairs: [State, State][] = [];
		for (const f of STATES) for (const r of STATES) pairs.push([f, r]);
		for (const p1 of pairs) for (const p2 of pairs) for (const p3 of pairs) for (const p4 of pairs) {
			const ps = [p1, p2, p3, p4];
			const fresh = SEATS4.map((s, i) => reading(s, ps[i][0]));
			const recorded = SEATS4.map((s, i) => reportReading(s, ps[i][1]));
			const d = decideDay7(fresh, recorded, SEATS4);
			total++;
			// Every source is the seat's latest: fresh when it answered, else what the record carried.
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
			const d = decideDay7(
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
		// The spare keeps three days and can't be re-read on day 7: its recorded final counts.
		expect(day7(["A", "A", "A", S], [S, S, S, "A"])).toBe("score 27-20");
		// A fresh answer beats the record: a vendor correction counts.
		expect(day7(["A", "A", "A", "A"], ["B", "B", "B", "B"])).toBe("score 27-20");
		expect(day7(["B", "B", "A", "A"], ["A", "A", "A", "A"])).toBe("void: day 7: no three sources agree");
		// A league with three feeds voids, even three to nothing.
		expect(day7(["A", "A", "A"], [S, S, S], [1, 2, 3])).toBe("void: day 7: fewer than four feeds");
	});

	// The artifact: a real game, disputed, read on day 7 from the saved answers. Washington at San
	// Francisco, 20 Oct 00:15 UTC, 23-17. The dispute record lands at 06:00 that morning, so day 7
	// opens at 06:00 on 27 Oct; the run is an hour later. Seats 1 and 2 answer fresh. The spare keeps
	// three days, so it is silent and its recorded reading counts.
	const DISPUTED_AT = at("2026-10-20T06:00:00Z");
	const DAY7_RUN = at("2026-10-27T07:00:00Z");
	const spareFinal = { seat: 4, kind: 2 as const, homeScore: 23, awayScore: 17 };

	function day7Run(game: ReturnType<typeof chainOf>) {
		const t = saved(undefined, DAY7_RUN);
		const o = scoreGameSync(game, KEYS, PAYOUT, DAY7_RUN, t.send);
		expect(t.misses).toEqual([]);
		return {
			action: o.decision.action,
			why: o.decision.why,
			kind: o.report?.kind ?? null,
			scores: o.report ? [o.report.homeScore, o.report.awayScore] : null,
			sources: o.decision.readings.map((r) => `${r.seat}:${r.kind}/${r.detail}`),
		};
	}

	test("end to end: day 7 on a real final settles on four sources, the spare's from the record", () => {
		// Created with a seat 3 hint that passed at verification; seat 3's final is on record from the
		// dispute, and its fresh read is silent (its result for the hint has aged out).
		const base = chainOf("nfl final");
		const hinted = {
			...base,
			hints: [{ seat: 3, id: "00000000-0000-4000-8000-000000000000" }],
			startReadings: base.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: READING_KIND.noFinal } : r)),
			status: "disputed" as const,
			dispute: { at: DISPUTED_AT, readings: [reportReading(1, "silent"), reportReading(2, "silent"), { seat: 3, kind: 2 as const, homeScore: 23, awayScore: 17 }, spareFinal] },
		};
		expect(day7Run(hinted)).toEqual({
			action: "score",
			why: "day 7: three sources or more, the same final",
			kind: 2,
			scores: [23, 17],
			sources: ["1:final/final", "2:final/final", "3:final/recorded at the dispute", "4:final/recorded at the dispute"],
		});
		// Before the day-7 clock has run, nothing is read and nothing is written.
		const t = saved(undefined, DAY7_RUN);
		const early = scoreGameSync(hinted, KEYS, PAYOUT, DISPUTED_AT + 7 * 86_400 - 1, t.send);
		expect({ action: early.decision.action, why: early.decision.why, asked: t.asked.length }).toEqual({ action: "wait", why: "before day 7", asked: 0 });
	});

	test("end to end: the same game created without a seat 3 hint voids on day 7, as a league with three feeds does", () => {
		const base = chainOf("nfl final");
		const game = { ...base, status: "disputed" as const, dispute: { at: DISPUTED_AT, readings: [reportReading(1, "silent"), reportReading(2, "silent"), reportReading(3, "silent"), spareFinal] } };
		expect(day7Run(game)).toEqual({
			action: "void",
			why: "day 7: a source is silent",
			kind: 3,
			scores: [0, 0],
			sources: ["1:final/final", "2:final/final", "3:silent/silent for the game", "4:final/recorded at the dispute"],
		});
	});
});
