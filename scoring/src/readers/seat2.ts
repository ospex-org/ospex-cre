// Seat 2's reader.
//
// Asks for the league's games one filing date at a time (the feed files a game under its US
// Eastern date), a hundred to a page, stepping `skip` while a page comes back full. Status:
// `final` is final, `canceled` and `postponed` are recorded, everything else is not final. A
// final also needs the feed's own period count to have reached the league's regulation (four
// quarters, three periods, nine innings, two halves in college basketball): a record that says
// final short of it is read as not final. A game whose start the feed marks "to be announced"
// carries a placeholder time, so it has no game time the window can hold it to.

import { pick, points, type FeedRecord, type FeedTeam, type Listing } from "../pick";
import { silent } from "../run";
import { leagueRow } from "../table";
import type { Ask, ReaderRun, Seat } from "../types";
import { filingDates, parseIsoSeconds, windowOf } from "../window";
import { jsonOf, obj, request, str } from "./request";

const SEAT: Seat = 2;
const PAGE = 100;

/** The periods a whole game reaches, by league: overtime only adds to them. */
const REGULATION: Readonly<Record<string, number>> = { nfl: 4, nba: 4, nhl: 3, mlb: 9, ncaaf: 4, ncaab: 2 };

function team(t: unknown, pts: unknown): FeedTeam {
	const name = str(obj(t)?.team);
	return { names: name === null ? [] : [name], points: points(pts) };
}

export function toRecord(league: string, g: Record<string, unknown>): FeedRecord | null {
	if (typeof g.gameId !== "number" && typeof g.gameId !== "string") return null;
	const schedule = obj(g.schedule);
	const teams = obj(g.teams);
	const board = obj(g.scoreboard);
	const score = obj(board?.score);
	let status = typeof g.status === "string" ? g.status : "";
	let state: FeedRecord["state"] =
		status === "final" ? "final" : status === "canceled" ? "canceled" : status === "postponed" ? "postponed" : "not_final";
	if (state === "final") {
		const least = Object.prototype.hasOwnProperty.call(REGULATION, league) ? REGULATION[league] : null;
		const p = board?.currentPeriod;
		const short =
			least === null ? "league unknown" : typeof p !== "number" || !Number.isInteger(p) ? "no period count" : p < least ? `period ${p} of ${least}` : null;
		if (short !== null) {
			state = "not_final";
			status = `${status}; ${short}`;
		}
	}
	return {
		id: String(g.gameId),
		time: schedule?.tbaTime === true ? null : parseIsoSeconds(schedule?.date),
		teams: [team(teams?.home, score?.home), team(teams?.away, score?.away)],
		state,
		status,
	};
}

export function* read(ask: Ask): ReaderRun {
	const row = leagueRow(ask.game.league);
	if (row === null) return silent(SEAT, "league not offered");
	const listings: Listing[] = [];
	for (const date of filingDates(windowOf(ask.game))) {
		const listing: FeedRecord[] = [];
		for (let skip = 0; ; skip += PAGE) {
			const q = `?league=${encodeURIComponent(row[SEAT])}&date=${date}${skip === 0 ? "" : `&skip=${skip}`}`;
			const res = yield request(SEAT, `/games${q}`, ask.key);
			const body = jsonOf(res);
			if (!body.ok) return silent(SEAT, body.detail);
			const results = obj(body.value)?.results;
			if (!Array.isArray(results)) return silent(SEAT, "unreadable");
			for (const g of results) {
				const o = obj(g);
				const r = o === null ? null : toRecord(ask.game.league, o);
				if (r === null) return silent(SEAT, "unreadable record");
				listing.push(r);
			}
			if (results.length < PAGE) break;
		}
		listings.push(listing);
	}
	return pick(SEAT, ask.game, listings);
}
