// One run of the program for one game: which state reads what, what is never asked, and the two
// transports agreeing.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { scoreGameAsync, scoreGameSync } from "../src/program";
import { silentForGame } from "../src/rule";
import { Cut } from "../src/run";
import { CASES, LATE, NOW } from "./cases";
import { KEY, at, copy, locate, saved, type Derive } from "./fixtures";
import { PAYOUT, chainOf } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
/** The board's one-game request for the Bears' hint, as the index keys it: the method, the path and the body. */
const BOARD_ASK = `POST /odds/bygames {"GameIDs":["edcfd41f-1773-4bc9-a349-aa50931a0278"],"Sport":"NFL","OddType":"Game"}`;

function asked(game: ChainGame, now = NOW) {
	// The saved answers take a clock in unix seconds and refuse a larger one, so a run whose clock is
	// past that is served the answers as of NOW: a transport that would answer, which it must not ask.
	const t = saved(undefined, Number.isFinite(now) && now > 1e11 ? NOW : now);
	const o = scoreGameSync(game, KEYS, PAYOUT, now, t.send);
	return { action: o.decision.action, why: o.decision.why, report: o.report, seats: t.asked.map((q) => locate(q)!.seat), misses: t.misses };
}

describe("one run", () => {
	test("an ended game, an unoffered league, unreadable clocks, a missing start or record: nothing is asked or written", () => {
		const g = chainOf("nba final");
		const record = { at: g.start! + 3600, records: [g.startReadings!] };
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
			["no start report", { ...g, startReadings: null }, NOW, "no start report on chain"],
			["disputed, no record", { ...g, status: "disputed", dispute: null }, NOW, "no dispute record on chain"],
			["disputed, a record at zero", { ...g, status: "disputed", dispute: { ...record, at: 0 } }, NOW, "no dispute record on chain"],
			["disputed, no reports in the record", { ...g, status: "disputed", dispute: { ...record, records: [] } }, NOW, "no dispute record on chain"],
			["disputed, a report short a seat", { ...g, status: "disputed", dispute: { ...record, records: [g.startReadings!.slice(0, 3)] } }, NOW, "no dispute record on chain"],
			["disputed, an update out of seat order", { ...g, status: "disputed", dispute: { ...record, records: [g.startReadings!, [...g.startReadings!].reverse()] } }, NOW, "no dispute record on chain"],
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

	test("a seat the run never asks needs no key; a seat it asks decides nothing without one, and asks nothing", () => {
		const g = chainOf("nba final");
		const after = g.start! + g.n + 60;
		const no3 = { 1: KEY, 2: KEY, 4: KEY };
		// Seat 3 is silent for this game (created without its hint) and is never asked: the run scores
		// without its key, exactly as with it.
		const all = scoreGameSync(g, KEYS, PAYOUT, after, saved(undefined, after).send);
		expect([all.report?.kind, all.report?.readings.map((r) => [r.seat, r.kind])]).toEqual([2, [[1, 2], [2, 2], [3, 0], [4, 2]]]);
		const without = scoreGameSync(g, no3, PAYOUT, after, saved(undefined, after).send);
		expect(without.report).toEqual(all.report);
		// The same game with seat 3 counting (its hint passed): seat 3 is asked, so it needs its key.
		const counting: ChainGame = { ...g, hints: [{ seat: 3, id: "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09" }], startReadings: g.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: 1 as const } : r)) };
		const t = saved(undefined, after);
		const o = scoreGameSync(counting, no3, PAYOUT, after, t.send);
		expect([o.decision.action, o.decision.why, o.report, t.asked.length]).toEqual(["wait", "seat 3 has no key", null, 0]);
		// At verification: a game created without a usable seat 3 hint never asks seat 3; one with a hint does.
		const unverified = (hints: ChainGame["hints"]): ChainGame => ({ ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null, hints });
		const noHint = scoreGameSync(unverified([]), no3, PAYOUT, NOW, saved(undefined, NOW).send);
		expect([noHint.decision.action, noHint.decision.why]).toEqual(["start", "seats 1 and 2 list the game within an hour, and the spare stands in for seat 3"]);
		expect(noHint).toEqual(scoreGameSync(unverified([]), KEYS, PAYOUT, NOW, saved(undefined, NOW).send));
		const t2 = saved(undefined, NOW);
		const hinted = scoreGameSync(unverified([{ seat: 3, id: "edcfd41f-1773-4bc9-a349-aa50931a0278" }]), no3, PAYOUT, NOW, t2.send);
		expect([hinted.decision.why, t2.asked.length]).toEqual(["seat 3 has no key", 0]);
	});

	test("a closed seat is not asked, and needs no key: the spare after 66 hours, seat 3 after five days", () => {
		// Cleveland at Philadelphia, created with a seat 3 hint that passed: every seat counts or is asked.
		const g = chainOf("nba final, read after the game");
		const go = (keys: Record<number, string>, now: number) => {
			const t = saved(undefined, LATE);
			const o = scoreGameSync(g, keys, PAYOUT, now, t.send);
			expect(t.misses).toEqual([]);
			return { action: o.decision.action, why: o.decision.why, seats: [...new Set(t.asked.map((q) => locate(q)!.seat))], spare: o.decision.readings[3]?.detail };
		};
		const without = (seat: number) => Object.fromEntries(Object.entries(KEYS).filter(([s]) => Number(s) !== seat));
		const spareGone = g.start! + 66 * 3600 + 1;
		const seat3Gone = g.start! + 5 * 86_400 + 1;
		// Inside its window the spare is asked, so it needs its key.
		expect(go(without(4), spareGone - 1)).toMatchObject({ action: "wait", why: "seat 4 has no key", seats: [] });
		// Past it, the run neither asks it nor needs its key.
		expect(go(without(4), spareGone)).toMatchObject({ action: "score", seats: [1, 2, 3], spare: "closed: past its window" });
		expect(go(without(4), spareGone)).toEqual(go(KEYS, spareGone));
		// Seat 3 the same, five days from the start.
		expect(go(without(3), seat3Gone - 1)).toMatchObject({ action: "wait", why: "seat 3 has no key" });
		expect(go(without(3), seat3Gone)).toMatchObject({ action: "score", seats: [1, 2] });
		expect(go(without(3), seat3Gone)).toEqual(go(KEYS, seat3Gone));
		// Seats 1 and 2 have no window of their own: asked, and their keys needed, a month after the start.
		expect(go(without(1), g.start! + 30 * 86_400)).toMatchObject({ action: "wait", why: "seat 1 has no key" });
	});

	test("a start report this program could not have written decides nothing: one reading per seat, in seat order, seats 1 and 2 answering", () => {
		// Cleveland at Philadelphia, read after the game, with seat 3's result derived to 99-106: a start
		// report that let the run stand seat 3 down would score 114-106 on the spare instead of disputing.
		const g = chainOf("nba final, read after the game");
		const seat3Off: Derive = (s, p, b) => (s === 3 && p === "/results/cc394a49-c3d1-4b8c-bba2-8ebbb8326c09" ? (copy(b) as Record<string, unknown>[]).map((r) => ({ ...r, HomeScore: "99" })) : b);
		const four = g.startReadings!;
		const r = (seat: number, kind: 0 | 1 | 2) => ({ seat, kind, homeScore: 0, awayScore: 0 });
		const rows: [string, ChainGame["startReadings"]][] = [
			["no readings", []],
			["three readings", four.slice(0, 3)],
			["five readings", [...four, r(4, 1)]],
			["out of order", [four[1], four[0], four[2], four[3]]],
			["a seat twice", [four[0], four[0], four[2], four[3]]],
			["a seat outside the table", [four[0], four[1], four[2], r(5, 1)]],
			["seat 1 silent", [r(1, 0), four[1], four[2], four[3]]],
			["seat 2 silent", [four[0], r(2, 0), four[2], four[3]]],
			["a kind that isn't one of the three", [four[0], four[1], { ...four[2], kind: 3 as unknown as 1 }, four[3]]],
		];
		for (const [what, startReadings] of rows) {
			const t = saved(seat3Off, LATE);
			const o = scoreGameSync({ ...g, startReadings }, KEYS, PAYOUT, LATE, t.send);
			expect({ what, got: [o.decision.action, o.decision.why, t.asked.length] }).toEqual({ what, got: ["wait", "no start report on chain", 0] });
		}
		// The control: the four readings verification writes, which read, and the dissent at seat 3 is seen.
		const t = saved(seat3Off, LATE);
		const o = scoreGameSync(g, KEYS, PAYOUT, LATE, t.send);
		expect([o.decision.action, o.decision.why]).toEqual(["dispute", "two finals differ"]);
	});

	test("before the start, nothing is asked", () => {
		const g = chainOf("nba not final");
		expect(asked(g, g.start! - 1)).toMatchObject({ action: "wait", why: "before the start", seats: [] });
		expect(asked(g, g.start!).seats.length).toBeGreaterThan(0);
	});

	test("seat 3 counts only when the start report shows it passed its board check", () => {
		const hint = [{ seat: 3, id: "00000000-0000-4000-8000-000000000000" }];
		const at = (kind: 0 | 1 | 2) => [{ seat: 3, kind, homeScore: 0, awayScore: 0 }];
		expect([
			silentForGame({ hints: hint, startReadings: at(1) }), // passed: counts
			silentForGame({ hints: hint, startReadings: at(0) }), // failed: silent for the game
			silentForGame({ hints: hint, startReadings: at(2) }), // never a board check's answer
			silentForGame({ hints: hint, startReadings: [] }), // no seat 3 reading
			silentForGame({ hints: hint, startReadings: null }),
			silentForGame({ hints: [], startReadings: at(1) }), // no usable hint
		]).toEqual([null, 3, 3, 3, 3, 3]);
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

	test("verification asks seats 1 and 2 by team, seat 3's board, and the spare; then every seat again, seat 3 by its result", () => {
		const g: ChainGame = { ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null };
		const t = saved(undefined, NOW);
		const o = scoreGameSync(g, KEYS, PAYOUT, NOW, t.send);
		expect(o.decision.action).toBe("start");
		expect(t.misses).toEqual([]);
		const paths = t.asked.map((q) => locate(q)!);
		// Seat 3 is asked twice: its board's row for the hint near the date (a POST naming the id), then its result for the hint as scoring reads it.
		expect(paths.filter((p) => p.seat === 3).map((p) => p.path)).toEqual([BOARD_ASK, "/results/edcfd41f-1773-4bc9-a349-aa50931a0278"]);
		// The order of the seats asked: the read near the date, then the re-read in seat order.
		const runs = paths.map((p) => p.seat).filter((s, i, all) => i === 0 || all[i - 1] !== s);
		expect(runs).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
		// Created without a seat 3 hint: seat 3 is asked for nothing at all.
		const t2 = saved(undefined, NOW);
		scoreGameSync({ ...g, hints: [] }, KEYS, PAYOUT, NOW, t2.send);
		expect(t2.asked.filter((q) => locate(q)!.seat === 3)).toEqual([]);
		// A hint the board no longer lists: seat 3's result for it is read before seat 3 stands down, and
		// seat 3 isn't read again.
		const gone: Derive = (s, p, b) => (s === 3 && p === "/odds/NFL?oddType=Game" ? (copy(b) as Record<string, unknown>[]).filter((r) => r.ID !== "edcfd41f-1773-4bc9-a349-aa50931a0278") : b);
		const t3 = saved(gone, NOW);
		const o3 = scoreGameSync(g, KEYS, PAYOUT, NOW, t3.send);
		expect(t3.misses).toEqual([]);
		expect(o3.decision.action).toBe("start");
		const asked3 = t3.asked.map((q) => locate(q)!);
		expect(asked3.filter((p) => p.seat === 3).map((p) => p.path)).toEqual([BOARD_ASK, "/results/edcfd41f-1773-4bc9-a349-aa50931a0278"]);
		expect(asked3.map((p) => p.seat).filter((s, i, all) => i === 0 || all[i - 1] !== s)).toEqual([1, 2, 3, 4, 1, 2, 4]);
	});

	test("the spare keeps its id at verification: asked by it near the date and again at the re-read, never its slate; an id the feed answers nothing for reads the slate where it fits; college basketball without an id asks nothing", () => {
		const g: ChainGame = { ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null };
		const withId = { ...g, hints: [...g.hints, { seat: 4, id: "ffebea881c1d7b2dfb85b3e590c35985" }] };
		const t = saved(undefined, NOW);
		const o = scoreGameSync(withId, KEYS, PAYOUT, NOW, t.send);
		expect([o.decision.action, t.misses]).toEqual(["start", []]);
		const spare = t.asked.filter((q) => locate(q)!.seat === 4).map((q) => locate(q)!.path);
		expect([spare.length, spare.every((p) => p.includes("eventIds=ffebea881c1d7b2dfb85b3e590c35985")), new Set(spare).size]).toEqual([2, true, 1]);
		// Nothing for the id: the slate behind it, where the league's fits, near the date and at the re-read.
		const t2 = saved(undefined, NOW);
		const nothing = scoreGameSync({ ...g, hints: [...g.hints, { seat: 4, id: "0".repeat(32) }] }, KEYS, PAYOUT, NOW, (q) => (q.url.includes("eventIds=") ? { status: 200, body: "[]" } : t2.send(q)));
		expect([nothing.decision.action, t2.misses]).toEqual(["start", []]);
		const paths = t2.asked.filter((q) => locate(q)!.seat === 4).map((q) => locate(q)!.path.includes("eventIds=") ? "by id" : "the slate");
		expect(paths).toEqual(["the slate", "the slate"]);
		// College basketball without the spare's id: the spare is silent without a request. (The saved answers
		// at this clock lack the day before the game's, so seats 1 and 2, asked for it among their dates, are
		// answered with nothing here: empty, so silent, and the run waits on seat 1 first; every seat is read
		// before it decides, and the spare's reading stands beside.)
		const iowa: ChainGame = { ...chainOf("ncaab not final: Memphis at Iowa State"), status: "unverified", start: null, startReadings: null, hints: [] };
		const t3 = saved(undefined, NOW);
		const college = scoreGameSync(iowa, KEYS, PAYOUT, NOW, (q) => (q.url.includes("2026-11-01") ? { status: 200, body: JSON.stringify(locate(q)!.seat === 1 ? { data: [], meta: {} } : { results: [] }) } : t3.send(q)));
		expect([t3.misses, t3.asked.filter((q) => locate(q)!.seat === 4)]).toEqual([[], []]);
		const spareReading = college.decision.readings.find((r) => r.seat === 4);
		expect([college.decision.action, college.decision.why, spareReading?.kind, spareReading?.detail]).toEqual(["wait", "seat 1 is silent: empty listing", "silent", "no id, and the slate is past the size"]);
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
					dispute: { at: NOW - 7 * 86_400, records: [[1, 2, 3, 4].map((seat) => ({ seat, kind: 2 as const, homeScore: 3, awayScore: 2 }))] },
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
		// The comparison covered every kind of decision, not one kind every time.
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

	test("a transport that cuts the run ends it undecided: the reader raises it through the run, no report is built", async () => {
		// The same two reads as above, the throw a cut: the caller's own count of requests used up. The
		// run that would have waited on a silent seat 2 now ends with nothing; the board's cut the same.
		const g = chainOf("nba final");
		const t = saved(undefined, NOW);
		expect(() =>
			scoreGameSync(g, KEYS, PAYOUT, NOW, (q) => {
				if (locate(q)?.seat === 2) throw new Cut("the run's 15 requests are used");
				return t.send(q);
			}),
		).toThrow(Cut);
		await expect(
			scoreGameAsync({ ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null }, KEYS, PAYOUT, NOW, async (q) => {
				if (q.url.includes("/odds/")) throw new Cut("the run's 15 requests are used");
				return saved(undefined, NOW).send(q);
			}),
		).rejects.toThrow(Cut);
	});

	test("async, after n: seats 1 and 2 answer without a final at once, the spare's final arrives last, and the run waits for it: a dispute, never a void", async () => {
		// Cleveland at Philadelphia, created without a seat 3 hint, so the spare counts; read after n
		// from the answers saved at 03:32, with seats 1 and 2 derived back to a game still on.
		const base = chainOf("nba final, read after the game");
		const g: ChainGame = { ...base, hints: [], startReadings: base.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: 0 as const } : r)) };
		const stillOn = (spareFinal: boolean): Derive => (s, p, b) => {
			if (s === 1 && p.includes("/v1/games?")) {
				const c = copy(b) as { data: Record<string, any>[] };
				for (const x of c.data) if (x.home_team?.full_name === "Philadelphia 76ers") Object.assign(x, { status: "4th Qtr", status_state: "in_progress", period: 4 });
				return c;
			}
			if (s === 2 && p.startsWith("/games?league=NBA")) {
				const c = copy(b) as { results: Record<string, any>[] };
				for (const x of c.results) if (x.gameId === 340484) x.status = "in progress";
				return c;
			}
			if (s === 4 && !spareFinal && p.includes("basketball_nba")) return (copy(b) as Record<string, any>[]).map((x) => (x.id === "110e33c79c5ec8c0377702aff685f83b" ? { ...x, completed: false } : x));
			return b;
		};
		const after = g.start! + g.n + 60;
		const go = async (spareFinal: boolean) => {
			const t = saved(stillOn(spareFinal), LATE);
			const answered: number[] = [];
			const o = await scoreGameAsync(g, KEYS, PAYOUT, after, async (q) => {
				const seat = locate(q)!.seat;
				if (seat === 4) await new Promise((r) => setTimeout(r, 25));
				answered.push(seat);
				return t.send(q);
			});
			expect(t.misses).toEqual([]);
			return { o, answered };
		};
		const { o, answered } = await go(true);
		// The spare's answer came last, and the run read it before deciding.
		expect(answered.at(-1)).toBe(4);
		expect(o.decision.readings.map((r) => [r.seat, r.kind])).toEqual([[1, "no_final"], [2, "no_final"], [3, "silent"], [4, "final"]]);
		expect([o.decision.action, o.decision.why, o.report?.kind]).toEqual(["dispute", "after n: finals beside answers without a final", 4]);
		// The control: without the spare's final, two answers that the game is still on are no void's votes
		// (a void needs two counting seats saying the game will not or did not play), and the run waits, its
		// line saying what each seat gave.
		const none = (await go(false)).o;
		expect([none.decision.action, none.report?.kind ?? null, none.decision.why.startsWith("after n: 0 counting seats say the game will not or did not play, two needed; seat 1 ")]).toEqual(["wait", null, true]);
	});
});
