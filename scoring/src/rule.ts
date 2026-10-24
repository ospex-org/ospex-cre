// The agreement rule: what one run's readings add up to for a game whose start is written.
//
// From the spec (docs/spec-v3.md in ospex-contracts-v2 at commit fe1f465, "The scoring program" and
// "How a game ends"), as this file reads it, with one change that text does not carry yet: inside
// n, a disagreement posts the dispute record only once every seat read shows a final (Disagree,
// below). Every count below is a constant here, inside the fingerprint, and nothing handed in at
// runtime changes one. The run's clock does pick which count applies, three inside n or two after,
// and the games set stores no reading to check it against: so the clock must be the chain's time,
// taken by the workflow from its runtime and never from a setting, and program.ts decides nothing
// on a clock it can't read.
//
//   Inside n   Every counting seat answers with a final, and the finals are the same: the same
//              points for both teams. A silent counting seat blocks, and so does one that has not
//              yet answered with a final: inside n that is a game still on, or a feed still
//              catching up, and the run waits.
//   After n    Two counting seats answer with the same final and the third is silent. A seat that
//              answered without a final is not silent, so two finals beside an
//              answer without one are not enough.
//   Void       Only from start + n. No seat that answers shows a final, and the counting seats
//              answer as a score's would: "the same proof as a score: three feeds inside the
//              window and two after". A void is never taken inside the window, so its count is
//              always the after-n count: at least two counting seats answer, each without a final.
//   Disagree   Any two finals that differ, from any seat asked, the spare's included. Inside n the
//              run waits until every seat it reads (each seat but one silent for the whole game)
//              shows a final: the dispute record is what day 7 reads for a seat it can no longer
//              ask, so a record posted while a feed is still catching up would freeze that feed's
//              "no final" for the week. From start + n, two finals that differ post the record at
//              once, and so do finals beside answers without one, with at least two counting seats
//              answering: neither a score nor a void. The run that sees either posts the dispute
//              record, with every reading.
//   Day 7      See decideDay7.
//
// The spare is asked on every run. Its final counts toward a disagreement like any other seat's.
// Its answer without a final never blocks a score, since it does not count. For a game whose
// counting seat is silent for the whole game, it stands in for that seat (countingFor).

import { silent } from "./run";
import { COUNTING, SPARE } from "./table";
import { READING_KIND, fromReportReading, type ChainGame, type Decision, type ReportReading } from "./chain";
import { hintOf } from "./readers/seat3";
import type { Reading, Seat } from "./types";

/** How many must agree. Part of the fingerprint: nothing at runtime reaches these. */
export const AGREE = deepFreeze({
	/** Inside n: every counting seat, each with the same final. */
	insideN: 3,
	/** After n: this many counting seats with the same final, the rest silent. Also a void's count. */
	afterN: 2,
	/** Day 7: this many sources on record, none silent ... */
	day7Sources: 4,
	/** ... and at least this many of them with the same final. */
	day7Agree: 3,
} as const);

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
 * What a run's readings decide for a game whose start is written and that has no dispute record.
 * `inside` is whether the run's clock is before start + n.
 */
export function decide(readings: readonly Reading[], counting: readonly Seat[], inside: boolean): Decision {
	const of = (seat: Seat): Reading => readings.find((r) => r.seat === seat) ?? silent(seat, "not read");
	const finals = readings.filter((r) => r.kind === "final");
	const first = finals[0];

	if (finals.some((f) => f.home !== first.home || f.away !== first.away)) {
		// Inside n, every seat read must show a final first: the counting seats and the spare.
		const read = [...new Set([...counting, SPARE])];
		if (inside && read.some((s) => of(s).kind !== "final")) {
			return { action: "wait", readings, why: "inside n: two finals differ, and a seat has no final yet" };
		}
		return { action: "dispute", readings, why: "two finals differ" };
	}

	const counted = counting.map(of);
	const finalsCounted = counted.filter((r) => r.kind === "final").length;
	const answeredCounted = counted.filter((r) => r.kind !== "silent").length;
	const withoutFinal = answeredCounted - finalsCounted;

	if (inside) {
		if (finalsCounted === AGREE.insideN) {
			return { action: "score", home: first.home as number, away: first.away as number, readings, why: "inside n: every counting seat, the same final" };
		}
		const why = answeredCounted < counting.length ? "inside n: a counting seat is silent" : "inside n: not every counting seat has a final yet";
		return { action: "wait", readings, why };
	}

	if (answeredCounted < AGREE.afterN) return { action: "wait", readings, why: "after n: fewer than two counting seats answer" };
	if (finalsCounted >= AGREE.afterN && withoutFinal === 0) {
		return { action: "score", home: first.home as number, away: first.away as number, readings, why: "after n: two counting seats or more, the same final, the rest silent" };
	}
	if (finals.length === 0) return { action: "void", readings, why: "after n: every seat that answers shows no final" };
	return { action: "dispute", readings, why: "after n: finals beside answers without a final" };
}

/**
 * Day 7, for a game with a dispute record, once its day-7 clock has run. Each seat's latest
 * reading counts: fresh if the feed answers now, otherwise the one the dispute record carried; a
 * seat with neither is silent. The game settles only when four sources are on record, none silent,
 * and at least three of them give the same final. Anything else is a void: 2-2, a silent fourth,
 * or a league with fewer than four feeds.
 *
 * `down` is the seat silent for the whole game, if one is. It is silent here too, whatever the
 * dispute record carries for it: this program never asks that seat, so a final on record for it
 * could only have come from somewhere else. A game with such a seat has three sources at most, so
 * a dispute on it voids.
 */
export function decideDay7(
	fresh: readonly Reading[],
	recorded: readonly ReportReading[],
	seats: readonly Seat[],
	down: Seat | null,
): Decision {
	const sources: Reading[] = seats.map((seat) => {
		if (seat === down) return silent(seat, "silent for the game");
		const now = fresh.find((r) => r.seat === seat);
		if (now !== undefined && now.kind !== "silent") return now;
		const then = recorded.find((r) => r.seat === seat);
		if (then !== undefined && then.kind !== READING_KIND.silent) return fromReportReading(then, "recorded at the dispute");
		return now ?? silent(seat, "not read");
	});

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
