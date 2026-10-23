// Seat 4's reader: the spare.
//
// Asks once per league for live, upcoming and recently completed games. The feed gives each
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
import type { Ask, ReaderRun, Seat } from "../types";
import { parseIsoSeconds } from "../window";
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

export function* read(ask: Ask): ReaderRun {
	const row = leagueRow(ask.game.league);
	if (row === null) return silent(SEAT, "league not offered");
	if (ask.now - ask.game.start > RETENTION) return silent(SEAT, "past retention");
	const res = jsonOf(yield request(SEAT, `/v4/sports/${encodeURIComponent(row[SEAT])}/scores/?daysFrom=3&dateFormat=iso`, ask.key));
	if (!res.ok) return silent(SEAT, res.detail);
	if (!Array.isArray(res.value)) return silent(SEAT, "unreadable");
	const records: FeedRecord[] = [];
	for (const item of res.value) {
		const o = obj(item);
		const r = o === null ? null : toRecord(o);
		if (r === null) return silent(SEAT, "unreadable record");
		records.push(r);
	}
	return pick(SEAT, ask.game, [records]);
}
