// A fake chain for the wrapper's tests: it answers the games set's reads for the games it holds, as the
// chain would, from ChainGames the test chose, and records every call. The wrapper is run against it
// with the scoring program's saved feed answers, so a test sees exactly what the wrapper would write
// for a real game without a chain or a feed. The reads are decoded from the calldata the wrapper sends,
// so the fake answers the same calls the chain would, and nothing else.

import { decodeFunctionData, encodeAbiParameters, type Address, type Hex } from "viem";
import type { ChainGame, PayoutRefused } from "../scoring/src/chain";
import { lastRecorded } from "../scoring/src/rule";
import type { Evm } from "./chain";
import { GAMES_READS, type Creation } from "./lib";

export const GAMES: Address = "0x6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e";
export const COIN: Address = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export const REPORTER: Address = "0x4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e";
export const RETIRED: Address = "0x5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e";
export const ZERO: Address = "0x0000000000000000000000000000000000000000";

const STATUS_NUMBER: Record<ChainGame["status"], number> = { unverified: 1, verified: 2, disputed: 3, scored: 4, voided: 5, released: 6 };
const ENDED: ReadonlySet<string> = new Set(["scored", "voided", "released"]);
const SEATS4 = [1, 2, 3, 4] as const;

/** The creation event a ChainGame came from, as the trigger would hand it. */
export function creationOf(game: ChainGame, reporters: readonly Address[] = [REPORTER], blockNumber = 96_000_000n): Creation {
	return {
		gameId: BigInt(game.id),
		creator: "0x7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c",
		league: game.league,
		home: game.home,
		away: game.away,
		date: game.date,
		hints: game.hints,
		terms: { window: game.n, day7Clock: game.day7, day30Clock: 30 * 86_400, fee: 1_000_000n },
		reporters,
		kinds: reporters.map(() => 1),
		blockNumber,
	};
}

export interface FakeOpts {
	readonly approved?: readonly Address[];
	readonly everApproved?: readonly Address[];
	readonly latestBlock?: bigint;
	readonly coin?: Address;
	/** Each game's recorded reporters, by id; the approved list by default. */
	readonly reporters?: Readonly<Record<string, readonly Address[]>>;
	/** Which games the open list shows: every game not ended, by default. */
	readonly open?: readonly string[];
}

export interface FakeCall {
	readonly to: Address;
	readonly name: string;
	readonly args: readonly unknown[];
}

export interface FakeChain extends Evm {
	readonly calls: FakeCall[];
	/** The names of the reads made, in order. */
	names(): string[];
}

function answerOf(name: (typeof GAMES_READS)[number]["name"], values: readonly unknown[]): Hex {
	const fn = GAMES_READS.find((f) => f.name === name)!;
	return encodeAbiParameters(fn.outputs, values as never);
}

/**
 * A chain holding some games: each one's status, start, start readings and dispute records come from
 * its ChainGame; the approved list and whether an address was ever a reporter from the options. The
 * latest block's timestamp is `now`. The open list is every game not ended, in id order.
 */
export function fakeChainOf(games: readonly ChainGame[], now: number, opts: FakeOpts = {}): FakeChain {
	const approved = opts.approved ?? [REPORTER];
	const everApproved = opts.everApproved ?? [...approved, RETIRED];
	const latestBlock = opts.latestBlock ?? 96_500_000n;
	const coin = opts.coin ?? COIN;
	const byId = new Map(games.map((g) => [g.id, g] as const));
	const calls: FakeCall[] = [];
	const gameOf = (id: bigint): ChainGame => {
		const g = byId.get(id.toString());
		if (g === undefined) throw new Error(`revert: unknown game ${id}`);
		return g;
	};
	const rowOf = (g: ChainGame) => ({
		gameId: BigInt(g.id),
		status: STATUS_NUMBER[g.status],
		start: BigInt(g.start ?? 0),
		window: BigInt(g.n),
		day7Clock: BigInt(g.day7),
		disputedAt: BigInt(g.dispute?.at ?? 0),
		league: g.league,
		date: BigInt(g.date),
	});
	return {
		calls,
		names: () => calls.map((c) => c.name),
		call(to, data) {
			const { functionName, args } = decodeFunctionData({ abi: GAMES_READS, data });
			calls.push({ to, name: functionName, args: args ?? [] });
			if (to.toLowerCase() !== GAMES.toLowerCase()) throw new Error("a call to an address that is not the games set");
			switch (functionName) {
				case "i_token":
					return answerOf("i_token", [coin]);
				case "getApprovedReporters":
					return answerOf("getApprovedReporters", [approved, approved.map(() => 1)]);
				case "getReporter": {
					const who = (args as [Address])[0].toLowerCase();
					const was = everApproved.some((a) => a.toLowerCase() === who);
					const retired = was && !approved.some((a) => a.toLowerCase() === who);
					return answerOf("getReporter", [was ? 1 : 0, retired, `0x${(was ? 9 : 0).toString(16).padStart(64, "0")}`]);
				}
				case "getGameStatus":
					return answerOf("getGameStatus", [STATUS_NUMBER[gameOf((args as [bigint])[0]).status]]);
				case "getGameStart": {
					const g = gameOf((args as [bigint])[0]);
					if (g.start === null) throw new Error("revert: the start is not written");
					return answerOf("getGameStart", [BigInt(g.start)]);
				}
				case "getGameDisputedAt": {
					const g = gameOf((args as [bigint])[0]);
					if (g.dispute === null) throw new Error("revert: no dispute record");
					return answerOf("getGameDisputedAt", [BigInt(g.dispute.at)]);
				}
				case "getGameReporters": {
					const g = gameOf((args as [bigint])[0]);
					const list = opts.reporters?.[g.id] ?? approved;
					return answerOf("getGameReporters", [list, list.map(() => 1)]);
				}
				case "getOpenGames": {
					// As the games set answers: the page from the offset, at most `count` long, clipped at the end.
					const [offset, count] = args as [bigint, bigint];
					const open = games.filter((g) => (opts.open === undefined ? !ENDED.has(g.status) : opts.open.includes(g.id))).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
					const page = open.slice(Number(offset), Number(offset) + Number(count)).map(rowOf);
					return answerOf("getOpenGames", [page, BigInt(open.length)]);
				}
				case "getGameIdentity": {
					const g = gameOf((args as [bigint])[0]);
					return answerOf("getGameIdentity", [g.league, g.home, g.away, BigInt(g.date), g.hints.map((h) => ({ seat: h.seat, id: h.id }))]);
				}
				case "getGameReadings": {
					// As the games set stores them: the start report's readings whole; each seat's last vote that
					// is not silent, in the order the seats first voted (here: the last seat first, so a fold that
					// trusted the order would show).
					const g = gameOf((args as [bigint])[0]);
					const start = g.startReadings === null ? [] : g.startReadings.map((r) => ({ seat: r.seat, kind: r.kind, homeScore: r.homeScore, awayScore: r.awayScore }));
					const votes =
						g.dispute === null
							? []
							: lastRecorded(g.dispute.records, SEATS4)
									.filter((v) => v.kind !== 0)
									.reverse()
									.map((v) => ({ seat: v.seat, kind: v.kind, homeScore: v.homeScore, awayScore: v.awayScore }));
					return answerOf("getGameReadings", [start, votes, BigInt(g.dispute?.at ?? 0)]);
				}
				default:
					throw new Error(`a read the fake chain does not answer: ${functionName}`);
			}
		},
		latest() {
			return { number: latestBlock, timestamp: now };
		},
	};
}

/** A chain holding one game. */
export function fakeChain(game: ChainGame, now: number, opts: FakeOpts = {}): FakeChain {
	return fakeChainOf([game], now, opts);
}

/** The refusals a fake chain's reads add up to, for an expectation. */
export function refusedOf(reporters: readonly Address[], coin: Address = COIN): PayoutRefused {
	return { gamesSet: GAMES, coin, reporters: [...reporters] };
}

/** A writer that records what it was handed and answers a fixed hash. */
export function recordingWriter(): { write: (report: Hex) => string | null; written: Hex[] } {
	const written: Hex[] = [];
	return {
		written,
		write(report) {
			written.push(report);
			return `0x${"ab".repeat(32)}`;
		},
	};
}
