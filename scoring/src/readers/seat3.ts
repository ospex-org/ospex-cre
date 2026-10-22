// Seat 3's reader.
//
// The feed splits a game across two answers. Its board (the league's games with prices) gives
// each game's id, two teams and game time, and only while the game is listed there. Its results
// give each game's id, points and status, with no teams and no time, for five days after the
// game's start. The reader asks for both and joins them by id. A result the board no longer
// lists can't be checked by team or by window, so it is held back: if it might be the game, the
// feed is silent, never "no final".
//
// Status: final only when `Final` is true and `FinalType` is "Finished". The feed sets `Final`
// true on postponed and cancelled games too, so `Final` alone never makes a final. "Postponed"
// and "Canceled" are recorded; everything else is not final. Only each game's "Game" row is
// read; the feed's rows for halves and innings are not.
//
// Retention: results stay five days after a game's start. Past four days the reader does not
// ask, and the feed is silent: a missing result then could be age, not absence.

import { pick, points, type FeedRecord } from "../pick";
import { silent } from "../run";
import { leagueRow } from "../table";
import type { Ask, ReaderRun, Seat } from "../types";
import { parseIsoSeconds } from "../window";
import { jsonOf, obj, request, str } from "./request";

const SEAT: Seat = 3;
const RETENTION = 4 * 86400;

/** The feed writes its game times in UTC with no zone. */
function boardTime(v: unknown): number | null {
	const s = str(v);
	if (s === null || /(Z|[+-]\d{2}:?\d{2})$/.test(s.trim())) return null;
	return parseIsoSeconds(`${s.trim()}Z`);
}

function isFinalFlag(v: unknown): boolean {
	return v === true || v === "true" || v === "True";
}

interface Result {
	readonly state: FeedRecord["state"];
	readonly status: string;
	readonly home: number | null;
	readonly away: number | null;
}

function resultOf(r: Record<string, unknown>): Result {
	const type = typeof r.FinalType === "string" ? r.FinalType : "";
	const state: FeedRecord["state"] =
		isFinalFlag(r.Final) && type === "Finished"
			? "final"
			: type === "Postponed"
				? "postponed"
				: type === "Canceled"
					? "canceled"
					: "not_final";
	return { state, status: type, home: points(r.HomeScore), away: points(r.AwayScore) };
}

export function* read(ask: Ask): ReaderRun {
	const row = leagueRow(ask.game.league);
	if (row === null) return silent(SEAT, "league not offered");
	if (ask.now - ask.game.start > RETENTION) return silent(SEAT, "past retention");
	const code = encodeURIComponent(row[SEAT]);

	const boardRes = jsonOf(yield request(SEAT, `/odds/${code}?oddType=Game`, ask.key));
	if (!boardRes.ok) return silent(SEAT, boardRes.detail);
	const resultsRes = jsonOf(yield request(SEAT, `/results/${code}`, ask.key));
	if (!resultsRes.ok) return silent(SEAT, resultsRes.detail);
	if (!Array.isArray(boardRes.value) || !Array.isArray(resultsRes.value)) return silent(SEAT, "unreadable");

	const results = new Map<string, Result>();
	for (const item of resultsRes.value) {
		const r = obj(item);
		if (r === null) return silent(SEAT, "unreadable record");
		const id = str(r.ID);
		if (id === null || r.OddType !== "Game" || r.EventID !== id) continue;
		if (results.has(id)) return silent(SEAT, "duplicate result");
		results.set(id, resultOf(r));
	}

	const records: FeedRecord[] = [];
	const placed = new Set<string>();
	for (const item of boardRes.value) {
		const e = obj(item);
		if (e === null) return silent(SEAT, "unreadable record");
		const id = str(e.ID);
		if (id === null) return silent(SEAT, "unreadable record");
		const result = results.get(id);
		const home = str(e.HomeTeam);
		const away = str(e.AwayTeam);
		records.push({
			id,
			time: boardTime(e.MatchTime),
			teams: [
				{ names: home === null ? [] : [home], points: result?.home ?? null },
				{ names: away === null ? [] : [away], points: result?.away ?? null },
			],
			state: result?.state ?? "not_final",
			status: result?.status ?? "no result yet",
		});
		placed.add(id);
	}
	const unplaced = new Set([...results.keys()].filter((id) => !placed.has(id)));
	return pick(SEAT, ask.game, records, unplaced);
}
