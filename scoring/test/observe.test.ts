// The program's observer (src/observe.ts): told how each read of a seat the run reaches ended, answered,
// silent or skipped, and never asked anything. The record a caller keeps from it (the games workflow's
// run-line) rests on two things this file holds: the observer changes nothing the program decides or
// reports, whatever it does; and each read is told once, by how it ended.
//
// The breaks that turn this red, each applied once and restored:
//   src/observe.ts, noter: the observer's fault let through,
//     try { observer.read(seat, outcome); } catch { ... }
//     ->  observer.read(seat, outcome);
//   with which an observer that throws stops the run;
//   src/program.ts, scoreGameSync: every read told as answered,
//     note(seatOf(job), readOutcomeOf(t.asked(), done.kind !== "silent"));
//     ->  note(seatOf(job), "answered");
//   with which a silent seat is told as an answer.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../src/chain";
import { noter, readOutcomeOf, type Observer, type ReadOutcome } from "../src/observe";
import { scoreGameSync } from "../src/program";
import { Cut, isCut } from "../src/run";
import type { HttpRequest, HttpResponse, Seat } from "../src/types";
import { CASES, LATE, NOW } from "./cases";
import { KEY, locate, saved } from "./fixtures";
import { PAYOUT, PAYOUT_REFUSED, chainOf } from "./rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

/** An observer that keeps what it is told, in order. */
function told(): { observer: Observer; told: string[] } {
	const out: string[] = [];
	return { told: out, observer: { read: (seat: Seat, outcome: ReadOutcome) => void out.push(`${seat} ${outcome}`) } };
}

const THROWS: Observer = {
	read() {
		throw new Error("an observer that fails");
	},
};

const SIXERS = chainOf("nba final, read after the game");
const NFL: ChainGame = { ...chainOf("nfl not final"), status: "unverified", start: null, startReadings: null };

function outcome(game: ChainGame, now: number, observer?: Observer, send?: (req: HttpRequest) => HttpResponse) {
	const t = saved(undefined, now);
	try {
		return { outcome: scoreGameSync(game, KEYS, PAYOUT, now, send ?? t.send, observer), threw: null };
	} catch (e) {
		return { outcome: null, threw: e };
	}
}

describe("the observer", () => {
	test("the record decides nothing: every saved case, verified and unverified, decides and reports the same with an observer, without one, and with one that throws on every call", () => {
		let compared = 0;
		for (const c of CASES) {
			const verified = chainOf(c.name, { payoutRefused: PAYOUT_REFUSED });
			const unverified: ChainGame = { ...verified, status: "unverified", start: null, startReadings: null, dispute: null };
			for (const game of [verified, unverified]) {
				const without = outcome(game, c.now);
				expect(without.threw).toBeNull();
				for (const observer of [told().observer, THROWS]) {
					expect({ name: c.name, status: game.status, ...outcome(game, c.now, observer) }).toEqual({ name: c.name, status: game.status, ...without });
				}
				compared++;
			}
		}
		expect(compared).toBe(2 * CASES.length);
	});

	test("each read the run reaches is told once, in the order it ran, by how it ended", () => {
		const scoring = told();
		outcome(SIXERS, LATE, scoring.observer);
		expect(scoring.told).toEqual(["1 answered", "2 answered", "3 answered", "4 answered"]);
		// Verification: each seat over the range, seat 3 by its board, then every seat again in the window.
		const verifying = told();
		expect(outcome(NFL, NOW, verifying.observer).outcome?.decision.action).toBe("start");
		expect(verifying.told).toEqual(["1 answered", "2 answered", "3 answered", "4 answered", "1 answered", "2 answered", "3 answered", "4 answered"]);
		// A seat that answers with nothing usable is told silent; the others as before.
		const t = saved(undefined, LATE);
		const silent = told();
		outcome(SIXERS, LATE, silent.observer, (req) => (locate(req)?.seat === 2 ? { status: 503, body: "" } : t.send(req)));
		expect(silent.told).toEqual(["1 answered", "2 silent", "3 answered", "4 answered"]);
	});

	test("skips: the seat silent for the game, every seat closed at day 7, a seat without its key, and seat 3's board without a usable hint", () => {
		const down = told();
		outcome({ ...SIXERS, startReadings: SIXERS.startReadings!.map((r) => (r.seat === 3 ? { ...r, kind: 0 } : r)) }, LATE, down.observer);
		expect(down.told).toEqual(["1 answered", "2 answered", "3 skipped", "4 answered"]);
		const at = SIXERS.start! + 3_600;
		const disputed: ChainGame = { ...SIXERS, status: "disputed", dispute: { at, records: [SIXERS.startReadings!] } };
		const day7 = told();
		expect(outcome(disputed, at + SIXERS.day7 + 60, day7.observer).outcome?.decision.action).not.toBe("wait");
		expect(day7.told).toEqual(["1 skipped", "2 skipped", "3 skipped", "4 skipped"]);
		const keyless = told();
		const t = saved(undefined, LATE);
		expect(scoreGameSync(SIXERS, { 1: KEY, 2: KEY, 3: KEY }, PAYOUT, LATE, t.send, keyless.observer).decision.why).toBe("seat 4 has no key");
		expect([keyless.told, t.asked.length]).toEqual([["4 skipped"], 0]);
		const hintless = told();
		outcome({ ...NFL, hints: NFL.hints.filter((h) => h.seat !== 3) }, NOW, hintless.observer);
		expect(hintless.told.slice(0, 4)).toEqual(["1 answered", "2 answered", "3 skipped", "4 answered"]);
	});

	test("a read the caller's count cuts is told as a skip of its seat, and the cut is still raised; a refused key is told silent, and the run decides nothing as before", () => {
		const t = saved(undefined, LATE);
		let sent = 0;
		const cut = told();
		const r = outcome(SIXERS, LATE, cut.observer, (req) => {
			if (++sent > 3) throw new Cut("the run's 3 requests are used");
			return t.send(req);
		});
		expect(isCut(r.threw)).toBe(true);
		// Seat 1 sends one request and seat 2 two; seat 3's, the fourth, is the cut.
		expect(cut.told).toEqual(["1 answered", "2 answered", "3 skipped"]);
		const refused = told();
		const t2 = saved(undefined, LATE);
		const k = outcome(SIXERS, LATE, refused.observer, (req) => (locate(req)?.seat === 1 ? { status: 401, body: "" } : t2.send(req)));
		expect(k.outcome?.decision.why).toBe("seat 1's key was refused: http 401");
		expect(refused.told).toEqual(["1 silent"]);
	});

	test("how a read ended, from what it asked and what it gave; an absent observer is nothing, a failing one is swallowed", () => {
		expect([readOutcomeOf(0, false), readOutcomeOf(0, true), readOutcomeOf(1, false), readOutcomeOf(1, true), readOutcomeOf(3, false)]).toEqual(["skipped", "skipped", "silent", "answered", "silent"]);
		expect(() => noter(undefined)(1, "answered")).not.toThrow();
		expect(() => noter(THROWS)(1, "answered")).not.toThrow();
		const kept = told();
		noter(kept.observer)(4, "skipped");
		expect(kept.told).toEqual(["4 skipped"]);
	});
});
