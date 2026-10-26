// Turning a decision into the games set's one report shape. The payout address is the only thing here that
// comes from outside the program, and it lands in its own field and nowhere else: it reaches no
// count, no reading and no score.
//
// Only the reports that end a game carry it, a score and a void, since only they credit the creation
// dollar. A start and a dispute report pay nothing and carry the zero address: the games set refuses
// a start with any other payout (ospex-contracts-v2, src/games/OspexGames.sol, "a start pays
// nothing"), and the spec says a dispute record credits nothing; an update to one credits nothing
// either.
//
// The payout handed in is refused, whatever the report, when the games set would refuse it as the
// payout of a report that ends a game (OspexGames.sol, `_checkPayout`, on main at b9e9383): address 0,
// any address up to 0xffff (the range EIP-1352 sets aside for precompiles and a chain's own
// contracts), the games set's own address, its coin's, and any address ever approved as a reporter,
// retired ones included. The last three are read from the games set with the game (chain.ts). A
// deploy that set it wrong learns so at its first report, not at its first score.

import { READING_KIND, REPORT_KIND, type Decision, type PayoutRefused, type Report, type ReportReading } from "./chain";
import type { Reading } from "./types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
/** The highest address the games set refuses for where it lies: MAX_RESERVED_ADDRESS. */
const MAX_RESERVED = 0xffffn;
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

/** Why the games set would refuse this payout, or null if it would take it. */
export function payoutRefusal(payout: string, refused: PayoutRefused): string | null {
	const usable = (a: unknown): a is string => typeof a === "string" && ADDRESS.test(a) && BigInt(a) > MAX_RESERVED;
	if (!usable(refused.gamesSet) || !usable(refused.coin) || !Array.isArray(refused.reporters) || refused.reporters.length === 0 || !refused.reporters.every(usable)) {
		return "the games set's own address, its coin's or its reporters can't be read";
	}
	if (typeof payout !== "string" || !ADDRESS.test(payout)) return "the payout is not an address";
	if (BigInt(payout) === 0n) return "the payout is address 0";
	if (BigInt(payout) <= MAX_RESERVED) return "the payout is in the reserved range, up to 0xffff";
	const p = payout.toLowerCase();
	if (p === refused.gamesSet.toLowerCase()) return "the payout is the games set's own address";
	if (p === refused.coin.toLowerCase()) return "the payout is the coin's address";
	if (refused.reporters.some((r) => r.toLowerCase() === p)) return "the payout is an address approved as a reporter";
	return null;
}

/**
 * The report a decision writes, or null for a wait. Refuses a payout the games set would refuse as
 * the payout of a report that ends a game, whatever the report, and a game id it could not have issued.
 */
export function toReport(gameId: string, d: Decision, payout: string, refused: PayoutRefused): Report | null {
	if (d.action === "wait") return null;
	const why = payoutRefusal(payout, refused);
	if (why !== null) throw new Error(`the payout is not one the games set takes: ${why}`);
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
