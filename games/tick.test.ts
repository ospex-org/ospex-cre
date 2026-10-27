// The tick: what one cron fire does for its shard of the open games, under the platform's quotas. The
// clocks (hour 24, day 7, the hour for a disputed game), the probe at seat 3 by its hint, the full read
// on a final or a clock, one per tick, and the budgets: never more than 15 chain reads or 15 feed
// requests in one tick, whatever the open list holds.
//
// The never-line's tick half: a probe never writes, and the full read writes only what the program
// decided. The break that turns it red (tick.ts, runTick): in the probe loop, after `if (!read) continue;`,
//   ->  deps.write(encodeReport({ gameId: p.row.gameId.toString(), kind: 2, start: 0, homeScore: 1, awayScore: 0, readings: [], payout: deps.payout }));

import { describe, expect, test } from "bun:test";
import type { ChainGame, Report } from "../scoring/src/chain";
import type { Outcome } from "../scoring/src/program";
import { LATE } from "../scoring/test/cases";
import { KEY, saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import type { HttpRequest, HttpResponse } from "../scoring/src/types";
import { CLOCK_WINDOW, EXPECTED_DURATION, READS_PER_EXECUTION, REQUESTS_PER_EXECUTION, decodeReport, keysFor } from "./lib";
import { GAMES, fakeChainOf, recordingWriter } from "./test-helpers";
import { dueOf, onTheHour, runTick, sameVote, type TickDeps, type TickResult } from "./tick";

const KEYS = keysFor({ 4: KEY });
const PERIOD = 300;
const BASE = chainOf("nba final, read after the game");
const START = BASE.start!;
const DURATION = EXPECTED_DURATION.nba;
/** A moment past the start plus the league's duration, twenty minutes into an hour, so not the hour's first tick. */
const PROBING = START + DURATION + 600 - ((START + DURATION + 600) % 3_600) + 3_600 + 1_200;

function hintOf(i: number): string {
	return `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

/** A verified NBA game with a seat 3 hint, by id. */
function gameOf(id: number, over: Partial<ChainGame> = {}): ChainGame {
	return { ...BASE, id: String(id), hints: [{ seat: 3, id: hintOf(id) }], ...over };
}

type Says = "final" | "live" | "over without points";

/** A transport answering seat 3's result by hint, and nothing else: another seat's request throws, so that seat reads silent. */
function seat3Transport(says: (hint: string) => Says): { send: (req: HttpRequest) => HttpResponse; asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		send(req) {
			asked.push(req.url);
			const m = /\/results\/([0-9a-f-]+)$/.exec(req.url);
			if (m === null) throw new Error("not seat 3's result");
			const s = says(m[1]);
			const row =
				s === "final"
					? { ID: m[1], EventID: m[1], OddType: "Game", Final: true, FinalType: "Finished", HomeScore: 114, AwayScore: 106 }
					: s === "over without points"
						? { ID: m[1], EventID: m[1], OddType: "Game", Final: true, FinalType: "Finished", HomeScore: null, AwayScore: null }
						: { ID: m[1], EventID: m[1], OddType: "Game", Final: false, FinalType: "NotFinished", HomeScore: 50, AwayScore: 48 };
			return { status: 200, body: JSON.stringify([row]) };
		},
	};
}

const SCORE_REPORT = (gameId: string): Report => ({
	gameId,
	kind: 2,
	start: 0,
	homeScore: 114,
	awayScore: 106,
	readings: [
		{ seat: 1, kind: 2, homeScore: 114, awayScore: 106 },
		{ seat: 2, kind: 2, homeScore: 114, awayScore: 106 },
		{ seat: 3, kind: 2, homeScore: 114, awayScore: 106 },
		{ seat: 4, kind: 2, homeScore: 114, awayScore: 106 },
	],
	payout: PAYOUT,
});

/** A program stand-in that scores every game it is handed, recording them; it asks no feed. */
function scorer(): { score: TickDeps["score"]; handed: ChainGame[] } {
	const handed: ChainGame[] = [];
	return {
		handed,
		score: ((game: ChainGame): Outcome => {
			handed.push(game);
			return { decision: { action: "score", home: 114, away: 106, readings: [], why: "a stand-in scores" }, report: SCORE_REPORT(game.id) };
		}) as TickDeps["score"],
	};
}

function waiter(): { score: TickDeps["score"]; handed: ChainGame[] } {
	const handed: ChainGame[] = [];
	return {
		handed,
		score: ((game: ChainGame): Outcome => {
			handed.push(game);
			return { decision: { action: "wait", readings: [], why: "a stand-in waits" }, report: null };
		}) as TickDeps["score"],
	};
}

interface Fixture {
	readonly result: TickResult;
	readonly written: ReturnType<typeof recordingWriter>["written"];
	readonly asked: string[];
	readonly handed: ChainGame[];
	readonly names: string[];
}

function tick(
	games: readonly ChainGame[],
	now: number,
	o: { says?: (hint: string) => Says; program?: ReturnType<typeof scorer>; shard?: TickDeps["shard"]; readsLimit?: number; requestsLimit?: number; send?: (req: HttpRequest) => HttpResponse } = {},
): Fixture {
	const chain = fakeChainOf(games, now);
	const writer = recordingWriter();
	const t = seat3Transport(o.says ?? (() => "live"));
	const program = o.program ?? scorer();
	const result = runTick({
		evm: chain,
		games: GAMES,
		payout: PAYOUT,
		keys: KEYS,
		send: o.send ?? t.send,
		write: writer.write,
		score: program.score,
		period: PERIOD,
		shard: o.shard ?? { index: 0, count: 1 },
		readsLimit: o.readsLimit,
		requestsLimit: o.requestsLimit,
	});
	return { result, written: writer.written, asked: t.asked, handed: program.handed, names: chain.names() };
}

describe("what a game is due for", () => {
	const row = (g: ChainGame) => ({ gameId: BigInt(g.id), status: g.status, start: g.start, window: g.n, day7Clock: g.day7, disputedAt: g.dispute?.at ?? null, league: g.league, hints: g.hints });

	test("a verified game: nothing before the start plus the league's duration, the probe from it, hour 24 from the start plus n", () => {
		const g = gameOf(1);
		expect(dueOf(row(g), START + DURATION - 1, PERIOD)).toEqual({ kind: "none", why: "before the start plus the league's duration" });
		expect(dueOf(row(g), START + DURATION, PERIOD)).toEqual({ kind: "probe", seat: 3 });
		expect(dueOf(row(g), START + g.n - 1, PERIOD)).toEqual({ kind: "probe", seat: 3 });
		expect(dueOf(row(g), START + g.n, PERIOD)).toMatchObject({ kind: "clock", clock: "hour 24", fires: true, since: START + g.n });
	});

	test("the probe is seat 3 by its hint, or the spare for a game created without a usable one", () => {
		expect(dueOf(row(gameOf(1)), PROBING, PERIOD)).toEqual({ kind: "probe", seat: 3 });
		expect(dueOf(row(gameOf(1, { hints: [] })), PROBING, PERIOD)).toEqual({ kind: "probe", seat: 4 });
		expect(dueOf(row(gameOf(1, { hints: [{ seat: 3, id: "not an id" }] })), PROBING, PERIOD)).toEqual({ kind: "probe", seat: 4 });
	});

	test("a clock fires on every tick in its window, then on the hour's first tick only", () => {
		const g = gameOf(1);
		const hour24 = START + g.n;
		const offHour = (t: number) => (t % 3_600 < PERIOD ? t + PERIOD : t);
		expect(dueOf(row(g), offHour(hour24 + CLOCK_WINDOW - 1), PERIOD)).toMatchObject({ kind: "clock", fires: true });
		expect(dueOf(row(g), offHour(hour24 + CLOCK_WINDOW + 60), PERIOD)).toMatchObject({ kind: "clock", fires: false });
		const onHour = hour24 + CLOCK_WINDOW + 3_600 - ((hour24 + CLOCK_WINDOW) % 3_600) + 10;
		expect(onTheHour(onHour, PERIOD)).toBe(true);
		expect(dueOf(row(g), onHour, PERIOD)).toMatchObject({ kind: "clock", fires: true });
	});

	test("a disputed game: the probe while its seat is open, the hour's tick, and day 7 from the record", () => {
		const at = START + 7_200;
		const g = gameOf(1, { status: "disputed", dispute: { at, records: [SCORE_REPORT("1").readings] } });
		expect(dueOf(row(g), PROBING, PERIOD)).toEqual({ kind: "probe", seat: 3 });
		const onHour = PROBING - (PROBING % 3_600) + 3_600 + 10;
		expect(dueOf(row(g), onHour, PERIOD)).toMatchObject({ kind: "clock", clock: "the hour", fires: true });
		const closed = START + 5 * 86_400 + 3_600 + 1_200;
		expect(dueOf(row(g), closed, PERIOD)).toMatchObject({ kind: "none" });
		expect(dueOf(row(g), at + g.day7, PERIOD)).toMatchObject({ kind: "clock", clock: "day 7", fires: true, since: at + g.day7 });
	});

	test("nothing for a game without a written start, an ended game, or a league the table does not have", () => {
		expect(dueOf(row(gameOf(1, { status: "unverified", start: null })), PROBING, PERIOD)).toMatchObject({ kind: "none" });
		expect(dueOf(row(gameOf(1, { status: "scored" })), PROBING, PERIOD)).toMatchObject({ kind: "none" });
		expect(dueOf(row(gameOf(1, { league: "cfl" })), PROBING, PERIOD)).toEqual({ kind: "none", why: "league not offered" });
	});

	test("a vote is the same when the kind is, and for a final the points too; silence changes nothing", () => {
		const final = { seat: 3, kind: 2 as const, homeScore: 114, awayScore: 106 };
		const r = (kind: "silent" | "no_final" | "final", home: number | null, away: number | null) => ({ seat: 3 as const, kind, home, away, recorded: null, detail: "", record: null });
		expect(sameVote(final, r("final", 114, 106))).toBe(true);
		expect(sameVote(final, r("final", 106, 114))).toBe(false);
		expect(sameVote(final, r("no_final", 50, 48))).toBe(false);
		expect(sameVote({ ...final, kind: 1 }, r("no_final", 99, 1))).toBe(true);
		expect(sameVote(final, r("silent", null, null))).toBe(true);
		expect(sameVote(undefined, r("final", 114, 106))).toBe(false);
		expect(sameVote(undefined, r("silent", null, null))).toBe(true);
	});
});

describe("one tick", () => {
	test("a game not final: one probe at seat 3 by its hint, no chain read for it, nothing written", () => {
		const f = tick([gameOf(1)], PROBING);
		expect(f.result.probes).toEqual([{ gameId: "1", seat: 3, kind: "no_final", final: false, changed: null }]);
		expect(f.asked.length).toBe(1);
		expect(f.asked[0].endsWith(`/results/${hintOf(1)}`)).toBe(true);
		expect([f.result.fullRead, f.written.length, f.handed.length]).toEqual([null, 0, 0]);
		expect(f.names).toEqual(["getOpenGames"]);
		expect([f.result.reads, f.result.requests]).toEqual([2, 1]);
	});

	test("a game final at seat 3: the probe, then the full read from state, and the program's report written", () => {
		const f = tick([gameOf(1)], PROBING, { says: () => "final" });
		expect(f.result.probes[0]).toMatchObject({ seat: 3, kind: "final", final: true });
		expect(f.result.fullRead).toMatchObject({ gameId: "1", why: "final at seat 3" });
		expect(f.handed.map((g) => [g.id, g.status, g.start, g.league, g.home])).toEqual([["1", "verified", START, BASE.league, BASE.home]]);
		expect(f.handed[0].payoutRefused.reporters.length).toBeGreaterThan(0);
		expect(f.written.length).toBe(1);
		expect(decodeReport(f.written[0])).toEqual(SCORE_REPORT("1"));
		expect(f.names).toEqual(["getOpenGames", "getGameIdentity", "getGameReadings", "getGameReporters", "i_token", "getApprovedReporters", "getReporter"]);
		expect([f.result.reads, f.result.requests]).toEqual([8, 1]);
	});

	test("a feed that says the game is over without points is a final for the probe", () => {
		const f = tick([gameOf(1)], PROBING, { says: () => "over without points" });
		expect(f.result.probes[0]).toMatchObject({ kind: "silent", final: true });
		expect(f.result.fullRead).not.toBeNull();
	});

	test("the real program on a saved game: the probe's answer at seat 3 is reused by the full read, and the score is the program's", () => {
		const game = { ...chainOf("nba final, read after the game"), id: "1" };
		const chain = fakeChainOf([game], LATE);
		const writer = recordingWriter();
		const t = saved(undefined, LATE);
		const result = runTick({ evm: chain, games: GAMES, payout: PAYOUT, keys: KEYS, send: t.send, write: writer.write, period: PERIOD, shard: { index: 0, count: 1 } });
		expect(result.probes[0]).toMatchObject({ seat: 3, final: true });
		expect(result.fullRead?.run.decision.action).toBe("score");
		expect(writer.written.length).toBe(1);
		expect(decodeReport(writer.written[0])).toMatchObject({ kind: 2, homeScore: 114, awayScore: 106, payout: PAYOUT });
		// The scoring run asks 8 requests on this case, seat 3's among them; the probe asked it first, so the tick asks 8, not 9.
		expect(result.requests).toBe(8);
		expect(t.asked.length).toBe(8);
		expect(t.asked.filter((r) => r.url.includes("/results/")).length).toBe(1);
	});

	test("only one full read per tick; the other finals wait, and the next tick begins from another game", () => {
		const games = [1, 2, 3].map((i) => gameOf(i, { start: START + i }));
		const first = tick(games, PROBING, { says: () => "final" });
		const read = first.result.fullRead?.gameId;
		expect(["1", "2", "3"]).toContain(read);
		expect([...first.result.waiting].sort()).toEqual(["1", "2", "3"].filter((id) => id !== read).map((id) => `${id}: final at seat 3, the full read waits for the next tick`));
		expect(first.written.length).toBe(1);
		const next = tick(games, PROBING + PERIOD, { says: () => "final" });
		expect(["1", "2", "3"]).toContain(next.result.fullRead?.gameId);
		expect(next.result.fullRead?.gameId).not.toBe(read);
	});

	test("the budgets hold whatever the list holds: never past 15 reads or 15 requests, one full read, the rest waiting", () => {
		for (const count of [0, 1, 5, 14, 15, 16, 40, 130]) {
			for (const says of ["live", "final"] as const) {
				const games = Array.from({ length: count }, (_, i) => gameOf(i + 1, { start: START + i }));
				const f = tick(games, PROBING, { says: () => says });
				expect({ count, says, under: f.result.reads <= READS_PER_EXECUTION && f.result.requests <= REQUESTS_PER_EXECUTION }).toEqual({ count, says, under: true });
				expect(f.result.open).toBe(count);
				expect(f.written.length).toBe(says === "final" && count > 0 ? 1 : 0);
				expect(f.result.probes.length + f.result.waiting.filter((w) => w.includes("probe")).length).toBe(count);
				if (says === "final" && count > 1) expect(f.result.waiting.filter((w) => w.includes("waits for the next tick")).length).toBe(Math.min(count, REQUESTS_PER_EXECUTION) - 1);
			}
		}
	});

	test("the cost of a tick does not grow with the games that have ended", () => {
		const open = [1, 2, 3].map((i) => gameOf(i));
		const ended = Array.from({ length: 1_000 }, (_, i) => gameOf(100 + i, { status: "scored" }));
		const small = tick(open, PROBING);
		const large = tick([...open, ...ended], PROBING);
		expect([large.result.reads, large.result.requests, large.names]).toEqual([small.result.reads, small.result.requests, small.names]);
		expect(large.result.open).toBe(3);
	});

	test("hour 24: the full read runs on the clock, without a probe", () => {
		const g = gameOf(1);
		const f = tick([g], START + g.n + 10);
		expect([f.result.probes.length, f.result.fullRead?.why, f.written.length]).toEqual([0, "hour 24", 1]);
		expect(f.asked).toEqual([]);
	});

	test("day 7: the full read runs first and needs no request; a disputed game before it is probed for a change", () => {
		const at = START + 7_200;
		const votes = SCORE_REPORT("1").readings.map((r) => (r.seat === 4 ? { ...r, homeScore: 106, awayScore: 114 } : r));
		const disputed = gameOf(1, { status: "disputed", dispute: { at, records: [votes] } });
		const day7 = tick([disputed], at + disputed.day7 + 10 + (3_600 - ((at + disputed.day7 + 10) % 3_600) + 1_200), { requestsLimit: 0 });
		expect([day7.result.probes.length, day7.result.fullRead?.why, day7.written.length]).toEqual([0, "day 7", 1]);

		const same = tick([disputed], PROBING, { says: () => "final" });
		expect(same.result.probes[0]).toMatchObject({ seat: 3, final: true, changed: false });
		expect(same.result.fullRead).toBeNull();
		expect(same.names).toEqual(["getOpenGames", "getGameReadings"]);

		const changed = tick([disputed], PROBING, { says: () => "live" });
		expect(changed.result.probes[0]).toMatchObject({ kind: "no_final", changed: true });
		expect(changed.result.fullRead?.why).toBe("a change at seat 3");
	});

	test("a disputed game is read in full on the hour's first tick, whatever the probe would say", () => {
		const at = START + 7_200;
		const disputed = gameOf(1, { status: "disputed", dispute: { at, records: [SCORE_REPORT("1").readings] } });
		const onHour = PROBING - (PROBING % 3_600) + 3_600 + 10;
		const f = tick([disputed], onHour);
		expect([f.result.probes.length, f.result.fullRead?.why]).toEqual([0, "the hour"]);
	});

	test("the shards split the games by id, and a game in another shard is never probed", () => {
		const games = [1, 2, 3, 4, 5, 6].map((i) => gameOf(i));
		const a = tick(games, PROBING, { shard: { index: 0, count: 3 }, says: () => "final" });
		const b = tick(games, PROBING, { shard: { index: 1, count: 3 }, says: () => "final" });
		expect(a.result.mine).toBe(2);
		expect(a.result.probes.map((p) => p.gameId).concat(a.result.waiting.map((w) => w.split(":")[0]))).toEqual(expect.arrayContaining(["3", "6"]));
		expect(b.result.probes.map((p) => p.gameId).concat(b.result.waiting.map((w) => w.split(":")[0]))).toEqual(expect.arrayContaining(["1", "4"]));
		expect(a.asked.every((u) => u.includes(hintOf(3)) || u.includes(hintOf(6)))).toBe(true);
	});

	test("a game created without a usable hint is probed at the spare, which costs its identity: one read", () => {
		const game = gameOf(1, { hints: [] });
		const seat4 = (req: HttpRequest): HttpResponse => {
			if (!req.url.includes("/scores/")) throw new Error("not the spare");
			return {
				status: 200,
				body: JSON.stringify([{ id: "x", commence_time: new Date(START * 1000).toISOString(), completed: true, home_team: BASE.home, away_team: BASE.away, scores: [{ name: BASE.home, score: "114" }, { name: BASE.away, score: "106" }] }]),
			};
		};
		const f = tick([game], PROBING, { send: seat4 });
		expect(f.result.probes[0]).toMatchObject({ seat: 4, final: true });
		expect(f.names.slice(0, 2)).toEqual(["getOpenGames", "getGameIdentity"]);
		expect(f.result.fullRead).not.toBeNull();
	});

	test("never: a probe writes nothing, and a full read the program waits on writes nothing", () => {
		const games = [1, 2, 3].map((i) => gameOf(i));
		const f = tick(games, PROBING, { says: () => "final", program: waiter() });
		expect(f.result.fullRead?.run.decision.action).toBe("wait");
		expect(f.written.length).toBe(0);
		expect(f.handed.length).toBe(1);
	});

	test("the tick's clock is the chain's", () => {
		const f = tick([gameOf(1)], PROBING);
		expect(f.result.now).toBe(PROBING);
	});
});
