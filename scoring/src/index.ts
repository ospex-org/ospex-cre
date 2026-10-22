// The scoring script's readers: read one game on every seat the feed table names for its league.
//
// Which seats are asked comes from the table and nothing else. The only things a caller hands
// in are the game (read from the chain), the run's clock, a transport, and each seat's key.
// A seat whose key is missing is still asked about, and reads silent; no seat is ever skipped,
// added or reordered by what is handed in.

import * as seat1 from "./readers/seat1";
import * as seat2 from "./readers/seat2";
import * as seat3 from "./readers/seat3";
import * as seat4 from "./readers/seat4";
import { runAsync, runSync, silent } from "./run";
import { SEATS, leagueRow } from "./table";
import type { Ask, Game, HttpRequest, HttpResponse, Reading, ReaderRun, Seat } from "./types";

export type { Game, HttpRequest, HttpResponse, Reading, Seat } from "./types";
export { COUNTING, SPARE, SEATS, LEAGUES } from "./table";

const READERS: Readonly<Record<Seat, (ask: Ask) => ReaderRun>> = Object.freeze({
	1: seat1.read,
	2: seat2.read,
	3: seat3.read,
	4: seat4.read,
});

/** Each seat's key, by seat. Nothing else is read from it. */
export type Keys = Readonly<Partial<Record<Seat, string>>>;

/** What the readers found: whether the league is offered, and one reading per seat, in seat order. */
export interface Readings {
	readonly offered: boolean;
	readonly readings: readonly Reading[];
}

/** The seats asked for a league: every seat in the table, in seat order; none if not offered. */
export function seatsFor(league: string): readonly Seat[] {
	return leagueRow(league) === null ? [] : SEATS.map((r) => r.seat);
}

function keyFor(keys: Keys, seat: Seat): string | null {
	if (!Object.prototype.hasOwnProperty.call(keys, seat)) return null;
	const k = (keys as Record<number, unknown>)[seat];
	return typeof k === "string" && k !== "" ? k : null;
}

/** Reads a game on every seat, with a synchronous transport (the Chainlink workflow's). */
export function readGameSync(
	game: Game,
	keys: Keys,
	now: number,
	send: (req: HttpRequest) => HttpResponse,
): Readings {
	const seats = seatsFor(game.league);
	const readings = seats.map((seat) => {
		const key = keyFor(keys, seat);
		if (key === null) return silent(seat, "no key");
		return runSync(seat, READERS[seat]({ game, now, key }), send);
	});
	return { offered: seats.length > 0, readings };
}

/** Reads a game on every seat, with an asynchronous transport (a sealed machine's fetch). */
export async function readGameAsync(
	game: Game,
	keys: Keys,
	now: number,
	send: (req: HttpRequest) => Promise<HttpResponse>,
): Promise<Readings> {
	const seats = seatsFor(game.league);
	const readings: Reading[] = [];
	for (const seat of seats) {
		const key = keyFor(keys, seat);
		readings.push(key === null ? silent(seat, "no key") : await runAsync(seat, READERS[seat]({ game, now, key }), send));
	}
	return { offered: seats.length > 0, readings };
}

/** One seat's reader, for a caller that drives seats itself (the tests, the capture). */
export function readerFor(seat: Seat): (ask: Ask) => ReaderRun {
	return READERS[seat];
}
