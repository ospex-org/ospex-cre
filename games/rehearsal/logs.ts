// How the fork delivery read a game past its creation from the games set at contracts-v2 main `4364295`,
// which stores no identity and no reading: the start report's readings and every dispute report from
// the games set's own events, read from the creation block. A fork serves such a read without a block
// limit; the platform does not, so the workflow reads them from state once the games set stores them,
// and this file stays with the rehearsal only, until the rehearsal is re-run against that games set.

import type { Address, Hex } from "viem";
import type { ChainGame, ReportReading } from "../../scoring/src/chain";
import { gameOfCreation, type Evm } from "../chain";
import { GAME_REPORTED_TOPIC, GAME_STATUS, KIND_DISPUTE, KIND_START, decodeGameReported, readAnswer, readCall, topicOf, type Creation, type RawLog } from "../lib";

/** The chain with a log query, as a fork serves it. */
export interface EvmWithLogs extends Evm {
	logs(address: Address, topics: readonly (Hex | null)[], fromBlock: bigint, toBlock: bigint): readonly RawLog[];
}

const ENDED: ReadonlySet<string> = new Set(["scored", "voided", "released"]);

function readStartReadings(evm: EvmWithLogs, games: Address, gameId: bigint, fromBlock: bigint, toBlock: bigint): readonly ReportReading[] | null {
	const logs = evm.logs(games, [GAME_REPORTED_TOPIC, topicOf(gameId), null, topicOf(KIND_START)], fromBlock, toBlock);
	if (logs.length === 0) return null;
	return decodeGameReported(logs[0]).readings;
}

function readDisputeRecords(evm: EvmWithLogs, games: Address, gameId: bigint, fromBlock: bigint, toBlock: bigint): readonly (readonly ReportReading[])[] {
	const logs = evm.logs(games, [GAME_REPORTED_TOPIC, topicOf(gameId), null, topicOf(KIND_DISPUTE)], fromBlock, toBlock);
	return logs.map((l) => decodeGameReported(l).readings);
}

/** A game as the games set at `4364295` lets a fork read it: its status and start from the reads, its readings from its events. */
export function gameFromLogs(evm: EvmWithLogs, games: Address, creation: Creation): Omit<ChainGame, "payoutRefused"> {
	const id = creation.gameId;
	const [statusNumber] = readAnswer("getGameStatus", evm.call(games, readCall("getGameStatus", [id]))) as [number];
	const status = (GAME_STATUS as Record<number, ChainGame["status"] | undefined>)[statusNumber];
	if (status === undefined) throw new Error(`a game status the games set does not have: ${statusNumber}`);
	const base = gameOfCreation(creation);
	if (status === "unverified") return base;
	if (ENDED.has(status)) return { ...base, status };
	const latest = evm.latest().number;
	const [start] = readAnswer("getGameStart", evm.call(games, readCall("getGameStart", [id]))) as [bigint];
	const startReadings = readStartReadings(evm, games, id, creation.blockNumber, latest);
	let dispute: ChainGame["dispute"] = null;
	if (status === "disputed") {
		const [at] = readAnswer("getGameDisputedAt", evm.call(games, readCall("getGameDisputedAt", [id]))) as [bigint];
		dispute = { at: Number(at), records: readDisputeRecords(evm, games, id, creation.blockNumber, latest) };
	}
	return { ...base, status, start: Number(start), startReadings, dispute };
}
