// Seat 3's board, read once, at verification.
//
// Seat 3 is read by its creation hint, and its results carry no team names and no time, so its
// points are the feed's own home and away, bound to the game only by the hint. Verification checks
// that binding while the game is still listed on seat 3's board: the hint's row must be the game's own
// row, not one for a part of it, and name the game's two teams, the home team as home and the away
// team as away, and its time is checked against the other counting seats' (verify.ts). A hint that
// fails the check makes seat 3 silent for that game, never wrong.
//
// Three outcomes, kept apart because they lead to different places:
//   listed   the hint's row is the game's, names the game's teams in the game's order, with a time;
//   fails    the board answered, every row of it readable, and the hint can't be bound to the game:
//            not on a board that reaches the game, listed twice, a row for a part of the game, other
//            teams, the teams the other way round, or a team name the team lists don't know. Seat 3
//            is silent for the whole game, and the spare stands in. A hint missing from the board is
//            marked: the board drops a finished game, so verification reads seat 3's result for that
//            hint before standing seat 3 down (verify.ts);
//   silent   nothing is learned about the hint this time, and verification waits: no key, a refused
//            or failed request, a body that is not JSON of the board's shape, a row whose id isn't
//            a seat 3 id, the hinted row's teams unreadable or not yet named, the hinted row's time
//            unreadable when its teams are the game's, or a board that doesn't reach the game yet.
//
// A row the program can't read says nothing about the hint, so it never stands seat 3 down: an id
// that isn't in the form a hint must take (the seat 3 id pattern hintOf checks, in any case) could
// be the hint's own row, padded or cut short. The teams are checked before the time: a row of other
// teams fails whatever its time says, and only the game's own row waits for a time it can read. A
// side the board names only by a placeholder ("TBD") is not named yet: the row may become the game,
// so it waits, unless the side it does name already makes it another game.
//
// A hint missing from the board fails only once the board lists some game at or after `ask.near`:
// the game's own time at seats 1 and 2 when both list it, the later of the two, otherwise the
// creator's date (program.ts). Before that, the board has not reached the game, and a game created
// early would otherwise lose seat 3. A finished game the board has dropped still fails here, since the
// board lists the games after it; and so does the league's last listed game when the creator's date
// falls after its time.
//
// An unknown team name fails the check here, where the readers would read the seat silent for the
// run. The difference is deliberate: verification is the one moment the binding can be checked, and
// a run that waits on a spelling the program will never learn waits for good, while standing seat 3
// down leaves the game three counting seats and is never wrong. A placeholder is different: the feed
// replaces it when the teams are known, so waiting has an end.

import { resolveTeam } from "../teams";
import { leagueRow } from "../table";
import type { HttpRequest, HttpResponse } from "../types";
import type { Ask } from "../types";
import { parseIsoSeconds } from "../window";
import { jsonOf, obj, request, str } from "./request";
import { hintOf } from "./seat3";

export type BoardCheck =
	| { readonly kind: "listed"; readonly id: string; readonly time: number }
	| { readonly kind: "fails"; readonly why: string; readonly missing?: true }
	| { readonly kind: "silent"; readonly why: string };

export type BoardRun = Generator<HttpRequest, BoardCheck, HttpResponse>;

/** A team the board doesn't name yet, in its own placeholder words. */
const PLACEHOLDER = /^(tbd|tba|to be (determined|announced))$/i;

/** The board writes its time in UTC without a zone; a time that carries its own zone is read as given. */
function boardTime(v: unknown): number | null {
	const s = str(v);
	if (s === null) return null;
	const t = s.trim();
	return parseIsoSeconds(/(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}Z`);
}

/**
 * True unless the row says it is for a part of the game (a half, a period, innings), in its own
 * OddType or in any of its odds'. The board is asked for the game's own rows, which give no OddType
 * of their own and "Game" on each of their odds.
 */
function wholeGame(r: Record<string, unknown>): boolean {
	const odds = Array.isArray(r.Odds) ? r.Odds.map((o) => obj(o)?.OddType) : [];
	return [r.OddType, ...odds].every((t) => typeof t !== "string" || t === "Game");
}

/**
 * Checks the hint against the board. `ask.near` is the time the board must reach for a missing hint
 * to fail: the game's own time at seats 1 and 2, or the creator's date. Short of it, a missing hint
 * waits rather than fails.
 */
export function* checkBoard(ask: Ask): BoardRun {
	const row = leagueRow(ask.game.league);
	if (row === null) return { kind: "fails", why: "league not offered" };
	const hint = hintOf(ask.game.hints);
	if ("none" in hint) return { kind: "fails", why: hint.none };

	const res = jsonOf(yield request(3, `/odds/${encodeURIComponent(row[3])}?oddType=Game`, ask.key));
	if (!res.ok) return { kind: "silent", why: res.detail };
	if (!Array.isArray(res.value)) return { kind: "silent", why: "unreadable" };

	const rows: Record<string, unknown>[] = [];
	let last: number | null = null;
	for (const item of res.value) {
		const r = obj(item);
		// Readable only in the form the hint takes: a seat 3 id, compared without regard to case.
		const id = r === null || typeof r.ID !== "string" ? null : hintOf([{ seat: 3, id: r.ID }]);
		if (r === null || id === null || "none" in id) return { kind: "silent", why: "unreadable record" };
		if (id.id === hint.id) rows.push(r);
		const t = boardTime(r.MatchTime);
		if (t !== null && (last === null || t > last)) last = t;
	}
	if (rows.length === 0) {
		const date = ask.near;
		if (date === undefined || last === null || last < date) return { kind: "silent", why: "the board doesn't reach the game yet" };
		return { kind: "fails", why: "hint not on the board", missing: true };
	}
	if (rows.length > 1) return { kind: "fails", why: "hint listed twice on the board" };

	const hinted = rows[0];
	if (!wholeGame(hinted)) return { kind: "fails", why: "hint names a part of the game" };
	const league = ask.game.league;
	const home = resolveTeam(league, ask.game.home);
	const away = resolveTeam(league, ask.game.away);
	if (home === null || away === null || home === away) return { kind: "fails", why: "game teams unknown" };
	const homeName = str(hinted.HomeTeam);
	const awayName = str(hinted.AwayTeam);
	if (homeName === null || awayName === null) return { kind: "silent", why: "unreadable record" };
	// A side named only by a placeholder is undefined here: not yet named, which is not a name the
	// lists don't know.
	const named = (name: string): string | null | undefined => (PLACEHOLDER.test(name.trim()) ? undefined : resolveTeam(league, name));
	const boardHome = named(homeName);
	const boardAway = named(awayName);
	if (boardHome === null || boardAway === null) return { kind: "fails", why: "a team name the lists don't know" };
	if (boardHome === undefined || boardAway === undefined) {
		// The side it does name must be the game's, on the game's side; then the row waits for the other.
		const fits = (boardHome === undefined || boardHome === home) && (boardAway === undefined || boardAway === away);
		if (fits) return { kind: "silent", why: "the hint's row names no team yet" };
		const reversed = (boardHome === undefined || boardHome === away) && (boardAway === undefined || boardAway === home);
		return { kind: "fails", why: reversed ? "home and away the other way round" : "other teams" };
	}
	if (boardHome === away && boardAway === home) return { kind: "fails", why: "home and away the other way round" };
	if (boardHome !== home || boardAway !== away) return { kind: "fails", why: "other teams" };
	// The game's own row: its time must be readable for the hint to bind.
	const time = boardTime(hinted.MatchTime);
	if (time === null) return { kind: "silent", why: "unreadable record" };
	return { kind: "listed", id: hint.id, time };
}
