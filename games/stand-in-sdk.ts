// A stand-in for the CRE SDK, so a test runs main.ts's own two handlers: the chain, the enclave and the
// reporter are faked, nothing leaves the process, and no key is real. What a test reads is exactly what a
// handler hands to runtime.log, returns or throws, what it asks the enclave to send, and what it writes.
//
// The enclave stand-in fills a vault secret's stand-in (`{{.NAME}}`) wherever it sits in a header, as the
// real one does (a key whole in its header, or after "Bearer "), but only for a secret the request names,
// and keeps both forms: what the workflow built, and what went out. Each test file that imports this gets
// its own copy of the workflow, and of this stand-in.
//
// Used by the run-line's never-line tests; not part of the workflow's build.

import { mock } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, hexToBytes, type Hex } from "viem";
import type { ChainGame } from "../scoring/src/chain";
import type { HttpRequest, Seat } from "../scoring/src/types";
import { locate } from "../scoring/test/fixtures";
import { PAYOUT } from "../scoring/test/rule-helpers";
import { GAME_CREATED, type Config } from "./lib";
import { REPORTER, type FakeChain } from "./test-helpers";

/** The creation log's place every node is handed: its transaction and its index in the block. */
export const TX_HASH: Hex = `0x${"ab".repeat(32)}`;
export const LOG_INDEX = 3;

/** A GameCreated log as the trigger hands it: the game's identity and terms, and the log's place. */
export function creationLog(g: ChainGame) {
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
	return { topics: topics.map((t) => hexToBytes(t)), data: hexToBytes(data), blockNumber: 96_000_000n, txHash: hexToBytes(TX_HASH), index: LOG_INDEX };
}

/** A cron fire's payload, scheduled at `seconds`. */
export function tickPayload(seconds: number) {
	return { scheduledExecutionTime: { seconds: BigInt(seconds) } };
}

/** A feed's answer: its status, its body and, when a test gives them, its headers. */
export interface FeedAnswer {
	readonly status: number;
	readonly body: string;
	readonly headers?: Readonly<Record<string, readonly string[]>>;
}

/** A request the handler asked the enclave to send to the push's route: as built, and as filled. */
export interface PushSeen {
	readonly url: string;
	readonly method: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly filled: Readonly<Record<string, string>>;
	readonly body: string | undefined;
	readonly timeout: unknown;
	readonly secrets: readonly string[];
}

export interface World {
	readonly evm: FakeChain;
	readonly vault: Readonly<Record<string, string>>;
	/** A feed's answer to a request, its key filled; it may throw, as a request that fails. */
	readonly feed: (seat: Seat, req: HttpRequest) => FeedAnswer;
	/** The database's answer to the push; it may throw, as an endpoint that hangs past the cap or cannot be reached. */
	readonly push: (req: PushSeen) => { readonly status: number; readonly body: string };
	readonly writeError: string | null;
}

/** What one handler call did. */
export interface Run {
	readonly logs: string[];
	/** What happened, in order: "send <seat>", "write", "push". */
	readonly events: string[];
	/** The report bytes handed to the reporter, and the receiver each was addressed to. */
	readonly writes: { readonly report: Hex; readonly receiver: string }[];
	readonly pushes: PushSeen[];
	/** Every request the handler asked the enclave to send to a feed, as built. */
	readonly feeds: { readonly seat: Seat; readonly url: string; readonly headers: Readonly<Record<string, string>> }[];
	readonly returned: string | null;
	readonly threw: string | null;
	/** Every line the run put out: each runtime.log line, the returned line and the thrown error's text. */
	readonly lines: string[];
}

interface State extends World, Omit<Run, "returned" | "threw" | "lines"> {
	clock: number;
}

const result = <T>(value: T) => ({ result: () => value });

/** The handlers of main.ts, run against the stand-in, with the config given. */
export async function standIn(config: Config): Promise<{ handle: (index: number, payload: unknown, world: World) => Run }> {
	let state: State | null = null;
	const now = (): State => {
		if (state === null) throw new Error("no world");
		return state;
	};

	class EVMClient {
		callContract(_runtime: unknown, args: { call: { to: Hex; data: Hex } }) {
			return result({ data: hexToBytes(now().evm.call(args.call.to, args.call.data) as Hex) });
		}
		headerByNumber() {
			const h = now().evm.latest();
			return result({ header: { blockNumber: h.number, timestamp: h.timestamp } });
		}
		logTrigger(x: unknown) {
			return { creation: x };
		}
		writeReport(_runtime: unknown, args: { receiver: string; report: Hex }) {
			const s = now();
			s.events.push("write");
			s.writes.push({ report: args.report, receiver: args.receiver });
			return result(s.writeError === null ? { txStatus: 1 } : { txStatus: 2, errorMessage: s.writeError });
		}
	}

	class ConfidentialHTTPClient {
		sendRequest(
			_runtime: unknown,
			args: { vaultDonSecrets: { key: string }[]; request: { url: string; method: string; multiHeaders: Record<string, { values: string[] }>; bodyString?: string; timeout?: unknown } },
		) {
			const s = now();
			const { url, method, multiHeaders, bodyString, timeout } = args.request;
			const declared = args.vaultDonSecrets.map((x) => x.key);
			const headers = Object.fromEntries(Object.entries(multiHeaders).map(([k, v]) => [k, v.values[0]]));
			// The enclave: a stand-in for a secret the request names is filled on the way out, wherever it sits.
			const filled = Object.fromEntries(
				Object.entries(headers).map(([k, v]) => [k, v.replace(/\{\{\.([A-Z0-9_]+)\}\}/g, (m: string, id: string) => (declared.includes(id) ? (s.vault[id] ?? m) : m))]),
			);
			if (url.startsWith(config.runLineUrl)) {
				const seen: PushSeen = { url, method, headers, filled, body: bodyString, timeout, secrets: declared };
				s.events.push("push");
				s.pushes.push(seen);
				const a = s.push(seen);
				return result({ statusCode: a.status, body: new TextEncoder().encode(a.body), multiHeaders: {} });
			}
			const at = locate({ url, method: method as HttpRequest["method"], headers: {}, body: bodyString });
			if (at === null) throw new Error("a host outside the table");
			s.events.push(`send ${at.seat}`);
			s.feeds.push({ seat: at.seat, url, headers });
			const a = s.feed(at.seat, { url, method: method as HttpRequest["method"], headers: filled, body: bodyString });
			const answerHeaders = Object.fromEntries(Object.entries(a.headers ?? {}).map(([k, v]) => [k, { values: [...v] }]));
			return result({ statusCode: a.status, body: new TextEncoder().encode(a.body), multiHeaders: answerHeaders });
		}
	}

	type Handler = { callback: (runtime: unknown, payload: unknown) => string };
	let handlers: Handler[] = [];
	mock.module("@chainlink/cre-sdk", () => ({
		cre: {
			capabilities: { EVMClient, ConfidentialHTTPClient, CronCapability: class { trigger(x: unknown) { return { tick: x }; } } },
			handler: (trigger: unknown, callback: Handler["callback"]) => ({ trigger, callback }),
		},
		Runner: { newRunner: async () => ({ run: async (init: (c: Config) => Handler[]) => { handlers = init(config); } }) },
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

	const runtime = () => ({
		config,
		getSecret: ({ id }: { id: string }) => result({ value: now().vault[id] }),
		log: (line: string) => now().logs.push(line),
		report: (r: unknown) => result(r),
		// DON time, five milliseconds a read.
		now: () => new Date((now().clock += 5)),
	});

	return {
		handle(index, payload, world) {
			state = { ...world, logs: [], events: [], writes: [], pushes: [], feeds: [], clock: 1_793_750_400_000 };
			let returned: string | null = null;
			let threw: string | null = null;
			try {
				returned = handlers[index].callback(runtime(), payload);
			} catch (e) {
				threw = e instanceof Error ? e.message : String(e);
			}
			const s = state;
			state = null;
			return {
				logs: s.logs,
				events: s.events,
				writes: s.writes,
				pushes: s.pushes,
				feeds: s.feeds,
				returned,
				threw,
				lines: [...s.logs, ...(returned === null ? [] : [returned]), ...(threw === null ? [] : [threw])],
			};
		},
	};
}
