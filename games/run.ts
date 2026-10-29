// One run for one game: hand the game, as the chain holds it, to the scoring program with the keys,
// the payout address, the chain's clock and what the games set refuses as a payout, and write the
// report it decided, if it decided one. The wrapper's whole job is in this file, and it is written
// against interfaces so a test can run it with a fake chain, saved feed answers and a recording writer.
//
// What the wrapper never does: it decides nothing. The report it writes is the program's Report,
// encoded as the one shape, field for field; a run the program decided to wait on writes nothing. The
// payout address it hands the program comes from the config, inside the fingerprint, and the program
// puts it in the report's own field and nowhere else.

import type { Address, Hex } from "viem";
import type { Decision, ChainGame, Report } from "../scoring/src/chain";
import type { Keys } from "../scoring/src/keys";
import { cleanLine } from "../scoring/src/line";
import { scoreGameSync } from "../scoring/src/program";
import type { HttpRequest, HttpResponse } from "../scoring/src/types";
import { readPayoutRefused, type Evm } from "./chain";
import { encodeReport } from "./lib";

/** What a run needs from outside. */
export interface Deps {
	readonly evm: Evm;
	/** The games set. */
	readonly games: Address;
	/** The payout address from the config: the operator's wallet, inside the fingerprint. */
	readonly payout: string;
	/** Each seat's key, as the transport fills it. */
	readonly keys: Keys;
	/** The transport: one request, one answer, as the readers ask. */
	readonly send: (req: HttpRequest) => HttpResponse;
	/** Writes the report's bytes through the reporter; returns the transaction's hash, or null if unknown. */
	readonly write: (report: Hex) => string | null;
	/** The program. Tests may hand in a stand-in; the workflow hands in nothing and gets the real one. */
	readonly score?: typeof scoreGameSync;
}

/** What one run did. */
export interface Run {
	readonly game: ChainGame;
	readonly now: number;
	readonly decision: Decision;
	readonly report: Report | null;
	/** The bytes written, or null when nothing was. */
	readonly written: Hex | null;
	readonly txHash: string | null;
}

/**
 * Runs the program for one game and writes what it decided. The game is handed in as the chain holds
 * it (from the creation event for a start, from state for an end); the run adds what the games set
 * refuses as a payout, read from the chain with the game's own reporters, and the chain's clock.
 */
export function runGame(deps: Deps, game: Omit<ChainGame, "payoutRefused">, reporters: readonly Address[], clock?: number): Run {
	const refused = readPayoutRefused(deps.evm, deps.games, reporters, deps.payout);
	const held: ChainGame = { ...game, payoutRefused: refused };
	// The chain's clock: read here, or handed in by a tick that read it already for this run.
	const now = clock ?? deps.evm.latest().timestamp;
	const outcome = (deps.score ?? scoreGameSync)(held, deps.keys, deps.payout, now, deps.send);
	if (outcome.report === null) return { game: held, now, decision: outcome.decision, report: null, written: null, txHash: null };
	const written = encodeReport(outcome.report);
	const txHash = deps.write(written);
	return { game: held, now, decision: outcome.decision, report: outcome.report, written, txHash };
}

/**
 * The run's one line for the log, its `why` through the one function every line goes through before it is
 * written (scoring/src/line.ts), with the configured secret values to redact; the program cleaned the
 * `why` already, and the line is made here.
 */
export function summarize(run: Run, secrets: readonly string[]): string {
	return JSON.stringify({
		gameId: run.game.id,
		status: run.game.status,
		now: run.now,
		action: run.decision.action,
		why: cleanLine(run.decision.why, secrets),
		kind: run.report?.kind ?? null,
		written: run.written !== null,
		txHash: run.txHash,
	});
}
