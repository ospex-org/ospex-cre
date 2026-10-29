// Never: "An irreversible end never rests on fewer than two counting seats' affirmative answers, and
// the void's silence is only clean silence."
//
// An affirmative answer is the game's own row, bound by its ids or names and time, that says in the
// feed's own words what became of the game: a final, or that the game will not or did not play
// (postponed or cancelled, and nothing else: a scheduled row is an answer, never a void's vote). A
// void after n needs two counting seats' affirmative no-final
// answers, as a score needs two finals, the rest of the counting seats silent (rule.ts). Everything
// short of that is silence or an answer in play, and neither ends a game: an empty answer; a listing
// that does not give the game, empty or not (the game absent from it, or the two teams' record
// outside the window); a row without a readable status; a row with a name the lists don't know
// beside one of the game's teams; a row that says the game is in play. A missing or null conference,
// or any missing metadata, is unknown, never a mark against a team: the row still binds by its names
// and time. The spare past the feed's three-day window is silent by its own date arithmetic, before
// any request. Silence to a score is not silence to the void: a seat is silent to the void only when
// its answer held nothing of the game (empty, absent, outside the window, a failure before any row,
// the seat past its window), and every other reading that is not an affirmative row holds it (the
// class on the reading, types.ts; the hour-24 void and its breaks in never-void.test.ts).
//
// The breaks that turn this red:
//   pick.ts, the end of pick: absence read as an answer again,
//     return clean(seat, "absent");
//     ->  return { seat, kind: "no_final", home: null, away: null, recorded: null, detail: "absent", record: null, answer: "the game" };
//   with which a listing of the teams' other games says the game has no final at the reader;
//   rule.ts, decide: the void's count taken from any answer,
//     const affirmed = counted.filter(affirmsNoFinal).length;
//     ->  const affirmed = answeredCounted;
//   with which two rows in play void the game at hour 24 (never-void.test.ts);
//   seat3.ts, readingOf: a row without a status read as an answer,
//     if (type.trim() === "") return silent(SEAT, "no status");
//     ->  if (type.trim() === "") return { seat: SEAT, kind: "no_final", home, away, recorded: null, detail: "no status", record, answer: "the game" };
//   with which the hint's bare row counts beside a row in play, and the one-queryable run below waits on another line.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { readerFor } from "../src/index";
import { scoreGameSync } from "../src/program";
import { decideVerified } from "../src/rule";
import { runSync } from "../src/run";
import { asksOf } from "../src/teams";
import type { HttpRequest, HttpResponse, Reading, Seat } from "../src/types";
import { CASES, LATE, NOW } from "./cases";
import { KEY, copy, locate, saved, type Derive } from "./fixtures";
import { PAYOUT, PAYOUT_REFUSED, chainOf } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const json = (body: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(body) });
const byName = (prefix: string) => CASES.find((c) => c.name.startsWith(prefix))!;
const lakers = byName("nba final: Golden State at the Lakers").game;
const HINT3 = "edcfd41f-1773-4bc9-a349-aa50931a0278";
const hinted = { ...lakers, hints: [{ seat: 3, id: HINT3 }, { seat: 4, id: "0123456789abcdef0123456789abcdef" }] };

function readWith(seat: Seat, game: ChainGame | typeof lakers, send: (req: HttpRequest) => HttpResponse, now = NOW) {
	const asked: HttpRequest[] = [];
	const r = runSync(seat, readerFor(seat)({ game, now, key: KEY }), (q) => (asked.push(q), send(q)));
	return { kind: r.kind, detail: r.detail, recorded: r.recorded, asked: asked.map((q) => locate(q)?.path ?? "") };
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

describe("never: an irreversible end never rests on fewer than two counting seats' affirmative answers, and the void's silence is only clean silence", () => {
	test("an empty answer reads silent at every seat: seat 1's data, seat 2's results, seat 3's result, the spare by its id and by its slate", () => {
		expect(readWith(1, lakers, () => json({ data: [], meta: {} }))).toMatchObject({ kind: "silent", detail: "empty listing" });
		expect(readWith(2, lakers, () => json({ results: [] }))).toMatchObject({ kind: "silent", detail: "empty listing" });
		expect(readWith(3, hinted, () => json([]))).toMatchObject({ kind: "silent", detail: "no result for the hint" });
		const spare = readWith(4, hinted, () => json([]));
		expect([spare.kind, spare.detail, spare.asked.length, spare.asked[0].includes("eventIds=")]).toEqual(["silent", "empty listing", 2, true]);
		expect(readWith(4, lakers, () => json([]))).toMatchObject({ kind: "silent", detail: "empty listing" });
	});

	test("absence is silence everywhere: a non-empty listing of the teams' other games, and this one not, says nothing, at seats 1, 2 and the spare", () => {
		// The Lakers' saved answers with the game's own record removed: seat 1 and seat 2 still list other
		// games of the two teams on the window's dates; the spare's slate lists the two teams' later game,
		// outside the window. Each is silence, with its reason, never absence.
		const without = (seat: Seat) => (q: HttpRequest): HttpResponse => {
			const res = saved(undefined, NOW).send(q);
			const body = JSON.parse(res.body) as Record<string, unknown> | unknown[];
			if (seat === 1) return json({ ...(body as Record<string, unknown>), data: ((body as { data: { id: number }[] }).data ?? []).filter((g) => g.id !== 21717859) });
			if (seat === 2) return json({ ...(body as Record<string, unknown>), results: ((body as { results: { gameId: number }[] }).results ?? []).filter((g) => g.gameId !== 340490) });
			return json((body as { id: string }[]).filter((g) => g.id !== "6fff70f4bf196dba25060a5775a03b54"));
		};
		for (const seat of [1, 2, 4] as const) {
			const r = readWith(seat, lakers, without(seat));
			expect({ seat, kind: r.kind, detail: r.detail }).toEqual({ seat, kind: "silent", detail: seat === 4 ? "outside window" : "absent" });
		}
		// One team's answer at seat 2 listing the game, the other's empty: the game's own record is read.
		const [home] = asksOf("nba", lakers.home, lakers.away)!;
		const homeOnly = (q: HttpRequest) => (new URL(q.url).searchParams.get("team") === home[2] ? saved(undefined, NOW).send(q) : json({ results: [] }));
		expect(readWith(2, lakers, homeOnly)).toMatchObject({ kind: "final", detail: "final" });
	});

	test("a non-empty answer of two unrelated league teams is silence at seats 1 and 2, in every league", () => {
		const after = (g: { start: number; n: number }) => g.start + g.n + 600;
		const covered = new Set<string>();
		for (const c of CASES) {
			const g = c.game;
			// Two league teams that are not in the game: another case's, in the same league.
			const other = CASES.find((x) => x.game.league === g.league && ![x.game.home, x.game.away].some((n) => n === g.home || n === g.away));
			if (other === undefined) continue;
			const [a, b] = [other.game.home, other.game.away];
			const row1 = { id: 999_001, date: iso(g.start), datetime: iso(g.start), start_time_utc: iso(g.start), status_state: "final", period: 9, home_team_score: 1, visitor_team_score: 2, home_score: 1, away_score: 2, home_team: { full_name: a, display_name: a, college: a }, visitor_team: { full_name: b, display_name: b, college: b }, away_team: { full_name: b, display_name: b } };
			const row2 = { gameId: 999_002, status: "final", schedule: { date: iso(g.start), tbaTime: false }, teams: { home: { team: a, conference: "x" }, away: { team: b, conference: "x" } }, scoreboard: { currentPeriod: 9, score: { home: 1, away: 2 } } };
			const r1 = readWith(1, g, () => json({ data: [row1], meta: {} }), after(g));
			const r2 = readWith(2, g, () => json({ results: [row2] }), after(g));
			expect({ game: c.name, seat1: [r1.kind, r1.detail], seat2: [r2.kind, r2.detail] }).toEqual({ game: c.name, seat1: ["silent", "absent"], seat2: ["silent", "absent"] });
			covered.add(g.league);
		}
		expect([...covered].sort()).toEqual(["mlb", "nba", "ncaab", "ncaaf", "nfl", "nhl"]);
	});

	test("a partial row is silence: seat 3's result with the hint's id and no status, a spare row without its flag, a seat 1 or 2 row without a status", () => {
		expect(readWith(3, hinted, () => json([{ ID: HINT3, OddType: "Game" }]))).toMatchObject({ kind: "silent", detail: "no status" });
		expect(readWith(3, hinted, () => json([{ ID: HINT3, OddType: "Game", HomeScore: 10, AwayScore: 7 }]))).toMatchObject({ kind: "silent", detail: "no status" });
		// The control: the feed's own word that the game is not finished is an answer, in play.
		expect(readWith(3, hinted, () => json([{ ID: HINT3, OddType: "Game", Final: false, FinalType: "NotFinished" }]))).toMatchObject({ kind: "no_final", detail: "NotFinished", recorded: null });
		const noFlag: Derive = (s, _p, body) => (s === 4 ? (copy(body) as Record<string, unknown>[]).map((g) => (g.id === "6fff70f4bf196dba25060a5775a03b54" ? { ...g, completed: undefined } : g)) : body);
		expect(readWith(4, lakers, saved(noFlag, NOW).send)).toMatchObject({ kind: "silent", detail: "no status" });
		const noStatus1: Derive = (s, _p, body) => {
			if (s !== 1) return body;
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) if (g.id === 21717859) Object.assign(g, { status_state: undefined, status: undefined });
			return b;
		};
		expect(readWith(1, lakers, saved(noStatus1, NOW).send)).toMatchObject({ kind: "silent", detail: "no status" });
		const noStatus2: Derive = (s, _p, body) => {
			if (s !== 2) return body;
			const b = copy(body) as { results: Record<string, unknown>[] };
			for (const g of b.results) if (g.gameId === 340490) g.status = undefined;
			return b;
		};
		expect(readWith(2, lakers, saved(noStatus2, NOW).send)).toMatchObject({ kind: "silent", detail: "no status" });
	});

	describe("after the window, through the program: every counterexample waits with nothing written, the intact controls dispute, and a postponed game voids on two affirmative rows", () => {
		// A college football game whose home team seat 2's list has no spelling for, so seat 2 asks for the
		// away team alone. After the window: seat 1 reads the game still on, seat 3 is silent for the game
		// (the start report marked it), the counting spare refuses its request.
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
		const start = college.start as number;
		const after = start + college.n + 600;
		const knownFinal = () => ({
			gameId: "college-1",
			schedule: { date: iso(start) },
			teams: { home: { team: "Abilene Christian", conference: "a conference" }, away: { team: asks[1][2], conference: "a conference" } },
			scoreboard: { currentPeriod: 4, score: { home: 17, away: 24 } },
			status: "final",
		});
		const seat1Row = { id: "college-seat1", date: iso(start), home_team: { full_name: college.home, college: college.home }, visitor_team: { full_name: college.away, college: college.away }, status_state: "in_progress", home_score: 17, away_score: 24 };
		const run = (results: unknown[]) => {
			const sent: string[] = [];
			const o = scoreGameSync(college, KEYS, PAYOUT, after, (q) => {
				const at = locate(q)!;
				sent.push(at.path);
				if (at.seat === 1) return json({ data: [seat1Row], meta: {} });
				if (at.seat === 2) return json({ results });
				if (at.seat === 4) return { status: 500, body: "unavailable" };
				throw new Error("seat 3 is silent for this game");
			});
			expect(sent.filter((p) => p.includes("team=")).length).toBe(1);
			return { action: o.decision.action, why: o.decision.why, report: o.report?.kind ?? null };
		};
		const other = () => ({ ...knownFinal(), gameId: "other-team-game", schedule: { date: iso(start - 3600) }, teams: { home: { team: "Auburn", conference: "a conference" }, away: { team: asks[1][2], conference: "a conference" } } });

		test("the intact control disputes: the away team's final beside seat 1 in play", () => {
			expect(run([knownFinal()])).toEqual({ action: "dispute", why: "after n: finals beside answers without a final", report: 4 });
		});

		test("the away team respelt, the one query answers empty: silence, and the run waits", () => {
			const renamed = knownFinal();
			renamed.teams.away.team = "Alabama Crimson Tyde";
			expect(run([renamed].filter((x) => [x.teams.home.team, x.teams.away.team].includes(asks[1][2] as string)))).toMatchObject({ action: "wait", report: null });
		});

		test("the away team respelt beside its other game under the old spelling: a non-empty answer without this game, silence, and the run waits", () => {
			const renamed = knownFinal();
			renamed.teams.away.team = "Alabama Crimson Tyde";
			const r = run([renamed, other()].filter((x) => [x.teams.home.team, x.teams.away.team].includes(asks[1][2] as string)));
			expect(r).toMatchObject({ action: "wait", report: null });
			expect(r.why.startsWith("after n: fewer than two counting seats answer")).toBe(true);
		});

		test("the team's other games listed and this one not: silence, and the run waits", () => {
			expect(run([other()])).toMatchObject({ action: "wait", why: "after n: fewer than two counting seats answer", report: null });
		});

		test("an unrelated row of two other league teams: silence, and the run waits", () => {
			const unrelated = other();
			unrelated.gameId = "unrelated";
			unrelated.teams.away.team = "Clemson";
			expect(run([unrelated])).toMatchObject({ action: "wait", why: "after n: fewer than two counting seats answer", report: null });
		});

		test("both team objects empty: a row that names no one, silence, and the run waits", () => {
			expect(run([{ gameId: "review-2", teams: { home: {}, away: {} } }])).toMatchObject({ action: "wait", report: null });
		});

		test("the delivered final with both conference keys missing binds by its names and time: the final reads, and the run disputes as the intact control does", () => {
			const noConference = knownFinal();
			delete (noConference.teams.home as { conference?: string }).conference;
			delete (noConference.teams.away as { conference?: string }).conference;
			expect(run([noConference])).toEqual({ action: "dispute", why: "after n: finals beside answers without a final", report: 4 });
		});

		test("the delivered final without a time: no game time, silence, and the run waits", () => {
			const noTime = knownFinal() as Record<string, unknown>;
			delete noTime.schedule;
			expect(run([noTime])).toMatchObject({ action: "wait", report: null });
		});

		test("college malformed rows at the readers: empty team objects, a missing conference, seat 1's null conference ids: never absence", () => {
			for (const league of ["ncaaf", "ncaab"] as const) {
				const g = CASES.find((c) => c.game.league === league)!.game;
				const malformed2 = readWith(2, g, () => json({ results: [{ gameId: "x", teams: { home: {}, away: {} } }] }));
				expect({ league, got: [malformed2.kind, malformed2.detail] }).toEqual({ league, got: ["silent", "no game time"] });
				const g2 = { gameId: "g2", status: "final", schedule: { date: iso(g.start) }, teams: { home: { team: g.home }, away: { team: g.away } }, scoreboard: { currentPeriod: league === "ncaab" ? 2 : 4, score: { home: 70, away: 60 } } };
				const missing = readWith(2, g, () => json({ results: [g2] }));
				expect({ league, got: missing.kind }).toEqual({ league, got: asksOf(league, g.home, g.away)!.every((a) => a[2] !== null) ? "final" : "silent" });
				if (league === "ncaab") {
					const malformed1 = readWith(1, g, () => json({ data: [{ id: "x", home_team: { conference_id: null }, visitor_team: { conference_id: null } }], meta: {} }));
					expect([malformed1.kind, malformed1.detail]).toEqual(["silent", "no game time"]);
				}
			}
		});
	});

	describe("the bare result through the program", () => {
		const game: ChainGame = { ...chainOf("nba final, read after the game"), hints: [{ seat: 3, id: HINT3 }] };
		const after = (game.start as number) + game.n + 600;
		const run = (result: unknown[]) =>
			scoreGameSync(game, KEYS, PAYOUT, after, (q) => {
				const at = locate(q)!;
				if (at.seat === 1) return json({ data: [{ id: 21717859, datetime: iso(game.start as number), status_state: "in_progress", period: 4, home_team_score: 80, visitor_team_score: 77, home_team: { full_name: game.home }, visitor_team: { full_name: game.away } }], meta: {} });
				if (at.seat === 3) return json(result);
				return { status: 500, body: "unavailable" };
			});

		test("the hint's row with no status and no points beside seat 1 in play: a partial row, silence to a score, and the run waits with nothing written, its line naming the seat", () => {
			const o = run([{ ID: HINT3, OddType: "Game" }]);
			expect([o.decision.action, o.decision.why, o.report]).toEqual(["wait", "after n: seat 3 answered but could not be used: no status", null]);
		});

		test("the controls: an empty result waits; a valid final disputes beside seat 1 in play", () => {
			expect([run([]).decision.action, run([]).report]).toEqual(["wait", null]);
			const o = run([{ ID: HINT3, OddType: "Game", Final: true, FinalType: "Finished", HomeScore: 114, AwayScore: 106 }]);
			expect([o.decision.action, o.report?.kind]).toEqual(["dispute", 4]);
		});
	});

	test("the spare's calendar edge: a start late in the UTC day asked for three calendar dates on, inside the three days; the slate's other games are silence, and the spare standing in for seat 3 holds no void by it", () => {
		const start = Date.UTC(2026, 9, 25, 23, 59, 59) / 1000;
		const midnight = Date.UTC(2026, 9, 28) / 1000;
		const edge = { ...hinted, start, n: 86_400 };
		const other = [{ id: "0000000000000000000000000000000f", commence_time: "2026-10-27T00:00:00Z", completed: true, home_team: "Atlanta Hawks", away_team: "Brooklyn Nets", scores: [{ name: "Atlanta Hawks", score: "1" }, { name: "Brooklyn Nets", score: "2" }] }];
		const r = readWith(4, edge, (q) => json(q.url.includes("eventIds=") ? [] : other), midnight);
		expect([r.asked.length, r.kind, r.detail]).toEqual([2, "silent", "absent"]);
		// Through the rule, the spare standing in for seat 3 and seat 1 in play: one answer, and it waits.
		const counting: ChainGame = { ...chainOf("nba final, read after the game"), hints: [{ seat: 4, id: "0123456789abcdef0123456789abcdef" }], startReadings: chainOf("nba final, read after the game").startReadings!.map((x) => (x.seat === 3 ? { ...x, kind: 0 as const } : x)) };
		const o = scoreGameSync(counting, KEYS, PAYOUT, (counting.start as number) + counting.n + 600, (q) => {
			const at = locate(q)!;
			if (at.seat === 1) return json({ data: [{ id: 21717859, datetime: iso(counting.start as number), status_state: "in_progress", period: 4, home_team_score: 80, visitor_team_score: 77, home_team: { full_name: counting.home }, visitor_team: { full_name: counting.away } }], meta: {} });
			if (at.seat === 4) return json(q.url.includes("eventIds=") ? [] : other);
			return { status: 500, body: "unavailable" };
		});
		expect([o.decision.action, o.decision.why, o.report]).toEqual(["wait", "after n: fewer than two counting seats answer", null]);
	});

	test("to the rule, a reading that is not an answer about the game is silence: a record outside the window handed to it beside two finals scores after n, and a postponed row outside the window is no void's vote", () => {
		const w = { from: 1_000, to: 2_000 };
		const final = (seat: Seat): Reading => ({ seat, kind: "final", home: 27, away: 20, recorded: null, detail: "final", record: { id: `f${seat}`, time: 1_500 }, answer: "the game" });
		const outside = (seat: Seat, recorded: "postponed" | null): Reading => ({ seat, kind: "no_final", home: null, away: null, recorded, detail: "outside window", record: { id: `o${seat}`, time: 5_000 }, answer: "the game" });
		const quiet = (seat: Seat): Reading => ({ seat, kind: "silent", home: null, away: null, recorded: null, detail: "silent", record: null, answer: "nothing" });
		const scored = decideVerified([final(1), final(2), outside(3, null), quiet(4)], [1, 2, 3], false, [1, 2, 3, 4], w);
		expect([scored.action, scored.why]).toEqual(["score", "after n: two counting seats or more, the same final, the rest silent"]);
		const held = decideVerified([outside(1, "postponed"), outside(2, "postponed"), quiet(3), quiet(4)], [1, 2, 3], false, [1, 2, 3, 4], w);
		expect([held.action, held.why]).toEqual(["wait", "after n: fewer than two counting seats answer"]);
		// The control: the same rows inside the window are two affirmative answers, the void.
		const inside = (seat: Seat): Reading => ({ ...outside(seat, "postponed"), detail: "postponed", record: { id: `i${seat}`, time: 1_500 } });
		expect(decideVerified([inside(1), inside(2), quiet(3), quiet(4)], [1, 2, 3], false, [1, 2, 3, 4], w).action).toBe("void");
	});

	test("the spare past the feed's three days is silent by its own date arithmetic, before any request", () => {
		const old = { ...hinted, start: NOW - 5 * 86_400 };
		const past = readWith(4, old, () => json([]));
		expect([past.kind, past.detail, past.asked]).toEqual(["silent", "past retention", []]);
		// The captured old game, asked for by its id at the capture's own clock inside the three days: the
		// feed answered an empty list, which is silence, and the slate, listing other games, is silence too.
		const capture = chainOf("nfl final: Washington at San Francisco", { hints: [{ seat: 4, id: "f122527f003276d3bca19efa48c902c1" }] });
		const t = saved(undefined, Date.UTC(2026, 9, 28, 18, 30) / 1000);
		const r = runSync(4, readerFor(4)({ game: capture, now: capture.start! + 3_600, key: KEY }), t.send);
		expect([t.misses, t.asked.length, r.kind, r.detail]).toEqual([[], 2, "silent", "absent"]);
		void LATE;
	});
});
