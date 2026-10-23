// Replays one game against the saved answers and prints what each of the four seats reads. No key
// and no network: every request is answered from fixtures/ as of the clock given, the way the
// tests are served, and a request with no saved answer is listed and reads silent.
//
//   bun run replay --list                          the saved cases, with their clocks
//   bun run replay --case "nba final: Golden"      one saved case, at its own clock
//   bun run replay --game game.json --at 2026-10-23T03:32:00Z
//
// A game file holds what the chain holds for a game:
//   { "league": "nba", "home": "Philadelphia 76ers", "away": "Cleveland Cavaliers",
//     "start": "2026-10-22T23:00:00Z", "n": 86400,
//     "hints": [{ "seat": 3, "id": "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09" }] }
// with `start` an ISO time carrying its zone (or unix seconds) and `n` in seconds. --at is the
// run's clock, an ISO time with its zone.

import { readFileSync } from "node:fs";
import { readerFor } from "./src/index";
import { runSync } from "./src/run";
import type { Game, Seat } from "./src/types";
import { CASES } from "./test/cases";
import { KEY, at, saved } from "./test/fixtures";

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i < 0 ? undefined : process.argv[i + 1];
}

function iso(seconds: number): string {
	return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

function gameFrom(file: string): Game {
	const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	const start = typeof raw.start === "number" ? raw.start : at(String(raw.start));
	const hints = Array.isArray(raw.hints) ? (raw.hints as { seat: number; id: string }[]) : [];
	for (const k of ["league", "home", "away"]) if (typeof raw[k] !== "string") throw new Error(`the game needs "${k}"`);
	if (typeof raw.n !== "number") throw new Error('the game needs "n", in seconds');
	return { league: raw.league as string, home: raw.home as string, away: raw.away as string, start, n: raw.n, hints };
}

/** The replay's lines for one game at one clock: a heading, then one line per seat. */
export function replay(game: Game, clock: number): string[] {
	const lines = [`${game.away} at ${game.home} (${game.league}), window ${iso(game.start)} + ${game.n} s, read as of ${iso(clock)}`];
	for (const seat of [1, 2, 3, 4] as Seat[]) {
		const t = saved(undefined, clock);
		const r = runSync(seat, readerFor(seat)({ game, now: clock, key: KEY }), t.send);
		const points = r.home === null && r.away === null ? "" : ` ${r.home}-${r.away} (home-away)`;
		const record = r.record === null ? "" : `, record ${r.record.id}${r.record.time === null ? "" : ` at ${iso(r.record.time)}`}`;
		lines.push(`  seat ${seat}: ${r.kind}${points}, ${r.detail}${record}; ${t.asked.length} request${t.asked.length === 1 ? "" : "s"}`);
		for (const m of t.misses) lines.push(`    no saved answer: ${m}`);
	}
	return lines;
}

if (import.meta.main) {
	if (process.argv.includes("--list")) {
		for (const c of CASES) console.log(`${iso(c.now)}  ${c.name}`);
	} else if (arg("--case") !== undefined) {
		const want = arg("--case")!;
		const found = CASES.filter((c) => c.name.startsWith(want));
		if (found.length !== 1) throw new Error(`${found.length} cases start with "${want}"; --list shows them`);
		console.log(replay(found[0].game, found[0].now).join("\n"));
	} else if (arg("--game") !== undefined && arg("--at") !== undefined) {
		console.log(replay(gameFrom(arg("--game")!), at(arg("--at")!)).join("\n"));
	} else {
		console.log('usage: bun run replay --list | --case "<name>" | --game <game.json> --at <ISO time with zone>');
		process.exit(2);
	}
}
