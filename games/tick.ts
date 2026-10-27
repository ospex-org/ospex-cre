// The tick: what one cron fire does for its shard of the games not yet ended. It reads the open list,
// and for each of its games past its written start plus the league's expected duration it probes one
// seat (seat 3 by its hint, one request), and runs the full read, the program's run, on a final or on a
// clock: hour 24 (the start plus n) and day 7 (the dispute record plus its clock), both from the
// chain's clock. A full read never runs on the tick itself. A disputed game's probe is a change at the
// probed seat against its vote on record, and its full read also runs on the hour's first tick, so the
// other seats' changes are recorded within the hour, and at day 7.
//
// The tick budgets the platform's quotas per execution: 15 chain reads and 15 feed requests. One full
// read per tick, started only with its reads and requests in hand; probes while requests remain; a
// final found without room for its full read waits for the next tick, where the probes start from
// another game, so no game is starved. Nothing here decides a score: the full read is the program's
// run, and the probe asks only whether the game is over.

import type { Address } from "viem";
import type { ChainGame, ReportReading } from "../scoring/src/chain";
import { readerFor } from "../scoring/src/index";
import { keyFor } from "../scoring/src/keys";
import { OPEN_FOR } from "../scoring/src/rule";
import { runSync } from "../scoring/src/run";
import type { Game, HttpRequest, HttpResponse, Reading, Seat } from "../scoring/src/types";
import { gameOfState, readIdentity, readOpenGames, readReadings, readReporters, type Evm, type OpenGame, type Readings } from "./chain";
import {
	CLOCK_WINDOW,
	EXPECTED_DURATION,
	FULL_READ_RESERVE,
	READS_PER_EXECUTION,
	READS_PER_FULL_READ,
	REQUESTS_PER_EXECUTION,
	counted,
	memoized,
	probeSeatFor,
	saysFinal,
} from "./lib";
import { runGame, summarize, type Deps, type Run } from "./run";

/** Which share of the games this tick takes: the games whose id leaves `index` modulo `count`. */
export interface Shard {
	readonly index: number;
	readonly count: number;
}

export interface TickDeps extends Deps {
	/** The seconds between two ticks, from the schedule: the hour's first tick is the one within a period of the hour. */
	readonly period: number;
	readonly shard: Shard;
	/** The quotas, for a test that lowers them; the workflow takes the platform's. */
	readonly readsLimit?: number;
	readonly requestsLimit?: number;
}

/** What a game on the open list is due for on this tick. */
export type Due =
	| { readonly kind: "none"; readonly why: string }
	| { readonly kind: "probe"; readonly seat: Seat }
	| { readonly kind: "clock"; readonly clock: "day 7" | "hour 24" | "the hour"; readonly fires: boolean; readonly since: number };

export interface Probe {
	readonly gameId: string;
	readonly seat: Seat;
	readonly kind: Reading["kind"];
	readonly final: boolean;
	/** For a disputed game: whether the seat's answer differs from its vote on record. */
	readonly changed: boolean | null;
}

export interface TickResult {
	readonly now: number;
	readonly shard: Shard;
	/** How many games the open list holds, and how many are this shard's. */
	readonly open: number;
	readonly mine: number;
	readonly reads: number;
	readonly requests: number;
	readonly probes: readonly Probe[];
	/** The one full read this tick ran, if any. */
	readonly fullRead: { readonly gameId: string; readonly why: string; readonly run: Run } | null;
	/** Games due for a full read that this tick had no room for. */
	readonly waiting: readonly string[];
	readonly lines: readonly string[];
}

/** Whether this tick is the hour's first: the chain's clock within a period of the hour. */
export function onTheHour(now: number, period: number): boolean {
	return now % 3_600 < period;
}

/** What a game on the open list is due for at the chain's clock. */
export function dueOf(row: OpenGame, now: number, period: number): Due {
	if (row.status !== "verified" && row.status !== "disputed") return { kind: "none", why: `status ${row.status}` };
	if (row.start === null) return { kind: "none", why: "no written start" };
	const duration = EXPECTED_DURATION[row.league];
	if (duration === undefined) return { kind: "none", why: "league not offered" };
	const seat = probeSeatFor(row.hints);
	const hour = onTheHour(now, period);
	if (row.status === "verified") {
		const hour24 = row.start + row.window;
		if (now >= hour24) return { kind: "clock", clock: "hour 24", fires: now < hour24 + CLOCK_WINDOW || hour, since: hour24 };
		if (now >= row.start + duration) return { kind: "probe", seat };
		return { kind: "none", why: "before the start plus the league's duration" };
	}
	if (row.disputedAt === null) return { kind: "none", why: "disputed without a clock" };
	const day7 = row.disputedAt + row.day7Clock;
	if (now >= day7) return { kind: "clock", clock: "day 7", fires: now < day7 + CLOCK_WINDOW || hour, since: day7 };
	if (hour) return { kind: "clock", clock: "the hour", fires: true, since: now - (now % 3_600) };
	const open = OPEN_FOR[seat];
	if (open !== null && now - row.start > open) return { kind: "none", why: `seat ${seat} is closed; the hour's tick and day 7 remain` };
	return { kind: "probe", seat };
}

const KIND_OF: Readonly<Record<Reading["kind"], 0 | 1 | 2>> = { silent: 0, no_final: 1, final: 2 };

/** Whether a seat's answer this tick is its vote on record: the same kind, and for a final the same points. A silent answer changes nothing. */
export function sameVote(vote: ReportReading | undefined, r: Reading): boolean {
	if (r.kind === "silent") return true;
	if (vote === undefined) return false;
	if (vote.kind !== KIND_OF[r.kind]) return false;
	return r.kind !== "final" || (vote.homeScore === r.home && vote.awayScore === r.away);
}

const CLOCK_ORDER: Readonly<Record<"day 7" | "hour 24" | "the hour", number>> = { "day 7": 0, "hour 24": 1, "the hour": 2 };

/** One tick for one shard. */
export function runTick(deps: TickDeps): TickResult {
	const readsLimit = deps.readsLimit ?? READS_PER_EXECUTION;
	const requestsLimit = deps.requestsLimit ?? REQUESTS_PER_EXECUTION;
	const lines: string[] = [];
	let reads = 0;
	const evm: Evm = {
		call(to, data) {
			if (reads >= readsLimit) throw new Error(`the run's ${readsLimit} reads are used`);
			reads++;
			return deps.evm.call(to, data);
		},
		latest() {
			if (reads >= readsLimit) throw new Error(`the run's ${readsLimit} reads are used`);
			reads++;
			return deps.evm.latest();
		},
	};
	const requests = counted(deps.send, requestsLimit);
	const send: (req: HttpRequest) => HttpResponse = memoized(requests.send);
	const runDeps: Deps = { ...deps, evm, send };

	const now = evm.latest().timestamp;
	const open = readOpenGames(evm, deps.games);
	const count = BigInt(deps.shard.count);
	const mine = open.rows.filter((r) => r.gameId % count === BigInt(deps.shard.index));
	const dues = mine.map((row) => ({ row, due: dueOf(row, now, deps.period) }));
	const probes: Probe[] = [];
	const waiting: string[] = [];
	let fullRead: TickResult["fullRead"] = null;
	const readingsOf = new Map<bigint, Readings>();

	const roomFor = (requestsNeeded: number): boolean => fullRead === null && reads + READS_PER_FULL_READ <= readsLimit && requests.used() + requestsNeeded <= requestsLimit;

	const fullReadOf = (row: OpenGame, why: string) => {
		const identity = readIdentity(evm, deps.games, row.gameId);
		const readings = readingsOf.get(row.gameId) ?? readReadings(evm, deps.games, row.gameId);
		const reporters = readReporters(evm, deps.games, row.gameId);
		const game = gameOfState(row, identity, readings);
		const run = runGame(runDeps, game, reporters, now);
		fullRead = { gameId: row.gameId.toString(), why, run };
		lines.push(`full read, ${why}: ${summarize(run)}`);
	};

	// The clocks first: day 7 asks no seat, so it costs no request; hour 24 and the hour's read cost a full read's.
	const clocks = dues
		.filter((d): d is { row: OpenGame; due: Extract<Due, { kind: "clock" }> } => d.due.kind === "clock" && d.due.fires)
		.sort((a, b) => CLOCK_ORDER[a.due.clock] - CLOCK_ORDER[b.due.clock] || (a.row.start ?? 0) - (b.row.start ?? 0));
	for (const c of clocks) {
		const need = c.due.clock === "day 7" ? 0 : FULL_READ_RESERVE;
		if (!roomFor(need)) {
			waiting.push(`${c.row.gameId}: ${c.due.clock}`);
			continue;
		}
		fullReadOf(c.row, c.due.clock);
	}

	// Then the probes, in start order, begun from a game that turns with the tick, so a run of games not
	// yet final at the front never keeps the ones behind them from their turn.
	const due = dues.filter((d): d is { row: OpenGame; due: Extract<Due, { kind: "probe" }> } => d.due.kind === "probe").sort((a, b) => (a.row.start ?? 0) - (b.row.start ?? 0));
	const shift = due.length === 0 ? 0 : Math.floor(now / deps.period) % due.length;
	const ordered = [...due.slice(shift), ...due.slice(0, shift)];
	for (const p of ordered) {
		if (requests.used() + 1 > requestsLimit) {
			waiting.push(`${p.row.gameId}: no request left for its probe`);
			continue;
		}
		const seat = p.due.seat;
		const key = keyFor(deps.keys, seat);
		if (key === null) {
			lines.push(`game ${p.row.gameId}: seat ${seat} has no key, not probed`);
			continue;
		}
		let game: Game;
		if (seat === 3) {
			// Seat 3 reads by the hint alone: the row has it, and no read is spent.
			game = { league: p.row.league, home: "", away: "", start: p.row.start as number, n: p.row.window, hints: p.row.hints };
		} else {
			if (reads + 1 > readsLimit) {
				waiting.push(`${p.row.gameId}: no read left for its identity`);
				continue;
			}
			const identity = readIdentity(evm, deps.games, p.row.gameId);
			game = { league: identity.league, home: identity.home, away: identity.away, start: p.row.start as number, n: p.row.window, hints: identity.hints };
		}
		const reading = runSync(seat, readerFor(seat)({ game, now, key }), send);
		let changed: boolean | null = null;
		let read = saysFinal(reading);
		if (p.row.status === "disputed") {
			// A change against the seat's vote on record is what calls for the full read.
			if (reads + 1 > readsLimit) {
				waiting.push(`${p.row.gameId}: no read left for its votes`);
				continue;
			}
			const readings = readingsOf.get(p.row.gameId) ?? readReadings(evm, deps.games, p.row.gameId);
			readingsOf.set(p.row.gameId, readings);
			changed = !sameVote(readings.votes.find((v) => v.seat === seat), reading);
			read = changed;
		}
		probes.push({ gameId: p.row.gameId.toString(), seat, kind: reading.kind, final: saysFinal(reading), changed });
		if (!read) continue;
		if (!roomFor(FULL_READ_RESERVE)) {
			waiting.push(`${p.row.gameId}: ${changed === null ? `final at seat ${seat}` : `a change at seat ${seat}`}, the full read waits for the next tick`);
			continue;
		}
		fullReadOf(p.row, changed === null ? `final at seat ${seat}` : `a change at seat ${seat}`);
	}

	return { now, shard: deps.shard, open: open.rows.length, mine: mine.length, reads, requests: requests.used(), probes, fullRead, waiting, lines };
}

/** The tick's one line for the log. */
export function summarizeTick(t: TickResult): string {
	return JSON.stringify({
		now: t.now,
		shard: `${t.shard.index}/${t.shard.count}`,
		open: t.open,
		mine: t.mine,
		reads: t.reads,
		requests: t.requests,
		probes: t.probes.length,
		finals: t.probes.filter((p) => p.final).length,
		fullRead: t.fullRead === null ? null : { gameId: t.fullRead.gameId, why: t.fullRead.why, action: t.fullRead.run.decision.action, written: t.fullRead.run.written !== null },
		waiting: t.waiting.length,
	});
}

/** For a test: the probe's game as the tick builds it for seat 3. */
export function probeGameOf(row: OpenGame): Game {
	return { league: row.league, home: "", away: "", start: row.start ?? 0, n: row.window, hints: row.hints };
}

export type { ChainGame, Address };
