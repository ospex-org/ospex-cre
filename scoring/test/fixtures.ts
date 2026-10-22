// Saved real answers, served back to the readers. No test reaches a feed: every request is
// answered from fixtures/, and a request with no saved answer is recorded as a miss so the test
// asking it fails instead of passing on a guess.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readerFor } from "../src/index";
import { runSync } from "../src/run";
import { SEATS } from "../src/table";
import type { Game, HttpRequest, HttpResponse, Reading, Seat } from "../src/types";

/** The key every fixture was saved under. Real keys never reach a test. */
export const KEY = "SEATKEY";

export const ROOT = join(import.meta.dir, "..", "fixtures");

export interface Entry {
	seat: Seat;
	path: string;
	status: number;
	file: string;
	sha256: string;
	bytes: number;
	capturedAt: string;
	pending?: string;
}

export const INDEX: readonly Entry[] = JSON.parse(readFileSync(join(ROOT, "index.json"), "utf8"));

const byKey = new Map(INDEX.map((e) => [`${e.seat} ${e.path}`, e]));

/** The bytes of a fixture file, exactly as saved. */
export function bytesOf(file: string): Uint8Array {
	return new Uint8Array(readFileSync(join(ROOT, file)));
}

/** Which seat a request is for, by its host, and its path. Null if it went anywhere else. */
export function locate(req: HttpRequest): { seat: Seat; path: string } | null {
	for (const row of SEATS) {
		const prefix = `https://${row.host}/`;
		if (req.url.startsWith(prefix)) return { seat: row.seat, path: req.url.slice(prefix.length - 1) };
	}
	return null;
}

export interface Saved {
	readonly send: (req: HttpRequest) => HttpResponse;
	readonly asked: HttpRequest[];
	readonly misses: string[];
}

/** Changes a saved answer's parsed body before it is served: a derived answer, never a fixture. */
export type Derive = (seat: Seat, path: string, body: unknown) => unknown;

/** A transport over the saved answers, recording what was asked and what it could not answer. */
export function saved(derive?: Derive): Saved {
	const asked: HttpRequest[] = [];
	const misses: string[] = [];
	return {
		asked,
		misses,
		send(req) {
			asked.push(req);
			const at = locate(req);
			const entry = at === null ? undefined : byKey.get(`${at.seat} ${at.path}`);
			if (at === null || entry === undefined) {
				// Seat and path only: test output names no host.
				misses.push(at === null ? "a host outside the table" : `seat ${at.seat} ${at.path}`);
				throw new Error("no saved answer");
			}
			const body = new TextDecoder().decode(bytesOf(entry.file));
			if (derive === undefined || entry.status !== 200) return { status: entry.status, body };
			return { status: entry.status, body: JSON.stringify(derive(at.seat, at.path, JSON.parse(body))) };
		},
	};
}

/** Reads one game on one seat from the saved answers; the caller's test fails on any miss. */
export function readSaved(
	seat: Seat,
	game: Game,
	now: number,
	derive?: Derive,
): { reading: Reading; asked: HttpRequest[]; misses: string[] } {
	const t = saved(derive);
	const reading = runSync(seat, readerFor(seat)({ game, now, key: KEY }), t.send);
	return { reading, asked: t.asked, misses: t.misses };
}

/** A deep copy, for derived answers. */
export function copy<T>(v: T): T {
	return JSON.parse(JSON.stringify(v));
}

/** Unix seconds for an ISO time with its zone. */
export function at(iso: string): number {
	const ms = Date.parse(iso);
	if (Number.isNaN(ms) || !/(Z|[+-]\d{2}:\d{2})$/.test(iso)) throw new Error(`bad time ${iso}`);
	return Math.floor(ms / 1000);
}
