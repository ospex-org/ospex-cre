// What the workflow reads from the chain about a game, through a small interface over the EVM
// capability so the reads can be tested against a fake chain. Everything the program takes about a
// game comes from state: the games set's open list (the games not yet ended, with their clocks, their
// date and their league), a game's identity, the start report's readings and each seat's last vote,
// its reporters, and what the games set refuses as a payout (its own address, its coin, its
// reporters). The one log the workflow reads is its trigger's own, the creation event, for the start.
//
// The platform allows a run 15 chain reads, so the reads are few and whole: a shard reads its own
// pages of the open list, one per read, its first page every tick and one other in turn; a probe reads
// the game's identity; a full read its identity, its readings and its reporters, three.

import type { Address, Hex } from "viem";
import type { ChainGame, PayoutRefused, ReportReading } from "../scoring/src/chain";
import { GAME_STATUS, OPEN_PAGE, readAnswer, readCall, type Creation } from "./lib";

/** The chain, as the reads need it. main.ts binds it to the EVM capability; tests bind a fake. */
export interface Evm {
	/** eth_call at the latest block: the answer's bytes. A revert throws. */
	call(to: Address, data: Hex): Hex;
	/** The latest block's number and its timestamp, unix seconds: the chain's clock. */
	latest(): { readonly number: bigint; readonly timestamp: number };
}

/** One game on the games set's open list, as the tick decides on it. */
export interface OpenGame {
	readonly gameId: bigint;
	readonly status: ChainGame["status"];
	/** The written start, or null while the game is unverified. */
	readonly start: number | null;
	readonly window: number;
	readonly day7Clock: number;
	/** When the dispute record was written, or null without one. */
	readonly disputedAt: number | null;
	readonly league: string;
	/** The creator's date, which an unverified game is verified from. */
	readonly date: number;
}

/** Which of the open list's pages a tick reads: shard `index` of `count` reads the pages index, index + count, index + 2 count, ... */
export interface Shard {
	readonly index: number;
	readonly count: number;
}

/** The shard's rows this tick, with what the read cost and what it covered. */
export interface OpenList {
	readonly rows: readonly OpenGame[];
	readonly reads: number;
	/** How many games the whole list holds, from the first page's answer. */
	readonly total: number;
	/** The shard's own pages, and how many of them this tick read. */
	readonly pages: { readonly own: number; readonly read: number };
}

/** A game's identity, as stored at its creation. */
export interface Identity {
	readonly league: string;
	readonly home: string;
	readonly away: string;
	readonly date: number;
	readonly hints: ReadonlyArray<{ readonly seat: number; readonly id: string }>;
}

/** A game's readings, as stored: the start report's readings, each seat's last vote, the dispute clock. */
export interface Readings {
	/** The start report's readings as it carried them, or empty while no start is written. */
	readonly startReadings: readonly ReportReading[];
	/** Each seat's last vote that is not silent, one per seat that has voted, in the order the seats first voted; empty without a dispute record. */
	readonly votes: readonly ReportReading[];
	readonly disputedAt: number | null;
}

/** The seats of the table, for the fold of the votes into one record. */
const SEATS4 = [1, 2, 3, 4] as const;

const ENDED: ReadonlySet<string> = new Set(["scored", "voided", "released"]);

function unique(addresses: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const a of addresses) {
		const k = a.toLowerCase();
		if (!seen.has(k)) {
			seen.add(k);
			out.push(a);
		}
	}
	return out;
}

function statusOf(n: number): ChainGame["status"] {
	const status = (GAME_STATUS as Record<number, ChainGame["status"] | undefined>)[n];
	if (status === undefined) throw new Error(`a game status the games set does not have: ${n}`);
	return status;
}

function seconds(v: bigint, what: string): number {
	if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what} is not a safe number of seconds`);
	return Number(v);
}

function toKind(k: number): 0 | 1 | 2 {
	if (k === 0 || k === 1 || k === 2) return k;
	throw new Error(`a reading kind the games set does not have: ${k}`);
}

/**
 * What the games set refuses as the payout of a report that ends a game, besides address 0 and the
 * reserved range: its own address, its coin, and every address approved as a reporter. The list of
 * reporters is the approved list as it stands, the game's own recorded reporters, and the payout
 * itself when the games set says it was ever approved (getReporter answers for retired ones too), so
 * a payout that is any reporter, present or retired, is refused by the program before it is sent.
 */
export function readPayoutRefused(evm: Evm, games: Address, gameReporters: readonly Address[], payout: string): PayoutRefused {
	// Addresses are carried lowercase: the chain's bytes have no case, and every compare downstream is by value.
	const [coin] = readAnswer("i_token", evm.call(games, readCall("i_token", []))) as [Address];
	const [approved] = readAnswer("getApprovedReporters", evm.call(games, readCall("getApprovedReporters", []))) as [readonly Address[], readonly number[]];
	const reporters = unique([...approved, ...gameReporters].map((a) => a.toLowerCase()));
	if (/^0x[0-9a-fA-F]{40}$/.test(payout) && !reporters.includes(payout.toLowerCase())) {
		const [kind] = readAnswer("getReporter", evm.call(games, readCall("getReporter", [payout as Address]))) as [number, boolean, Hex];
		if (kind !== 0) reporters.push(payout.toLowerCase());
	}
	return { gamesSet: games.toLowerCase(), coin: coin.toLowerCase(), reporters };
}

/**
 * The shard's pages of the games set's open list, one read each. The shard's first page is read every
 * tick (its answer carries the list's total, which says how many pages the shard owns); of its other
 * pages, one is read per turn handed in, the page the turn's count names, so a list longer than a
 * tick's pages is covered over the turns of each class of work and no tick reads past its budget. Two
 * turns naming one page read it once. A page is one block's snapshot, and an end moves the last open
 * game into the ended one's place, so a game can be missed on one tick and seen on the next.
 */
export function readOpenGames(evm: Evm, games: Address, shard: Shard = { index: 0, count: 1 }, turns: readonly number[] = [0], pageSize = OPEN_PAGE): OpenList {
	if (!Number.isInteger(shard.index) || !Number.isInteger(shard.count) || shard.count < 1 || shard.index < 0 || shard.index >= shard.count) throw new Error(`shard ${shard.index} of ${shard.count}`);
	if (turns.length < 1 || turns.some((t) => !Number.isInteger(t))) throw new Error("a shard reads its first page and one other per turn");
	if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error(`a page of ${pageSize}`);
	let reads = 0;
	const page = (m: number): { readonly rows: OpenGame[]; readonly total: number } => {
		const offset = BigInt(shard.index + m * shard.count) * BigInt(pageSize);
		// The row in the games set's order (lib.ts, OPEN_GAME), each field taken by its name from the decoded tuple.
		const [answer, total] = readAnswer("getOpenGames", evm.call(games, readCall("getOpenGames", [offset, BigInt(pageSize)]))) as [
			readonly { gameId: bigint; status: number; start: bigint; window: bigint; day7Clock: bigint; disputedAt: bigint; league: string; date: bigint }[],
			bigint,
		];
		reads++;
		return {
			total: Number(total),
			rows: answer.map((r) => ({
				gameId: r.gameId,
				status: statusOf(r.status),
				start: r.start === 0n ? null : seconds(r.start, "the start"),
				window: seconds(r.window, "n"),
				day7Clock: seconds(r.day7Clock, "the day-7 clock"),
				disputedAt: r.disputedAt === 0n ? null : seconds(r.disputedAt, "the dispute clock"),
				league: r.league,
				date: seconds(r.date, "the date"),
			})),
		};
	};
	const first = page(0);
	const all = Math.ceil(first.total / pageSize);
	const own = all <= shard.index ? 0 : Math.ceil((all - shard.index) / shard.count);
	const rows = [...first.rows];
	if (own <= 1) return { rows, reads, total: first.total, pages: { own, read: own } };
	const rest = own - 1;
	const named = [...new Set(turns.map((turn) => 1 + (((turn % rest) + rest) % rest)))];
	for (const m of named) rows.push(...page(m).rows);
	return { rows, reads, total: first.total, pages: { own, read: 1 + named.length } };
}

/** A game's identity, from state. */
export function readIdentity(evm: Evm, games: Address, gameId: bigint): Identity {
	const [league, home, away, date, hints] = readAnswer("getGameIdentity", evm.call(games, readCall("getGameIdentity", [gameId]))) as [
		string,
		string,
		string,
		bigint,
		readonly { seat: number; id: string }[],
	];
	return { league, home, away, date: seconds(date, "the date"), hints: hints.map((h) => ({ seat: h.seat, id: h.id })) };
}

/** A game's readings, from state. */
export function readReadings(evm: Evm, games: Address, gameId: bigint): Readings {
	const [startReadings, votes, at] = readAnswer("getGameReadings", evm.call(games, readCall("getGameReadings", [gameId]))) as [
		readonly { seat: number; kind: number; homeScore: number; awayScore: number }[],
		readonly { seat: number; kind: number; homeScore: number; awayScore: number }[],
		bigint,
	];
	const reading = (v: { seat: number; kind: number; homeScore: number; awayScore: number }): ReportReading => ({ seat: v.seat, kind: toKind(v.kind), homeScore: v.homeScore, awayScore: v.awayScore });
	return {
		startReadings: startReadings.map(reading),
		votes: votes.map(reading),
		disputedAt: at === 0n ? null : seconds(at, "the dispute clock"),
	};
}

/**
 * The votes as one dispute record for the program: one reading per seat of the table in seat order,
 * each seat's last vote where it has one and silent where it has none, whatever order the games set
 * lists them in. This is what the program's own fold over every record it would have gives.
 */
export function recordOfVotes(votes: readonly ReportReading[]): ReportReading[] {
	return SEATS4.map((seat) => {
		const mine = votes.filter((v) => v.seat === seat && v.kind !== 0);
		return mine.at(-1) ?? { seat, kind: 0, homeScore: 0, awayScore: 0 };
	});
}

/** A game's recorded reporters, from state, lowercase. */
export function readReporters(evm: Evm, games: Address, gameId: bigint): readonly Address[] {
	const [reporters] = readAnswer("getGameReporters", evm.call(games, readCall("getGameReporters", [gameId]))) as [readonly Address[], readonly number[]];
	return reporters.map((r) => r.toLowerCase() as Address);
}

/** A game as the chain holds it before any report: the creation event's identity and terms, unverified. */
export function gameOfCreation(creation: Creation): Omit<ChainGame, "payoutRefused"> {
	return {
		id: creation.gameId.toString(),
		league: creation.league,
		home: creation.home,
		away: creation.away,
		date: creation.date,
		hints: creation.hints,
		n: creation.terms.window,
		day7: creation.terms.day7Clock,
		status: "unverified",
		start: null,
		startReadings: null,
		dispute: null,
	};
}

/** The readings of a game no report has reached: what a verification is handed without a read. */
export const NO_READINGS: Readings = Object.freeze({ startReadings: [], votes: [], disputedAt: null });

/**
 * A game as the chain holds it past its creation, for the program: the open list's row (its status and
 * clocks), its identity and its readings from state. The start report's readings are as it carried
 * them; the dispute record, when the game is disputed, is one record of each seat's last vote in seat
 * order, which is what the program reads from every record it would have. A game that has ended is
 * read no further than its status, since the program writes nothing to it; an unverified game is its
 * identity and nothing else, as the creation event would give it.
 */
export function gameOfState(row: OpenGame, identity: Identity, readings: Readings): Omit<ChainGame, "payoutRefused"> {
	const base = {
		id: row.gameId.toString(),
		league: identity.league,
		home: identity.home,
		away: identity.away,
		date: identity.date,
		hints: identity.hints,
		n: row.window,
		day7: row.day7Clock,
		status: row.status,
	};
	if (row.status === "unverified" || ENDED.has(row.status)) return { ...base, start: null, startReadings: null, dispute: null };
	const startReadings = readings.startReadings.length === 0 ? null : readings.startReadings;
	const disputedAt = readings.disputedAt ?? row.disputedAt;
	const dispute = row.status === "disputed" && disputedAt !== null ? { at: disputedAt, records: readings.votes.length === 0 ? [] : [recordOfVotes(readings.votes)] } : null;
	return { ...base, start: row.start, startReadings, dispute };
}
