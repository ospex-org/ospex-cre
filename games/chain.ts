// What the workflow reads from the chain about a game, through a small interface over the EVM
// capability so the reads can be tested against a fake chain. Everything the program takes about a
// game comes from here: the creation event (the game's identity), the games set's reads (its status,
// its start, when its dispute record was written), the start report's readings and every dispute
// report in order (from the games set's own events), and what the games set refuses as a payout (its
// own address, its coin, its reporters).
//
// A game's events are read from its creation block, which the creation event gives. How a run for a
// game past its start finds that event is not decided here: see main.ts.

import type { Address, Hex } from "viem";
import type { ChainGame, PayoutRefused, ReportReading } from "../scoring/src/chain";
import {
	GAME_REPORTED_TOPIC,
	GAME_STATUS,
	KIND_DISPUTE,
	KIND_START,
	decodeGameReported,
	readAnswer,
	readCall,
	topicOf,
	type Creation,
	type RawLog,
} from "./lib";

/** The chain, as the reads need it. main.ts binds it to the EVM capability; tests bind a fake. */
export interface Evm {
	/** eth_call at the latest block: the answer's bytes. A revert throws. */
	call(to: Address, data: Hex): Hex;
	/** The logs of one address matching the topics (null matches anything in that position), in order. */
	logs(address: Address, topics: readonly (Hex | null)[], fromBlock: bigint, toBlock: bigint): readonly RawLog[];
	/** The latest block's number and its timestamp, unix seconds: the chain's clock. */
	latest(): { readonly number: bigint; readonly timestamp: number };
}

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

/** The readings of the game's one start report, from the games set's event, or null if none. */
export function readStartReadings(evm: Evm, games: Address, gameId: bigint, fromBlock: bigint, toBlock: bigint): readonly ReportReading[] | null {
	const logs = evm.logs(games, [GAME_REPORTED_TOPIC, topicOf(gameId), null, topicOf(KIND_START)], fromBlock, toBlock);
	if (logs.length === 0) return null;
	return decodeGameReported(logs[0]).readings;
}

/** Every dispute report the game has, the record first and each update after, in the order they landed. */
export function readDisputeRecords(evm: Evm, games: Address, gameId: bigint, fromBlock: bigint, toBlock: bigint): readonly (readonly ReportReading[])[] {
	const logs = evm.logs(games, [GAME_REPORTED_TOPIC, topicOf(gameId), null, topicOf(KIND_DISPUTE)], fromBlock, toBlock);
	return logs.map((l) => decodeGameReported(l).readings);
}

/**
 * One game as the chain holds it, for the program: the creation event's identity and terms, the games
 * set's status and start, the start report's readings, the dispute record, and the payout refusals. The
 * reads are the ones the status calls for: a game that has ended is read no further than its status,
 * since the program writes nothing to it.
 */
export function readGame(evm: Evm, games: Address, creation: Creation, refused: PayoutRefused): ChainGame {
	const id = creation.gameId;
	const [statusNumber] = readAnswer("getGameStatus", evm.call(games, readCall("getGameStatus", [id]))) as [number];
	const status = (GAME_STATUS as Record<number, ChainGame["status"] | undefined>)[statusNumber];
	if (status === undefined) throw new Error(`a game status the games set does not have: ${statusNumber}`);

	const base = {
		id: id.toString(),
		league: creation.league,
		home: creation.home,
		away: creation.away,
		date: creation.date,
		hints: creation.hints,
		n: creation.terms.window,
		day7: creation.terms.day7Clock,
		status,
		payoutRefused: refused,
	};
	if (status === "unverified" || ENDED.has(status)) return { ...base, start: null, startReadings: null, dispute: null };

	const latest = evm.latest().number;
	const [start] = readAnswer("getGameStart", evm.call(games, readCall("getGameStart", [id]))) as [bigint];
	const startReadings = readStartReadings(evm, games, id, creation.blockNumber, latest);
	let dispute: ChainGame["dispute"] = null;
	if (status === "disputed") {
		const [at] = readAnswer("getGameDisputedAt", evm.call(games, readCall("getGameDisputedAt", [id]))) as [bigint];
		dispute = { at: Number(at), records: readDisputeRecords(evm, games, id, creation.blockNumber, latest) };
	}
	return { ...base, start: Number(start), startReadings, dispute };
}
