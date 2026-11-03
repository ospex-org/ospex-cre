// The run-line (runline.ts): what one execution records about each seat, and the one push that carries
// it to the database's table. Each test below is one item of the card's "Done when" list, and its name
// begins with the item's number:
//   1. a creation run and a cron tick each produce a row for every seat when any seat was asked, and no
//      rows when none was;
//   2. a cache-hit tick with several logical reads counts the actual sends;
//   3. a wholly skipped seat in an active execution has a row with zero requests and its skip count;
//   4. a silent seat shows silent, not "no request";
//   5. a missing quota header gives null;
//   6. no secret or keyed URL in any row: never-run-line-secrets.test.ts;
//   7. the push at the budget edge is the reserved slot, never a sixteenth;
//   8. a hanging and an unreachable database endpoint both leave the game scored, the report unchanged
//      and the gap visible: never-run-line-halt.test.ts;
//   9. a batch mixing new and replayed rows, one Data API request: this side's request shape here; the
//      database's half (new rows in, replayed rows skipped) is the table's own test.
// Then what the rows rest on: the run key, the elapsed samples, the size of a line and of the push.
// The program's half (the record decides nothing) is scoring/test/observe.test.ts.
//
// Every run here goes through the execution's own transports (runline.ts, execution), as main.ts's
// handlers do: the record sits below the run's memory and its count.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import { Cut, isCut } from "../scoring/src/run";
import { seatRow } from "../scoring/src/table";
import type { HttpRequest, HttpResponse, Seat } from "../scoring/src/types";
import { LATE, NOW } from "../scoring/test/cases";
import { KEY, saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { EXPECTED_DURATION, keysFor } from "./lib";
import { runGame } from "./run";
import {
	RUN_LINE_SECRET,
	WORKFLOW_NAME,
	creationKey,
	deliver,
	execution,
	keyFrom,
	pushRequest,
	recorded,
	recorder,
	tickKey,
	type Answer,
	type Delivery,
	type Row,
	type Sent,
} from "./runline";
import { GAMES, REPORTER, fakeChain, fakeChainOf, recordingWriter } from "./test-helpers";
import { runTick } from "./tick";

const KEYS = keysFor({ 4: KEY });
const ROUTE = { url: "https://db.example.test/rest/v1/run_lines", publishableKey: "sb_publishable_test-stand-in" };
const CREATION_KEY = `${WORKFLOW_NAME}:creation:0x${"ab".repeat(32)}:3`;
const TICK_KEY = `${WORKFLOW_NAME}:tick:0:1793750400`;
const PERIOD = 300;
/** Each clock read 7 ms after the last: every request's elapsed sample is 7. */
const STEP = 7;

/** The raw transport (main.ts, rawOf): every request as sent, each feed's answer with headers, the push answered as the database would. */
interface Raw {
	readonly send: (req: Sent) => Answer;
	readonly sent: Sent[];
	/** What happened, in order: "send <seat>" for a feed, "push", and the writer's "write". */
	readonly events: string[];
}

function rawOf(feed: (req: HttpRequest) => HttpResponse, o: { headers?: (req: HttpRequest) => Record<string, string[]>; push?: (req: Sent) => Answer; events?: string[] } = {}): Raw {
	const sent: Sent[] = [];
	const events = o.events ?? [];
	return {
		sent,
		events,
		send(req) {
			sent.push(req);
			if (req.url.startsWith(ROUTE.url)) {
				events.push("push");
				return o.push?.(req) ?? { status: 201, body: "", headers: {} };
			}
			events.push(`send ${seatOfHost(req.url)}`);
			const r = feed(req);
			return { ...r, headers: o.headers?.(req) ?? {} };
		},
	};
}

function seatOfHost(url: string): Seat | null {
	for (const seat of [1, 2, 3, 4] as const) if (url.startsWith(`https://${seatRow(seat).host}/`)) return seat;
	return null;
}

function ticking(step = STEP): () => number {
	let t = 1_793_750_400_000;
	return () => (t += step);
}

const isPush = (req: Sent): boolean => req.url.startsWith(ROUTE.url);

/** The rows a run put on the log, parsed back. */
function rowsOf(logs: readonly string[]): Row[] {
	return logs.filter((l) => l.startsWith("run-line {")).map((l) => JSON.parse(l.slice("run-line ".length)) as Row);
}

/** The four counts and the request count of each row, in seat order. */
const counts = (rows: readonly Row[]) => rows.map((r) => ({ seat: r.seat, requests: r.requests, answered: r.answered, silent: r.silent, skipped: r.skipped }));

/** What every row holds: one elapsed sample and one status per request, the spare's quota per request, and the other seats' quota null. */
function wellFormed(rows: readonly Row[]): void {
	expect(rows.map((r) => r.seat)).toEqual([1, 2, 3, 4]);
	for (const r of rows) {
		expect({ seat: r.seat, elapsed: r.elapsed_ms.length, statuses: r.statuses.length }).toEqual({ seat: r.seat, elapsed: r.requests, statuses: r.requests });
		if (r.seat === 4) expect(r.quota?.length).toBe(r.requests);
		else expect([r.quota, r.remaining]).toEqual([null, null]);
	}
}

/** A creation run through the execution's transports, its record delivered. */
function creation(game: ChainGame, now: number, feed: (req: HttpRequest) => HttpResponse, keys = KEYS) {
	const events: string[] = [];
	const raw = rawOf(feed, { events });
	const ex = execution(raw.send, ticking());
	const logs: string[] = [];
	const writer = recordingWriter();
	const write = (r: `0x${string}`) => {
		events.push("write");
		return writer.write(r);
	};
	const d: Delivery = { runKey: CREATION_KEY, kind: "creation", route: ROUTE, log: (l) => logs.push(l) };
	const run = recorded(d, ex, () => runGame({ evm: fakeChain(game, now), games: GAMES, payout: PAYOUT, keys, send: ex.feeds, write, observe: ex.record }, game, [REPORTER]));
	return { run, logs, rows: rowsOf(logs), raw, events, written: writer.written };
}

/** A tick through the execution's transports, its record delivered. */
function tickOf(games: readonly ChainGame[], now: number, feed: (req: HttpRequest) => HttpResponse, o: { readsLimit?: number; requestsLimit?: number; keys?: ReturnType<typeof keysFor> } = {}) {
	const events: string[] = [];
	const raw = rawOf(feed, { events });
	const ex = execution(raw.send, ticking());
	const logs: string[] = [];
	const writer = recordingWriter();
	const write = (r: `0x${string}`) => {
		events.push("write");
		return writer.write(r);
	};
	const d: Delivery = { runKey: TICK_KEY, kind: "tick", route: ROUTE, log: (l) => logs.push(l) };
	const result = recorded(d, ex, () =>
		runTick({ evm: fakeChainOf(games, now), games: GAMES, payout: PAYOUT, keys: KEYS, send: ex.feeds, write, observe: ex.record, period: PERIOD, shard: { index: 0, count: 1 }, ...o }),
	);
	return { result, logs, rows: rowsOf(logs), raw, events, written: writer.written };
}

const NFL = chainOf("nfl not final");
const UNVERIFIED: ChainGame = { ...NFL, id: "1", status: "unverified", start: null, startReadings: null };
const SIXERS: ChainGame = { ...chainOf("nba final, read after the game"), id: "1" };

describe("the run-line: the card's done list", () => {
	test("1. a creation run that asks the seats: a row for every seat on the log, the same rows in the one push, after the report is written", () => {
		const t = saved(undefined, NOW);
		const c = creation(UNVERIFIED, NOW, t.send);
		expect([c.run.decision.action, c.written.length]).toEqual(["start", 1]);
		expect(c.rows.length).toBe(4);
		wellFormed(c.rows);
		// Verification on the saved answers: seats 1 and 2 read over the range and again in the window
		// (seat 2 once per team each time), seat 3's board then its result in the window, the spare by its
		// id twice, the second from memory: 2 / 4 / 2 / 1 requests sent, 9, and two reads at each seat.
		expect(counts(c.rows)).toEqual([
			{ seat: 1, requests: 2, answered: 2, silent: 0, skipped: 0 },
			{ seat: 2, requests: 4, answered: 2, silent: 0, skipped: 0 },
			{ seat: 3, requests: 2, answered: 2, silent: 0, skipped: 0 },
			{ seat: 4, requests: 1, answered: 2, silent: 0, skipped: 0 },
		]);
		expect(c.rows.every((r) => r.run_key === CREATION_KEY && r.workflow === WORKFLOW_NAME && r.kind === "creation")).toBe(true);
		expect(c.rows.flatMap((r) => r.statuses)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200]);
		expect(c.rows.flatMap((r) => r.elapsed_ms)).toEqual(Array(9).fill(STEP));
		// One push, carrying exactly the logged rows, after the write and after the rows are on the log.
		const pushes = c.raw.sent.filter(isPush);
		expect(pushes.length).toBe(1);
		expect(JSON.parse(pushes[0].body as string)).toEqual(c.rows);
		expect(c.events.slice(-2)).toEqual(["write", "push"]);
		expect(c.logs.slice(-5).map((l) => (l.startsWith("run-line {") ? "row" : l))).toEqual(["row", "row", "row", "row", "run-line push: http 201"]);
	});

	test("1. a creation run that asks no seat writes no row and sends no push: a league the table does not have, and a seat without its key", () => {
		const other = creation({ ...UNVERIFIED, league: "cricket" }, NOW, saved(undefined, NOW).send);
		expect(other.run.decision.why).toBe("league not offered");
		const keyless = creation(UNVERIFIED, NOW, saved(undefined, NOW).send, keysFor({}));
		expect(keyless.run.decision.why).toBe("seat 4 has no key");
		for (const c of [other, keyless]) {
			expect([c.raw.sent.length, c.logs.filter((l) => l.startsWith("run-line")).length, c.written.length]).toEqual([0, 0, 0]);
		}
	});

	test("1. a tick that asks the seats: a row for every seat, the same rows in the one push, after the score is written", () => {
		const c = tickOf([SIXERS], LATE, saved(undefined, LATE).send);
		expect([c.result.probes.length, c.result.fullRead?.run?.decision.action, c.written.length]).toEqual([1, "score", 1]);
		expect(c.rows.length).toBe(4);
		wellFormed(c.rows);
		expect(c.rows.every((r) => r.run_key === TICK_KEY && r.workflow === WORKFLOW_NAME && r.kind === "tick")).toBe(true);
		const pushes = c.raw.sent.filter(isPush);
		expect(pushes.length).toBe(1);
		expect(JSON.parse(pushes[0].body as string)).toEqual(c.rows);
		expect(c.events.slice(-2)).toEqual(["write", "push"]);
	});

	test("1. a tick that asks no seat writes no row and sends no push: a game not yet due, and an empty open list", () => {
		const early = tickOf([SIXERS], (SIXERS.start as number) + EXPECTED_DURATION.nba - 600, saved(undefined, LATE).send);
		const empty = tickOf([], LATE, saved(undefined, LATE).send);
		for (const c of [early, empty]) {
			expect([c.result.probes.length, c.result.fullRead, c.raw.sent.length, c.logs.length]).toEqual([0, null, 0, 0]);
		}
	});

	test("2. a cache-hit tick: the probe's answer at seat 3 serves the full read from memory, so seat 3's row counts one request sent and two reads answered", () => {
		const t = saved(undefined, LATE);
		const c = tickOf([SIXERS], LATE, t.send);
		expect(counts(c.rows)).toEqual([
			{ seat: 1, requests: 1, answered: 1, silent: 0, skipped: 0 },
			{ seat: 2, requests: 2, answered: 1, silent: 0, skipped: 0 },
			{ seat: 3, requests: 1, answered: 2, silent: 0, skipped: 0 },
			{ seat: 4, requests: 1, answered: 1, silent: 0, skipped: 0 },
		]);
		// The sends the rows count are the transport's own: five reached the feeds, one of them seat 3's.
		expect(c.raw.sent.filter((r) => !isPush(r)).length).toBe(5);
		expect(c.raw.events.filter((e) => e === "send 3").length).toBe(1);
	});

	test("3. a wholly skipped seat: seat 3 silent for the game, the others asked, and seat 3's row is there with zero requests and one skip", () => {
		const down: ChainGame = {
			...SIXERS,
			startReadings: (SIXERS.startReadings ?? []).map((r) => (r.seat === 3 ? { ...r, kind: 0 } : r)),
		};
		const c = creation(down, LATE, saved(undefined, LATE).send);
		expect(c.rows.length).toBe(4);
		wellFormed(c.rows);
		expect(c.rows[2]).toMatchObject({ seat: 3, requests: 0, answered: 0, silent: 0, skipped: 1, elapsed_ms: [], statuses: [] });
		expect(c.raw.events.filter((e) => e === "send 3").length).toBe(0);
		expect(counts(c.rows).filter((r) => r.seat !== 3).every((r) => r.requests > 0 && r.skipped === 0)).toBe(true);
	});

	test("4. a silent seat: asked, no usable answer, so its row shows the request, its status and a silent read, never a skip", () => {
		const t = saved(undefined, LATE);
		const feed = (req: HttpRequest): HttpResponse => (seatOfHost(req.url) === 2 ? { status: 503, body: "" } : t.send(req));
		const c = creation(SIXERS, LATE, feed);
		wellFormed(c.rows);
		expect(c.rows[1]).toMatchObject({ seat: 2, requests: 1, answered: 0, silent: 1, skipped: 0, statuses: [503] });
		// The control: the same run with seat 2 answering is an answer there.
		const control = creation(SIXERS, LATE, saved(undefined, LATE).send);
		expect(control.rows[1]).toMatchObject({ seat: 2, requests: 2, answered: 1, silent: 0, skipped: 0, statuses: [200, 200] });
	});

	test("5. the spare's quota: each request's sample, null where the header is absent or not a whole number, the last request's as remaining, and never read at another seat", () => {
		const url = (seat: Seat, i: number) => `https://${seatRow(seat).host}/q${i}`;
		const run = (spare: readonly (string | null)[]) => {
			const headers = (req: HttpRequest): Record<string, string[]> => {
				const m = /\/q([0-9]+)$/.exec(req.url);
				const v = m === null ? null : spare[Number(m[1])];
				return v === null ? {} : { "X-Requests-Remaining": [v] };
			};
			const raw = rawOf(() => ({ status: 200, body: "[]" }), { headers });
			const ex = execution(raw.send, ticking());
			for (let i = 0; i < spare.length; i++) ex.feeds({ method: "GET", url: url(4, i), headers: {} });
			// Another seat whose answer carries the same header: its row has no quota.
			ex.feeds({ method: "GET", url: url(1, 0), headers: {} });
			return ex.record.rows(TICK_KEY, "tick");
		};
		expect(run(["414", "413", "412"])[3]).toMatchObject({ quota: [414, 413, 412], remaining: 412 });
		expect(run(["414", null, "412"])[3]).toMatchObject({ quota: [414, null, 412], remaining: 412 });
		expect(run(["414", "413", null])[3]).toMatchObject({ quota: [414, 413, null], remaining: null });
		expect(run([null])[3]).toMatchObject({ quota: [null], remaining: null });
		for (const v of ["", " ", "41.5", "-1", "1e3", "four", "4141414141"]) expect({ v, row: run([v])[3] }).toMatchObject({ v, row: { quota: [null], remaining: null } });
		expect(run([" 7 "])[3]).toMatchObject({ quota: [7], remaining: 7 });
		const rows = run(["414"]);
		expect([rows[0].quota, rows[0].remaining]).toEqual([null, null]);
		// No request to the spare: its quota is an empty list and its remaining null.
		const raw = rawOf(() => ({ status: 200, body: "[]" }));
		const ex = execution(raw.send, ticking());
		ex.feeds({ method: "GET", url: url(1, 0), headers: {} });
		expect(ex.record.rows(TICK_KEY, "tick")[3]).toMatchObject({ requests: 0, quota: [], remaining: null });
	});

	test("7. the push at the budget edge is the reserved slot: the feeds' fifteenth request is refused unsent, the push is the fifteenth sent, and a sixteenth is refused", () => {
		const raw = rawOf(() => ({ status: 200, body: "[]" }));
		const ex = execution(raw.send, ticking());
		const feed = (i: number): HttpRequest => ({ method: "GET", url: `https://${seatRow(1).host}/r${i}`, headers: {} });
		for (let i = 0; i < 14; i++) ex.feeds(feed(i));
		let refused: unknown = null;
		try {
			ex.feeds(feed(14));
		} catch (e) {
			refused = e;
		}
		expect([isCut(refused), (refused as Error).message, raw.sent.length]).toEqual([true, "the run's 14 requests are used", 14]);
		// A request already sent is answered from memory, and costs nothing.
		ex.feeds(feed(3));
		expect(raw.sent.length).toBe(14);
		const logs: string[] = [];
		deliver({ runKey: TICK_KEY, kind: "tick", route: ROUTE, log: (l) => logs.push(l) }, ex);
		expect([raw.sent.length, isPush(raw.sent[14]), ex.sent(), logs.at(-1)]).toEqual([15, true, 15, "run-line push: http 201"]);
		expect(rowsOf(logs)[0]).toMatchObject({ seat: 1, requests: 14 });
		let sixteenth: unknown = null;
		try {
			ex.push(pushRequest(rowsOf(logs), ROUTE));
		} catch (e) {
			sixteenth = e;
		}
		expect([isCut(sixteenth), (sixteenth as Error).message, raw.sent.length]).toEqual([true, "the run's 15 requests are used", 15]);
	});

	test("7. the tick's admission holds the push's slot back: a final probed ninth, whose scoring run needs six, waits on fourteen and would read on fifteen", () => {
		// Nine verified games, each with its own seat 3 hint, past their start plus the league's duration,
		// with reads to spare so the requests bind. The order the tick probes them in is read off a first
		// run in which every game is still in play; then the ninth is made final.
		const hint = (i: number) => `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
		const games = Array.from({ length: 9 }, (_, i) => ({ ...SIXERS, id: String(i + 1), hints: [{ seat: 3, id: hint(i + 1) }] }));
		const start = SIXERS.start as number;
		const at = start + EXPECTED_DURATION.nba + 3_600 - ((start + EXPECTED_DURATION.nba) % 3_600) + 4 * PERIOD + 10;
		const result3 = (id: string, final: boolean) =>
			JSON.stringify([{ ID: id, EventID: id, OddType: "Game", Final: final, FinalType: final ? "Finished" : "NotFinished", HomeScore: 114, AwayScore: 106 }]);
		const seat3 = (finalHint: string | null) => (req: HttpRequest): HttpResponse => {
			const m = /\/results\/([0-9a-f-]+)$/.exec(req.url);
			if (m === null) return { status: 200, body: "[]" };
			return { status: 200, body: result3(m[1], m[1] === finalHint) };
		};
		const order = tickOf(games, at, seat3(null), { readsLimit: 100 }).result.probes.map((p) => p.gameId);
		expect(order.length).toBe(9);
		const ninth = hint(Number(order[8]));
		const held = tickOf(games, at, seat3(ninth), { readsLimit: 100 });
		expect([held.result.probes.length, held.result.fullRead, held.result.waiting]).toEqual([9, null, [`${order[8]}: final at seat 3 waits: needs 6 requests, 5 left`]]);
		// Given the platform's whole fifteen, the same final reads: the fourteen is what held it.
		const whole = tickOf(games, at, seat3(ninth), { readsLimit: 100, requestsLimit: 15 });
		expect(whole.result.fullRead?.gameId).toBe(order[8]);
	});

	test("3. a probe that asks nothing: the spare closed past its retention, or without its key, is the spare's skip, beside another game's probe that asks", () => {
		// A later tick of the hour, 67 hours and more after the first game's start: the spare, which a game
		// without a usable seat 3 hint is probed at, keeps 66 hours. The second game started three hours
		// before and is probed at seat 3 by its hint, which answers that it is still in play.
		const start = SIXERS.start as number;
		const base = start + 67 * 3_600;
		const at = base - (base % 3_600) + 3_600 + 4 * PERIOD + 10;
		const inPlay = (req: HttpRequest): HttpResponse => {
			const m = /\/results\/([0-9a-f-]+)$/.exec(req.url);
			return { status: 200, body: m === null ? "[]" : JSON.stringify([{ ID: m[1], EventID: m[1], OddType: "Game", Final: false, FinalType: "NotFinished", HomeScore: 50, AwayScore: 48 }]) };
		};
		const asking: ChainGame = { ...SIXERS, id: "2", start: at - 3 * 3_600, date: at - 3 * 3_600 };
		const closed: ChainGame = { ...SIXERS, id: "1", hints: [], status: "disputed", dispute: { at: start + 7_200, records: [SIXERS.startReadings ?? []] } };
		const c = tickOf([closed, asking], at, inPlay);
		expect([c.result.probes.map((p) => p.seat), c.result.lines]).toEqual([[3], ["game 1: seat 4 is closed, not probed"]]);
		expect(counts(c.rows)).toEqual([
			{ seat: 1, requests: 0, answered: 0, silent: 0, skipped: 0 },
			{ seat: 2, requests: 0, answered: 0, silent: 0, skipped: 0 },
			{ seat: 3, requests: 1, answered: 1, silent: 0, skipped: 0 },
			{ seat: 4, requests: 0, answered: 0, silent: 0, skipped: 1 },
		]);
		// The spare without its key: the same skip, the same game beside it.
		const keyless: ChainGame = { ...SIXERS, id: "1", hints: [], start: at - 3 * 3_600, date: at - 3 * 3_600 };
		const k = tickOf([keyless, asking], at, inPlay, { keys: keysFor({}) });
		expect(k.result.lines).toEqual(["game 1: seat 4 has no key, not probed"]);
		expect(counts(k.rows)[3]).toEqual({ seat: 4, requests: 0, answered: 0, silent: 0, skipped: 1 });
	});

	test("3. a probe the count cuts: the spare's read behind an id that answered nothing is its skip, the cut still raised, the rows still logged and pushed", () => {
		// The spare probed by its id with one request left: the id answers nothing, so the reader asks the
		// slate behind it, and the count refuses that second request. The tick's own result is unchanged
		// by the record: the cut is raised out of it, as it was before the record existed.
		const start = SIXERS.start as number;
		const base = start + 3 * 3_600;
		const at = base - (base % 3_600) + 3_600 + 4 * PERIOD + 10;
		// The spare's own id for the game, as the saved case records it; the case's hints carry seat 3's alone.
		const game: ChainGame = { ...SIXERS, hints: [{ seat: 4, id: "110e33c79c5ec8c0377702aff685f83b" }], start: at - 3 * 3_600, date: at - 3 * 3_600 };
		const raw = rawOf(() => ({ status: 200, body: "[]" }));
		const ex = execution(raw.send, ticking());
		const logs: string[] = [];
		let thrown: unknown = null;
		try {
			recorded({ runKey: TICK_KEY, kind: "tick", route: ROUTE, log: (l) => logs.push(l) }, ex, () =>
				runTick({ evm: fakeChainOf([game], at), games: GAMES, payout: PAYOUT, keys: KEYS, send: ex.feeds, write: recordingWriter().write, observe: ex.record, period: PERIOD, shard: { index: 0, count: 1 }, requestsLimit: 1 }),
			);
		} catch (e) {
			thrown = e;
		}
		expect([isCut(thrown), (thrown as Error).message]).toEqual([true, "the run's 1 requests are used"]);
		expect(counts(rowsOf(logs))[3]).toEqual({ seat: 4, requests: 1, answered: 0, silent: 0, skipped: 1 });
		expect([raw.sent.filter(isPush).length, logs.at(-1)]).toEqual([1, "run-line push: http 201"]);
	});

	test("9. the batch: one POST of every row as one JSON array, to the table's URL with the key pair to skip on, its four headers and its time cap, the key a vault stand-in", () => {
		const rec = recorder();
		rec.sent(2, 9, 200, null);
		rec.sent(4, 11, 200, 412);
		rec.read(2, "answered");
		rec.read(3, "skipped");
		const rows = rec.rows(TICK_KEY, "tick");
		const req = pushRequest(rows, ROUTE);
		expect({ ...req, body: JSON.parse(req.body as string) }).toEqual({
			method: "POST",
			url: "https://db.example.test/rest/v1/run_lines?on_conflict=run_key,seat",
			headers: {
				"Content-Type": "application/json",
				apikey: "sb_publishable_test-stand-in",
				Authorization: `Bearer {{.${RUN_LINE_SECRET}}}`,
				Prefer: "resolution=ignore-duplicates,return=minimal",
			},
			body: rows,
			timeout: "5s",
			secrets: ["RUN_LINE_KEY"],
		});
		// Every row carries the same twelve columns, in one order, so the database reads one column list.
		const columns = ["run_key", "seat", "workflow", "kind", "requests", "answered", "silent", "skipped", "elapsed_ms", "statuses", "quota", "remaining"];
		for (const r of JSON.parse(req.body as string) as object[]) expect(Object.keys(r)).toEqual(columns);
		expect(rows.map((r) => [r.seat, r.requests, r.answered, r.skipped, r.quota, r.remaining])).toEqual([
			[1, 0, 0, 0, null, null],
			[2, 1, 1, 0, null, null],
			[3, 0, 0, 1, null, null],
			[4, 1, 0, 0, [412], 412],
		]);
		// The enclave reads the body as a template: it holds no placeholder of its own.
		expect(req.body).not.toContain("{{");
	});
});

describe("the run-line: what the rows rest on", () => {
	test("the run key: the same trigger gives the same key on every node and retry; another log, shard or time gives another; a trigger without its place gives none", () => {
		const tx = `0x${"ab".repeat(32)}`;
		expect(creationKey(tx, 3)).toBe(`osgames2:creation:${tx}:3`);
		expect(creationKey(tx.toUpperCase().replace("0X", "0x"), 3)).toBe(creationKey(tx, 3));
		expect(new Set([creationKey(tx, 3), creationKey(tx, 4), creationKey(`0x${"cd".repeat(32)}`, 3)]).size).toBe(3);
		for (const [h, i] of [["0x", 3], [`0x${"ab".repeat(31)}`, 3], [`${"ab".repeat(32)}`, 3], [`0x${"zz".repeat(32)}`, 3], [tx, -1], [tx, 1.5], [tx, Number.NaN]] as const) {
			expect({ h, i, key: creationKey(h, i) }).toEqual({ h, i, key: null });
		}
		expect(tickKey(1, 1_793_750_420n)).toBe("osgames2:tick:1:1793750420");
		expect(new Set([tickKey(0, 1_793_750_400n), tickKey(1, 1_793_750_400n), tickKey(0, 1_793_750_700n)]).size).toBe(3);
		for (const [s, t] of [[0, 0n], [0, -5n], [-1, 1n], [0.5, 1n]] as const) expect({ s, t, key: tickKey(s, t) }).toEqual({ s, t, key: null });
		// A trigger whose fields cannot be read gives no key, and never stops the run.
		expect(keyFrom(() => { throw new Error("no log"); })).toBeNull();
		// A run without a key logs its rows and sends nothing.
		const raw = rawOf(() => ({ status: 200, body: "[]" }));
		const ex = execution(raw.send, ticking());
		ex.feeds({ method: "GET", url: `https://${seatRow(1).host}/a`, headers: {} });
		const logs: string[] = [];
		deliver({ runKey: null, kind: "tick", route: ROUTE, log: (l) => logs.push(l) }, ex);
		expect([rowsOf(logs).length, logs.at(-1), raw.sent.filter(isPush).length]).toEqual([4, "run-line push: not sent: the trigger gave no run key", 0]);
	});

	test("the elapsed samples: DON time after each request less DON time before it; null where the clock cannot be read or runs back; the request sent all the same", () => {
		const url = (i: number) => `https://${seatRow(2).host}/e${i}`;
		const run = (clock: () => number) => {
			const raw = rawOf(() => ({ status: 200, body: "[]" }));
			const ex = execution(raw.send, clock);
			for (let i = 0; i < 3; i++) ex.feeds({ method: "GET", url: url(i), headers: {} });
			return { row: ex.record.rows(TICK_KEY, "tick")[1], sent: raw.sent.length };
		};
		const times = [100, 340, 400, 400, 1_000, 6_100];
		let i = 0;
		expect(run(() => times[i++])).toEqual({ row: expect.objectContaining({ elapsed_ms: [240, 0, 5_100], requests: 3 }), sent: 3 });
		expect(run(() => { throw new Error("no DON time"); })).toEqual({ row: expect.objectContaining({ elapsed_ms: [null, null, null], requests: 3 }), sent: 3 });
		const back = [500, 400, 400, Number.NaN, 10, 20];
		let j = 0;
		expect(run(() => back[j++]).row.elapsed_ms).toEqual([null, null, 10]);
	});

	test("a push with no answer: its line names the cause from a fixed list and never the failure's words; a refused push its status and the database's code, nothing else of the body", () => {
		const line = (fail: () => never): string => {
			const raw = rawOf(() => ({ status: 200, body: "[]" }), { push: fail });
			const ex = execution(raw.send, ticking());
			ex.feeds({ method: "GET", url: `https://${seatRow(1).host}/c`, headers: {} });
			const logs: string[] = [];
			deliver({ runKey: TICK_KEY, kind: "tick", route: ROUTE, log: (l) => logs.push(l) }, ex);
			return logs.at(-1) as string;
		};
		const WORDS = "REVIEW_WORDS_CANARY https://db.example.test/?apikey=x Bearer abc";
		const causes: [string, string][] = [
			[`Post "${WORDS}": context deadline exceeded (Client.Timeout exceeded while awaiting headers)`, "timed out"],
			[`dial tcp ${WORDS}: connect: connection refused`, "connection refused"],
			[`read: connection reset by peer ${WORDS}`, "connection dropped"],
			[`dial tcp: lookup ${WORDS}: no such host`, "host not found"],
			[`tls: failed to verify certificate ${WORDS}`, "tls"],
			[`something else entirely ${WORDS}`, "other"],
		];
		for (const [message, cause] of causes) {
			const l = line(() => {
				throw new Error(message);
			});
			expect({ cause, l }).toEqual({ cause, l: `run-line push: no answer: ${cause}` });
		}
		expect(line(() => { throw new Cut("the run's 15 requests are used"); })).toBe("run-line push: no answer: the count is used");
		const refused = (status: number, body: string): string => {
			const raw = rawOf(() => ({ status: 200, body: "[]" }), { push: () => ({ status, body, headers: {} }) });
			const ex = execution(raw.send, ticking());
			ex.feeds({ method: "GET", url: `https://${seatRow(1).host}/c`, headers: {} });
			const logs: string[] = [];
			deliver({ runKey: TICK_KEY, kind: "tick", route: ROUTE, log: (l) => logs.push(l) }, ex);
			return logs.at(-1) as string;
		};
		expect(refused(401, JSON.stringify({ code: "PGRST301", message: WORDS }))).toBe("run-line push: http 401 PGRST301");
		expect(refused(409, JSON.stringify({ code: "23505", details: WORDS }))).toBe("run-line push: http 409 23505");
		expect(refused(400, JSON.stringify({ code: WORDS }))).toBe("run-line push: http 400");
		expect(refused(502, WORDS)).toBe("run-line push: http 502");
	});

	test("a request that raises is a request: its row counts it, with a null status, and the reader reads the seat silent", () => {
		const raw = rawOf((req) => {
			if (seatOfHost(req.url) === 3) throw new Error("the enclave's request timed out");
			return saved(undefined, LATE).send(req);
		});
		const ex = execution(raw.send, ticking());
		const run = runGame({ evm: fakeChain(SIXERS, LATE), games: GAMES, payout: PAYOUT, keys: KEYS, send: ex.feeds, write: recordingWriter().write, observe: ex.record }, SIXERS, [REPORTER]);
		expect(run.decision.action).toBe("wait");
		expect(ex.record.rows(TICK_KEY, "tick")[2]).toMatchObject({ seat: 3, requests: 1, statuses: [null], elapsed_ms: [STEP], answered: 0, silent: 1, skipped: 0 });
	});

	test("the sizes: a row's line at the count's worst case fits the platform's 1 KB line, and the push of four such rows its 10 KB request", () => {
		const rec = recorder();
		for (const seat of [1, 2, 3, 4] as const) for (let i = 0; i < 14; i++) rec.sent(seat, 999_999, 503, seat === 4 ? 999_999_999 : null);
		for (const seat of [1, 2, 3, 4] as const) for (let i = 0; i < 14; i++) rec.read(seat, "silent");
		const key = creationKey(`0x${"ab".repeat(32)}`, 99_999) as string;
		const rows = rec.rows(key, "creation");
		const lines = rows.map((r) => `run-line ${JSON.stringify(r)}`);
		expect(Math.max(...lines.map((l) => new TextEncoder().encode(l).length))).toBeLessThan(1_024);
		expect(new TextEncoder().encode(pushRequest(rows, ROUTE).body as string).length).toBeLessThan(10_240);
	});
});
