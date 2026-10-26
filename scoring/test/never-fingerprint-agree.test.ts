// Never: "The program takes which feeds to ask, or how many must agree, from anything outside the
// fingerprint. Only the keys and the payout address come from outside, and neither can touch the
// score."
//
// never-fingerprint.test.ts holds which feeds are asked. This file holds the rest: how many must
// agree, which seats count, how long each seat is asked, and the two things that do come from
// outside. A key decides only whether the run can read at all: a seat whose key is missing, isn't
// text its request carries as given (in the query, one value as given), or whose feed refuses it
// (400, 401, 402, 403, 429), makes the run decide nothing. It is never a silent seat, which would let
// a key choose between a score, a dispute and a void, and never a seat that stops counting. A seat
// the run never asks needs no key. The payout lands in the report's payout field and nowhere else.
//
// The breaks that turn this red (program.ts, keys.ts):
//   if (typeof k === "number") return nothing(`seat ${k} has no key`);
//   ->  if (false) return nothing(`seat ${k} has no key`);
// (a missing key would read as no key at all, and the seat would be asked anyway),
//   if (status !== null) return refusedKey(job, status);
//   ->  (deleted, in scoreGameSync)
// (a refused key would read as a silent seat, and the run would decide on the others), and
//   if ("query" in seatRow(seat).key && !oneQueryValue(k)) return null;
//   ->  (deleted)
// (a key that adds to seat 4's query would choose what that seat is asked, and hide its final).

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { readerFor, type Keys } from "../src/index";
import { scoreGameSync } from "../src/program";
import { AGREE, OPEN_FOR } from "../src/rule";
import { runSync } from "../src/run";
import { START_SPREAD } from "../src/verify";
import { LATE, NOW } from "./cases";
import { KEY, copy, locate, saved, type Derive } from "./fixtures";
import { PAYOUT, PAYOUT_REFUSED, chainOf } from "./rule-helpers";

// Golden State at the Lakers, 127-105, inside its window at the suite's clock, as if created with a
// seat 3 hint that passed verification. Seat 3's answer for the hint is derived: the real by-id
// answer of a game seat 3 listed that afternoon, marked finished at the Lakers' score. Every other
// answer is real.
const SEAT3_ID = "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09";
const lakers3: ChainGame = {
	...chainOf("nba final"),
	hints: [{ seat: 3, id: SEAT3_ID }],
	startReadings: [1, 2, 3, 4].map((seat) => ({ seat, kind: 1 as const, homeScore: 0, awayScore: 0 })),
};
const seat3Final: Derive = (seat, path, body) =>
	seat === 3 && path === `/results/${SEAT3_ID}`
		? (copy(body) as Record<string, unknown>[]).map((r) => ({ ...r, Final: true, FinalType: "Finished", HomeScore: "127", AwayScore: "105" }))
		: body;

const ALL: Keys = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

function outcome(game: ChainGame, keys: Keys, payout = PAYOUT) {
	const t = saved(seat3Final, NOW);
	const o = scoreGameSync(game, keys, payout, NOW, t.send);
	expect(t.misses).toEqual([]);
	return { action: o.decision.action, why: o.decision.why, report: o.report };
}

/** One run at a clock, the answers as of NOW; `refuse` answers that seat with `status`. Reports what was asked, by seat. */
function run(game: ChainGame, keys: Keys, now: number, refuse?: number, status = 401) {
	const t = saved(seat3Final, NOW);
	const o = scoreGameSync(game, keys, PAYOUT, now, (q) => (refuse !== undefined && locate(q)?.seat === refuse ? { status, body: "" } : t.send(q)));
	expect(t.misses).toEqual([]);
	return { action: o.decision.action, why: o.decision.why, report: o.report, asked: t.asked.length, seats: t.asked.map((q) => locate(q)!.seat) };
}

describe("never: how many must agree, or which seats count, from outside the fingerprint", () => {
	test("the counts are the spec's, fixed in the source, and nothing at runtime writes to them", () => {
		expect({ ...AGREE }).toEqual({ insideN: 3, afterN: 2, day7Sources: 4, day7Agree: 3 });
		expect(START_SPREAD).toBe(3600);
		// How long each seat stays open: seats 1 and 2 until the game ends, seat 3 five days, seat 4 66 hours.
		const WINDOWS = { 1: null, 2: null, 3: 5 * 86_400, 4: 66 * 3_600 };
		expect({ ...OPEN_FOR }).toEqual(WINDOWS);
		const attempts: [string, () => void][] = [
			["lower the count inside n", () => ((AGREE as unknown as { insideN: number }).insideN = 2)],
			["lower the count after n", () => ((AGREE as unknown as { afterN: number }).afterN = 1)],
			["lower day 7's count", () => ((AGREE as unknown as { day7Agree: number }).day7Agree = 2)],
			["add a count", () => ((AGREE as unknown as Record<string, number>).spare = 0)],
			["keep seat 3 open", () => ((OPEN_FOR as unknown as Record<number, number | null>)[3] = null)],
			["close seat 1", () => ((OPEN_FOR as unknown as Record<number, number | null>)[1] = 0)],
		];
		for (const [what, attempt] of attempts) expect({ what, threw: throws(attempt) }).toEqual({ what, threw: true });
		expect({ ...AGREE }).toEqual({ insideN: 3, afterN: 2, day7Sources: 4, day7Agree: 3 });
		expect({ ...OPEN_FOR }).toEqual(WINDOWS);
	});

	test("seat 4's window is its reader's: at 66 hours from the start it is open, a second later closed, and its reader stops at the same second", () => {
		const g = chainOf("nba final, read after the game");
		const seats4 = (now: number) => {
			const t = saved(undefined, LATE);
			scoreGameSync(g, ALL, PAYOUT, now, t.send);
			return t.asked.filter((q) => locate(q)?.seat === 4).length;
		};
		const edge = g.start! + OPEN_FOR[4]!;
		expect([seats4(edge), seats4(edge + 1)]).toEqual([1, 0]);
		// The reader on its own stops at the same second.
		const reader = (now: number) => runSync(4, readerFor(4)({ game: { league: g.league, home: g.home, away: g.away, start: g.start!, n: g.n, hints: g.hints }, now, key: KEY }), saved(undefined, LATE).send);
		expect([reader(edge).detail, reader(edge + 1).detail]).toEqual(["final", "past retention"]);
	});

	test("a missing key decides nothing, at every state and for every seat the run asks, before any request is sent", () => {
		// Four states, each decided with every key: verification, inside n, after n, and a disputed game
		// before its day 7. Every seat is asked in each.
		const verifying: ChainGame = { ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null };
		const after = lakers3.start! + lakers3.n + 60;
		const disputed: ChainGame = {
			...lakers3,
			status: "disputed",
			dispute: { at: NOW - 3600, records: [[1, 2, 3, 4].map((seat) => ({ seat, kind: 2 as const, homeScore: seat === 2 ? 128 : 127, awayScore: 105 }))] },
		};
		const states: [string, ChainGame, number, string][] = [
			["verification", verifying, NOW, "start"],
			["inside n", lakers3, NOW, "score"],
			["after n", lakers3, after, "score"],
			["disputed", disputed, NOW, "score"],
		];
		for (const [state, game, now, decided] of states) {
			const all = run(game, ALL, now);
			expect({ state, got: [all.action, all.asked > 0] }).toEqual({ state, got: [decided, true] });
			for (const seat of [1, 2, 3, 4] as const) {
				const keys: Record<number, string> = { ...ALL };
				delete keys[seat];
				const o = run(game, keys, now);
				expect({ state, seat, got: [o.action, o.why, o.report, o.asked] }).toEqual({ state, seat, got: ["wait", `seat ${seat} has no key`, null, 0] });
			}
		}
		// A key that is there but empty, or not text, is no key.
		for (const bad of ["", 7, null]) {
			const o = run(lakers3, { ...ALL, 2: bad } as unknown as Keys, NOW);
			expect({ bad, got: [o.action, o.why, o.asked] }).toEqual({ bad, got: ["wait", "seat 2 has no key", 0] });
		}
		// The day-7 run asks no seat: every seat has stopped being asked, so it needs no key at all and
		// decides on the votes on record, the same with every key as with none.
		const day7: ChainGame = { ...disputed, dispute: { ...disputed.dispute!, at: NOW - 7 * 86_400 } };
		const withKeys = run(day7, ALL, NOW);
		const without = run(day7, {}, NOW);
		expect([withKeys.action, withKeys.why, withKeys.asked]).toEqual(["score", "day 7: three sources or more, the same final", 0]);
		expect(without).toEqual(withKeys);
	});

	test("a key a request can't carry as given is no key: at every state and every seat it decides nothing, before any request", () => {
		const verifying: ChainGame = { ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null };
		const after = lakers3.start! + lakers3.n + 60;
		const states: [string, ChainGame, number][] = [
			["verification", verifying, NOW],
			["inside n", lakers3, NOW],
			["after n", lakers3, after],
		];
		// A space, a tab, a line break inside or at either end, a carriage return, a NUL, DEL, and characters
		// above 0x7E: a curly apostrophe pasted from a document, an accented letter.
		const forms = ["SEAT\nKEY", "SEATKEY\n", "\nSEATKEY", "SEAT\rKEY", " SEATKEY", "SEATKEY ", "SEAT KEY", "   ", "SEAT\tKEY", "SEAT\u0000KEY", "SEAT\u007fKEY", "SEAT’KEY", "SEATéKEY"];
		for (const [state, game, now] of states) {
			for (const seat of [1, 2, 3, 4] as const) {
				for (const bad of forms) {
					const o = run(game, { ...ALL, [seat]: bad }, now);
					expect({ state, seat, bad, got: [o.action, o.why, o.asked] }).toEqual({ state, seat, bad, got: ["wait", `seat ${seat} has no key`, 0] });
				}
			}
		}
		// The control: the ends of the range a key may use, the characters real keys use, and a stand-in
		// for a transport that fills the key itself.
		for (const good of ["!", "~", "SEATKEY", "aZ09-_.~+/=", "{{.seat2}}"]) {
			const o = run(lakers3, { ...ALL, 2: good }, NOW);
			expect({ good, got: o.action }).toEqual({ good, got: "score" });
		}
	});

	test("seat 4's key goes in the query, so it must be one query value as given: anything the encoding would change is no key", () => {
		const verifying: ChainGame = { ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null };
		const after = lakers3.start! + lakers3.n + 60;
		// Visible ASCII, so a header carries each of them, but a query reads them as more than one value or
		// as another: & and = start a parameter, # ends the query, + is a space, % an escape, / ? ; : @ $ ,
		// and the brackets of a stand-in are reserved.
		const forms = ["SEATKEY&dateFormat=unix", "SEATKEY&eventIds=x", "#SEATKEY", "SEAT+KEY", "SEAT%41KEY", "SEAT=KEY", "SEAT/KEY", "SEAT?KEY", "SEAT;KEY", "SEAT:KEY", "SEAT@KEY", "SEAT$KEY", "SEAT,KEY", "{{.seat4}}"];
		for (const [state, game, now] of [["verification", verifying, NOW], ["inside n", lakers3, NOW], ["after n", lakers3, after]] as const) {
			for (const bad of forms) {
				const o = run(game, { ...ALL, 4: bad }, now);
				expect({ state, bad, got: [o.action, o.why, o.asked] }).toEqual({ state, bad, got: ["wait", "seat 4 has no key", 0] });
			}
		}
		// The same forms at a seat whose key goes in a header: carried as given, and the run decides.
		for (const seat of [1, 2, 3] as const) {
			for (const bad of forms) {
				const o = run(lakers3, { ...ALL, [seat]: bad }, NOW);
				expect({ seat, bad, got: o.action }).toEqual({ seat, bad, got: "score" });
			}
		}
		// The control at seat 4: what one query value carries as given, the real key's hex form included.
		// The saved answers were asked with the stand-in key, so the transport reads each request under it,
		// after checking the key reached the query exactly as handed in.
		for (const good of ["SEATKEY", "0123456789abcdef0123456789abcdef", "aZ09-_.~", "!*'()"]) {
			const t = saved(seat3Final, NOW);
			const sent: string[] = [];
			const o = scoreGameSync(lakers3, { ...ALL, 4: good }, PAYOUT, NOW, (q) => {
				if (locate(q)?.seat !== 4) return t.send(q);
				sent.push(new URL(q.url).searchParams.get("apiKey") ?? "");
				return t.send({ ...q, url: q.url.replace(`apiKey=${good}`, `apiKey=${KEY}`) });
			});
			expect(t.misses).toEqual([]);
			expect({ good, got: [o.decision.action, sent] }).toEqual({ good, got: ["score", [good]] });
		}
	});

	test("a key that adds to seat 4's query never hides its dissent: Cleveland at Philadelphia, the spare at 115-107", () => {
		// The spare dissents inside n: with the key as given, the record is posted. A key ending in
		// "&dateFormat=unix" would be carried into the query: a feed that honours it answers 200 with the
		// game times as numbers, the spare reads "no game time", and the run scored 114-106 on seats 1 to
		// 3. The transport below answers that way. Now that key is no key, and nothing is asked.
		const sixers = chainOf("nba final, read after the game");
		const spareOff: Derive = (s, p, b) =>
			s === 4 && p.includes("basketball_nba")
				? (copy(b) as Record<string, any>[]).map((g) => (g.id === "110e33c79c5ec8c0377702aff685f83b" ? { ...g, scores: g.scores.map((x: Record<string, unknown>) => ({ ...x, score: String(Number(x.score) + 1) })) } : g))
				: b;
		const go = (key4: string) => {
			const t = saved(spareOff, LATE);
			const o = scoreGameSync(sixers, { ...ALL, 4: key4 }, PAYOUT, LATE, (q) => {
				if (q.url.endsWith("&dateFormat=unix")) {
					const res = t.send({ ...q, url: q.url.slice(0, -"&dateFormat=unix".length) });
					const body = (JSON.parse(res.body) as Record<string, unknown>[]).map((g) => ({ ...g, commence_time: 1792710000 }));
					return { status: 200, body: JSON.stringify(body) };
				}
				return t.send(q);
			});
			expect(t.misses).toEqual([]);
			return [o.decision.action, o.decision.why, t.asked.length > 0];
		};
		expect(go(KEY)).toEqual(["dispute", "two finals differ", true]);
		expect(go(`${KEY}&dateFormat=unix`)).toEqual(["wait", "seat 4 has no key", false]);
	});

	test("a key with a line break, through a transport built like fetch: the dispute it would have hidden is never decided on fewer seats", () => {
		// Cleveland at Philadelphia after n, seat 2 derived to 115-106: with the right key, the run disputes.
		// A fetch-style transport won't build a header holding a line break (Bun 1.3.14), so before the key
		// check the seat read silent and the run scored 114-106 on seats 1 and 3.
		expect(() => new Headers({ "x-key": "SEAT\nKEY" })).toThrow();
		const sixers = chainOf("nba final, read after the game");
		const seat2Off: Derive = (s, p, b) => {
			if (s !== 2 || !p.startsWith("/games?league=NBA")) return b;
			const c = copy(b) as { results: Record<string, any>[] };
			for (const g of c.results) if (g.gameId === 340484) g.scoreboard.score.home = 115;
			return c;
		};
		const go = (keys: Keys) => {
			const t = saved(seat2Off, LATE);
			const o = scoreGameSync(sixers, keys, PAYOUT, sixers.start! + sixers.n, (q) => {
				new Headers(q.headers);
				new URL(q.url);
				return t.send(q);
			});
			expect(t.misses).toEqual([]);
			return [o.decision.action, o.decision.why, t.asked.length > 0];
		};
		expect(go(ALL)).toEqual(["dispute", "two finals differ", true]);
		expect(go({ ...ALL, 2: "SEAT\nKEY" })).toEqual(["wait", "seat 2 has no key", false]);
	});

	test("a key the feed refuses (400, 401, 402, 403, 429) decides nothing, and nothing more is asked; any other failure is a silent seat", () => {
		const after = lakers3.start! + lakers3.n + 60;
		for (const status of [400, 401, 402, 403, 429]) {
			for (const seat of [1, 2, 3, 4] as const) {
				const o = run(lakers3, ALL, after, seat, status);
				expect({ status, seat, got: [o.action, o.why, o.report] }).toEqual({ status, seat, got: ["wait", `seat ${seat}'s key was refused: http ${status}`, null] });
				// The refusal ends the run: no seat after it is asked.
				expect({ status, seat, later: o.seats.filter((s) => s > seat) }).toEqual({ status, seat, later: [] });
			}
		}
		// The control: a feed that fails another way is silent on that run, and after n two finals beside it score.
		for (const status of [404, 500, 503]) {
			const o = run(lakers3, ALL, after, 2, status);
			expect({ status, got: [o.action, o.why] }).toEqual({ status, got: ["score", "after n: two counting seats or more, the same final, the rest silent"] });
		}
	});

	test("the three runs a key used to decide: each waits without the key, and the dispute stands with it", () => {
		// Cleveland at Philadelphia, read after the game: seats 1 to 3 114-106.
		const sixers = chainOf("nba final, read after the game");
		const sixersAt = (now: number, keys: Keys, derive: Derive, refuse?: number) => {
			const t = saved(derive, LATE);
			const o = scoreGameSync(sixers, keys, PAYOUT, now, (q) => (refuse !== undefined && locate(q)?.seat === refuse ? { status: 401, body: "" } : t.send(q)));
			expect(t.misses).toEqual([]);
			return [o.decision.action, o.decision.why];
		};
		const without = (seat: number): Keys => Object.fromEntries(Object.entries(ALL).filter(([s]) => Number(s) !== seat));
		// Inside n, the spare dissents, 115-107: every seat shows a final, so the record is posted.
		const spareOff: Derive = (s, p, b) =>
			s === 4 && p.includes("basketball_nba")
				? (copy(b) as Record<string, any>[]).map((g) => (g.id === "110e33c79c5ec8c0377702aff685f83b" ? { ...g, scores: g.scores.map((x: Record<string, unknown>) => ({ ...x, score: String(Number(x.score) + 1) })) } : g))
				: b;
		expect(sixersAt(LATE, ALL, spareOff)).toEqual(["dispute", "two finals differ"]);
		expect(sixersAt(LATE, without(4), spareOff)).toEqual(["wait", "seat 4 has no key"]);
		expect(sixersAt(LATE, ALL, spareOff, 4)).toEqual(["wait", "seat 4's key was refused: http 401"]);
		// After n, seat 2 dissents, 115-106.
		const afterN = sixers.start! + sixers.n;
		const seat2Off: Derive = (s, p, b) => {
			if (s !== 2 || !p.startsWith("/games?league=NBA")) return b;
			const c = copy(b) as { results: Record<string, any>[] };
			for (const g of c.results) if (g.gameId === 340484) g.scoreboard.score.home = 115;
			return c;
		};
		expect(sixersAt(afterN, ALL, seat2Off)).toEqual(["dispute", "two finals differ"]);
		expect(sixersAt(afterN, without(2), seat2Off)).toEqual(["wait", "seat 2 has no key"]);
		expect(sixersAt(afterN, ALL, seat2Off, 2)).toEqual(["wait", "seat 2's key was refused: http 401"]);
		// After n, the same game not yet final at seats 1 and 2, and final at seat 3: a dispute, never a void.
		const notFinal = chainOf("nba not final");
		const seat3Final: Derive = (s, p, b) =>
			s === 3 && p === `/results/${SEAT3_ID}` ? (copy(b) as Record<string, unknown>[]).map((r) => ({ ...r, Final: true, FinalType: "Finished", HomeScore: "114", AwayScore: "106" })) : b;
		const at3 = (keys: Keys) => {
			const t = saved(seat3Final, NOW);
			const o = scoreGameSync(notFinal, keys, PAYOUT, notFinal.start! + notFinal.n, t.send);
			expect(t.misses).toEqual([]);
			return [o.decision.action, o.decision.why];
		};
		expect(at3(ALL)).toEqual(["dispute", "after n: finals beside answers without a final"]);
		expect(at3(without(3))).toEqual(["wait", "seat 3 has no key"]);
	});

	test("nothing handed in beside the keys, and nothing riding on the game object, changes a decision", () => {
		const base = outcome(lakers3, ALL);
		const extraKeys = { ...ALL, 5: KEY, 0: KEY, insideN: 2, afterN: 1, counting: [1, 2, 4], spare: 3 } as unknown as Keys;
		expect(outcome(lakers3, extraKeys)).toEqual(base);
		const extraGame = { ...lakers3, need: 2, insideN: 2, counting: [1, 2, 4], spare: 3, agree: 1 } as unknown as ChainGame;
		expect(outcome(extraGame, ALL)).toEqual(base);
		const hostile: Record<string, string> = { OSPEX_AGREE: "1", OSPEX_INSIDE_N: "2", OSPEX_AFTER_N: "1", OSPEX_DAY7: "2", OSPEX_COUNTING: "1,2,4", OSPEX_SPARE: "3", START_SPREAD: "999999" };
		const prior: Record<string, string | undefined> = {};
		for (const [k, v] of Object.entries(hostile)) {
			prior[k] = process.env[k];
			process.env[k] = v;
		}
		try {
			expect(outcome(lakers3, ALL)).toEqual(base);
			const no3 = outcome(lakers3, { 1: KEY, 2: KEY, 4: KEY });
			expect(no3.action).toBe("wait");
		} finally {
			for (const [k, v] of Object.entries(prior)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		}
	});

	test("the payout lands in the payout field and nowhere else", () => {
		const base = outcome(lakers3, ALL).report!;
		expect({ kind: base.kind, home: base.homeScore, away: base.awayScore }).toEqual({ kind: 2, home: 127, away: 105 });
		for (const payout of ["0x000000000000000000000000000000000001dEaD", "0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF", "0x0000000000000000000000000000000000010000"]) {
			const r = outcome(lakers3, ALL, payout).report!;
			expect(r.payout).toBe(payout);
			expect({ ...r, payout: "" }).toEqual({ ...base, payout: "" });
		}
	});

	test("a payout that is not a usable address writes nothing, and decides nothing either", () => {
		for (const bad of [
			"",
			"0x",
			"0x0000000000000000000000000000000000000000",
			"0x12",
			"1111111111111111111111111111111111111111",
			"0xGGGG000000000000000000000000000000000000",
			`${PAYOUT}ff`, // an address with more after it
			` ${PAYOUT}`,
			// What the games set refuses as a payout: the reserved range to its last address, its own
			// address, its coin's, and its reporters', in either case.
			"0x0000000000000000000000000000000000000001",
			"0x000000000000000000000000000000000000ffff",
			PAYOUT_REFUSED.gamesSet,
			PAYOUT_REFUSED.coin.toUpperCase().replace("0X", "0x"),
			...PAYOUT_REFUSED.reporters,
		]) {
			const t = saved(seat3Final, NOW);
			expect({ bad, threw: throws(() => scoreGameSync(lakers3, ALL, bad, NOW, t.send)) }).toEqual({ bad, threw: true });
		}
	});
});

function throws(f: () => void): boolean {
	try {
		f();
		return false;
	} catch {
		return true;
	}
}
