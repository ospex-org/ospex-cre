// Seat 4's reader: the spare.
//
// Asks for the one game by the feed's own id for it, when the game was created with that hint
// (eventIds); otherwise once per league for live, upcoming and recently completed games, the slate,
// which the feed cannot be asked for by team, and only where the league's slate fits the size an
// answer may be (SLATE_FITS); an unusable id falls back to the slate the same way. The feed gives each
// game's points as a list keyed by team name, not by home or away, so each team takes the one
// entry carrying its own name, compared the way team names are (case, accents, punctuation and
// spacing aside). Status: `completed` true is final, the feed's own word for a whole game; false is
// not final, and never a word that the game will not play, so the spare's row is never a void's
// vote; a row without the flag is a partial row and reads silent; a flag that is neither (the word
// true as a string) is unrecognized, silent too, verbatim on the reading, and the void holds both
// (src/pick.ts). The feed records no postponed or cancelled state. Its game time is
// the scheduled start until the game begins and the actual start after; it serves only this
// seat's own window check, never the game's start. A request that fails, or an empty body, before any
// row arrived is clean silence; after rows arrived it is partway through the seat's reads, and the void
// holds it, as it holds a body that is not the feed's list and a row the reader can't parse, which
// refuses the whole answer with the game's own row's word beside it (types.ts, answer; src/pick.ts,
// refused). Status decides nothing; the body does: a failed request (a status outside 2xx) is that
// clean silence unless its body is the feed's list, read by the one reading a 2xx list gets (its rows,
// then the pick): a row that would not parse, or any row for the game, makes it an answer the reader
// could not use (the game's row in a 503); an error object, a page or an empty body on any status is a
// failure (readers/request.ts, failed). The class is the worst of the seat's reads: an id answer the reader could not use (the
// game's row it could not read, or the game's row under another id, a by-id answer that is not the
// requested record) survives a clean or empty slate; a slate that answers the game stands in its place.
//
// Retention: the feed keeps completed games for three days. The reader stops asking 66 hours after
// the game's start, three days less six hours, a margin that holds whether the feed counts its
// three days from the start, from the end or by calendar day; past it the feed is silent, because a
// missing game then could be age, not absence.

import { pick, points, refused, type FeedRecord, type FeedTeam } from "../pick";
import { clean, silent } from "../run";
import { leagueRow } from "../table";
import { normalise } from "../teams";
import type { Ask, HttpRequest, HttpResponse, Reading, ReaderRun, Seat } from "../types";
import { inWindow, parseIsoSeconds, windowOf } from "../window";
import { failed, jsonOf, obj, request, str } from "./request";

const SEAT: Seat = 4;
const RETENTION = 66 * 3600;

function team(name: string | null, scores: unknown): FeedTeam {
	if (name === null) return { names: [], points: null };
	let found: unknown = null;
	let count = 0;
	if (Array.isArray(scores)) {
		for (const s of scores) {
			const o = obj(s);
			if (o !== null && typeof o.name === "string" && normalise(o.name) === normalise(name)) {
				found = o.score;
				count++;
			}
		}
	}
	return { names: [name], points: count === 1 ? points(found) : null };
}

export function toRecord(e: Record<string, unknown>): FeedRecord | null {
	const id = str(e.id);
	if (id === null) return null;
	const home = str(e.home_team);
	const away = str(e.away_team);
	// The flag as the feed writes it: true or false. Missing is no status; anything else is unrecognized, verbatim.
	const c = e.completed;
	const flagless = c === undefined || c === null;
	return {
		id,
		time: parseIsoSeconds(e.commence_time),
		teams: [team(home, e.scores), team(away, e.scores)],
		state: c === true ? "final" : c === false ? "not_final" : flagless ? "no_status" : "unrecognized",
		status: c === true ? "completed" : c === false ? "not completed" : flagless ? "no completed flag" : String(c),
	};
}

/** The feed's ids are 32 hex characters; nothing else is ever put in a request. */
const ID = /^[0-9a-f]{32}$/i;

/**
 * The leagues whose slate of live, upcoming and recent games fits the platform's size for an answer
 * (25 KB): as saved, 7,365 bytes in football, 14,770 in basketball, 9,146 in hockey and 19,905 in
 * college football, and baseball's by its rows' weight. College basketball's in season does not: a
 * game there is read by its id, which its creator passes, or not at all. Part of the fingerprint.
 */
const SLATE_FITS: ReadonlySet<string> = new Set(["nfl", "nba", "mlb", "nhl", "ncaaf"]);

/** The seat 4 id the game was created with, when it was created with exactly one that is one. */
function hintOf(hints: Ask["game"]["hints"]): string | null {
	const ids = [...new Set(hints.filter((h) => h.seat === SEAT).map((h) => h.id))];
	return ids.length === 1 && ID.test(ids[0]) ? ids[0].toLowerCase() : null;
}

export function* read(ask: Ask): ReaderRun {
	const row = leagueRow(ask.game.league);
	if (row === null) return clean(SEAT, "league not offered");
	// A clock that isn't a number can't say whether the game is still kept.
	if (!Number.isFinite(ask.now) || !Number.isFinite(ask.game.start)) return clean(SEAT, "no clock");
	if (ask.now - ask.game.start > RETENTION) return clean(SEAT, "past retention");
	const slate = `/v4/sports/${encodeURIComponent(row[SEAT])}/scores/?daysFrom=3&dateFormat=iso`;
	// Whether any row has arrived in this run: a failure before one is clean silence, after one it is
	// partway through the seat's reads, and the void holds it (types.ts, answer).
	let arrived = false;
	// The rows of one answer as the feed's records, every row that parses read first, or the refusal of
	// the whole answer for a row that would not parse, the game's own row's word beside it (pick.ts,
	// refused).
	const rowsOf = (items: readonly unknown[]): FeedRecord[] | Reading => {
		const records: FeedRecord[] = [];
		let unreadable = false;
		for (const item of items) {
			const o = obj(item);
			const r = o === null ? null : toRecord(o);
			if (r === null) unreadable = true;
			else records.push(r);
		}
		return unreadable ? silent(SEAT, refused(ask.game, records)) : records;
	};
	// A failed answer's body, when it is the feed's list, read by the one path a 2xx list takes
	// (request.ts, failed): its rows, then the pick; null when it is not the list.
	const inList = (json: unknown): Reading | null => {
		if (!Array.isArray(json)) return null;
		const rows = rowsOf(json);
		return Array.isArray(rows) ? pick(SEAT, ask.game, [rows], ask.near) : rows;
	};
	const listing = function* (path: string): Generator<HttpRequest, FeedRecord[] | Reading, HttpResponse> {
		const res = jsonOf(yield request(SEAT, path, ask.key));
		// Status decides nothing; the body does (request.ts, failed): a failed request is clean silence
		// before any row arrived, unless its body is the feed's list, read as a 2xx list is (inList); a 2xx
		// body that is not the feed's list, or any failure after rows arrived: an answer the reader could
		// not use.
		if (!res.ok) return failed(SEAT, res, inList, arrived);
		if (!Array.isArray(res.value)) return silent(SEAT, "unreadable");
		const records = rowsOf(res.value);
		if (!Array.isArray(records)) return records;
		if (records.length > 0) arrived = true;
		return records;
	};
	// One game, one request, when the game was created with the feed's id for it: the hinted record is
	// read when it is the game's two teams inside the window, as the hint rule reads it from a slate. An
	// empty answer for the id is clean, and the slate then decides as it would without the id, where the
	// league's slate fits the size an answer may be; where it does not, the seat is silent. An id answer
	// the reader could not use (the game's row it could not read, or the game's row under another id, a
	// by-id answer that is not the requested record) is held: the class is the worst of the seat's reads,
	// so it survives a clean or empty slate, and a slate that answers the game stands in its place. A row
	// of another game, or of the two teams outside the window, is absence.
	const hint = hintOf(ask.game.hints);
	let held: Reading | null = null;
	if (hint !== null) {
		const one = yield* listing(`${slate}&eventIds=${hint}`);
		if (!Array.isArray(one)) return one;
		if (one.length > 0) {
			const r = pick(SEAT, ask.game, [one], ask.near);
			if (r.kind !== "silent" && r.record !== null && r.record.id === hint && r.record.time !== null && inWindow(r.record.time, windowOf(ask.game))) return r;
			if (r.kind !== "silent") held = silent(SEAT, "the id's row is not the requested record");
			else if (r.answer !== "nothing") held = r;
		}
		if (!SLATE_FITS.has(ask.game.league)) return held ?? clean(SEAT, one.length === 0 ? "nothing for the id, and the slate is past the size" : "the id's row is not the game, and the slate is past the size");
	} else if (!SLATE_FITS.has(ask.game.league)) return clean(SEAT, "no id, and the slate is past the size");
	const records = yield* listing(slate);
	if (!Array.isArray(records)) return held ?? records;
	const r = pick(SEAT, ask.game, [records], ask.near);
	return r.kind === "silent" && held !== null ? held : r;
}
