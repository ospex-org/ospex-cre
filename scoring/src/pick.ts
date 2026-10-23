// Finding the game among a feed's records, and turning the record into a reading. Seats 1, 2 and
// 4 end here, so the rules live in one place (seat 3 is read by its creation hint instead; see
// readers/seat3.ts):
//
//   by team   A record is the game only when its two teams resolve to the game's two teams, in
//             either order. Its points come back by team: a reader drops the feed's home and away
//             slots before this file sees the record, and this file pairs points with teams by
//             name alone. A team the feed's own record marks as outside the league (a college team
//             it gives no conference) is no team of the league, whatever its name.
//   window    A record counts only when the feed's own game time for it is inside the window.
//   hints     A hint names the feed's own id for the game. When the feed has a record under that
//             id with the game's two teams, that record is the game: inside the window it is
//             read; outside it, the game has moved and it reads "no final", unless another record
//             that could be the game is inside the window, which leaves the feed silent. A hint the
//             feed doesn't have, or one under another pair of teams, is dropped, and the game is
//             found by its teams. Two different hints for one seat leave it silent.
//   only one  Without a hint that names it, a record is the game only when nothing else in the
//             answer could be: no other record of the two teams inside the window (a doubleheader,
//             or the next game of a series), no record inside the window with one of the game's
//             teams beside a name the program can't resolve, and no record of either kind
//             without a game time, which can't be placed outside the window. Any of them, and
//             the feed is silent: it can't be said which record is the game.
//
// "Absent" (answered, no record of the game) is said only when the answer rules the game out:
// every date asked answered with at least one record, nothing in the window could be the game (a
// record whose two names the program can't resolve could be, if the feed has respelt them), and no
// record of the two teams sits outside it. An empty answer for a date is not proof the date is
// empty, so it leaves the feed silent instead.

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
	/**
	 * The feed's status, mapped. Only "final" can make a final. "short" is a final the feed's own
	 * count shows short of a whole game: it reads silent, neither final nor not final.
	 */
	readonly state: "final" | "short" | "not_final" | "postponed" | "canceled";
	/** The feed's own status words, kept for the reading's detail. */
	readonly status: string;
}

export interface FeedTeam {
	/** Every name the feed gives this team: full name, school, display name. */
	readonly names: readonly string[];
	/** Its points, or null when the feed gave none. */
	readonly points: number | null;
	/** True when the feed's own record marks the team as outside the league's teams. */
	readonly outside?: boolean;
}

/**
 * What a feed answered for one date (every page of it), or its one answer where it is asked once,
 * in the order asked.
 */
export type Listing = readonly FeedRecord[];

/** A feed's points, if they are a whole number written plainly; anything else is no points. */
export function points(v: unknown): number | null {
	if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 && v < 10000 ? v : null;
	if (typeof v === "string" && /^\d{1,4}$/.test(v.trim())) return Number(v.trim());
	return null;
}

/**
 * The team a feed's names mean, when every one of them means that one team and the feed doesn't
 * mark it as outside the league. A name the program can't resolve, beside one it can, leaves the
 * team unresolved: the feed's own names disagree.
 */
export function resolveFeedTeam(league: string, team: FeedTeam): string | null {
	if (team.outside === true) return null;
	let found: string | null = null;
	for (const name of team.names) {
		const key = resolveTeam(league, name);
		if (key === null || (found !== null && found !== key)) return null;
		found = key;
	}
	return found;
}

/** Picks the game out of a feed's answers and reads it. Seats 1, 2 and 4; seat 3 is read by hint. */
export function pick(seat: Seat, game: Game, listings: readonly Listing[]): Reading {
	const home = resolveTeam(game.league, game.home);
	const away = resolveTeam(game.league, game.away);
	if (home === null || away === null || home === away) return silent(seat, "game teams unknown");

	const keysOf = (r: FeedRecord): [string | null, string | null] => [
		resolveFeedTeam(game.league, r.teams[0]),
		resolveFeedTeam(game.league, r.teams[1]),
	];
	// A side is unknown when its names don't resolve and the feed doesn't mark it outside the league.
	const unknown = (r: FeedRecord, i: 0 | 1): boolean => keysOf(r)[i] === null && r.teams[i].outside !== true;
	const isGame = (r: FeedRecord): boolean => {
		const [a, b] = keysOf(r);
		return (a === home && b === away) || (a === away && b === home);
	};
	// One of the game's teams beside an unknown side: it may be the game.
	const mayBe = (r: FeedRecord): boolean => {
		const [a, b] = keysOf(r);
		return (unknown(r, 0) && (b === home || b === away)) || (unknown(r, 1) && (a === home || a === away));
	};
	// Both sides unknown: it names neither team as the program knows them, but it could be the game
	// respelt. It can't stop a reading, only keep the feed from saying the game is absent.
	const respelt = (r: FeedRecord): boolean => unknown(r, 0) && unknown(r, 1);
	const w = windowOf(game);
	const inside = (r: FeedRecord): boolean => r.time !== null && inWindow(r.time, w);

	// A feed can list one game under two of the dates asked for. Identical repeats are one record. A
	// repeat that differs is the same record asked again moments later, so the later answer stands,
	// unless the two name different teams, or the earlier already said final: then the feed is
	// silent. Two differing copies inside one date's answer leave it silent too.
	const differs = (x: FeedRecord, y: FeedRecord): boolean => JSON.stringify(x) !== JSON.stringify(y);
	const relevant = (x: FeedRecord, y: FeedRecord): boolean => [x, y].some((r) => isGame(r) || mayBe(r));
	const byId = new Map<string, FeedRecord>();
	for (const listing of listings) {
		const here = new Map<string, FeedRecord>();
		for (const r of listing) {
			const twin = here.get(r.id);
			if (twin === undefined) here.set(r.id, r);
			else if (differs(twin, r) && relevant(twin, r)) return silent(seat, "inconsistent records");
		}
		for (const r of here.values()) {
			const prior = byId.get(r.id);
			if (prior === undefined) byId.set(r.id, r);
			else if (differs(prior, r) && relevant(prior, r)) {
				const sameTeams = keysOf(prior).sort().join("|") === keysOf(r).sort().join("|");
				if (!sameTeams || prior.state === "final") return silent(seat, "inconsistent records");
				byId.set(r.id, r);
			}
		}
	}
	const records = [...byId.values()];
	// Anything that could be the game: in the window, or with no time to place it outside.
	const rivals = records.filter((r) => (isGame(r) || mayBe(r)) && (r.time === null || inside(r)));

	const hinted = [...new Set(game.hints.filter((h) => h.seat === seat).map((h) => h.id))];
	if (hinted.length > 1) return silent(seat, "two hints");
	if (hinted.length === 1) {
		const named = records.find((r) => r.id === hinted[0]);
		if (named !== undefined && isGame(named)) {
			if (named.time === null) return silent(seat, "no game time");
			if (inWindow(named.time, w)) return readingOf(seat, game.league, named, home);
			return rivals.length > 0 ? silent(seat, "ambiguous") : noFinal(seat, "outside window", named);
		}
	}

	const games = records.filter(isGame);
	const chosen = games.filter(inside);
	if (chosen.length === 1 && rivals.length === 1) return readingOf(seat, game.league, chosen[0], home);
	if (chosen.length > 0) return silent(seat, "ambiguous");
	if (records.some((r) => (isGame(r) || mayBe(r) || respelt(r)) && r.time === null)) return silent(seat, "no game time");
	if (records.some((r) => (mayBe(r) || respelt(r)) && inside(r))) return silent(seat, "unresolved team names");
	if (listings.some((l) => l.length === 0)) return silent(seat, "empty listing");
	if (games.length > 0) return noFinal(seat, "outside window", games[0]);
	return noFinal(seat, "absent", null);
}

function readingOf(seat: Seat, league: string, r: FeedRecord, homeKey: string): Reading {
	const record = { id: r.id, time: r.time as number };
	const firstIsHome = resolveFeedTeam(league, r.teams[0]) === homeKey;
	const homeTeam = firstIsHome ? r.teams[0] : r.teams[1];
	const awayTeam = firstIsHome ? r.teams[1] : r.teams[0];
	if (r.state === "short") return silent(seat, r.status);
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
