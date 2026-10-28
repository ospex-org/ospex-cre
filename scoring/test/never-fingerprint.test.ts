// Never: "The program takes which feeds to ask, or how many must agree, from anything outside the
// fingerprint. Only the keys and the payout address come from outside, and neither can touch the
// score."
//
// Here: which feeds are asked (how many must agree is the agreement rule's, beside the readers).
// The feeds asked come from the table and nothing else: not the keys handed in, not the
// environment, not a write to the table at runtime. A key changes only its own slot in a request.
//
// The break that turns this red (index.ts, readGameSync):
//   const seats = seatsFor(game.league);
//   ->  const seats = Object.keys(keys).map(Number) as Seat[];

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COUNTING, LEAGUES, SEATS, SPARE, readGameAsync, readGameSync, seatsFor, type Keys } from "../src/index";
import { request } from "../src/readers/request";
import { TEAMS } from "../src/teams/index";
import type { Game, HttpRequest, HttpResponse, Seat } from "../src/types";
import { locate } from "./fixtures";

const OFFERED = ["mlb", "nba", "ncaab", "ncaaf", "nfl", "nhl"];
const ALL_KEYS: Keys = { 1: "k1", 2: "k2", 3: "k3", 4: "k4" };

// Two teams of the league's own lists that every seat asked by team can ask for (seat 2's list lacks
// most college football schools), so seats 1 and 2 have something to ask about, and a seat 3 hint,
// so seat 3 (read by hint) has too, like the spare.
function game(league: string): Game {
	const teams = (Object.prototype.hasOwnProperty.call(TEAMS, league) ? TEAMS[league] : []).filter((t) => t.ask[2] !== null);
	return { league, home: teams[0]?.names[0] ?? "Home", away: teams[1]?.names[0] ?? "Away", start: 1_792_000_000, n: 86_400, hints: [{ seat: 3, id: "00000000-0000-4000-8000-000000000000" }] };
}

/** A transport that refuses everything, recording which seats were asked, in order. */
function refusing(): { send: (req: HttpRequest) => HttpResponse; seats: Seat[] } {
	const seats: Seat[] = [];
	return {
		seats,
		send(req) {
			const at = locate(req);
			if (at === null) throw new Error(`request left the table's hosts: ${req.url.length} chars`);
			seats.push(at.seat);
			return { status: 503, body: "" };
		},
	};
}

function askedAndRead(league: string, keys: Keys) {
	const t = refusing();
	const r = readGameSync(game(league), keys, 1_792_000_000, t.send);
	return { offered: r.offered, readingSeats: r.readings.map((x) => x.seat), asked: t.seats };
}

describe("never: which feeds to ask comes from the table alone", () => {
	test("the table is four seats, three counting and the spare, the same in all six leagues", () => {
		expect(SEATS.map((r) => r.seat)).toEqual([1, 2, 3, 4]);
		expect([...COUNTING]).toEqual([1, 2, 3]);
		expect(SPARE).toBe(4);
		expect(Object.keys(LEAGUES).sort()).toEqual(OFFERED);
		for (const league of OFFERED) expect([...seatsFor(league)]).toEqual([1, 2, 3, 4]);
	});

	test("a league the table lacks is not offered, whatever its name", () => {
		for (const league of ["wnba", "NFL", " nfl", "", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
			expect({ league, seats: [...seatsFor(league)] }).toEqual({ league, seats: [] });
			expect({ league, ...askedAndRead(league, ALL_KEYS) }).toEqual({ league, offered: false, readingSeats: [], asked: [] });
		}
	});

	test("nothing at runtime writes to the table", () => {
		const attempts: [string, () => void][] = [
			["add a seat", () => (SEATS as unknown as object[]).push({ seat: 5 })],
			["move a host", () => ((SEATS[0] as unknown as { host: string }).host = "elsewhere.example")],
			["move a key", () => ((SEATS[3].key as unknown as { query: string }).query = "k")],
			["add a header", () => ((SEATS[1].headers as Record<string, string>)["x"] = "y")],
			["add a league", () => ((LEAGUES as Record<string, unknown>).wnba = { 1: "", 2: "", 3: "", 4: "" })],
			["change a league's code", () => ((LEAGUES.nfl as unknown as Record<number, string>)[1] = "/x")],
			["change the counting seats", () => ((COUNTING as unknown as number[])[0] = 4)],
			["drop a seat", () => (SEATS as unknown as object[]).pop()],
		];
		// A write that gets through is put back afterwards, whatever this test's result, so a table left
		// open can't change what the files run after this one see.
		const was = structuredClone({ SEATS, LEAGUES, COUNTING });
		try {
			for (const [what, attempt] of attempts) expect({ what, threw: throws(attempt) }).toEqual({ what, threw: true });
			expect(SEATS.map((r) => r.seat)).toEqual([1, 2, 3, 4]);
			expect([...COUNTING]).toEqual([1, 2, 3]);
		} finally {
			putBack({ SEATS, LEAGUES, COUNTING }, was);
		}
	});

	test("the keys decide nothing but each seat's key: every seat is read, in table order, whatever is handed in", () => {
		const cases: [string, Keys, Seat[]][] = [
			["all four", ALL_KEYS, [1, 2, 3, 4]],
			["extra seats and fields", { ...ALL_KEYS, 5: "k5", 0: "k0", ...({ seats: [1], counting: 1, host: "x" } as object) } as Keys, [1, 2, 3, 4]],
			["seat 2 missing", { 1: "k1", 3: "k3", 4: "k4" }, [1, 3, 4]],
			["only seat 4", { 4: "k4" }, [4]],
			["none", {}, []],
			["empty strings", { 1: "", 2: "", 3: "", 4: "" }, []],
			["inherited, not own", Object.create(ALL_KEYS as object) as Keys, []],
			["in reverse order", { 4: "k4", 3: "k3", 2: "k2", 1: "k1" }, [1, 2, 3, 4]],
		];
		for (const league of OFFERED) {
			for (const [what, keys, askedSeats] of cases) {
				const got = askedAndRead(league, keys);
				// Every seat reads, in table order; only seats with a key send anything.
				expect({ league, what, ...got, asked: [...new Set(got.asked)] }).toEqual({
					league,
					what,
					offered: true,
					readingSeats: [1, 2, 3, 4],
					asked: askedSeats,
				});
			}
		}
	});

	test("a seat with no key reads silent, and is never skipped", () => {
		const r = readGameSync(game("nfl"), { 1: "k1", 3: "k3", 4: "k4" }, 1_792_000_000, refusing().send);
		expect(r.readings.map((x) => [x.seat, x.kind, x.detail])).toEqual([
			[1, "silent", "http 503"],
			[2, "silent", "no key"],
			[3, "silent", "http 503"],
			[4, "silent", "http 503"],
		]);
	});

	test("the asynchronous path asks the same seats", async () => {
		for (const league of OFFERED) {
			const seen: Seat[] = [];
			const r = await readGameAsync(game(league), { 2: "k2", 4: "k4" }, 1_792_000_000, async (req) => {
				seen.push(locate(req)!.seat);
				return { status: 503, body: "" } as HttpResponse;
			});
			expect({ league, seats: r.readings.map((x) => x.seat), asked: [...new Set(seen)] }).toEqual({
				league,
				seats: [1, 2, 3, 4],
				asked: [2, 4],
			});
		}
	});

	test("the environment decides nothing", () => {
		const before = OFFERED.map((l) => askedAndRead(l, { 1: "k1", 3: "k3" }));
		const hostile: Record<string, string> = {
			OSPEX_SEATS: "4",
			OSPEX_COUNTING: "1",
			OSPEX_SPARE: "1",
			OSPEX_SEAT5_KEY: "k5",
			OSPEX_SEAT1_KEY: "k1",
			OSPEX_SEAT2_KEY: "k2",
			OSPEX_SEAT4_KEY: "k4",
			OSPEX_LEAGUES: "nfl",
			SEAT1_HOST: "elsewhere.example",
		};
		const saved: Record<string, string | undefined> = {};
		for (const [k, v] of Object.entries(hostile)) {
			saved[k] = process.env[k];
			process.env[k] = v;
		}
		try {
			const after = OFFERED.map((l) => askedAndRead(l, { 1: "k1", 3: "k3" }));
			expect(after).toEqual(before);
		} finally {
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		}
	});

	test("a key changes only its own slot in each seat's request", () => {
		for (const row of SEATS) {
			const a = request(row.seat, "/path?x=1", "KEY-A");
			const b = request(row.seat, "/path?x=1", "KEY-B");
			expect(a.url.startsWith(`https://${row.host}/path?x=1`)).toBe(true);
			if ("header" in row.key) {
				expect(b.url).toBe(a.url);
				expect({ ...a.headers, [row.key.header]: "" }).toEqual({ ...b.headers, [row.key.header]: "" });
				expect([a.headers[row.key.header], b.headers[row.key.header]]).toEqual(["KEY-A", "KEY-B"]);
			} else {
				expect(b.headers).toEqual(a.headers);
				expect(a.url.replace("KEY-A", "")).toBe(b.url.replace("KEY-B", ""));
				expect(a.url.endsWith(`&${row.key.query}=KEY-A`)).toBe(true);
			}
			for (const [k, v] of Object.entries(row.headers)) expect(a.headers[k]).toBe(v);
		}
	});
});

describe("the script's source reaches nothing outside the fingerprint on its own", () => {
	// A tripwire, beside the type check: tsconfig loads no runtime types, so `src/` cannot
	// name `process`, `fetch` or `Bun` without failing to compile.
	const forbidden = ["process.", "Bun.", "Deno.", "fetch(", "globalThis", "require(", "import(", "Date.now", "new Date(", "Math.random", "performance.", "XMLHttpRequest", "WebSocket", "eval("];

	test("no file in src/ uses any of them", () => {
		const offenders: string[] = [];
		const walk = (dir: string): void => {
			for (const name of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, name.name);
				if (name.isDirectory()) walk(p);
				else {
					const text = readFileSync(p, "utf8");
					for (const f of forbidden) if (text.includes(f)) offenders.push(`${p.slice(p.indexOf("src"))}: ${f}`);
				}
			}
		};
		walk(join(import.meta.dir, "..", "src"));
		expect(offenders).toEqual([]);
	});
});

/** Writes back whatever differs from `was`, a copy taken earlier; nothing, while nothing differs. */
function putBack(now: Record<string, unknown>, was: Record<string, unknown>): void {
	if (Array.isArray(now) && Array.isArray(was) && now.length !== was.length) now.length = was.length;
	for (const k of Object.keys(now)) if (!(k in was)) delete now[k];
	for (const [k, v] of Object.entries(was)) {
		const here = now[k];
		if (typeof v === "object" && v !== null && typeof here === "object" && here !== null) putBack(here as Record<string, unknown>, v as Record<string, unknown>);
		else if (here !== v) now[k] = v;
	}
}

function throws(f: () => void): boolean {
	try {
		f();
		return false;
	} catch {
		return true;
	}
}
