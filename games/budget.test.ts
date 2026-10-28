// The worst case is the readers' own. The tick starts a full read only when the most requests the
// program may send for that league fits the count it has left (lib.ts, scoringRequests and
// verifyingRequests). The numbers there are derived here by running the real readers and the real
// program against a feed that fills every page: one request per filing date per page of a hundred rows
// at seats 1 and 2, a date's rows at most the league's teams, each reader run stopped at the program's
// own bound of twelve; one at seat 3 and one at the spare; and at verification the range read, the
// board, and the window read again from the start chosen, which reaches one date more when the start
// is a day past the date. A table that drifted from the readers fails here.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import { readerFor } from "../scoring/src/index";
import { scoreGameSync } from "../scoring/src/program";
import { MAX_REQUESTS, runSync } from "../scoring/src/run";
import { LEAGUES } from "../scoring/src/table";
import { TEAMS } from "../scoring/src/teams/index";
import type { Game, HttpRequest, HttpResponse, Seat } from "../scoring/src/types";
import { START_BOUND } from "../scoring/src/verify";
import { filingDates } from "../scoring/src/window";
import { KEY, locate } from "../scoring/test/fixtures";
import { PAYOUT, PAYOUT_REFUSED } from "../scoring/test/rule-helpers";
import { ROWS_A_PAGE, memoized, pagesADate, scoringRequests, verifyingRequests } from "./lib";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const DAY = 86_400;
/** A start at 23:00 UTC: its day's window touches three filing dates. */
const MIDDAY = Date.UTC(2026, 9, 22, 23, 0) / 1000;
/** A start at 00:00 UTC: two. */
const MIDNIGHT = Date.UTC(2026, 9, 23) / 1000;
const HINT = "edcfd41f-1773-4bc9-a349-aa50931a0278";

const iso = (t: number): string => new Date(t * 1000).toISOString();
const utcDate = (t: number): string => iso(t).slice(0, 10);

/** The game's own record at seats 1, 2 and 4, listed at `time`, or null for a filler. */
interface Listed {
	readonly home: string;
	readonly away: string;
	readonly time: number;
}

/**
 * A feed for one league that lists `rows` games on every filing date at seats 1 and 2, served in pages
 * the way each seat pages (seat 1 by cursor, ending on the page without one; seat 2 by skip, a full page
 * asking once more), with the game's own record on its date where one is given; the board and the result
 * at seat 3 and the spare's scores, each listing the game. Fillers carry other teams of the league at a
 * time far from the game, so the pick sees them and passes them by.
 */
function feedOf(league: string, rows: number, game: Listed | null): { send: (req: HttpRequest) => HttpResponse; sent: HttpRequest[] } {
	const sent: HttpRequest[] = [];
	const teams = TEAMS[league];
	const filler = (n: number) => ({ home: teams[(2 * n + 2) % teams.length].names[0], away: teams[(2 * n + 3) % teams.length].names[0], time: (game?.time ?? MIDDAY) - 30 * DAY });
	/** An id of its own per date and row: a record under one id with two contents reads as inconsistent. */
	const idOf = (date: string, n: number): number => Number(date.replace(/-/g, "")) * 1000 + n + 1;
	const ok = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });
	return {
		sent,
		send(req) {
			sent.push(req);
			const at = locate(req);
			if (at === null) throw new Error("a host outside the table");
			const url = new URL(req.url);
			if (at.seat === 1) {
				const date = url.searchParams.get("dates[]") as string;
				const page = Number(url.searchParams.get("cursor") ?? 0);
				const from = page * ROWS_A_PAGE;
				const to = Math.min(from + ROWS_A_PAGE, rows);
				const data: unknown[] = [];
				for (let n = from; n < to; n++) {
					const g = game !== null && n === 0 && utcDate(game.time) === date ? game : filler(n);
					data.push({ id: idOf(date, n), date: iso(g.time), datetime: iso(g.time), start_time_utc: iso(g.time), status_state: "scheduled", home_team: { full_name: g.home, display_name: g.home }, visitor_team: { full_name: g.away }, away_team: { full_name: g.away, display_name: g.away } });
				}
				return ok({ data, meta: to < rows ? { next_cursor: page + 1 } : {} });
			}
			if (at.seat === 2) {
				const date = url.searchParams.get("date") as string;
				const from = Number(url.searchParams.get("skip") ?? 0);
				const to = Math.min(from + ROWS_A_PAGE, rows);
				const results: unknown[] = [];
				for (let n = from; n < to; n++) {
					const g = game !== null && n === 0 && utcDate(game.time) === date ? game : filler(n);
					results.push({ gameId: idOf(date, n), schedule: { date: iso(g.time) }, teams: { home: { team: g.home }, away: { team: g.away } }, status: "scheduled", scoreboard: {} });
				}
				return ok({ results });
			}
			if (at.seat === 3 && at.path.startsWith("/odds/")) {
				return ok(game === null ? [] : [{ ID: HINT, HomeTeam: game.home, AwayTeam: game.away, MatchTime: iso(game.time).slice(0, 19), Odds: [{ OddType: "Game" }] }]);
			}
			if (at.seat === 3) return ok(game === null ? [] : [{ ID: HINT, OddType: "Game", Final: false, FinalType: "NotFinished", HomeScore: null, AwayScore: null }]);
			return ok(game === null ? [] : [{ id: "x", commence_time: iso(game.time), completed: false, home_team: game.home, away_team: game.away, scores: null }]);
		},
	};
}

const sends = (sent: readonly HttpRequest[], seat: Seat): number => sent.filter((r) => locate(r)?.seat === seat).length;

describe("the worst case is the readers' own", () => {
	test("seats 1 and 2 send one request per filing date per page the league's teams fill, stopped at the program's bound; the table says the same", () => {
		for (const league of Object.keys(LEAGUES)) {
			const teams = TEAMS[league].length;
			for (const [start, dates] of [[MIDDAY, 3], [MIDNIGHT, 2]] as const) {
				const game: Game = { league, home: TEAMS[league][0].names[0], away: TEAMS[league][1].names[0], start, n: DAY, hints: [] };
				expect(filingDates({ from: start, to: start + DAY }).length).toBe(dates);
				const counts: Record<1 | 2, number> = { 1: 0, 2: 0 };
				for (const seat of [1, 2] as const) {
					const feed = feedOf(league, teams, null);
					runSync(seat, readerFor(seat)({ game, now: start + DAY, key: KEY }), feed.send);
					counts[seat] = sends(feed.sent, seat);
					expect({ league, seat, dates, sends: counts[seat] }).toEqual({ league, seat, dates, sends: Math.min(dates * pagesADate(league)[seat], MAX_REQUESTS) });
				}
				expect({ league, dates, scoring: scoringRequests(league, start, DAY) }).toEqual({ league, dates, scoring: counts[1] + counts[2] + 2 });
			}
		}
		// The pages a date fills: one for a league under a hundred teams; college past the bound either way.
		expect([pagesADate("nfl"), pagesADate("nba"), pagesADate("mlb"), pagesADate("nhl"), pagesADate("ncaab"), pagesADate("ncaaf"), pagesADate("cfl")]).toEqual([
			{ 1: 1, 2: 1 },
			{ 1: 1, 2: 1 },
			{ 1: 1, 2: 1 },
			{ 1: 1, 2: 1 },
			{ 1: 4, 2: 4 },
			{ 1: 6, 2: 6 },
			{ 1: 0, 2: 1 },
		]);
		expect([scoringRequests("nba", MIDDAY, DAY), scoringRequests("nba", MIDNIGHT, DAY), scoringRequests("ncaab", MIDDAY, DAY), scoringRequests("ncaaf", MIDDAY, DAY)]).toEqual([8, 6, 26, 26]);
	});

	test("a verification sends the range's four dates and the window's one new date at seats 1 and 2, the board, the result and the spare: 13 for a league of one page, and the table says so", () => {
		// The date at 00:15 UTC and the game listed a day past it, the far end of the range the games set
		// accepts a start in, so the window read again reaches a date the range did not.
		const date = Date.UTC(2026, 9, 23, 0, 15) / 1000;
		const listed: Listed = { home: "Chicago Bears", away: "New England Patriots", time: date + START_BOUND };
		const game: ChainGame = { id: "1", league: "nfl", home: listed.home, away: listed.away, date, hints: [{ seat: 3, id: HINT }], n: DAY, day7: 7 * DAY, status: "unverified", start: null, startReadings: null, dispute: null, payoutRefused: PAYOUT_REFUSED };
		const feed = feedOf("nfl", 1, listed);
		let count = 0;
		const send = memoized((req: HttpRequest) => {
			count++;
			return feed.send(req);
		});
		const out = scoreGameSync(game, KEYS, PAYOUT, date - 2 * DAY, send);
		expect([out.decision.action, out.decision.action === "start" ? out.decision.start : null]).toEqual(["start", listed.time]);
		expect([sends(feed.sent, 1), sends(feed.sent, 2), sends(feed.sent, 3), sends(feed.sent, 4), count]).toEqual([5, 5, 2, 1, 13]);
		expect(verifyingRequests("nfl", date, DAY)).toBe(13);
		// A date at midnight: the window read again reaches no new date, and the table's bound still holds.
		const midnight = Date.UTC(2026, 9, 23) / 1000;
		expect(verifyingRequests("nfl", midnight, DAY)).toBe(11);
	});

	test("college at verification: both readers are cut on the range read, the run waits, and the table's 27 covers what was sent", () => {
		const date = Date.UTC(2026, 9, 23, 0, 15) / 1000;
		const listed: Listed = { home: TEAMS.ncaab[0].names[0], away: TEAMS.ncaab[1].names[0], time: date + START_BOUND };
		const game: ChainGame = { id: "1", league: "ncaab", home: listed.home, away: listed.away, date, hints: [{ seat: 3, id: HINT }], n: DAY, day7: 7 * DAY, status: "unverified", start: null, startReadings: null, dispute: null, payoutRefused: PAYOUT_REFUSED };
		const feed = feedOf("ncaab", TEAMS.ncaab.length, listed);
		let count = 0;
		const out = scoreGameSync(game, KEYS, PAYOUT, date - 2 * DAY, memoized((req) => {
			count++;
			return feed.send(req);
		}));
		expect([out.decision.action, out.decision.why]).toEqual(["wait", "seat 1 is silent: request bound"]);
		// Twelve at each of seats 1 and 2, the board, the spare; the 27th is seat 3's result, read when the board no longer lists the hint.
		expect([sends(feed.sent, 1), sends(feed.sent, 2), sends(feed.sent, 3), sends(feed.sent, 4), count]).toEqual([12, 12, 1, 1, 26]);
		expect([verifyingRequests("ncaab", date, DAY), verifyingRequests("ncaaf", date, DAY)]).toEqual([27, 27]);
	});
});
