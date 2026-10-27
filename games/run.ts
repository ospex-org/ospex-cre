// One run for one game: read the game from the chain, hand it to the scoring program with the keys,
// the payout address and the chain's clock, and write the report it decided, if it decided one. The
// wrapper's whole job is in this file, and it is written against interfaces so a test can run it with
// a fake chain, saved feed answers and a recording writer.
//
// What the wrapper never does: it decides nothing. The report it writes is the program's Report,
// encoded as the one shape, field for field; a run the program decided to wait on writes nothing. The
// payout address it hands the program comes from the config, inside the fingerprint, and the program
// puts it in the report's own field and nowhere else.

import type { Address, Hex } from "viem";
import type { Decision, ChainGame, Report } from "../scoring/src/chain";
import type { Keys } from "../scoring/src/keys";
import { scoreGameSync } from "../scoring/src/program";
import type { HttpRequest, HttpResponse } from "../scoring/src/types";
import { readGame, readPayoutRefused, type Evm } from "./chain";
import { encodeReport, type Creation } from "./lib";

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

/** Runs the program for one game and writes what it decided. */
export function runGame(deps: Deps, creation: Creation): Run {
	const refused = readPayoutRefused(deps.evm, deps.games, creation.reporters, deps.payout);
	const game = readGame(deps.evm, deps.games, creation, refused);
	const now = deps.evm.latest().timestamp;
	const outcome = (deps.score ?? scoreGameSync)(game, deps.keys, deps.payout, now, deps.send);
	if (outcome.report === null) return { game, now, decision: outcome.decision, report: null, written: null, txHash: null };
	const written = encodeReport(outcome.report);
	const txHash = deps.write(written);
	return { game, now, decision: outcome.decision, report: outcome.report, written, txHash };
}

/** The run's one line for the log. */
export function summarize(run: Run): string {
	return JSON.stringify({
		gameId: run.game.id,
		status: run.game.status,
		now: run.now,
		action: run.decision.action,
		why: run.decision.why,
		kind: run.report?.kind ?? null,
		written: run.written !== null,
		txHash: run.txHash,
	});
}
