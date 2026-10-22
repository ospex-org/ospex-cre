// One run of the program for one game: which state reads what, what is never asked, and the two
// transports agreeing.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { scoreGameAsync, scoreGameSync } from "../src/program";
import { CASES, NOW } from "./cases";
import { KEY, at, locate, saved } from "./fixtures";
import { PAYOUT, chainOf } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

function asked(game: ChainGame, now = NOW) {
	const t = saved(undefined, now);
	const o = scoreGameSync(game, KEYS, PAYOUT, now, t.send);
	return { action: o.decision.action, why: o.decision.why, report: o.report, seats: t.asked.map((q) => locate(q)!.seat), misses: t.misses };
}

describe("one run", () => {
	test("an ended game, an unoffered league, unreadable clocks, a missing start or record: nothing is asked or written", () => {
		const g = chainOf("nba final");
		const rows: [string, ChainGame, string][] = [
			["scored", { ...g, status: "scored" }, "the game has ended"],
			["voided", { ...g, status: "voided" }, "the game has ended"],
			["released", { ...g, status: "released" }, "the game has ended"],
			["unoffered", { ...g, league: "wnba" }, "league not offered"],
			["no n", { ...g, n: 0 }, "the game's clocks are not readable"],
			["fractional date", { ...g, date: g.date + 0.5 }, "the game's clocks are not readable"],
			["no start", { ...g, start: null }, "no start on chain"],
			["disputed, no record", { ...g, status: "disputed", dispute: null }, "no dispute record on chain"],
		];
		for (const [what, game, why] of rows) {
			expect({ what, ...asked(game) }).toEqual({ what, action: "wait", why, report: null, seats: [], misses: [] });
		}
	});

	test("before the start, nothing is asked", () => {
		const g = chainOf("nba not final");
		expect(asked(g, g.start! - 1)).toMatchObject({ action: "wait", why: "before the start", seats: [] });
		expect(asked(g, g.start!).seats.length).toBeGreaterThan(0);
	});

	test("a seat silent for the game is never asked; every other seat is, in seat order", () => {
		// Created without a seat 3 hint.
		const lakers = asked(chainOf("nba final"));
		expect([...new Set(lakers.seats)]).toEqual([1, 2, 4]);
		// Created with one that passed verification.
		const sixers = asked(chainOf("nba not final"), at("2026-10-22T23:00:00Z"));
		expect([...new Set(sixers.seats)]).toEqual([1, 2, 3, 4]);
		// Created with one, but the start report recorded seat 3 silent: its hint failed at verification.
		const failed = chainOf("nba not final");
		const down = asked({ ...failed, startReadings: failed.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: 0 as const } : r)) }, at("2026-10-22T23:00:00Z"));
		expect([...new Set(down.seats)]).toEqual([1, 2, 4]);
	});

	test("verification asks seats 1 and 2 by team, seat 3's board once, and the spare", () => {
		const g: ChainGame = { ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null };
		const v = asked(g);
		expect(v.seats.filter((s) => s === 3).length).toBe(1);
		expect([...new Set(v.seats)]).toEqual([1, 2, 3, 4]);
		expect(v.misses).toEqual([]);
	});

	test("the synchronous and asynchronous runs decide the same, on every real game and every state the suite reads", async () => {
		const states: ((c: ChainGame) => ChainGame)[] = [
			(c) => c,
			(c) => ({ ...c, status: "unverified", start: null, startReadings: null }),
		];
		let compared = 0;
		for (const c of CASES) {
			for (const toState of states) {
				const game = toState(chainOf(c.name));
				const t1 = saved(undefined, NOW);
				const t2 = saved(undefined, NOW);
				let sync: unknown;
				try {
					sync = scoreGameSync(game, KEYS, PAYOUT, NOW, t1.send);
				} catch (e) {
					sync = String(e);
				}
				let async_: unknown;
				try {
					async_ = await scoreGameAsync(game, KEYS, PAYOUT, NOW, async (q) => t2.send(q));
				} catch (e) {
					async_ = String(e);
				}
				expect({ name: c.name, out: async_ }).toEqual({ name: c.name, out: sync });
				expect(t2.asked.map((q) => q.url)).toEqual(t1.asked.map((q) => q.url));
				compared++;
			}
		}
		expect(compared).toBe(CASES.length * 2);
	});

	test("a transport that throws makes that seat silent, never the run's decision", async () => {
		const g = chainOf("nba final");
		const t = saved(undefined, NOW);
		const o = scoreGameSync(g, KEYS, PAYOUT, NOW, (q) => {
			if (locate(q)?.seat === 2) throw new Error("socket closed");
			return t.send(q);
		});
		expect([o.decision.action, o.decision.readings.map((r) => [r.seat, r.kind, r.detail])]).toEqual([
			"wait",
			[
				[1, "final", "final"],
				[2, "silent", "transport"],
				[3, "silent", "silent for the game"],
				[4, "final", "final"],
			],
		]);
		const v = await scoreGameAsync({ ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null }, KEYS, PAYOUT, NOW, async (q) => {
			if (q.url.includes("/odds/")) throw new Error("socket closed");
			return saved(undefined, NOW).send(q);
		});
		expect([v.decision.action, v.decision.why]).toEqual(["wait", "seat 3's board is silent: transport"]);
	});
});
