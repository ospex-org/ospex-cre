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
// Status decides nothing; the body does: a failed request (a status outside 2xx) is that clean silence
// unless its body is the feed's list, read by the one reading a 2xx list gets (its rows, then the pick):
// a row that would not parse, or any row for the game, makes it an answer the reader could not use (the
// game's row in a 503); an error object, a page or an empty body on any status is a failure
// (readers/request.ts, failed).

import { pick, points, refused, type FeedRecord, type FeedTeam, type Listing } from "../pick";
import { clean, silent } from "../run";
import { leagueRow } from "../table";
import { asksOf } from "../teams";
import type { Ask, Reading, ReaderRun, Seat } from "../types";
import { filingDates, parseIsoSeconds, windowOf } from "../window";
import { failed, jsonOf, obj, request, str } from "./request";

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
		// The rows of one page as the feed's records, every row that parses read first, or the refusal of
		// the whole answer for a row that would not parse, the game's own row's word beside it (pick.ts,
		// refused).
		const rowsOf = (results: readonly unknown[]): FeedRecord[] | Reading => {
			const rows: FeedRecord[] = [];
			let unreadable = false;
			for (const g of results) {
				const o = obj(g);
				const r = o === null ? null : toRecord(ask.game.league, o);
				if (r === null) unreadable = true;
				else rows.push(r);
			}
			return unreadable ? silent(SEAT, refused(ask.game, [...listings.flat(), ...listing, ...rows])) : rows;
		};
		// A failed answer's body, when it is the feed's list, read by the one path a 2xx list takes
		// (request.ts, failed): its rows, then the pick; null when it is not the list.
		const inList = (json: unknown): Reading | null => {
			const results = obj(json)?.results;
			if (!Array.isArray(results)) return null;
			const rows = rowsOf(results);
			return Array.isArray(rows) ? pick(SEAT, ask.game, [rows], ask.near) : rows;
		};
		for (let skip = 0; ; skip += PAGE) {
			const q = `?league=${encodeURIComponent(row[SEAT])}&team=${encodeURIComponent(team)}&date=${date}${skip === 0 ? "" : `&skip=${skip}`}`;
			const res = yield request(SEAT, `/games${q}`, ask.key);
			const body = jsonOf(res);
			// Status decides nothing; the body does (request.ts, failed): a failed request is clean silence
			// before any row arrived at this seat, unless its body is the feed's list, read as a 2xx list is
			// (inList); a 2xx body that is not the feed's list, or any failure after rows arrived: an answer
			// the reader could not use, and the void holds it (types.ts, answer).
			const none = listings.every((l) => l.length === 0) && listing.length === 0;
			if (!body.ok) return failed(SEAT, body, inList, !none);
			const results = obj(body.value)?.results;
			if (!Array.isArray(results)) return silent(SEAT, "unreadable");
			const rows = rowsOf(results);
			if (!Array.isArray(rows)) return rows;
			listing.push(...rows);
			if (results.length < PAGE) break;
		}
		listings.push(listing);
	}
	return pick(SEAT, ask.game, listings, ask.near);
}
