// Never: "An irreversible end never rests on an empty answer."
//
// An empty answer from any seat is silence: never absence, never a no-final. Absence needs a non-empty
// answer that lists the team's games without this one. A seat asked for one game (seats 1 and 2 by
// team, seat 3 and the spare by id) answers empty for a spelling the feed no longer uses, a filter it
// did not apply, an id it never had or a game it has dropped, as well as for a team with no game on
// the dates asked; an empty answer cannot tell those apart, so the seat is silent, and a score or a
// void after the window rests only on the seats that answered. The spare past the feed's three days is
// silent by its own date arithmetic, before any request.
//
// The break that turns this red (pick.ts, pick): the empty answer no longer silence,
//   if (listings.some((l) => l.length === 0)) return silent(seat, "empty listing");
//   ->  deleted
// with which a team's empty answer reads absent, and the one-queryable-team run below writes a void.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { readerFor } from "../src/index";
import { scoreGameSync } from "../src/program";
import { runSync } from "../src/run";
import { asksOf } from "../src/teams";
import type { HttpRequest, HttpResponse, Seat } from "../src/types";
import { CASES, LATE, NOW } from "./cases";
import { KEY, locate, saved } from "./fixtures";
import { PAYOUT, PAYOUT_REFUSED, chainOf } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const json = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });
const byName = (prefix: string) => CASES.find((c) => c.name.startsWith(prefix))!;
const lakers = byName("nba final: Golden State at the Lakers").game;
const hinted = { ...lakers, hints: [{ seat: 3, id: "edcfd41f-1773-4bc9-a349-aa50931a0278" }, { seat: 4, id: "0123456789abcdef0123456789abcdef" }] };

function readWith(seat: Seat, game: ChainGame | typeof lakers, send: (req: HttpRequest) => HttpResponse) {
	const asked: HttpRequest[] = [];
	const r = runSync(seat, readerFor(seat)({ game, now: NOW, key: KEY }), (q) => (asked.push(q), send(q)));
	return { kind: r.kind, detail: r.detail, asked: asked.map((q) => locate(q)?.path ?? "") };
}

describe("never: an irreversible end never rests on an empty answer", () => {
	test("an empty answer reads silent at every seat: seat 1's data, seat 2's results, seat 3's result, the spare by its id and by its slate", () => {
		expect(readWith(1, lakers, () => json({ data: [], meta: {} }))).toMatchObject({ kind: "silent", detail: "empty listing" });
		expect(readWith(2, lakers, () => json({ results: [] }))).toMatchObject({ kind: "silent", detail: "empty listing" });
		// One team's answer empty beside the other's: where the other's lists the game, the game's own record
		// is read, a reading from a non-empty answer; where the other's lists only other games, silence, never
		// absence, since the one team's empty answer says nothing.
		const [home] = asksOf("nba", lakers.home, lakers.away)!;
		const homeOnly = (answer: (res: HttpResponse) => HttpResponse) => (q: HttpRequest) => (new URL(q.url).searchParams.get("team") === home[2] ? answer(saved(undefined, NOW).send(q)) : json({ results: [] }));
		expect(readWith(2, lakers, homeOnly((res) => res))).toMatchObject({ kind: "final", detail: "final" });
		const withoutTheGame = (res: HttpResponse): HttpResponse => {
			const b = JSON.parse(res.body) as { results: { gameId: number }[] };
			return json({ ...b, results: b.results.filter((g) => g.gameId !== 340490) });
		};
		expect(readWith(2, lakers, homeOnly(withoutTheGame))).toMatchObject({ kind: "silent", detail: "empty listing" });
		expect(readWith(3, hinted, () => json([]))).toMatchObject({ kind: "silent", detail: "no result for the hint" });
		// The spare: an empty answer for its id, then its slate empty, two requests, silence.
		const spare = readWith(4, hinted, () => json([]));
		expect([spare.kind, spare.detail, spare.asked.length, spare.asked[0].includes("eventIds=")]).toEqual(["silent", "empty listing", 2, true]);
		expect(readWith(4, lakers, () => json([]))).toMatchObject({ kind: "silent", detail: "empty listing" });
	});

	test("absence needs a non-empty answer: the teams' other games listed and this one not", () => {
		// The Lakers' saved answers with the game's own record removed: seat 1 and seat 2 still list other
		// games of the two teams on the window's dates, and say the game is absent; the spare's slate too.
		const without = (seat: Seat): HttpResponse["body"] extends string ? (q: HttpRequest) => HttpResponse : never =>
			((q: HttpRequest): HttpResponse => {
				const res = saved(undefined, NOW).send(q);
				const body = JSON.parse(res.body) as Record<string, unknown> | unknown[];
				if (seat === 1) return json({ ...(body as Record<string, unknown>), data: ((body as { data: { id: number }[] }).data ?? []).filter((g) => g.id !== 21717859) });
				if (seat === 2) return json({ ...(body as Record<string, unknown>), results: ((body as { results: { gameId: number }[] }).results ?? []).filter((g) => g.gameId !== 340490) });
				return json((body as { id: string }[]).filter((g) => g.id !== "6fff70f4bf196dba25060a5775a03b54"));
			}) as never;
		// Seats 1 and 2 list the teams' other games on the dates and not this one: absent. The spare's slate
		// also lists the two teams' later game, outside the window: it names that one.
		for (const seat of [1, 2, 4] as const) {
			const r = readWith(seat, lakers, without(seat));
			expect({ seat, kind: r.kind, detail: r.detail }).toEqual({ seat, kind: "no_final", detail: seat === 4 ? "outside window" : "absent" });
		}
	});

	test("the one-queryable-team run: seat 2 asks for the one team its list spells; that team's empty answer is silence, and after the window the run waits; the control, the final listed, disputes", () => {
		// A college football game whose home team seat 2's list lacks (no query spelling), so seat 2 asks
		// for the away team alone. After the window: seat 1 reads the game still on, seat 3 is silent for
		// the game (the start report marked it), the counting spare refuses its request. The control lists
		// the away team's final at seat 2, and the run disputes: finals beside an answer without one. The
		// away team respelt by the feed, the one query answers empty: silence, and the run waits, with
		// fewer than two counting seats answering. Nothing is written either way but the dispute record.
		const base = chainOf("nba final, read after the game");
		const college: ChainGame = {
			...base,
			id: "1",
			league: "ncaaf",
			home: "Abilene Christian",
			away: "Alabama",
			hints: [],
			startReadings: base.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: 0 as const } : r)),
			payoutRefused: PAYOUT_REFUSED,
		};
		const asks = asksOf(college.league, college.home, college.away)!;
		expect([asks[0][2], asks[1][2] !== null]).toEqual([null, true]);
		const row = (respell: boolean) => ({
			gameId: "college-1",
			schedule: { date: new Date((college.start as number) * 1000).toISOString() },
			teams: { home: { team: "Abilene Christian", conference: "a conference" }, away: { team: respell ? "Alabama Crimson Tyde" : asks[1][2], conference: "a conference" } },
			scoreboard: { currentPeriod: 4, score: { home: 17, away: 24 } },
			status: "final",
		});
		const after = (college.start as number) + college.n + 600;
		for (const respell of [false, true]) {
			const listed = row(respell);
			const sent: string[] = [];
			const o = scoreGameSync(college, KEYS, PAYOUT, after, (q) => {
				const at = locate(q)!;
				sent.push(at.path);
				if (at.seat === 1) return json({ data: [{ id: "college-seat1", date: new Date((college.start as number) * 1000).toISOString(), home_team: { full_name: college.home, college: college.home }, visitor_team: { full_name: college.away, college: college.away }, status_state: "in_progress", home_score: 17, away_score: 24 }], meta: {} });
				if (at.seat === 2) {
					const team = new URL(q.url).searchParams.get("team");
					return json({ results: [listed].filter((g) => [g.teams.home.team, g.teams.away.team].includes(team as string)) });
				}
				if (at.seat === 4) return { status: 500, body: "unavailable" };
				throw new Error("seat 3 is silent for this game");
			});
			expect(sent.filter((p) => p.includes("team=")).length).toBe(1);
			expect({ respell, action: o.decision.action, why: o.decision.why, report: o.report?.kind ?? null }).toEqual(
				respell ? { respell, action: "wait", why: "after n: fewer than two counting seats answer", report: null } : { respell, action: "dispute", why: "after n: finals beside answers without a final", report: 4 },
			);
		}
	});

	test("the spare past the feed's three days is silent by its own date arithmetic, before any request; inside them, an empty answer for its id is silence and the slate decides", () => {
		const old = { ...hinted, start: NOW - 5 * 86_400 };
		const past = readWith(4, old, () => json([]));
		expect([past.kind, past.detail, past.asked]).toEqual(["silent", "past retention", []]);
		// Inside them: the id answers empty, the slate lists other games and not this one: absent, by the slate.
		const slate = saved(undefined, LATE);
		const inside = readWith(4, { ...hinted, start: LATE - 3_600 }, (q) => (q.url.includes("eventIds=") ? json([]) : slate.send(q)));
		expect([inside.kind, inside.asked.length]).toEqual(["no_final", 2]);
		// The captured old game, asked for by its id at the capture's own clock inside the three days: the
		// feed answered an empty list, which is silence, and the slate, listing other games, said absent.
		const capture = chainOf("nfl final: Washington at San Francisco", { hints: [{ seat: 4, id: "f122527f003276d3bca19efa48c902c1" }] });
		const t = saved(undefined, Date.UTC(2026, 9, 28, 18, 30) / 1000);
		const r = runSync(4, readerFor(4)({ game: capture, now: capture.start! + 3_600, key: KEY }), t.send);
		expect([t.misses, t.asked.length, r.kind, r.detail]).toEqual([[], 2, "no_final", "absent"]);
	});
});
