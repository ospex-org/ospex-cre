// The start's rule: when a game's start is written, and which time is written.
//
// The spec rules that the start is written once, at verification, by a first-n reporter, and is
// never corrected. It does not say which feeds must agree that the game exists or which time is
// written; this rule is the writer's proposal on the PR, with Vince's three rulings of 10/22 in it:
//
//   (2) seat 3's hint is checked against seat 3's board while the game is listed: the same two
//       teams, the same home and away, the time at the start. A hint that fails makes seat 3
//       silent for that game, never wrong.
//   (3) the start is the scheduled time from the counting seats, the earliest where they differ by
//       minutes. Seat 4's actual start never sets it. What to do when they differ by more is the
//       writer's to propose: see START_SPREAD.
//   (1) where the spec leaves it open, the spare stands in for a counting seat that is silent for
//       the game. A seat that answered without a final is not silent.
//
// As built:
//
//   * Seats 1 and 2 must each list the game, by team, within n of the creator's date (the range
//     the games set accepts a start in). Silent, or not listing it, and nothing is written: the run
//     waits, and a later run tries again.
//   * Their two times must lie within START_SPREAD of each other.
//   * Seat 3 passes when its hint's row names the game's teams in the game's order, at a time within
//     START_SPREAD of seats 1 and 2. A board it could not read this time makes the run wait. A hint
//     that fails, or a game created without a usable seat 3 hint, makes seat 3 silent for the game,
//     and the start report records it silent.
//   * Then the spare stands in: it must list the game, by team, within START_SPREAD of seats 1 and
//     2. Its time is checked, never written.
//   * The start written is the earliest scheduled time among seats 1 and 2, and seat 3 when it
//     passed.
//
// So the start is written only when three seats list the game within an hour of one another, the
// same count a score needs inside n, and the time is always a counting seat's schedule.

import { silent } from "./run";
import type { Decision } from "./chain";
import type { BoardCheck } from "./readers/board3";
import type { Reading, Seat } from "./types";

/**
 * The most the counting seats' scheduled times may differ by, in seconds, for the earliest to be
 * written. Measured on D1's 138 games: the seats agreed to the minute on 137, and the 138th differed
 * by 20 minutes (a late tip-off two seats moved toward). The two games of a doubleheader, or a
 * series' games on consecutive days, sit hours apart, so an hour separates "the same game, a
 * schedule a few minutes off" from "two different games". More than this, and nothing is written:
 * a start cannot be corrected once written, and a start an hour or more off either strands the game
 * outside its own window or lets an earlier game between the same two teams score it.
 */
export const START_SPREAD = 3600;

/** What verification saw: seats 1, 2 and 4 read by team near the date; seat 3's board checked. */
export interface Seen {
	readonly 1: Reading;
	readonly 2: Reading;
	readonly 3: BoardCheck;
	readonly 4: Reading;
}

/** The game as verification needs it. */
export interface Verifying {
	readonly date: number;
	readonly n: number;
}

/** The time a reading lists the game at, when it lists it within n of the date. */
function listedAt(r: Reading, g: Verifying): number | null {
	if (r.kind === "silent" || r.record === null || r.record.time === null) return null;
	const t = r.record.time;
	return t >= g.date - g.n && t <= g.date + g.n ? t : null;
}

function within(times: readonly number[]): boolean {
	return Math.max(...times) - Math.min(...times) <= START_SPREAD;
}

/** What verification decides: a start, or a wait. */
export function decideStart(g: Verifying, seen: Seen): Decision {
	const seat3Reading = (): Reading =>
		seen[3].kind === "listed"
			? { seat: 3, kind: "no_final", home: null, away: null, recorded: null, detail: "listed on the board", record: { id: seen[3].id, time: seen[3].time } }
			: silent(3, seen[3].kind === "fails" ? `silent for the game: ${seen[3].why}` : seen[3].why);
	const readings = (): Reading[] => [seen[1], seen[2], seat3Reading(), seen[4]];
	const wait = (why: string): Decision => ({ action: "wait", readings: readings(), why });

	for (const seat of [1, 2] as const) {
		const r = seen[seat];
		if (r.kind === "silent") return wait(`seat ${seat} is silent: ${r.detail}`);
		if (listedAt(r, g) === null) return wait(`seat ${seat} does not list the game within n of its date`);
	}
	const t1 = listedAt(seen[1], g) as number;
	const t2 = listedAt(seen[2], g) as number;
	if (!within([t1, t2])) return wait("seats 1 and 2 list the game more than an hour apart");

	const board = seen[3];
	if (board.kind === "silent") return wait(`seat 3's board is silent: ${board.why}`);
	const inRange = (t: number): boolean => t >= g.date - g.n && t <= g.date + g.n;
	if (board.kind === "listed" && inRange(board.time) && within([t1, t2, board.time])) {
		return { action: "start", start: Math.min(t1, t2, board.time), readings: readings(), why: "seats 1, 2 and 3 list the game within an hour" };
	}

	// Seat 3 is silent for the game: its hint failed, or its time is not at the start. The spare stands in.
	const down: Reading =
		board.kind === "listed"
			? silent(3, "silent for the game: board time not at the start")
			: silent(3, `silent for the game: ${board.why}`);
	const r4 = seen[4];
	const t4 = listedAt(r4, g);
	const settled = (why: string): Decision => ({ action: "wait", readings: [seen[1], seen[2], down, r4], why });
	if (r4.kind === "silent") return settled(`seat 3 is silent for the game and the spare is silent: ${r4.detail}`);
	if (t4 === null) return settled("seat 3 is silent for the game and the spare does not list the game within n of its date");
	if (!within([t1, t2, t4])) return settled("seat 3 is silent for the game and the spare lists the game more than an hour from seats 1 and 2");
	return { action: "start", start: Math.min(t1, t2), readings: [seen[1], seen[2], down, r4], why: "seats 1 and 2 list the game within an hour, and the spare stands in for seat 3" };
}

/** The seats verification reads by team; seat 3's board is checked apart. */
export const READ_BY_TEAM: readonly Seat[] = Object.freeze([1, 2, 4] as const);
