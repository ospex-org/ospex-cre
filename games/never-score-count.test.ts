// Never: "A score is written on fewer than two agreeing finals, or fewer than three inside the window,
// or while any reported final disagrees, except as day 7 provides."
//
// The wrapper's half: it writes only what the program decided. A run the program decided to wait on
// writes nothing, and a report the program decided is written as the one shape, field for field, with
// nothing added, dropped or changed on the way. The counts themselves are the program's (its own
// never-line tests hold them); what is held here is that the wrapper cannot write past them.
//
// The break that turns this red (run.ts, runGame):
//   if (outcome.report === null) return { ... written: null, txHash: null };
//   ->  the line removed, and a score built from the readings written regardless.
// And a second: const written = encodeReport(outcome.report);
//   ->  const written = encodeReport({ ...outcome.report, kind: 2, homeScore: 1, awayScore: 0 });

import { describe, expect, test } from "bun:test";
import type { Outcome } from "../scoring/src/program";
import { LATE } from "../scoring/test/cases";
import { KEY, saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { decodeReport, keysFor } from "./lib";
import { runGame } from "./run";
import { GAMES, REPORTER, fakeChain, recordingWriter } from "./test-helpers";

const KEYS = keysFor({ 4: KEY });

function deps(game: ReturnType<typeof chainOf>, now: number, score?: (...a: never[]) => Outcome) {
	const chain = fakeChain(game, now);
	const writer = recordingWriter();
	const t = saved(undefined, now);
	return {
		chain,
		writer,
		run: () => runGame({ evm: chain, games: GAMES, payout: PAYOUT, keys: KEYS, send: t.send, write: writer.write, score: score as never }, game, [REPORTER]),
	};
}

describe("never: the wrapper writes only what the program decided", () => {
	test("a wait writes nothing", () => {
		const game = chainOf("nba final, read after the game");
		const d = deps(game, LATE, () => ({ decision: { action: "wait", readings: [], why: "a stand-in waits" }, report: null }));
		const run = d.run();
		expect([run.decision.action, run.report, run.written, run.txHash, d.writer.written.length]).toEqual(["wait", null, null, null, 0]);
	});

	test("a decided report is written as decided, field for field", () => {
		const game = chainOf("nba final, read after the game");
		const report = {
			gameId: game.id,
			kind: 2 as const,
			start: 0,
			homeScore: 114,
			awayScore: 106,
			readings: [
				{ seat: 1, kind: 2 as const, homeScore: 114, awayScore: 106 },
				{ seat: 2, kind: 2 as const, homeScore: 114, awayScore: 106 },
				{ seat: 3, kind: 0 as const, homeScore: 0, awayScore: 0 },
				{ seat: 4, kind: 2 as const, homeScore: 114, awayScore: 106 },
			],
			payout: PAYOUT,
		};
		const d = deps(game, LATE, () => ({ decision: { action: "score", home: 114, away: 106, readings: [], why: "a stand-in scores" }, report }));
		const run = d.run();
		expect(d.writer.written.length).toBe(1);
		expect(run.written).toBe(d.writer.written[0]);
		expect(decodeReport(run.written!)).toEqual(report);
	});

	test("the real program on a saved game: a final is written as the program scored it, a game not final writes nothing", () => {
		const game = chainOf("nba final, read after the game");
		const after = game.start! + game.n + 60;
		const final = deps(game, after);
		const run = final.run();
		expect([run.decision.action, run.report?.kind, run.report?.homeScore, run.report?.awayScore]).toEqual(["score", 2, 114, 106]);
		expect(final.writer.written.length).toBe(1);
		expect(decodeReport(final.writer.written[0])).toEqual(run.report!);

		const open = chainOf("nba not final");
		const waiting = deps(open, open.start! + 3600);
		const w = waiting.run();
		expect([w.decision.action, w.report, waiting.writer.written.length]).toEqual(["wait", null, 0]);
	});

	test("the clock the program decides by is the chain's, not the machine's", () => {
		// The same game read inside its window and after it: the decision moves with the chain's clock alone.
		const game = chainOf("nba final, read after the game");
		const inside = deps(game, game.start! + 3600);
		const afterN = deps(game, game.start! + game.n + 60);
		expect(inside.run().now).toBe(game.start! + 3600);
		expect(afterN.run().now).toBe(game.start! + game.n + 60);
	});
});
