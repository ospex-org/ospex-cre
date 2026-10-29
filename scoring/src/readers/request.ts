// Building a request for a seat: the host, the fixed headers and where the key goes all come from
// the feed table, so no reader names a host or a header of its feed.

import { seatRow } from "../table";
import type { HttpRequest, HttpResponse, Seat } from "../types";

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

/**
 * The body as JSON, when the answer was a 200 that parses; otherwise why not, and whether a body
 * arrived at all. A request that failed, or an empty body, brought nothing: clean silence to a reader
 * that saw no rows yet. A body that is not JSON is a non-empty body that is not the feed's list, an
 * answer the reader could not use (types.ts, answer).
 */
export function jsonOf(res: HttpResponse): { ok: true; value: unknown } | { ok: false; detail: string; arrived: boolean } {
	if (res.status !== 200) return { ok: false, detail: `http ${res.status}`, arrived: false };
	if (res.body.trim() === "") return { ok: false, detail: "empty body", arrived: false };
	try {
		return { ok: true, value: JSON.parse(res.body) };
	} catch {
		return { ok: false, detail: "unreadable", arrived: true };
	}
}

/** A plain object, or null. */
export function obj(v: unknown): Record<string, unknown> | null {
	return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A non-empty string, or null. */
export function str(v: unknown): string | null {
	return typeof v === "string" && v.trim() !== "" ? v : null;
}
