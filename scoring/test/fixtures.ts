// Saved real answers, served back to the readers. No test reaches a feed: every request is
// answered from fixtures/, and a request with no saved answer is recorded as a miss so the test
// asking it fails instead of passing on a guess.
//
// The readers ask for one game at a time (seats 1 and 2 by team, seat 3's board and the spare by its
// id). Where the feed's own answer to such a request is saved (the capture's one-game answers), it is
// served as any saved answer is, as of the clock. Where none is, the request is answered from the slate
// pages it would be drawn from, filtered the way the feed filters (seat 1 to the two teams' ids, seat 2
// to the team's name, the board and the spare to the id), so a reader's parsing and the pick run on the
// feed's real records at the clock a test reads at; fixtures.test.ts holds that filter to the feed's
// own answers wherever both exist. A date whose slate page is not saved is a miss, as any unsaved
// answer is.

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
}

export const INDEX: readonly Entry[] = JSON.parse(readFileSync(join(ROOT, "index.json"), "utf8"));

/** Every saved answer for a request, oldest first: a path asked before and after a game ends has two. */
const byKey = new Map<string, Entry[]>();
for (const e of [...INDEX].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))) {
	const k = `${e.seat} ${e.path}`;
	if (!byKey.has(k)) byKey.set(k, []);
	byKey.get(k)!.push(e);
}

/**
 * What the feed said for a request as of a moment: the latest answer captured at or before it, to
 * the whole second, so a clock written as a capture's own second (at()) includes that capture.
 */
function answerAsOf(seat: Seat, path: string, asOf: number): Entry | undefined {
	const all = byKey.get(`${seat} ${path}`) ?? [];
	return all.filter((e) => Math.floor(Date.parse(e.capturedAt) / 1000) <= asOf).at(-1);
}

/** Past this a clock is milliseconds, not seconds: unix seconds reach it in the year 5138. */
const SECONDS_CEILING = 1e11;

/** The slate pages a one-game request is answered from, and the feed's filter over them. */
export interface OneGame {
	/** The first page for each date asked. */
	readonly firsts: readonly string[];
	/** The next page after one, from its path and its body, or null when it was the last. */
	readonly next: (path: string, body: unknown) => string | null;
	/** The pages, filtered to the game asked for, as one answer. */
	readonly filter: (pages: readonly unknown[]) => unknown;
}

const rows = (v: unknown, key: string): Record<string, unknown>[] => {
	const list = (v as Record<string, unknown> | null)?.[key];
	return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
};

/** The calendar dates from `from` to `to`, both in. */
function datesFromTo(from: string, to: string): string[] {
	const day = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
	const out: string[] = [];
	for (let n = day(from); n <= day(to); n++) out.push(new Date(n * 86_400_000).toISOString().slice(0, 10));
	return out;
}

/**
 * One answer is one moment: a record that two of the pages it is drawn from both carry (a game filed
 * under two dates, asked for at two moments) is the later page's copy, once. Two copies on one page
 * stay two, as the feed sent them.
 */
function latestOnce(pages: readonly unknown[], key: string, idOf: (g: Record<string, unknown>) => string): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	for (const page of pages) {
		const here = rows(page, key);
		const ids = new Set(here.map(idOf));
		const kept = out.filter((g) => !ids.has(idOf(g)));
		out.splice(0, out.length, ...kept, ...here);
	}
	return out;
}

/** How a one-game request is answered from the slate pages, or null for a request served as saved. */
export function oneGameOf(seat: Seat, path: string): OneGame | null {
	const at = path.indexOf("?");
	const base = at < 0 ? path : path.slice(0, at);
	const q = new URLSearchParams(at < 0 ? "" : path.slice(at + 1));
	if (seat === 1 && q.has("team_ids[]")) {
		const ids = new Set(q.getAll("team_ids[]"));
		const dates = q.getAll("dates[]");
		return {
			// A derived answer is one page, so a cursor asked on it has no page behind it.
			firsts: q.has("cursor") ? [] : dates.map((d) => `${base}?dates[]=${d}&per_page=100`),
			next: (p, body) => {
				const c = (rows(body, "data"), (body as { meta?: { next_cursor?: unknown } } | null)?.meta?.next_cursor);
				return typeof c === "number" || (typeof c === "string" && c !== "") ? `${p.replace(/&cursor=.*$/, "")}&cursor=${c}` : null;
			},
			filter: (pages) => ({
				data: latestOnce(pages, "data", (g) => String(g.id)).filter((g) => [g.home_team, g.visitor_team, g.away_team].some((t) => ids.has(String((t as { id?: unknown } | undefined)?.id)))),
				meta: { per_page: 100 },
			}),
		};
	}
	if (seat === 2 && q.has("team")) {
		const team = q.get("team") as string;
		const [from, to = from] = (q.get("date") ?? "").split(",");
		const league = q.get("league") ?? "";
		return {
			firsts: q.has("skip") ? [] : datesFromTo(from, to).map((d) => `/games?league=${encodeURIComponent(league)}&date=${d}`),
			next: (p, body) => {
				if (rows(body, "results").length < 100) return null;
				const skip = Number(/&skip=(\d+)$/.exec(p)?.[1] ?? 0) + 100;
				return `${p.replace(/&skip=\d+$/, "")}&skip=${skip}`;
			},
			filter: (pages) => {
				const results = latestOnce(pages, "results", (g) => String(g.gameId)).filter((g) => {
					const t = g.teams as { home?: { team?: unknown }; away?: { team?: unknown } } | undefined;
					return t?.home?.team === team || t?.away?.team === team;
				});
				return { status: 200, time: (pages[0] as { time?: unknown } | undefined)?.time ?? null, games: results.length, skip: 0, results };
			},
		};
	}
	if (seat === 3 && path.startsWith("POST /odds/bygames ")) {
		// The board's row for an id: drawn from the league's saved board, filtered to the ids asked.
		const body = JSON.parse(path.slice("POST /odds/bygames ".length)) as { GameIDs?: unknown; Sport?: unknown };
		const ids = new Set((Array.isArray(body.GameIDs) ? body.GameIDs : []).map((x) => String(x).toLowerCase()));
		return {
			firsts: [`/odds/${encodeURIComponent(String(body.Sport ?? ""))}?oddType=Game`],
			next: () => null,
			filter: (pages) => (Array.isArray(pages[0]) ? (pages[0] as { ID?: unknown }[]).filter((r) => ids.has(String(r.ID).toLowerCase())) : pages[0]),
		};
	}
	if (seat === 4 && q.has("eventIds")) {
		const id = (q.get("eventIds") as string).toLowerCase();
		return {
			firsts: [path.replace(/&eventIds=[^&]*/, "")],
			next: () => null,
			filter: (pages) => (Array.isArray(pages[0]) ? (pages[0] as { id?: unknown }[]).filter((e) => String(e.id).toLowerCase() === id) : pages[0]),
		};
	}
	return null;
}

/** The bytes of a fixture file, exactly as saved. */
export function bytesOf(file: string): Uint8Array {
	return new Uint8Array(readFileSync(join(ROOT, file)));
}

/**
 * Which seat a request is for, by its host, and its path: for a POST, the method, the path and the body
 * as one key, the form the index saves such an answer under. Null if it went anywhere else.
 */
export function locate(req: HttpRequest): { seat: Seat; path: string } | null {
	for (const row of SEATS) {
		const prefix = `https://${row.host}/`;
		if (req.url.startsWith(prefix)) {
			const path = req.url.slice(prefix.length - 1);
			return { seat: row.seat, path: req.method === "GET" ? path : `${req.method} ${path} ${req.body ?? ""}` };
		}
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

/**
 * A transport over the saved answers as of `asOf` (unix seconds), recording what was asked and
 * what it could not answer. The clock is required: a request asked before and after a game ends
 * has two answers, and a test must say which moment it reads. Tests are not type-checked, so a
 * missing clock is refused here rather than read as some default moment, and so is a clock in
 * milliseconds, which would read as after every capture. Any other number is a clock, an
 * unreadable one included (NaN, either infinity): a test of a program that must refuse such a
 * clock hands the same one to its transport.
 */
export function saved(derive: Derive | undefined, asOf: number): Saved {
	if (typeof asOf !== "number") throw new Error("saved: the clock is required");
	if (Number.isFinite(asOf) && asOf > SECONDS_CEILING) throw new Error("saved: the clock is in milliseconds; give unix seconds");
	const asked: HttpRequest[] = [];
	const misses: string[] = [];
	return {
		asked,
		misses,
		send(req) {
			asked.push(req);
			const at = locate(req);
			if (at === null) {
				misses.push("a host outside the table");
				throw new Error("no saved answer");
			}
			// Seat and path only: test output names no host.
			const miss = (what: string): never => {
				misses.push(what);
				throw new Error("no saved answer");
			};
			const served = (path: string): { entry: Entry; body: string } => {
				const entry = answerAsOf(at.seat, path, asOf);
				if (entry === undefined) return miss(path === at.path ? `seat ${at.seat} ${at.path}` : `seat ${at.seat} ${at.path} (no saved page ${path})`);
				return { entry, body: new TextDecoder().decode(bytesOf(entry.file)) };
			};
			// An answer saved for the request itself, as of the clock, comes first: the capture's own answers to
			// the one-game requests. Short of one, a one-game request is drawn from the slate pages.
			const one = answerAsOf(at.seat, at.path, asOf) === undefined ? oneGameOf(at.seat, at.path) : null;
			if (one === null) {
				const { entry, body } = served(at.path);
				if (derive === undefined || entry.status !== 200) return { status: entry.status, body };
				return { status: entry.status, body: JSON.stringify(derive(at.seat, at.path, JSON.parse(body))) };
			}
			return fromPages(one, (path) => {
				const { entry, body } = served(path);
				return { status: entry.status, body: entry.status !== 200 || derive === undefined ? body : JSON.stringify(derive(at.seat, path, JSON.parse(body))) };
			});
		},
	};
}

/**
 * One game's answer from the slate pages it is drawn from: each page as `page` serves it (saved, and as a
 * test derives it), then the filter. A page the feed refused is the answer, as the feed would refuse the
 * one-game request too.
 */
export function fromPages(one: OneGame, page: (path: string) => HttpResponse): HttpResponse {
	const pages: unknown[] = [];
	for (const first of one.firsts) {
		let path: string | null = first;
		while (path !== null) {
			const res = page(path);
			if (res.status !== 200) return res;
			const parsed: unknown = JSON.parse(res.body);
			pages.push(parsed);
			path = one.next(path, parsed);
		}
	}
	return { status: 200, body: JSON.stringify(one.filter(pages)) };
}

/** Reads one game on one seat from the saved answers; the caller's test fails on any miss. */
export function readSaved(
	seat: Seat,
	game: Game,
	now: number,
	derive?: Derive,
): { reading: Reading; asked: HttpRequest[]; misses: string[] } {
	const t = saved(derive, now);
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
