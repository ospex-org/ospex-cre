// The one-time capture: runs the readers against the live feeds and saves every answer as a
// fixture. Run it with each seat's key in OSPEX_SEAT1_KEY .. OSPEX_SEAT4_KEY:
//
//   bun capture/capture.ts <plan.json>
//
// The plan lists games to read on given seats ("asks") and extra paths to fetch as they are
// ("lists", the seats' team lists). Every request is the reader's own, built with the
// placeholder SEATKEY in place of the key; the real key is put in only at the moment of sending
// and is never printed or written. A fixture keeps the answer's exact bytes; the index beside
// it (fixtures/index.json) keeps the seat, the path, the status and when, never the host, so no
// file but the table names a feed. Each seat is paced to its tier, and the calls are counted.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readerFor } from "../src/index";
import { seatRow } from "../src/table";
import type { Game, HttpRequest, HttpResponse, Seat } from "../src/types";

export const PLACEHOLDER = "SEATKEY";
const ROOT = join(import.meta.dir, "..", "fixtures");
const INDEX = join(ROOT, "index.json");

/** Milliseconds between calls, per seat, under each seat's tier. */
const PACE: Record<Seat, number> = { 1: 13_000, 2: 1_500, 3: 1_000, 4: 2_000 };

export interface Entry {
	seat: Seat;
	path: string;
	status: number;
	file: string;
	sha256: string;
	bytes: number;
	capturedAt: string;
	pending?: string;
}

interface Plan {
	asks?: { seat: Seat; game: Game; now?: number }[];
	lists?: { seat: Seat; league: string; path: string; follow?: "cursor" }[];
}

function keyOf(seat: Seat): string {
	const k = process.env[`OSPEX_SEAT${seat}_KEY`];
	if (!k) throw new Error(`OSPEX_SEAT${seat}_KEY is not set`);
	return k;
}

function pathOf(seat: Seat, url: string): string {
	const prefix = `https://${seatRow(seat).host}`;
	if (!url.startsWith(prefix)) throw new Error(`request for seat ${seat} left its host`);
	return url.slice(prefix.length);
}

function fileFor(seat: Seat, league: string, path: string): string {
	const row = seatRow(seat);
	const keyParam = "query" in row.key ? `${row.key.query}=${PLACEHOLDER}` : null;
	const slug = (keyParam === null ? path : path.replace(`?${keyParam}`, "").replace(`&${keyParam}`, ""))
		.replace(/\[\]/g, "")
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();
	return `seat${seat}/${league}/${slug}.json`;
}

const index: Entry[] = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : [];
const byPath = new Map(index.map((e) => [`${e.seat} ${e.path}`, e]));
const last: Partial<Record<Seat, number>> = {};
const calls: Record<Seat, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

async function send(seat: Seat, league: string, req: HttpRequest): Promise<HttpResponse> {
	const path = pathOf(seat, req.url);
	const known = byPath.get(`${seat} ${path}`);
	if (known) {
		const body = readFileSync(join(ROOT, known.file), "utf8");
		return { status: known.status, body };
	}
	const wait = (last[seat] ?? 0) + PACE[seat] - Date.now();
	if (wait > 0) await Bun.sleep(wait);
	last[seat] = Date.now();
	const key = keyOf(seat);
	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(req.headers)) headers[k] = v === PLACEHOLDER ? key : v;
	const url = req.url.replace(`=${PLACEHOLDER}`, `=${key}`);
	let res: Response;
	try {
		calls[seat]++;
		res = await fetch(url, { method: "GET", headers, redirect: "manual" });
	} catch (e) {
		console.log(`seat ${seat} ${path} -> transport error (${(e as Error).name})`);
		throw new Error("transport");
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	const file = fileFor(seat, league, path);
	mkdirSync(dirname(join(ROOT, file)), { recursive: true });
	writeFileSync(join(ROOT, file), bytes);
	const entry: Entry = {
		seat,
		path,
		status: res.status,
		file,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		bytes: bytes.length,
		capturedAt: new Date().toISOString(),
	};
	index.push(entry);
	byPath.set(`${seat} ${path}`, entry);
	writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`);
	console.log(`seat ${seat} ${path} -> ${res.status} ${bytes.length} bytes`);
	return { status: res.status, body: new TextDecoder().decode(bytes) };
}

async function drive(seat: Seat, game: Game, now: number): Promise<void> {
	const run = readerFor(seat)({ game, now, key: PLACEHOLDER });
	let step = run.next(undefined as unknown as HttpResponse);
	while (!step.done) step = run.next(await send(seat, game.league, step.value));
	const r = step.value;
	console.log(`  seat ${seat} ${game.league} ${game.away} at ${game.home}: ${r.kind} (${r.detail})`);
}

async function fetchList(seat: Seat, league: string, path: string, follow?: "cursor"): Promise<void> {
	let next: string | null = path;
	while (next !== null) {
		const res = await send(seat, league, {
			method: "GET",
			url: `https://${seatRow(seat).host}${next}`,
			headers: listHeaders(seat),
		});
		next = null;
		if (follow === "cursor" && res.status === 200) {
			const c = JSON.parse(res.body)?.meta?.next_cursor;
			if (c !== undefined && c !== null && c !== "") next = `${path}&cursor=${c}`;
		}
	}
}

function listHeaders(seat: Seat): Record<string, string> {
	const row = seatRow(seat);
	const h: Record<string, string> = { ...row.headers };
	if ("header" in row.key) h[row.key.header] = PLACEHOLDER;
	return h;
}

const planFile = process.argv[2];
if (!planFile) throw new Error("usage: bun capture/capture.ts <plan.json>");
const plan: Plan = JSON.parse(readFileSync(planFile, "utf8"));
for (const a of plan.asks ?? []) await drive(a.seat, a.game, a.now ?? Math.floor(Date.now() / 1000));
for (const l of plan.lists ?? []) {
	const key = seatRow(l.seat).key;
	const path = "query" in key ? `${l.path}${l.path.includes("?") ? "&" : "?"}${key.query}=${PLACEHOLDER}` : l.path;
	await fetchList(l.seat, l.league, path, l.follow);
}
console.log(`calls this run: seat 1 ${calls[1]}, seat 2 ${calls[2]}, seat 3 ${calls[3]}, seat 4 ${calls[4]}`);
