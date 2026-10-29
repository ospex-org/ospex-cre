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
// without points reads silent. "Postponed" and "Canceled" are the feed's own words that the game will
// not play, and a void may rest on them (rule.ts); "NotFinished" is not final; a row without a
// `FinalType` is a partial row and reads silent; any other `FinalType`, or "Finished" under a final
// flag the reader does not know, is unrecognized, silent too, the words verbatim on the reading. Only
// the game's own "Game" row is read: a hint naming a row for halves or innings is a part of the game,
// silent. Every silence here but a failed request, an empty body and the hint's rows absent from a
// readable list (no result for the hint: every row under another id) is an answer the reader could not
// use, and the void holds it (types.ts, answer): a body that is not the feed's list, a row that would
// not parse, a row with no id the reader can hold it to (missing, empty, not a string: it may be the
// hint's), the result listed twice, a part of the game, a row without points, a status word or one it
// does not know. A refusal for a bad row carries the hint's row's word beside it.

import { points } from "../pick";
import { clean, silent } from "../run";
import { leagueRow } from "../table";
import type { Ask, Reading, ReaderRun, Seat } from "../types";
import { jsonOf, obj, request, str } from "./request";

const SEAT: Seat = 3;

/** The feed's ids are UUIDs; nothing else is ever put in a request path. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isFinalFlag(v: unknown): boolean {
	return v === true || v === "true" || v === "True";
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
	if (leagueRow(ask.game.league) === null) return clean(SEAT, "league not offered");
	const hint = hintOf(ask.game.hints);
	if ("none" in hint) return clean(SEAT, hint.none);

	const res = jsonOf(yield request(SEAT, `/results/${hint.id}`, ask.key));
	// A request that failed, or an empty body: clean silence, nothing of the game arrived. A body that is
	// not the feed's list: an answer the reader could not use.
	if (!res.ok) return res.arrived ? silent(SEAT, res.detail) : clean(SEAT, res.detail);
	if (!Array.isArray(res.value)) return silent(SEAT, "unreadable");

	// Every row is read before any refusal, so a refusal carries the hint's row's word. A row that would
	// not parse, or one with no id the reader can hold it to, may be the hint's: an answer the reader
	// could not use. A row under another id is not the game.
	const rows: Record<string, unknown>[] = [];
	let unreadable = false;
	let unidentified = false;
	for (const item of res.value) {
		const r = obj(item);
		if (r === null) {
			unreadable = true;
			continue;
		}
		const id = str(r.ID);
		if (id === null) unidentified = true;
		else if (id.toLowerCase() === hint.id) rows.push(r);
	}
	const word = rows.length === 0 ? "" : `; the hint's row says ${JSON.stringify(typeof rows[0].FinalType === "string" ? rows[0].FinalType : "")}`;
	if (unreadable) return silent(SEAT, `unreadable record${word}`);
	if (unidentified) return silent(SEAT, `result without an id${word}`);
	// The hint's rows absent from the answer: clean silence. Listed twice, or naming a row for a half or
	// for innings, a part of the game: an answer the reader could not use, and the void holds it.
	if (rows.length === 0) return clean(SEAT, "no result for the hint");
	if (rows.length > 1) return silent(SEAT, "duplicate result");
	if (rows[0].OddType !== "Game") return silent(SEAT, "hint names a part of the game");
	return readingOf(rows[0], hint.id);
}

function readingOf(r: Record<string, unknown>, id: string): Reading {
	const type = typeof r.FinalType === "string" ? r.FinalType : "";
	const home = points(r.HomeScore);
	const away = points(r.AwayScore);
	const record = { id, time: null };
	if (type === "Finished") {
		// The feed's own word for a whole game played, under its final flag; a flag the reader does not
		// know is unrecognized, verbatim.
		if (!isFinalFlag(r.Final)) return silent(SEAT, `unrecognized final flag ${String(JSON.stringify(r.Final))}`);
		if (home === null || away === null) return silent(SEAT, "final without points");
		return { seat: SEAT, kind: "final", home, away, recorded: null, detail: "final", record, answer: "the game" };
	}
	if (type === "Postponed" || type === "Canceled") {
		const recorded = type === "Postponed" ? "postponed" : "canceled";
		return { seat: SEAT, kind: "no_final", home, away, recorded, detail: recorded, record, answer: "the game" };
	}
	if (type === "NotFinished") return { seat: SEAT, kind: "no_final", home, away, recorded: null, detail: type, record, answer: "the game" };
	// A row with no status word is a partial row; any other word is one the reader does not know, kept
	// verbatim so the feed's own word shows in the run's line: both silent, an answer it could not use.
	if (type.trim() === "") return silent(SEAT, "no status");
	return silent(SEAT, `unrecognized status ${JSON.stringify(type)}`);
}
