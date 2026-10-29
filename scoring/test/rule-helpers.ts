// Readings built by hand for the rule's sweeps, and the real games the end-to-end checks read.
//
// A sweep gives each of the four seats one of four states: silent, answered without a final, or
// answered with one of two different finals. Every combination is decided, so a property is
// checked against the whole space, never a sample.
//
// The values are chosen so a careless comparison can't pass. B is A with the teams' points swapped:
// the same total and the same pair of numbers, so a rule comparing finals by total or as an
// unordered pair reads them as one final. An answer without a final carries A's points, as a game
// still on, or a record kept from a run before, can, so a rule that counts points without checking
// "final" reads it as agreeing with A. (rule-pairs.test.ts holds the other ways two finals differ.)
//
// An answer without a final shows the game's own record, as seat 3's result does (a record with no
// time): it is an answer about the game, so it sets a seat's vote (rule.ts, answers). A feed that
// doesn't give the game reads silent here; pick.ts's "absent" is built where a test needs it.

import type { ChainGame, ReportReading } from "../src/chain";
import type { Reading, Seat } from "../src/types";
import type { Window } from "../src/window";
import { CASES } from "./cases";

export type State = "silent" | "none" | "A" | "B";
export const STATES: readonly State[] = ["silent", "none", "A", "B"];

/** The two finals: the same two teams, the points swapped. */
export const POINTS: Readonly<Record<"A" | "B", readonly [number, number]>> = { A: [27, 20], B: [20, 27] };

/** The points an answer without a final carries: A's. */
export const LIVE: readonly [number, number] = POINTS.A;

export function reading(seat: Seat, s: State): Reading {
	// The sweeps' silence is clean silence (types.ts, answer): a feed with nothing of the game.
	if (s === "silent") return { seat, kind: "silent", home: null, away: null, recorded: null, detail: "silent", record: null, answer: "nothing" };
	if (s === "none") return { seat, kind: "no_final", home: LIVE[0], away: LIVE[1], recorded: null, detail: "in progress", record: { id: `r${seat}`, time: null }, answer: "the game" };
	const [home, away] = POINTS[s];
	return { seat, kind: "final", home, away, recorded: null, detail: "final", record: null, answer: "the game" };
}

export function reportReading(seat: Seat, s: State): ReportReading {
	if (s === "silent") return { seat, kind: 0, homeScore: 0, awayScore: 0 };
	if (s === "none") return { seat, kind: 1, homeScore: LIVE[0], awayScore: LIVE[1] };
	const [homeScore, awayScore] = POINTS[s];
	return { seat, kind: 2, homeScore, awayScore };
}

/** Every assignment of a state to each of the four seats: 4^4 = 256. */
export function* everyFour(): Generator<readonly [State, State, State, State]> {
	for (const a of STATES) for (const b of STATES) for (const c of STATES) for (const d of STATES) yield [a, b, c, d];
}

export const SEATS4: readonly Seat[] = [1, 2, 3, 4];

/** A window for the rule's sweeps: their readings carry no time, so any window holds them. */
export const W: Window = { from: 1, to: 2 };

/** A real game from the readers' cases (test/cases.ts), as the chain would hold it once verified. */
export function chainOf(caseName: string, over: Partial<ChainGame> = {}): ChainGame {
	const c = CASES.find((x) => x.name.startsWith(caseName));
	if (!c) throw new Error(`no case ${caseName}`);
	const g = c.game;
	const seat3Usable = g.hints.some((h) => h.seat === 3);
	return {
		id: "42",
		league: g.league,
		home: g.home,
		away: g.away,
		date: g.start,
		hints: g.hints,
		n: g.n,
		day7: 7 * 86_400,
		status: "verified",
		start: g.start,
		// As verification would have written it: seats 1 and 2 listed the game; seat 3 listed it when
		// it has a usable hint, and is silent for the game otherwise; the spare listed it.
		startReadings: [
			{ seat: 1, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 2, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 3, kind: seat3Usable ? 1 : 0, homeScore: 0, awayScore: 0 },
			{ seat: 4, kind: 1, homeScore: 0, awayScore: 0 },
		],
		dispute: null,
		payoutRefused: PAYOUT_REFUSED,
		...over,
	};
}

/** A payout the games set takes: above the reserved range, and none of the addresses below. */
export const PAYOUT = "0x00000000000000000000000000000000000a1a1a";

/** Stand-ins for the games set's own address, its coin's and its reporters, as the chain would give them. */
export const PAYOUT_REFUSED = Object.freeze({
	gamesSet: "0x6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e",
	coin: "0xc01dc01dc01dc01dc01dc01dc01dc01dc01dc01d",
	reporters: Object.freeze(["0x7e9017e9017e9017e9017e9017e9017e9017e901", "0x7e9027e9027e9027e9027e9027e9027e9027e902"]),
});
