// One run of the program for one game: which state reads what, what is never asked, and the two
// transports agreeing.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { scoreGameAsync, scoreGameSync } from "../src/program";
import { CASES, NOW } from "./cases";
import { KEY, at, copy, locate, saved, type Derive } from "./fixtures";
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
		const record = { at: g.start! + 3600, readings: [] };
		const rows: [string, ChainGame, number, string][] = [
			["scored", { ...g, status: "scored" }, NOW, "the game has ended"],
			["voided", { ...g, status: "voided" }, NOW, "the game has ended"],
			["released", { ...g, status: "released" }, NOW, "the game has ended"],
			["unoffered", { ...g, league: "wnba" }, NOW, "league not offered"],
			["no n", { ...g, n: 0 }, NOW, "the game's clocks are not readable"],
			["fractional date", { ...g, date: g.date + 0.5 }, NOW, "the game's clocks are not readable"],
			["no day-7 clock", { ...g, day7: 0 }, NOW, "the game's clocks are not readable"],
			["no start", { ...g, start: null }, NOW, "no start on chain"],
			["a zero start", { ...g, start: 0 }, NOW, "no start on chain"],
			["disputed, no record", { ...g, status: "disputed", dispute: null }, NOW, "no dispute record on chain"],
			["disputed, a record at zero", { ...g, status: "disputed", dispute: { ...record, at: 0 } }, NOW, "no dispute record on chain"],
		];
		// The run's clock picks the count, three inside n or two after, so a clock that can't be read
		// decides nothing: read as a number it would put a game inside its window after n.
		for (const now of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, NOW + 0.5, Number.MAX_SAFE_INTEGER + 2]) {
			rows.push([`the run's clock ${now}`, g, now, "the game's clocks are not readable"]);
		}
		for (const [what, game, now, why] of rows) {
			expect({ what, ...asked(game, now) }).toEqual({ what, action: "wait", why, report: null, seats: [], misses: [] });
		}
	});

	test("a seat with no key is still in the report: silent, one reading per seat asked", () => {
		const g = chainOf("nba final");
		const after = g.start! + g.n + 60;
		const t = saved(undefined, after);
		const o = scoreGameSync(g, { 1: KEY, 2: KEY }, PAYOUT, after, t.send);
		expect(t.misses).toEqual([]);
		expect([o.report?.kind, o.report?.readings.map((r) => [r.seat, r.kind])]).toEqual([
			2,
			[
				[1, 2],
				[2, 2],
				[3, 0],
				[4, 0],
			],
		]);
		expect(o.decision.readings.map((r) => r.detail)).toEqual(["final", "final", "silent for the game", "no key"]);
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

	test("the synchronous and asynchronous runs decide the same, on every real game, verified, unverified and disputed", async () => {
		// The real answers all agree, so the last pass derives a disagreement: every final seat 2 gives
		// has one more home point.
		const seat2Off: Derive = (seat, _path, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results?: Record<string, any>[] };
			for (const g of b.results ?? []) if (g.status === "final" && g.scoreboard?.score) g.scoreboard.score.home += 1;
			return b;
		};
		const states: [(c: ChainGame) => ChainGame, Derive | undefined][] = [
			[(c) => c, undefined],
			[(c) => ({ ...c, status: "unverified", start: null, startReadings: null }), undefined],
			[
				(c) => ({
					...c,
					status: "disputed",
					dispute: { at: NOW - 7 * 86_400, readings: [1, 2, 3, 4].map((seat) => ({ seat, kind: 2 as const, homeScore: 3, awayScore: 2 })) },
				}),
				undefined,
			],
			[(c) => c, seat2Off],
		];
		const actions = new Set<string>();
		let compared = 0;
		for (const c of CASES) {
			for (const [toState, derive] of states) {
				const game = toState(chainOf(c.name));
				const t1 = saved(derive, NOW);
				const t2 = saved(derive, NOW);
				const sync = scoreGameSync(game, KEYS, PAYOUT, NOW, t1.send);
				const async_ = await scoreGameAsync(game, KEYS, PAYOUT, NOW, async (q) => t2.send(q));
				expect({ name: c.name, out: async_ }).toEqual({ name: c.name, out: sync });
				expect(t2.asked.map((q) => q.url)).toEqual(t1.asked.map((q) => q.url));
				actions.add(sync.decision.action);
				compared++;
			}
		}
		expect(compared).toBe(CASES.length * 4);
		// The comparison covered every kind of decision, not one kind sixteen times.
		expect([...actions].sort()).toEqual(["dispute", "score", "start", "void", "wait"]);
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
