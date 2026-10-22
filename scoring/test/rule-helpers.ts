// Readings built by hand for the rule's sweeps, and the real games the end-to-end checks read.
//
// A sweep gives each of the four seats one of four states: silent, answered without a final, or
// answered with one of two different finals. Every combination is decided, so a property is
// checked against the whole space, never a sample.

import type { ChainGame, ReportReading } from "../src/chain";
import type { Reading, Seat } from "../src/types";
import { CASES } from "./cases";

export type State = "silent" | "none" | "A" | "B";
export const STATES: readonly State[] = ["silent", "none", "A", "B"];

/** The two finals: different points, the same two teams. */
export const POINTS: Readonly<Record<"A" | "B", readonly [number, number]>> = { A: [27, 20], B: [27, 21] };

export function reading(seat: Seat, s: State): Reading {
	if (s === "silent") return { seat, kind: "silent", home: null, away: null, recorded: null, detail: "silent", record: null };
	if (s === "none") return { seat, kind: "no_final", home: 0, away: 0, recorded: null, detail: "scheduled", record: null };
	const [home, away] = POINTS[s];
	return { seat, kind: "final", home, away, recorded: null, detail: "final", record: null };
}

export function reportReading(seat: Seat, s: State): ReportReading {
	if (s === "silent") return { seat, kind: 0, homeScore: 0, awayScore: 0 };
	if (s === "none") return { seat, kind: 1, homeScore: 0, awayScore: 0 };
	const [homeScore, awayScore] = POINTS[s];
	return { seat, kind: 2, homeScore, awayScore };
}

/** Every assignment of a state to each of the four seats: 4^4 = 256. */
export function* everyFour(): Generator<readonly [State, State, State, State]> {
	for (const a of STATES) for (const b of STATES) for (const c of STATES) for (const d of STATES) yield [a, b, c, d];
}

export const SEATS4: readonly Seat[] = [1, 2, 3, 4];

/** A real game from D1's cases, as the chain would hold it once verified. */
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
		...over,
	};
}

export const PAYOUT = "0x00000000000000000000000000000000000000a1";
