// Synthetic answers for the line's tests (test/line.test.ts, ../games/line.test.ts): one game per league,
// as the chain holds it once verified, and the game's row at each seat in that feed's own wire fields,
// every field the readers read filled in, so a test can plant a word in one field and read what the
// run's line makes of it. No saved answer, no network.

import type { ChainGame } from "../src/chain";
import { TEAMS } from "../src/teams/index";
import type { HttpResponse, Seat } from "../src/types";
import { PAYOUT_REFUSED } from "./rule-helpers";

/** The game's start, its window and the clock the hour-24 tests read at, past the window. */
export const START = Date.UTC(2026, 9, 22, 23) / 1000;
export const DAY = 86_400;
export const AFTER_N = START + DAY + 600;
/** The game's own ids at seat 3 and at the spare, which its creation hints name. */
export const ID3 = "aa000001-0000-4000-8000-000000000001";
export const ID4 = "0123456789abcdef0123456789abcdef";

/** Every status a seat's own answer comes back under in these tests: two inside 2xx, two outside. */
export const STATUSES = [200, 201, 500, 503] as const;

/** Who answers: a seat, or the spare in either of its roles. */
export type Role = "seat 1" | "seat 2" | "seat 3" | "the spare, counting" | "the spare, not counting";
export const ROLES: readonly Role[] = ["seat 1", "seat 2", "seat 3", "the spare, counting", "the spare, not counting"];
export const seatOf = (role: Role): Seat => (role === "seat 1" ? 1 : role === "seat 2" ? 2 : role === "seat 3" ? 3 : 4);

/** The field each seat's row writes its status in. */
export const STATUS_FIELD: Readonly<Record<Seat, string>> = { 1: "status_state", 2: "status", 3: "FinalType", 4: "completed" };

const iso = (t: number): string => new Date(t * 1000).toISOString();

/**
 * The game for a role, verified: seat 3 and the spare named by their ids. For the spare counting, seat 3
 * has no id and was silent at the start, so the spare stands in for it.
 */
export function gameFor(league: string, role: Role = "seat 1"): ChainGame {
	const [home, away] = TEAMS[league].filter((t) => t.ask[2] !== null);
	const down = role === "the spare, counting";
	return {
		id: "1",
		league,
		home: home.names[0],
		away: away.names[0],
		date: START,
		hints: [...(down ? [] : [{ seat: 3, id: ID3 }]), { seat: 4, id: ID4 }],
		n: DAY,
		day7: 7 * DAY,
		status: "verified",
		start: START,
		startReadings: ([1, 2, 3, 4] as const).map((seat) => ({ seat, kind: seat === 3 && down ? 0 : 1, homeScore: 0, awayScore: 0 })),
		dispute: null,
		payoutRefused: PAYOUT_REFUSED,
	} as ChainGame;
}

/** What the game's row says. */
export type State = "final" | "postponed" | "canceled" | "in play" | "scheduled";

/** The game's row at a seat, in the feed's own fields: a final of 17-24, or a game that has not ended. */
export function rowOf(g: ChainGame, seat: Seat, state: State): Record<string, any> {
	const final = state === "final";
	const t = iso(g.start ?? g.date);
	if (seat === 1) {
		const team = (name: string) => ({ full_name: name, display_name: name, college: name, conference_id: 1 });
		const word = final ? "final" : state === "in play" ? "in_progress" : state;
		const quarters = { home_score_q1: 1, home_score_q2: 2, home_score_q3: 3, home_score_q4: 11, away_score_q1: 1, away_score_q2: 2, away_score_q3: 3, away_score_q4: 18 };
		const nfl = { home_team_q1: 1, home_team_q2: 2, home_team_q3: 3, home_team_q4: 11, visitor_team_q1: 1, visitor_team_q2: 2, visitor_team_q3: 3, visitor_team_q4: 18 };
		return {
			id: "row-1",
			date: t,
			datetime: t,
			start_time_utc: t,
			status_state: word,
			period: 9,
			home_team: team(g.home),
			visitor_team: team(g.away),
			away_team: team(g.away),
			home_score: 17,
			away_score: 24,
			home_team_score: 17,
			visitor_team_score: 24,
			home_team_data: { runs: 17 },
			away_team_data: { runs: 24 },
			...quarters,
			...nfl,
		};
	}
	if (seat === 2) {
		const word = final ? "final" : state === "in play" ? "in progress" : state;
		return {
			gameId: "row-2",
			schedule: { date: t },
			teams: { home: { team: g.home, conference: "one" }, away: { team: g.away, conference: "one" } },
			status: word,
			scoreboard: { currentPeriod: 9, score: { home: 17, away: 24 } },
		};
	}
	if (seat === 3) {
		const word = final ? "Finished" : state === "postponed" ? "Postponed" : state === "canceled" ? "Canceled" : "NotFinished";
		return { ID: ID3, OddType: "Game", Final: final, FinalType: word, HomeScore: final ? 17 : null, AwayScore: final ? 24 : null };
	}
	// The spare has no word that the game will not play: a game that has not ended is `completed` false.
	return {
		id: ID4,
		commence_time: t,
		home_team: g.home,
		away_team: g.away,
		completed: final,
		scores: final ? [{ name: g.home, score: "17" }, { name: g.away, score: "24" }] : null,
	};
}

/** A seat's whole answer around its rows, in the feed's own envelope. */
export function answerOf(seat: Seat, rows: readonly unknown[]): unknown {
	return seat === 1 ? { data: rows, meta: {} } : seat === 2 ? { results: rows } : rows;
}

/** Seat 3's odds board for the game, which verification reads (a POST). */
export function boardOf(g: ChainGame): unknown {
	return [{ ID: ID3, HomeTeam: g.home, AwayTeam: g.away, MatchTime: iso(g.start ?? g.date), Odds: [{ OddType: "Game" }] }];
}

/** An answer as the transport hands it back. */
export function json(body: unknown, status = 200): HttpResponse {
	return { status, body: JSON.stringify(body) };
}
