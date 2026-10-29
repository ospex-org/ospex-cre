// Seat 2's reader.
//
// Asks for each of the game's two teams' games, by the feed's own spelling of the team (the team
// lists carry it), over the filing dates the window touches as one range (the feed files a game under its US Eastern date
// and takes two dates as a range), a hundred to a page, stepping `skip` while a page comes back full.
// Never the day's slate: a slate page of college games is past the size a run's answer may be, and
// one game's read costs one request whatever the league. Status, in the feed's own words: `final`
// is final; `canceled` and `postponed` say the game will not or did not play, and a void may rest on
// them (rule.ts); `scheduled`, `in progress`, `delayed` and `suspended` are not final, an answer that
// is never a void's vote; no word is no status, a partial row that reads silent; any other word is one
// the reader does not recognize, silent too, the word verbatim on the reading, and the void holds
// both (src/pick.ts). A final also needs the
// feed's own period count to have reached the
// league's regulation (four quarters, three periods, nine innings, two halves in college basketball):
// a record that says final short of it reads silent. A conference missing or null on a college team
// says nothing about the team: the record binds by its names and time (src/pick.ts). A game whose
// start the feed marks "to be announced" carries a placeholder time, so it has no game time the
// window can hold it to. A request that fails, or an empty body, before any row arrived is clean
// silence; after rows arrived it is partway through the seat's reads, and the void holds it, as it
// holds a body that is not the feed's list of rows and a row the reader can't parse, which refuses the
// whole answer with the game's own row's word beside it (types.ts, answer; src/pick.ts, refused).

import { pick, points, refused, type FeedRecord, type FeedTeam, type Listing } from "../pick";
import { clean, silent } from "../run";
import { leagueRow } from "../table";
import { asksOf } from "../teams";
import type { Ask, ReaderRun, Seat } from "../types";
import { filingDates, parseIsoSeconds, windowOf } from "../window";
import { jsonOf, obj, request, str } from "./request";

const SEAT: Seat = 2;
const PAGE = 100;

/** The periods a whole game reaches, by league: overtime only adds to them. */
const REGULATION: Readonly<Record<string, number>> = { nfl: 4, nba: 4, nhl: 3, mlb: 9, ncaaf: 4, ncaab: 2 };

/** The feed's words for a game short of a final: an answer, never a void's vote. Any other word is unrecognized. */
const NOT_FINAL: ReadonlySet<string> = new Set(["scheduled", "in progress", "delayed", "suspended"]);

function team(t: unknown, pts: unknown): FeedTeam {
	const o = obj(t);
	const name = str(o?.team);
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
		status === "final"
			? "final"
			: status === "canceled"
				? "canceled"
				: status === "postponed"
					? "postponed"
					: NOT_FINAL.has(status)
						? "not_final"
						: status.trim() === ""
							? "no_status"
							: "unrecognized";
	if (state === "final") {
		const least = Object.prototype.hasOwnProperty.call(REGULATION, league) ? REGULATION[league] : null;
		const p = board?.currentPeriod;
		const short =
			least === null ? "league unknown" : typeof p !== "number" || !Number.isInteger(p) ? "no period count" : p < least ? `period ${p} of ${least}` : null;
		if (short !== null) {
			state = "short";
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
	if (row === null) return clean(SEAT, "league not offered");
	const asks = asksOf(ask.game.league, ask.game.home, ask.game.away);
	if (asks === null) return clean(SEAT, "game teams unknown");
	// One request per team of the game: its games (team=, the feed's own spelling of it) over the filing
	// dates the window touches as one range (date=first,last: the feed takes one or two dates, Eastern),
	// a hundred to a page, stepping skip should a team's games on those dates ever fill one. Both
	// teams are asked for, so a spelling the feed no longer uses for one of them still leaves the
	// other's answer carrying the game, respelt, which the pick reads as a name it can't resolve and
	// never as the game's absence; an answer that comes back empty is silence, never absence (pick.ts).
	// A team the seat's list lacks is not asked for; neither on it, and the seat is silent without asking.
	const names = [...new Set(asks.map((a) => a[2]).filter((n): n is string => n !== null))];
	if (names.length === 0) return clean(SEAT, "neither team on the seat's list");
	const dates = filingDates(windowOf(ask.game));
	const date = dates.length === 1 ? dates[0] : `${dates[0]},${dates[dates.length - 1]}`;
	const listings: Listing[] = [];
	for (const team of names) {
		const listing: FeedRecord[] = [];
		for (let skip = 0; ; skip += PAGE) {
			const q = `?league=${encodeURIComponent(row[SEAT])}&team=${encodeURIComponent(team)}&date=${date}${skip === 0 ? "" : `&skip=${skip}`}`;
			const res = yield request(SEAT, `/games${q}`, ask.key);
			const body = jsonOf(res);
			// A request that failed, or an empty body, before any row arrived at this seat: clean silence. A
			// body that is not the feed's list of rows, or a failure after rows arrived: an answer the reader
			// could not use, and the void holds it (types.ts, answer).
			const none = listings.every((l) => l.length === 0) && listing.length === 0;
			if (!body.ok) return !body.arrived && none ? clean(SEAT, body.detail) : silent(SEAT, body.detail);
			const results = obj(body.value)?.results;
			if (!Array.isArray(results)) return silent(SEAT, "unreadable");
			// Every row that parses is read before a row that doesn't refuses the whole answer, so the
			// refusal carries the game's own row's word (pick.ts, refused).
			let unreadable = false;
			for (const g of results) {
				const o = obj(g);
				const r = o === null ? null : toRecord(ask.game.league, o);
				if (r === null) unreadable = true;
				else listing.push(r);
			}
			if (unreadable) return silent(SEAT, refused(ask.game, [...listings.flat(), ...listing]));
			if (results.length < PAGE) break;
		}
		listings.push(listing);
	}
	return pick(SEAT, ask.game, listings, ask.near);
}
