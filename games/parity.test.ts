// The pages and the hour. A five-minute schedule has twelve ticks an hour, so a shard whose other
// pages share a factor with twelve would meet the hour's ticks on the same pages for ever if those
// ticks turned the pages by the tick's count: the verification would never see some games, and the
// hour's reads others. Each class of work turns the pages by its own count (tick.ts, pageTurnsOf), and
// the bound is that a class reaches every page of its shard within own - 1 of its own ticks: hours for
// the hour's classes, ticks for the rest. Run here on a stable list of 500 games, eight pages of 64 on
// three shards (shard 0 owns pages 0, 3 and 6, shard 1 pages 1, 4 and 7, shard 2 pages 2 and 5, so own
// is 3 at most and the bound is two own ticks), over 48 hours of ticks, so a later exclusion would show.
//
// The break that turns it red (tick.ts, pageTurnsOf): the hour's ticks turning by the tick's count,
//   ->  return [tick];
// with which 64 games of shard 0's page 6 are never reached by the verification.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import type { Outcome } from "../scoring/src/program";
import { NOW } from "../scoring/test/cases";
import { KEY } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { EXPECTED_DURATION, HOURLY_TICK, keysFor } from "./lib";
import { GAMES, fakeChainOf, recordingWriter } from "./test-helpers";
import { runTick, tickOfHour, type TickResult } from "./tick";

const KEYS = keysFor({ 4: KEY });
const PERIOD = 300;
const BASE = chainOf("nba final, read after the game");
const NFL = chainOf("nfl not final");
const DURATION = EXPECTED_DURATION.nba;
const COUNT = 500;
const SHARDS = 3;
const HOURS = 48;
/** The hour mark after the saved cases' first clock: the run starts on the hour's first tick. */
const FROM = NOW - (NOW % 3_600) + 3_600;

const hintOf = (i: number): string => `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const verified = (i: number, start: number): ChainGame => ({ ...BASE, id: String(i), hints: [{ seat: 3, id: hintOf(i) }], start });
const unverified = (i: number, date: number): ChainGame => ({ ...NFL, id: String(i), status: "unverified", start: null, startReadings: null, dispute: null, date });

/** A program stand-in that waits on every game it is handed, recording it, so the list never changes. */
function waiter(): { score: (game: ChainGame) => Outcome; handed: string[] } {
	const handed: string[] = [];
	return { handed, score: (game) => (handed.push(game.id), { decision: { action: "wait", readings: [], why: "a stand-in waits" }, report: null }) };
}

interface Work {
	readonly name: string;
	readonly games: ChainGame[];
	/** The class's own ticks, by the tick of the hour. */
	readonly own: (tickOfHour: number) => boolean;
	/** The waiting lines that say the tick decided on the game, for this class. */
	readonly marks: readonly string[];
	/** The probes' class is about which rows a tick sees, not the probes: with no request to spend, every due game is on the waiting list, cheaply. */
	readonly requestsLimit?: number;
}

const WORK: readonly Work[] = [
	{ name: "the verification, on the hour's first tick", games: Array.from({ length: COUNT }, (_, i) => unverified(i + 1, FROM + 3 * 86_400)), own: (t) => t === 0, marks: ["verification waits"] },
	{ name: "the hour's reads, on its second tick", games: Array.from({ length: COUNT }, (_, i) => verified(i + 1, FROM - 3 * 86_400)), own: (t) => t === HOURLY_TICK, marks: ["hour 24 waits"] },
	{ name: "the probes, on every tick", games: Array.from({ length: COUNT }, (_, i) => verified(i + 1, FROM - DURATION - 3 * 3_600)), own: () => true, marks: ["for its probe", "final at seat 3 waits"], requestsLimit: 0 },
];

/** The games a tick decided on for a class: handed to the program, probed, or on the waiting list under the class's marks. */
function reached(result: TickResult, handed: readonly string[], marks: readonly string[]): string[] {
	return handed.concat(result.probes.map((p) => p.gameId), result.waiting.filter((w) => marks.some((m) => w.includes(m))).map((w) => w.split(":")[0]));
}

describe("every class of work reaches every page of its shard within own - 1 of its own ticks", () => {
	for (const work of WORK) {
		test(`${work.name}: a stable 500-game list on three shards, 48 hours, no game unreached, each within two own ticks`, () => {
			const firstReach = new Map<string, number>();
			for (let shard = 0; shard < SHARDS; shard++) {
				let now = FROM + 10;
				const chain = fakeChainOf(work.games, now, { clock: () => now });
				let own = 0;
				for (let i = 0; i < (HOURS * 3_600) / PERIOD; i++) {
					now = FROM + i * PERIOD + 10;
					if (!work.own(tickOfHour(now, PERIOD))) continue;
					own++;
					const program = waiter();
					const result = runTick({
						evm: chain,
						games: GAMES,
						payout: PAYOUT,
						keys: KEYS,
						send: () => ({ status: 200, body: "[]" }),
						write: recordingWriter().write,
						score: program.score as never,
						period: PERIOD,
						shard: { index: shard, count: SHARDS },
						requestsLimit: work.requestsLimit,
					});
					expect(result.open).toBe(COUNT);
					for (const id of reached(result, program.handed, work.marks)) if (!firstReach.has(id)) firstReach.set(id, own);
				}
			}
			const unreached = work.games.map((g) => g.id).filter((id) => !firstReach.has(id));
			expect(unreached).toEqual([]);
			// The bound: own - 1 = 2 of the class's own ticks (one, when the first hour's turn names the farther page).
			const latest = Math.max(...firstReach.values());
			expect({ within: latest <= 2, latest }).toEqual({ within: true, latest });
		}, 60_000);
	}
});
