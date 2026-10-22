// What makes two finals the same final: both teams' points, each by team. Every other way two
// finals can differ is a disagreement, inside n and after, and day 7 never counts them together.
// Each pair below differs from 27-20 in exactly one of the ways a careless comparison could miss:
// only the home points, only the away points, the two swapped (the shape seat 3's points take if
// its hint names the game the other way round), or the same total.

import { describe, expect, test } from "bun:test";
import { decide, decideDay7 } from "../src/rule";
import type { Reading, Seat } from "../src/types";
import { SEATS4 } from "./rule-helpers";

const final = (seat: Seat, home: number, away: number): Reading => ({ seat, kind: "final", home, away, recorded: null, detail: "final", record: null });
const live = (seat: Seat, home: number, away: number): Reading => ({ seat, kind: "no_final", home, away, recorded: null, detail: "in progress", record: null });
const quiet = (seat: Seat): Reading => ({ seat, kind: "silent", home: null, away: null, recorded: null, detail: "silent", record: null });

const BASE: readonly [number, number] = [27, 20];
const DIFFERENT: readonly [string, readonly [number, number]][] = [
	["home points only", [26, 20]],
	["away points only", [27, 21]],
	["the two swapped", [20, 27]],
	["the same total", [26, 21]],
	["the same total, the other way", [28, 19]],
];

describe("two finals are the same only when both teams' points match, by team", () => {
	for (const [what, other] of DIFFERENT) {
		test(`${what}: a disagreement inside n and after, wherever the other final sits`, () => {
			const [h, a] = BASE;
			for (const at of SEATS4) {
				const readings = SEATS4.map((s) => (s === at ? final(s, other[0], other[1]) : final(s, h, a)));
				for (const inside of [true, false]) {
					expect({ at, inside, action: decide(readings, [1, 2, 3], inside).action }).toEqual({ at, inside, action: "dispute" });
				}
			}
		});

		test(`${what}: day 7 never counts it with 27-20`, () => {
			const [h, a] = BASE;
			// Two of each: no three agree, so the game voids.
			const twoTwo = [final(1, h, a), final(2, h, a), final(3, other[0], other[1]), final(4, other[0], other[1])];
			expect(decideDay7(twoTwo, [], SEATS4).action).toBe("void");
			// Three and one: it settles on the three, at their points.
			const d = decideDay7([final(1, h, a), final(2, h, a), final(3, h, a), final(4, other[0], other[1])], [], SEATS4);
			expect(d.action === "score" ? [d.home, d.away] : d.action).toEqual([h, a]);
		});
	}

	test("an answer without a final never agrees with a final, whatever points it carries", () => {
		const [h, a] = BASE;
		// The reviewer's input: one real final fresh; the dispute record holds three seats' readings,
		// two of them answers without a final carrying the same points. One final is not three.
		const fresh = [final(1, h, a), quiet(2), quiet(3), quiet(4)];
		const recorded = [
			{ seat: 1, kind: 2 as const, homeScore: h, awayScore: a },
			{ seat: 2, kind: 1 as const, homeScore: h, awayScore: a },
			{ seat: 3, kind: 1 as const, homeScore: h, awayScore: a },
			{ seat: 4, kind: 2 as const, homeScore: 27, awayScore: 21 },
		];
		expect(decideDay7(fresh, recorded, SEATS4).action).toBe("void");
		// Inside n, two finals and an answer without one at the same points: still waiting.
		expect(decide([final(1, h, a), final(2, h, a), live(3, h, a), quiet(4)], [1, 2, 3], true).action).toBe("wait");
		// After n the same is a disagreement, not a score: the third seat answered, and not with a final.
		expect(decide([final(1, h, a), final(2, h, a), live(3, h, a), quiet(4)], [1, 2, 3], false).action).toBe("dispute");
	});

	test("the control: the same final at every seat scores, inside n and after, and on day 7", () => {
		const [h, a] = BASE;
		const readings = SEATS4.map((s) => final(s, h, a));
		expect([decide(readings, [1, 2, 3], true).action, decide(readings, [1, 2, 3], false).action, decideDay7(readings, [], SEATS4).action]).toEqual(["score", "score", "score"]);
	});
});
