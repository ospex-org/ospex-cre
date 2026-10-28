// The tick: what one cron fire does for its shard of the open list. It reads its pages of the list,
// and for each game past its written start plus the league's expected duration it reads the game's
// identity and its readings and probes one seat (seat 3 by its hint, one request, when the start
// report shows it readable; the spare where the start marked seat 3 silent for the game), and runs
// the full read, the program's run, on a final or on a clock: hour
// 24 (the start plus n) and day 7 (the dispute record plus its clock), both from the chain's clock.
// A full read never runs on the tick itself. A disputed game's probe is a change at the probed seat
// against its vote on record, and its full read also runs on the hour's second tick, so the other
// seats' changes are recorded within the hour, and at day 7. On the hour's first tick the full read
// is a verification: one game the creation trigger's run left unverified, from seven days before its
// date until it leaves the list, the nearer dates first, so a game created before the feeds list it
// is verified when they do, however late, with nothing from anywhere but the chain and the feeds.
//
// The tick budgets the platform's quotas per execution: 15 chain reads and 15 feed requests. One full
// read per tick, started only with its reads in hand and the most requests the program may send for
// that league (lib.ts, scoringRequests and verifyingRequests, from the readers' own pagination), so
// the count never cuts a run short of the seats the program would read; probes while reads and
// requests remain; a full read found without room waits for the next tick, where the probes start
// from another game, so no game is starved and no work is dropped. Each class of work (the
// verification, the hour's reads, the clocks in their windows, the probes) takes its games in turn by
// its own count, so a game that waited or failed last turn is not first next turn. Should the count
// still stop a run, the readers raise the cut and the run writes nothing. Nothing here decides a
// score: the full read is the program's run, and the probe asks only whether the game is over.

import type { Address } from "viem";
import type { ChainGame, ReportReading } from "../scoring/src/chain";
import { readerFor } from "../scoring/src/index";
import { keyFor } from "../scoring/src/keys";
import { OPEN_FOR } from "../scoring/src/rule";
import { isCut, runSync } from "../scoring/src/run";
import type { Game, HttpRequest, HttpResponse, Reading, Seat } from "../scoring/src/types";
import { NO_READINGS, gameOfState, readIdentity, readOpenGames, readReadings, readReporters, type Evm, type Identity, type OpenGame, type Readings, type Shard } from "./chain";
import {
	CLOCK_WINDOW,
	EXPECTED_DURATION,
	HOURLY_TICK,
	READS_PER_EXECUTION,
	REQUESTS_PER_EXECUTION,
	VERIFY_BEFORE,
	VERIFY_NEAR,
	counted,
	memoized,
	probeSeatFor,
	saysFinal,
	scoringRequests,
	verifyingRequests,
} from "./lib";
import { runGame, summarize, type Deps, type Run } from "./run";

export interface TickDeps extends Deps {
	/** The seconds between two ticks, from the schedule: the hour's first tick is the one within a period of the hour. */
	readonly period: number;
	readonly shard: Shard;
	/** The quotas, for a test that lowers them; the workflow takes the platform's. */
	readonly readsLimit?: number;
	readonly requestsLimit?: number;
	/** The open list's page, for a test that shortens it; the workflow takes lib.ts's. */
	readonly pageSize?: number;
}

export type Clock = "day 7" | "hour 24" | "the hour";

/** What a game on the open list is due for on this tick. */
export type Due =
	| { readonly kind: "none"; readonly why: string }
	| { readonly kind: "probe" }
	| { readonly kind: "clock"; readonly clock: Clock; readonly fires: boolean; readonly since: number }
	| { readonly kind: "verify"; readonly fires: boolean };

export interface Probe {
	readonly gameId: string;
	readonly seat: Seat;
	readonly kind: Reading["kind"];
	readonly final: boolean;
	/** For a disputed game: whether the seat's answer differs from its vote on record. */
	readonly changed: boolean | null;
}

/** The one full read a tick ran. */
export interface FullRead {
	readonly gameId: string;
	readonly why: string;
	/** The run, or null when it threw: a read past the count, the write refused, or a cut. */
	readonly run: Run | null;
	readonly error: string | null;
	/** True when the tick's own count of requests cut the run: the readers raised it, nothing was decided or written. */
	readonly cut: boolean;
}

export interface TickResult {
	readonly now: number;
	readonly shard: Shard;
	/** How many games the open list holds, and how many this tick's pages held. */
	readonly open: number;
	readonly mine: number;
	readonly pages: { readonly own: number; readonly read: number };
	readonly reads: number;
	readonly requests: number;
	readonly probes: readonly Probe[];
	readonly fullRead: FullRead | null;
	/** Games due for a read that this tick had no room or no turn for. */
	readonly waiting: readonly string[];
	readonly lines: readonly string[];
}

/** Which tick of the hour this is, from the chain's clock: 0 for the hour's first. */
export function tickOfHour(now: number, period: number): number {
	return Math.floor((now % 3_600) / period);
}

/** Whether this tick is the hour's first: the chain's clock within a period of the hour. */
export function onTheHour(now: number, period: number): boolean {
	return tickOfHour(now, period) === 0;
}

/**
 * The turns a tick reads its shard's other pages by, one page each (chain.ts, readOpenGames): the
 * tick's count on every tick, the turn of the probes and the clocks' windows, which run on every tick;
 * and on the hour's first two ticks the hour's count too, the turn of the verification (the first) and
 * the hour's reads (the second). A five-minute schedule has twelve ticks an hour, so a shard whose
 * other pages share a factor with twelve would meet the hour's ticks on the same pages for ever if
 * those ticks turned by the tick's count. With its own count, each class of work reaches every page
 * of its shard within own - 1 of its own ticks: hours for the hour's classes, ticks for the rest.
 */
export function pageTurnsOf(now: number, period: number): number[] {
	const tick = Math.floor(now / period);
	return tickOfHour(now, period) <= HOURLY_TICK ? [Math.floor(now / 3_600), tick] : [tick];
}

/** What a game on the open list is due for at the chain's clock. */
export function dueOf(row: OpenGame, now: number, period: number): Due {
	const none = (why: string): Due => ({ kind: "none", why });
	const duration = EXPECTED_DURATION[row.league];
	if (duration === undefined) return none("league not offered");
	if (row.status === "unverified") {
		// Due until the game leaves the list: a feed that lists it late still gets it verified.
		if (now < row.date - VERIFY_BEFORE) return none("before seven days to its date");
		return { kind: "verify", fires: onTheHour(now, period) };
	}
	if (row.status !== "verified" && row.status !== "disputed") return none(`status ${row.status}`);
	if (row.start === null) return none("no written start");
	const hourly = tickOfHour(now, period) === HOURLY_TICK;
	if (row.status === "verified") {
		const hour24 = row.start + row.window;
		if (now >= hour24) return { kind: "clock", clock: "hour 24", fires: now < hour24 + CLOCK_WINDOW || hourly, since: hour24 };
		if (now >= row.start + duration) return { kind: "probe" };
		return none("before the start plus the league's duration");
	}
	if (row.disputedAt === null) return none("disputed without a clock");
	const day7 = row.disputedAt + row.day7Clock;
	if (now >= day7) return { kind: "clock", clock: "day 7", fires: now < day7 + CLOCK_WINDOW || hourly, since: day7 };
	if (hourly) return { kind: "clock", clock: "the hour", fires: true, since: now - (now % 3_600) };
	// Seat 3 is the longer-open of the two seats a probe reads; the spare's closing is checked at the probe, once the identity says which seat it is.
	const open = OPEN_FOR[3];
	if (open !== null && now - row.start > open) return none("seat 3 is closed; the hour's read and day 7 remain");
	return { kind: "probe" };
}

const KIND_OF: Readonly<Record<Reading["kind"], 0 | 1 | 2>> = { silent: 0, no_final: 1, final: 2 };

/** Whether a seat's answer this tick is its vote on record: the same kind, and for a final the same points. A silent answer changes nothing. */
export function sameVote(vote: ReportReading | undefined, r: Reading): boolean {
	if (r.kind === "silent") return true;
	if (vote === undefined) return false;
	if (vote.kind !== KIND_OF[r.kind]) return false;
	return r.kind !== "final" || (vote.homeScore === r.home && vote.awayScore === r.away);
}

const CLOCK_ORDER: Readonly<Record<Clock, number>> = { "day 7": 0, "hour 24": 1, "the hour": 2 };

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
	const open = readOpenGames(evm, deps.games, deps.shard, pageTurnsOf(now, deps.period), deps.pageSize);
	const dues = open.rows.map((row) => ({ row, due: dueOf(row, now, deps.period) }));
	const probes: Probe[] = [];
	const waiting: string[] = [];
	let fullRead: FullRead | null = null;

	// What this tick read about a game is in hand for the rest of it: a probe's identity serves the full read it leads to.
	const identities = new Map<bigint, Identity>();
	const readings = new Map<bigint, Readings>();
	const identityOf = (id: bigint): Identity => {
		let v = identities.get(id);
		if (v === undefined) {
			v = readIdentity(evm, deps.games, id);
			identities.set(id, v);
		}
		return v;
	};
	const readingsOf = (id: bigint): Readings => {
		let v = readings.get(id);
		if (v === undefined) {
			v = readReadings(evm, deps.games, id);
			readings.set(id, v);
		}
		return v;
	};
	/** The chain reads a full read of this game still needs: its identity and its readings unless in hand (an unverified game has none), its reporters, the three for the payout's refusals. */
	const readsForFull = (row: OpenGame): number => (identities.has(row.gameId) ? 0 : 1) + (row.status === "unverified" || readings.has(row.gameId) ? 0 : 1) + 1 + 3;
	/**
	 * The most requests a full read of this game may send, the league's worst case from the readers' own
	 * pagination: a verification's, a scoring run's, or none at day 7, which asks no seat.
	 */
	const requestsForFull = (row: OpenGame, why: string): number => {
		if (why === "verification") return verifyingRequests(row.league, row.date, row.window);
		if (why === "day 7") return 0;
		return scoringRequests(row.league, row.start ?? now, row.window);
	};
	/** Why a full read of this game cannot start on this tick, or null when it can: one a tick, its reads, its league's worst case in requests. */
	const shortOf = (row: OpenGame, why: string): string | null => {
		if (fullRead !== null) return "one full read a tick";
		const needReads = readsForFull(row);
		if (reads + needReads > readsLimit) return `needs ${needReads} reads, ${readsLimit - reads} left`;
		const need = requestsForFull(row, why);
		if (requests.used() + need > requestsLimit) return `needs ${need} requests, ${requestsLimit - requests.used()} left`;
		return null;
	};
	/** A full read of this game now, or the line that says why it waits, holding the work for the next tick or turn. */
	const fullReadOrWait = (row: OpenGame, why: string): void => {
		const short = shortOf(row, why);
		if (short === null) fullReadOf(row, why);
		else waiting.push(`${row.gameId}: ${why} waits: ${short}`);
	};

	function fullReadOf(row: OpenGame, why: string): void {
		try {
			const identity = identityOf(row.gameId);
			const held = row.status === "unverified" ? NO_READINGS : readingsOf(row.gameId);
			const reporters = readReporters(evm, deps.games, row.gameId);
			const run = runGame(runDeps, gameOfState(row, identity, held), reporters, now);
			fullRead = { gameId: row.gameId.toString(), why, run, error: null, cut: false };
			lines.push(`full read, ${why}: ${summarize(run)}`);
		} catch (e) {
			// The run is over and nothing was written; the game's next tick or turn reads it afresh. A cut is
			// the tick's own count of requests used up, raised by the readers so the program never decides
			// on the part it saw; the rest is a read past the count or the write refused. The count is what
			// stops a run, never the platform's refusal.
			const error = e instanceof Error ? e.message : String(e);
			const cut = isCut(e);
			fullRead = { gameId: row.gameId.toString(), why, run: null, error, cut };
			lines.push(`full read, ${why}: game ${row.gameId} ${cut ? "cut" : "failed"}: ${error}`);
		}
	}

	// Each class of work takes its games in turn, begun from the one its own count names, so the game
	// that waited or failed last turn is not first next turn and no head keeps the rest from theirs: the
	// verification and the hour's reads by the hour's count, the clocks in their windows and the probes
	// by the tick's count.
	const hourTurn = Math.floor(now / 3_600);
	const tickTurn = Math.floor(now / deps.period);
	const inTurn = <T>(list: readonly T[], turn: number): T[] => {
		const shift = list.length === 0 ? 0 : turn % list.length;
		return [...list.slice(shift), ...list.slice(0, shift)];
	};

	// The hour's first tick: one verification, the game whose turn it is, with its league's worst case
	// of requests in hand. The turns go to the nearer games, those not yet VERIFY_NEAR past their date,
	// nearest date first; a game further past its date takes a turn only when no nearer game is due.
	// The others take their turn on the hours after.
	const verifies = dues.filter((d): d is { row: OpenGame; due: Extract<Due, { kind: "verify" }> } => d.due.kind === "verify" && d.due.fires);
	const near = verifies.filter((v) => now <= v.row.date + VERIFY_NEAR);
	const queue = (near.length > 0 ? near : verifies).sort((a, b) => Math.abs(a.row.date - now) - Math.abs(b.row.date - now) || (a.row.gameId < b.row.gameId ? -1 : 1));
	if (queue.length > 0) {
		const pick = queue[hourTurn % queue.length];
		fullReadOrWait(pick.row, "verification");
		for (const v of verifies) if (v !== pick) waiting.push(`${v.row.gameId}: verification waits for its hour's turn`);
	}

	// Then the clocks, in turn: day 7 asks no seat, so it costs no request; hour 24 and the hour's read
	// cost a scoring run's. On the hour's second tick the turn is the hour's, on the others the tick's.
	const clocks = dues
		.filter((d): d is { row: OpenGame; due: Extract<Due, { kind: "clock" }> } => d.due.kind === "clock" && d.due.fires)
		.sort((a, b) => CLOCK_ORDER[a.due.clock] - CLOCK_ORDER[b.due.clock] || (a.row.start ?? 0) - (b.row.start ?? 0));
	for (const c of inTurn(clocks, tickOfHour(now, deps.period) === HOURLY_TICK ? hourTurn : tickTurn)) fullReadOrWait(c.row, c.due.clock);

	// Then the probes, in start order, begun from the game the tick's count names, so a run of games not
	// yet final at the front never keeps the ones behind them from their turn. A probe reads the game's
	// identity (its hints, and its teams for the spare) and its readings (the start report, which says
	// which seat it asks; a disputed game's votes); it keeps the reads a full read on its final would
	// need, while this tick has none yet.
	const due = dues.filter((d): d is { row: OpenGame; due: Extract<Due, { kind: "probe" }> } => d.due.kind === "probe").sort((a, b) => (a.row.start ?? 0) - (b.row.start ?? 0));
	for (const p of inTurn(due, tickTurn)) {
		const row = p.row;
		if (requests.used() + 1 > requestsLimit) {
			waiting.push(`${row.gameId}: no request left for its probe`);
			continue;
		}
		const probeReads = (identities.has(row.gameId) ? 0 : 1) + (readings.has(row.gameId) ? 0 : 1);
		const keep = fullRead === null ? readsForFull(row) - probeReads : 0;
		if (reads + probeReads + keep > readsLimit) {
			waiting.push(`${row.gameId}: no read left for its probe`);
			continue;
		}
		const identity = identityOf(row.gameId);
		const held = readingsOf(row.gameId);
		const seat = probeSeatFor({ hints: identity.hints, startReadings: held.startReadings.length === 0 ? null : held.startReadings });
		const openFor = OPEN_FOR[seat];
		if (openFor !== null && now - (row.start as number) > openFor) {
			lines.push(`game ${row.gameId}: seat ${seat} is closed, not probed`);
			continue;
		}
		const key = keyFor(deps.keys, seat);
		if (key === null) {
			lines.push(`game ${row.gameId}: seat ${seat} has no key, not probed`);
			continue;
		}
		const game: Game = { league: identity.league, home: identity.home, away: identity.away, start: row.start as number, n: row.window, hints: identity.hints };
		const reading = runSync(seat, readerFor(seat)({ game, now, key }), send);
		let changed: boolean | null = null;
		let read = saysFinal(reading);
		if (row.status === "disputed") {
			// A change against the seat's vote on record is what calls for the full read.
			changed = !sameVote(held.votes.find((v) => v.seat === seat), reading);
			read = changed;
		}
		probes.push({ gameId: row.gameId.toString(), seat, kind: reading.kind, final: saysFinal(reading), changed });
		if (!read) continue;
		fullReadOrWait(row, changed === null ? `final at seat ${seat}` : `a change at seat ${seat}`);
	}

	return { now, shard: deps.shard, open: open.total, mine: open.rows.length, pages: open.pages, reads, requests: requests.used(), probes, fullRead, waiting, lines };
}

/** The tick's one line for the log. */
export function summarizeTick(t: TickResult): string {
	return JSON.stringify({
		now: t.now,
		shard: `${t.shard.index}/${t.shard.count}`,
		open: t.open,
		mine: t.mine,
		pages: `${t.pages.read}/${t.pages.own}`,
		reads: t.reads,
		requests: t.requests,
		probes: t.probes.length,
		finals: t.probes.filter((p) => p.final).length,
		fullRead:
			t.fullRead === null
				? null
				: { gameId: t.fullRead.gameId, why: t.fullRead.why, action: t.fullRead.run?.decision.action ?? null, written: t.fullRead.run?.written != null, error: t.fullRead.error, cut: t.fullRead.cut },
		waiting: t.waiting.length,
	});
}

export type { ChainGame, Address, Shard };
