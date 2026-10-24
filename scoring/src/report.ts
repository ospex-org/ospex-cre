// Turning a decision into the games set's one report shape. The payout address is the only thing here that
// comes from outside the program, and it lands in its own field and nowhere else: it reaches no
// count, no reading and no score.
//
// Only the reports that end a game carry it, a score and a void, since only they credit the creation
// dollar. A start and a dispute record pay nothing and carry the zero address: the games set refuses
// a start with any other payout (ospex-contracts-v2, src/games/OspexGames.sol, "a start pays
// nothing"), and the spec says a dispute record credits nothing.

import { READING_KIND, REPORT_KIND, type Decision, type Report, type ReportReading } from "./chain";
import type { Reading } from "./types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = /^0x0{40}$/;
/** A uint256 in decimal, no leading zero: the games set's ids start at 1. */
const GAME_ID = /^[1-9][0-9]{0,77}$/;

/** The payout field of a report that pays nothing. */
export const NO_PAYOUT = "0x0000000000000000000000000000000000000000";

/** A reading in the report's form: its seat, its kind, and for a feed that answered, its points. */
export function toReportReading(r: Reading): ReportReading {
	if (r.kind === "silent") return { seat: r.seat, kind: READING_KIND.silent, homeScore: 0, awayScore: 0 };
	return {
		seat: r.seat,
		kind: r.kind === "final" ? READING_KIND.final : READING_KIND.noFinal,
		homeScore: r.home ?? 0,
		awayScore: r.away ?? 0,
	};
}

/**
 * The report a decision writes, or null for a wait. Refuses a payout handed in that is not an
 * address, or is the zero address, whatever the report: a deploy that set it wrong learns so at its
 * first report, not at its first score. Refuses a game id the games set could not have issued.
 */
export function toReport(gameId: string, d: Decision, payout: string): Report | null {
	if (d.action === "wait") return null;
	if (!ADDRESS.test(payout) || ZERO.test(payout)) throw new Error("the payout is not a usable address");
	if (!GAME_ID.test(gameId)) throw new Error("the game id is not a uint256 the games set could issue");
	const readings = d.readings.map(toReportReading);
	switch (d.action) {
		case "start":
			return { gameId, kind: REPORT_KIND.start, start: d.start, homeScore: 0, awayScore: 0, readings, payout: NO_PAYOUT };
		case "score":
			return { gameId, kind: REPORT_KIND.score, start: 0, homeScore: d.home, awayScore: d.away, readings, payout };
		case "void":
			return { gameId, kind: REPORT_KIND.void, start: 0, homeScore: 0, awayScore: 0, readings, payout };
		case "dispute":
			return { gameId, kind: REPORT_KIND.dispute, start: 0, homeScore: 0, awayScore: 0, readings, payout: NO_PAYOUT };
	}
}
