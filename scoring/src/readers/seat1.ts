// Seat 1's reader.
//
// Asks for the game's two teams' games, by the feed's own ids for the teams (the team lists carry
// them), on every filing date the window touches (see filingDates), in one request of a hundred to a
// page, following the feed's cursor. Never the day's slate: a slate page of college games is past the
// size a run's answer may be, and one game's read costs one request whatever the league. Each league
// names its fields its own way, so each has a small map below. A team is named by its full name, and in college by its school's name too; never by its
// city, which two teams can share.
//
// Status: the nine-state `status_state` decides where a record has it: `final` is final; `postponed`
// and `canceled` are the feed's own words that the game will not or did not play, and a void may rest
// on them (rule.ts); `scheduled`, `in_progress`, `delayed`, `suspended` and `abandoned` are not final,
// an answer that is never a void's vote; `unknown`, or no word at all, is no status, a partial row that
// reads silent; any other word is one the reader does not recognize, silent too, the word verbatim on
// the reading, and the void holds both (src/pick.ts). Where a record lacks `status_state`, the reader
// falls back to the league's older field: only that field's own unambiguous final, postponed and
// cancelled words count (see `older`), none is no status, and any other word is unrecognized.
// College's older field says "post" for a final, a postponed and a cancelled game alike, so a college
// record without `status_state` is never final.
//
// A final also needs the feed's own count of the game's parts to show a whole game: the period
// reached, at least the league's regulation (four quarters, four in basketball, three in hockey,
// nine innings, two halves in college basketball). Football carries no period count it fills in
// (college football's stays 0 on a final), so there the four quarters' points must all be there.
// A record that says final short of that reads silent: it is neither a final the reader can take
// nor a game the feed says is unfinished. Its detail says why.
//
// A conference id missing or null on a college team says nothing about the team: the record binds
// by its names and time (src/pick.ts).
//
// A request that fails, or an empty body, before any row arrived is clean silence; after rows arrived
// it is partway through the seat's reads, and the void holds it, as it holds a body that is not the
// feed's list of rows and a row the reader can't parse, which refuses the whole answer with the game's
// own row's word beside it (types.ts, answer; src/pick.ts, refused). Status decides nothing; the body
// does: a failed request (a status outside 2xx) is that clean silence unless its body is the feed's
// list, read by the one reading a 2xx list gets (its rows, then the pick): a row that would not parse,
// or any row for the game, makes it an answer the reader could not use (the game's row in a 503); an
// error object, a page or an empty body on any status is a failure (readers/request.ts, failed).

import { pick, points, refused, type FeedRecord, type FeedTeam } from "../pick";
import { clean, silent } from "../run";
import { leagueRow } from "../table";
import { asksOf } from "../teams";
import type { Ask, Reading, ReaderRun, Seat } from "../types";
import { filingDates, parseIsoSeconds, windowOf } from "../window";
import { failed, jsonOf, obj, request, str } from "./request";

const SEAT: Seat = 1;

interface Fields {
	readonly time: (g: Record<string, unknown>) => unknown;
	readonly home: (g: Record<string, unknown>) => FeedTeam;
	readonly away: (g: Record<string, unknown>) => FeedTeam;
	readonly older: (g: Record<string, unknown>) => FeedRecord["state"] | null;
	/** Why the record is short of a whole game, or null when it shows one. */
	readonly short: (g: Record<string, unknown>) => string | null;
}

function team(t: unknown, nameKeys: readonly string[], pts: unknown): FeedTeam {
	const o = obj(t) ?? {};
	const names: string[] = [];
	for (const k of nameKeys) {
		const s = str(o[k]);
		if (s !== null) names.push(s);
	}
	return { names, points: points(pts) };
}

/** Short of `least` periods by the record's own `period`, or null when it reached them. */
const periods = (least: number) => (g: Record<string, unknown>): string | null => {
	const p = g.period;
	if (typeof p !== "number" || !Number.isInteger(p)) return "no period count";
	return p >= least ? null : `period ${p} of ${least}`;
};

/** Short unless every one of the named quarter fields carries points. */
const quarters = (keys: readonly string[]) => (g: Record<string, unknown>): string | null =>
	keys.every((k) => points(g[k]) !== null) ? null : "not every quarter scored";

/** The older field's final word in football and basketball, with any overtimes it names. */
const FINAL_WORD = /^Final(\/\d*OT)?$/;

const FIELDS: Readonly<Record<string, Fields>> = {
	nba: {
		time: (g) => g.datetime,
		home: (g) => team(g.home_team, ["full_name"], g.home_team_score),
		away: (g) => team(g.visitor_team, ["full_name"], g.visitor_team_score),
		// The feed writes its postponed flag as a boolean, and has written it as the word: either is postponed.
		older: (g) => (g.postponed === true || g.postponed === "true" || g.postponed === "True" ? "postponed" : typeof g.status === "string" && FINAL_WORD.test(g.status) ? "final" : null),
		short: periods(4),
	},
	nfl: {
		time: (g) => g.date,
		home: (g) => team(g.home_team, ["full_name"], g.home_team_score),
		away: (g) => team(g.visitor_team, ["full_name"], g.visitor_team_score),
		older: (g) => (typeof g.status === "string" && FINAL_WORD.test(g.status) ? "final" : null),
		short: quarters(["home_team_q1", "home_team_q2", "home_team_q3", "home_team_q4", "visitor_team_q1", "visitor_team_q2", "visitor_team_q3", "visitor_team_q4"]),
	},
	mlb: {
		time: (g) => g.date,
		home: (g) => team(g.home_team, ["display_name"], obj(g.home_team_data)?.runs),
		away: (g) => team(g.away_team, ["display_name"], obj(g.away_team_data)?.runs),
		older: (g) =>
			g.status === "STATUS_FINAL"
				? "final"
				: g.status === "STATUS_POSTPONED"
					? "postponed"
					: g.status === "STATUS_CANCELED"
						? "canceled"
						: null,
		short: periods(9),
	},
	nhl: {
		time: (g) => g.start_time_utc,
		home: (g) => team(g.home_team, ["full_name"], g.home_score),
		away: (g) => team(g.away_team, ["full_name"], g.away_score),
		older: (g) => (g.game_state === "OFF" ? "final" : null),
		short: periods(3),
	},
	ncaaf: {
		time: (g) => g.date,
		home: (g) => team(g.home_team, ["full_name", "college"], g.home_score),
		away: (g) => team(g.visitor_team, ["full_name", "college"], g.away_score),
		older: () => null,
		short: quarters(["home_score_q1", "home_score_q2", "home_score_q3", "home_score_q4", "away_score_q1", "away_score_q2", "away_score_q3", "away_score_q4"]),
	},
	ncaab: {
		time: (g) => g.date,
		home: (g) => team(g.home_team, ["full_name", "college"], g.home_score),
		away: (g) => team(g.visitor_team, ["full_name", "college"], g.away_score),
		older: () => null,
		short: periods(2),
	},
};

const STATE: Readonly<Record<string, FeedRecord["state"]>> = {
	final: "final",
	postponed: "postponed",
	canceled: "canceled",
	scheduled: "not_final",
	in_progress: "not_final",
	delayed: "not_final",
	suspended: "not_final",
	abandoned: "not_final",
	unknown: "no_status",
};

export function toRecord(league: string, g: Record<string, unknown>): FeedRecord | null {
	const f = Object.prototype.hasOwnProperty.call(FIELDS, league) ? FIELDS[league] : undefined;
	if (!f || (typeof g.id !== "number" && typeof g.id !== "string")) return null;
	const raw = g.status_state;
	let state: FeedRecord["state"];
	let status: string;
	if (typeof raw === "string") {
		// The nine states; no word is no status; a word they don't name is unrecognized, kept verbatim.
		state = Object.prototype.hasOwnProperty.call(STATE, raw) ? STATE[raw] : raw.trim() === "" ? "no_status" : "unrecognized";
		status = raw;
	} else {
		const word = String(g.status ?? g.game_state ?? "");
		state = f.older(g) ?? (word.trim() === "" ? "no_status" : "unrecognized");
		status = state === "unrecognized" ? word : `no status_state; ${word.trim()}`.trim();
	}
	if (state === "final") {
		const short = f.short(g);
		if (short !== null) {
			state = "short";
			status = `${status}; ${short}`;
		}
	}
	return {
		id: String(g.id),
		time: parseIsoSeconds(f.time(g)),
		teams: [f.home(g), f.away(g)],
		state,
		status,
	};
}

export function* read(ask: Ask): ReaderRun {
	const row = leagueRow(ask.game.league);
	if (row === null || !Object.prototype.hasOwnProperty.call(FIELDS, ask.game.league)) return clean(SEAT, "league not offered");
	const asks = asksOf(ask.game.league, ask.game.home, ask.game.away);
	if (asks === null) return clean(SEAT, "game teams unknown");
	// One request for the game: the two teams' games (team_ids[], the feed's own ids for them) on every
	// filing date the window touches (dates[]), a hundred to a page, following the feed's cursor should
	// the teams' games on those dates ever run past one.
	const dates = filingDates(windowOf(ask.game)).map((d) => `dates[]=${d}`);
	const teams = asks.map((a) => `team_ids[]=${a[1]}`);
	const listing: FeedRecord[] = [];
	// The rows of one page as the feed's records, every row that parses read first, or the refusal of the
	// whole answer for a row that would not parse, the game's own row's word beside it (pick.ts, refused).
	const rowsOf = (data: readonly unknown[]): FeedRecord[] | Reading => {
		const rows: FeedRecord[] = [];
		let unreadable = false;
		for (const g of data) {
			const o = obj(g);
			const r = o === null ? null : toRecord(ask.game.league, o);
			if (r === null) unreadable = true;
			else rows.push(r);
		}
		return unreadable ? silent(SEAT, refused(ask.game, [...listing, ...rows])) : rows;
	};
	// A failed answer's body, when it is the feed's list, read by the one path a 2xx list takes
	// (request.ts, failed): its rows, then the pick; null when it is not the list.
	const inList = (json: unknown): Reading | null => {
		const data = obj(json)?.data;
		if (!Array.isArray(data)) return null;
		const rows = rowsOf(data);
		return Array.isArray(rows) ? pick(SEAT, ask.game, [rows], ask.near) : rows;
	};
	let cursor: string | null = null;
	do {
		const q = `?${[...dates, ...teams].join("&")}&per_page=100${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
		const res = yield request(SEAT, `${row[SEAT]}${q}`, ask.key);
		const body = jsonOf(res);
		// Status decides nothing; the body does (request.ts, failed): a failed request is clean silence
		// before any row arrived at this seat, unless its body is the feed's list, read as a 2xx list is
		// (inList); a 2xx body that is not the feed's list, or any failure after rows arrived: an answer
		// the reader could not use, and the void holds it (types.ts, answer).
		if (!body.ok) return failed(SEAT, body, inList, listing.length > 0);
		const page = obj(body.value);
		const data = page?.data;
		if (!Array.isArray(data)) return silent(SEAT, "unreadable");
		const rows = rowsOf(data);
		if (!Array.isArray(rows)) return rows;
		listing.push(...rows);
		const next = obj(page?.meta)?.next_cursor;
		cursor = typeof next === "number" || (typeof next === "string" && next !== "") ? String(next) : null;
	} while (cursor !== null);
	return pick(SEAT, ask.game, [listing], ask.near);
}
