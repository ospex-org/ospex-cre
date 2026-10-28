// Drives a reader's run against a transport. A transport that throws, for any reason but one, makes
// the feed silent: nothing a transport does can turn into a final or a "no final". The one exception
// is a cut (below): the caller's own count of requests for the run is used up, and the reader raises
// it rather than read the seat silent.

import type { HttpRequest, HttpResponse, Reading, ReaderRun, Seat } from "./types";

/**
 * The one throw a transport may make that is not silence: the caller's own count of requests for the
 * run is used up, so the run is cut. A reader never reads a cut as a silent seat. Silence there would
 * be the caller's budget choosing what the program sees, and the program would decide on the part it
 * saw: a score where the whole read would have disputed. The readers raise it instead, the run ends
 * with nothing decided, and the caller writes nothing. A transport marks a cut by throwing a Cut, or
 * any error carrying `cut: true`; every other throw is silence, as before.
 */
export class Cut extends Error {
	readonly cut = true as const;
	constructor(message: string) {
		super(message);
		this.name = "Cut";
	}
}

/** True for a throw that cuts the run (a Cut, or any error carrying `cut: true`). */
export function isCut(e: unknown): boolean {
	return typeof e === "object" && e !== null && (e as { cut?: unknown }).cut === true;
}

/**
 * The most requests one reader may make for one game. Past it, the feed is silent. Seats 1 and 2
 * ask once per filing date and page (a 24-hour window has two or three dates); the most any saved
 * read needed was 4, one date of college basketball's opening night running to two pages. Twelve
 * leaves room for every date of a window to run to four pages, and stops a feed that pages for ever.
 * It also bounds the window: a window of ten days or less asks at most 12 dates, and a longer one can
 * ask more than this allows, so seats 1 and 2 would read it silent.
 */
export const MAX_REQUESTS = 12;

export function silent(seat: Seat, detail: string): Reading {
	return { seat, kind: "silent", home: null, away: null, recorded: null, detail, record: null };
}

/** Runs a reader with a synchronous transport, as the Chainlink workflow does. A cut is raised, not read silent. */
export function runSync(seat: Seat, run: ReaderRun, send: (req: HttpRequest) => HttpResponse): Reading {
	let step: IteratorResult<HttpRequest, Reading>;
	try {
		step = run.next(undefined as unknown as HttpResponse);
		for (let asked = 0; !step.done; asked++) {
			if (asked >= MAX_REQUESTS) return silent(seat, "request bound");
			const res = send(step.value);
			step = run.next(res);
		}
	} catch (e) {
		if (isCut(e)) throw e;
		return silent(seat, "transport");
	}
	return step.value;
}

/**
 * Runs a reader with an asynchronous transport, as a sealed machine's fetch would. It sets no
 * deadline of its own: a transport whose promise never settles holds the run until the caller's
 * deadline, so the caller bounds each request.
 */
export async function runAsync(
	seat: Seat,
	run: ReaderRun,
	send: (req: HttpRequest) => Promise<HttpResponse>,
): Promise<Reading> {
	let step: IteratorResult<HttpRequest, Reading>;
	try {
		step = run.next(undefined as unknown as HttpResponse);
		for (let asked = 0; !step.done; asked++) {
			if (asked >= MAX_REQUESTS) return silent(seat, "request bound");
			const res = await send(step.value);
			step = run.next(res);
		}
	} catch (e) {
		if (isCut(e)) throw e;
		return silent(seat, "transport");
	}
	return step.value;
}
