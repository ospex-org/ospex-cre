// The games workflow's pure parts: its config, the chain it writes to, the games set's event and read
// shapes, the one report shape as the reporter decodes it, and the seat keys as the transport fills
// them. Nothing here decides a score: the decision is the scoring program's (../scoring), and this
// file only carries what the program decided to the chain and what the chain says to the program.
//
// Kept apart from main.ts so it can be tested with bun without the CRE runtime.

import {
	decodeAbiParameters,
	decodeEventLog,
	encodeAbiParameters,
	encodeFunctionData,
	toEventSelector,
	type Address,
	type Hex,
} from "viem";
import { z } from "zod";
import { READING_KIND, REPORT_KIND, type ChainGame, type Report, type ReportReading } from "../scoring/src/chain";
import type { Keys } from "../scoring/src/keys";
import { silentForGame } from "../scoring/src/rule";
import { SEATS, SPARE, seatRow } from "../scoring/src/table";
import type { HttpRequest, HttpResponse, Reading, Seat } from "../scoring/src/types";

// ──────────────────────────── The chain ────────────────────────────

/**
 * The chain the workflow writes to, by the selector the SDK's chain table gives it and its EVM chain
 * id, kept together so the config cannot name one and mean the other.
 */
export const CHAINS = {
	"polygon-testnet-amoy": { selector: 16281711391670634445n, chainId: 80002 },
	"polygon-mainnet": { selector: 4051577828743386545n, chainId: 137 },
} as const;
export type ChainSelectorName = keyof typeof CHAINS;

export function resolveChainSelector(name: ChainSelectorName, chainId: number): bigint {
	const chain = CHAINS[name];
	if (chain.chainId !== chainId) {
		throw new Error(`config mismatch: chainSelectorName "${name}" is chainId ${chain.chainId}, but config.chainId is ${chainId}`);
	}
	return chain.selector;
}

// ──────────────────────────── The config ───────────────────────────

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** The highest address the games set refuses as a payout for where it lies (MAX_RESERVED_ADDRESS). */
const MAX_RESERVED = 0xffffn;

const address = z.string().regex(ADDRESS, "must be a 0x-prefixed 20-byte address");
// A value the regex refused is left to the regex's issue; the refinement reads only an address.
const filledAddress = address.refine((a) => !ADDRESS.test(a) || BigInt(a) !== 0n, "must not be the zero address");

/**
 * The tick's schedule: a cron with a seconds field, at a whole number of minutes that divides the hour,
 * so the hour's first tick exists (the disputed games' hourly read keys on it) and the shards can be
 * staggered inside the minute. "0 star/5 star star star star" is every five minutes.
 */
const SCHEDULE = /^0 \*\/([1-9]|[1-5][0-9]) \* \* \* \*$/;

/** The most cron triggers a workflow may register beside the creation trigger (ten triggers in all). */
export const MAX_SHARDS = 9;

/**
 * The config, which the workflow id hashes. Every field is a deploy's value or the tick's shape, and
 * nothing in it names a feed, a seat, a count or a rule: those live in the scoring program, inside the
 * fingerprint. The schema is strict, so a field that is not here fails the load rather than ride along
 * unread.
 *
 * - receiverAddress: the games set's Chainlink reporter, which the workflow writes to (B5 predicts it).
 * - eventAddress: the games set, whose creation event is the trigger and whose reads the program takes.
 * - payoutAddress: the operator's payout wallet, which every score and void carries. It is set into the
 *   committed template before any id is computed; the template carries a placeholder that fails here.
 *   Refused: the zero address, the reserved range up to 0xffff, the reporter and the games set, which the
 *   games set refuses as payouts too (it also refuses its coin and any reporter, which the program checks
 *   at the run with what it reads from the chain).
 * - schedule: the tick's cron; a slower tick is a config change, inside the fingerprint.
 * - shards: how many ticks run per schedule, each on its own pages of the open list, staggered inside
 *   the minute; each is one execution with its own quotas, so this is the throughput of finals.
 */
export const configSchema = z
	.object({
		receiverAddress: filledAddress,
		eventAddress: filledAddress,
		chainSelectorName: z.enum(Object.keys(CHAINS) as [ChainSelectorName, ...ChainSelectorName[]]),
		chainId: z.number().int().positive(),
		secretOwner: filledAddress,
		secretNamespace: z.string().min(1),
		payoutAddress: filledAddress,
		schedule: z.string().regex(SCHEDULE, "a cron at a whole number of minutes: 0 */N * * * *").refine((s) => 60 % periodMinutes(s) === 0, "the minutes must divide the hour"),
		shards: z.number().int().min(1).max(MAX_SHARDS),
	})
	.strict()
	.superRefine((c, ctx) => {
		if (CHAINS[c.chainSelectorName].chainId !== c.chainId) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chainId"], message: `${c.chainSelectorName} is chain ${CHAINS[c.chainSelectorName].chainId}` });
		}
		if (!ADDRESS.test(c.payoutAddress) || !ADDRESS.test(c.receiverAddress) || !ADDRESS.test(c.eventAddress)) return;
		if (BigInt(c.payoutAddress) <= MAX_RESERVED) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payoutAddress"], message: "the payout is in the reserved range, up to 0xffff" });
		}
		for (const [k, v] of [["receiverAddress", c.receiverAddress], ["eventAddress", c.eventAddress]] as const) {
			if (v.toLowerCase() === c.payoutAddress.toLowerCase()) {
				ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payoutAddress"], message: `the payout is the ${k}` });
			}
		}
		if (c.receiverAddress.toLowerCase() === c.eventAddress.toLowerCase()) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eventAddress"], message: "the reporter and the games set are one address" });
		}
	});
export type Config = z.infer<typeof configSchema>;

function periodMinutes(schedule: string): number {
	const m = SCHEDULE.exec(schedule);
	return m === null ? 0 : Number(m[1]);
}

/** The seconds between two ticks of the schedule. */
export function periodOf(schedule: string): number {
	const minutes = periodMinutes(schedule);
	if (minutes === 0) throw new Error(`not a tick schedule: ${schedule}`);
	return minutes * 60;
}

/** Shard k's own cron: the schedule with its seconds field moved, so the shards fire apart inside the minute. */
export function shardScheduleOf(schedule: string, index: number, shards: number): string {
	if (!Number.isInteger(index) || !Number.isInteger(shards) || shards < 1 || shards > MAX_SHARDS || index < 0 || index >= shards) {
		throw new Error(`shard ${index} of ${shards}`);
	}
	periodOf(schedule);
	const second = index * Math.floor(60 / shards);
	return `${second}${schedule.slice(1)}`;
}

// ──────────────────────────── The tick's constants ─────────────────

/**
 * The platform's quotas per execution that the tick budgets against, as the service-quotas page gives
 * them (last updated 2026-09-16) and the pinned CLI exports them: chain reads, and confidential HTTP
 * requests. A tick stays under both by its own count, so the platform's refusal is never what stops it.
 */
export const READS_PER_EXECUTION = 15;
export const REQUESTS_PER_EXECUTION = 15;

/**
 * What the tick keeps for one full read before it starts one: the most a scoring run asked on the saved
 * cases is 8 (3/3/1/1 by seat), and the probe's answer at seat 3 is reused, so 10 holds a run that
 * pages once more at a seat. A verification is the tick's first act, with the whole count in hand: a
 * start asks 18 and sends 11 distinct on the saved cases.
 */
export const FULL_READ_RESERVE = 10;

/** The chain reads one full read makes: the identity, the readings, the reporters, the coin, the approved list, the payout's record. */
export const READS_PER_FULL_READ = 6;

/**
 * The chain reads one probe makes: the game's identity (its hints, and its teams for the spare) and its
 * readings (the start report, which says which seat the probe asks; a disputed game's votes). A full
 * read on the probe's final has both in hand.
 */
export const READS_PER_PROBE = 2;

/**
 * The open list's pages one shard reads in a tick: its first page every tick, and one other of its
 * pages in turn, so a list longer than its pages is covered over ticks and the reads for the probes
 * and the full read stay in hand (1 for the header, 2 here, 6 for a full read, the rest for probes).
 */
export const PAGES_PER_TICK = 2;

/**
 * When the tick verifies a game the creation trigger's run left unverified (the feeds list a game
 * days ahead, a creator may create it months ahead): from seven days before its date, on the hour's
 * first tick, as that tick's one full read; and until two days past its date, after which no feed
 * will list it (the start may lie a day past the date, and a feed lists a game by the time it is
 * played). The games set's own bound is its day-30 release.
 */
export const VERIFY_BEFORE = 7 * 86_400;
export const VERIFY_AFTER = 2 * 86_400;

/**
 * Which tick of the hour does the hour's reads that are not a verification: a disputed game's full
 * read, and a clock past its window. The first tick is the verification's, so neither keeps the
 * other from its hour; a schedule divides the hour, so the second tick exists.
 */
export const HOURLY_TICK = 1;

/**
 * How long after a clock runs out the tick keeps running the full read for the game on every tick, in
 * seconds, before it falls back to the hour's second tick (HOURLY_TICK). A clock read that keeps
 * deciding to wait (a game the feeds dropped) would otherwise take every tick's one full read for days.
 */
export const CLOCK_WINDOW = 2 * 3_600;

/**
 * The first probe at the start plus the league's expected duration, in seconds. From the card's table;
 * observed durations replace it after a month. A league missing here is not probed, and the program
 * does not offer it either.
 */
export const EXPECTED_DURATION: Readonly<Record<string, number>> = Object.freeze({
	nfl: 3 * 3_600,
	ncaaf: 3 * 3_600 + 15 * 60,
	nba: 2 * 3_600 + 30 * 60,
	ncaab: 2 * 3_600,
	mlb: 2 * 3_600 + 45 * 60,
	nhl: 2 * 3_600 + 30 * 60,
});

// ──────────────────────────── The games set ────────────────────────

const HINT = { type: "tuple", components: [{ name: "seat", type: "uint8" }, { name: "id", type: "string" }] } as const;
const TERMS = {
	type: "tuple",
	components: [
		{ name: "window", type: "uint64" },
		{ name: "day7Clock", type: "uint64" },
		{ name: "day30Clock", type: "uint64" },
		{ name: "fee", type: "uint96" },
	],
} as const;
const READING = {
	type: "tuple",
	components: [
		{ name: "seat", type: "uint8" },
		{ name: "kind", type: "uint8" },
		{ name: "homeScore", type: "uint32" },
		{ name: "awayScore", type: "uint32" },
	],
} as const;

/** GameCreated, as IOspexGames emits it: the game's identity, which the games set does not store. */
export const GAME_CREATED = {
	type: "event",
	name: "GameCreated",
	inputs: [
		{ name: "gameId", type: "uint256", indexed: true },
		{ name: "creator", type: "address", indexed: true },
		{ name: "league", type: "string" },
		{ name: "homeTeam", type: "string" },
		{ name: "awayTeam", type: "string" },
		{ name: "date", type: "uint64" },
		{ name: "hints", ...HINT, type: "tuple[]" },
		{ name: "terms", ...TERMS },
		{ name: "reporters", type: "address[]" },
		{ name: "kinds", type: "uint8[]" },
	],
} as const;

/** GameReported, as IOspexGames emits it for every report it takes. The readings are not stored. */
export const GAME_REPORTED = {
	type: "event",
	name: "GameReported",
	inputs: [
		{ name: "gameId", type: "uint256", indexed: true },
		{ name: "reporter", type: "address", indexed: true },
		{ name: "kind", type: "uint8", indexed: true },
		{ name: "start", type: "uint64" },
		{ name: "homeScore", type: "uint32" },
		{ name: "awayScore", type: "uint32" },
		{ name: "readings", ...READING, type: "tuple[]" },
		{ name: "payout", type: "address" },
	],
} as const;

export const GAME_CREATED_TOPIC: Hex = toEventSelector(GAME_CREATED);
export const GAME_REPORTED_TOPIC: Hex = toEventSelector(GAME_REPORTED);

/**
 * One game on the games set's open list, as the tick reads it: the game's own words that say whether
 * it is due, its league, and the creator's date, which an unverified game is verified from (its start
 * is 0 until written). The hints are not here: the row's size is fixed with the league bounded, and
 * the tick reads the identity of the few games it probes. The tuple is decoded in the games set's
 * order, `OpenGame` in its interface, and abi.test.ts pins it field for field against that interface's
 * ABI (abi/IOspexGames.json), so a row the games set changed fails the suite, never the tick.
 */
const OPEN_GAME = {
	type: "tuple",
	components: [
		{ name: "gameId", type: "uint256" },
		{ name: "status", type: "uint8" },
		{ name: "start", type: "uint64" },
		{ name: "window", type: "uint64" },
		{ name: "day7Clock", type: "uint64" },
		{ name: "disputedAt", type: "uint64" },
		{ name: "league", type: "string" },
		{ name: "date", type: "uint64" },
	],
} as const;

/**
 * The games set's reads the workflow takes, each as IOspexGames gives it (abi/IOspexGames.json, pinned
 * by abi.test.ts): `getGameReadings` gives the start report's readings whole and each seat's last vote
 * in the order the seats first voted, with the dispute clock; `getOpenGames` gives rows, the tuple
 * above, and the list's total. `i_token` is the games set's own public coin, not in the interface.
 */
export const GAMES_READS = [
	{ type: "function", name: "getGameStatus", stateMutability: "view", inputs: [{ name: "gameId", type: "uint256" }], outputs: [{ type: "uint8" }] },
	{ type: "function", name: "getGameStart", stateMutability: "view", inputs: [{ name: "gameId", type: "uint256" }], outputs: [{ type: "uint64" }] },
	{ type: "function", name: "getGameDisputedAt", stateMutability: "view", inputs: [{ name: "gameId", type: "uint256" }], outputs: [{ type: "uint64" }] },
	{ type: "function", name: "getApprovedReporters", stateMutability: "view", inputs: [], outputs: [{ name: "reporters", type: "address[]" }, { name: "kinds", type: "uint8[]" }] },
	{ type: "function", name: "getReporter", stateMutability: "view", inputs: [{ name: "reporter", type: "address" }], outputs: [{ name: "kind", type: "uint8" }, { name: "retired", type: "bool" }, { name: "codeHash", type: "bytes32" }] },
	{ type: "function", name: "i_token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
	{ type: "function", name: "getGameReporters", stateMutability: "view", inputs: [{ name: "gameId", type: "uint256" }], outputs: [{ name: "reporters", type: "address[]" }, { name: "kinds", type: "uint8[]" }] },
	{
		type: "function",
		name: "getOpenGames",
		stateMutability: "view",
		inputs: [{ name: "offset", type: "uint256" }, { name: "count", type: "uint256" }],
		outputs: [{ name: "rows", ...OPEN_GAME, type: "tuple[]" }, { name: "total", type: "uint256" }],
	},
	{
		type: "function",
		name: "getGameIdentity",
		stateMutability: "view",
		inputs: [{ name: "gameId", type: "uint256" }],
		outputs: [{ name: "league", type: "string" }, { name: "homeTeam", type: "string" }, { name: "awayTeam", type: "string" }, { name: "date", type: "uint64" }, { name: "hints", ...HINT, type: "tuple[]" }],
	},
	{
		type: "function",
		name: "getGameReadings",
		stateMutability: "view",
		inputs: [{ name: "gameId", type: "uint256" }],
		outputs: [{ name: "startReadings", ...READING, type: "tuple[]" }, { name: "votes", ...READING, type: "tuple[]" }, { name: "disputedAt", type: "uint64" }],
	},
] as const;

/**
 * The rows of the open list one read asks for. The games set measures its row at 352 bytes encoded and
 * pins 70 rows a page under the 25,000 bytes an answer may be (71 are 25,088). 64 rows are 22,624
 * bytes with the answer's own two words, under 25,000 and under 25 KB read as 25,600.
 */
export const OPEN_PAGE = 64;

/** The games set's GameStatus, by number, to the program's names. 0 (None) is never a game. */
export const GAME_STATUS = Object.freeze({
	1: "unverified",
	2: "verified",
	3: "disputed",
	4: "scored",
	5: "voided",
	6: "released",
} as const);

/** The games set's ReportKind numbers, which the program's REPORT_KIND already carries. */
export const KIND_START = REPORT_KIND.start;
export const KIND_DISPUTE = REPORT_KIND.dispute;

/** The calldata of one read. */
export function readCall(name: (typeof GAMES_READS)[number]["name"], args: readonly unknown[]): Hex {
	return encodeFunctionData({ abi: GAMES_READS, functionName: name, args: args as never });
}

/** A read's answer, decoded by the read's outputs. */
export function readAnswer(name: (typeof GAMES_READS)[number]["name"], data: Hex): readonly unknown[] {
	const fn = GAMES_READS.find((f) => f.name === name);
	if (!fn) throw new Error(`no read ${name}`);
	return decodeAbiParameters(fn.outputs, data);
}

// ──────────────────────────── The creation event ───────────────────

/** A game as its creation event carries it, with the block the event is in. */
export interface Creation {
	readonly gameId: bigint;
	readonly creator: Address;
	readonly league: string;
	readonly home: string;
	readonly away: string;
	readonly date: number;
	readonly hints: ReadonlyArray<{ readonly seat: number; readonly id: string }>;
	readonly terms: { readonly window: number; readonly day7Clock: number; readonly day30Clock: number; readonly fee: bigint };
	readonly reporters: readonly Address[];
	readonly kinds: readonly number[];
	readonly blockNumber: bigint;
}

/** A log as the workflow sees it, whatever carried it. */
export interface RawLog {
	readonly topics: readonly Hex[];
	readonly data: Hex;
	readonly blockNumber: bigint;
}

function seconds(v: bigint, what: string): number {
	if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${what} is not a safe number of seconds`);
	return Number(v);
}

/** The creation event, decoded. Refuses a log that is not a GameCreated. */
export function decodeGameCreated(log: RawLog): Creation {
	const d = decodeEventLog({ abi: [GAME_CREATED], data: log.data, topics: log.topics as [Hex, ...Hex[]] });
	const a = d.args;
	// Addresses are carried lowercase everywhere here: the chain's bytes have no case, and every compare
	// downstream is by value.
	return {
		gameId: a.gameId,
		creator: a.creator.toLowerCase() as Address,
		league: a.league,
		home: a.homeTeam,
		away: a.awayTeam,
		date: seconds(a.date, "the date"),
		hints: a.hints.map((h) => ({ seat: h.seat, id: h.id })),
		terms: {
			window: seconds(a.terms.window, "n"),
			day7Clock: seconds(a.terms.day7Clock, "the day-7 clock"),
			day30Clock: seconds(a.terms.day30Clock, "the day-30 clock"),
			fee: a.terms.fee,
		},
		reporters: a.reporters.map((r) => r.toLowerCase() as Address),
		kinds: [...a.kinds],
		blockNumber: log.blockNumber,
	};
}

/** One report the games set took, as its event carries it. */
export interface Reported {
	readonly gameId: bigint;
	readonly reporter: Address;
	readonly kind: number;
	readonly start: number;
	readonly homeScore: number;
	readonly awayScore: number;
	readonly readings: readonly ReportReading[];
	readonly payout: Address;
	readonly blockNumber: bigint;
}

/** A GameReported event, decoded. */
export function decodeGameReported(log: RawLog): Reported {
	const d = decodeEventLog({ abi: [GAME_REPORTED], data: log.data, topics: log.topics as [Hex, ...Hex[]] });
	const a = d.args;
	return {
		gameId: a.gameId,
		reporter: a.reporter,
		kind: a.kind,
		start: seconds(a.start, "the start"),
		homeScore: a.homeScore,
		awayScore: a.awayScore,
		readings: a.readings.map((r) => ({ seat: r.seat, kind: toReadingKind(r.kind), homeScore: r.homeScore, awayScore: r.awayScore })),
		payout: a.payout.toLowerCase() as Address,
		blockNumber: log.blockNumber,
	};
}

function toReadingKind(k: number): 0 | 1 | 2 {
	if (k === READING_KIND.silent || k === READING_KIND.noFinal || k === READING_KIND.final) return k;
	throw new Error(`a reading kind the games set does not have: ${k}`);
}

/** A 32-byte topic for a uint256 or a small number. */
export function topicOf(n: bigint | number): Hex {
	return `0x${BigInt(n).toString(16).padStart(64, "0")}`;
}

// ──────────────────────────── The one report shape ─────────────────

/**
 * The games set's Report, as the reporter decodes it: abi.decode(report, (Report)). One dynamic tuple,
 * so the bytes are an offset word and the tuple, exactly what abi.encode(Report) gives in Solidity; the
 * reporter encodes what it decoded and refuses any other bytes, so this is the one shape.
 */
export const REPORT_TUPLE = {
	type: "tuple",
	components: [
		{ name: "gameId", type: "uint256" },
		{ name: "kind", type: "uint8" },
		{ name: "start", type: "uint64" },
		{ name: "homeScore", type: "uint32" },
		{ name: "awayScore", type: "uint32" },
		{ name: "readings", ...READING, type: "tuple[]" },
		{ name: "payout", type: "address" },
	],
} as const;

const GAME_ID = /^[1-9][0-9]{0,77}$/;
const KINDS: readonly number[] = Object.values(REPORT_KIND);
const READING_KINDS: readonly number[] = Object.values(READING_KIND);

/**
 * The report's bytes, from the program's Report and nothing else: every field is carried as decided,
 * and a field outside its type's range is refused here rather than wrapped by the encoder.
 */
export function encodeReport(r: Report): Hex {
	if (!GAME_ID.test(r.gameId)) throw new Error("the game id is not a uint256 the games set could issue");
	if (!KINDS.includes(r.kind)) throw new Error(`a report kind the games set does not have: ${r.kind}`);
	if (!ADDRESS.test(r.payout)) throw new Error("the payout is not an address");
	for (const x of r.readings) {
		if (!Number.isInteger(x.seat) || x.seat < 0 || x.seat > 255) throw new Error("a reading's seat is not a uint8");
		if (!READING_KINDS.includes(x.kind)) throw new Error(`a reading kind the games set does not have: ${x.kind}`);
		for (const s of [x.homeScore, x.awayScore]) if (!Number.isInteger(s) || s < 0 || s > 0xffffffff) throw new Error("a reading's score is not a uint32");
	}
	for (const s of [r.homeScore, r.awayScore]) if (!Number.isInteger(s) || s < 0 || s > 0xffffffff) throw new Error("a score is not a uint32");
	if (!Number.isInteger(r.start) || r.start < 0 || r.start > Number.MAX_SAFE_INTEGER) throw new Error("the start is not a uint64");
	return encodeAbiParameters([REPORT_TUPLE], [
		{
			gameId: BigInt(r.gameId),
			kind: r.kind,
			start: BigInt(r.start),
			homeScore: r.homeScore,
			awayScore: r.awayScore,
			readings: r.readings.map((x) => ({ seat: x.seat, kind: x.kind, homeScore: x.homeScore, awayScore: x.awayScore })),
			payout: r.payout as Address,
		},
	]);
}

/** The bytes back to a Report, the way the reporter decodes them (tests, and the record). */
export function decodeReport(bytes: Hex): Report {
	const [d] = decodeAbiParameters([REPORT_TUPLE], bytes);
	return {
		gameId: d.gameId.toString(),
		kind: d.kind as Report["kind"],
		start: seconds(d.start, "the start"),
		homeScore: d.homeScore,
		awayScore: d.awayScore,
		readings: d.readings.map((x) => ({ seat: x.seat, kind: toReadingKind(x.kind), homeScore: x.homeScore, awayScore: x.awayScore })),
		payout: d.payout.toLowerCase(),
	};
}

// ──────────────────────────── The seat keys ────────────────────────

/** Each seat's secret, by the name it is created under in the vault. */
export const SECRET_IDS: Readonly<Record<Seat, string>> = Object.freeze({ 1: "SEAT1_KEY", 2: "SEAT2_KEY", 3: "SEAT3_KEY", 4: "SEAT4_KEY" });

/** The stand-in the confidential transport fills inside the enclave, for a key that goes in a header. */
export function placeholderFor(seat: Seat): string {
	return `{{.${SECRET_IDS[seat]}}}`;
}

/** The secret a header's value stands for, or null when it is a plain value. */
export function secretOfHeader(value: string): string | null {
	const m = /^\{\{\.([A-Z0-9_]+)\}\}$/.exec(value);
	return m === null ? null : m[1];
}

/**
 * The keys handed to the program: one per seat of the table, and nothing else. A seat whose key goes in
 * a header gets the stand-in, which the enclave fills, so the key never enters the workflow. A seat whose
 * key goes in the query gets the value handed in (read from the vault at the run), since the transport
 * fills headers and bodies and not the URL; that key rides in the workflow's memory for the request.
 */
export function keysFor(queryKeys: Readonly<Partial<Record<Seat, string>>>): Keys {
	const out: Partial<Record<Seat, string>> = {};
	for (const row of SEATS) {
		if ("header" in row.key) out[row.seat] = placeholderFor(row.seat);
		else {
			const v = queryKeys[row.seat];
			if (typeof v === "string" && v !== "") out[row.seat] = v;
		}
	}
	return out;
}

/** The seats whose key goes in the query, which the run reads from the vault. */
export function querySeats(): readonly Seat[] {
	return SEATS.filter((r) => "query" in seatRow(r.seat).key).map((r) => r.seat);
}

// ──────────────────────────── The transport, bounded ───────────────

/**
 * A transport that answers a request it already made in this run from memory: the same method, URL and
 * headers give the same answer. A run asks some requests twice (verification's probe near the date and
 * its re-read in the window share filing dates; the tick's probe at seat 3 and the full read it leads
 * to share the result), and the platform counts each request it sends; this keeps the count to the
 * distinct ones. A request that throws is not kept, so the next ask of it sends again.
 */
export function memoized(send: (req: HttpRequest) => HttpResponse): (req: HttpRequest) => HttpResponse {
	const seen = new Map<string, HttpResponse>();
	return (req) => {
		const headers = Object.entries(req.headers)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${k}: ${v}`)
			.join("\n");
		const key = `${req.method} ${req.url}\n${headers}`;
		const hit = seen.get(key);
		if (hit !== undefined) return hit;
		const res = send(req);
		seen.set(key, res);
		return res;
	};
}

/** A transport that refuses the request past the limit, before sending, so the run's own count is what stops it. */
export function counted(send: (req: HttpRequest) => HttpResponse, limit: number): { send: (req: HttpRequest) => HttpResponse; used: () => number } {
	let used = 0;
	return {
		used: () => used,
		send(req) {
			if (used >= limit) throw new Error(`the run's ${limit} requests are used`);
			used++;
			return send(req);
		},
	};
}

// ──────────────────────────── The probe ────────────────────────────

/**
 * The seat the tick probes for a game, following the start report: seat 3, read by its hint in one
 * request, when the start report shows it readable; otherwise the spare, which stands in for it. The
 * rule is the program's own (silentForGame): a game created without a usable seat 3 hint, or whose
 * hint failed the board check at verification, has seat 3 silent for the whole game, and the program
 * never asks it, so a probe there would ask a seat the full read will not read. The probe asks only
 * whether the game is over. A reading says final when it carries a final, or when the feed says the
 * game is over without points the program could take.
 */
export function probeSeatFor(game: Pick<ChainGame, "hints" | "startReadings">): Seat {
	return silentForGame(game) === 3 ? SPARE : 3;
}

export function saysFinal(r: Reading): boolean {
	return r.kind === "final" || r.saysFinal === true;
}
