// Building a request for a seat: the host, the fixed headers and where the key goes all come from
// the feed table, so no reader names a host or a header of its feed.

import { clean, silent } from "../run";
import { seatRow } from "../table";
import type { HttpRequest, HttpResponse, Reading, Seat } from "../types";

/**
 * A GET to `path` (with its query, already encoded) at the seat's host, carrying the seat's key, or a
 * POST of `body` (JSON text) to it. The key goes in as given, unencoded, so a caller can hand in a
 * placeholder its transport fills.
 */
export function request(seat: Seat, path: string, key: string, body?: string): HttpRequest {
	const row = seatRow(seat);
	const headers: Record<string, string> = { ...row.headers };
	let url = `https://${row.host}${path}`;
	if ("header" in row.key) headers[row.key.header] = key;
	else url += `${path.includes("?") ? "&" : "?"}${row.key.query}=${key}`;
	if (body === undefined) return { method: "GET", url, headers };
	return { method: "POST", url, headers: { ...headers, "content-type": "application/json" }, body };
}

/** What a request brought: the body as JSON when the status was 2xx and the body parses, or why not. */
export type Body = { readonly ok: true; readonly value: unknown } | Failure;

/** A request that brought no 2xx JSON body. */
export interface Failure {
	readonly ok: false;
	/** Why: `http N` for a status outside 2xx; `empty body` or `unreadable` (not JSON) for a 2xx. */
	readonly detail: string;
	/** Whether a body arrived, whatever the status. */
	readonly arrived: boolean;
	/**
	 * The status outside 2xx, with the body as JSON when it parses (`json` undefined when it does not):
	 * the reader looks there for the game's row (failed, below). Null for a 2xx.
	 */
	readonly http: { readonly status: number; readonly json: unknown } | null;
}

/**
 * The body as JSON when the status was 2xx and the body parses; otherwise why not. Status decides
 * nothing; the body does: a 2xx body is read by the readers' rules whatever its status, an empty body
 * brought nothing, and a status outside 2xx is a failure whose body the reader still reads for the
 * game's row (failed, below).
 */
export function jsonOf(res: HttpResponse): Body {
	const arrived = res.body.trim() !== "";
	let json: unknown;
	let parses = false;
	if (arrived) {
		try {
			json = JSON.parse(res.body);
			parses = true;
		} catch {
			parses = false;
		}
	}
	if (res.status < 200 || res.status >= 300) return { ok: false, detail: `http ${res.status}`, arrived, http: { status: res.status, json: parses ? json : undefined } };
	if (!arrived) return { ok: false, detail: "empty body", arrived: false, http: null };
	if (!parses) return { ok: false, detail: "unreadable", arrived: true, http: null };
	return { ok: true, value: json };
}

/**
 * The reading for a request that brought no 2xx JSON body. A status outside 2xx is a failure, clean
 * silence before any row arrived at the seat, unless its body is the feed's list and that list, read by
 * `read`, the one reading the reader gives a 2xx list (its rows, then the pick; null when the body is
 * not the feed's list), is anything but clean silence: a row the reading cannot parse, or any row for
 * the game, makes it an answer the reader could not use, exactly as under a 200, and it holds the void
 * (`the game's row in a 503`, the reading's own word beside it: `the game's row in a 503; result without
 * an id`). One path, not two: there is no parser of a failed body's own. An error object, a page or an
 * empty body on any status is a failure. A 2xx body that is empty brought nothing; one that is not JSON
 * is an answer the reader could not use. After rows arrived at the seat, any failure is partway through
 * its reads, and holds the void (types.ts, answer).
 */
export function failed(seat: Seat, body: Failure, read: (json: unknown) => Reading | null, rowsBefore: boolean): Reading {
	if (body.http !== null) {
		const r = read(body.http.json);
		if (r !== null && r.answer !== "nothing") return silent(seat, `the game's row in a ${body.http.status}${r.kind === "silent" ? `; ${r.detail}` : ""}`);
		return rowsBefore ? silent(seat, body.detail) : clean(seat, body.detail);
	}
	return rowsBefore || body.arrived ? silent(seat, body.detail) : clean(seat, body.detail);
}

/** A plain object, or null. */
export function obj(v: unknown): Record<string, unknown> | null {
	return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A non-empty string, or null. */
export function str(v: unknown): string | null {
	return typeof v === "string" && v.trim() !== "" ? v : null;
}
