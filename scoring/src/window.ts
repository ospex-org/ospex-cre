// The window, and the clock arithmetic the readers share.
//
// The window is the game's n and nothing else: [start, start + n). A feed's final counts only if
// the feed's own game time for that record is inside it, so a makeup game, which a feed lists at
// its new time, never scores the original game. The end is open: a makeup played at the same
// clock time the next day sits at exactly start + 24 h and stays out.

import type { Game } from "./types";

export interface Window {
	readonly from: number;
	readonly to: number;
}

/** The game's window, in unix seconds. */
export function windowOf(game: Game): Window {
	return { from: game.start, to: game.start + game.n };
}

/** True when a feed's own game time for a record is inside the window. */
export function inWindow(time: number, w: Window): boolean {
	return time >= w.from && time < w.to;
}

/**
 * The calendar dates a feed may file a game in the window under, oldest first. A feed files a
 * game under its UTC date or under a US local date, and every US local date is the UTC date or
 * the day before it. So the dates run from the day before the window's first UTC date through
 * its last.
 */
export function filingDates(w: Window): string[] {
	const first = Math.floor(w.from / 86400) - 1;
	const last = Math.floor((w.to - 1) / 86400);
	const out: string[] = [];
	for (let day = first; day <= last; day++) out.push(dateOfDay(day));
	return out;
}

const ISO =
	/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Parses an ISO 8601 date-time that carries its own zone ("Z" or "+hh:mm") to unix seconds.
 * Pure arithmetic, so the answer never depends on the machine's time zone. Returns null for
 * anything else, including a date with no time and a time with no zone: a reader whose feed
 * writes UTC without a zone says so itself.
 */
export function parseIsoSeconds(s: unknown): number | null {
	if (typeof s !== "string") return null;
	const m = ISO.exec(s.trim());
	if (!m) return null;
	const [, y, mo, d, h, mi, se, , zone] = m;
	const year = Number(y);
	const month = Number(mo);
	const day = Number(d);
	const hour = Number(h);
	const minute = Number(mi);
	const second = se === undefined ? 0 : Number(se);
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
	if (hour > 23 || minute > 59 || second > 59) return null;
	let offset = 0;
	if (zone !== "Z") {
		const sign = zone[0] === "-" ? -1 : 1;
		const digits = zone.slice(1).replace(":", "");
		const oh = Number(digits.slice(0, 2));
		const om = Number(digits.slice(2, 4));
		if (oh > 23 || om > 59) return null;
		offset = sign * (oh * 3600 + om * 60);
	}
	return daysFromEpoch(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offset;
}

function dateOfDay(days: number): string {
	const [y, m, d] = civilFromDays(days);
	return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isLeap(y: number): boolean {
	return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
	return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

// Days since 1970-01-01 for a proleptic Gregorian date, and back (Howard Hinnant's algorithms).
function daysFromEpoch(y: number, m: number, d: number): number {
	const yy = m <= 2 ? y - 1 : y;
	const era = Math.floor(yy / 400);
	const yoe = yy - era * 400;
	const mp = (m + 9) % 12;
	const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): [number, number, number] {
	const zz = z + 719468;
	const era = Math.floor(zz / 146097);
	const doe = zz - era * 146097;
	const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const m = mp < 10 ? mp + 3 : mp - 9;
	const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
	return [y, m, d];
}
