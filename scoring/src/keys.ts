// Each seat's key: the one thing per seat the program takes from outside. A key decides only
// whether its own seat can be asked; nothing else reads it.
//
// A key goes into its request as given (src/readers/request.ts), so it must be text a request can
// carry unchanged: visible ASCII with no space, 0x21 to 0x7E. Anything else is no key. A key with a
// line break, a NUL or a character outside that range makes a fetch-style transport refuse to build
// the request, and a transport failure reads the seat silent, so such a key would choose which
// seats are read. Spaces and a trailing line break are trimmed by some transports before sending,
// so the feed would be asked with another key than the one handed in. A stand-in such as
// `{{.seat2}}`, for a transport that fills the key itself, is visible ASCII and passes.

import type { Seat } from "./types";

/** Each seat's key, by seat. Nothing else is read from it. */
export type Keys = Readonly<Partial<Record<Seat, string>>>;

/** Visible ASCII, no space: text a header or a query carries as given. */
const CARRIED = /^[\x21-\x7e]+$/;

/**
 * The seat's own key, or null: missing, inherited, empty, not a string, or holding anything but
 * visible ASCII (a space, a tab, a line break, a NUL, a character above 0x7E) all read as no key.
 */
export function keyFor(keys: Keys, seat: Seat): string | null {
	if (!Object.prototype.hasOwnProperty.call(keys, seat)) return null;
	const k = (keys as Record<number, unknown>)[seat];
	return typeof k === "string" && CARRIED.test(k) ? k : null;
}
