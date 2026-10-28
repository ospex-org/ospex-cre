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
// date until it leaves the list, the nearer games first, so a game created before the feeds list it
// is verified when they do, however late, with nothing from anywhere but the chain and the feeds.
//
// The tick budgets the platform's quotas per execution: 15 chain reads and 15 feed requests. One full
// read per tick, started only with its reads in hand and the most requests the program may send for
// it (lib.ts, requestsFor, from the readers' own reads, one game at a time), so the count never cuts a
// run short of the seats the program would read; probes while reads and requests remain. A full read
// that cannot fit does not take the turn: its line records the wait, and the next due game that fits
// takes the read the same tick, so nothing is silent and nothing is skipped for good. Should the count
// still stop a run, the readers raise the cut and the run writes nothing.
//
// The page follows the game, never the game the page. Each class of work (the verification, the
// hour's reads, the clocks in their windows, the probes) has its own count, and the count names a
// place on the shard's walk over its rows (chain.ts, placeNamed): the tick reads the page that holds
// the place, and the class begins its turn at the game there, then takes the rest in turn by the
// count. So the game at a place is read on the count that names it, whatever else its page holds,
// and a game that waited or failed last turn is not first next turn. The bound: every game on the
// shard that is due for a class, and whose full read fits the count, enters the program within own x
// 64 of the class's own ticks (own the shard's pages of 64 rows): the hour's first ticks for the
// verification, its second ticks for the hour's reads, the hour's other ten ticks for a clock in its
// window and for a probe, which is probed on that count and read in full on its final. parity.test.ts
// proves it by program entries on a stable 500-game list across three shards. Nothing here decides a
// score: the full read is the program's run, and the probe asks only whether the game is over.

import type { Address } from "viem";
import type { ChainGame, ReportReading } from "../scoring/src/chain";
import { readerFor } from "../scoring/src/index";
import { keyFor } from "../scoring/src/keys";
import { OPEN_FOR } from "../scoring/src/rule";
import { isCut, runSync } from "../scoring/src/run";
import type { Game, HttpRequest, HttpResponse, Reading, Seat } from "../scoring/src/types";
import { NO_READINGS, gameOfState, placeNamed, readIdentity, readOpenGames, readReadings, readReporters, type Evm, type Identity, type OpenGame, type PlacedGame, type Readings, type Shard } from "./chain";
import {
	CLOCK_WINDOW,
	EXPECTED_DURATION,
	HOURLY_TICK,
	OPEN_PAGE,
	READS_PER_EXECUTION,
	REQUESTS_PER_EXECUTION,
	VERIFY_BEFORE,
	VERIFY_NEAR,
	counted,
	memoized,
	probeSeatFor,
	requestsFor,
	saysFinal,
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

/** The hour's count: the turn of the verification, on the hour's first tick, and of the hour's reads, on its second. */
export function hourCount(now: number): number {
	return Math.floor(now / 3_600);
}

/**
 * The count of the hour's other ticks: the turn of the clocks in their windows and of the probes. It
 * advances on every tick but the hour's first two, whose one full read is the hour's own (the
 * verification, the hour's reads), and on those two it repeats the hour before's last two counts, so
 * every place it names (chain.ts, placeNamed) is named on a tick whose full read is free for its game,
 * whatever factor the shard's places share with the hour. A schedule of two ticks an hour has no other
 * ticks, and the tick's own count stands.
 */
export function otherCount(now: number, period: number): number {
	const perHour = Math.floor(3_600 / period);
	const tick = Math.floor(now / period);
	return perHour > 2 ? tick - 2 * Math.floor(now / 3_600) : tick;
}

/** The counts whose pages a tick reads (chain.ts, readOpenGames): the hour's on its first two ticks, the other ticks' always. */
export function countsOf(now: number, period: number): number[] {
	return tickOfHour(now, period) <= HOURLY_TICK ? [hourCount(now), otherCount(now, period)] : [otherCount(now, period)];
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
	const pageSize = deps.pageSize ?? OPEN_PAGE;
	const open = readOpenGames(evm, deps.games, deps.shard, countsOf(now, deps.period), pageSize);
	// The places the counts name on this shard's walk: where each class of work begins its turn.
	const hourTurn = hourCount(now);
	const otherTurn = otherCount(now, deps.period);
	const hourHead = placeNamed(hourTurn, open.pages.own, pageSize);
	const otherHead = placeNamed(otherTurn, open.pages.own, pageSize);
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
	 * The most requests a full read of this game may send, from the readers' own reads (lib.ts, requestsFor):
	 * a verification's, a scoring run's, or none at day 7, which asks no seat.
	 */
	const requestsForFull = (_row: OpenGame, why: string): number => requestsFor(why === "verification" ? "verification" : why === "day 7" ? "day 7" : "scoring");
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

	// Each class of work takes its games in turn: first the game at the place its own count names, when
	// that game is due (the page that holds it was read for it, so it is read on that count whatever
	// else the page holds), then the rest of the class in turn by the count, so a game that waited or
	// failed last turn is not first next turn and no head keeps the rest from theirs. The verification
	// and the hour's reads turn by the hour's count, the clocks in their windows and the probes by the
	// other ticks'.
	const inTurn = <T extends { readonly row: PlacedGame }>(list: readonly T[], count: number, head: number): T[] => {
		if (list.length === 0) return [];
		const byPlace = [...list].sort((a, b) => a.row.place - b.row.place);
		const shift = ((count % byPlace.length) + byPlace.length) % byPlace.length;
		const turned = [...byPlace.slice(shift), ...byPlace.slice(0, shift)];
		const at = turned.findIndex((x) => x.row.place === head);
		return at <= 0 ? turned : [turned[at], ...turned.slice(0, at), ...turned.slice(at + 1)];
	};

	// The hour's first tick: one verification, with its worst case of requests in hand. First the game at
	// the place the hour's count names, whatever its date's distance, so the bound holds for every due
	// game; then the nearer games, those not yet VERIFY_NEAR past their date, in turn; then the rest in
	// turn: nearer-first orders the turn, it never keeps a game out of it. A game whose full read cannot
	// fit the count does not take the turn: its line records the wait, and the next due game that fits
	// takes the read the same tick. The others take their turn on the hours after.
	const verifies = dues.filter((d): d is { row: PlacedGame; due: Extract<Due, { kind: "verify" }> } => d.due.kind === "verify" && d.due.fires);
	const near = verifies.filter((v) => now <= v.row.date + VERIFY_NEAR);
	const byTier = [...inTurn(near, hourTurn, hourHead), ...inTurn(verifies.filter((v) => !near.includes(v)), hourTurn, hourHead)];
	const named = verifies.find((v) => v.row.place === hourHead);
	for (const v of named === undefined ? byTier : [named, ...byTier.filter((v) => v !== named)]) {
		if (fullRead !== null) waiting.push(`${v.row.gameId}: verification waits for its hour's turn`);
		else fullReadOrWait(v.row, "verification");
	}

	/**
	 * One probe: the game's identity (its hints, and its teams for the spare) and its readings (the start
	 * report, which says which seat it asks; a disputed game's votes) read, keeping the reads a full read
	 * on its final would need while this tick has none yet; then one request at the seat the start report
	 * shows readable, and the full read on a final, or on a change for a disputed game.
	 */
	const probeOne = (row: PlacedGame): void => {
		if (requests.used() + 1 > requestsLimit) {
			waiting.push(`${row.gameId}: no request left for its probe`);
			return;
		}
		const probeReads = (identities.has(row.gameId) ? 0 : 1) + (readings.has(row.gameId) ? 0 : 1);
		const keep = fullRead === null ? readsForFull(row) - probeReads : 0;
		if (reads + probeReads + keep > readsLimit) {
			waiting.push(`${row.gameId}: no read left for its probe`);
			return;
		}
		const identity = identityOf(row.gameId);
		const held = readingsOf(row.gameId);
		const seat = probeSeatFor({ hints: identity.hints, startReadings: held.startReadings.length === 0 ? null : held.startReadings });
		const openFor = OPEN_FOR[seat];
		if (openFor !== null && now - (row.start as number) > openFor) {
			lines.push(`game ${row.gameId}: seat ${seat} is closed, not probed`);
			return;
		}
		const key = keyFor(deps.keys, seat);
		if (key === null) {
			lines.push(`game ${row.gameId}: seat ${seat} has no key, not probed`);
			return;
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
		if (!read) return;
		fullReadOrWait(row, changed === null ? `final at seat ${seat}` : `a change at seat ${seat}`);
	};

	// The clocks and the probes. On the hour's second tick the clocks turn by the hour's count (the
	// hour's reads); on the other ticks both turn by the other ticks' count, and the game at the place
	// that count names comes before everything else, whatever its class: a clock in its window is first in
	// its turn, and a probe runs here, before the clocks, so the game is read on that count whatever the
	// clocks hold. Day 7 asks no seat, so it costs no request; hour 24 and the hour's read cost a scoring
	// run's. A clock whose full read cannot fit records its wait, and the next that fits takes the read.
	const clocks = dues.filter((d): d is { row: PlacedGame; due: Extract<Due, { kind: "clock" }> } => d.due.kind === "clock" && d.due.fires);
	const due = dues.filter((d): d is { row: PlacedGame; due: Extract<Due, { kind: "probe" }> } => d.due.kind === "probe");
	const hourly = tickOfHour(now, deps.period) === HOURLY_TICK;
	const probesInTurn = inTurn(due, otherTurn, otherHead);
	const headProbe = hourly || onTheHour(now, deps.period) ? undefined : probesInTurn.find((p) => p.row.place === otherHead);
	if (headProbe !== undefined) probeOne(headProbe.row);
	for (const c of inTurn(clocks, hourly ? hourTurn : otherTurn, hourly ? hourHead : otherHead)) fullReadOrWait(c.row, c.due.clock);
	for (const p of probesInTurn) if (p !== headProbe) probeOne(p.row);

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
