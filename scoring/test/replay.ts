// The cases record's replay harness. A case is one odd game, pinned for good: the game as the
// chain holds it, the run's clock, the exact feed payloads the run rests on (each by seat, path and
// SHA-256), and the outcome. Replaying a case serves those payloads and nothing else, runs the
// program, and holds it to the outcome. A request the case does not list, a payload whose bytes
// changed, or a listed payload the run no longer asks for, and the case fails.
//
// Cases name feeds by seat only, as every record of the program does. The public cases record
// lives in ospex-artifacts; its entries' payloads are saved here, under fixtures/, and replayed here.
//
// The readers ask for one game at a time (seat 1 for the two teams' games on the dates, seat 2 for each
// team's games, seat 3 for its result by hint and its board's row by id, the spare by its id or for its
// slate), and a case's payloads are the feed's own answers to those requests, captured: a request is
// answered by the listed payload for its exact path, by seat, and by nothing else.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainGame, ReportReading } from "../src/chain";
import { scoreGameSync } from "../src/program";
import type { HttpRequest, HttpResponse, Seat } from "../src/types";
import { INDEX, KEY, ROOT, at, bytesOf, locate } from "./fixtures";
import { PAYOUT, PAYOUT_REFUSED } from "./rule-helpers";

export const CASES_DIR = join(import.meta.dir, "..", "cases");

/** A reading as a case writes it: [seat, kind] in a start report, [seat, kind, home, away] elsewhere. */
type Pair = readonly [number, 0 | 1 | 2];
type Quad = readonly [number, 0 | 1 | 2, number, number];

export interface CaseFile {
	readonly case: string;
	readonly what: string;
	readonly game: {
		readonly league: string;
		readonly home: string;
		readonly away: string;
		readonly date: string;
		readonly hints: ReadonlyArray<{ readonly seat: number; readonly id: string }>;
		readonly n: number;
		readonly day7: number;
		readonly status: ChainGame["status"];
		readonly start: string | null;
		readonly startReadings: readonly Pair[] | null;
		readonly dispute?: { readonly at: string; readonly records: readonly (readonly Quad[])[] } | null;
	};
	readonly run: string;
	readonly payloads: ReadonlyArray<{ readonly seat: Seat; readonly path: string; readonly sha256: string }>;
	readonly outcome: {
		readonly action: "start" | "score" | "void" | "dispute" | "wait";
		readonly report: { readonly kind: number; readonly start: number; readonly home: number; readonly away: number; readonly readings: readonly Quad[] } | null;
	};
	readonly logic: string;
}

export function loadCases(): { file: string; text: string; c: CaseFile }[] {
	return readdirSync(CASES_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((file) => {
			const text = readFileSync(join(CASES_DIR, file), "utf8");
			return { file, text, c: JSON.parse(text) as CaseFile };
		});
}

const quad = (r: Quad): ReportReading => ({ seat: r[0], kind: r[1], homeScore: r[2], awayScore: r[3] });

export function chainGameOf(c: CaseFile): ChainGame {
	const g = c.game;
	return {
		id: "1",
		league: g.league,
		home: g.home,
		away: g.away,
		date: at(g.date),
		hints: g.hints,
		n: g.n,
		day7: g.day7,
		status: g.status,
		start: g.start === null ? null : at(g.start),
		startReadings: g.startReadings === null ? null : g.startReadings.map((p) => ({ seat: p[0], kind: p[1], homeScore: 0, awayScore: 0 })),
		dispute: g.dispute ? { at: at(g.dispute.at), records: g.dispute.records.map((r) => r.map(quad)) } : null,
		payoutRefused: PAYOUT_REFUSED,
	};
}

export interface Replay {
	readonly outcome: CaseFile["outcome"];
	/** Requests the case does not list, by seat and path. */
	readonly unlisted: string[];
	/** Listed payloads the run never asked for. */
	readonly unasked: string[];
	/** Listed payloads whose saved bytes no longer hash to the case's SHA-256. */
	readonly changed: string[];
}

/** Replays one case: its payloads only, its game, its clock. */
export function replay(c: CaseFile): Replay {
	const changed: string[] = [];
	const served = new Map<string, Uint8Array>();
	for (const p of c.payloads) {
		const entry = INDEX.find((e) => e.seat === p.seat && e.path === p.path && e.sha256 === p.sha256);
		const bytes = entry === undefined ? null : bytesOf(entry.file);
		if (bytes === null || createHash("sha256").update(bytes).digest("hex") !== p.sha256) changed.push(`seat ${p.seat} ${p.path}`);
		else served.set(`${p.seat} ${p.path}`, bytes);
	}
	const unlisted: string[] = [];
	const asked = new Set<string>();
	const listed = (seat: Seat, path: string): HttpResponse => {
		const k = `${seat} ${path}`;
		asked.add(k);
		const bytes = served.get(k);
		if (bytes === undefined) {
			unlisted.push(`seat ${seat} ${path}`);
			throw new Error("not in the case");
		}
		const entry = INDEX.find((e) => `${e.seat} ${e.path}` === k && e.sha256 === c.payloads.find((p) => `${p.seat} ${p.path}` === k)!.sha256)!;
		return { status: entry.status, body: new TextDecoder().decode(bytes) };
	};
	const send = (req: HttpRequest): HttpResponse => {
		const l = locate(req);
		if (l === null) {
			unlisted.push("a host outside the table");
			throw new Error("not in the case");
		}
		return listed(l.seat, l.path);
	};
	const keys = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
	const o = scoreGameSync(chainGameOf(c), keys, PAYOUT, at(c.run), send);
	const unasked = c.payloads.filter((p) => !asked.has(`${p.seat} ${p.path}`)).map((p) => `seat ${p.seat} ${p.path}`);
	const r = o.report;
	return {
		outcome: {
			action: o.decision.action,
			report:
				r === null
					? null
					: { kind: r.kind, start: r.start, home: r.homeScore, away: r.awayScore, readings: r.readings.map((x) => [x.seat, x.kind, x.homeScore, x.awayScore] as Quad) },
		},
		unlisted,
		unasked,
		changed,
	};
}

/** The root the payloads are saved under, for a case's README. */
export const PAYLOADS_ROOT = ROOT;
