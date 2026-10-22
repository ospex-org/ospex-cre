// Each seat's key: the one thing per seat the program takes from outside. A key decides only
// whether its own seat can be asked; nothing else reads it.

import type { Seat } from "./types";

/** Each seat's key, by seat. Nothing else is read from it. */
export type Keys = Readonly<Partial<Record<Seat, string>>>;

/** The seat's own key, or null: missing, inherited, empty or not a string all read as no key. */
export function keyFor(keys: Keys, seat: Seat): string | null {
	if (!Object.prototype.hasOwnProperty.call(keys, seat)) return null;
	const k = (keys as Record<number, unknown>)[seat];
	return typeof k === "string" && k !== "" ? k : null;
}
