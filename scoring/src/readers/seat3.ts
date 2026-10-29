// Seat 3's reader: read by the game's seat 3 hint.
//
// The feed's results give a game's points and status, but no team names and no game time, and
// its board, which has both, drops a game once the game is final. So seat 3 can't be found by team
// and window like the other three. It is read by the seat 3 id given at the game's creation: the
// hint rides in the creation event on chain, so anyone can re-run the match for as long as the
// feed answers for that id (about five days after the game; older ids answer nothing). No seat 3
// hint, two different ones, or one that is not a seat 3 id, and the seat is silent without asking.
//
// What that means for the two rules this seat cannot check itself:
//   by team   The result has no team names, so its points are read in the feed's own home and
//             away order. The hint binds that order to the game; checking the binding against
//             the feed's board while the game is listed (teams in the game's own home and away
//             order) belongs to verification, before the start is written.
//   window    The result has no game time. A makeup is kept from scoring the original by the
//             feed marking the original id postponed, and by the agreement rule, not by the
//             window.
//
// Status: final only when `Final` is true and `FinalType` is "Finished"; the feed sets `Final` true
// on postponed and cancelled games too, so `Final` alone never makes a final; a finished result
// without points reads silent, marked as the feed saying the game is over (types.ts), and so does the
// game's own finished row the reader refuses for another reason, listed twice or beside a row it can't
// parse: the mark is set before the refusal, and after n the void waits on it (rule.ts). "Postponed"
// and "Canceled" are the feed's own words that the game will not play, and a void may rest on them
// (rule.ts); any other `FinalType` is not final; a row without one is a partial row and reads
// silent. Only the game's own "Game" row is read, never its rows for halves or innings.

import { points, saidFinal } from "../pick";
import { silent } from "../run";
import { leagueRow } from "../table";
import type { Ask, Reading, ReaderRun, Seat } from "../types";
import { jsonOf, obj, request, str } from "./request";

const SEAT: Seat = 3;

/** The feed's ids are UUIDs; nothing else is ever put in a request path. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isFinalFlag(v: unknown): boolean {
	return v === true || v === "true" || v === "True";
}

/** The feed's own word for a whole game played: `Final` set and `FinalType` "Finished". */
function isFinished(r: Record<string, unknown>): boolean {
	return isFinalFlag(r.Final) && r.FinalType === "Finished";
}

/** The seat 3 id the game was created with, or why there is none to read. */
export function hintOf(hints: Ask["game"]["hints"]): { id: string } | { none: string } {
	const ids = [...new Set(hints.filter((h) => h.seat === SEAT).map((h) => h.id))];
	if (ids.length === 0) return { none: "no hint" };
	if (ids.length > 1) return { none: "two hints" };
	if (!ID.test(ids[0])) return { none: "hint is not a seat 3 id" };
	return { id: ids[0].toLowerCase() };
}

export function* read(ask: Ask): ReaderRun {
	if (leagueRow(ask.game.league) === null) return silent(SEAT, "league not offered");
	const hint = hintOf(ask.game.hints);
	if ("none" in hint) return silent(SEAT, hint.none);

	const res = jsonOf(yield request(SEAT, `/results/${hint.id}`, ask.key));
	if (!res.ok) return silent(SEAT, res.detail);
	if (!Array.isArray(res.value)) return silent(SEAT, "unreadable");

	// The hint's rows, every one that parses, read before any refusal: the game's own row among them
	// that says finished marks the refusal, the row listed twice or beside a row the reader can't parse
	// included (types.ts, saysFinal).
	const rows: Record<string, unknown>[] = [];
	let unreadable = false;
	for (const item of res.value) {
		const r = obj(item);
		if (r === null) {
			unreadable = true;
			continue;
		}
		const id = str(r.ID);
		if (id !== null && id.toLowerCase() === hint.id) rows.push(r);
	}
	const said = rows.some((r) => r.OddType === "Game" && isFinished(r));
	const quiet = (detail: string): Reading => saidFinal(silent(SEAT, detail), said);
	if (unreadable) return quiet("unreadable record");
	if (rows.length === 0) return silent(SEAT, "no result for the hint");
	if (rows.length > 1) return quiet("duplicate result");
	// A hint naming a row for a half or for innings would read a part of the game as its final; its
	// finished row is the part's, and marks nothing.
	if (rows[0].OddType !== "Game") return silent(SEAT, "hint names a part of the game");
	return readingOf(rows[0], hint.id);
}

function readingOf(r: Record<string, unknown>, id: string): Reading {
	const type = typeof r.FinalType === "string" ? r.FinalType : "";
	const home = points(r.HomeScore);
	const away = points(r.AwayScore);
	const record = { id, time: null };
	if (isFinished(r)) {
		if (home === null || away === null) return { ...silent(SEAT, "final without points"), saysFinal: true };
		return { seat: SEAT, kind: "final", home, away, recorded: null, detail: "final", record };
	}
	// A row with no status word is a partial row: it says nothing about the game's end.
	if (type.trim() === "") return silent(SEAT, "no status");
	const recorded = type === "Postponed" ? "postponed" : type === "Canceled" ? "canceled" : null;
	return { seat: SEAT, kind: "no_final", home, away, recorded, detail: recorded ?? type, record };
}
