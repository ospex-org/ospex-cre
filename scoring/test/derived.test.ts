// The suite answers a one-game request from the slate pages it would be drawn from, filtered the way
// the feed filters (test/fixtures.ts). Wherever the feed's own answer to such a request is saved (the
// capture's) and the slate pages it draws on are saved too, the suite's derivation at the capture's
// own clock must hold the same records: the same ids, and the same points for every record the pages
// already had final (a record still scheduled on a page saved days before the capture is final in the
// capture, and that is the pages' age, not the filter's). That holds the filter to the feed, record by
// record, on every such one-game answer captured.

import { describe, expect, test } from "bun:test";
import type { Seat } from "../src/types";
import { INDEX, bytesOf, fromPages, oneGameOf, type Entry } from "./fixtures";

/** The saved answer for a path as of a clock: the latest captured at or before it. */
function answerAsOf(seat: Seat, path: string, asOf: number): Entry | undefined {
	return INDEX.filter((e) => e.seat === seat && e.path === path && Math.floor(Date.parse(e.capturedAt) / 1000) <= asOf)
		.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt))
		.at(-1);
}

/** The records of an answer, by the seat's own id: whether final, and the points. */
function recordsOf(seat: Seat, body: unknown): Map<string, { final: boolean; points: string }> {
	const out = new Map<string, { final: boolean; points: string }>();
	const rows: Record<string, unknown>[] =
		seat === 1 ? ((body as { data?: Record<string, unknown>[] }).data ?? []) : seat === 2 ? ((body as { results?: Record<string, unknown>[] }).results ?? []) : Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
	for (const r of rows) {
		if (seat === 1) out.set(String(r.id), { final: r.status_state === "final", points: JSON.stringify([r.home_team_score ?? r.home_score ?? null, r.visitor_team_score ?? r.away_score ?? null]) });
		if (seat === 2) out.set(String(r.gameId), { final: r.status === "final", points: JSON.stringify((r.scoreboard as { score?: unknown } | undefined)?.score ?? null) });
		if (seat === 3) out.set(String(r.ID).toLowerCase(), { final: false, points: JSON.stringify([r.HomeTeam, r.AwayTeam]) });
		if (seat === 4) out.set(String(r.id), { final: r.completed === true, points: JSON.stringify(r.scores ?? null) });
	}
	return out;
}

const text = (file: string): string => new TextDecoder().decode(bytesOf(file));

/** The captured one-game answers whose slate pages are all saved as of the capture: the ones the derivation can be held to. */
const captured = INDEX.filter((e) => {
	const one = e.status === 200 ? oneGameOf(e.seat, e.path) : null;
	if (one === null) return false;
	const asOf = Math.floor(Date.parse(e.capturedAt) / 1000);
	return one.firsts.length > 0 && one.firsts.every((p) => answerAsOf(e.seat, p, asOf) !== undefined);
});

describe("the suite's one-game answers agree with the feed's, on every one-game answer captured with its pages", () => {
	test("there are such answers at every seat", () => {
		expect(new Set(captured.map((e) => e.seat))).toEqual(new Set([1, 2, 3, 4]));
		expect(captured.length).toBeGreaterThanOrEqual(24);
	});

	for (const e of captured) {
		test(`seat ${e.seat} ${e.path.slice(0, 100)}`, () => {
			const asOf = Math.floor(Date.parse(e.capturedAt) / 1000);
			const real = recordsOf(e.seat, JSON.parse(text(e.file)));
			const derived = fromPages(oneGameOf(e.seat, e.path)!, (path) => {
				const page = answerAsOf(e.seat, path, asOf);
				if (page === undefined) throw new Error(`no saved page ${path}`);
				return { status: page.status, body: text(page.file) };
			});
			expect(derived.status).toBe(200);
			const mine = recordsOf(e.seat, JSON.parse(derived.body));
			expect([...mine.keys()].sort()).toEqual([...real.keys()].sort());
			for (const [id, r] of mine) if (r.final) expect({ id, got: real.get(id) }).toEqual({ id, got: r });
		});
	}
});
