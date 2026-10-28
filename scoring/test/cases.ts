// The real games the suite reads, and what each seat must say about each, frozen as literals.
//
// Every game is real and every answer is a saved fixture. Each case reads at its own clock, and a
// request saved before and after a game ends is answered as of that clock. Four clocks:
//   NOW,  just after the first capture (17:30 UTC on 22 Oct 2026): a game that had not finished
//         then reads "no final", seat 4 is silent about games older than it keeps, and seat 1's
//         plan then refused hockey and college (401);
//   LATE, just after the night's capture (03:32 UTC on 23 Oct): four of those games, read again by
//         the same requests once they had ended;
//   MID,  just after the afternoon capture of 23 Oct (19:30 UTC), once seat 1 answered hockey and
//         college: its finals and games not final in those leagues, and the doubleheader, the
//         series and the listed-twice game that the "only one" rule in src/pick.ts turns on;
//   NIGHT, just after the capture of 24 Oct (03:47 UTC): Friday night's three games, read by every
//         seat once they had ended, seat 1 among them in hockey and college football.
//
// Seat 3 is read by the game's seat 3 hint: its results carry no team names and no time, so the
// hint is the only thing that ties a result to a game (src/readers/seat3.ts). The games still on
// its board at a capture carry the id it listed them under; the older games here were created
// without one, or with one it no longer answers for, so seat 3 reads them silent.
//
// The points are the real results, by team, and the seats that answered agree on every one.

import type { Game, Seat } from "../src/types";
import { at } from "./fixtures";

export const NOW = at("2026-10-22T17:30:00Z");
export const LATE = at("2026-10-23T03:32:00Z");
export const MID = at("2026-10-23T19:30:00Z");
export const NIGHT = at("2026-10-24T03:47:00Z");

export interface Expected {
	readonly kind: "silent" | "no_final" | "final";
	readonly home: number | null;
	readonly away: number | null;
	readonly recorded: "postponed" | "canceled" | "not_started" | null;
	readonly detail: string;
	readonly id: string | null;
}

export interface Case {
	readonly name: string;
	/** The moment the case reads at: the saved answers as of then. */
	readonly now: number;
	readonly game: Game;
	readonly expect: Readonly<Partial<Record<Seat, Expected>>>;
}

const DAY = 86_400;
const g = (league: string, home: string, away: string, start: string, seat3?: string, more: Readonly<Partial<Record<1 | 2 | 4, string>>> = {}): Game => ({
	league,
	home,
	away,
	start: at(start),
	n: DAY,
	hints: [
		...(seat3 === undefined ? [] : [{ seat: 3, id: seat3 }]),
		...Object.entries(more).map(([seat, id]) => ({ seat: Number(seat), id: id as string })),
	],
});
const final = (home: number, away: number, id: string): Expected => ({ kind: "final", home, away, recorded: null, detail: "final", id });
const noFinal = (detail: string, id: string | null, home: number | null = null, away: number | null = null): Expected => ({
	kind: "no_final",
	home,
	away,
	recorded: detail === "postponed" || detail === "canceled" ? detail : detail === "scheduled" ? "not_started" : null,
	detail,
	id,
});
const silent = (detail: string): Expected => ({ kind: "silent", home: null, away: null, recorded: null, detail, id: null });

// Created without a seat 3 hint: seat 3 has nothing to read by.
const NO_HINT = silent("no hint");

// Four games read at both clocks, each with the id seat 3 listed it under before it started.
const BEARS = g("nfl", "Chicago Bears", "New England Patriots", "2026-10-23T00:15:00Z", "edcfd41f-1773-4bc9-a349-aa50931a0278");
const SIXERS = g("nba", "Philadelphia 76ers", "Cleveland Cavaliers", "2026-10-22T23:00:00Z", "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09");
const BRUINS = g("nhl", "Boston Bruins", "Nashville Predators", "2026-10-22T23:00:00Z", "2fef41ed-51ca-4693-985f-5eb74b5f4875");
const APP_STATE = g("ncaaf", "Appalachian State", "James Madison", "2026-10-22T23:00:00Z", "1ecc09e9-a306-4846-9a3c-b8dd63f2bb84");

// Friday night's games, each with the id seat 3 listed it under on 22 Oct.
const HABS = g("nhl", "Chicago Blackhawks", "Montreal Canadiens", "2026-10-24T00:00:00Z", "efc9f85a-5d46-490f-b2c5-6e8e75ad2aef");
const CAVALIERS = g("ncaaf", "Virginia", "Duke", "2026-10-23T23:00:00Z", "0edb4d8e-710e-4f0d-b346-366b03cbb4bb");
const BREWERS = g("mlb", "Milwaukee Brewers", "Tampa Bay Rays", "2026-10-24T00:00:00Z", "122d7737-bc9a-4f7a-a444-c9cee9a7e750");

// The games the "only one" rule turns on.
const HAWAII = g("ncaab", "Hawaii", "Seattle U", "2026-11-03T04:59:00Z");
const DH1 = g("mlb", "New York Yankees", "Baltimore Orioles", "2026-09-25T20:05:00Z", "0e5c2ea5-a6eb-4768-9ac7-99690f00b765");
const DH2 = g("mlb", "New York Yankees", "Baltimore Orioles", "2026-09-25T23:05:00Z", "2a4c09e2-129b-4bea-aa97-b4156de41531");
const CUBS_NIGHT = g("mlb", "Chicago Cubs", "Chicago White Sox", "2026-08-19T00:05:00Z");

export const CASES: readonly Case[] = [
	{
		name: "nfl final: Washington at San Francisco, 23-17",
		now: NOW,
		game: g("nfl", "San Francisco 49ers", "Washington Commanders", "2026-10-20T00:15:00Z"),
		expect: {
			1: final(23, 17, "1392308"),
			2: final(23, 17, "340168"),
			3: NO_HINT,
			4: final(23, 17, "f122527f003276d3bca19efa48c902c1"),
		},
	},
	{
		name: "nfl not final: New England at Chicago",
		now: NOW,
		game: BEARS,
		expect: {
			1: noFinal("scheduled", "1392309"),
			2: noFinal("scheduled", "340175"),
			3: noFinal("NotFinished", "edcfd41f-1773-4bc9-a349-aa50931a0278"),
			4: noFinal("not completed", "ffebea881c1d7b2dfb85b3e590c35985"),
		},
	},
	{
		name: "nba final: Golden State at the Lakers, 127-105",
		now: NOW,
		game: g("nba", "Los Angeles Lakers", "Golden State Warriors", "2026-10-22T02:00:00Z"),
		expect: {
			1: final(127, 105, "21717859"),
			2: final(127, 105, "340490"),
			3: NO_HINT,
			4: final(127, 105, "6fff70f4bf196dba25060a5775a03b54"),
		},
	},
	{
		name: "nba not final: Cleveland at Philadelphia",
		now: NOW,
		game: SIXERS,
		expect: {
			1: noFinal("scheduled", "21717860", 0, 0),
			2: noFinal("scheduled", "340484"),
			3: noFinal("NotFinished", "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09"),
			4: noFinal("not completed", "110e33c79c5ec8c0377702aff685f83b"),
		},
	},
	{
		name: "mlb final: Cleveland at Tampa Bay, 7-3",
		now: NOW,
		game: g("mlb", "Tampa Bay Rays", "Cleveland Guardians", "2026-10-20T00:00:00Z"),
		expect: {
			1: final(7, 3, "15467429"),
			2: final(7, 3, "349200"),
			3: NO_HINT,
			4: final(7, 3, "be50f6c59c20efa430eec6f146a0fcb1"),
		},
	},
	{
		name: "mlb not final: Tampa Bay at Milwaukee",
		now: NOW,
		game: BREWERS,
		expect: {
			1: noFinal("scheduled", "15467432", 0, 0),
			2: noFinal("scheduled", "349332"),
			3: noFinal("NotFinished", "122d7737-bc9a-4f7a-a444-c9cee9a7e750"),
			4: noFinal("not completed", "e4c03eec29795f56b6b06c313d3af271"),
		},
	},
	{
		name: "mlb postponed: Atlanta at the White Sox, 11 Jun, rained out (made up 20 Aug)",
		now: NOW,
		game: g("mlb", "Chicago White Sox", "Atlanta Braves", "2026-06-11T23:40:00Z"),
		expect: {
			1: noFinal("postponed", "5058800", 0, 0),
			2: noFinal("canceled", "336995", 0, 0),
			3: NO_HINT,
			4: silent("past retention"),
		},
	},
	{
		name: "mlb final: the makeup, Atlanta at the White Sox, 20 Aug, 2-0 Atlanta",
		now: NOW,
		game: g("mlb", "Chicago White Sox", "Atlanta Braves", "2026-08-20T18:10:00Z"),
		expect: {
			1: final(0, 2, "8800381"),
			2: final(0, 2, "340378"),
		},
	},
	{
		name: "mlb final: Arizona at Miami, 11 Jun, 2-0",
		now: NOW,
		game: g("mlb", "Miami Marlins", "Arizona Diamondbacks", "2026-06-11T17:10:00Z"),
		expect: {
			1: final(2, 0, "5058793"),
			2: final(2, 0, "337004"),
		},
	},
	{
		name: "mlb final, 11 Jun: Houston at the Angels, 3-2; seat 3's result for its hint has aged out",
		now: NOW,
		game: g("mlb", "Los Angeles Angels", "Houston Astros", "2026-06-11T01:38:00Z", "acc4e59b-999e-469b-9137-a2ed1b45aab2"),
		expect: {
			1: final(3, 2, "5058792"),
			2: final(3, 2, "336983"),
			3: silent("no result for the hint"),
			4: silent("past retention"),
		},
	},
	{
		name: "nhl final: Winnipeg at St. Louis, 2-1",
		now: NOW,
		game: g("nhl", "St. Louis Blues", "Winnipeg Jets", "2026-10-21T00:00:00Z"),
		expect: {
			1: silent("http 401"),
			2: final(2, 1, "347306"),
			3: NO_HINT,
			4: final(2, 1, "50c81d9967c2341f2117c57685000dee"),
		},
	},
	{
		name: "nhl not final: Nashville at Boston",
		now: NOW,
		game: BRUINS,
		expect: {
			2: noFinal("scheduled", "347313"),
			3: noFinal("NotFinished", "2fef41ed-51ca-4693-985f-5eb74b5f4875"),
			4: noFinal("not completed", "62fca8dce49c8fa3988f75322311b896"),
		},
	},
	{
		name: "ncaaf final: Missouri State at Delaware, 61-38",
		now: NOW,
		game: g("ncaaf", "Delaware", "Missouri State", "2026-10-20T23:00:00Z"),
		expect: {
			1: silent("http 401"),
			2: final(61, 38, "339591"),
			3: NO_HINT,
			4: final(61, 38, "dc65142bf9a0e7652a252b2074037efa"),
		},
	},
	{
		name: "ncaaf not final: James Madison at Appalachian State",
		now: NOW,
		game: APP_STATE,
		expect: {
			2: noFinal("scheduled", "339609"),
			3: noFinal("NotFinished", "1ecc09e9-a306-4846-9a3c-b8dd63f2bb84"),
			4: noFinal("not completed", "d476cb73381765342220f698035bc889"),
		},
	},
	{
		name: "ncaab final: Santa Clara at Kentucky, 20 Mar, 89-84",
		now: NOW,
		game: g("ncaab", "Kentucky", "Santa Clara", "2026-03-20T16:15:00Z"),
		expect: {
			1: silent("http 401"),
			2: final(89, 84, "338824"),
			3: NO_HINT,
			4: silent("past retention"),
		},
	},
	{
		name: "ncaab not final: Memphis at Iowa State, 2 Nov",
		now: NOW,
		game: g("ncaab", "Iowa State", "Memphis", "2026-11-03T00:00:00Z"),
		expect: {
			2: noFinal("scheduled", "341752"),
			3: NO_HINT,
			// The league had not started at this seat: its answer was an empty list, which is not
			// proof the game is absent.
			4: silent("no id, and the slate is past the size"),
		},
	},
	// The same four games and the same requests, read after they ended. Seat 1 was not asked for
	// hockey or college football that night: its plan then refused those leagues.
	{
		name: "nfl final, read after the game: New England at Chicago, 30-24",
		now: LATE,
		game: BEARS,
		expect: {
			1: final(30, 24, "1392309"),
			2: final(30, 24, "340175"),
			3: final(30, 24, "edcfd41f-1773-4bc9-a349-aa50931a0278"),
			4: final(30, 24, "ffebea881c1d7b2dfb85b3e590c35985"),
		},
	},
	{
		name: "nba final, read after the game: Cleveland at Philadelphia, 114-106",
		now: LATE,
		game: SIXERS,
		expect: {
			1: final(114, 106, "21717860"),
			2: final(114, 106, "340484"),
			3: final(114, 106, "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09"),
			4: final(114, 106, "110e33c79c5ec8c0377702aff685f83b"),
		},
	},
	{
		name: "nhl final, read after the game: Nashville at Boston, 6-0",
		now: LATE,
		game: BRUINS,
		expect: {
			2: final(6, 0, "347313"),
			3: final(6, 0, "2fef41ed-51ca-4693-985f-5eb74b5f4875"),
			4: final(6, 0, "62fca8dce49c8fa3988f75322311b896"),
		},
	},
	{
		name: "ncaaf final, read after the game: James Madison at Appalachian State, 34-31",
		now: LATE,
		game: APP_STATE,
		expect: {
			2: final(34, 31, "339609"),
			3: final(34, 31, "1ecc09e9-a306-4846-9a3c-b8dd63f2bb84"),
			4: final(34, 31, "d476cb73381765342220f698035bc889"),
		},
	},
	// Seat 1 once it answered hockey and college: the paths it refused on 22 Oct, asked again and
	// saved beside the refusals, so the cases above still read the 401 at their own clock.
	{
		name: "nhl final, read the next afternoon: Nashville at Boston, 6-0",
		now: MID,
		game: BRUINS,
		expect: {
			1: final(6, 0, "3328202"),
			2: final(6, 0, "347313"),
			3: final(6, 0, "2fef41ed-51ca-4693-985f-5eb74b5f4875"),
			4: final(6, 0, "62fca8dce49c8fa3988f75322311b896"),
		},
	},
	{
		name: "nhl final, read with seat 1 answering: Winnipeg at St. Louis, 2-1",
		now: MID,
		game: g("nhl", "St. Louis Blues", "Winnipeg Jets", "2026-10-21T00:00:00Z"),
		expect: {
			1: final(2, 1, "3328194"),
			2: final(2, 1, "347306"),
			3: NO_HINT,
			4: silent("past retention"),
		},
	},
	{
		name: "nhl not final: Montreal at Chicago",
		now: MID,
		game: HABS,
		expect: {
			1: noFinal("scheduled", "3328214", 0, 0),
			2: noFinal("scheduled", "347317"),
			3: noFinal("NotFinished", "efc9f85a-5d46-490f-b2c5-6e8e75ad2aef"),
			4: noFinal("not completed", "db9d82d62d8f222bfd835100662c6ac6"),
		},
	},
	{
		name: "ncaaf final, read the next afternoon: James Madison at Appalachian State, 34-31",
		now: MID,
		game: APP_STATE,
		expect: {
			1: final(34, 31, "458424"),
			2: final(34, 31, "339609"),
			3: final(34, 31, "1ecc09e9-a306-4846-9a3c-b8dd63f2bb84"),
			4: final(34, 31, "d476cb73381765342220f698035bc889"),
		},
	},
	{
		name: "ncaaf final, read with seat 1 answering: Missouri State at Delaware, 61-38",
		now: MID,
		game: g("ncaaf", "Delaware", "Missouri State", "2026-10-20T23:00:00Z"),
		expect: {
			1: final(61, 38, "457764"),
			2: final(61, 38, "339591"),
			3: NO_HINT,
			4: silent("past retention"),
		},
	},
	{
		name: "ncaaf not final: Duke at Virginia",
		now: MID,
		game: CAVALIERS,
		expect: {
			1: noFinal("scheduled", "457380", 0, 0),
			2: noFinal("scheduled", "339623"),
			3: noFinal("NotFinished", "0edb4d8e-710e-4f0d-b346-366b03cbb4bb"),
			4: noFinal("not completed", "a493efd6ef737f676a45aacc0eaf7be8"),
		},
	},
	{
		name: "ncaab final, read with seat 1 answering: Santa Clara at Kentucky, 20 Mar, 89-84 in overtime",
		now: MID,
		game: g("ncaab", "Kentucky", "Santa Clara", "2026-03-20T16:15:00Z"),
		expect: {
			1: final(89, 84, "2798585"),
			2: final(89, 84, "338824"),
			3: NO_HINT,
			4: silent("past retention"),
		},
	},
	{
		name: "ncaab not final, read with seat 1 answering: Memphis at Iowa State, 2 Nov",
		now: MID,
		game: g("ncaab", "Iowa State", "Memphis", "2026-11-03T00:00:00Z"),
		expect: {
			1: noFinal("scheduled", "10882536", 0, 0),
			2: noFinal("scheduled", "341752"),
			3: NO_HINT,
			4: silent("no id, and the slate is past the size"),
		},
	},
	// Listed twice: seat 2 has Seattle at Hawaii under two ids a minute apart (04:59 and 05:00 UTC
	// on 3 Nov); seat 1 lists it once, at 04:59, its time for a start not yet announced. The start
	// is the earliest of the counting seats' times, 04:59. Without a hint seat 2 can't say which
	// record is the game, so it is silent; hinted, it reads the record named.
	{
		name: "ncaab listed twice at seat 2: Seattle at Hawaii, 2 Nov",
		now: MID,
		game: HAWAII,
		expect: {
			1: noFinal("scheduled", "10882589", 0, 0),
			2: silent("ambiguous"),
			3: NO_HINT,
			4: silent("no id, and the slate is past the size"),
		},
	},
	// Beside a game to be announced: seat 2's answer for 4 Nov holds Virginia University-Lynchburg at
	// Morehead State with no time. Seat 2's record gives the visitors no conference, outside Division
	// I, so it can't be this game, and Morehead State at Western Kentucky reads.
	{
		name: "ncaab not final beside a game to be announced: Morehead State at Western Kentucky, 2 Nov",
		now: MID,
		game: g("ncaab", "Western Kentucky", "Morehead State", "2026-11-03T00:30:00Z"),
		expect: {
			1: noFinal("scheduled", "10882439", 0, 0),
			// Western Kentucky's game to be announced, against a school the lists don't know, has no time to
			// place it: it could be the game, and seat 2 is silent (a conference missing is unknown, never a mark).
			2: silent("ambiguous"),
			3: NO_HINT,
			4: silent("no id, and the slate is past the size"),
		},
	},
	{
		name: "ncaab listed twice at seat 2, read with seat 2's hint for the later id: Seattle at Hawaii",
		now: MID,
		game: { ...HAWAII, hints: [{ seat: 2, id: "348655" }] },
		expect: { 2: noFinal("scheduled", "348655") },
	},
	// A doubleheader: Baltimore at the Yankees twice on 25 Sep, game 1 at 20:05 UTC, game 2 created
	// for its scheduled 23:05 and played from 23:30 once game 1 ran long. Each creation has its own
	// date and its own hints. Game 1's window holds both games, so without a hint seats 1 and 2 can't
	// say which is game 1 and are silent; with them, each reads game 1. Game 2's window starts after
	// game 1, so it holds one game and reads with or without hints; the later start the seats give it
	// stays inside its window. Seat 3's ids for both are a month old, and it no longer answers for
	// them; seat 4 keeps three days.
	{
		name: "mlb doubleheader, game 1 without hints: Baltimore at the Yankees, 25 Sep",
		now: MID,
		game: DH1,
		expect: {
			1: silent("ambiguous"),
			2: silent("ambiguous"),
			3: silent("no result for the hint"),
			4: silent("past retention"),
		},
	},
	{
		name: "mlb doubleheader, game 1 with hints: Baltimore at the Yankees, 25 Sep, 10-2 Baltimore",
		now: MID,
		game: { ...DH1, hints: [...DH1.hints, { seat: 1, id: "5060179" }, { seat: 2, id: "348506" }] },
		expect: {
			1: final(2, 10, "5060179"),
			2: final(2, 10, "348506"),
			3: silent("no result for the hint"),
			4: silent("past retention"),
		},
	},
	{
		name: "mlb doubleheader, game 2 without hints, started late: Baltimore at the Yankees, 25 Sep, 6-3 Yankees",
		now: MID,
		game: DH2,
		expect: {
			1: final(6, 3, "5060160"),
			2: final(6, 3, "338376"),
			3: silent("no result for the hint"),
			4: silent("past retention"),
		},
	},
	{
		name: "mlb doubleheader, game 2 with hints: Baltimore at the Yankees, 25 Sep, 6-3 Yankees",
		now: MID,
		game: { ...DH2, hints: [...DH2.hints, { seat: 1, id: "5060160" }, { seat: 2, id: "338376" }] },
		expect: {
			1: final(6, 3, "5060160"),
			2: final(6, 3, "338376"),
		},
	},
	// A series: the White Sox at the Cubs on the night of 18 Aug (00:05 UTC on the 19th) and again
	// the next afternoon (18:20 UTC), 18 hours apart. The night game's window holds both, so without
	// a hint seats 1 and 2 are silent; hinted, each reads it. The afternoon game's window does not
	// reach back to the night game.
	{
		name: "mlb series, the night game without hints: White Sox at the Cubs, 18 Aug",
		now: MID,
		game: CUBS_NIGHT,
		expect: { 1: silent("ambiguous"), 2: silent("ambiguous"), 3: NO_HINT, 4: silent("past retention") },
	},
	{
		name: "mlb series, the night game with hints: White Sox at the Cubs, 18 Aug, 4-3 Cubs",
		now: MID,
		game: { ...CUBS_NIGHT, hints: [{ seat: 1, id: "5059668" }, { seat: 2, id: "337867" }] },
		expect: { 1: final(4, 3, "5059668"), 2: final(4, 3, "337867") },
	},
	{
		name: "mlb series, the next afternoon's game without hints: White Sox at the Cubs, 19 Aug, 3-0 White Sox",
		now: MID,
		game: g("mlb", "Chicago Cubs", "Chicago White Sox", "2026-08-19T18:20:00Z"),
		expect: { 1: final(0, 3, "5059675"), 2: final(0, 3, "337877") },
	},
	// Friday night's three games, read by the same requests once they had ended. Seat 3's results
	// are the ids it listed them under on 22 Oct; seat 4's times are the actual starts (23:06, 00:09
	// and 00:16 UTC), inside each window.
	{
		name: "ncaaf final, read after the game: Duke at Virginia, 19-16 Duke",
		now: NIGHT,
		game: CAVALIERS,
		expect: {
			1: final(16, 19, "457380"),
			2: final(16, 19, "339623"),
			3: final(16, 19, "0edb4d8e-710e-4f0d-b346-366b03cbb4bb"),
			4: final(16, 19, "a493efd6ef737f676a45aacc0eaf7be8"),
		},
	},
	{
		name: "nhl final, read after the game: Montreal at Chicago, 4-1 Montreal",
		now: NIGHT,
		game: HABS,
		expect: {
			1: final(1, 4, "3328214"),
			2: final(1, 4, "347317"),
			3: final(1, 4, "efc9f85a-5d46-490f-b2c5-6e8e75ad2aef"),
			4: final(1, 4, "db9d82d62d8f222bfd835100662c6ac6"),
		},
	},
	{
		name: "mlb final, read after the game: Tampa Bay at Milwaukee, World Series game 1, 3-2 Milwaukee",
		now: NIGHT,
		game: BREWERS,
		expect: {
			1: final(3, 2, "15467432"),
			2: final(3, 2, "349332"),
			3: final(3, 2, "122d7737-bc9a-4f7a-a444-c9cee9a7e750"),
			4: final(3, 2, "e4c03eec29795f56b6b06c313d3af271"),
		},
	},
];

/**
 * What the capture could not show, by seat and league, and why. A cell here is built against the
 * feed's documented shape and is re-captured in one sitting once the reason goes away.
 */
export const PENDING: Readonly<Record<Seat, Readonly<Record<string, string>>>> = {
	1: {
		canceled: "no cancelled game found in the dates captured",
	},
	2: {
		postponed: "the seat has no postponed word: the 11 Jun rainout reads canceled at its own time",
	},
	3: {
		ncaab: "the league had not started: the seat listed no game",
		postponed: "no postponed game in the seat's five days at capture, and results older than that answer nothing by id",
		canceled: "no cancelled game in the seat's five days at capture",
	},
	4: {
		ncaab: "the league had not started: the seat's answer was empty",
		postponed: "the seat records no postponed state",
		canceled: "the seat records no cancelled state",
	},
};

export const DAY_SECONDS = DAY;
