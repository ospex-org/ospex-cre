// The line at the workflow's own log calls (main.ts). Its two handlers run against a stand-in SDK: the
// chain, the enclave and the reporter are faked, nothing leaves the process, and no key is real. What a
// test reads is exactly what a handler hands to runtime.log, returns or throws; the platform writes a
// handler's thrown error as the execution's error text, so that is a line too.
//
// Never: "No line carries the query key, raw or escaped, or any feed string that is not a short plain
// word; the header keys the platform fills are never the workflow's to hold and are protected by the
// word rule."
//
// The workflow is handed a stand-in for each header key: the enclave fills it on the way out, so the value
// the feed receives is one the workflow never held, and no line can redact it by value. Here the fake feed
// echoes the key it received in its status field. A header key's canary (19 characters, underscores in
// it: past the length and outside the plain set) leaves as the marker; the query key's, a value the
// workflow holds, as the redaction. A header key that is itself a short plain word stands on the line:
// the residual this rule accepts, pinned below so that a change to it is seen.
//
// The breaks that turn this red, each applied once and restored:
//   ../scoring/src/line.ts, cleanLine: an unquoted URL token unmarked,
//     if (!token.startsWith('"')) return URL_MARKS.test(token) ? NOT_A_WORD : token;
//     ->  if (!token.startsWith('"')) return token;
//   with which a writer's error naming a URL in its own words leaves the creation handler whole;
//   main.ts, onGameCreated: the error thrown again as it came,
//     if (!isCut(e)) throw new Error(message);
//     ->  if (!isCut(e)) throw e;
//   with which the query key in a writer's error leaves the creation handler.

import { describe, expect, mock, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, hexToBytes, type Hex } from "viem";
import type { ChainGame } from "../scoring/src/chain";
import { NOT_A_WORD, REDACTED } from "../scoring/src/line";
import { seatRow } from "../scoring/src/table";
import type { HttpRequest, Seat } from "../scoring/src/types";
import { locate } from "../scoring/test/fixtures";
import { PAYOUT } from "../scoring/test/rule-helpers";
import { DAY, START, STATUSES, STATUS_FIELD, answerOf, boardOf, gameFor, json, rowOf, type Role } from "../scoring/test/rows";
import { GAME_CREATED, type Config } from "./lib";
import { GAMES, REPORTER, fakeChainOf, type FakeChain } from "./test-helpers";

const CONFIG: Config = {
	receiverAddress: REPORTER,
	eventAddress: GAMES,
	chainSelectorName: "polygon-mainnet",
	chainId: 137,
	secretOwner: "0x1111111111111111111111111111111111111111",
	secretNamespace: "line-test",
	payoutAddress: PAYOUT,
	schedule: "0 */5 * * * *",
	shards: 1,
};

/** The vault for these tests: what the enclave fills into a header's stand-in, and the query key the run reads. */
const VAULT: Readonly<Record<string, string>> = { SEAT1_KEY: "REVIEW_SEAT1_CANARY", SEAT2_KEY: "REVIEW_SEAT2_CANARY", SEAT3_KEY: "REVIEW_SEAT3_CANARY", SEAT4_KEY: "REVIEW_SEAT4_CANARY" };

type Answer = (seat: Seat, req: HttpRequest) => { status: number; body: string };

interface World {
	readonly evm: FakeChain;
	readonly vault: Readonly<Record<string, string>>;
	readonly answer: Answer;
	readonly logs: string[];
	/** Each request as the workflow built it (`headers`) and as the enclave sent it (`filled`). */
	readonly sent: { seat: Seat; headers: Record<string, string>; filled: Record<string, string> }[];
	readonly secretReads: string[];
	writes: number;
	readonly writeError: string | null;
	readonly cut: string | null;
}

let world: World;
const result = <T>(value: T) => ({ result: () => value });

class EVMClient {
	callContract(_runtime: unknown, args: { call: { to: Hex; data: Hex } }) {
		return result({ data: hexToBytes(world.evm.call(args.call.to, args.call.data) as Hex) });
	}
	headerByNumber() {
		const h = world.evm.latest();
		return result({ header: { blockNumber: h.number, timestamp: h.timestamp } });
	}
	logTrigger(x: unknown) {
		return { creation: x };
	}
	writeReport() {
		world.writes++;
		return result(world.writeError === null ? { txStatus: 1 } : { txStatus: 2, errorMessage: world.writeError });
	}
}

class ConfidentialHTTPClient {
	sendRequest(_runtime: unknown, args: { vaultDonSecrets: { key: string }[]; request: { url: string; method: string; multiHeaders: Record<string, { values: string[] }>; bodyString?: string } }) {
		const { url, method, multiHeaders, bodyString } = args.request;
		const at = locate({ url, method, headers: {}, body: bodyString });
		if (at === null) throw new Error("a host outside the table");
		const declared = new Set(args.vaultDonSecrets.map((s) => s.key));
		const headers = Object.fromEntries(Object.entries(multiHeaders).map(([k, v]) => [k, v.values[0]]));
		// The enclave: a stand-in for a secret the request declares is filled from the vault on the way out.
		const filled = Object.fromEntries(
			Object.entries(headers).map(([k, v]) => [k, v.replace(/^\{\{\.([A-Z0-9_]+)\}\}$/, (m: string, id: string) => (declared.has(id) ? world.vault[id] : m))]),
		);
		world.sent.push({ seat: at.seat, headers, filled });
		if (world.cut !== null) throw Object.assign(new Error(world.cut), { cut: true });
		const a = world.answer(at.seat, { url, method, headers: filled, body: bodyString });
		return result({ statusCode: a.status, body: new TextEncoder().encode(a.body) });
	}
}

type Handler = { callback: (runtime: unknown, payload: unknown) => string };
let handlers: Handler[] = [];

mock.module("@chainlink/cre-sdk", () => ({
	cre: {
		capabilities: { EVMClient, ConfidentialHTTPClient, CronCapability: class { trigger(x: unknown) { return { tick: x }; } } },
		handler: (trigger: unknown, callback: Handler["callback"]) => ({ trigger, callback }),
	},
	Runner: { newRunner: async () => ({ run: async (init: (c: Config) => Handler[]) => { handlers = init(CONFIG); } }) },
	bytesToHex: (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`,
	protoBigIntToBigint: (n: bigint | number) => BigInt(n),
	encodeCallMsg: (x: unknown) => x,
	logTriggerConfig: (x: unknown) => x,
	prepareReportRequest: (x: unknown) => x,
	LATEST_BLOCK_NUMBER: 0n,
	TxStatus: { SUCCESS: 1 },
}));
const { main } = await import("./main");
await main();

function runtimeOf() {
	return {
		config: CONFIG,
		getSecret: ({ id }: { id: string }) => {
			world.secretReads.push(id);
			return result({ value: world.vault[id] });
		},
		log: (line: string) => world.logs.push(line),
		report: (r: unknown) => result(r),
	};
}

interface Run {
	readonly world: World;
	/** What the handler returned, or the message of the error it threw. */
	readonly returned: string | null;
	readonly threw: string | null;
	/** Every line the run put out: each runtime.log line, the returned line and the thrown error's text. */
	readonly lines: string[];
}

function handle(i: 0 | 1, payload: unknown, w: Omit<World, "logs" | "sent" | "secretReads" | "writes">): Run {
	world = { ...w, logs: [], sent: [], secretReads: [], writes: 0 };
	let returned: string | null = null;
	let threw: string | null = null;
	try {
		returned = handlers[i].callback(runtimeOf(), payload);
	} catch (e) {
		threw = e instanceof Error ? e.message : String(e);
	}
	return { world, returned, threw, lines: [...world.logs, ...(returned === null ? [] : [returned]), ...(threw === null ? [] : [threw])] };
}

/** One tick at `now` over one game on the chain. */
function tick(g: ChainGame, now: number, answer: Answer, vault = VAULT): Run {
	return handle(1, { scheduledExecutionTime: { seconds: BigInt(now) } }, { evm: fakeChainOf([g], now), vault, answer, writeError: null, cut: null });
}

/** The creation handler for an unverified game at `now`, its GameCreated log as the trigger hands it. */
function create(g: ChainGame, now: number, answer: Answer, faults: { writeError?: string; cut?: string }): Run {
	const topics = encodeEventTopics({ abi: [GAME_CREATED], eventName: "GameCreated", args: { gameId: BigInt(g.id), creator: PAYOUT } }) as Hex[];
	const data = encodeAbiParameters(GAME_CREATED.inputs.filter((i) => !("indexed" in i && i.indexed)), [
		g.league,
		g.home,
		g.away,
		BigInt(g.date),
		g.hints.map((h) => ({ seat: h.seat, id: h.id })),
		{ window: BigInt(g.n), day7Clock: BigInt(g.day7), day30Clock: 30n * 86_400n, fee: 0n },
		[REPORTER],
		[1],
	]);
	const log = { topics: topics.map((t) => hexToBytes(t)), data: hexToBytes(data), blockNumber: 96_000_000n };
	return handle(0, log, { evm: fakeChainOf([g], now), vault: VAULT, answer, writeError: faults.writeError ?? null, cut: faults.cut ?? null });
}

/** The key a feed received: from the header the seat's key goes in, or from the query. */
function received(seat: Seat, req: HttpRequest): string {
	const k = seatRow(seat).key;
	return "header" in k ? req.headers[k.header] : (new URL(req.url).searchParams.get(k.query) ?? "");
}

/** The seats beside the one under test at hour 24: seat 1 postponed, seat 2 cancelled, seat 3 postponed beside seat 1 or 2 and empty otherwise, the spare empty. */
function beside(g: ChainGame, seat: Seat): Answer {
	return (s) => json(answerOf(s, s === 1 ? [rowOf(g, 1, "postponed")] : s === 2 ? [rowOf(g, 2, "canceled")] : s === 3 && seat <= 2 ? [rowOf(g, 3, "postponed")] : []));
}

/** The rule's line for a reading that holds the void, as a tick's JSON line carries it. */
const heldInLine = (seat: Seat, status: number, detail: string): string =>
	JSON.stringify(`after n: seat ${seat} answered but could not be used: ${status >= 300 ? `the game's row in a ${status}; ` : ""}${detail}`).slice(1, -1);

describe("the line at the handlers' own log calls", () => {
	test("each seat's key as its feed received it, echoed in its status field, under 200, 201, 500 and 503: a header key's canary leaves as the marker (12), the query key's as the redaction (4), and no line carries either", () => {
		let header = 0;
		let query = 0;
		for (const seat of [1, 2, 3, 4] as const) {
			for (const status of STATUSES) {
				const role: Role = seat === 4 ? "the spare, not counting" : (`seat ${seat}` as Role);
				const g = gameFor("nba", role);
				const key = VAULT[`SEAT${seat}_KEY`];
				const r = tick(g, START + DAY, (s, req) => {
					if (s !== seat) return beside(g, seat)(s, req);
					const row = rowOf(g, s, "final");
					row[STATUS_FIELD[s]] = received(s, req);
					return json(answerOf(s, [row]), status);
				});
				const what = { seat, status };
				expect({ ...what, threw: r.threw, writes: r.world.writes, read: r.world.secretReads }).toEqual({ ...what, threw: null, writes: 0, read: ["SEAT4_KEY"] });
				// The feed echoed the key it received; for a header seat, the workflow sent only the stand-in.
				const own = r.world.sent.filter((x) => x.seat === seat);
				expect({ ...what, asked: own.length > 0 }).toEqual({ ...what, asked: true });
				if (seat !== 4) {
					const name = (seatRow(seat).key as { header: string }).header;
					expect({ ...what, sent: own[0].headers[name], filled: own[0].filled[name] }).toEqual({ ...what, sent: `{{.SEAT${seat}_KEY}}`, filled: key });
				}
				expect({ ...what, carried: r.lines.some((l) => l.includes(key)) }).toEqual({ ...what, carried: false });
				const detail = seat === 4 ? `unrecognized status "${REDACTED}"` : `unrecognized status ${NOT_A_WORD}`;
				expect({ ...what, line: r.world.logs.some((l) => l.includes(heldInLine(seat, status, detail))) }).toEqual({ ...what, line: true });
				if (seat === 4) query++;
				else header++;
			}
		}
		expect([header, query]).toEqual([12, 4]);
	});

	test("the residual, stated: a header key that is itself a short plain word (16 characters here) stands on the line verbatim, since the workflow never holds it to redact; one character more is the marker", () => {
		const g = gameFor("nba", "seat 2");
		const echo = (s: Seat, req: HttpRequest) => {
			if (s !== 2) return beside(g, 2)(s, req);
			const row = rowOf(g, 2, "final");
			row.status = received(2, req);
			return json(answerOf(2, [row]));
		};
		const residual = "abcdef0123456789";
		const stands = tick(g, START + DAY, echo, { ...VAULT, SEAT2_KEY: residual });
		expect(stands.world.logs.some((l) => l.includes(heldInLine(2, 200, `unrecognized status "${residual}"`)))).toBe(true);
		const longer = `${residual}0`;
		const marked = tick(g, START + DAY, echo, { ...VAULT, SEAT2_KEY: longer });
		expect(marked.world.logs.some((l) => l.includes(heldInLine(2, 200, `unrecognized status ${NOT_A_WORD}`)))).toBe(true);
		expect(marked.lines.some((l) => l.includes(longer))).toBe(false);
	});

	test("seat 1's older status field, a URL with a key in it on a hockey final short of a whole game, under 200, 201, 500 and 503: no line carries the URL or its key, and the line carries the marker", () => {
		const URL = "https://feed.example.test/result?apiKey=UNCONFIGURED_FAKE_CANARY";
		for (const status of STATUSES) {
			const g = gameFor("nhl", "seat 1");
			const r = tick(g, START + DAY, (s) => {
				if (s === 1) {
					const row = rowOf(g, 1, "final");
					delete row.status_state;
					Object.assign(row, { game_state: "OFF", status: URL, period: 1 });
					return json(answerOf(1, [row]), status);
				}
				return json(answerOf(s, s === 2 ? [rowOf(g, 2, "postponed")] : s === 3 ? [rowOf(g, 3, "canceled")] : []));
			});
			expect({ status, threw: r.threw, writes: r.world.writes }).toEqual({ status, threw: null, writes: 0 });
			for (const part of [URL, "UNCONFIGURED_FAKE_CANARY"]) expect({ status, part, carried: r.lines.some((l) => l.includes(part)) }).toEqual({ status, part, carried: false });
			expect({ status, line: r.world.logs.some((l) => l.includes(heldInLine(1, status, `no status_state; ${NOT_A_WORD}; period 1 of 3`))) }).toEqual({ status, line: true });
		}
	});

	test("the creation handler: a writer's error carrying the query key and a URL, quoted or in its own words, is thrown again cleaned (the key redacted, the URL the marker, the transaction's status kept); a cut's line is cleaned the same way", () => {
		const g: ChainGame = { ...gameFor("nba", "seat 1"), status: "unverified", start: null, startReadings: null };
		// Before the start, every seat lists the game: seat 3 on its board and by its id, the others scheduled.
		const answer: Answer = (s, req) =>
			json(s === 3 && req.method === "POST" ? boardOf(g) : answerOf(s, [rowOf(g, s, s === 3 ? "in play" : "scheduled")]));
		const key = VAULT.SEAT4_KEY;
		const cases = [
			["quoted", `review failure ${key}, status "https://feed.example.test/?key=OTHER_FAKE"`, `status ${NOT_A_WORD}`],
			["in its own words", `review failure ${key}, at https://feed.example.test/?key=OTHER_FAKE`, `at ${NOT_A_WORD}`],
		] as const;
		for (const [what, message, tail] of cases) {
			const r = create(g, START - 3600, answer, { writeError: message });
			expect({ what, writes: r.world.writes, read: r.world.secretReads }).toEqual({ what, writes: 1, read: ["SEAT4_KEY"] });
			expect({ what, threw: r.threw }).toEqual({ what, threw: `writeReport failed: status 2 review failure ${REDACTED}, ${tail}` });
			for (const part of [key, "OTHER_FAKE", "://"]) expect({ what, part, carried: r.lines.some((l) => l.includes(part)) }).toEqual({ what, part, carried: false });
		}
		// The control: a cut takes the other branch, its line cleaned by the same message.
		const cut = create(g, START - 3600, answer, { cut: `review failure ${key}, status "https://feed.example.test/?key=OTHER_FAKE"` });
		expect({ threw: cut.threw, returned: cut.returned, writes: cut.world.writes }).toEqual({ threw: null, returned: `game 1: verification cut: review failure ${REDACTED}, status ${NOT_A_WORD}`, writes: 0 });
	});
});
