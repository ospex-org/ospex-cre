// Seat 4's reader: the spare.
//
// Asks for the one game by the feed's own id for it, when the game was created with that hint
// (eventIds); otherwise once per league for live, upcoming and recently completed games, the slate,
// which the feed cannot be asked for by team. The feed gives each
// game's points as a list keyed by team name, not by home or away, so each team takes the one
// entry carrying its own name, compared the way team names are (case, accents, punctuation and
// spacing aside). Status: `completed` true is final, the feed's own word for a whole game;
// anything else is not final. The feed records no postponed or cancelled state. Its game time is
// the scheduled start until the game begins and the actual start after; it serves only this
// seat's own window check, never the game's start.
//
// Retention: the feed keeps completed games for three days. The reader stops asking 66 hours after
// the game's start, three days less six hours, a margin that holds whether the feed counts its
// three days from the start, from the end or by calendar day; past it the feed is silent, because a
// missing game then could be age, not absence.

import { pick, points, type FeedRecord, type FeedTeam } from "../pick";
import { silent } from "../run";
import { leagueRow } from "../table";
import { normalise } from "../teams";
import type { Ask, HttpRequest, HttpResponse, Reading, ReaderRun, Seat } from "../types";
import { inWindow, parseIsoSeconds, windowOf } from "../window";
import { jsonOf, obj, request, str } from "./request";

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
	return {
		id,
		time: parseIsoSeconds(e.commence_time),
		teams: [team(home, e.scores), team(away, e.scores)],
		state: e.completed === true ? "final" : "not_final",
		status: e.completed === true ? "completed" : "not completed",
	};
}

/** The feed's ids are 32 hex characters; nothing else is ever put in a request. */
const ID = /^[0-9a-f]{32}$/i;

/** The seat 4 id the game was created with, when it was created with exactly one that is one. */
function hintOf(hints: Ask["game"]["hints"]): string | null {
	const ids = [...new Set(hints.filter((h) => h.seat === SEAT).map((h) => h.id))];
	return ids.length === 1 && ID.test(ids[0]) ? ids[0].toLowerCase() : null;
}

export function* read(ask: Ask): ReaderRun {
	const row = leagueRow(ask.game.league);
	if (row === null) return silent(SEAT, "league not offered");
	// A clock that isn't a number can't say whether the game is still kept.
	if (!Number.isFinite(ask.now) || !Number.isFinite(ask.game.start)) return silent(SEAT, "no clock");
	if (ask.now - ask.game.start > RETENTION) return silent(SEAT, "past retention");
	const slate = `/v4/sports/${encodeURIComponent(row[SEAT])}/scores/?daysFrom=3&dateFormat=iso`;
	const listing = function* (path: string): Generator<HttpRequest, FeedRecord[] | Reading, HttpResponse> {
		const res = jsonOf(yield request(SEAT, path, ask.key));
		if (!res.ok) return silent(SEAT, res.detail);
		if (!Array.isArray(res.value)) return silent(SEAT, "unreadable");
		const records: FeedRecord[] = [];
		for (const item of res.value) {
			const o = obj(item);
			const r = o === null ? null : toRecord(o);
			if (r === null) return silent(SEAT, "unreadable record");
			records.push(r);
		}
		return records;
	};
	// One game, one request, when the game was created with the feed's id for it: the hinted record is
	// read when it is the game's two teams inside the window, as the hint rule reads it from a slate.
	// Anything else about it (another pair of teams, no time inside the window, a final it can't
	// score) is weighed against the slate, as it would be without the hint, in one more request.
	const hint = hintOf(ask.game.hints);
	if (hint !== null) {
		const one = yield* listing(`${slate}&eventIds=${hint}`);
		if (!Array.isArray(one)) return one;
		const r = pick(SEAT, ask.game, [one], ask.near);
		if (r.kind !== "silent" && r.record !== null && r.record.id === hint && r.record.time !== null && inWindow(r.record.time, windowOf(ask.game))) return r;
	}
	const records = yield* listing(slate);
	if (!Array.isArray(records)) return records;
	return pick(SEAT, ask.game, [records], ask.near);
}
