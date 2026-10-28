// Which game a contest is, at verification (verify.ts): the creator's date says which game; the start
// is written only if scoring will read that same game; and never for a game already over. Each case
// runs end to end on the saved answers, derived where a shape the saved answers lack is needed, and
// each refusal sits beside the case it must still accept.

import { describe, expect, test } from "bun:test";
import type { ChainGame, Decision } from "../src/chain";
import { scoreGameSync } from "../src/program";
import type { Game, HttpRequest, HttpResponse, Reading, Seat } from "../src/types";
import { confirmStart, countingByTeam } from "../src/verify";
import { LATE, NOW } from "./cases";
import { KEY, at, copy, saved, type Derive } from "./fixtures";
import { PAYOUT, chainOf } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000", "");
const BEARS = "edcfd41f-1773-4bc9-a349-aa50931a0278";

function unverified(caseName: string, over: Partial<ChainGame> = {}): ChainGame {
	return { ...chainOf(caseName), status: "unverified", start: null, startReadings: null, ...over };
}

/** One run, from the saved answers as of `asOf` (the run's own clock by default), with no misses. */
function run(game: ChainGame, now: number, derive?: Derive, asOf = now) {
	const t = saved(derive, asOf);
	const o = scoreGameSync(game, KEYS, PAYOUT, now, (q: HttpRequest): HttpResponse => t.send(q));
	expect(t.misses).toEqual([]);
	const d = o.decision;
	return {
		action: d.action,
		why: d.why,
		start: d.action === "start" ? iso(d.start) : null,
		score: d.action === "score" ? `${d.home}-${d.away}` : null,
		report: o.report,
		seats: d.readings.map((r) => `${r.seat}:${r.kind === "final" ? `${r.home}-${r.away}` : r.detail}`),
	};
}

/** The game as the chain holds it once a start report is written. */
function verifiedFrom(game: ChainGame, v: ReturnType<typeof run>): ChainGame {
	return { ...game, status: "verified", start: at(v.start!), startReadings: v.report!.readings };
}

// A doubleheader, derived from the real answers: New England at Chicago at 00:15 on 23 Oct, and the
// same two teams again at 04:15 under new ids at seats 1, 2 and 4, not yet started. Seat 3's board
// lists only the first.
const dh: Derive = (seat, path, body) => {
	if (seat === 1 && path.startsWith("/nfl/v1/games?")) {
		const b = copy(body) as { data: Record<string, any>[] };
		const g = b.data.find((x) => x.id === 1392309);
		if (g) b.data.push({ ...g, id: 9_999_001, date: "2026-10-23T04:15:00.000Z", status: "scheduled", status_state: "scheduled", home_team_score: null, visitor_team_score: null });
		return b;
	}
	if (seat === 2 && path.startsWith("/games?league=NFL&")) {
		const b = copy(body) as { results: Record<string, any>[] };
		const g = b.results.find((x) => x.gameId === 340175);
		if (g) b.results.push({ ...g, gameId: 9_999_002, status: "scheduled", scoreboard: undefined, schedule: { ...g.schedule, date: "2026-10-23T04:15:00.000Z" } });
		return b;
	}
	if (seat === 4 && path.includes("americanfootball_nfl")) {
		const b = copy(body) as Record<string, any>[];
		const g = b.find((x) => x.id === "ffebea881c1d7b2dfb85b3e590c35985");
		if (g) b.push({ ...g, id: "dh-second", commence_time: "2026-10-23T04:15:00Z", completed: false, scores: null });
		return b;
	}
	return body;
};
const FIRST = [{ seat: 1, id: "1392309" }, { seat: 2, id: "340175" }, { seat: 4, id: "ffebea881c1d7b2dfb85b3e590c35985" }];
const SECOND = [{ seat: 1, id: "9999001" }, { seat: 2, id: "9999002" }, { seat: 4, id: "dh-second" }];
const SEAT3 = { seat: 3, id: BEARS };

describe("the date says which game", () => {
	test("hints naming the other game of a doubleheader make the run wait; hints naming the date's own game start it", () => {
		// Created at 00:15 with hints for the 04:15 records at seats 1, 2 and 4.
		const later = run(unverified("nfl not final", { date: at("2026-10-23T00:15:00Z"), hints: [SEAT3, ...SECOND] }), NOW, dh);
		expect([later.action, later.why, later.report]).toEqual(["wait", "seat 1's hint names another record than the one nearest the date", null]);
		// Created at 04:00 with hints for the 00:15 records.
		const earlier = run(unverified("nfl not final", { date: at("2026-10-23T04:00:00Z"), hints: [SEAT3, ...FIRST] }), NOW, dh);
		expect([earlier.action, earlier.why]).toEqual(["wait", "seat 1's hint names another record than the one nearest the date"]);
		// The controls: each game created on its own date, with its own records' hints.
		const first = run(unverified("nfl not final", { date: at("2026-10-23T00:15:00Z"), hints: [SEAT3, ...FIRST] }), NOW, dh);
		expect([first.action, first.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		const second = run(unverified("nfl not final", { date: at("2026-10-23T04:00:00Z"), hints: SECOND }), NOW, dh);
		expect([second.action, second.start]).toEqual(["start", "2026-10-23T04:15:00Z"]);
	});

	test("each seat's hint is held to the record nearest the date: seats 2 and 4 alone, and two hints at one seat", () => {
		const date = at("2026-10-23T00:15:00Z");
		const only = (hints: ChainGame["hints"]) => run(unverified("nfl not final", { date, hints: [SEAT3, ...FIRST.filter((h) => h.seat === 1), ...hints] }), NOW, dh);
		expect(only([{ seat: 2, id: "9999002" }, FIRST[2]]).why).toBe("seat 2's hint names another record than the one nearest the date");
		// The spare is asked by its id, so a hint naming the second game reads that game's record itself,
		// which the hour rule then holds: four hours from the counting seats, it is another game.
		expect(only([FIRST[1], { seat: 4, id: "dh-second" }]).why).toBe("the spare lists the game more than an hour from the counting seats");
		// Two different ids for the spare: it reads by neither, and the start is held at the re-read, where scoring would read nothing.
		expect(only([FIRST[1], FIRST[1], FIRST[2], { seat: 4, id: "dh-second" }]).why).toBe("seat 4 can't read the game as scoring will: two hints");
		// The same hint given twice is one hint.
		expect(only([FIRST[1], FIRST[1], FIRST[2]]).action).toBe("start");
	});

	test("a spare with a hint is held to it even with seat 3 counting: silent, it holds the start, since its hint would choose at scoring", () => {
		// Created at 00:15 with the first game's hints at seats 1, 2 and 3, and the spare's naming the second.
		const spare503 = (send: (q: HttpRequest) => HttpResponse) => (q: HttpRequest): HttpResponse => (q.url.includes("americanfootball_nfl") ? { status: 503, body: "" } : send(q));
		const go = (hints: ChainGame["hints"], silentSpare: boolean) => {
			const t = saved(dh, NOW);
			const o = scoreGameSync(unverified("nfl not final", { date: at("2026-10-23T00:15:00Z"), hints }), KEYS, PAYOUT, NOW, silentSpare ? spare503(t.send) : t.send);
			expect(t.misses).toEqual([]);
			return [o.decision.action, o.decision.why];
		};
		const wrong = [SEAT3, ...FIRST.slice(0, 2), { seat: 4, id: "dh-second" }];
		const right = [SEAT3, ...FIRST];
		// The spare silent: its hint can't be checked, so nothing is written, whichever game it names.
		expect(go(wrong, true)).toEqual(["wait", "seat 4 can't read the game as scoring will: http 503"]);
		expect(go(right, true)).toEqual(["wait", "seat 4 can't read the game as scoring will: http 503"]);
		// Silent only when read again, its record nearest the date the hint's own and at the start: the
		// window read is still unchecked, and nothing is written.
		const t = saved(dh, NOW);
		let spare = 0;
		const reread = scoreGameSync(unverified("nfl not final", { date: at("2026-10-23T00:15:00Z"), hints: right }), KEYS, PAYOUT, NOW, (q) =>
			q.url.includes("americanfootball_nfl") && ++spare === 2 ? { status: 503, body: "" } : t.send(q),
		);
		expect(t.misses).toEqual([]);
		expect([reread.decision.action, reread.decision.why, spare]).toEqual(["wait", "seat 4 can't read the game as scoring will: http 503", 2]);
		// The spare answering by its id: the second game's record, four hours from the counting seats, is another game.
		expect(go(wrong, false)).toEqual(["wait", "the spare lists the game more than an hour from the counting seats"]);
		expect(go(right, false)).toEqual(["start", "seats 1, 2 and 3 list the game within an hour"]);
		// The control: no spare hint, the spare silent, seat 3 counting: nothing can bind the spare, and the start stands.
		expect(go([SEAT3, ...FIRST.slice(0, 2)], true)).toEqual(["start", "seats 1, 2 and 3 list the game within an hour"]);
	});

	test("the start the old rule wrote with the spare silent then disputed the game on the second game's final", () => {
		// What the wait above prevents, end to end: the spare's hint for the second game, the start
		// written as if the spare were read, and the spare answering at 03:32 with the second game final.
		const second31: Derive = (seat, path, body) => {
			const b = dh(seat, path, body);
			if (seat !== 4 || !path.includes("americanfootball_nfl")) return b;
			return (b as Record<string, any>[]).map((x) => (x.id === "dh-second" ? { ...x, completed: true, scores: [{ name: "Chicago Bears", score: "31" }, { name: "New England Patriots", score: "20" }] } : x));
		};
		const hints = [SEAT3, ...FIRST.slice(0, 2), { seat: 4, id: "dh-second" }];
		const started: ChainGame = { ...chainOf("nfl final, read after the game"), date: at("2026-10-23T00:15:00Z"), hints, startReadings: [1, 2, 3, 4].map((seat) => ({ seat, kind: (seat === 4 ? 0 : 1) as 0 | 1, homeScore: 0, awayScore: 0 })) };
		const s = run(started, LATE, second31);
		expect([s.action, s.seats]).toEqual(["dispute", ["1:30-24", "2:30-24", "3:30-24", "4:31-20"]]);
	});

	test("the contest dated 04:00 with hints for the 00:15 game, read at 03:32 once that game is final, writes nothing", () => {
		const created = unverified("nfl final, read after the game", { date: at("2026-10-23T04:00:00Z"), hints: [SEAT3, ...FIRST] });
		const v = run(created, LATE, dh);
		expect([v.action, v.report]).toEqual(["wait", null]);
	});
});

describe("verify the way you'll score", () => {
	test("the doubleheader's first game, created without hints at seats 1, 2 and 4: its window holds both games, so nothing is written", () => {
		const v = run(unverified("nfl not final", { date: at("2026-10-23T00:15:00Z") }), NOW, dh);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 1 can't read the game as scoring will: ambiguous", null]);
		// The second game's window holds only it, so it starts without hints.
		const second = run(unverified("nfl not final", { date: at("2026-10-23T04:00:00Z"), hints: [] }), NOW, dh);
		expect([second.action, second.start]).toEqual(["start", "2026-10-23T04:15:00Z"]);
		// And the first starts with its own records' hints, which scoring then reads.
		const hinted = unverified("nfl not final", { date: at("2026-10-23T00:15:00Z"), hints: [SEAT3, ...FIRST] });
		const h = run(hinted, NOW, dh);
		expect([h.action, h.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		const scored = run(verifiedFrom(hinted, h), LATE, dh);
		expect([scored.action, scored.score]).toEqual(["score", "30-24"]);
	});

	test("seats 1 and 2 nearest on opposite sides of the date, 20 minutes apart: scoring would read another record, so nothing is written", () => {
		// Seat 1 lists the game at 00:15 and again at 01:05; seat 2 at 23:55 and 00:35. Created at 00:39.
		const opposite: Derive = (seat, path, body) => {
			if (seat === 1 && path.startsWith("/nfl/v1/games?")) {
				const b = copy(body) as { data: Record<string, any>[] };
				const g = b.data.find((x) => x.id === 1392309);
				if (g) b.data.push({ ...g, id: 9_999_001, date: "2026-10-23T01:05:00.000Z" });
				return b;
			}
			if (seat === 2 && path.startsWith("/games?league=NFL&")) {
				const b = copy(body) as { results: Record<string, any>[] };
				const g = b.results.find((x) => x.gameId === 340175);
				if (g) {
					b.results.push({ ...g, gameId: 9_999_002, schedule: { ...g.schedule, date: "2026-10-23T00:35:00.000Z" } });
					g.schedule = { ...g.schedule, date: "2026-10-22T23:55:00.000Z" };
				}
				return b;
			}
			return body;
		};
		const v = run(unverified("nfl not final", { date: at("2026-10-23T00:39:00Z") }), NOW, opposite);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 1 can't read the game as scoring will: ambiguous", null]);
	});

	test("the spare standing in, listing the game a second before the start written: scoring reads it outside the window, so nothing is written", () => {
		// Cleveland at Philadelphia, created without a seat 3 hint, so the spare stands in; its time derived to 22:59:59.
		const early: Derive = (s, p, b) =>
			s === 4 && p.includes("basketball_nba")
				? (copy(b) as Record<string, any>[]).map((g) => (g.id === "110e33c79c5ec8c0377702aff685f83b" ? { ...g, commence_time: "2026-10-22T22:59:59Z" } : g))
				: b;
		const game = unverified("nba not final", { hints: [] });
		const v = run(game, NOW, early);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 4 can't read the game as scoring will: outside window", null]);
		// The control: the spare's real time, the scheduled 23:00.
		const real = run(game, NOW);
		expect([real.action, real.start, real.seats[3]]).toEqual(["start", "2026-10-22T23:00:00Z", "4:not completed"]);
	});
});

describe("the spare, read again whether it counts or not", () => {
	// The doubleheader again, the spare's record for the first game a second before the counting seats.
	const spareEarly: Derive = (seat, path, body) => {
		const b = dh(seat, path, body);
		if (seat !== 4 || !path.includes("americanfootball_nfl")) return b;
		return (b as Record<string, any>[]).map((x) => (x.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...x, commence_time: "2026-10-23T00:14:59Z" } : x));
	};
	const created = (hints: ChainGame["hints"]) => unverified("nfl not final", { date: at("2026-10-23T00:15:00Z"), hints });

	test("seat 3 counting, the spare unhinted: if the spare would read the other game in the window, nothing is written", () => {
		// In [00:15, 24:15) the spare's first-game record is a second early and out; the second game is in.
		const v = run(created([SEAT3, ...FIRST.slice(0, 2)]), NOW, spareEarly);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 4 reads another record, or none, in the game's window: not completed", null]);
		// The control: the spare's real time, the first game at 00:15, starts.
		const ok = run(created([SEAT3, ...FIRST.slice(0, 2)]), NOW, dh);
		expect([ok.action, ok.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
	});

	test("seat 3 stood down by its board check is not read again: a final under a hint that failed is not this game's", () => {
		// The hint's board row names other teams, so the hint fails and the spare stands in; seat 3's result
		// for that hint is derived final. Read again, it would hold the start on another game's final.
		const otherTeams: Derive = (s, p, b) => {
			if (s === 3 && p === "/odds/NFL?oddType=Game") return (copy(b) as Record<string, unknown>[]).map((r) => (r.ID === BEARS ? { ...r, HomeTeam: "Detroit Lions", AwayTeam: "Green Bay Packers" } : r));
			if (s === 3 && p === `/results/${BEARS}`) return (copy(b) as Record<string, unknown>[]).map((r) => ({ ...r, Final: true, FinalType: "Finished", HomeScore: "17", AwayScore: "10" }));
			return b;
		};
		const t = saved(otherTeams, NOW);
		const o = scoreGameSync(unverified("nfl not final"), KEYS, PAYOUT, NOW, t.send);
		expect(t.misses).toEqual([]);
		expect([o.decision.action, o.decision.why]).toEqual(["start", "seats 1 and 2 list the game within an hour, and the spare stands in for seat 3"]);
		// Seat 3 is asked for its board, and not for its result.
		expect(t.asked.map((q) => q.url).filter((u) => u.includes("/results/"))).toEqual([]);
	});

	test("seat 3 counting, the spare unhinted and with no record in the window: it can give no final there, and the start stands", () => {
		// One game, no second: the spare's record a second early reads "outside window", which no final can come from.
		const early: Derive = (s, p, b) =>
			s === 4 && p.includes("americanfootball_nfl") ? (copy(b) as Record<string, any>[]).map((x) => (x.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...x, commence_time: "2026-10-23T00:14:59Z" } : x)) : b;
		const v = run(unverified("nfl not final"), NOW, early);
		expect([v.action, v.start, v.seats[3]]).toEqual(["start", "2026-10-23T00:15:00Z", "4:not completed"]);
		// The same with a spare hint for that record: the record is within START_SPREAD of the start, a
		// second before the window, so it is the game. The spare reads no other record there and can give
		// no final to count, and the start is written.
		const hinted = run(unverified("nfl not final", { hints: [SEAT3, { seat: 4, id: "ffebea881c1d7b2dfb85b3e590c35985" }] }), NOW, early);
		expect([hinted.action, hinted.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		// The control: the spare standing in for seat 3 (no seat 3 hint) counts, so it must read the record
		// inside the window, hint or not: a second early, nothing is written.
		const counting = run(unverified("nfl not final", { hints: [{ seat: 4, id: "ffebea881c1d7b2dfb85b3e590c35985" }] }), NOW, early);
		expect([counting.action, counting.why]).toEqual(["wait", "seat 4 can't read the game as scoring will: outside window"]);
	});

	test("with seat 3 counting, the spare's record more than an hour from the start is another game, near the date or in the window", () => {
		// Created with a date 20 hours before New England at Chicago. Seats 1 to 3 list it at 00:15; the
		// spare's only record of the two teams is at 05:15, more than a day from the date, so near the date
		// it isn't held to the hour, and in the window from 00:15 it is the record the spare would read.
		const at0515: Derive = (s, p, b) =>
			s === 4 && p.includes("americanfootball_nfl") ? (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, commence_time: "2026-10-23T05:15:00Z" } : g)) : b;
		const early = unverified("nfl not final", { date: at("2026-10-22T04:15:00Z"), hints: [SEAT3] });
		const v = run(early, NOW, at0515);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 4 reads a record more than an hour from the start in the game's window", null]);
		// The control: the spare's real 00:15, from the same date.
		const c = run(early, NOW);
		expect([c.action, c.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		// A hinted spare whose record is more than an hour before the start, and outside the window, is
		// another game too: its hint is unchecked, and nothing is written. Created with a date 21:45 after
		// the game; the spare's hinted record moved 2:15 before it, more than a day from the date.
		const before: Derive = (s, p, b) =>
			s === 4 && p.includes("americanfootball_nfl") ? (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, commence_time: "2026-10-22T21:59:59Z" } : g)) : b;
		const late = unverified("nfl not final", { date: at("2026-10-23T22:00:00Z"), hints: [SEAT3, { seat: 4, id: "ffebea881c1d7b2dfb85b3e590c35985" }] });
		const h = run(late, NOW, before);
		expect([h.action, h.why]).toEqual(["wait", "seat 4 can't read the game as scoring will: outside window"]);
		// The control: the spare's record a second before the start, from the same date: the game.
		const second: Derive = (s, p, b) =>
			s === 4 && p.includes("americanfootball_nfl") ? (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, commence_time: "2026-10-23T00:14:59Z" } : g)) : b;
		expect(run(late, NOW, second)).toMatchObject({ action: "start", start: "2026-10-23T00:15:00Z" });
	});

	test("seat 3 counting, the spare unhinted and silent when read again: the start stands, and the worst it costs is a dispute", () => {
		// The doubleheader, the spare's first-game record a second early, so its window holds the second
		// game; the spare answers near the date and then 503. Nothing binds an unhinted spare that doesn't
		// count, so its silence passes: the call that keeps a spare's outage from holding every start.
		const t = saved(spareEarly, NOW);
		let spareCalls = 0;
		const o = scoreGameSync(created([SEAT3, ...FIRST.slice(0, 2)]), KEYS, PAYOUT, NOW, (q) => (q.url.includes("americanfootball_nfl") && ++spareCalls === 2 ? { status: 503, body: "" } : t.send(q)));
		expect(t.misses).toEqual([]);
		expect([o.decision.action, o.report?.start]).toEqual(["start", at("2026-10-23T00:15:00Z")]);
		// What it costs at scoring: the spare reads the second game in the window. Its final, 10-7, beside
		// the first game's 30-24 at seats 1 to 3, is a dispute, never a score on the wrong game; the spare
		// doesn't count, and its vote can make no three.
		const secondFinal: Derive = (seat, path, body) => {
			const b = spareEarly(seat, path, body);
			if (seat !== 4 || !path.includes("americanfootball_nfl")) return b;
			return (b as Record<string, any>[]).map((x) => (x.id === "dh-second" ? { ...x, completed: true, scores: [{ name: "Chicago Bears", score: "10" }, { name: "New England Patriots", score: "7" }] } : x));
		};
		const game: ChainGame = { ...chainOf("nfl final, read after the game"), date: at("2026-10-23T00:15:00Z"), hints: [SEAT3, ...FIRST.slice(0, 2)], startReadings: o.report!.readings };
		const s = run(game, LATE, secondFinal);
		expect([s.action, s.why, s.seats]).toEqual(["dispute", "two finals differ", ["1:30-24", "2:30-24", "3:30-24", "4:10-7"]]);
	});
});

describe("never a finished game", () => {
	test("the points final under status words still in play at every seat read by team: seat 3's result says final, and nothing is written", () => {
		// New England at Chicago read at 03:32, once final, with seat 1 "in progress", seat 2 "in progress"
		// and the spare "not completed", the points left as the final's. Seat 3's result, as saved then, is final.
		const lagging = (alsoSeat3: boolean): Derive => (s, p, b) => {
			if (s === 1 && p.startsWith("/nfl/v1/games?")) {
				const c = copy(b) as { data: Record<string, any>[] };
				for (const g of c.data) if (g.id === 1392309) Object.assign(g, { status: "4th Qtr", status_state: "in_progress" });
				return c;
			}
			if (s === 2 && p.startsWith("/games?league=NFL")) {
				const c = copy(b) as { results: Record<string, any>[] };
				for (const g of c.results) if (g.gameId === 340175) g.status = "in progress";
				return c;
			}
			if (s === 4 && p.includes("americanfootball_nfl")) return (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, completed: false } : g));
			if (alsoSeat3 && s === 3 && p === `/results/${BEARS}`) return (copy(b) as Record<string, unknown>[]).map((r) => ({ ...r, Final: false, FinalType: "NotFinished" }));
			return b;
		};
		const game = unverified("nfl final, read after the game", { hints: [SEAT3] });
		const over = run(game, LATE, lagging(false));
		expect([over.action, over.why, over.report]).toEqual(["wait", "seat 3 shows the game final", null]);
		// The control: every seat still in play, seat 3's result too. The start is written, late, as the spec takes it.
		const inPlay = run(game, LATE, lagging(true));
		expect([inPlay.action, inPlay.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
	});

	test("seat 3's board drops a finished game: its result is read before seat 3 stands down, and a final there writes nothing", () => {
		// New England at Chicago read at 03:32, once final. Seats 1, 2 and the spare still show it in play;
		// seat 3's board no longer lists it, and its result for the hint, as saved then, is final 30-24.
		const lagging = (result?: (rows: Record<string, unknown>[]) => unknown): Derive => (s, p, b) => {
			if (s === 1 && p.startsWith("/nfl/v1/games?")) {
				const c = copy(b) as { data: Record<string, any>[] };
				for (const g of c.data) if (g.id === 1392309) Object.assign(g, { status: "4th Qtr", status_state: "in_progress" });
				return c;
			}
			if (s === 2 && p.startsWith("/games?league=NFL")) {
				const c = copy(b) as { results: Record<string, any>[] };
				for (const g of c.results) if (g.gameId === 340175) g.status = "in progress";
				return c;
			}
			if (s === 3 && p === "/odds/NFL?oddType=Game") return (copy(b) as Record<string, unknown>[]).filter((r) => r.ID !== BEARS);
			if (s === 3 && p === `/results/${BEARS}` && result !== undefined) return result(copy(b) as Record<string, unknown>[]);
			if (s === 4 && p.includes("americanfootball_nfl")) return (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, completed: false } : g));
			return b;
		};
		const game = unverified("nfl final, read after the game", { hints: [SEAT3] });
		const t = saved(lagging(), LATE);
		const o = scoreGameSync(game, KEYS, PAYOUT, LATE, t.send);
		expect(t.misses).toEqual([]);
		expect(t.asked.some((q) => q.url.includes(`/results/${BEARS}`))).toBe(true);
		expect([o.decision.action, o.decision.why, o.report]).toEqual(["wait", "seat 3 shows the game final", null]);
		// The same with the result finished but its points missing.
		const noPoints = run(game, LATE, lagging((rows) => rows.map((r) => ({ ...r, HomeScore: null, AwayScore: null }))));
		expect([noPoints.action, noPoints.why]).toEqual(["wait", "seat 3 shows the game final"]);
		// A result that can't be read teaches nothing: the run waits.
		const t503 = saved(lagging(), LATE);
		const failed = scoreGameSync(game, KEYS, PAYOUT, LATE, (q) => (q.url.includes("/results/") ? { status: 503, body: "" } : t503.send(q)));
		expect([failed.decision.action, failed.decision.why]).toEqual(["wait", "seat 3's result is silent: http 503"]);
		// The controls: a result not yet final, or no result for the hint, and seat 3 stands down as before.
		for (const [what, change] of [
			["not final", (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, Final: false, FinalType: "NotFinished" }))],
			["no row for the hint", () => []],
		] as const) {
			const v = run(game, LATE, lagging(change));
			expect({ what, got: [v.action, v.seats[2]] }).toEqual({ what, got: ["start", "3:silent for the game: hint not on the board"] });
		}
	});

	test("a feed that says the game is finished but gives no points, or a count short of a whole game, writes nothing", () => {
		// New England at Chicago read at 03:32, once final, with every other feed's status left in play.
		const inPlay = (except: number): Derive => (s, p, b) => {
			if (s === except) return b;
			if (s === 1 && p.startsWith("/nfl/v1/games?")) {
				const c = copy(b) as { data: Record<string, any>[] };
				for (const g of c.data) if (g.id === 1392309) Object.assign(g, { status: "4th Qtr", status_state: "in_progress" });
				return c;
			}
			if (s === 2 && p.startsWith("/games?league=NFL")) {
				const c = copy(b) as { results: Record<string, any>[] };
				for (const g of c.results) if (g.gameId === 340175) g.status = "in progress";
				return c;
			}
			if (s === 3 && p === `/results/${BEARS}`) return (copy(b) as Record<string, unknown>[]).map((r) => ({ ...r, Final: false, FinalType: "NotFinished" }));
			if (s === 4 && p.includes("americanfootball_nfl")) return (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, completed: false } : g));
			return b;
		};
		const also = (a: Derive, b: Derive): Derive => (s, p, x) => b(s, p, a(s, p, x));
		const game = unverified("nfl final, read after the game", { hints: [SEAT3] });
		const rows: [string, Derive, string][] = [
			[
				"seat 3's result finished, its points missing, read again with seat 3 counting",
				also(inPlay(3), (s, p, b) => (s === 3 && p === `/results/${BEARS}` ? (b as Record<string, unknown>[]).map((r) => ({ ...r, HomeScore: null, AwayScore: undefined })) : b)),
				"seat 3 shows the game final",
			],
			[
				"the spare completed, its scores missing, near the date",
				also(inPlay(4), (s, p, b) => (s === 4 && p.includes("americanfootball_nfl") ? (b as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, completed: true, scores: null } : g)) : b)),
				"seat 4 shows the game final",
			],
			[
				"seat 1 final, a quarter's points missing",
				also(inPlay(1), (s, p, b) => {
					if (s !== 1 || !p.startsWith("/nfl/v1/games?")) return b;
					const c = b as { data: Record<string, any>[] };
					for (const g of c.data) if (g.id === 1392309) g.home_team_q4 = null;
					return c;
				}),
				"seat 1 shows the game final",
			],
		];
		for (const [what, derive, why] of rows) {
			const v = run(game, LATE, derive);
			expect({ what, got: [v.action, v.why, v.report] }).toEqual({ what, got: ["wait", why, null] });
		}
		// The control: every feed in play, and the start is written, late.
		const late = run(game, LATE, inPlay(0));
		expect([late.action, late.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
	});

	test("the spare final by its hint while its by-team read is ambiguous: the re-read reads it by the hint, and nothing is written", () => {
		// The spare's answer also lists a record of the two teams with no game time, so its by-team read
		// near the date is ambiguous; by its hint it reads the game, final.
		const noTimeCopy = (on: boolean): Derive => (s, p, b) => {
			if (!on || s !== 4 || !p.includes("americanfootball_nfl")) return b;
			const c = copy(b) as Record<string, any>[];
			c.push({ ...c.find((g) => g.id === "ffebea881c1d7b2dfb85b3e590c35985"), id: "other-record", commence_time: null, completed: false, scores: null });
			return c;
		};
		const hints = [SEAT3, ...FIRST];
		// Seats 1 to 3 still in play, so the spare by its hint is the only reading that can show the game over.
		const lagging123 = (spareFinal: boolean, ambiguous = true): Derive => (s, p, b) => {
			const c0 = noTimeCopy(ambiguous)(s, p, b);
			if (s === 1 && p.startsWith("/nfl/v1/games?")) {
				const c = copy(c0) as { data: Record<string, any>[] };
				for (const g of c.data) if (g.id === 1392309) Object.assign(g, { status: "4th Qtr", status_state: "in_progress" });
				return c;
			}
			if (s === 2 && p.startsWith("/games?league=NFL")) {
				const c = copy(c0) as { results: Record<string, any>[] };
				for (const g of c.results) if (g.gameId === 340175) g.status = "in progress";
				return c;
			}
			if (s === 3 && p === `/results/${BEARS}`) return (copy(c0) as Record<string, unknown>[]).map((r) => ({ ...r, Final: false, FinalType: "NotFinished" }));
			if (s === 4 && !spareFinal && p.includes("americanfootball_nfl")) return (c0 as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, completed: false } : g));
			return c0;
		};
		const game = unverified("nfl final, read after the game", { hints });
		// The spare is asked by its id near the date too, so the copy without a time never reaches it: the
		// final shows at once, and nothing is written.
		const v = run(game, LATE, lagging123(true));
		expect([v.action, v.why, v.report, v.seats[3]]).toEqual(["wait", "seat 4 shows the game final", null, "4:30-24"]);
		// Not final: the spare's record by its id is the game, in play, and the start is written.
		const unchecked = run(game, LATE, lagging123(false));
		expect([unchecked.action, unchecked.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
		// The control: no copy without a time, so the spare's hint is checked near the date, and every reading
		// is of a game in play. The start is written.
		const c = run(game, LATE, lagging123(false, false));
		expect([c.action, c.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
	});

	test("New England at Chicago, created with a date of 04:00 and read at 03:32 once final: nothing is written; read before its end, it starts", () => {
		const created = unverified("nfl final, read after the game", { date: at("2026-10-23T04:00:00Z"), hints: [] });
		const over = run(created, LATE);
		expect([over.action, over.why, over.report]).toEqual(["wait", "seat 1 shows the game final", null]);
		const before = run({ ...created, hints: [SEAT3] }, NOW);
		expect([before.action, before.start]).toEqual(["start", "2026-10-23T00:15:00Z"]);
	});

	test("with seat 3 counting, the spare's final alone writes nothing, even when only the read near the date can see it", () => {
		// The spare's record final a second before the start: in the window from the start its record is
		// out, so the read again says "outside window", and only the read near the date shows the final.
		const lagging: Derive = (s, p, b) => {
			if (s === 1 && p.startsWith("/nfl/v1/games?")) {
				const c = copy(b) as { data: Record<string, any>[] };
				for (const g of c.data) if (g.id === 1392309) Object.assign(g, { status: "4th Qtr", status_state: "in_progress" });
				return c;
			}
			if (s === 2 && p.startsWith("/games?league=NFL")) {
				const c = copy(b) as { results: Record<string, any>[] };
				for (const g of c.results) if (g.gameId === 340175) g.status = "in progress";
				return c;
			}
			if (s === 3 && p === `/results/${BEARS}`) return (copy(b) as Record<string, unknown>[]).map((r) => ({ ...r, Final: false, FinalType: "NotFinished" }));
			if (s === 4 && p.includes("americanfootball_nfl")) return (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, commence_time: "2026-10-23T00:14:59Z" } : g));
			return b;
		};
		const early = run(unverified("nfl final, read after the game", { hints: [SEAT3] }), LATE, lagging);
		expect([early.action, early.why, early.report]).toEqual(["wait", "seat 4 shows the game final", null]);
	});

	test("with seat 3 counting, the spare's final alone writes nothing", () => {
		// New England at Chicago at 17:30 on 22 Oct, before it was played; the spare's record derived final.
		// Seat 3's hint passes; the spare's final is seen near the date and again in the window.
		const spareFinal: Derive = (s, p, b) =>
			s === 4 && p.includes("americanfootball_nfl")
				? (copy(b) as Record<string, any>[]).map((g) => (g.id === "ffebea881c1d7b2dfb85b3e590c35985" ? { ...g, completed: true, scores: [{ name: "Chicago Bears", score: "30" }, { name: "New England Patriots", score: "24" }] } : g))
				: b;
		const v = run(unverified("nfl not final"), NOW, spareFinal);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 4 shows the game final", null]);
		// The control: the spare's real answer, not final.
		const real = run(unverified("nfl not final"), NOW);
		expect([real.action, real.why]).toEqual(["start", "seats 1, 2 and 3 list the game within an hour"]);
	});

	test("a date an hour after a finished game, with the next day's game also listed: the finished game is the nearest, and nothing is written", () => {
		// The Lakers game at 02:00 on 22 Oct, final by 17:30; a copy of it 24 hours later, not started.
		const next: Derive = (seat, path, body) => {
			if (seat === 1 && path.includes("/v1/games?")) {
				const b = copy(body) as { data: Record<string, any>[] };
				const g = b.data.find((x) => x.id === 21717859);
				if (g) b.data.push({ ...g, id: 8_888_001, datetime: "2026-10-23T02:00:00.000Z", date: "2026-10-22", status: "scheduled", status_state: "scheduled", home_team_score: 0, visitor_team_score: 0 });
				return b;
			}
			if (seat === 2 && path.startsWith("/games?league=NBA")) {
				const b = copy(body) as { results: Record<string, any>[] };
				const g = b.results.find((x) => x.gameId === 340490);
				if (g) b.results.push({ ...g, gameId: 8_888_002, status: "scheduled", scoreboard: undefined, schedule: { ...g.schedule, date: "2026-10-23T02:00:00.000Z" } });
				return b;
			}
			if (seat === 4 && path.includes("basketball_nba")) {
				const b = copy(body) as Record<string, any>[];
				const g = b.find((x) => x.id === "6fff70f4bf196dba25060a5775a03b54");
				if (g) b.push({ ...g, id: "next-day", commence_time: "2026-10-23T02:00:00Z", completed: false, scores: null });
				return b;
			}
			return body;
		};
		const v = run(unverified("nba final", { date: at("2026-10-22T03:00:00Z") }), NOW, next);
		expect([v.action, v.why, v.report]).toEqual(["wait", "seat 1 shows the game final", null]);
		// The control, the same shape on a game not yet played: Cleveland at Philadelphia at 23:00, the
		// date half an hour after it (so every date it asks is saved), and a copy 24 hours later. The copy
		// sits at start + n, outside the window.
		const copyNext: Derive = (seat, path, body) => {
			if (seat === 1 && path.includes("/v1/games?")) {
				const b = copy(body) as { data: Record<string, any>[] };
				const g = b.data.find((x) => x.home_team?.full_name === "Philadelphia 76ers" && x.visitor_team?.full_name === "Cleveland Cavaliers");
				if (g) b.data.push({ ...g, id: 8_888_101, datetime: "2026-10-23T23:00:00.000Z", date: "2026-10-23" });
				return b;
			}
			if (seat === 2 && path.startsWith("/games?league=NBA")) {
				const b = copy(body) as { results: Record<string, any>[] };
				const g = b.results.find((x) => x.gameId === 340484);
				if (g) b.results.push({ ...g, gameId: 8_888_102, schedule: { ...g.schedule, date: "2026-10-23T23:00:00.000Z" } });
				return b;
			}
			if (seat === 4 && path.includes("basketball_nba")) {
				const b = copy(body) as Record<string, any>[];
				const g = b.find((x) => x.id === "110e33c79c5ec8c0377702aff685f83b");
				if (g) b.push({ ...g, id: "next-day", commence_time: "2026-10-23T23:00:00Z" });
				return b;
			}
			return body;
		};
		const c = run(unverified("nba not final", { date: at("2026-10-22T23:30:00Z") }), NOW, copyNext);
		expect([c.action, c.start]).toEqual(["start", "2026-10-22T23:00:00Z"]);
	});

	test("a game in play still gets its start, late: Cleveland at Philadelphia read at 03:32, the game over at seats 1 to 3 but not yet at a derived seat 1", () => {
		// Inside the game: seat 1's record derived back to in progress, so the run sees a game still on.
		// Seat 2 and the spare read final at 03:32, so this is the refusal; the derived case beside it,
		// with all three by-team seats still in progress, is the late start.
		const inPlay = (seats: number[]): Derive => (s, p, b) => {
			if (!seats.includes(s)) return b;
			if (s === 1 && p.includes("/v1/games?")) {
				const c = copy(b) as { data: Record<string, any>[] };
				for (const g of c.data) if (g.home_team?.full_name === "Philadelphia 76ers") Object.assign(g, { status: "4th Qtr", status_state: "in_progress", period: 4 });
				return c;
			}
			if (s === 2 && p.startsWith("/games?league=NBA")) {
				const c = copy(b) as { results: Record<string, any>[] };
				for (const g of c.results) if (g.gameId === 340484) g.status = "in progress";
				return c;
			}
			if (s === 4 && p.includes("basketball_nba")) return (copy(b) as Record<string, any>[]).map((g) => (g.id === "110e33c79c5ec8c0377702aff685f83b" ? { ...g, completed: false } : g));
			return b;
		};
		const game = unverified("nba final, read after the game", { hints: [] });
		// Seats 1 and 2 still in play, the spare final: the spare's final is enough to write nothing.
		const spare = run(game, LATE, inPlay([1, 2]));
		expect([spare.action, spare.why]).toEqual(["wait", "seat 4 shows the game final"]);
		const partly = run(game, LATE, inPlay([1]));
		expect([partly.action, partly.why]).toEqual(["wait", "seat 2 shows the game final"]);
		const late = run(game, LATE, inPlay([1, 2, 4]));
		expect([late.action, late.start, late.why]).toEqual(["start", "2026-10-22T23:00:00Z", "seats 1 and 2 list the game within an hour, and the spare stands in for seat 3"]);
	});
});

describe("the re-read, each of its checks on its own", () => {
	// A start decided from seats 1 and 2 at 00:15 with the spare standing in, and the window it makes.
	const game: Game = { league: "nfl", home: "Chicago Bears", away: "New England Patriots", start: at("2026-10-23T00:15:00Z"), n: 86_400, hints: [] };
	const listed = (seat: Seat, id: string, time = game.start): Reading => ({ seat, kind: "no_final", home: null, away: null, recorded: null, detail: "scheduled", record: { id, time } });
	const start: Decision = {
		action: "start",
		start: game.start,
		readings: [listed(1, "a"), listed(2, "b"), { seat: 3, kind: "silent", home: null, away: null, recorded: null, detail: "silent for the game: no hint", record: null }, listed(4, "d", game.start + 120)],
		why: "seats 1 and 2 list the game within an hour, and the spare stands in for seat 3",
	};
	const again = (four: Partial<Record<1 | 2 | 4, Reading | null>>): Reading[] =>
		([1, 2, 4] as const).flatMap((s) => {
			const r = s in four ? four[s] : start.readings.find((x) => x.seat === s)!;
			return r === null || r === undefined ? [] : [r];
		});
	const why = (four: Partial<Record<1 | 2 | 4, Reading | null>>) => {
		const d = confirmStart(start, game, again(four));
		return d.action === "start" ? "start" : d.why;
	};

	test("the same record at each seat, inside the window, and not final: the start stands", () => {
		expect(countingByTeam(start)).toEqual([1, 2, 4]);
		expect(why({})).toBe("start");
		// A seat 3 that passed its check is not re-read, and neither is the spare then.
		expect(countingByTeam({ ...start, readings: start.readings.map((r) => (r.seat === 3 ? listed(3, "c") : r)) })).toEqual([1, 2]);
	});

	test("each way a re-read differs writes nothing", () => {
		const rows: [string, Partial<Record<1 | 2 | 4, Reading | null>>, string][] = [
			["final by now", { 2: { ...listed(2, "b"), kind: "final", home: 24, away: 17, detail: "final" } }, "seat 2 shows the game final"],
			["silent", { 1: { seat: 1, kind: "silent", home: null, away: null, recorded: null, detail: "ambiguous", record: null } }, "seat 1 can't read the game as scoring will: ambiguous"],
			["another record, inside the window", { 4: listed(4, "e", game.start + 3600) }, "seat 4 reads another record, or none, in the game's window: scheduled"],
			["the same record, a second before the window", { 4: listed(4, "d", game.start - 1) }, "seat 4 reads another record, or none, in the game's window: scheduled"],
			["the same record, at the window's end", { 1: listed(1, "a", game.start + game.n) }, "seat 1 reads another record, or none, in the game's window: scheduled"],
			["no record at all", { 2: { ...listed(2, "b"), record: null, detail: "absent" } }, "seat 2 reads another record, or none, in the game's window: absent"],
			["no time", { 2: { ...listed(2, "b"), record: { id: "b", time: null } } }, "seat 2 reads another record, or none, in the game's window: scheduled"],
			["not read again", { 4: null }, "seat 4 was not read again"],
		];
		for (const [what, four, want] of rows) expect({ what, got: why(four) }).toEqual({ what, got: want });
	});

	test("a wait passes through untouched", () => {
		const wait: Decision = { action: "wait", readings: [], why: "seat 1 is silent: http 503" };
		expect(confirmStart(wait, game, [])).toBe(wait);
	});
});
