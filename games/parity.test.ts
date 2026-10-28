// The page follows the game, never the game the page. Each class of work has its own count, and the
// count names a place on the shard's walk over its rows (chain.ts, placeNamed): the tick reads the page
// that holds the place, and the class begins its turn at the game there. The bound: every game on the
// shard that is due for a class enters the program within own x 64 of the class's own ticks, own the
// shard's pages of 64 rows. A turn begun at the game the count names in the due list instead, the page
// turning by the same count, shares a factor with the pages and names some games never.
//
// Proved here by program entries on a stable list of 500 games, eight pages of 64 on three shards
// (shard 0 owns pages 0, 3 and 6, shard 1 pages 1, 4 and 7, the last of 52 rows, shard 2 pages 2 and
// 5: own is 3, 3 and 2, the bound 192, 192 and 128 own ticks), for each class over its own ticks: the verification on the
// hour's first tick, the hour's reads on its second, the probes on the hour's other ten ticks (each
// probed on its count and read in full on its final). A stand-in program waits on every game, so the
// list never changes and an entry is the program being handed the game. Beside the entries, the page
// bound: every page of the shard is read within own of the class's own ticks. Then the six-row
// reproduction: six rows in pages of two on one shard, every game verified within six hours and every
// clock read within six.
//
// The break that turns it red (tick.ts, inTurn): the head's move to the front dropped,
//   ->  return turned;
// with which the turn begins at the game the count names in the due list, and 58 of the 500 never
// enter the verification.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import type { Outcome } from "../scoring/src/program";
import type { HttpRequest, HttpResponse } from "../scoring/src/types";
import { NOW } from "../scoring/test/cases";
import { KEY } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { EXPECTED_DURATION, HOURLY_TICK, OPEN_PAGE, keysFor } from "./lib";
import { GAMES, fakeChainOf, recordingWriter, type FakeChain } from "./test-helpers";
import { runTick, tickOfHour } from "./tick";

const KEYS = keysFor({ 4: KEY });
const PERIOD = 300;
const PER_HOUR = 3_600 / PERIOD;
const BASE = chainOf("nba final, read after the game");
const NFL = chainOf("nfl not final");
const DURATION = EXPECTED_DURATION.nba;
const COUNT = 500;
const SHARDS = 3;
/** The hour mark after the saved cases' first clock: the run starts on the hour's first tick. */
const FROM = NOW - (NOW % 3_600) + 3_600;

const hintOf = (i: number): string => `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const verified = (i: number, start: number, n = BASE.n): ChainGame => ({ ...BASE, id: String(i), hints: [{ seat: 3, id: hintOf(i) }], start, n });
const unverified = (i: number, date: number): ChainGame => ({ ...NFL, id: String(i), status: "unverified", start: null, startReadings: null, dispute: null, date });

/** A program stand-in that waits on every game it is handed, recording it, so the list never changes. */
function waiter(): { score: (game: ChainGame) => Outcome; handed: string[] } {
	const handed: string[] = [];
	return { handed, score: (game) => (handed.push(game.id), { decision: { action: "wait", readings: [], why: "a stand-in waits" }, report: null }) };
}

/** A feed that answers seat 3's result by hint, final, and nothing else. */
const finalAt3 = (req: HttpRequest): HttpResponse => {
	const m = /\/results\/([0-9a-f-]+)$/.exec(req.url);
	if (m === null) throw new Error("not seat 3's result");
	return { status: 200, body: JSON.stringify([{ ID: m[1], EventID: m[1], OddType: "Game", Final: true, FinalType: "Finished", HomeScore: 114, AwayScore: 106 }]) };
};

interface Work {
	readonly name: string;
	readonly games: ChainGame[];
	/** The class's own ticks, by the tick of the hour. */
	readonly own: (tickOfHour: number) => boolean;
	readonly send: (req: HttpRequest) => HttpResponse;
}

const WORK: readonly Work[] = [
	{ name: "the verification, on the hour's first tick", games: Array.from({ length: COUNT }, (_, i) => unverified(i + 1, FROM + 3 * 86_400)), own: (t) => t === 0, send: () => ({ status: 200, body: "[]" }) },
	{ name: "the hour's reads, on its second tick", games: Array.from({ length: COUNT }, (_, i) => verified(i + 1, FROM - 3 * 86_400)), own: (t) => t === HOURLY_TICK, send: () => ({ status: 200, body: "[]" }) },
	// Past the start plus the league's duration, with a window of three days so the probe stays due.
	{ name: "the probes, on the hour's other ticks", games: Array.from({ length: COUNT }, (_, i) => verified(i + 1, FROM - DURATION - 600, 3 * 86_400)), own: (t) => t > HOURLY_TICK, send: finalAt3 },
];

/** The shard's pages read on a tick, from the fake chain's calls since the last mark. */
function pagesRead(chain: FakeChain, shard: number, pageSize: number): number[] {
	return chain.calls.filter((c) => c.name === "getOpenGames").map((c) => (Number(c.args[0]) / pageSize - shard) / SHARDS);
}

/** Runs a class over its own ticks on one shard until `ownTicks` of them have run; the first own tick each game entered, and each page was read. */
function run(work: Work, shard: number, ownTicks: number, pageSize: number): { entered: Map<string, number>; pages: Map<number, number>; own: number } {
	const entered = new Map<string, number>();
	const pages = new Map<number, number>();
	let now = FROM;
	const chain = fakeChainOf(work.games, now, { clock: () => now });
	let own = 0;
	let ownPages = 0;
	for (let i = 0; own < ownTicks; i++) {
		now = FROM + i * PERIOD + 10;
		if (!work.own(tickOfHour(now, PERIOD))) continue;
		own++;
		chain.calls.length = 0;
		const program = waiter();
		const result = runTick({
			evm: chain,
			games: GAMES,
			payout: PAYOUT,
			keys: KEYS,
			send: work.send,
			write: recordingWriter().write,
			score: program.score as never,
			period: PERIOD,
			shard: { index: shard, count: SHARDS },
			pageSize,
		});
		expect(result.open).toBe(work.games.length);
		ownPages = result.pages.own;
		for (const id of program.handed) if (!entered.has(id)) entered.set(id, own);
		for (const p of pagesRead(chain, shard, pageSize)) if (!pages.has(p)) pages.set(p, own);
	}
	return { entered, pages, own: ownPages };
}

describe("every game enters the program within own x 64 of its class's own ticks", () => {
	for (const work of WORK) {
		test(`${work.name}: a stable 500-game list on three shards, every game entered within the bound, every page read within own`, () => {
			const unentered: string[] = [];
			const latest: number[] = [];
			const pagesLate: number[] = [];
			for (let shard = 0; shard < SHARDS; shard++) {
				const own = shard < 2 ? 3 : 2;
				const bound = own * OPEN_PAGE;
				const r = run(work, shard, bound, OPEN_PAGE);
				expect(r.own).toBe(own);
				// The shard's games: page m of the shard is page shard + 3m of the list.
				const mine = work.games.filter((_, i) => Math.floor(i / OPEN_PAGE) % SHARDS === shard).map((g) => g.id);
				expect(mine.length).toBe([192, 180, 128][shard]);
				unentered.push(...mine.filter((id) => !r.entered.has(id)));
				latest.push(Math.max(...mine.map((id) => r.entered.get(id) ?? Number.POSITIVE_INFINITY)));
				for (let m = 0; m < own; m++) pagesLate.push(r.pages.get(m) ?? Number.POSITIVE_INFINITY);
			}
			expect(unentered).toEqual([]);
			expect({ bounds: [192, 192, 128], within: latest.map((l, s) => l <= [192, 192, 128][s]), latest }).toEqual({ bounds: [192, 192, 128], within: [true, true, true], latest });
			expect({ pagesWithinOwn: pagesLate.every((p) => p <= 3), pagesLate }).toEqual({ pagesWithinOwn: true, pagesLate });
		}, 120_000);
	}
});

describe("the six-row reproduction: pages of two on one shard, every row named within six", () => {
	const tick = (games: ChainGame[], now: number, program: ReturnType<typeof waiter>) =>
		runTick({ evm: fakeChainOf(games, now), games: GAMES, payout: PAYOUT, keys: KEYS, send: () => ({ status: 200, body: "[]" }), write: recordingWriter().write, score: program.score as never, period: PERIOD, shard: { index: 0, count: 1 }, pageSize: 2 });

	test("six unverified games: each verified on one of six hours", () => {
		const games = Array.from({ length: 6 }, (_, i) => unverified(i + 1, FROM + 3 * 86_400));
		const handed: string[] = [];
		for (let h = 0; h < 6; h++) {
			const program = waiter();
			const r = tick(games, FROM + h * 3_600 + 10, program);
			expect([r.pages.own, program.handed.length]).toEqual([3, 1]);
			handed.push(...program.handed);
		}
		expect([...handed].sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
	});

	test("six clocks past their window: each read on one of six hours' second ticks", () => {
		const games = Array.from({ length: 6 }, (_, i) => verified(i + 1, FROM - 3 * 86_400));
		const handed: string[] = [];
		for (let h = 0; h < 6; h++) {
			const program = waiter();
			tick(games, FROM + h * 3_600 + HOURLY_TICK * PERIOD + 10, program);
			handed.push(...program.handed);
		}
		expect([...handed].sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
	});
});

export { PER_HOUR };
