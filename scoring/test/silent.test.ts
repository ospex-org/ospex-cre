// Silent means the feed could not answer about this game. Each way a reader gets there, and the
// control beside it that still answers. Nothing silent is ever turned into "no final".

import { describe, expect, test } from "bun:test";
import { readerFor } from "../src/index";
import { Cut, MAX_REQUESTS, isCut, runAsync, runSync } from "../src/run";
import type { Game, HttpRequest, HttpResponse, Seat } from "../src/types";
import { CASES, NOW } from "./cases";
import { KEY, copy, readSaved, saved, type Derive } from "./fixtures";

const byName = (prefix: string) => CASES.find((c) => c.name.startsWith(prefix))!;
const lakers = byName("nba final");
const sixers = byName("nba not final"); // has a seat 3 hint, so seat 3 asks
const SEATS: Seat[] = [1, 2, 3, 4];
/** A real game every seat asks about: seat 3 reads by hint, the others by team and window. */
const gameFor = (seat: Seat): Game => (seat === 3 ? sixers.game : lakers.game);

function readWith(seat: Seat, game: Game, send: (req: HttpRequest) => HttpResponse) {
	return runSync(seat, readerFor(seat)({ game, now: NOW, key: KEY }), send);
}

function detailOf(seat: Seat, game: Game, derive?: Derive) {
	const { reading, misses } = readSaved(seat, game, NOW, derive);
	expect(misses).toEqual([]);
	return { kind: reading.kind, detail: reading.detail };
}

describe("silent", () => {
	test("a refused, failed or unreadable answer", () => {
		for (const seat of SEATS) {
			for (const [status, body, detail] of [
				[401, "Unauthorized", "http 401"],
				[429, "{}", "http 429"],
				[500, "", "http 500"],
				[200, "<html>busy</html>", "unreadable"],
				[200, "", "empty body"],
				[200, "null", "unreadable"],
				[200, '"a string"', "unreadable"],
			] as const) {
				const r = readWith(seat, gameFor(seat), () => ({ status, body }));
				expect({ seat, status, body, kind: r.kind, detail: r.detail }).toEqual({ seat, status, body, kind: "silent", detail });
			}
		}
	});

	test("a transport that throws, or whose promise rejects, makes the seat silent", async () => {
		for (const seat of SEATS) {
			expect(readWith(seat, gameFor(seat), () => { throw new Error("boom"); })).toMatchObject({ kind: "silent", detail: "transport" });
			const r = await runAsync(seat, readerFor(seat)({ game: gameFor(seat), now: NOW, key: KEY }), async () => { throw new Error("boom"); });
			expect(r).toMatchObject({ kind: "silent", detail: "transport" });
		}
	});

	test("a cut is never silence: a transport whose own count is used up is raised by the reader, at every seat, sync and async", async () => {
		for (const seat of SEATS) {
			expect(() => readWith(seat, gameFor(seat), () => { throw new Cut("the run's 15 requests are used"); })).toThrow(Cut);
			// Any error carrying `cut: true` is a cut too; a plain error with any other word is silence (above).
			expect(() => readWith(seat, gameFor(seat), () => { throw Object.assign(new Error("used up"), { cut: true }); })).toThrow("used up");
			expect(runAsync(seat, readerFor(seat)({ game: gameFor(seat), now: NOW, key: KEY }), async () => { throw new Cut("cut"); })).rejects.toThrow(Cut);
		}
		expect(isCut(new Cut("x"))).toBe(true);
		expect([isCut(new Error("x")), isCut(null), isCut("cut")]).toEqual([false, false, false]);
	});

	test("an answer of the wrong shape, or a record the reader cannot read", () => {
		for (const seat of SEATS) {
			const r = readWith(seat, gameFor(seat), () => ({ status: 200, body: JSON.stringify({ unexpected: true }) }));
			expect({ seat, kind: r.kind, detail: r.detail }).toEqual({ seat, kind: "silent", detail: "unreadable" });
		}
		// Every record's id gone, so the game's own (whichever the one-game answer draws) is unreadable.
		const badRecord: Derive = (seat, _p, body) => {
			const b = copy(body) as Record<string, unknown> | unknown[];
			if (seat === 1) for (const g of (b as { data: Record<string, unknown>[] }).data) g.id = null;
			if (seat === 2) for (const g of (b as { results: Record<string, unknown>[] }).results) g.gameId = null;
			if (seat === 4) ((b as unknown[])[0] as Record<string, unknown>).id = null;
			if (seat === 3) (b as unknown[])[0] = 5;
			return b;
		};
		// The refusal carries the game's own row's word where that row parsed: at the spare the bad row is
		// another game's, and the game's own row says completed.
		for (const seat of SEATS) {
			expect({ seat, ...detailOf(seat, gameFor(seat), badRecord) }).toEqual({ seat, kind: "silent", detail: seat === 4 ? 'unreadable record; the game\'s row says "completed"' : "unreadable record" });
		}
	});

	test("more requests than the bound: a feed that pages for ever", () => {
		const iowa = byName("ncaab not final").game;
		const full = (n: number) => JSON.stringify({ status: 200, results: Array.from({ length: 100 }, (_, i) => ({ gameId: n * 1000 + i, status: "scheduled", teams: {} })) });
		let asked = 0;
		// The test's own stop, far past the bound: a reader with no bound fails here, at "transport",
		// instead of paging until the suite is killed.
		const STOP = 100;
		const r = readWith(2, iowa, () => {
			if (asked >= STOP) throw new Error("the test's own stop");
			return { status: 200, body: full(asked++) };
		});
		expect(r).toMatchObject({ kind: "silent", detail: "request bound" });
		expect(asked).toBe(MAX_REQUESTS);
		// The control: a game on the second page of the real 2 Nov slate is in the teams' own answer, drawn
		// from both pages, in one request per team and no page past the first.
		const page2 = readSaved(2, { ...iowa, home: "Nebraska", away: "Le Moyne", start: Date.UTC(2026, 10, 3, 0, 30) / 1000, n: 23 * 3600 }, NOW);
		expect(page2.misses).toEqual([]);
		expect([page2.asked.length, page2.asked.some((q) => q.url.includes("skip="))]).toEqual([2, false]);
		expect(page2.reading).toMatchObject({ kind: "no_final", detail: "scheduled", record: { id: "342256" } });
	});

	test("seat 4 past what it keeps", () => {
		// Seat 3 has no such bound: it is read by id, and an id it no longer keeps answers [] and
		// reads silent (see hints.test.ts).
		const old = { ...lakers.game, start: NOW - 5 * 86400 };
		const t = saved(undefined, NOW);
		const r = readWith(4, old, t.send);
		expect({ kind: r.kind, detail: r.detail, asked: t.asked.length }).toEqual({ kind: "silent", detail: "past retention", asked: 0 });
		// The control: inside what it keeps, it asks.
		expect(readSaved(4, lakers.game, NOW).asked.length).toBeGreaterThan(0);
	});

	test("seat 4 with a clock that isn't a number: silent, and nothing asked", () => {
		for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			const t = saved(undefined, now);
			const r = runSync(4, readerFor(4)({ game: lakers.game, now, key: KEY }), t.send);
			expect({ now, kind: r.kind, detail: r.detail, asked: t.asked.length }).toEqual({ now, kind: "silent", detail: "no clock", asked: 0 });
		}
	});

	test("a record with no game time the window can hold it to", () => {
		const iowa = byName("ncaab not final").game;
		const tba: Derive = (seat, _p, body) => {
			const b = copy(body) as { results: Record<string, unknown>[] };
			for (const g of b.results) if (g.gameId === 341752) (g.schedule as Record<string, unknown>).tbaTime = true;
			return b;
		};
		expect(detailOf(2, iowa, tba)).toEqual({ kind: "silent", detail: "no game time" });
		expect(detailOf(2, iowa)).toEqual({ kind: "no_final", detail: "scheduled" });
	});

	test("two records of the game at the same time, under two ids", () => {
		const twice: Derive = (seat, _p, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results: Record<string, unknown>[] };
			const g = b.results.find((x) => x.gameId === 340490);
			if (g) b.results.push({ ...g, gameId: 999_999 });
			return b;
		};
		expect(detailOf(2, lakers.game, twice)).toEqual({ kind: "silent", detail: "ambiguous" });
	});

	test("one record listed twice: identical is one record, different is silent", () => {
		const same: Derive = (seat, _p, body) => {
			const b = copy(body) as { results: Record<string, unknown>[] };
			const g = b.results.find((x) => x.gameId === 340490);
			if (g) b.results.push(copy(g));
			return b;
		};
		expect(detailOf(2, lakers.game, same)).toEqual({ kind: "final", detail: "final" });
		const differs: Derive = (seat, _p, body) => {
			const b = copy(body) as { results: Record<string, unknown>[] };
			const g = b.results.find((x) => x.gameId === 340490);
			if (g) {
				const other = copy(g);
				((other.scoreboard as Record<string, unknown>).score as Record<string, unknown>).home = 126;
				b.results.push(other);
			}
			return b;
		};
		expect(detailOf(2, lakers.game, differs)).toEqual({ kind: "silent", detail: "inconsistent records" });
	});

	test("a final without points", () => {
		const noPoints: Derive = (seat, _p, body) => {
			const b = copy(body) as { results: Record<string, unknown>[] };
			const g = b.results.find((x) => x.gameId === 340490);
			if (g) delete (g.scoreboard as Record<string, unknown>).score;
			return b;
		};
		expect(detailOf(2, lakers.game, noPoints)).toEqual({ kind: "silent", detail: "final without points" });
	});

	test("a record whose team name the program does not know, which could be the game, keeps the feed from saying absent", () => {
		const renamed: Derive = (seat, _p, body) => {
			const b = copy(body) as { results: Record<string, unknown>[] };
			const g = b.results.find((x) => x.gameId === 340490);
			if (g) ((g.teams as Record<string, Record<string, unknown>>).away).team = "Golden St. Warriorz";
			return b;
		};
		expect(detailOf(2, lakers.game, renamed)).toEqual({ kind: "silent", detail: "unresolved team names" });
		// The control: a game whose teams are known to the program and absent from the answer: silence too, with its own reason.
		expect(detailOf(2, { ...lakers.game, away: "Boston Celtics" })).toEqual({ kind: "silent", detail: "absent" });
	});
});
