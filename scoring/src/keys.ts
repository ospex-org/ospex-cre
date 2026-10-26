// Each seat's key: the one thing per seat the program takes from outside. A key decides only
// whether its own seat can be asked; nothing else reads it.
//
// A key goes into its request as given (src/readers/request.ts), so it must be text a request can
// carry unchanged. In a header that is visible ASCII with no space, 0x21 to 0x7E. Anything else is
// no key. A key with a line break, a NUL or a character outside that range makes a fetch-style
// transport refuse to build the request, and a transport failure reads the seat silent, so such a
// key would choose which seats are read. Spaces and a trailing line break are trimmed by some
// transports before sending, so the feed would be asked with another key than the one handed in.
//
// A key the feed table puts in the query must also be one query value as given: text the standard
// encoding of a query value (encodeURIComponent) leaves unchanged, which is letters, digits and
// - _ . ! ~ * ' ( ). Any other key is no key. In a query, & starts another parameter, # ends the
// query, + reads as a space and % as an escape, so the feed would be asked something other than
// what was handed in: a key ending in "&dateFormat=unix" turns that seat's game times into numbers
// it can't read, and hides its final. The key is refused, never encoded, so a request
// still carries exactly the key handed in.
//
// A stand-in such as `{{.seat2}}`, for a transport that fills a header's key itself, is visible
// ASCII and passes. A stand-in can't stand for a key in the query: it isn't one query value as
// given, and the workflow's own transport fills only headers and bodies.

import { seatRow } from "./table";
import type { Seat } from "./types";

/** Each seat's key, by seat. Nothing else is read from it. */
export type Keys = Readonly<Partial<Record<Seat, string>>>;

/** Visible ASCII, no space: text a header carries as given. */
const CARRIED = /^[\x21-\x7e]+$/;

/** True when a query carries the key as one value, as given: encoding it changes nothing. */
function oneQueryValue(k: string): boolean {
	return encodeURIComponent(k) === k;
}

/**
 * The seat's own key, or null: missing, inherited, empty, not a string, or holding anything but
 * visible ASCII (a space, a tab, a line break, a NUL, a character above 0x7E) all read as no key;
 * and for a seat whose key goes in the query, a key that isn't one query value as given.
 */
export function keyFor(keys: Keys, seat: Seat): string | null {
	if (!Object.prototype.hasOwnProperty.call(keys, seat)) return null;
	const k = (keys as Record<number, unknown>)[seat];
	if (typeof k !== "string" || !CARRIED.test(k)) return null;
	if ("query" in seatRow(seat).key && !oneQueryValue(k)) return null;
	return k;
}
