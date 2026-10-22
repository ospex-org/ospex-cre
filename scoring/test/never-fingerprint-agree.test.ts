// Never: "The program takes which feeds to ask, or how many must agree, from anything outside the
// fingerprint. Only the keys and the payout address come from outside, and neither can touch the
// score."
//
// D1's never-fingerprint.test.ts holds which feeds are asked. This file holds the rest: how many
// must agree, which seats count, and the two things that do come from outside. A key decides only
// whether its own seat can be read; a missing key is a silent seat on that run, never a seat that
// stops counting. The payout lands in the report's payout field and nowhere else.
//
// The break that turns this red (program.ts, plan):
//   const down = silentForGame(game);
//   ->  const down = keyFor(keys, 3) === null ? 3 : silentForGame(game);
// (a missing key would stand seat 3 down for the game and let the spare count in its place).

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { scoreGameSync } from "../src/program";
import { AGREE } from "../src/rule";
import { START_SPREAD } from "../src/verify";
import type { Keys } from "../src/index";
import { NOW } from "./cases";
import { KEY, copy, saved, type Derive } from "./fixtures";
import { PAYOUT, chainOf } from "./rule-helpers";

// Golden State at the Lakers, 127-105, inside its window at the suite's clock, as if created with a
// seat 3 hint that passed verification. Seat 3's answer for the hint is derived: the real by-id
// answer of a game seat 3 listed that afternoon, marked finished at the Lakers' score. Every other
// answer is real.
const SEAT3_ID = "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09";
const lakers3: ChainGame = {
	...chainOf("nba final"),
	hints: [{ seat: 3, id: SEAT3_ID }],
	startReadings: [1, 2, 3, 4].map((seat) => ({ seat, kind: 1 as const, homeScore: 0, awayScore: 0 })),
};
const seat3Final: Derive = (seat, path, body) =>
	seat === 3 && path === `/results/${SEAT3_ID}`
		? (copy(body) as Record<string, unknown>[]).map((r) => ({ ...r, Final: true, FinalType: "Finished", HomeScore: "127", AwayScore: "105" }))
		: body;

const ALL: Keys = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

function outcome(game: ChainGame, keys: Keys, payout = PAYOUT) {
	const t = saved(seat3Final, NOW);
	const o = scoreGameSync(game, keys, payout, NOW, t.send);
	expect(t.misses).toEqual([]);
	return { action: o.decision.action, why: o.decision.why, report: o.report };
}

describe("never: how many must agree, or which seats count, from outside the fingerprint", () => {
	test("the counts are the spec's, fixed in the source, and nothing at runtime writes to them", () => {
		expect({ ...AGREE }).toEqual({ insideN: 3, afterN: 2, day7Sources: 4, day7Agree: 3 });
		expect(START_SPREAD).toBe(3600);
		const attempts: [string, () => void][] = [
			["lower the count inside n", () => ((AGREE as unknown as { insideN: number }).insideN = 2)],
			["lower the count after n", () => ((AGREE as unknown as { afterN: number }).afterN = 1)],
			["lower day 7's count", () => ((AGREE as unknown as { day7Agree: number }).day7Agree = 2)],
			["add a count", () => ((AGREE as unknown as Record<string, number>).spare = 0)],
		];
		for (const [what, attempt] of attempts) expect({ what, threw: throws(attempt) }).toEqual({ what, threw: true });
		expect({ ...AGREE }).toEqual({ insideN: 3, afterN: 2, day7Sources: 4, day7Agree: 3 });
	});

	test("a missing key is a silent seat on that run; it never stops a seat counting or lets the spare in", () => {
		expect(outcome(lakers3, ALL).action).toBe("score");
		// Seat 3's key missing: seat 3 is silent, and inside n a silent counting seat blocks. The
		// spare's agreeing final does not stand in for it: the seat is not silent for the game.
		const no3 = outcome(lakers3, { 1: KEY, 2: KEY, 4: KEY });
		expect({ action: no3.action, why: no3.why }).toEqual({ action: "wait", why: "inside n: a counting seat is silent" });
		// The control: the same game created without a seat 3 hint has seat 3 silent for the game, and there the spare counts.
		expect(outcome({ ...lakers3, hints: [] }, { 1: KEY, 2: KEY, 4: KEY }).action).toBe("score");
	});

	test("nothing handed in beside the keys, and nothing riding on the game object, changes a decision", () => {
		const base = outcome(lakers3, ALL);
		const extraKeys = { ...ALL, 5: KEY, 0: KEY, insideN: 2, afterN: 1, counting: [1, 2, 4], spare: 3 } as unknown as Keys;
		expect(outcome(lakers3, extraKeys)).toEqual(base);
		const extraGame = { ...lakers3, need: 2, insideN: 2, counting: [1, 2, 4], spare: 3, agree: 1 } as unknown as ChainGame;
		expect(outcome(extraGame, ALL)).toEqual(base);
		const hostile: Record<string, string> = { OSPEX_AGREE: "1", OSPEX_INSIDE_N: "2", OSPEX_AFTER_N: "1", OSPEX_DAY7: "2", OSPEX_COUNTING: "1,2,4", OSPEX_SPARE: "3", START_SPREAD: "999999" };
		const prior: Record<string, string | undefined> = {};
		for (const [k, v] of Object.entries(hostile)) {
			prior[k] = process.env[k];
			process.env[k] = v;
		}
		try {
			expect(outcome(lakers3, ALL)).toEqual(base);
			const no3 = outcome(lakers3, { 1: KEY, 2: KEY, 4: KEY });
			expect(no3.action).toBe("wait");
		} finally {
			for (const [k, v] of Object.entries(prior)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		}
	});

	test("the payout lands in the payout field and nowhere else", () => {
		const base = outcome(lakers3, ALL).report!;
		expect({ kind: base.kind, home: base.homeScore, away: base.awayScore }).toEqual({ kind: 2, home: 127, away: 105 });
		for (const payout of ["0x000000000000000000000000000000000000dEaD", "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF", "0x0000000000000000000000000000000000000001"]) {
			const r = outcome(lakers3, ALL, payout).report!;
			expect(r.payout).toBe(payout);
			expect({ ...r, payout: "" }).toEqual({ ...base, payout: "" });
		}
	});

	test("a payout that is not a usable address writes nothing, and decides nothing either", () => {
		for (const bad of ["", "0x", "0x0000000000000000000000000000000000000000", "0x12", "1111111111111111111111111111111111111111", "0xGGGG000000000000000000000000000000000000"]) {
			const t = saved(seat3Final, NOW);
			expect({ bad, threw: throws(() => scoreGameSync(lakers3, ALL, bad, NOW, t.send)) }).toEqual({ bad, threw: true });
		}
	});
});

function throws(f: () => void): boolean {
	try {
		f();
		return false;
	} catch {
		return true;
	}
}
