// The worst case is the readers' own: one game, one request per seat. Each reader asks for the one game
// (seat 1 for the two teams' games on the window's dates by its own ids for the teams, seat 2 for each
// team's games by its own spelling, seat 3 for its result by hint, the spare for the game by its id or
// its slate), so a full read's count turns on no league: 5 for a scoring run, 9 for a verification
// (lib.ts, requestsFor), derived here by running the real readers and the real program against a feed
// that answers one game at a time, in every league, and against the saved answers.
//
// The assumption behind the numbers, written here as where the claim is made: a team's games on a
// window's filing dates fit one page of a hundred rows. A feed that pages past it is stopped by the
// program's own bound on a reader (twelve), and the tick's count cuts the run first, recorded on its
// line, never silent: the last test.
//
// The viability table: what one game's answer weighs at each seat, per league, from the saved answers
// through the suite's own derivation of a one-game answer from the slate pages (scoring/test/fixtures.ts),
// beside the slate pages themselves, against the platform's size for an answer (25 KB, read here as
// 25,000 bytes). The one-game answers are small in every league saved. The two slates the readers still
// ask for are not: seat 3's board at verification, past the size in college football as saved and in
// college basketball in season by its rows' weight, and the spare's slate for a game created without its
// id, past it in college basketball in season. Those are reported, not worked around.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import { readerFor } from "../scoring/src/index";
import { scoreGameSync } from "../scoring/src/program";
import { MAX_REQUESTS, runSync } from "../scoring/src/run";
import { LEAGUES } from "../scoring/src/table";
import type { Team } from "../scoring/src/teams";
import { TEAMS } from "../scoring/src/teams/index";
import type { HttpRequest, HttpResponse, Seat } from "../scoring/src/types";
import { CASES, LATE, NOW } from "../scoring/test/cases";
import { INDEX, KEY, locate, saved } from "../scoring/test/fixtures";
import { PAYOUT, PAYOUT_REFUSED, chainOf } from "../scoring/test/rule-helpers";
import { EXPECTED_DURATION, SCORING_REQUESTS, VERIFYING_REQUESTS, keysFor, memoized, requestsFor } from "./lib";
import { GAMES, fakeChainOf, recordingWriter } from "./test-helpers";
import { runTick } from "./tick";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const DAY = 86_400;
/** A start at 23:00 UTC: its day's window touches three filing dates. */
const START = Date.UTC(2026, 9, 22, 23, 0) / 1000;
const HINT = "edcfd41f-1773-4bc9-a349-aa50931a0278";
/** The platform's size for one answer, 25 KB, read as 25,000 bytes. */
const ANSWER_BYTES = 25_000;
const SEATS: Seat[] = [1, 2, 3, 4];

const iso = (t: number): string => new Date(t * 1000).toISOString();
const utcDate = (t: number): string => iso(t).slice(0, 10);
const bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Two teams of a league that every seat asked by team can ask for. */
function teamsOf(league: string): [Team, Team] {
	const t = TEAMS[league].filter((x) => x.ask[2] !== null);
	return [t[0], t[1]];
}

/** The game as one feed lists it. */
interface Listed {
	readonly home: Team;
	readonly away: Team;
	readonly time: number;
	readonly final?: { readonly home: number; readonly away: number };
}

/**
 * A feed that answers one game at a time, as the readers ask: seat 1 the two teams' games on the dates
 * asked (the game's record where it is listed on one of them), with `pages` pages behind a cursor for a
 * feed that pages past the assumption; seat 2 the team's games (the record where the team asked is one
 * of the game's and its date is in the range asked); seat 3's board and its result for the hint; the
 * spare's slate. Every request sent is kept.
 */
function feedOf(game: Listed | null, pages = 1): { send: (req: HttpRequest) => HttpResponse; sent: HttpRequest[] } {
	const sent: HttpRequest[] = [];
	const ok = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });
	const record1 = (g: Listed) => ({
		id: 1,
		date: iso(g.time),
		datetime: iso(g.time),
		start_time_utc: iso(g.time),
		status_state: "scheduled",
		home_team: { id: g.home.ask[1], full_name: g.home.names[0], display_name: g.home.names[0], college: g.home.names[0] },
		visitor_team: { id: g.away.ask[1], full_name: g.away.names[0], college: g.away.names[0] },
		away_team: { id: g.away.ask[1], full_name: g.away.names[0], display_name: g.away.names[0] },
	});
	const record2 = (g: Listed) => ({
		gameId: 1,
		schedule: { date: iso(g.time) },
		teams: { home: { team: g.home.ask[2], conference: "a conference" }, away: { team: g.away.ask[2], conference: "a conference" } },
		status: "scheduled",
		scoreboard: {},
	});
	return {
		sent,
		send(req) {
			sent.push(req);
			const at = locate(req);
			if (at === null) throw new Error("a host outside the table");
			const url = new URL(req.url);
			if (at.seat === 1) {
				const dates = url.searchParams.getAll("dates[]");
				const ids = url.searchParams.getAll("team_ids[]");
				const page = Number(url.searchParams.get("cursor") ?? 0);
				const listed = game !== null && page === 0 && dates.includes(utcDate(game.time)) && ids.includes(String(game.home.ask[1])) ? [record1(game)] : [];
				return ok({ data: listed, meta: page + 1 < pages ? { next_cursor: page + 1 } : {} });
			}
			if (at.seat === 2) {
				const team = url.searchParams.get("team");
				const [from, to = from] = (url.searchParams.get("date") ?? "").split(",");
				const d = game === null ? "" : utcDate(game.time);
				const listed = game !== null && (team === game.home.ask[2] || team === game.away.ask[2]) && d >= from && d <= to ? [record2(game)] : [];
				return ok({ status: 200, results: listed });
			}
			if (at.seat === 3 && at.path.startsWith("/odds/")) {
				return ok(game === null ? [] : [{ ID: HINT, HomeTeam: game.home.names[0], AwayTeam: game.away.names[0], MatchTime: iso(game.time).slice(0, 19), Odds: [{ OddType: "Game" }] }]);
			}
			if (at.seat === 3) {
				const final = game?.final;
				return ok(game === null ? [] : [{ ID: HINT, OddType: "Game", Final: final !== undefined, FinalType: final === undefined ? "NotFinished" : "Finished", HomeScore: final?.home ?? null, AwayScore: final?.away ?? null }]);
			}
			const final = game?.final;
			return ok(
				game === null
					? []
					: [{ id: "0123456789abcdef0123456789abcdef", commence_time: iso(game.time), completed: final !== undefined, home_team: game.home.names[0], away_team: game.away.names[0], scores: final === undefined ? null : [{ name: game.home.names[0], score: String(final.home) }, { name: game.away.names[0], score: String(final.away) }] }],
			);
		},
	};
}

const sends = (sent: readonly HttpRequest[]): number[] => SEATS.map((seat) => sent.filter((r) => locate(r)?.seat === seat).length);

function chainGameOf(league: string, listed: Listed, over: Partial<ChainGame>): ChainGame {
	return {
		id: "1",
		league,
		home: listed.home.names[0],
		away: listed.away.names[0],
		date: listed.time,
		hints: [{ seat: 3, id: HINT }],
		n: DAY,
		day7: 7 * DAY,
		status: "verified",
		start: listed.time,
		startReadings: [
			{ seat: 1, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 2, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 3, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 4, kind: 1, homeScore: 0, awayScore: 0 },
		],
		dispute: null,
		payoutRefused: PAYOUT_REFUSED,
		...over,
	};
}

describe("the worst case is the readers' own: one game, one request per seat", () => {
	test("every league: a scoring run sends one at seat 1, one per team at seat 2, one at seat 3 and one at the spare, 5; the table says the same", () => {
		for (const league of Object.keys(LEAGUES)) {
			const [home, away] = teamsOf(league);
			const listed: Listed = { home, away, time: START };
			const feed = feedOf(listed);
			const out = scoreGameSync(chainGameOf(league, listed, {}), KEYS, PAYOUT, START + 3 * 3_600, memoized(feed.send));
			// Every seat is read before the run decides, so the sends are the full read's whatever it decides.
			expect({ league, action: out.decision.action, sends: sends(feed.sent), total: feed.sent.length }).toEqual({ league, action: "wait", sends: [1, 2, 1, 1], total: SCORING_REQUESTS });
			// Each reader alone: seat 1's one request carries the window's dates and both teams' ids; seat 2's two carry each team's spelling and the dates as a range.
			for (const seat of [1, 2] as const) {
				const alone = feedOf(listed);
				runSync(seat, readerFor(seat)({ game: { league, home: home.names[0], away: away.names[0], start: START, n: DAY, hints: [] }, now: START + DAY, key: KEY }), alone.send);
				const paths = alone.sent.map((r) => locate(r)?.path ?? "");
				if (seat === 1) expect({ league, paths }).toEqual({ league, paths: [`${LEAGUES[league][1]}?dates[]=2026-10-21&dates[]=2026-10-22&dates[]=2026-10-23&team_ids[]=${home.ask[1]}&team_ids[]=${away.ask[1]}&per_page=100`] });
				else expect({ league, paths }).toEqual({ league, paths: [home, away].map((t) => `/games?league=${encodeURIComponent(LEAGUES[league][2])}&team=${encodeURIComponent(t.ask[2] as string)}&date=2026-10-21,2026-10-23`) });
			}
		}
		expect([requestsFor("scoring"), requestsFor("day 7")]).toEqual([5, 0]);
	});

	test("every league: a verification sends the range at seats 1, 2 and the spare, the board, then the window again at seats 1 and 2 and seat 3's result, 9; the table says the same", () => {
		for (const league of Object.keys(LEAGUES)) {
			const [home, away] = teamsOf(league);
			const listed: Listed = { home, away, time: START };
			const feed = feedOf(listed);
			const game = chainGameOf(league, listed, { status: "unverified", start: null, startReadings: null });
			const out = scoreGameSync(game, KEYS, PAYOUT, START - 2 * DAY, memoized(feed.send));
			expect({ league, action: out.decision.action, start: out.decision.action === "start" ? out.decision.start : null, sends: sends(feed.sent), total: feed.sent.length }).toEqual({ league, action: "start", start: START, sends: [2, 4, 2, 1], total: VERIFYING_REQUESTS });
		}
		expect(requestsFor("verification")).toBe(9);
	});

	test("the saved answers: the real program sends 5 on a scoring run and 9 on a verification, none twice", () => {
		const scoring = saved(undefined, LATE);
		let distinct = 0;
		const out = scoreGameSync(chainOf("nba final, read after the game"), KEYS, PAYOUT, LATE, memoized((q) => (distinct++, scoring.send(q))));
		expect([out.decision.action, scoring.misses, sends(scoring.asked), distinct]).toEqual(["score", [], [1, 2, 1, 1], 5]);
		const verifying = saved(undefined, NOW);
		distinct = 0;
		const start = scoreGameSync(chainOf("nfl not final", { status: "unverified", start: null, startReadings: null, dispute: null }), KEYS, PAYOUT, NOW, memoized((q) => (distinct++, verifying.send(q))));
		expect([start.decision.action, verifying.misses, sends(verifying.asked), distinct]).toEqual(["start", [], [2, 4, 2, 1], 9]);
	});

	test("the viability table: what one game's answer weighs at each seat, per league, from the saved answers, against the platform's 25,000 bytes", () => {
		// The largest one-game answer at each seat over every saved case where the seat answered, as the
		// suite derives it from the saved slate pages (seats 1 and 2 by the feed's own filter, seat 3 as
		// saved, the spare its saved slate).
		const measured: Record<string, Partial<Record<Seat, number>>> = {};
		for (const c of CASES) {
			for (const seat of SEATS) {
				const t = saved(undefined, c.now);
				let big = 0;
				let answered = true;
				runSync(seat, readerFor(seat)({ game: c.game, now: c.now, key: KEY }), (q) => {
					const res = t.send(q);
					if (res.status !== 200) answered = false;
					big = Math.max(big, bytes(res.body));
					return res;
				});
				if (!answered || t.asked.length === 0 || t.misses.length > 0) continue;
				measured[c.game.league] ??= {};
				measured[c.game.league][seat] = Math.max(measured[c.game.league][seat] ?? 0, big);
			}
		}
		expect(measured).toEqual({
			nfl: { 1: 875, 2: 1_355, 3: 203, 4: 7_365 },
			nba: { 1: 2_774, 2: 2_531, 3: 205, 4: 14_770 },
			mlb: { 1: 9_687, 2: 3_956, 3: 201, 4: 579 },
			nhl: { 1: 586, 2: 1_343, 3: 201, 4: 9_146 },
			ncaaf: { 1: 673, 2: 1_359, 3: 203, 4: 19_905 },
			ncaab: { 1: 704, 2: 1_419, 4: 3 },
		});
		for (const [league, row] of Object.entries(measured)) for (const seat of SEATS) expect({ league, seat, under: (row[seat] ?? 0) < ANSWER_BYTES }).toEqual({ league, seat, under: true });
		// The slates saved, the largest per league: seat 1's and seat 2's pages, which the readers no longer
		// ask for; seat 3's board, which verification asks for; the spare's, asked for a game without its id.
		const slates: Record<string, Partial<Record<Seat, number>>> = {};
		for (const e of INDEX) {
			if (e.status !== 200) continue;
			const league =
				e.seat === 1 && e.path.includes("/games?") ? (/^\/(nfl|mlb|nhl|ncaaf|ncaab)\//.exec(e.path)?.[1] ?? "nba")
				: e.seat === 2 && e.path.startsWith("/games?league=") ? (/league=(\w+)/.exec(e.path) as RegExpExecArray)[1].toLowerCase()
				: e.seat === 3 && e.path.startsWith("/odds/") ? (/\/odds\/(\w+)/.exec(e.path) as RegExpExecArray)[1].toLowerCase()
				: e.seat === 4 && e.path.includes("/scores/") ? (/_(nfl|nba|mlb|nhl|ncaaf|ncaab)\//.exec(e.path) as RegExpExecArray)[1]
				: null;
			if (league === null) continue;
			slates[league] ??= {};
			slates[league][e.seat] = Math.max(slates[league][e.seat] ?? 0, e.bytes);
		}
		expect(slates).toEqual({
			nfl: { 1: 875, 2: 1_355, 3: 16_087, 4: 7_365 },
			nba: { 1: 11_045, 2: 14_113, 3: 8_091, 4: 14_770 },
			mlb: { 1: 35_050, 2: 21_937, 3: 608, 4: 579 },
			nhl: { 1: 6_606, 2: 15_136, 3: 7_990, 4: 9_146 },
			ncaaf: { 1: 63_343, 2: 47_340, 3: 29_367, 4: 19_905 },
			ncaab: { 1: 64_987, 2: 63_039, 3: 2, 4: 3 },
		});
		// Past the size as saved: seat 1's and seat 2's college pages and seat 1's baseball page, which no
		// read asks for now, and seat 3's college football board, which verification does.
		const over = Object.entries(slates).flatMap(([league, row]) => SEATS.filter((seat) => (row[seat] ?? 0) >= ANSWER_BYTES).map((seat) => `${league} seat ${seat}`));
		expect(over.sort()).toEqual(["mlb seat 1", "ncaab seat 1", "ncaab seat 2", "ncaaf seat 1", "ncaaf seat 2", "ncaaf seat 3"]);
	});

	test("a feed that pages past the assumption: the tick's count cuts the run, nothing is written, and the line says cut", () => {
		// One game, final at seat 3. Seat 1 answers the two teams' games with a cursor behind every page, so
		// its reader pages to the program's bound of twelve: the probe (1), seat 1 (12) and seat 2 (2) are
		// the count's fifteen, and the spare's request is the cut. The control: one page, and the run ends
		// with its decision, nothing cut.
		const [home, away] = teamsOf("nba");
		const listed: Listed = { home, away, time: START, final: { home: 114, away: 106 } };
		const game = chainGameOf("nba", listed, {});
		const now = START + EXPECTED_DURATION.nba + 20 * 60 + 4 * 300 - ((START + EXPECTED_DURATION.nba + 20 * 60) % 3_600) + 3_600;
		const run = (pages: number) => {
			const feed = feedOf(listed, pages);
			const writer = recordingWriter();
			const result = runTick({ evm: fakeChainOf([game], now), games: GAMES, payout: PAYOUT, keys: keysFor({ 1: KEY, 2: KEY, 3: KEY, 4: KEY }), send: feed.send, write: writer.write, period: 300, shard: { index: 0, count: 1 } });
			return { result, feed, writer };
		};
		const cut = run(12);
		expect(cut.result.probes.map((p) => [p.seat, p.final])).toEqual([[3, true]]);
		expect(cut.result.fullRead).toMatchObject({ gameId: "1", why: "final at seat 3", run: null, error: "the run's 15 requests are used", cut: true });
		expect(cut.result.lines).toContain("full read, final at seat 3: game 1 cut: the run's 15 requests are used");
		expect([cut.writer.written.length, cut.result.requests, sends(cut.feed.sent)]).toEqual([0, 15, [MAX_REQUESTS, 2, 1, 0]]);
		const whole = run(1);
		expect([whole.result.fullRead?.cut, whole.result.fullRead?.error, whole.result.requests, sends(whole.feed.sent)]).toEqual([false, null, 5, [1, 2, 1, 1]]);
	});
});
