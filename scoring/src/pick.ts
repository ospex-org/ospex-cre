// Finding the game among a feed's records, and turning the record into a reading. Every seat's
// reader ends here, so the three rules live in one place:
//
//   by team   A record is the game only when its two teams resolve to the game's two teams, in
//             either order. Its points come back by team: a reader drops the feed's home and away
//             slots before this file sees the record, and this file pairs points with teams by
//             name alone.
//   window    A record counts only when the feed's own game time for it is inside the window.
//   hints     A hint names the feed's own id for the game. When the feed has a record under that
//             id with the game's two teams, that record is the game: inside the window it is
//             read; outside it, the game has moved, it reads "no final", and nothing else is
//             searched. A hint the feed doesn't have, or one under another pair of teams, is
//             dropped, and the game is found by its teams.
//
// Among several records of the two teams inside the window and no hint to choose, the earliest
// is the game: a postponed game the feed still lists at its own time comes before the next
// game between the same teams. Two at the same earliest time, under two ids, is a feed listing
// one game twice, and the feed is silent.
//
// "Absent" (answered, no record of the game) is said only when the feed's answer rules the game
// out: when no record of the two teams lacks a game time, no result lacks teams or a time, and no
// record carries a team name the program can't resolve beside one that could be the game's.
// Otherwise the feed is silent. So a spelling missing from the team lists makes a seat silent
// about the games it touches; it does not make the seat say they are absent.

import { resolveTeam } from "./teams";
import { silent } from "./run";
import type { Game, Reading, Seat } from "./types";
import { inWindow, windowOf } from "./window";

/** A feed's record of one game, with the feed's home and away slots already dropped. */
export interface FeedRecord {
	readonly id: string;
	/** The feed's own game time for this record, unix seconds; null when it gave none it can be held to. */
	readonly time: number | null;
	/** The two teams, each with its own points. Their order means nothing. */
	readonly teams: readonly [FeedTeam, FeedTeam];
	/** The feed's status, mapped. Only "final" can make a final. */
	readonly state: "final" | "not_final" | "postponed" | "canceled";
	/** The feed's own status words, kept for the reading's detail. */
	readonly status: string;
}

export interface FeedTeam {
	/** Every name the feed gives this team: full name, school, display name. */
	readonly names: readonly string[];
	/** Its points, or null when the feed gave none. */
	readonly points: number | null;
}

/** A feed's points, if they are a whole number written plainly; anything else is no points. */
export function points(v: unknown): number | null {
	if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 && v < 10000 ? v : null;
	if (typeof v === "string" && /^\d{1,4}$/.test(v.trim())) return Number(v.trim());
	return null;
}

/** The team a feed's names mean, when they mean exactly one. */
export function resolveFeedTeam(league: string, team: FeedTeam): string | null {
	let found: string | null = null;
	for (const name of team.names) {
		const key = resolveTeam(league, name);
		if (key === null) continue;
		if (found !== null && found !== key) return null;
		found = key;
	}
	return found;
}

/**
 * Picks the game out of a feed's answer and reads it.
 *
 * `unplaced` holds the ids of records the feed answered for but gave no teams or game time for.
 * One of them may be the game, so while any exist the feed cannot say the game is absent.
 */
export function pick(
	seat: Seat,
	game: Game,
	answered: readonly FeedRecord[],
	unplaced: ReadonlySet<string> = new Set(),
): Reading {
	const home = resolveTeam(game.league, game.home);
	const away = resolveTeam(game.league, game.away);
	if (home === null || away === null || home === away) return silent(seat, "game teams unknown");

	const isGame = (r: FeedRecord): boolean => {
		const a = resolveFeedTeam(game.league, r.teams[0]);
		const b = resolveFeedTeam(game.league, r.teams[1]);
		return (a === home && b === away) || (a === away && b === home);
	};
	const w = windowOf(game);

	// A feed can list one game under two of the dates asked for. Identical repeats are one record;
	// a repeat of the game that differs from itself leaves the feed silent.
	const byId = new Map<string, FeedRecord>();
	for (const r of answered) {
		const prior = byId.get(r.id);
		if (prior === undefined) byId.set(r.id, r);
		else if (JSON.stringify(prior) !== JSON.stringify(r) && (isGame(prior) || isGame(r))) {
			return silent(seat, "inconsistent records");
		}
	}
	const records = [...byId.values()];

	const hint = game.hints.find((h) => h.seat === seat);
	if (hint !== undefined) {
		if (unplaced.has(hint.id)) return silent(seat, "hint has no teams or time");
		const named = records.find((r) => r.id === hint.id);
		if (named !== undefined && isGame(named)) {
			if (named.time === null) return silent(seat, "no game time");
			return inWindow(named.time, w) ? readingOf(seat, game.league, named, home) : noFinal(seat, "outside window", named);
		}
	}

	const games = records.filter(isGame);
	const inside = games
		.filter((r) => r.time !== null && inWindow(r.time, w))
		.sort((x, y) => (x.time as number) - (y.time as number));
	if (inside.length > 1 && inside[1].time === inside[0].time) return silent(seat, "ambiguous");
	if (inside.length > 0) return readingOf(seat, game.league, inside[0], home);
	if (games.some((r) => r.time === null)) return silent(seat, "no game time");
	if (unplaced.size > 0) return silent(seat, "results without teams or time");
	// A record with a team name the program can't resolve, whose other team could be one of the
	// game's, may be the game: the feed can't be said to lack it.
	const couldBe = (k: string | null): boolean => k === null || k === home || k === away;
	const unresolved = records.some((r) => {
		const a = resolveFeedTeam(game.league, r.teams[0]);
		const b = resolveFeedTeam(game.league, r.teams[1]);
		return (a === null || b === null) && couldBe(a) && couldBe(b);
	});
	if (unresolved) return silent(seat, "unresolved team names");
	return games.length > 0 ? noFinal(seat, "outside window", games[0]) : noFinal(seat, "absent", null);
}

function readingOf(seat: Seat, league: string, r: FeedRecord, homeKey: string): Reading {
	const record = { id: r.id, time: r.time as number };
	const firstIsHome = resolveFeedTeam(league, r.teams[0]) === homeKey;
	const homeTeam = firstIsHome ? r.teams[0] : r.teams[1];
	const awayTeam = firstIsHome ? r.teams[1] : r.teams[0];
	if (r.state === "final") {
		if (homeTeam.points === null || awayTeam.points === null) return silent(seat, "final without points");
		return { seat, kind: "final", home: homeTeam.points, away: awayTeam.points, recorded: null, detail: "final", record };
	}
	const recorded = r.state === "postponed" || r.state === "canceled" ? r.state : null;
	return {
		seat,
		kind: "no_final",
		home: homeTeam.points,
		away: awayTeam.points,
		recorded,
		detail: recorded ?? r.status,
		record,
	};
}

function noFinal(seat: Seat, detail: string, r: FeedRecord | null): Reading {
	return {
		seat,
		kind: "no_final",
		home: null,
		away: null,
		recorded: null,
		detail,
		record: r === null || r.time === null ? null : { id: r.id, time: r.time },
	};
}
