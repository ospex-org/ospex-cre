// Drives a reader's run against a transport. A transport that throws, for any reason, makes the
// feed silent: nothing a transport does can turn into a final or a "no final".

import type { HttpRequest, HttpResponse, Reading, ReaderRun, Seat } from "./types";

/** The most requests one reader may make for one game. Past it, the feed is silent. */
export const MAX_REQUESTS = 12;

export function silent(seat: Seat, detail: string): Reading {
	return { seat, kind: "silent", home: null, away: null, recorded: null, detail, record: null };
}

/** Runs a reader with a synchronous transport, as the Chainlink workflow does. */
export function runSync(seat: Seat, run: ReaderRun, send: (req: HttpRequest) => HttpResponse): Reading {
	let step: IteratorResult<HttpRequest, Reading>;
	try {
		step = run.next(undefined as unknown as HttpResponse);
		for (let asked = 0; !step.done; asked++) {
			if (asked >= MAX_REQUESTS) return silent(seat, "request bound");
			const res = send(step.value);
			step = run.next(res);
		}
	} catch {
		return silent(seat, "transport");
	}
	return step.value;
}

/** Runs a reader with an asynchronous transport, as a sealed machine's fetch would. */
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
	} catch {
		return silent(seat, "transport");
	}
	return step.value;
}
