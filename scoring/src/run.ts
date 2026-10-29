// Drives a reader's run against a transport. A transport that throws, for any reason but one, makes
// the feed silent: nothing a transport does can turn into a final or a "no final". The one exception
// is a cut (below): the caller's own count of requests for the run is used up, and the reader raises
// it rather than read the seat silent. Silence here is clean only before any response reached the
// reader; a throw, or the reader's own cap, after one is partway through the seat's reads, and the
// void holds it (types.ts, answer).

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
 * The most requests one reader may make for one game. Past it, the feed is silent. Each reader asks
 * for the one game: seat 1 once, the two teams' games on the window's dates in one page; seat 2 once
 * per team; seats 3 and 4 once. Twelve is reached only by a feed that pages past what one game's answer
 * should hold (a team's games on a window's dates fit one page of a hundred rows), and stops a feed
 * that pages for ever; a caller's own count of requests may cut the run before it (Cut, below).
 */
export const MAX_REQUESTS = 12;

/**
 * A silent reading the void holds: an answer the reader could not use (types.ts, answer). The default
 * for any silence, so a reader that gives up somewhere new holds the void until it says otherwise.
 */
export function silent(seat: Seat, detail: string): Reading {
	return { seat, kind: "silent", home: null, away: null, recorded: null, detail, record: null, answer: "unusable" };
}

/** Clean silence: nothing of the game arrived, and the void is silent to it (types.ts, answer). */
export function clean(seat: Seat, detail: string): Reading {
	return { ...silent(seat, detail), answer: "nothing" };
}

/** Runs a reader with a synchronous transport, as the Chainlink workflow does. A cut is raised, not read silent. */
export function runSync(seat: Seat, run: ReaderRun, send: (req: HttpRequest) => HttpResponse): Reading {
	let step: IteratorResult<HttpRequest, Reading>;
	let delivered = 0;
	// Before any response reached the reader, clean silence; after one, partway through the seat's reads.
	const dropped = (detail: string): Reading => (delivered > 0 ? silent(seat, detail) : clean(seat, detail));
	try {
		step = run.next(undefined as unknown as HttpResponse);
		for (let asked = 0; !step.done; asked++) {
			if (asked >= MAX_REQUESTS) return dropped("request bound");
			const res = send(step.value);
			delivered++;
			step = run.next(res);
		}
	} catch (e) {
		if (isCut(e)) throw e;
		return dropped("transport");
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
	let delivered = 0;
	const dropped = (detail: string): Reading => (delivered > 0 ? silent(seat, detail) : clean(seat, detail));
	try {
		step = run.next(undefined as unknown as HttpResponse);
		for (let asked = 0; !step.done; asked++) {
			if (asked >= MAX_REQUESTS) return dropped("request bound");
			const res = await send(step.value);
			delivered++;
			step = run.next(res);
		}
	} catch (e) {
		if (isCut(e)) throw e;
		return dropped("transport");
	}
	return step.value;
}
