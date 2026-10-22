// Seat 1's reader.
//
// Asks for the league's games one filing date at a time (see filingDates), a hundred to a page,
// following the feed's cursor. Each league names its fields its own way, so each has a small map
// below. Status: the nine-state `status_state` decides where a record has it: `final` is final,
// `postponed` and `canceled` are recorded, everything else is not final. Where a record lacks
// `status_state`, the reader falls back to the league's older field, and only that field's own
// unambiguous final word makes a final (see FALLBACK). College has no such word: its older
// field says "post" for a final, a postponed and a cancelled game alike, so a college record
// without `status_state` is not final.

import { pick, points, type FeedRecord, type FeedTeam } from "../pick";
import { silent } from "../run";
import { leagueRow } from "../table";
import type { Ask, ReaderRun, Seat } from "../types";
import { filingDates, parseIsoSeconds, windowOf } from "../window";
import { jsonOf, obj, request, str } from "./request";

const SEAT: Seat = 1;

interface Fields {
	readonly time: (g: Record<string, unknown>) => unknown;
	readonly home: (g: Record<string, unknown>) => FeedTeam;
	readonly away: (g: Record<string, unknown>) => FeedTeam;
	readonly older: (g: Record<string, unknown>) => FeedRecord["state"] | null;
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

const FIELDS: Readonly<Record<string, Fields>> = {
	nba: {
		time: (g) => g.datetime,
		home: (g) => team(g.home_team, ["full_name"], g.home_team_score),
		away: (g) => team(g.visitor_team, ["full_name"], g.visitor_team_score),
		older: (g) => (g.postponed === true ? "postponed" : g.status === "Final" ? "final" : null),
	},
	nfl: {
		time: (g) => g.date,
		home: (g) => team(g.home_team, ["full_name"], g.home_team_score),
		away: (g) => team(g.visitor_team, ["full_name"], g.visitor_team_score),
		older: (g) => (typeof g.status === "string" && /^Final(\/OT)?$/.test(g.status) ? "final" : null),
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
	},
	nhl: {
		time: (g) => g.start_time_utc,
		home: (g) => team(g.home_team, ["full_name"], g.home_score),
		away: (g) => team(g.away_team, ["full_name"], g.away_score),
		older: (g) => (g.game_state === "OFF" ? "final" : null),
	},
	ncaaf: {
		time: (g) => g.date,
		home: (g) => team(g.home_team, ["full_name", "college", "city"], g.home_score),
		away: (g) => team(g.visitor_team, ["full_name", "college", "city"], g.away_score),
		older: () => null,
	},
	ncaab: {
		time: (g) => g.date,
		home: (g) => team(g.home_team, ["full_name", "college"], g.home_score),
		away: (g) => team(g.visitor_team, ["full_name", "college"], g.away_score),
		older: () => null,
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
	unknown: "not_final",
};

export function toRecord(league: string, g: Record<string, unknown>): FeedRecord | null {
	const f = FIELDS[league];
	if (!f || (typeof g.id !== "number" && typeof g.id !== "string")) return null;
	const raw = g.status_state;
	let state: FeedRecord["state"];
	let status: string;
	if (typeof raw === "string") {
		state = STATE[raw] ?? "not_final";
		status = raw;
	} else {
		state = f.older(g) ?? "not_final";
		status = `no status_state; ${String(g.status ?? g.game_state ?? "")}`.trim();
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
	if (row === null || !FIELDS[ask.game.league]) return silent(SEAT, "league not offered");
	const records: FeedRecord[] = [];
	for (const date of filingDates(windowOf(ask.game))) {
		let cursor: string | null = null;
		do {
			const q = `?dates[]=${date}&per_page=100${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
			const res = yield request(SEAT, `${row[SEAT]}${q}`, ask.key);
			const body = jsonOf(res);
			if (!body.ok) return silent(SEAT, body.detail);
			const page = obj(body.value);
			const data = page?.data;
			if (!Array.isArray(data)) return silent(SEAT, "unreadable");
			for (const g of data) {
				const o = obj(g);
				const r = o === null ? null : toRecord(ask.game.league, o);
				if (r === null) return silent(SEAT, "unreadable record");
				records.push(r);
			}
			const next = obj(page?.meta)?.next_cursor;
			cursor = typeof next === "number" || (typeof next === "string" && next !== "") ? String(next) : null;
		} while (cursor !== null);
	}
	return pick(SEAT, ask.game, records);
}
