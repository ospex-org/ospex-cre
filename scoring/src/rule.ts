// The agreement rule: what one run's readings add up to for a game whose start is written.
//
// From the spec (docs/spec-v3.md in ospex-contracts-v2 at commit fe1f465, "The scoring program" and
// "How a game ends"), as this file reads it, with changes that text does not carry yet: the dispute
// record is a record, not a lock, and a disputed game is decided on every seat's vote (After a
// record, below). Every count below is a constant here, inside the fingerprint, and nothing handed in
// at runtime changes one. The run's clock does pick which count applies, three inside n or two after,
// and the games set stores no reading to check it against: so the clock must be the chain's time,
// taken by the workflow from its runtime and never from a setting, and program.ts decides nothing on
// a clock it can't read.
//
//   Inside n   Every counting seat answers with a final, and the finals are the same: the same
//              points for both teams. A silent counting seat blocks, and so does one that has not
//              yet answered with a final: inside n that is a game still on, or a feed still
//              catching up, and the run waits.
//   After n    Two counting seats answer with the same final and the third is silent. A seat that
//              answered without a final is not silent, so two finals beside an
//              answer without one are not enough.
//   Void       Only from start + n, and held to the finals' count: two counting seats answer
//              affirmatively that the game will not or did not play (a row of the game, bound by
//              its ids or names and time, whose status in the feed's own words is postponed or
//              cancelled, and nothing else: affirmsNoFinal), the rest of the counting seats silent,
//              and no seat asked said final, scorable or not: a final its reader could not score
//              (saysFinal: the game's own row that says final, listed twice, without points or
//              beside a row the reader can't parse) is silent to the score and holds the void all
//              the same, the run waiting with its line naming the seat and why; the veto is the
//              word, not the score. A row that says the game is scheduled or in
//              play is an answer, not a void's vote, and beside two affirmative answers it holds the
//              void as it would hold a score; absence, a
//              listing without the game, and a row without a status are silence (pick.ts). Fewer
//              than two affirmative answers: the run waits, its line saying what each seat gave.
//   Disagree   Any two finals that differ, from any seat asked, the spare's included, inside n or
//              after; and from start + n, finals beside answers without one, with at least two
//              counting seats answering: neither a score nor a void. The first run that sees either
//              posts the dispute record, with every seat's answer.
//   After a record   The record is not a lock (decideDisputed). Each seat is open while the program
//              still asks it and closed once it stops (OPEN_FOR), and each has a vote: its most
//              recent answer while it is open, its last answer once it is closed (votesOf). Silence
//              leaves a vote where it was; an answer without a final after a final is a vote of no
//              final. The game scores the moment the votes agree, by the same rule a game without
//              a record scores by, and only on three or more votes with that final: a disputed game
//              never settles on fewer than three agreeing recorded sources, before day 7 or on it.
//              Until then a run posts an update, the same report with every seat's answer, whenever
//              a seat's vote changes, and never otherwise.
//   Day 7      The deadline for a dispute that never resolves, counted from the first record; an
//              update never moves it. Every seat is closed by then, so day 7 reads the votes on
//              record (decideDay7).
//
// The spare is asked on every run while it is open. Its final counts toward a disagreement
// like any other seat's. Its answer without a final never blocks a score, since it does not count.
// For a game whose counting seat is silent for the whole game, it stands in for that seat
// (countingFor).

import { silent } from "./run";
import { COUNTING, SPARE } from "./table";
import { READING_KIND, fromReportReading, type ChainGame, type Decision, type ReportReading } from "./chain";
import { hintOf } from "./readers/seat3";
import type { Reading, Seat } from "./types";
import { inWindow, type Window } from "./window";

/** How many must agree. Part of the fingerprint: nothing at runtime reaches these. */
export const AGREE = deepFreeze({
	/** Inside n: every counting seat, each with the same final. */
	insideN: 3,
	/** After n: this many counting seats with the same final, the rest silent. Also a void's count. */
	afterN: 2,
	/** Day 7: this many sources on record, none silent ... */
	day7Sources: 4,
	/** ... and at least this many of them with the same final. Every score of a disputed game, before day 7 too, rests on this many votes with its final. */
	day7Agree: 3,
} as const);

/**
 * How long after a game's start each seat stays open, in seconds: the program asks it to the end of
 * the window the seat's own docs give for a game it keeps, or until the game ends where its docs
 * keep a game longer than any game here runs (null). Part of the fingerprint. A seat also closes at a
 * disputed game's day-7 clock and when the game is scored. A closed seat is not asked again: its vote
 * stands, and nothing it says later is read.
 *   Seats 1 and 2   keep a game's record for seasons: open until the game ends, at day 7 at the
 *                   latest for a disputed game.
 *   Seat 3          keeps a result five days from the game's start.
 *   Seat 4          keeps completed games three days; open for 66 hours, the margin its reader keeps
 *                   for not knowing how the feed counts the three (src/readers/seat4.ts).
 */
export const OPEN_FOR: Readonly<Record<Seat, number | null>> = deepFreeze({ 1: null, 2: null, 3: 5 * 86_400, 4: 66 * 3_600 });

/**
 * The seat that is silent for the whole game, if one is: seat 3, unless the game was created with a
 * usable seat 3 hint and the start report shows seat 3 passed its board check (an answer without a
 * final: "listed on the board"). A hint that failed the check makes seat 3 silent for that game,
 * never wrong, and so does any start report that doesn't show the pass:
 * seat 3's points are bound to the game only by that check. Seats 1 and 2 are read by team and must
 * list the game before its start is written, so neither is ever silent for a whole game.
 */
export function silentForGame(game: Pick<ChainGame, "hints" | "startReadings">): Seat | null {
	if ("none" in hintOf(game.hints)) return 3;
	const atStart = game.startReadings?.find((r) => r.seat === 3);
	return atStart !== undefined && atStart.kind === READING_KIND.noFinal ? null : 3;
}

/**
 * The seats that count for a game. Seats 1 to 3, except that the spare stands in for a counting
 * seat that is silent for the whole game. A seat silent on one run is a silent feed on that run,
 * and the spare does not stand in for it.
 */
export function countingFor(down: Seat | null): readonly Seat[] {
	return down === null ? COUNTING : COUNTING.map((s) => (s === down ? SPARE : s));
}

/**
 * An affirmative no-final answer: the game's own row, bound by its ids or names and time, whose
 * status in the feed's own words says the game will not or did not play: postponed or cancelled, and
 * nothing else (the reading's `recorded`). The only answer without a final a void may rest on. A row
 * scheduled or in play is an answer, not a void's vote.
 */
export function affirmsNoFinal(r: Reading): boolean {
	return r.kind === "no_final" && r.recorded !== null;
}

/** What each seat gave, for the line of a run that waits on the void's count. */
function gave(readings: readonly Reading[]): string {
	return readings.map((r) => `seat ${r.seat} ${r.kind === "final" ? "a final" : r.kind === "silent" ? `silence (${r.detail})` : (r.recorded ?? r.detail)}`).join(", ");
}

/**
 * What a run's readings decide for a game whose start is written and that has no dispute record.
 * `inside` is whether the run's clock is before start + n. Every reading here is silent or an answer
 * about the game (decideVerified reads non-answers silent; votesOf gives only answers): a final, or
 * the game's own row without one.
 */
export function decide(readings: readonly Reading[], counting: readonly Seat[], inside: boolean): Decision {
	const of = (seat: Seat): Reading => readings.find((r) => r.seat === seat) ?? silent(seat, "not read");
	const finals = readings.filter((r) => r.kind === "final");
	const first = finals[0];

	// Two finals that differ, from any seat: the first run that sees it posts the record, inside n or after.
	if (finals.some((f) => f.home !== first.home || f.away !== first.away)) return { action: "dispute", readings, why: "two finals differ" };

	const counted = counting.map(of);
	const finalsCounted = counted.filter((r) => r.kind === "final").length;
	const answeredCounted = counted.filter((r) => r.kind !== "silent").length;
	const withoutFinal = answeredCounted - finalsCounted;
	// The void's votes: the answers that say the game will not or did not play.
	const affirmed = counted.filter(affirmsNoFinal).length;
	// The seats that said the word final without a final the reader could score (types.ts, saysFinal).
	const unscorable = readings.filter((r) => r.saysFinal === true);

	if (inside) {
		if (finalsCounted === AGREE.insideN) {
			return { action: "score", home: first.home as number, away: first.away as number, readings, why: "inside n: every counting seat, the same final" };
		}
		const why = answeredCounted < counting.length ? "inside n: a counting seat is silent" : "inside n: not every counting seat has a final yet";
		return { action: "wait", readings, why };
	}

	// A seat that said final, scorable or not, holds the void: the veto is the word, not the score. Only
	// where no final can be weighed; beside a final the readings score or dispute as they would.
	if (finals.length === 0 && unscorable.length > 0) {
		return { action: "wait", readings, why: `after n: ${unscorable.map((r) => `seat ${r.seat} says final, unscorable: ${r.detail}`).join("; ")}` };
	}
	if (answeredCounted < AGREE.afterN) return { action: "wait", readings, why: "after n: fewer than two counting seats answer" };
	if (finalsCounted >= AGREE.afterN && withoutFinal === 0) {
		return { action: "score", home: first.home as number, away: first.away as number, readings, why: "after n: two counting seats or more, the same final, the rest silent" };
	}
	if (finals.length === 0) {
		// As a score after n: two or more affirm, and the rest of the counting seats are silent. A counting seat
		// that answers the game is in play is not silent, so two affirmative answers beside it are not enough.
		if (affirmed >= AGREE.afterN && answeredCounted === affirmed) return { action: "void", readings, why: "after n: two counting seats or more say the game will not or did not play, the rest silent, and no seat shows a final" };
		return { action: "wait", readings, why: `after n: ${affirmed} counting seat${affirmed === 1 ? " says" : "s say"} the game will not or did not play, two needed; ${gave(readings)}` };
	}
	return { action: "dispute", readings, why: "after n: finals beside answers without a final" };
}

/**
 * A run for a game whose start is written and that has no dispute record: decide's decision on this
 * run's readings. A score or a void carries the readings as read. The first record carries each
 * seat's answer (answersOf), since it is each seat's first vote: a seat that gave no answer about
 * the game is silent on it.
 */
export function decideVerified(readings: readonly Reading[], counting: readonly Seat[], inside: boolean, seats: readonly Seat[], w: Window): Decision {
	// A reading that is not an answer about the game (a listing without it, its record outside the
	// window) is silence to the rule, with its reason: absence is silence everywhere.
	const seen = readings.map((r) => (r.kind === "silent" || answers(r, w) ? r : silent(r.seat, r.detail)));
	const d = decide(seen, counting, inside);
	return d.action === "dispute" ? { ...d, readings: answersOf(readings, seats, w) } : d;
}

/**
 * Whether a reading is an answer about the game, the only kind that sets a seat's vote: a final, or
 * the game's own record shown without a final (seat 3's result, which has no time, or a record inside
 * the window at seats 1, 2 and 4). Silence is not an answer, and neither is a listing that doesn't
 * give the game: the game absent from it, or its record outside the window.
 */
export function answers(r: Reading, w: Window): boolean {
	if (r.kind === "final") return true;
	if (r.kind !== "no_final" || r.record === null) return false;
	return r.record.time === null || inWindow(r.record.time, w);
}

/**
 * Each seat's answer on a run, one per seat of `seats` in seat order, as a dispute report carries
 * them: a seat that gave no answer about the game is silent, with its reason.
 */
export function answersOf(readings: readonly Reading[], seats: readonly Seat[], w: Window): Reading[] {
	return seats.map((seat) => {
		const r = readings.find((x) => x.seat === seat);
		if (r === undefined) return silent(seat, "not read");
		return answers(r, w) ? r : silent(seat, r.detail);
	});
}

/**
 * Each seat's vote on record, one per seat of `seats` in seat order: its last answer across every
 * dispute report the game has (the first record, then each update, in the order they landed), or
 * silent when none of them holds one. Each report carries every seat's answer on its run, a seat that
 * gave none written silent (answersOf), so a later answer replaces an earlier one, a final taken back
 * included, and silence never does.
 */
export function lastRecorded(records: readonly (readonly ReportReading[])[], seats: readonly Seat[]): ReportReading[] {
	return seats.map((seat) => {
		const mine = records.map((rec) => rec.find((r) => r.seat === seat)).filter((r): r is ReportReading => r !== undefined);
		return mine.filter((r) => r.kind !== READING_KIND.silent).at(-1) ?? { seat, kind: READING_KIND.silent, homeScore: 0, awayScore: 0 };
	});
}

/**
 * Every seat's vote, one per seat of `seats` in seat order: its answer this run where it is open and
 * gives one, otherwise its vote on record (`recorded`, from lastRecorded), and silent when it has
 * neither. A closed seat reads silent this run, so its vote on record stands. The seat silent for the whole game (`down`) has no vote: this program never
 * asks it, so an answer on record for it could only have come from somewhere else.
 */
export function votesOf(fresh: readonly Reading[], recorded: readonly ReportReading[], seats: readonly Seat[], down: Seat | null, w: Window): Reading[] {
	return seats.map((seat) => {
		if (seat === down) return silent(seat, "silent for the game");
		const now = fresh.find((r) => r.seat === seat);
		if (now !== undefined && answers(now, w)) return now;
		const then = recorded.find((r) => r.seat === seat);
		if (then !== undefined && then.kind !== READING_KIND.silent) return fromReportReading(then, "its vote on record");
		return silent(seat, now?.detail ?? "not read");
	});
}

/**
 * Whether a seat's vote changes on this run: it gives an answer, and its vote on record is none, a
 * final it now differs from or no longer shows, or no final where it now shows one. An answer without
 * a final beside a vote of no final is no change, whatever points it carries: a game still on moves
 * its points on every run.
 */
function voteChanges(now: Reading | undefined, then: ReportReading | undefined, w: Window): boolean {
	if (now === undefined || !answers(now, w)) return false;
	if (then === undefined || then.kind === READING_KIND.silent) return true;
	if (now.kind === "final") return then.kind !== READING_KIND.final || then.homeScore !== now.home || then.awayScore !== now.away;
	return then.kind === READING_KIND.final;
}

/**
 * A run for a game whose dispute record is written: a record, not a lock, decided on every seat's vote
 * (votesOf), before day 7 and on day 7 alike.
 *   * The votes agree, by the same rule a game without a record scores by (decide), and three or more
 *     of them are that final: a score, whose readings are the votes it rests on. A disputed game never
 *     settles on fewer than three agreeing recorded sources, so two counting seats with the final and
 *     the third silent are not enough here unless the spare's vote is the third; until a third agrees,
 *     the game waits, or day 7 decides.
 *   * Otherwise, from the day-7 clock (`day7`, counted from the first record): day 7 (decideDay7).
 *   * Otherwise, before it: an update, the same dispute report with every seat's answer this run
 *     (answersOf), when a seat's vote changes; and a wait, writing nothing, when none does. Never an
 *     update per run: only a vote that changes posts one, and however many change on a run, that run
 *     posts one report.
 * A void never comes from here before day 7: the hour-24 void is for a game no feed called final.
 * And no score from here carries a final that differs before day 7: decide disputes any two finals
 * that differ, the spare's included.
 */
export function decideDisputed(
	fresh: readonly Reading[],
	recorded: readonly ReportReading[],
	counting: readonly Seat[],
	inside: boolean,
	day7: boolean,
	seats: readonly Seat[],
	down: Seat | null,
	w: Window,
): Decision {
	const votes = votesOf(fresh, recorded, seats, down, w);
	const agreed = decide(votes, counting, inside);
	if (agreed.action === "score" && votesFor(votes, agreed.home, agreed.away) >= AGREE.day7Agree) {
		return { ...agreed, why: `after the dispute record, every seat's vote: ${agreed.why}` };
	}
	if (day7) return decideDay7(votes, seats, down);
	const changed = seats.filter((seat) => seat !== down && voteChanges(fresh.find((r) => r.seat === seat), recorded.find((r) => r.seat === seat), w));
	if (changed.length > 0) {
		return { action: "dispute", readings: answersOf(fresh, seats, w), why: `an update: a vote changed, at seat ${changed.join(" and ")}` };
	}
	return { action: "wait", readings: votes, why: "disputed: no seat's vote has changed since the record" };
}

/** How many votes are a final with these points. */
function votesFor(votes: readonly Reading[], home: number, away: number): number {
	return votes.filter((v) => v.kind === "final" && v.home === home && v.away === away).length;
}

/**
 * Day 7, for a game with a dispute record, once its day-7 clock has run and the votes still don't
 * agree. By then every seat is closed (program.ts), so each seat's vote is the one on record. The
 * game settles only when four sources have a vote, none silent, and at least three of them give the
 * same final. Anything else is a void: 2-2, a silent fourth, or a league with fewer than four feeds.
 *
 * `down` is the seat silent for the whole game, if one is. It is silent here too, whatever the
 * dispute record carries for it: this program never asks that seat, so a final on record for it
 * could only have come from somewhere else. A game with such a seat has three sources at most, so
 * a dispute on it voids.
 */
export function decideDay7(votes: readonly Reading[], seats: readonly Seat[], down: Seat | null): Decision {
	const sources: Reading[] = seats.map((seat) => (seat === down ? silent(seat, "silent for the game") : (votes.find((r) => r.seat === seat) ?? silent(seat, "not read"))));

	if (seats.length < AGREE.day7Sources) return { action: "void", readings: sources, why: "day 7: fewer than four feeds" };
	if (sources.some((r) => r.kind === "silent")) return { action: "void", readings: sources, why: "day 7: a source is silent" };

	let best: { home: number; away: number; count: number } | null = null;
	for (const r of sources) {
		if (r.kind !== "final") continue;
		const count = sources.filter((s) => s.kind === "final" && s.home === r.home && s.away === r.away).length;
		if (best === null || count > best.count) best = { home: r.home as number, away: r.away as number, count };
	}
	if (best !== null && best.count >= AGREE.day7Agree) {
		return { action: "score", home: best.home, away: best.away, readings: sources, why: "day 7: three sources or more, the same final" };
	}
	return { action: "void", readings: sources, why: "day 7: no three sources agree" };
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
	}
	return value;
}
