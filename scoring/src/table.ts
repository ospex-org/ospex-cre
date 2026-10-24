// The feed table.
//
// This is the one place in the program that names a feed. Everywhere else, in the code, the
// fixtures, the tests and every reading the program builds, a feed is its seat number here. The
// table is part of the program's fingerprint: changing a row is a new program, approved through
// the timelock's delay. Nothing at runtime adds to it, removes from it or reorders it; the only
// thing the program takes from outside is each seat's key.
//
// Seats 1 to 3 count. Seat 4 is the spare, asked on every run. A feed keeps its seat in every
// league, and every league here has all four.

import type { Seat } from "./types";

export interface SeatRow {
	readonly seat: Seat;
	/** Who the feed is, for an agent checking the feeds are real. */
	readonly name: string;
	/** Other names the feed is reached or known by, kept here so no other file needs them. */
	readonly alsoKnownAs: readonly string[];
	/** The host every request for this seat goes to. */
	readonly host: string;
	/** Where the seat's key goes: a header, or a query parameter. */
	readonly key: { readonly header: string } | { readonly query: string };
	/** Fixed headers the feed needs besides the key. */
	readonly headers: Readonly<Record<string, string>>;
}

export const SEATS: readonly SeatRow[] = deepFreeze([
	{
		seat: 1,
		name: "BALLDONTLIE",
		alsoKnownAs: [],
		host: "api.balldontlie.io",
		key: { header: "Authorization" },
		headers: {},
	},
	{
		seat: 2,
		name: "Sportspage Feeds",
		alsoKnownAs: ["Sportspage", "RapidAPI"],
		host: "sportspage-feeds.p.rapidapi.com",
		key: { header: "x-rapidapi-key" },
		headers: { "x-rapidapi-host": "sportspage-feeds.p.rapidapi.com" },
	},
	{
		seat: 3,
		name: "JsonOdds",
		alsoKnownAs: [],
		host: "api.jsonodds.com",
		key: { header: "x-api-key" },
		headers: {},
	},
	{
		seat: 4,
		name: "The Odds API",
		alsoKnownAs: [],
		host: "api.the-odds-api.com",
		key: { query: "apiKey" },
		headers: {},
	},
] as const);

/** The seats whose finals count. */
export const COUNTING: readonly Seat[] = deepFreeze([1, 2, 3] as const);

/** The spare, asked on every run. */
export const SPARE: Seat = 4;

/** Each seat's own code for a league: the path or parameter that seat files the league under. */
export interface LeagueRow {
	readonly 1: string;
	readonly 2: string;
	readonly 3: string;
	readonly 4: string;
}

/** The leagues the program reads, by the short text id a game is created with. */
export const LEAGUES: Readonly<Record<string, LeagueRow>> = deepFreeze({
	nfl: { 1: "/nfl/v1/games", 2: "NFL", 3: "NFL", 4: "americanfootball_nfl" },
	nba: { 1: "/v1/games", 2: "NBA", 3: "NBA", 4: "basketball_nba" },
	mlb: { 1: "/mlb/v1/games", 2: "MLB", 3: "MLB", 4: "baseball_mlb" },
	nhl: { 1: "/nhl/v1/games", 2: "NHL", 3: "NHL", 4: "icehockey_nhl" },
	ncaaf: { 1: "/ncaaf/v1/games", 2: "NCAAF", 3: "NCAAF", 4: "americanfootball_ncaaf" },
	ncaab: { 1: "/ncaab/v1/games", 2: "NCAAB", 3: "NCAAB", 4: "basketball_ncaab" },
});

export function seatRow(seat: Seat): SeatRow {
	const row = SEATS.find((r) => r.seat === seat);
	if (!row) throw new Error(`no seat ${seat}`);
	return row;
}

/** The league's row, or null when the program does not offer the league. */
export function leagueRow(league: string): LeagueRow | null {
	return Object.prototype.hasOwnProperty.call(LEAGUES, league) ? LEAGUES[league] : null;
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
	}
	return value;
}
