// The real games the suite reads, and what each seat must say about each, frozen as literals.
//
// Every game is real and every answer is a saved fixture. The clock is one instant after the last
// capture (16:30 UTC on 22 Oct 2026), so a game that had not finished then reads "no final", and
// seats 3 and 4 are silent about games older than they keep.
//
// The points are the real results, by team, and the seats that answered agree on every one.

import type { Game, Seat } from "../src/types";
import { at } from "./fixtures";

export const NOW = at("2026-10-22T16:30:00Z");

export interface Expected {
	readonly kind: "silent" | "no_final" | "final";
	readonly home: number | null;
	readonly away: number | null;
	readonly recorded: "postponed" | "canceled" | null;
	readonly detail: string;
	readonly id: string | null;
}

export interface Case {
	readonly name: string;
	readonly game: Game;
	readonly expect: Readonly<Partial<Record<Seat, Expected>>>;
}

const DAY = 86_400;
const g = (league: string, home: string, away: string, start: string): Game => ({
	league,
	home,
	away,
	start: at(start),
	n: DAY,
	hints: [],
});
const final = (home: number, away: number, id: string): Expected => ({ kind: "final", home, away, recorded: null, detail: "final", id });
const noFinal = (detail: string, id: string | null, home: number | null = null, away: number | null = null): Expected => ({
	kind: "no_final",
	home,
	away,
	recorded: detail === "postponed" || detail === "canceled" ? detail : null,
	detail,
	id,
});
const silent = (detail: string): Expected => ({ kind: "silent", home: null, away: null, recorded: null, detail, id: null });

// Seat 3 drops a game from its board once the game is final, and its results carry no teams and
// no time, so a finished game cannot be checked by team or by window there: it reads silent.
const SEAT3_FINISHED = silent("results without teams or time");

export const CASES: readonly Case[] = [
	{
		name: "nfl final: Washington at San Francisco, 23-17",
		game: g("nfl", "San Francisco 49ers", "Washington Commanders", "2026-10-20T00:15:00Z"),
		expect: {
			1: final(23, 17, "1392308"),
			2: final(23, 17, "340168"),
			3: SEAT3_FINISHED,
			4: final(23, 17, "f122527f003276d3bca19efa48c902c1"),
		},
	},
	{
		name: "nfl not final: New England at Chicago",
		game: g("nfl", "Chicago Bears", "New England Patriots", "2026-10-23T00:15:00Z"),
		expect: {
			1: noFinal("scheduled", "1392309"),
			2: noFinal("scheduled", "340175"),
			3: noFinal("NotFinished", "edcfd41f-1773-4bc9-a349-aa50931a0278"),
			4: noFinal("not completed", "ffebea881c1d7b2dfb85b3e590c35985"),
		},
	},
	{
		name: "nba final: Golden State at the Lakers, 127-105",
		game: g("nba", "Los Angeles Lakers", "Golden State Warriors", "2026-10-22T02:00:00Z"),
		expect: {
			1: final(127, 105, "21717859"),
			2: final(127, 105, "340490"),
			3: SEAT3_FINISHED,
			4: final(127, 105, "6fff70f4bf196dba25060a5775a03b54"),
		},
	},
	{
		name: "nba not final: Cleveland at Philadelphia",
		game: g("nba", "Philadelphia 76ers", "Cleveland Cavaliers", "2026-10-22T23:00:00Z"),
		expect: {
			1: noFinal("scheduled", "21717860", 0, 0),
			2: noFinal("scheduled", "340484"),
			3: noFinal("NotFinished", "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09"),
			4: noFinal("not completed", "110e33c79c5ec8c0377702aff685f83b"),
		},
	},
	{
		name: "mlb final: Cleveland at Tampa Bay, 7-3",
		game: g("mlb", "Tampa Bay Rays", "Cleveland Guardians", "2026-10-20T00:00:00Z"),
		expect: {
			1: final(7, 3, "15467429"),
			2: final(7, 3, "349200"),
			3: SEAT3_FINISHED,
			4: final(7, 3, "be50f6c59c20efa430eec6f146a0fcb1"),
		},
	},
	{
		name: "mlb not final: Tampa Bay at Milwaukee",
		game: g("mlb", "Milwaukee Brewers", "Tampa Bay Rays", "2026-10-24T00:00:00Z"),
		expect: {
			1: noFinal("scheduled", "15467432", 0, 0),
			2: noFinal("scheduled", "349332"),
			3: noFinal("NotFinished", "122d7737-bc9a-4f7a-a444-c9cee9a7e750"),
			4: noFinal("not completed", "e4c03eec29795f56b6b06c313d3af271"),
		},
	},
	{
		name: "mlb postponed: Atlanta at the White Sox, 11 Jun, rained out (made up 20 Aug)",
		game: g("mlb", "Chicago White Sox", "Atlanta Braves", "2026-06-11T23:40:00Z"),
		expect: {
			1: noFinal("postponed", "5058800", 0, 0),
			2: noFinal("canceled", "336995", 0, 0),
			3: silent("past retention"),
			4: silent("past retention"),
		},
	},
	{
		name: "mlb final: the makeup, Atlanta at the White Sox, 20 Aug, 2-0 Atlanta",
		game: g("mlb", "Chicago White Sox", "Atlanta Braves", "2026-08-20T18:10:00Z"),
		expect: {
			1: final(0, 2, "8800381"),
			2: final(0, 2, "340378"),
		},
	},
	{
		name: "mlb final: Arizona at Miami, 11 Jun, 2-0",
		game: g("mlb", "Miami Marlins", "Arizona Diamondbacks", "2026-06-11T17:10:00Z"),
		expect: {
			1: final(2, 0, "5058793"),
			2: final(2, 0, "337004"),
		},
	},
	{
		name: "nhl final: Winnipeg at St. Louis, 2-1",
		game: g("nhl", "St. Louis Blues", "Winnipeg Jets", "2026-10-21T00:00:00Z"),
		expect: {
			1: silent("http 401"),
			2: final(2, 1, "347306"),
			3: SEAT3_FINISHED,
			4: final(2, 1, "50c81d9967c2341f2117c57685000dee"),
		},
	},
	{
		name: "nhl not final: Nashville at Boston",
		game: g("nhl", "Boston Bruins", "Nashville Predators", "2026-10-22T23:00:00Z"),
		expect: {
			2: noFinal("scheduled", "347313"),
			3: noFinal("NotFinished", "2fef41ed-51ca-4693-985f-5eb74b5f4875"),
			4: noFinal("not completed", "62fca8dce49c8fa3988f75322311b896"),
		},
	},
	{
		name: "ncaaf final: Missouri State at Delaware, 61-38",
		game: g("ncaaf", "Delaware", "Missouri State", "2026-10-20T23:00:00Z"),
		expect: {
			1: silent("http 401"),
			2: final(61, 38, "339591"),
			3: SEAT3_FINISHED,
			4: final(61, 38, "dc65142bf9a0e7652a252b2074037efa"),
		},
	},
	{
		name: "ncaaf not final: James Madison at Appalachian State",
		game: g("ncaaf", "Appalachian State", "James Madison", "2026-10-22T23:00:00Z"),
		expect: {
			2: noFinal("scheduled", "339609"),
			3: noFinal("NotFinished", "1ecc09e9-a306-4846-9a3c-b8dd63f2bb84"),
			4: noFinal("not completed", "d476cb73381765342220f698035bc889"),
		},
	},
	{
		name: "ncaab final: Santa Clara at Kentucky, 20 Mar, 89-84",
		game: g("ncaab", "Kentucky", "Santa Clara", "2026-03-20T16:15:00Z"),
		expect: {
			1: silent("http 401"),
			2: final(89, 84, "338824"),
			3: silent("past retention"),
			4: silent("past retention"),
		},
	},
	{
		name: "ncaab not final: Memphis at Iowa State, 2 Nov",
		game: g("ncaab", "Iowa State", "Memphis", "2026-11-03T00:00:00Z"),
		expect: {
			2: noFinal("scheduled", "341752"),
			3: noFinal("absent", null),
			4: noFinal("absent", null),
		},
	},
];

/**
 * What the capture could not show, by seat and league, and why. A cell here is built against the
 * feed's documented shape and is re-captured in one sitting once the reason goes away.
 */
export const PENDING: Readonly<Record<Seat, Readonly<Record<string, string>>>> = {
	1: {
		nhl: "the seat's free tier refuses this league's games (401); finals and not-finals both wait on the paid tier",
		ncaaf: "the seat's free tier refuses this league's games (401); finals and not-finals both wait on the paid tier",
		ncaab: "the seat's free tier refuses this league's games (401); finals and not-finals both wait on the paid tier",
		canceled: "no cancelled game found in the dates captured",
	},
	2: {
		postponed: "the seat has no postponed word: the 11 Jun rainout reads canceled at its own time",
	},
	3: {
		final: "the seat drops a game from its board when it is final, and its results carry no teams or time: no final can be read by team or window (raised on the PR)",
		ncaab: "the league had not started: the seat's answers were empty",
		postponed: "no postponed game in the seat's five days at capture",
		canceled: "no cancelled game in the seat's five days at capture",
	},
	4: {
		ncaab: "the league had not started: the seat's answer was empty",
		postponed: "the seat records no postponed state",
		canceled: "the seat records no cancelled state",
	},
};

export const DAY_SECONDS = DAY;
