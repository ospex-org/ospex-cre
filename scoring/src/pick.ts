// Finding the game among a feed's records, and turning the record into a reading. Seats 1, 2 and
// 4 end here, so the rules live in one place (seat 3 is read by its creation hint instead; see
// readers/seat3.ts):
//
//   by team   A record is the game only when its two teams resolve to the game's two teams, in
//             either order. Its points come back by team: a reader drops the feed's home and away
//             slots before this file sees the record, and this file pairs points with teams by
//             name alone. A missing or null conference, or any other missing metadata, is unknown and
//             never a mark against a team: the record still binds by its names and time.
//   window    A record counts only when the feed's own game time for it is inside the window.
//   hints     A hint names the feed's own id for the game. It only chooses among records that pass
//             both tests above, the game's two teams and a time inside the window: a hinted record
//             that passes both is read, whatever else is in the window. One that fails either is
//             never read. A hint the feed doesn't have, or one under another pair of teams, is
//             dropped and the game is found by its teams. A hinted record of the game's two teams
//             with no time inside the window leaves the feed silent while anything else could be
//             the game, since the hint and the window disagree on which record that is; with
//             nothing else, it is dropped too. Two different hints for one seat leave it silent.
//   only one  Without a hint that names it, a record is the game only when nothing else in the
//             answer could be: no other record of the two teams inside the window (a doubleheader,
//             or the next game of a series), no record inside the window with one of the game's
//             teams beside a name the program can't resolve, no record of either kind without a
//             game time, which can't be placed outside the window, and no record the lists can't
//             place inside the window and earlier than it. Any of them, and the feed is silent: it
//             can't be said which record is the game.
//
//             A record the lists can't place has neither side resolved (names the program can't
//             resolve). Earlier in the window, it may be the game itself, listed in a way the lists
//             don't know, and the record after it the two teams' next game. At the same instant as
//             the record or later, or with no time, it doesn't stop the read.
//
// Absence is silence. A listing that does not give the game, empty or not (the game absent from it,
// or the two teams' record outside the window), says nothing about the game: a spelling the feed no
// longer uses, a filter it did not apply, or a list that stops short answers that way too, and no
// listing proves the game is not there. So the feed is silent, with the reason (absent, outside
// window), and never says the game has no final. A row of the game without a readable status is
// silence too (readingOf): a partial row says nothing about the game's end. What a row does say, in
// the feed's own words, rides on the reading: postponed or cancelled on `recorded`, the word itself on
// `detail`; rule.ts decides what each is worth, and a row scheduled or in play is an answer that is
// never a void's vote.
//
// A row of the game that says final rides on the reading even where the pick can't read it: a listing
// holding the game's own row, bound by its two teams and a time inside the window, whose status says
// final (final, or short of a whole game by the feed's own count), leaves a silent reading marked
// saysFinal (listsFinal, saidFinal; types.ts), whether the pick stopped on two records that differ or
// on two that could be the game, or the reader on a row it could not parse. The mark is never a
// scoring vote; after n the void waits on it (rule.ts). A hint that names the game's row by id binds
// that row alone: another row of the two teams in the window is another game, and its final marks
// nothing.

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
	 * count shows short of a whole game: it reads silent, neither final nor not final. "postponed" and
	 * "canceled" are the feed's own words that the game will not or did not play; "not_final" is any
	 * other word short of a final, scheduled or in play; "no_status" is a row with no readable status,
	 * which reads silent.
	 */
	readonly state: "final" | "short" | "postponed" | "canceled" | "not_final" | "no_status";
	/** The feed's own status words, kept for the reading's detail. */
	readonly status: string;
}

export interface FeedTeam {
	/** Every name the feed gives this team: full name, school, display name. */
	readonly names: readonly string[];
	/** Its points, or null when the feed gave none. */
	readonly points: number | null;
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
 * The team a feed's names mean, when every one of them means that one team. A name the program
 * can't resolve, beside one it can, leaves the team unresolved: the feed's own names disagree.
 */
export function resolveFeedTeam(league: string, team: FeedTeam): string | null {
	let found: string | null = null;
	for (const name of team.names) {
		const key = resolveTeam(league, name);
		if (key === null || (found !== null && found !== key)) return null;
		found = key;
	}
	return found;
}

/**
 * Whether a listing holds the game's own row, bound by its two teams and a time inside the window,
 * whose status says final: final, or short of a whole game by the feed's own count. Scorable or not,
 * that row is a final for the void's purpose (types.ts, saysFinal).
 */
export function listsFinal(game: Game, listings: readonly Listing[]): boolean {
	const home = resolveTeam(game.league, game.home);
	const away = resolveTeam(game.league, game.away);
	if (home === null || away === null || home === away) return false;
	const w = windowOf(game);
	return listings.some((l) =>
		l.some((r) => {
			if (r.state !== "final" && r.state !== "short") return false;
			if (r.time === null || !inWindow(r.time, w)) return false;
			const a = resolveFeedTeam(game.league, r.teams[0]);
			const b = resolveFeedTeam(game.league, r.teams[1]);
			return (a === home && b === away) || (a === away && b === home);
		}),
	);
}

/** A silent reading marked as the feed saying the game is final all the same; any other reading as it is. */
export function saidFinal(r: Reading, said: boolean): Reading {
	return said && r.kind === "silent" && r.saysFinal !== true ? { ...r, saysFinal: true } : r;
}

/**
 * Picks the game out of a feed's answers and reads it. Seats 1, 2 and 4; seat 3 is read by hint.
 *
 * `near` is for verification, before a start is written: among the records of the two teams in the
 * window, the game is the one nearest that time (the date the creator gave), and two at the same
 * distance leave the feed silent. It takes the place of one test of "only one" above (no other
 * record of the two teams inside the window); a hint, and any other record that could be the game,
 * decide as they do without it, except a record with a team the lists don't know: one of the game's
 * teams beside a name they don't know, and a record they can't place. Those are weighed only in the
 * scoring window, where verification reads every seat again from the start it chose, without
 * `near`, exactly as scoring will: the window `near` reads is a day either side of the date, and a
 * record a day before the game says nothing about it at scoring.
 */
export function pick(seat: Seat, game: Game, listings: readonly Listing[], near?: number): Reading {
	const home = resolveTeam(game.league, game.home);
	const away = resolveTeam(game.league, game.away);
	if (home === null || away === null || home === away) return silent(seat, "game teams unknown");

	const keysOf = (r: FeedRecord): [string | null, string | null] => [
		resolveFeedTeam(game.league, r.teams[0]),
		resolveFeedTeam(game.league, r.teams[1]),
	];
	// A side is unknown when its names don't resolve.
	const unknown = (r: FeedRecord, i: 0 | 1): boolean => keysOf(r)[i] === null;
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
	// respelt. Inside the window it keeps the feed from saying the game is absent; earlier than a
	// record of the game, it also stops that record being read (see `unplaced`).
	const respelt = (r: FeedRecord): boolean => unknown(r, 0) && unknown(r, 1);
	const w = windowOf(game);
	const inside = (r: FeedRecord): boolean => r.time !== null && inWindow(r.time, w);
	// A row of the game inside the window that says final marks every silent reading from here on.
	const said = listsFinal(game, listings);
	const quiet = (detail: string): Reading => saidFinal(silent(seat, detail), said);

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
			else if (differs(twin, r) && relevant(twin, r)) return quiet("inconsistent records");
		}
		for (const r of here.values()) {
			const prior = byId.get(r.id);
			if (prior === undefined) byId.set(r.id, r);
			else if (differs(prior, r) && relevant(prior, r)) {
				const sameTeams = keysOf(prior).sort().join("|") === keysOf(r).sort().join("|");
				if (!sameTeams || prior.state === "final") return quiet("inconsistent records");
				byId.set(r.id, r);
			}
		}
	}
	const records = [...byId.values()];
	const games = records.filter(isGame);
	const chosen = games.filter(inside);
	const earlier = (r: FeedRecord): boolean => inside(r) && chosen.some((c) => (r.time as number) < (c.time as number));
	// Anything that could be the game: in the window, or with no time to place it outside; and a
	// record the lists can't place (neither side resolved), inside the window and earlier than a
	// record of the game.
	const rivals = records.filter((r) => ((isGame(r) || (near === undefined && mayBe(r))) && (r.time === null || inside(r))) || (near === undefined && respelt(r) && earlier(r)));

	const hinted = [...new Set(game.hints.filter((h) => h.seat === seat).map((h) => h.id))];
	if (hinted.length > 1) return quiet("two hints");
	if (hinted.length === 1) {
		const named = records.find((r) => r.id === hinted[0]);
		if (named !== undefined && isGame(named)) {
			if (inside(named)) return readingOf(seat, game.league, named, home);
			// The game's two teams, but no time inside the window: not read, and while anything else
			// could be the game, nothing else is read either. Otherwise the hint is dropped.
			if (rivals.length > 0) return quiet(named.time === null ? "no game time" : "ambiguous");
		}
	}

	// Verification: several records of the two teams inside the window, and nothing else that could
	// be the game. The one nearest the creator's date is the game; two at the same distance, none is.
	if (near !== undefined && chosen.length > 1 && rivals.length === chosen.length) {
		const distance = (r: FeedRecord): number => Math.abs((r.time as number) - near);
		const [first, second] = [...chosen].sort((x, y) => distance(x) - distance(y));
		return distance(first) < distance(second) ? readingOf(seat, game.league, first, home) : quiet("ambiguous");
	}
	if (chosen.length === 1 && rivals.length === 1) return readingOf(seat, game.league, chosen[0], home);
	if (chosen.length > 0) return quiet("ambiguous");
	if (records.some((r) => (isGame(r) || mayBe(r) || respelt(r)) && r.time === null)) return silent(seat, "no game time");
	if (records.some((r) => (mayBe(r) || respelt(r)) && inside(r))) return silent(seat, "unresolved team names");
	if (listings.some((l) => l.length === 0)) return silent(seat, "empty listing");
	// Absence is silence: the two teams' record outside the window (kept on the reading, for the line),
	// or no record of the game at all.
	if (games.length > 0) return { ...silent(seat, "outside window"), record: games[0].time === null ? null : { id: games[0].id, time: games[0].time } };
	return silent(seat, "absent");
}

function readingOf(seat: Seat, league: string, r: FeedRecord, homeKey: string): Reading {
	const record = { id: r.id, time: r.time as number };
	const firstIsHome = resolveFeedTeam(league, r.teams[0]) === homeKey;
	const homeTeam = firstIsHome ? r.teams[0] : r.teams[1];
	const awayTeam = firstIsHome ? r.teams[1] : r.teams[0];
	// The feed says final, but its count or its points can't make one: silent, and marked as the feed
	// saying the game is over, which verification reads (types.ts, saysFinal).
	if (r.state === "short") return { ...silent(seat, r.status), saysFinal: true };
	if (r.state === "final") {
		if (homeTeam.points === null || awayTeam.points === null) return { ...silent(seat, "final without points"), saysFinal: true };
		return { seat, kind: "final", home: homeTeam.points, away: awayTeam.points, recorded: null, detail: "final", record };
	}
	// A row without a readable status is a partial row: it says nothing about the game's end.
	if (r.state === "no_status") return silent(seat, "no status");
	// The feed's own word that the game will not or did not play rides on the reading: a void may rest
	// on it (rule.ts). A row scheduled or in play carries none.
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
