// What a run tells a caller about each read of a seat it reached, for the record of an execution (the
// games workflow's run-line). It decides nothing. The program and the tick call it beside what they
// already do, and a fault in it is swallowed, so the record can never change a reading, a decision or
// a report.
//
// A read is one reader's run for one game, or seat 3's board check. Each read the run reaches ends as
// one of three:
//   answered  it asked, and its reading is usable: a final or an answer without one (the board: the
//             hint's row listed, or the check failed on the board's own answer);
//   silent    it asked, from the network or from the run's memory, and gave no usable reading;
//   skipped   it was reached and not asked: the seat silent for the game, closed (past its window, or
//             day 7), without a key, a reader that asks nothing for this game, or the caller's count
//             used up (a cut).

import type { Seat } from "./types";

export type ReadOutcome = "answered" | "silent" | "skipped";

/** Told of every read a run reaches. */
export interface Observer {
	read(seat: Seat, outcome: ReadOutcome): void;
}

/** How a read that ran ended: skipped when its reader asked nothing, answered when its reading is usable, silent otherwise. */
export function readOutcomeOf(asked: number, usable: boolean): ReadOutcome {
	if (asked === 0) return "skipped";
	return usable ? "answered" : "silent";
}

/** An observer's `read`, made safe to call from a run: whatever it does, the run goes on as if it were not there. */
export function noter(observer: Observer | undefined): (seat: Seat, outcome: ReadOutcome) => void {
	if (observer === undefined) return () => {};
	return (seat, outcome) => {
		try {
			observer.read(seat, outcome);
		} catch {
			// The record never stops a run.
		}
	};
}
