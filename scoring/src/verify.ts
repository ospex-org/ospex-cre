// The start's rule: when a game's start is written, and which time is written.
//
// The spec rules that the start is written once, at verification, by a first-n reporter, and is
// never corrected. The rule below says which feeds must agree that the game exists, which record on
// each feed is the game, and which time is written:
//
//   * Seat 3's hint is checked against seat 3's board while the game is listed: the same two teams,
//     the same home and away, the time at the start. A hint that fails makes seat 3 silent for that
//     game, never wrong.
//   * The start is the scheduled time from the counting seats, the earliest where they differ by
//     minutes. Seat 4's actual start never sets it.
//   * The spare stands in for a counting seat that is silent for the whole game. A seat that
//     answered without a final is not silent.
//   * The game is the one the creator's date names. On each seat read by team, the record nearest
//     the date is the game, and a hint never chooses another one here: a seat whose hint names a
//     different record makes the run wait. At scoring, hints still choose among the records in
//     the window (src/pick.ts).
//   * The start is written only if scoring will read the same game. Once a start is chosen, each
//     counting seat read by team is read again as scoring will read it: in [start, start + n), with
//     the hints and without the date. Each must read the same record inside that window.
//   * No start is written for a game already over. While any reading verification takes by team
//     shows the game final, nothing is written. A game still in play gets its start, late.
//
// As built:
//
//   * Seats 1 and 2 must each list the game, by team, within a day of the creator's date
//     (START_BOUND, the range the games set accepts a start in). Silent, or not listing it, and
//     nothing is written: the run waits, and a later run tries again.
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
import type { Game, Reading, Seat } from "./types";
import { inWindow, windowOf } from "./window";

/**
 * The most the counting seats' scheduled times may differ by, in seconds, for the earliest to be
 * written. Measured on the readers' 138 saved games: the seats agreed to the minute on 137, and the
 * 138th differed by 20 minutes (a late tip-off two seats moved toward). The two games of a
 * doubleheader, or a series' games on consecutive days, sit hours apart, so an hour separates "the
 * same game, a schedule a few minutes off" from "two different games". More than this, and nothing
 * is written: a start cannot be corrected once written, and a start an hour or more off either
 * strands the game outside its own window or lets an earlier game between the same two teams score
 * it.
 */
export const START_SPREAD = 3600;

/**
 * How far from the creator's date a start may be, either way, in seconds: the games set's own
 * START_BOUND (ospex-contracts-v2, src/games/OspexGames.sol, a fixed 24 hours, not the game's n). The
 * games set refuses any other start, so a seat listing the game further from the date does not list
 * it, and verification never builds a start the games set would refuse.
 */
export const START_BOUND = 86_400;

/** What verification saw: seats 1, 2 and 4 read by team near the date, without hints; seat 3's board checked. */
export interface Seen {
	readonly 1: Reading;
	readonly 2: Reading;
	readonly 3: BoardCheck;
	readonly 4: Reading;
}

/** The game as verification needs it: the date its creator gave, and its creation hints. */
export interface Verifying {
	readonly date: number;
	readonly hints: Game["hints"];
}

/** The seats verification reads by team; seat 3's board is checked apart. */
export const READ_BY_TEAM: readonly (1 | 2 | 4)[] = Object.freeze([1, 2, 4] as const);

/** True when a time is within START_BOUND of the date, both ends in. */
function inRange(t: number, g: Verifying): boolean {
	return t >= g.date - START_BOUND && t <= g.date + START_BOUND;
}

/** The time a reading lists the game at, when it lists it within START_BOUND of the date. */
function listedAt(r: Reading, g: Verifying): number | null {
	if (r.kind === "silent" || r.record === null || r.record.time === null) return null;
	return inRange(r.record.time, g) ? r.record.time : null;
}

function within(times: readonly number[]): boolean {
	return Math.max(...times) - Math.min(...times) <= START_SPREAD;
}

/** The ids a seat's creation hints name, each once. */
function hintedIds(g: Verifying, seat: Seat): string[] {
	return [...new Set(g.hints.filter((h) => h.seat === seat).map((h) => h.id))];
}

/**
 * What verification decides from what it saw: a start, or a wait. A start decided here is not yet
 * written: confirmStart reads the counting seats again as scoring will, and only then is it.
 */
export function decideStart(g: Verifying, seen: Seen): Decision {
	const seat3Reading = (): Reading =>
		seen[3].kind === "listed"
			? { seat: 3, kind: "no_final", home: null, away: null, recorded: null, detail: "listed on the board", record: { id: seen[3].id, time: seen[3].time } }
			: silent(3, seen[3].kind === "fails" ? `silent for the game: ${seen[3].why}` : seen[3].why);
	const readings = (): Reading[] => [seen[1], seen[2], seat3Reading(), seen[4]];
	const wait = (why: string): Decision => ({ action: "wait", readings: readings(), why });

	// No start for a game already over: a start written now would score at once, on a known result.
	for (const seat of READ_BY_TEAM) {
		if (seen[seat].kind === "final") return wait(`seat ${seat} shows the game final`);
	}
	// The date names the game. A seat that lists it, and whose hint names another record, waits.
	for (const seat of READ_BY_TEAM) {
		const r = seen[seat];
		const named = hintedIds(g, seat);
		if (named.length === 0 || listedAt(r, g) === null) continue;
		if (named.length !== 1 || named[0] !== r.record?.id) return wait(`seat ${seat}'s hint names another record than the one nearest the date`);
	}

	for (const seat of [1, 2] as const) {
		const r = seen[seat];
		if (r.kind === "silent") return wait(`seat ${seat} is silent: ${r.detail}`);
		if (listedAt(r, g) === null) return wait(`seat ${seat} does not list the game within a day of its date`);
	}
	const t1 = listedAt(seen[1], g) as number;
	const t2 = listedAt(seen[2], g) as number;
	if (!within([t1, t2])) return wait("seats 1 and 2 list the game more than an hour apart");

	const board = seen[3];
	if (board.kind === "silent") return wait(`seat 3's board is silent: ${board.why}`);
	if (board.kind === "listed" && inRange(board.time, g) && within([t1, t2, board.time])) {
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
	if (t4 === null) return settled("seat 3 is silent for the game and the spare does not list the game within a day of its date");
	if (!within([t1, t2, t4])) return settled("seat 3 is silent for the game and the spare lists the game more than an hour from seats 1 and 2");
	return { action: "start", start: Math.min(t1, t2), readings: [seen[1], seen[2], down, r4], why: "seats 1 and 2 list the game within an hour, and the spare stands in for seat 3" };
}

/**
 * The seats a start counts that are read by team: seats 1 and 2, and the spare when it stands in
 * for seat 3. These are the seats confirmStart reads again.
 */
export function countingByTeam(start: Decision): readonly Seat[] {
	const seat3 = start.readings.find((r) => r.seat === 3);
	return seat3 === undefined || seat3.kind === "silent" ? [1, 2, 4] : [1, 2];
}

/**
 * The start, once each counting seat read by team has been read again as scoring will read it
 * (`again`, in seat order, for the seats countingByTeam names): in the game's window from the start
 * chosen, with the hints and without the date. Each must read the record verification found,
 * inside that window, and not yet final. Anything else and nothing is written: a start that
 * scoring then can't read the game from would leave the game verified and never scored.
 */
export function confirmStart(start: Decision, game: Game, again: readonly Reading[]): Decision {
	if (start.action !== "start") return start;
	const wait = (why: string): Decision => ({ action: "wait", readings: start.readings, why });
	const w = windowOf(game);
	for (const seat of countingByTeam(start)) {
		const r = again.find((x) => x.seat === seat);
		const was = start.readings.find((x) => x.seat === seat);
		if (r === undefined || was === undefined) return wait(`seat ${seat} was not read again`);
		if (r.kind === "final") return wait(`seat ${seat} shows the game final`);
		if (r.kind === "silent") return wait(`seat ${seat} can't read the game as scoring will: ${r.detail}`);
		const inside = r.record !== null && r.record.time !== null && inWindow(r.record.time, w);
		if (!inside || r.record?.id !== was.record?.id) return wait(`seat ${seat} reads another record, or none, in the game's window: ${r.detail}`);
	}
	return start;
}
