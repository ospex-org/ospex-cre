// Seat 3's board, read once, at verification (Vince, 10/22, ruling 2 on this card).
//
// Seat 3 is read by its creation hint, and its results carry no team names and no time, so its
// points are the feed's own home and away, bound to the game only by the hint. Verification checks
// that binding while the game is still listed on seat 3's board: the hint's row must name the
// game's two teams, the home team as home and the away team as away, and its time is checked
// against the other counting seats' (verify.ts). A hint that fails the check makes seat 3 silent
// for that game, never wrong.
//
// Three outcomes, kept apart because they lead to different places:
//   listed   the hint's row names the game's teams in the game's order, with a time;
//   fails    the board answered and the hint does not pass: seat 3 is silent for the whole game;
//   silent   the board could not be read this time (no key, a refused or failed request, an answer
//            that does not parse): nothing is learned about the hint, and verification waits.

import { resolveTeam } from "../teams";
import { leagueRow } from "../table";
import type { HttpRequest, HttpResponse } from "../types";
import type { Ask } from "../types";
import { parseIsoSeconds } from "../window";
import { jsonOf, obj, request, str } from "./request";
import { hintOf } from "./seat3";

export type BoardCheck =
	| { readonly kind: "listed"; readonly id: string; readonly time: number }
	| { readonly kind: "fails"; readonly why: string }
	| { readonly kind: "silent"; readonly why: string };

export type BoardRun = Generator<HttpRequest, BoardCheck, HttpResponse>;

/** The board writes its time in UTC without a zone; a time that carries its own zone is read as given. */
function boardTime(v: unknown): number | null {
	const s = str(v);
	if (s === null) return null;
	const t = s.trim();
	return parseIsoSeconds(/(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}Z`);
}

export function* checkBoard(ask: Ask): BoardRun {
	const row = leagueRow(ask.game.league);
	if (row === null) return { kind: "fails", why: "league not offered" };
	const hint = hintOf(ask.game.hints);
	if ("none" in hint) return { kind: "fails", why: hint.none };

	const res = jsonOf(yield request(3, `/odds/${encodeURIComponent(row[3])}?oddType=Game`, ask.key));
	if (!res.ok) return { kind: "silent", why: res.detail };
	if (!Array.isArray(res.value)) return { kind: "silent", why: "unreadable" };

	const rows: Record<string, unknown>[] = [];
	for (const item of res.value) {
		const r = obj(item);
		if (r === null) return { kind: "silent", why: "unreadable record" };
		const id = str(r.ID);
		if (id !== null && id.toLowerCase() === hint.id) rows.push(r);
	}
	if (rows.length === 0) return { kind: "fails", why: "hint not on the board" };
	if (rows.length > 1) return { kind: "fails", why: "hint listed twice on the board" };

	const league = ask.game.league;
	const home = resolveTeam(league, ask.game.home);
	const away = resolveTeam(league, ask.game.away);
	if (home === null || away === null || home === away) return { kind: "fails", why: "game teams unknown" };
	const boardHome = resolveTeam(league, rows[0].HomeTeam);
	const boardAway = resolveTeam(league, rows[0].AwayTeam);
	if (boardHome === away && boardAway === home) return { kind: "fails", why: "home and away the other way round" };
	if (boardHome !== home || boardAway !== away) return { kind: "fails", why: "other teams" };

	const time = boardTime(rows[0].MatchTime);
	if (time === null) return { kind: "fails", why: "no time" };
	return { kind: "listed", id: hint.id, time };
}
