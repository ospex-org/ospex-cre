// The start's rule: when a game's start is written, and which time is written.
//
// The spec rules that the start is written once, at verification, by a first-n reporter, and is
// never corrected. The rule below says which feeds must agree that the game exists, which record on
// each feed is the game, and which time is written:
//
//   * Seat 3's hint is checked against seat 3's board while the game is listed: the game's own row,
//     the same two teams, the same home and away, the time at the start. A hint that fails makes
//     seat 3 silent for that game, never wrong.
//   * The start is the scheduled time from the counting seats, the earliest where they differ by
//     minutes. Seat 4's actual start never sets it.
//   * The spare stands in for a counting seat that is silent for the whole game. A seat that
//     answered without a final is not silent.
//   * The game is the one the creator's date names. On each seat read by team, the record nearest
//     the date is the game, and a hint never chooses another one here: a seat whose hint names a
//     different record makes the run wait. At scoring, hints still choose among the records in
//     the window (src/pick.ts).
//   * A hint the feed no longer lists still names another record than the nearest. A feed that
//     reissues the game under a new id leaves the run waiting for good, the game ends in the
//     release, money back, and the creator re-creates it. Such a hint is never dropped here: if
//     its record came back inside the window, the hint would choose it at scoring.
//   * The start is written only if scoring will read the same game. Once a start is chosen, every
//     seat is read again as scoring's first run will read it: in [start, start + n), with the hints
//     and without the date, seat 3 by its result when it counts. Each counting seat must be read
//     there, and each counting seat read by team must read the record verification found, inside
//     that window. The spare, counting or not, may read no other record inside it, and, when it
//     doesn't count, none more than START_SPREAD from the start; and a spare with a hint must read
//     that record, or its hint, unchecked, would choose at scoring. A hinted spare
//     that doesn't count and whose record is within START_SPREAD of the start, a little before the
//     window included, is the game: it reads no other record there, and can give no final to count.
//   * No start is written for a game already over. While any reading verification takes shows the
//     game final, by team near the date or at the re-read, seat 3's result and the spare read by
//     its hint included, nothing is written; and so does a feed that says the game is finished but
//     gives no points, or a count short of a whole game (types.ts, saysFinal). Seat 3's board drops a
//     finished game, so a hint missing from it is read by its result before seat 3 stands down. A
//     game every seat shows still in play gets its start, late.
//
// As built:
//
//   * Seats 1 and 2 must each list the game, by team, within a day of the creator's date
//     (START_BOUND, the range the games set accepts a start in). Silent, or not listing it, and
//     nothing is written: the run waits, and a later run tries again.
//   * Their two times must lie within START_SPREAD of each other.
//   * Seat 3 passes when its hint's row names the teams in the game's order, at a time within
//     START_SPREAD of seats 1 and 2. A board it could not read this time makes the run wait. A hint
//     that fails, or a game created without a usable seat 3 hint, makes seat 3 silent for the game,
//     and the start report records it silent. With seat 3 counting, the spare, when it lists the
//     game, must list it within START_SPREAD of the counting seats too: scoring reads it by that
//     record, and a record further off is another game.
//   * Otherwise the spare stands in: it must list the game, by team, within START_SPREAD of seats 1
//     and 2. Its time is checked, never written.
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

/**
 * What verification saw: seats 1, 2 and 4 read by team near the date, without hints; seat 3's board
 * checked; and seat 3's result for its hint, read when the board no longer lists the hint.
 */
export interface Seen {
	readonly 1: Reading;
	readonly 2: Reading;
	readonly 3: BoardCheck;
	readonly 4: Reading;
	readonly result?: Reading;
}

/** The game as verification needs it: the date its creator gave, and its creation hints. */
export interface Verifying {
	readonly date: number;
	readonly hints: Game["hints"];
}

/** The seats verification reads by team; seat 3's board is checked apart. */
export const READ_BY_TEAM: readonly (1 | 2 | 4)[] = Object.freeze([1, 2, 4] as const);

/**
 * What seat 3's result says when it answers about the hint without a final it could score: nothing
 * of the game's end, so a hint the board no longer lists then stands seat 3 down. Any other silence
 * of the result is a read that failed, and teaches nothing.
 */
const RESULT_ANSWERED: ReadonlySet<string> = new Set(["no result for the hint", "duplicate result", "hint names a part of the game"]);

/**
 * What the spare says when the feed answered about the game's id without a record of the game and no
 * slate stands behind it (readers/seat4.ts): silent so at scoring too, so a hinted spare that does not
 * count holds nothing by it. Any other silence of a hinted spare is a read that failed, and its hint is
 * unchecked.
 */
const SPARE_ANSWERED: ReadonlySet<string> = new Set(["nothing for the id, and the slate is past the size", "the id's row is not the game, and the slate is past the size", "no id, and the slate is past the size"]);

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

/** True when a reading shows the game over: a final, or a feed that says final but gives none it can score. */
export function over(r: Reading): boolean {
	return r.kind === "final" || r.saysFinal === true;
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
		if (over(seen[seat])) return wait(`seat ${seat} shows the game final`);
	}
	// The board drops a finished game: a hint it no longer lists is read by its result. One that shows
	// the game over writes nothing; one whose read failed teaches nothing, and the run waits, as it
	// does on a board it can't read.
	if (seen.result !== undefined) {
		if (over(seen.result)) return wait("seat 3 shows the game final");
		if (seen.result.kind === "silent" && !RESULT_ANSWERED.has(seen.result.detail)) return wait(`seat 3's result is silent: ${seen.result.detail}`);
	}
	// The date names the game. A seat read by team that lists it, and whose hint names another record,
	// waits. Not the spare: asked by its id, its record is the hint's own, or where the feed has nothing
	// for the id, the slate's (readers/seat4.ts), and scoring reads it the same way.
	for (const seat of [1, 2] as const) {
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
		// The spare doesn't count, but scoring reads it by the record it lists: one more than an hour
		// from the counting seats is another game, whose final would dispute this one.
		const t4 = listedAt(seen[4], g);
		if (t4 !== null && !within([t1, t2, board.time, t4])) return wait("the spare lists the game more than an hour from the counting seats");
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
 * for seat 3. Each must read the game again as scoring will.
 */
export function countingByTeam(start: Decision): readonly Seat[] {
	const seat3 = start.readings.find((r) => r.seat === 3);
	return seat3 === undefined || seat3.kind === "silent" ? [1, 2, 4] : [1, 2];
}

/**
 * The start, once every seat has been read again as scoring's first run will read it (`again`): in
 * the game's window from the start chosen, with the hints and without the date, seat 3 by its
 * result when it counts. Nothing is written when:
 *   * any reading in `again` shows the game over: a final, or a feed that says final without one it
 *     can score (seat 3's result and the spare by its hint included);
 *   * seat 3 counts and its result can't be read, or isn't in `again` at all: it would be silent
 *     for good at scoring, a hint for a part of the game for one;
 *   * a seat read by team reads a record inside the window other than the one verification found:
 *     a counting seat, or the spare, counting or not, which would dispute the game on that
 *     record's final; or the spare that doesn't count reads its record there more than START_SPREAD
 *     from the start, another game, which near the date was more than a day from it and so not held
 *     to the hour;
 *   * a counting seat read by team reads no record inside the window, or isn't in `again` at all;
 *   * the spare has a hint and reads no record inside the window, silent included: its hint would
 *     go unchecked and choose at scoring. Unless it doesn't count, answers, and the record
 *     verification found for it is its hint's, within START_SPREAD of the start: that record is the
 *     game, a little before the window, and it can give no final there.
 * A spare that doesn't count, has no hint and reads no record inside the window passes: it can give
 * no final there. A start that scoring then can't read the game from would leave the game verified
 * and never scored.
 */
export function confirmStart(start: Decision, game: Game, again: readonly Reading[]): Decision {
	if (start.action !== "start") return start;
	const wait = (why: string): Decision => ({ action: "wait", readings: start.readings, why });
	const w = windowOf(game);
	for (const r of again) if (over(r)) return wait(`seat ${r.seat} shows the game final`);
	const counting = countingByTeam(start);
	if (!counting.includes(4)) {
		// Seat 3 counts: scoring reads it by its result, so the result must read now.
		const r3 = again.find((x) => x.seat === 3);
		if (r3 === undefined || r3.kind === "silent") return wait(`seat 3 can't be read as scoring will: ${r3?.detail ?? "not read again"}`);
	}
	for (const seat of READ_BY_TEAM) {
		const r = again.find((x) => x.seat === seat);
		const was = start.readings.find((x) => x.seat === seat);
		const counts = counting.includes(seat);
		if (r === undefined || was === undefined) {
			if (counts) return wait(`seat ${seat} was not read again`);
			continue;
		}
		const inside = r.kind !== "silent" && r.record !== null && r.record.time !== null && inWindow(r.record.time, w);
		if (inside) {
			if (r.record?.id !== was.record?.id) return wait(`seat ${seat} reads another record, or none, in the game's window: ${r.detail}`);
			// The spare that doesn't count was held to the hour near the date only where it listed the game
			// within a day of it; in the window it must be within the hour of the start too, or it is another game.
			if (!counts && Math.abs((r.record?.time as number) - game.start) > START_SPREAD) return wait(`seat ${seat} reads a record more than an hour from the start in the game's window`);
			continue;
		}
		// No record of the game inside the window: a counting seat can't be read as scoring will, and a
		// hinted spare's hint is unchecked, unless its record is the game, just before the window, or the
		// feed answered that it has nothing for the id with no slate behind it (SPARE_ANSWERED): silent so
		// at scoring too, nothing binds it, and the most it can cost is a dispute.
		const named = [...new Set(game.hints.filter((h) => h.seat === seat).map((h) => h.id))];
		if (!counts && named.length === 1 && r.kind !== "silent" && was.record?.id === named[0] && was.record.time !== null && Math.abs(was.record.time - game.start) <= START_SPREAD) {
			continue;
		}
		if (!counts && r.kind === "silent" && SPARE_ANSWERED.has(r.detail)) continue;
		if (counts || named.length > 0) {
			return wait(r.kind === "silent" ? `seat ${seat} can't read the game as scoring will: ${r.detail}` : `seat ${seat} reads another record, or none, in the game's window: ${r.detail}`);
		}
	}
	return start;
}
