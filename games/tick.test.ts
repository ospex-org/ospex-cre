// The tick: what one cron fire does for its shard of the open list, under the platform's quotas. The
// clocks (hour 24, day 7, the hour for a disputed game), the probe at seat 3 by its hint after the
// game's identity is read, the full read on a final or a clock, one per tick, the verification on the
// hour's first tick, and the budgets: never more than 15 chain reads or 15 feed requests in one tick,
// whatever the open list holds.
//
// The never-line's tick half: a probe never writes, and the full read writes only what the program
// decided. The break that turns it red (tick.ts, runTick): in the probe loop, after `if (!read) continue;`,
// any bytes written from there,
//   ->  deps.write("0x" + "00".repeat(64));
// Two more that redden it: the verification's `&& d.due.fires` dropped (verified on every tick), and
// `hourly` keyed to tick 0 (the hour's reads on the verification's tick). And the probe's seat taken
// from the hint alone (lib.ts, probeSeatFor: `"none" in hintOf(game.hints) ? SPARE : 3`): the probe asks
// a seat the start report excluded. And in dueOf a cutoff two days past the date for an unverified
// game (`if (now > row.date + VERIFY_NEAR) return none(...)`): a game the feeds list late is skipped for good.

import { describe, expect, test } from "bun:test";
import type { ChainGame, Report } from "../scoring/src/chain";
import type { Outcome } from "../scoring/src/program";
import { LATE, NOW } from "../scoring/test/cases";
import { KEY, saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import type { HttpRequest, HttpResponse } from "../scoring/src/types";
import type { OpenGame } from "./chain";
import { CLOCK_WINDOW, EXPECTED_DURATION, HOURLY_TICK, READS_PER_EXECUTION, REQUESTS_PER_EXECUTION, VERIFY_BEFORE, VERIFY_NEAR, decodeReport, keysFor } from "./lib";
import { GAMES, fakeChainOf, recordingWriter } from "./test-helpers";
import { dueOf, onTheHour, pageTurnsOf, runTick, sameVote, tickOfHour, type TickDeps, type TickResult } from "./tick";

const KEYS = keysFor({ 4: KEY });
const PERIOD = 300;
const BASE = chainOf("nba final, read after the game");
const START = BASE.start!;
const DURATION = EXPECTED_DURATION.nba;
/** The hour mark after a moment, and the hour's first, second and a later tick from it. */
const hourAfter = (t: number): number => t - (t % 3_600) + 3_600;
const firstTick = (t: number): number => hourAfter(t) + 10;
const secondTick = (t: number): number => hourAfter(t) + PERIOD + 10;
const laterTick = (t: number): number => hourAfter(t) + 4 * PERIOD + 10;
/** A moment past the start plus the league's duration, twenty minutes into an hour: neither the hour's first tick nor its second. */
const PROBING = laterTick(START + DURATION + 600);
/** The hour's first tick after the saved cases' first clock, where a verification runs on the saved answers. */
const VERIFY_AT = firstTick(NOW);

function hintOf(i: number): string {
	return `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

/** A verified NBA game with a seat 3 hint, by id. */
function gameOf(id: number, over: Partial<ChainGame> = {}): ChainGame {
	return { ...BASE, id: String(id), hints: [{ seat: 3, id: hintOf(id) }], ...over };
}

const NFL = chainOf("nfl not final");

/** A game the creation trigger's run left unverified, with the saved answers' NFL game's identity. */
function unverifiedOf(id: number, over: Partial<ChainGame> = {}): ChainGame {
	return { ...NFL, id: String(id), status: "unverified", start: null, startReadings: null, dispute: null, ...over };
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
	o: {
		says?: (hint: string) => Says;
		/** A stand-in program; "real" runs the scoring program. The stand-in that scores, by default. */
		program?: ReturnType<typeof scorer> | "real";
		shard?: TickDeps["shard"];
		readsLimit?: number;
		requestsLimit?: number;
		pageSize?: number;
		send?: (req: HttpRequest) => HttpResponse;
	} = {},
): Fixture {
	const chain = fakeChainOf(games, now);
	const writer = recordingWriter();
	const t = seat3Transport(o.says ?? (() => "live"));
	const program = o.program === "real" ? null : (o.program ?? scorer());
	const result = runTick({
		evm: chain,
		games: GAMES,
		payout: PAYOUT,
		keys: KEYS,
		send: o.send ?? t.send,
		write: writer.write,
		score: program?.score,
		period: PERIOD,
		shard: o.shard ?? { index: 0, count: 1 },
		readsLimit: o.readsLimit,
		requestsLimit: o.requestsLimit,
		pageSize: o.pageSize,
	});
	return { result, written: writer.written, asked: t.asked, handed: program?.handed ?? [], names: chain.names() };
}

const row = (g: ChainGame): OpenGame => ({ gameId: BigInt(g.id), status: g.status, start: g.start, window: g.n, day7Clock: g.day7, disputedAt: g.dispute?.at ?? null, league: g.league, date: g.date });

describe("what a game is due for", () => {
	test("a verified game: nothing before the start plus the league's duration, the probe from it, hour 24 from the start plus n", () => {
		const g = gameOf(1);
		expect(dueOf(row(g), START + DURATION - 1, PERIOD)).toEqual({ kind: "none", why: "before the start plus the league's duration" });
		expect(dueOf(row(g), START + DURATION, PERIOD)).toEqual({ kind: "probe" });
		expect(dueOf(row(g), START + g.n - 1, PERIOD)).toEqual({ kind: "probe" });
		expect(dueOf(row(g), START + g.n, PERIOD)).toMatchObject({ kind: "clock", clock: "hour 24", fires: true, since: START + g.n });
	});

	test("the hour's ticks: the first is the verification's, the second the hour's reads'", () => {
		expect([tickOfHour(firstTick(START), PERIOD), tickOfHour(secondTick(START), PERIOD), tickOfHour(laterTick(START), PERIOD)]).toEqual([0, 1, 4]);
		expect([onTheHour(firstTick(START), PERIOD), onTheHour(secondTick(START), PERIOD)]).toEqual([true, false]);
		expect(HOURLY_TICK).toBe(1);
	});

	test("the pages' turns: the tick's count every tick, and the hour's count too on the hour's first two ticks", () => {
		const hour = Math.floor(firstTick(START) / 3_600);
		expect(pageTurnsOf(firstTick(START), PERIOD)).toEqual([hour, hour * 12]);
		expect(pageTurnsOf(secondTick(START), PERIOD)).toEqual([hour, hour * 12 + 1]);
		expect(pageTurnsOf(laterTick(START), PERIOD)).toEqual([hour * 12 + 4]);
		expect(pageTurnsOf(hourAfter(START) + 11 * PERIOD + 10, PERIOD)).toEqual([hour * 12 + 11]);
	});

	test("a clock fires on every tick in its window, then on the hour's second tick only", () => {
		const g = gameOf(1);
		const hour24 = START + g.n;
		expect(dueOf(row(g), laterTick(hour24 + CLOCK_WINDOW - 2 * 3_600), PERIOD)).toMatchObject({ kind: "clock", fires: true });
		expect(dueOf(row(g), laterTick(hour24 + CLOCK_WINDOW), PERIOD)).toMatchObject({ kind: "clock", fires: false });
		expect(dueOf(row(g), firstTick(hour24 + CLOCK_WINDOW), PERIOD)).toMatchObject({ kind: "clock", fires: false });
		expect(dueOf(row(g), secondTick(hour24 + CLOCK_WINDOW), PERIOD)).toMatchObject({ kind: "clock", clock: "hour 24", fires: true });
	});

	test("a disputed game: the probe while seat 3 is open, the hour's second tick, and day 7 from the record", () => {
		const at = START + 7_200;
		const g = gameOf(1, { status: "disputed", dispute: { at, records: [SCORE_REPORT("1").readings] } });
		expect(dueOf(row(g), PROBING, PERIOD)).toEqual({ kind: "probe" });
		expect(dueOf(row(g), firstTick(PROBING), PERIOD)).toEqual({ kind: "probe" });
		expect(dueOf(row(g), secondTick(PROBING), PERIOD)).toMatchObject({ kind: "clock", clock: "the hour", fires: true });
		const closed = laterTick(START + 5 * 86_400);
		expect(dueOf(row(g), closed, PERIOD)).toMatchObject({ kind: "none" });
		expect(dueOf(row(g), at + g.day7, PERIOD)).toMatchObject({ kind: "clock", clock: "day 7", fires: true, since: at + g.day7 });
	});

	test("an unverified game: a verification from seven days before its date until it leaves the list, firing on the hour's first tick", () => {
		const g = unverifiedOf(1);
		const opens = g.date - VERIFY_BEFORE;
		expect(dueOf(row(g), opens - 1, PERIOD)).toEqual({ kind: "none", why: "before seven days to its date" });
		expect(dueOf(row(g), firstTick(opens), PERIOD)).toEqual({ kind: "verify", fires: true });
		expect(dueOf(row(g), secondTick(opens), PERIOD)).toEqual({ kind: "verify", fires: false });
		expect(dueOf(row(g), laterTick(g.date + 86_400), PERIOD)).toEqual({ kind: "verify", fires: false });
		// No later cutoff: two days past its date, and thirty, it is still due on the hour's first tick.
		expect(dueOf(row(g), firstTick(g.date + VERIFY_NEAR + 3_600), PERIOD)).toEqual({ kind: "verify", fires: true });
		expect(dueOf(row(g), firstTick(g.date + 30 * 86_400), PERIOD)).toEqual({ kind: "verify", fires: true });
	});

	test("nothing for an ended game, or a league the table does not have", () => {
		expect(dueOf(row(gameOf(1, { status: "scored" })), PROBING, PERIOD)).toMatchObject({ kind: "none" });
		expect(dueOf(row(gameOf(1, { league: "cfl" })), PROBING, PERIOD)).toEqual({ kind: "none", why: "league not offered" });
		expect(dueOf(row(unverifiedOf(1, { league: "cfl" })), VERIFY_AT, PERIOD)).toEqual({ kind: "none", why: "league not offered" });
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
	test("a game not final: its identity and its readings read, one probe at seat 3 by its hint, nothing written", () => {
		const f = tick([gameOf(1)], PROBING);
		expect(f.result.probes).toEqual([{ gameId: "1", seat: 3, kind: "no_final", final: false, changed: null }]);
		expect(f.asked.length).toBe(1);
		expect(f.asked[0].endsWith(`/results/${hintOf(1)}`)).toBe(true);
		expect([f.result.fullRead, f.written.length, f.handed.length]).toEqual([null, 0, 0]);
		expect(f.names).toEqual(["getOpenGames", "getGameIdentity", "getGameReadings"]);
		expect([f.result.reads, f.result.requests, f.result.pages]).toEqual([4, 1, { own: 1, read: 1 }]);
	});

	test("the probe's seat follows the start report: a hint the start marked silent is not probed, the spare is; a hint the start shows readable is", () => {
		const seat4 = (req: HttpRequest): HttpResponse => {
			if (!req.url.includes("/scores/")) throw new Error("not the spare");
			return {
				status: 200,
				body: JSON.stringify([{ id: "x", commence_time: new Date(START * 1000).toISOString(), completed: false, home_team: BASE.home, away_team: BASE.away, scores: null }]),
			};
		};
		// A usable hint, and a start report that marked seat 3 silent for the game: the board check failed at verification.
		const down = gameOf(1, { startReadings: BASE.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: 0 } : r)) });
		const f = tick([down], PROBING, { send: seat4 });
		expect(f.result.probes).toEqual([{ gameId: "1", seat: 4, kind: "no_final", final: false, changed: null }]);
		expect(f.names).toEqual(["getOpenGames", "getGameIdentity", "getGameReadings"]);
		// The same hint with the start report showing seat 3 readable: seat 3 is the probe.
		const up = tick([gameOf(1)], PROBING);
		expect(up.result.probes[0]?.seat).toBe(3);
		expect(up.asked[0].endsWith(`/results/${hintOf(1)}`)).toBe(true);
		// The real program on the saved game with seat 3 marked silent at the start: the spare's final is the
		// probe, the full read scores on seats 1, 2 and the spare, and seat 3 is never asked.
		const game = { ...chainOf("nba final, read after the game"), id: "1", startReadings: down.startReadings };
		const t = saved(undefined, LATE);
		const real = runTick({ evm: fakeChainOf([game], LATE), games: GAMES, payout: PAYOUT, keys: KEYS, send: t.send, write: recordingWriter().write, period: PERIOD, shard: { index: 0, count: 1 } });
		expect(real.probes[0]).toMatchObject({ seat: 4, final: true });
		expect([real.fullRead?.why, real.fullRead?.run?.decision.action]).toEqual(["final at seat 4", "score"]);
		expect(real.fullRead?.run?.report?.readings.map((r) => [r.seat, r.kind])).toEqual([[1, 2], [2, 2], [3, 0], [4, 2]]);
		expect(t.asked.some((r) => r.url.includes("/results/"))).toBe(false);
	});

	test("a game final at seat 3: the probe, then the full read from state with the identity in hand, and the program's report written", () => {
		const f = tick([gameOf(1)], PROBING, { says: () => "final" });
		expect(f.result.probes[0]).toMatchObject({ seat: 3, kind: "final", final: true });
		expect(f.result.fullRead).toMatchObject({ gameId: "1", why: "final at seat 3", error: null });
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
		expect(result.fullRead?.run?.decision.action).toBe("score");
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
		expect([...first.result.waiting].sort()).toEqual(["1", "2", "3"].filter((id) => id !== read).map((id) => `${id}: final at seat 3 waits: one full read a tick`));
		expect(first.written.length).toBe(1);
		const next = tick(games, PROBING + PERIOD, { says: () => "final" });
		expect(["1", "2", "3"]).toContain(next.result.fullRead?.gameId);
		expect(next.result.fullRead?.gameId).not.toBe(read);
	});

	test("the budgets on open lists of 0, 1, 5, 14, 15, 16, 40 and 130 games, all final or none: never past 15 reads or 15 requests, one full read, the rest waiting", () => {
		for (const count of [0, 1, 5, 14, 15, 16, 40, 130]) {
			for (const says of ["live", "final"] as const) {
				const games = Array.from({ length: count }, (_, i) => gameOf(i + 1, { start: START + i }));
				const f = tick(games, PROBING, { says: () => says });
				expect({ count, says, under: f.result.reads <= READS_PER_EXECUTION && f.result.requests <= REQUESTS_PER_EXECUTION }).toEqual({ count, says, under: true });
				// The list's total, and the two pages of 64 a tick reads at most.
				expect([f.result.open, f.result.mine]).toEqual([count, Math.min(count, 128)]);
				expect(f.written.length).toBe(says === "final" && count > 0 ? 1 : 0);
				expect(f.result.probes.length + f.result.waiting.filter((w) => w.endsWith("for its probe")).length).toBe(f.result.mine);
				if (says === "final" && count > 1) expect(f.result.waiting.filter((w) => w.endsWith("waits: one full read a tick")).length).toBe(f.result.probes.length - 1);
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
		expect(f.result.reads).toBe(8);
	});

	test("day 7: the full read runs first and needs no request; a disputed game before it is probed for a change", () => {
		const at = START + 7_200;
		const votes = SCORE_REPORT("1").readings.map((r) => (r.seat === 4 ? { ...r, homeScore: 106, awayScore: 114 } : r));
		const disputed = gameOf(1, { status: "disputed", dispute: { at, records: [votes] } });
		const day7 = tick([disputed], laterTick(at + disputed.day7), { requestsLimit: 0 });
		expect([day7.result.probes.length, day7.result.fullRead?.why, day7.written.length]).toEqual([0, "day 7", 1]);

		const same = tick([disputed], PROBING, { says: () => "final" });
		expect(same.result.probes[0]).toMatchObject({ seat: 3, final: true, changed: false });
		expect(same.result.fullRead).toBeNull();
		expect(same.names).toEqual(["getOpenGames", "getGameIdentity", "getGameReadings"]);

		const changed = tick([disputed], PROBING, { says: () => "live" });
		expect(changed.result.probes[0]).toMatchObject({ kind: "no_final", changed: true });
		expect(changed.result.fullRead?.why).toBe("a change at seat 3");
		// The probe's identity and votes serve the full read: reporters and the three refusals follow.
		expect(changed.names).toEqual(["getOpenGames", "getGameIdentity", "getGameReadings", "getGameReporters", "i_token", "getApprovedReporters", "getReporter"]);
	});

	test("a waiting or failing head does not keep the hour's read: the clocks take turns, two games with one that waits every time", () => {
		// Two verified games past their clock's window, read on the hour's second tick; the program waits
		// on game 1 every time (a feed outage) and scores game 2. Over two hours each has its turn, and the
		// later game's score is written.
		const games = [1, 2].map((i) => gameOf(i, { start: START - 3 * 86_400 + i }));
		const picky = (): { score: TickDeps["score"]; handed: string[] } => {
			const handed: string[] = [];
			return {
				handed,
				score: ((game: ChainGame): Outcome => {
					handed.push(game.id);
					return game.id === "1" ? { decision: { action: "wait", readings: [], why: "a stand-in waits" }, report: null } : { decision: { action: "score", home: 114, away: 106, readings: [], why: "a stand-in scores" }, report: SCORE_REPORT(game.id) };
				}) as TickDeps["score"],
			};
		};
		const hours = [0, 1].map((h) => tick(games, secondTick(START) + h * 3_600, { program: picky() }));
		expect(hours.map((f) => f.result.fullRead?.why)).toEqual(["hour 24", "hour 24"]);
		expect(hours.map((f) => f.handed).flat().sort()).toEqual(["1", "2"]);
		expect(hours.map((f) => f.written.length).reduce((a, b) => a + b, 0)).toBe(1);
		expect(hours.map((f) => f.result.waiting)).toEqual(hours.map((f) => [`${f.handed[0] === "1" ? 2 : 1}: hour 24 waits: one full read a tick`]));
		// A head whose write fails is passed the same way: the write refused for game 1, game 2 scored the next hour.
		const failing = [0, 1].map((h) => {
			const chain = fakeChainOf(games, secondTick(START) + h * 3_600);
			const writer = recordingWriter();
			const r = runTick({ evm: chain, games: GAMES, payout: PAYOUT, keys: KEYS, send: () => ({ status: 200, body: "[]" }), write: (b) => (decodeReport(b).gameId === "1" ? (() => { throw new Error("writeReport failed: status=2"); })() : writer.write(b)), score: scorer().score, period: PERIOD, shard: { index: 0, count: 1 } });
			return { r, written: writer.written.length };
		});
		expect(failing.map((f) => f.r.fullRead?.gameId).sort()).toEqual(["1", "2"]);
		expect(failing.map((f) => [f.r.fullRead?.error === null, f.written]).sort()).toEqual([[false, 0], [true, 1]]);
		// And the clocks in their two-hour window, on consecutive ticks: both games are read within two ticks.
		const inWindow = [1, 2].map((i) => gameOf(i, { start: START + i }));
		const ticks = [0, 1].map((k) => tick(inWindow, laterTick(START + inWindow[1].n) + k * PERIOD, { program: picky() }));
		expect(ticks.map((f) => f.handed).flat().sort()).toEqual(["1", "2"]);
	});

	test("a disputed game is read in full on the hour's second tick, whatever the probe would say, and probed on the first", () => {
		const at = START + 7_200;
		const disputed = gameOf(1, { status: "disputed", dispute: { at, records: [SCORE_REPORT("1").readings] } });
		const second = tick([disputed], secondTick(PROBING));
		expect([second.result.probes.length, second.result.fullRead?.why]).toEqual([0, "the hour"]);
		// On the first tick it is probed as on any other: the vote on record is a final, and the seat still says so.
		const first = tick([disputed], firstTick(PROBING), { says: () => "final" });
		expect([first.result.probes.length, first.result.probes[0]?.changed, first.result.fullRead]).toEqual([1, false, null]);
	});

	test("the shards split the open list by page, and a game on another shard's page is never probed", () => {
		// Pages of 2 and seven games: four pages; shard 0 of 3 owns pages 0 and 3, shard 1 page 1, shard 2 page 2.
		const games = [1, 2, 3, 4, 5, 6, 7].map((i) => gameOf(i));
		const probed = (f: Fixture) => [...new Set(f.result.probes.map((p) => p.gameId).concat(f.result.waiting.map((w) => w.split(":")[0])))].sort();
		const a = tick(games, PROBING, { shard: { index: 0, count: 3 }, pageSize: 2, says: () => "final" });
		const b = tick(games, PROBING, { shard: { index: 1, count: 3 }, pageSize: 2, says: () => "final" });
		const c = tick(games, PROBING, { shard: { index: 2, count: 3 }, pageSize: 2, says: () => "final" });
		expect([a.result.mine, b.result.mine, c.result.mine]).toEqual([3, 2, 2]);
		expect([a.result.pages, b.result.pages, c.result.pages]).toEqual([{ own: 2, read: 2 }, { own: 1, read: 1 }, { own: 1, read: 1 }]);
		expect([probed(a), probed(b), probed(c)]).toEqual([["1", "2", "7"], ["3", "4"], ["5", "6"]]);
		expect(a.asked.every((u) => u.includes(hintOf(1)) || u.includes(hintOf(2)) || u.includes(hintOf(7)))).toBe(true);
		expect(b.asked.every((u) => u.includes(hintOf(3)) || u.includes(hintOf(4)))).toBe(true);
		expect([a.result.open, b.result.open, c.result.open]).toEqual([7, 7, 7]);
	});

	test("a game created without a usable hint is probed at the spare, from the identity the probe read", () => {
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
		// The spare closes before seat 3 does: a disputed game past its window is not probed at the spare, and the identity read says so.
		const at = START + 7_200;
		const disputed = gameOf(1, { hints: [], status: "disputed", dispute: { at, records: [SCORE_REPORT("1").readings] } });
		const closed = tick([disputed], laterTick(START + 67 * 3_600), { send: seat4 });
		expect([closed.result.probes.length, closed.names, closed.result.lines]).toEqual([0, ["getOpenGames", "getGameIdentity", "getGameReadings"], ["game 1: seat 4 is closed, not probed"]]);
	});

	test("never: a probe writes nothing, and a full read the program waits on writes nothing, a verification included", () => {
		const games = [1, 2, 3].map((i) => gameOf(i));
		const f = tick(games, PROBING, { says: () => "final", program: waiter() });
		expect(f.result.fullRead?.run?.decision.action).toBe("wait");
		expect(f.written.length).toBe(0);
		expect(f.handed.length).toBe(1);
		const v = tick([unverifiedOf(1)], VERIFY_AT, { program: waiter() });
		expect([v.result.fullRead?.why, v.result.fullRead?.run?.decision.action, v.written.length, v.handed.length]).toEqual(["verification", "wait", 0, 1]);
	});

	test("the tick's clock is the chain's", () => {
		const f = tick([gameOf(1)], PROBING);
		expect(f.result.now).toBe(PROBING);
	});
});

describe("the verification on the hour's first tick", () => {
	test("the real program on the saved answers: an unverified game within seven days of its date is verified as the tick's one full read, and the start is written", () => {
		const game = unverifiedOf(1);
		// The fixture's game is in the window at the tick, and the tick is the hour's first.
		expect([VERIFY_AT >= game.date - VERIFY_BEFORE, VERIFY_AT <= game.date + VERIFY_NEAR, tickOfHour(VERIFY_AT, PERIOD)]).toEqual([true, true, 0]);
		const t = saved(undefined, VERIFY_AT);
		const f = tick([game], VERIFY_AT, { program: "real", send: t.send });
		expect(f.result.fullRead).toMatchObject({ gameId: "1", why: "verification", error: null });
		expect(f.result.fullRead?.run?.decision.action).toBe("start");
		expect(f.written.length).toBe(1);
		expect(decodeReport(f.written[0])).toMatchObject({ gameId: "1", kind: 1, start: NFL.start });
		expect(f.names).toEqual(["getOpenGames", "getGameIdentity", "getGameReporters", "i_token", "getApprovedReporters", "getReporter"]);
		// A start asks 18 and sends 11 distinct: the tick's count is the sent ones, under the 15.
		expect([f.result.reads, f.result.requests, t.asked.length]).toEqual([7, 11, 11]);
		expect(f.result.probes).toEqual([]);
	});

	test("on another tick of the hour nothing is verified; before seven days to the date nothing either; thirty days past it, still its turn", () => {
		const game = unverifiedOf(1);
		for (const now of [secondTick(NOW), laterTick(NOW)]) {
			const f = tick([game], now, { program: waiter() });
			expect([f.result.fullRead, f.handed.length, f.result.waiting]).toEqual([null, 0, []]);
		}
		const early = tick([unverifiedOf(1, { date: VERIFY_AT + VERIFY_BEFORE + 3_600 })], VERIFY_AT, { program: waiter() });
		expect([early.result.fullRead, early.handed.length]).toEqual([null, 0]);
		const late = tick([unverifiedOf(1, { date: VERIFY_AT - 30 * 86_400 })], VERIFY_AT, { program: waiter() });
		expect([late.result.fullRead?.why, late.handed.length]).toEqual(["verification", 1]);
	});

	test("the nearer games take the turns, nearest date first: a game more than two days past its date is verified only when no nearer game is due", () => {
		const nearer = [unverifiedOf(1, { date: VERIFY_AT + 2 * 86_400 }), unverifiedOf(2, { date: VERIFY_AT + 86_400 })];
		const far = [unverifiedOf(3, { date: VERIFY_AT - 5 * 86_400 }), unverifiedOf(4, { date: VERIFY_AT - 9 * 86_400 })];
		const handed: string[] = [];
		for (let hour = 0; hour < 4; hour++) {
			const f = tick([...nearer, ...far], VERIFY_AT + hour * 3_600, { program: waiter() });
			handed.push(f.handed[0].id);
			expect(f.result.waiting.filter((w) => w.startsWith("3:") || w.startsWith("4:"))).toEqual(["3: verification waits for its hour's turn", "4: verification waits for its hour's turn"]);
		}
		// Four hours, the two nearer games in turn, the nearest (game 2, a day out) on the hours whose count is even.
		expect([...new Set(handed)].sort()).toEqual(["1", "2"]);
		expect(handed.filter((id, i) => (Math.floor(VERIFY_AT / 3_600) + i) % 2 === 0)).toEqual(["2", "2"]);
		// With no nearer game due, the far ones take turns, nearest first.
		const alone: string[] = [];
		for (let hour = 0; hour < 2; hour++) alone.push(tick(far, VERIFY_AT + hour * 3_600, { program: waiter() }).handed[0].id);
		expect([...alone].sort()).toEqual(["3", "4"]);
	});

	test("one verification an hour, the game whose turn it is; the others wait for theirs, and over the hours each has its turn", () => {
		const games = [1, 2, 3].map((i) => unverifiedOf(i));
		const handed: string[] = [];
		for (let hour = 0; hour < 3; hour++) {
			const f = tick(games, VERIFY_AT + hour * 3_600, { program: waiter() });
			expect(f.handed.length).toBe(1);
			handed.push(f.handed[0].id);
			expect([...f.result.waiting].sort()).toEqual(["1", "2", "3"].filter((id) => id !== f.handed[0].id).map((id) => `${id}: verification waits for its hour's turn`));
		}
		expect([...handed].sort()).toEqual(["1", "2", "3"]);
	});

	test("the verification comes first, with the whole count of requests; a clock in its window waits a tick, and the probes after it have what is left", () => {
		const at = START + 7_200;
		const disputed = gameOf(8, { status: "disputed", dispute: { at, records: [SCORE_REPORT("8").readings] } });
		const day7 = firstTick(at + disputed.day7);
		const inWindow = unverifiedOf(9, { date: day7 + 86_400 });
		expect(dueOf(row(inWindow), day7, PERIOD)).toEqual({ kind: "verify", fires: true });
		const atDay7 = tick([inWindow, disputed], day7, { program: waiter() });
		expect([atDay7.result.fullRead?.why, atDay7.result.waiting]).toEqual(["verification", ["8: day 7 waits: one full read a tick"]]);
		expect(tick([inWindow, disputed], day7 + PERIOD, { program: waiter() }).result.fullRead?.why).toBe("day 7");
		const unverified = unverifiedOf(9);
		// Six verified games final at seat 3 beside the unverified one: the real verification sends 11, four probes follow, the rest wait.
		const t = saved(undefined, VERIFY_AT);
		const s3 = seat3Transport(() => "final");
		const send = (req: HttpRequest): HttpResponse => (/\/results\/0000000[1-6]-/.test(req.url) ? s3.send(req) : t.send(req));
		const finals = [1, 2, 3, 4, 5, 6].map((i) => gameOf(i, { start: VERIFY_AT - DURATION - 600 - i }));
		const f = tick([unverified, ...finals], VERIFY_AT, { program: "real", send });
		expect([f.result.fullRead?.why, f.result.fullRead?.run?.decision.action, f.written.length]).toEqual(["verification", "start", 1]);
		expect([f.result.requests, f.result.probes.length, f.result.probes.every((p) => p.final)]).toEqual([15, 4, true]);
		expect(f.result.waiting.filter((w) => w.endsWith("waits: one full read a tick")).length).toBe(4);
		expect(f.result.waiting.filter((w) => w.endsWith("no request left for its probe")).length).toBe(2);
		expect(f.result.reads).toBeLessThanOrEqual(READS_PER_EXECUTION);
	});

	test("a full read starts only when its league's worst case of requests fits the count; otherwise it waits, with nothing of it sent", () => {
		// A verification needs 13 for this league (budget.test.ts): under a count of 5 it is not started.
		const t = saved(undefined, VERIFY_AT);
		const f = tick([unverifiedOf(1)], VERIFY_AT, { program: "real", send: t.send, requestsLimit: 5 });
		expect([f.result.fullRead, f.result.waiting, f.written.length, f.result.requests, t.asked.length]).toEqual([null, ["1: verification waits: needs 13 requests, 5 left"], 0, 0, 0]);
		// Under a count of 13 it is: 11 sent on the saved answers, the start written.
		const t13 = saved(undefined, VERIFY_AT);
		const ok = tick([unverifiedOf(1)], VERIFY_AT, { program: "real", send: t13.send, requestsLimit: 13 });
		expect([ok.result.fullRead?.why, ok.result.fullRead?.run?.decision.action, ok.written.length, ok.result.requests]).toEqual(["verification", "start", 1, 11]);
		// College: a scoring run's worst case is 26 and a verification's 27, past the platform's 15, so under
		// it neither starts: the final found by the probe waits every tick, holding the work, and the
		// unverified game waits every hour; nothing is sent for either. Under a count that holds the worst
		// case, both run.
		const college = gameOf(1, { league: "ncaab" });
		const held = tick([college], PROBING, { says: () => "final" });
		expect([held.result.probes.length, held.result.fullRead, held.result.waiting, held.asked.length, held.written.length]).toEqual([1, null, ["1: final at seat 3 waits: needs 26 requests, 14 left"], 1, 0]);
		const room = tick([college], PROBING, { says: () => "final", requestsLimit: 30 });
		expect([room.result.fullRead?.why, room.written.length]).toEqual(["final at seat 3", 1]);
		const unverified = tick([unverifiedOf(1, { league: "ncaab" })], VERIFY_AT, { program: waiter() });
		expect([unverified.result.fullRead, unverified.result.waiting, unverified.handed.length, unverified.asked.length]).toEqual([null, ["1: verification waits: needs 27 requests, 15 left"], 0, 0]);
		expect(tick([unverifiedOf(1, { league: "ncaab" })], VERIFY_AT, { program: waiter(), requestsLimit: 27 }).handed.length).toBe(1);
	});

	test("a full read the count cuts all the same writes nothing: the readers raise the cut, the run ends undecided, and the tick's line says cut", () => {
		// A program stand-in that sends `n` distinct requests through the run's transport before it scores.
		const sender = (n: number): TickDeps["score"] =>
			((game: ChainGame, _k: unknown, _p: unknown, _now: unknown, send: (req: HttpRequest) => HttpResponse): Outcome => {
				for (let i = 0; i < n; i++) send({ method: "GET", url: `https://example.invalid/${i}`, headers: {} });
				return { decision: { action: "score", home: 114, away: 106, readings: [], why: "a stand-in scores" }, report: SCORE_REPORT(game.id) };
			}) as TickDeps["score"];
		const answers = (): HttpResponse => ({ status: 200, body: "[]" });
		const g = gameOf(1);
		const at = START + g.n + 10;
		const chain = fakeChainOf([g], at);
		const writer = recordingWriter();
		const cut = runTick({ evm: chain, games: GAMES, payout: PAYOUT, keys: KEYS, send: answers, write: writer.write, score: sender(20), period: PERIOD, shard: { index: 0, count: 1 } });
		expect(cut.fullRead).toEqual({ gameId: "1", why: "hour 24", run: null, error: "the run's 15 requests are used", cut: true });
		expect(cut.lines).toContain("full read, hour 24: game 1 cut: the run's 15 requests are used");
		expect([writer.written.length, cut.requests]).toEqual([0, 15]);
		// The same stand-in within the count: the score is written, and the full read is not a cut.
		const ok = runTick({ evm: fakeChainOf([g], at), games: GAMES, payout: PAYOUT, keys: KEYS, send: answers, write: writer.write, score: sender(5), period: PERIOD, shard: { index: 0, count: 1 } });
		expect([ok.fullRead?.cut, ok.fullRead?.run?.decision.action, writer.written.length, ok.requests]).toEqual([false, "score", 1, 5]);
	});

	test("a write the reporter refuses ends the run with its error on the tick's line, and the tick goes on", () => {
		const chain = fakeChainOf([unverifiedOf(1), gameOf(2, { start: VERIFY_AT - DURATION - 600 })], VERIFY_AT);
		const t = saved(undefined, VERIFY_AT);
		const s3 = seat3Transport(() => "live");
		const result = runTick({
			evm: chain,
			games: GAMES,
			payout: PAYOUT,
			keys: KEYS,
			send: (req) => (req.url.includes(hintOf(2)) ? s3.send(req) : t.send(req)),
			write: () => {
				throw new Error("writeReport failed: status=2");
			},
			period: PERIOD,
			shard: { index: 0, count: 1 },
		});
		expect(result.fullRead).toMatchObject({ gameId: "1", why: "verification", run: null, error: "writeReport failed: status=2" });
		expect(result.lines).toContain("full read, verification: game 1 failed: writeReport failed: status=2");
		expect(result.probes.map((p) => [p.gameId, p.kind])).toEqual([["2", "no_final"]]);
	});
});
