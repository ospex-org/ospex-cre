// The run-line: one row per seat for each execution that asked any seat, written to runtime.log and then
// pushed once to the database's table, after the run is over. Monitoring (durations per hop, a seat's
// silence, the spare's quota) is read from the table afterwards. Nothing here gates scoring.
//
// What a row says about one seat in one execution:
//   requests            requests actually sent to the seat's host. An answer from the run's memory is
//                       not a request, and a request the count refuses is never sent.
//   answered, silent,   each read of the seat the execution reached, by how it ended
//   skipped             (scoring/src/observe.ts). A read is one reader's run, the program's or the
//                       probe's, or seat 3's board check.
//   elapsed_ms,         one entry per request, in send order: DON time after the call less DON time
//   statuses            before it, and the HTTP status. An entry is null where DON time could not be
//                       read, or where the call raised with no response.
//   quota, remaining    the spare's only: each request's quota header as a whole number (null where it
//                       is absent or not a whole number), and the last request's. Null at other seats.
//
// Rows are written for all four seats when the execution sent at least one request to any of them, and
// not at all otherwise: a tick that asks nothing writes nothing.
//
// The push: one POST of every row, as one JSON array, to the table's Data API URL. It asks the database
// to skip any row whose (run key, seat) the table already holds, so a retry, or a second node sending
// the same batch, never doubles a row. It is the execution's reserved fifteenth request (lib.ts,
// RUN_LINE_REQUESTS), capped at five seconds by the request's own timeout. It is sent after the run,
// with the report written or the run's error caught, and whatever it meets, the run's result stands as
// it was. A push that fails leaves a gap in the table: the run key's rows are in runtime.log and not in
// the table.
//
// Nothing here carries a key, a URL or a feed's words: a row holds numbers, the run key, the workflow's
// name and the execution's kind. The push's own key is a vault secret, which the enclave fills into the
// push's one header; the workflow never holds it.

import { cleanLine } from "../scoring/src/line";
import type { Observer, ReadOutcome } from "../scoring/src/observe";
import { SEATS, SPARE } from "../scoring/src/table";
import type { HttpRequest, HttpResponse, Seat } from "../scoring/src/types";
import { FEED_REQUESTS, REQUESTS_PER_EXECUTION, counted, memoized } from "./lib";

/** The name the workflow is registered under (workflow.yaml); a new name, beside the live workflow, never in its place. */
export const WORKFLOW_NAME = "osgames2";
/** The vault secret holding the push's key: the database role that may only add rows to the table. */
export const RUN_LINE_SECRET = "RUN_LINE_KEY";
/** The push's time cap, as the request's own timeout. */
export const RUN_LINE_TIMEOUT = "5s";
/** The spare's quota header: the requests its key has left. */
export const QUOTA_HEADER = "x-requests-remaining";
/** The table's key, which the push asks the database to skip on: a row it already holds is not added again. */
export const ON_CONFLICT = "run_key,seat";

export type Kind = "creation" | "tick";

/** A request as the execution's transport sends it: a reader's, or the push's, which adds its timeout and the vault secret the enclave fills into its header. */
export interface Sent extends HttpRequest {
	readonly timeout?: string;
	readonly secrets?: readonly string[];
}

/** An answer as the transport receives it: the status and body the readers get, and the headers, which only the record reads. */
export interface Answer extends HttpResponse {
	readonly headers: Readonly<Record<string, readonly string[]>>;
}

/** One row of the table, as the push sends it and the log shows it: the table's columns, less the database's own time. */
export interface Row {
	readonly run_key: string | null;
	readonly seat: Seat;
	readonly workflow: string;
	readonly kind: Kind;
	readonly requests: number;
	readonly answered: number;
	readonly silent: number;
	readonly skipped: number;
	readonly elapsed_ms: readonly (number | null)[];
	readonly statuses: readonly (number | null)[];
	readonly quota: readonly (number | null)[] | null;
	readonly remaining: number | null;
}

/** What an execution has seen of each seat: told every read by the program and the probe, and every request by the transport. */
export interface Recorder extends Observer {
	sent(seat: Seat, elapsed: number | null, status: number | null, quota: number | null): void;
	/** The requests sent to every seat. */
	requests(): number;
	/** Every seat's row when any seat was sent a request, in seat order; none otherwise. */
	rows(runKey: string | null, kind: Kind): Row[];
}

interface Tally {
	requests: number;
	answered: number;
	silent: number;
	skipped: number;
	readonly elapsed: (number | null)[];
	readonly statuses: (number | null)[];
	readonly quota: (number | null)[];
}

export function recorder(): Recorder {
	const tallies = new Map<Seat, Tally>(
		SEATS.map((r) => [r.seat, { requests: 0, answered: 0, silent: 0, skipped: 0, elapsed: [], statuses: [], quota: [] }] as const),
	);
	const requests = (): number => [...tallies.values()].reduce((n, t) => n + t.requests, 0);
	return {
		read(seat: Seat, outcome: ReadOutcome) {
			const t = tallies.get(seat);
			if (t !== undefined) t[outcome]++;
		},
		sent(seat, elapsed, status, quota) {
			const t = tallies.get(seat);
			if (t === undefined) return;
			t.requests++;
			t.elapsed.push(elapsed);
			t.statuses.push(status);
			t.quota.push(quota);
		},
		requests,
		rows(runKey, kind) {
			if (requests() === 0) return [];
			return SEATS.map((r) => {
				const t = tallies.get(r.seat) as Tally;
				const spare = r.seat === SPARE;
				return {
					run_key: runKey,
					seat: r.seat,
					workflow: WORKFLOW_NAME,
					kind,
					requests: t.requests,
					answered: t.answered,
					silent: t.silent,
					skipped: t.skipped,
					elapsed_ms: [...t.elapsed],
					statuses: [...t.statuses],
					quota: spare ? [...t.quota] : null,
					remaining: spare && t.quota.length > 0 ? t.quota[t.quota.length - 1] : null,
				};
			});
		},
	};
}

const HOST = /^https:\/\/([^/?#]+)/;

/** The seat whose host a request goes to, by the feed table, or null when it is none of theirs. */
export function seatOfUrl(url: string): Seat | null {
	const m = HOST.exec(url);
	if (m === null) return null;
	const host = m[1].toLowerCase();
	return SEATS.find((r) => r.host === host)?.seat ?? null;
}

const WHOLE = /^[0-9]{1,9}$/;

/** The spare's quota header as a whole number, or null when the answer carries none or the header is not one. */
export function quotaOf(headers: Answer["headers"]): number | null {
	for (const [name, values] of Object.entries(headers)) {
		if (name.toLowerCase() !== QUOTA_HEADER) continue;
		const v = (values[0] ?? "").trim();
		return WHOLE.test(v) ? Number(v) : null;
	}
	return null;
}

/**
 * The transport, observed: every request it sends to a seat's host is told to the record with the DON
 * time around it, its status and, for the spare, its quota header; the readers get the status and the
 * body as before, and never the headers. It sits below the run's memory and its count, so a request
 * answered from memory or refused by the count is never told. The clock is DON time (runtime.now()),
 * the same on every node; a clock that cannot be read gives a null entry, never a stopped request, and
 * nothing the record does reaches the request or its answer. A request to a host no seat has is sent
 * and not told: the readers build every request from the feed table, so none is.
 */
export function observed(send: (req: Sent) => Answer, record: Recorder, clock: () => number): (req: HttpRequest) => HttpResponse {
	const time = (): number | null => {
		try {
			const t = clock();
			return Number.isFinite(t) ? t : null;
		} catch {
			return null;
		}
	};
	const tell = (seat: Seat, before: number | null, answer: Answer | null): void => {
		try {
			const after = time();
			const elapsed = before !== null && after !== null && after >= before ? after - before : null;
			record.sent(seat, elapsed, answer === null ? null : answer.status, answer !== null && seat === SPARE ? quotaOf(answer.headers) : null);
		} catch {
			// The record never stops a request.
		}
	};
	return (req) => {
		const seat = seatOfUrl(req.url);
		if (seat === null) {
			const answer = send(req);
			return { status: answer.status, body: answer.body };
		}
		const before = time();
		let answer: Answer;
		try {
			answer = send(req);
		} catch (e) {
			tell(seat, before, null);
			throw e;
		}
		tell(seat, before, answer);
		return { status: answer.status, body: answer.body };
	};
}

/** One execution's confidential HTTP: the record, the feeds' transport and the push's slot, under one count of 15. */
export interface Execution {
	readonly record: Recorder;
	/** The feeds': observed, under the execution's count, then the feeds' count of 14, then the run's memory. */
	readonly feeds: (req: HttpRequest) => HttpResponse;
	/** The push's: the slot the feeds' count leaves in the execution's 15. */
	readonly push: (req: Sent) => HttpResponse;
	/** Every request the execution's count let through, the feeds' and the push's. */
	readonly sent: () => number;
}

/**
 * The execution's transports from the raw one (main.ts, through the enclave) and DON time. One count of
 * REQUESTS_PER_EXECUTION holds everything the execution sends; the feeds' own count of FEED_REQUESTS sits
 * above it, so the feeds can never take the push's slot and the push can never be a sixteenth.
 */
export function execution(raw: (req: Sent) => Answer, clock: () => number): Execution {
	const record = recorder();
	const all = counted<Sent, Answer>(raw, REQUESTS_PER_EXECUTION);
	const feeds = memoized(counted(observed(all.send, record, clock), FEED_REQUESTS).send);
	return {
		record,
		feeds,
		push: (req) => {
			const answer = all.send(req);
			return { status: answer.status, body: answer.body };
		},
		sent: all.used,
	};
}

// ──────────────────────────── The run key ─────────────────────────────

const TX_HASH = /^0x[0-9a-f]{64}$/;

/**
 * A creation run's key: the workflow's name and the creation log's place, its transaction and its index
 * in the block. Every node and every retry of the execution reads the same log, so they share the key.
 * Null for a log without a readable place: its rows are logged and not pushed.
 */
export function creationKey(txHash: string, logIndex: number): string | null {
	const hash = txHash.toLowerCase();
	if (!TX_HASH.test(hash) || !Number.isSafeInteger(logIndex) || logIndex < 0) return null;
	return `${WORKFLOW_NAME}:creation:${hash}:${logIndex}`;
}

/** A run key made from the trigger's fields: a trigger whose fields cannot be read gives no key, never a stopped run. */
export function keyFrom(make: () => string | null): string | null {
	try {
		return make();
	} catch {
		return null;
	}
}

/**
 * A tick's key: the workflow's name, the shard, and the cron's scheduled time in seconds, which every
 * node and every retry of the execution is handed alike. Null when the trigger carried no time.
 */
export function tickKey(shard: number, scheduled: bigint): string | null {
	if (!Number.isSafeInteger(shard) || shard < 0 || scheduled <= 0n) return null;
	return `${WORKFLOW_NAME}:tick:${shard}:${scheduled}`;
}

// ──────────────────────────── The push ────────────────────────────────

/** Where the push goes, from the config: the table's Data API URL and the project's publishable key. */
export interface Route {
	readonly url: string;
	readonly publishableKey: string;
}

/**
 * The push: one POST of every row as one JSON array, skipping the rows whose (run key, seat) the table
 * holds already, with nothing sent back. Its key is the vault secret's stand-in in its one header,
 * which the enclave fills; the body is the rows and nothing else.
 */
export function pushRequest(rows: readonly Row[], route: Route): Sent {
	return {
		method: "POST",
		url: `${route.url}?on_conflict=${ON_CONFLICT}`,
		headers: {
			"Content-Type": "application/json",
			apikey: route.publishableKey,
			Authorization: `Bearer {{.${RUN_LINE_SECRET}}}`,
			Prefer: "resolution=ignore-duplicates,return=minimal",
		},
		body: JSON.stringify(rows),
		timeout: RUN_LINE_TIMEOUT,
		secrets: [RUN_LINE_SECRET],
	};
}

/** What one execution's record needs to be written: its key and kind, the route, the log, and the secrets to keep off a line. */
export interface Delivery {
	readonly runKey: string | null;
	readonly kind: Kind;
	readonly route: Route;
	readonly log: (line: string) => void;
	/** The configured secret values (scoring/src/line.ts, secretsOf), redacted from the push's line. */
	readonly secrets: readonly string[];
}

const JWT = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer)\s+[^\s"',;]+/gi;
const SECRET_KEY = /\bsb_secret_[A-Za-z0-9_-]+/g;
const SAID = 160;

/** What a failed push said, for its line: the configured secrets, anything shaped like a token and a bearer's value redacted, cut short. */
function said(e: unknown, secrets: readonly string[]): string {
	const message = e instanceof Error ? e.message : String(e);
	const text = cleanLine(message, secrets).replace(JWT, "[redacted]").replace(BEARER, "$1 [redacted]").replace(SECRET_KEY, "[redacted]").replace(/\s+/g, " ").trim();
	return text.length > SAID ? `${text.slice(0, SAID)}...` : text;
}

const CODE = /^(PGRST[0-9]{3}|[0-9A-Z]{5})$/;

/** The database's error code from a refused push's body, when it carries one in the database's own form. */
function codeOf(body: string): string {
	try {
		const code = (JSON.parse(body) as { code?: unknown } | null)?.code;
		return typeof code === "string" && CODE.test(code) ? ` ${code}` : "";
	} catch {
		return "";
	}
}

/** The one push, and its line: the status the database answered, or that none came. It never throws. */
function pushOnce(push: (req: Sent) => HttpResponse, rows: readonly Row[], d: Delivery): string {
	let res: HttpResponse;
	try {
		res = push(pushRequest(rows, d.route));
	} catch (e) {
		return `run-line push: no answer: ${said(e, d.secrets)}`;
	}
	return `run-line push: http ${res.status}${codeOf(res.body)}`;
}

/**
 * The rows to the log, one line each, then the one push and its line. Nothing when no seat was asked.
 * The push is guarded by its own catch (pushOnce), and a log line that fails is dropped, so nothing here
 * throws.
 */
export function deliver(d: Delivery, ex: Pick<Execution, "record" | "push">): void {
	const log = (line: string): void => {
		try {
			d.log(line);
		} catch {
			// A line the log refuses is lost; the run goes on.
		}
	};
	const rows = ex.record.rows(d.runKey, d.kind);
	if (rows.length === 0) return;
	for (const row of rows) log(`run-line ${JSON.stringify(row)}`);
	if (d.runKey === null) {
		log("run-line push: not sent: the trigger gave no run key");
		return;
	}
	log(pushOnce(ex.push, rows, d));
}

/**
 * Runs the execution's body, then delivers its record: the rows to the log, then the push. The body's
 * result, or its error, is what the execution returns or throws, as it would without the record; the
 * push only follows it, by at most its time cap.
 */
export function recorded<T>(d: Delivery, ex: Pick<Execution, "record" | "push">, body: () => T): T {
	let result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
	try {
		result = { ok: true, value: body() };
	} catch (error) {
		result = { ok: false, error };
	}
	deliver(d, ex);
	if (!result.ok) throw result.error;
	return result.value;
}
