// What the program reads from the chain about a game, what a run decides, and the one report shape
// it hands back to be written.
//
// The report shape and its enum numbers follow the games set's interface (ospex-contracts-v2,
// src/games/IOspexGames.sol). The report call takes the enums as numbers, so the numbers here are
// part of the shape. Nothing here names a feed: a reading carries its seat.

import type { Reading, Seat } from "./types";

/** The games set's ReadingKind. 0 is a real value there: a zeroed reading reads as silent. */
export const READING_KIND = Object.freeze({ silent: 0, noFinal: 1, final: 2 } as const);

/** The games set's ReportKind. 0 is no kind and is refused there, so it is never built here. */
export const REPORT_KIND = Object.freeze({ start: 1, score: 2, void: 3, dispute: 4 } as const);

/** One feed's reading as a report carries it, and as the chain gives it back in a report's event. */
export interface ReportReading {
	readonly seat: number;
	readonly kind: 0 | 1 | 2;
	/** For a feed that answered, the home team's points as it gave them; otherwise 0. */
	readonly homeScore: number;
	/** For a feed that answered, the away team's points as it gave them; otherwise 0. */
	readonly awayScore: number;
}

/** The one report shape, field for field the games set's `Report`. */
export interface Report {
	/** The game's id, a uint256 written in decimal. */
	readonly gameId: string;
	readonly kind: 1 | 2 | 3 | 4;
	/** For a start, the start in unix seconds; 0 for any other kind. */
	readonly start: number;
	/** For a score, the home team's points; 0 for any other kind. */
	readonly homeScore: number;
	/** For a score, the away team's points; 0 for any other kind. */
	readonly awayScore: number;
	/** One reading per feed asked, in seat order. */
	readonly readings: readonly ReportReading[];
	/** The payout address. It comes from outside the program and touches nothing else. */
	readonly payout: string;
}

/** Where a game stands on chain: the games set's GameStatus, by name. */
export type GameStatus = "unverified" | "verified" | "disputed" | "scored" | "voided" | "released";

/**
 * One game as the chain holds it. Every field is read from the games set: the creation event
 * (league, teams, which is home, the date, the hints, n and the day-7 clock as copied at creation),
 * the game's status and start, the start report's readings, and the dispute record, if any.
 */
export interface ChainGame {
	/** The game's id, a uint256 written in decimal. */
	readonly id: string;
	readonly league: string;
	readonly home: string;
	readonly away: string;
	/** The scheduled start the creator gave, unix seconds. The start is written from the feeds, not from this. */
	readonly date: number;
	/** The creation hints: a feed's own id for this game, by seat. Hints, never locks. */
	readonly hints: ReadonlyArray<{ readonly seat: number; readonly id: string }>;
	/** The game's n, seconds. */
	readonly n: number;
	/** The game's day-7 clock, seconds, counted from its first dispute record. */
	readonly day7: number;
	readonly status: GameStatus;
	/** The written start, unix seconds; null until verification writes it. */
	readonly start: number | null;
	/** The readings the start report carried; null until the start is written. */
	readonly startReadings: readonly ReportReading[] | null;
	/**
	 * The dispute record, or null if there is none: when its first report's block landed, and the
	 * readings of every dispute report the game has, the first one first, then each update in the
	 * order they landed. The day-7 clock runs from `at`, the first; an update never moves it.
	 */
	readonly dispute: { readonly at: number; readonly records: readonly (readonly ReportReading[])[] } | null;
	/**
	 * What the games set refuses as the payout of a report that ends a game, besides address 0 and the
	 * reserved range up to 0xffff: its own address, its coin's, and every address ever approved as a
	 * reporter, retired ones included. Read from the games set with the rest of the game.
	 */
	readonly payoutRefused: PayoutRefused;
}

/** The addresses, besides 0 and the reserved range, that the games set never takes as a payout. */
export interface PayoutRefused {
	readonly gamesSet: string;
	readonly coin: string;
	/** Every address ever approved as a reporter, retired ones included. Never empty: the games set's constructor writes the first. */
	readonly reporters: readonly string[];
}

/**
 * What a run decides. "wait" writes nothing. Every other action is one report, resting on
 * `readings`: one per seat asked, in seat order. A "dispute" on a game already disputed is an
 * update: the same report kind, crediting nothing.
 */
export type Decision =
	| { readonly action: "start"; readonly start: number; readonly readings: readonly Reading[]; readonly why: string }
	| {
			readonly action: "score";
			readonly home: number;
			readonly away: number;
			readonly readings: readonly Reading[];
			readonly why: string;
	  }
	| { readonly action: "void"; readonly readings: readonly Reading[]; readonly why: string }
	| { readonly action: "dispute"; readonly readings: readonly Reading[]; readonly why: string }
	| { readonly action: "wait"; readonly readings: readonly Reading[]; readonly why: string };

/** A reading as the program builds it, from one the chain gave back (a dispute report's). */
export function fromReportReading(r: ReportReading, detail: string): Reading {
	const seat = r.seat as Seat;
	if (r.kind === READING_KIND.final) {
		return { seat, kind: "final", home: r.homeScore, away: r.awayScore, recorded: null, detail, record: null, answer: "the game" };
	}
	if (r.kind === READING_KIND.noFinal) {
		return { seat, kind: "no_final", home: r.homeScore, away: r.awayScore, recorded: null, detail, record: null, answer: "the game" };
	}
	return { seat, kind: "silent", home: null, away: null, recorded: null, detail, record: null, answer: "nothing" };
}
