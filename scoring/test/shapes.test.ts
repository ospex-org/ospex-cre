// The shapes file (shapes/emitted.json, written by shapes.ts): every report the program can send, as it
// sends it now, for the games set's own tests to run through its report door. It must never fall
// behind the program, so this rebuilds it and compares. And each shape is held to the lines the
// program keeps, which are the ones the games set's readings check refuses a report for breaking.
//
// The counts, by hand where the rule makes it short (the values are shapes.ts's states: silent; none,
// in play; off, postponed, seats 1 to 3 only; the finals A and B):
//   start 3             seat 3 passes beside the spare listed or silent (a spare not giving the game is
//                       silent too) (2); seat 3 silent for the game with the spare standing in, listed (1)
//   inside, score 8     the three counting seats one final, the spare silent, in play or the same
//                       (3 x 2); seat 3 silent for the game, the spare the third (2)
//   inside, first 170   every seat's answer, five at seats 1 to 3 and four at the spare, with both
//                       finals: 500 - 2 x 192 + 54
//   after, score 28     three counting seats one final, or two and the third silent, the spare silent,
//                       in play or the same (4 x 3 x 2); with seat 3 silent for the game, the spare the
//                       second final beside one of seats 1 and 2 (2 x 2)
//   hour 24, void 8     no final, two counting seats off and the third silent (3) or all three off (1),
//                       the spare silent or in play (x 2); the spare standing in adds none the first
//                       game's shapes don't have
//   disputed scores     inside 8 and after 12: three counting votes one final beside the spare's silent,
//                       not final or the same vote, or two and the spare's the third (6 x 2), less those
//                       the inside rule refuses; day 7, 20: the 6 a record written inside n can still
//                       score by the ordinary rule, and day 7's own 14 (three of a final beside a
//                       counting seat not final, or beside the other final)
// The rest (the first records after n, updates, day-7 voids) are as measured at this head.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FILE, emitted, render, type Shape } from "../shapes";

const now = emitted();

describe("the shapes file: every report the program can send", () => {
	test("is what the program sends now: rebuild it with `bun shapes.ts`", () => {
		expect(readFileSync(FILE, "utf8").replace(/\r\n/g, "\n") === render(now)).toBe(true);
	});

	test("counted, by when it was decided, the game it meets and what it is", () => {
		expect(now.runs).toEqual({ verification: 1_728, scoring: 496_964, records: 1_692 });
		expect(now.counts).toEqual({
			total: 2_109,
			"verification, unverified, start": 3,
			"inside the window, verified, score": 8,
			"inside the window, verified, dispute record": 170,
			"inside the window, disputed, score": 8,
			"inside the window, disputed, update": 495,
			"after the window, verified, score": 28,
			"after the window, verified, dispute record": 404,
			"after the window, disputed, score": 12,
			"after the window, disputed, update": 495,
			"hour 24, verified, void": 8,
			"day 7, disputed, score": 26,
			"day 7, disputed, void": 452,
		});
	});

	test("every shape keeps the program's lines, the ones the games set's readings check holds a report to", () => {
		const KIND = { start: 1, score: 2, void: 3, "dispute record": 4, update: 4 } as const;
		const wrong: { line: string; shape: Shape }[] = [];
		for (const s of now.shapes) {
			const breaks = (line: string) => wrong.push({ line, shape: s });
			const r = s.readings;
			if (r.length !== 4 || r.some((x, i) => x[0] !== i + 1)) breaks("four readings, one per seat, in seat order");
			if (r.some((x) => ![0, 1, 2].includes(x[1]))) breaks("each reading silent, answered without a final, or final");
			if (r.some((x) => x[1] === 0 && (x[2] !== 0 || x[3] !== 0))) breaks("a silent reading carries no points");
			if (s.kind !== KIND[s.decision]) breaks("the report's kind is its decision's");
			if (s.decision !== "score" && (s.home !== 0 || s.away !== 0)) breaks("only a score carries points of its own");
			const finals = r.filter((x) => x[1] === 2);
			const alike = Math.max(0, ...finals.map((f) => finals.filter((x) => x[2] === f[2] && x[3] === f[3]).length));
			const agree = finals.filter((x) => x[2] === s.home && x[3] === s.away).length;
			switch (s.decision) {
				case "start":
					if (s.game !== "unverified" || s.clock !== "verification") breaks("a start is verification's, on a game not yet verified");
					if (r[0][1] !== 1 || r[1][1] !== 1) breaks("a start: seats 1 and 2 list the game");
					if (finals.length > 0) breaks("no start for a game already over");
					break;
				case "score":
					if (agree < 1) breaks("a score's points are a final's");
					if (s.game === "disputed" && agree < 3) breaks("a disputed game never settles on fewer than three agreeing recorded sources");
					if (s.clock !== "day 7" && agree !== finals.length) breaks("no score beside a final that differs, except on day 7");
					if (s.game === "verified" && s.clock !== "inside the window" && s.clock !== "after the window") breaks("a game with no record scores in its window or after it");
					if (s.game === "disputed" && s.clock === "day 7" && finals.length - agree > 1) breaks("day 7: at most one dissenting");
					break;
				case "void":
					if (s.game === "verified" && (s.clock !== "hour 24" || finals.length > 0)) breaks("a game with no record voids from hour 24, and only when no seat shows a final");
					if (s.game === "disputed" && s.clock !== "day 7") breaks("a disputed game voids on day 7 alone");
					if (alike >= 3) breaks("a void never carries three finals that agree");
					break;
				case "dispute record":
				case "update":
					if (s.game !== (s.decision === "update" ? "disputed" : "verified")) breaks("the first record meets a game with no record, an update a disputed one");
					if (s.clock !== "inside the window" && s.clock !== "after the window") breaks("a dispute report is decided before day 7");
					break;
			}
		}
		expect(wrong.slice(0, 3)).toEqual([]);
		// The controls: each line above is met by the file at least once on both sides of it.
		const has = (f: (s: Shape) => boolean) => now.shapes.some(f);
		expect(has((s) => s.decision === "score" && s.game === "verified" && s.readings.filter((x) => x[1] === 2).length === 2)).toBe(true);
		expect(has((s) => s.decision === "score" && s.game === "disputed" && s.readings.filter((x) => x[1] === 2).length === 3)).toBe(true);
		expect(has((s) => s.decision === "score" && s.clock === "day 7" && s.readings.some((x) => x[1] === 2 && (x[2] !== s.home || x[3] !== s.away)))).toBe(true);
		expect(has((s) => s.decision === "void" && s.clock === "day 7" && s.readings.filter((x) => x[1] === 2 && x[2] === 27).length === 2)).toBe(true);
		expect(has((s) => s.decision === "score" && s.readings.some((x) => x[1] === 1 && x[2] === 27 && x[3] === 20))).toBe(true);
	});
});
