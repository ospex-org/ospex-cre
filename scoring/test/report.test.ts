// The report the program builds is the games set's one shape. The field names, their order and the
// enum numbers below are copied as literals from ospex-contracts-v2, src/games/IOspexGames.sol, on
// main at b9e9383, unchanged since fe1f465 (`struct Report`, `struct Reading`, `enum ReportKind`,
// `enum ReadingKind`); the payout refusals from OspexGames.sol's `_checkPayout` at b9e9383. A change
// on this side shows here. A change in the games set shows only when these literals are copied again:
// nothing here reads the other repository.

import { describe, expect, test } from "bun:test";
import { READING_KIND, REPORT_KIND, type Decision } from "../src/chain";
import { NO_PAYOUT, payoutRefusal, toReport, toReportReading } from "../src/report";
import type { Reading } from "../src/types";
import { PAYOUT, PAYOUT_REFUSED, SEATS4, reading } from "./rule-helpers";

const readings: Reading[] = [reading(1, "A"), reading(2, "none"), reading(3, "silent"), { ...reading(4, "none"), home: null, away: null }];

describe("the report, in the games set's shape", () => {
	test("the enum numbers are the games set's", () => {
		// enum ReportKind { None, Start, Score, Void, Dispute }
		expect({ ...REPORT_KIND }).toEqual({ start: 1, score: 2, void: 3, dispute: 4 });
		// enum ReadingKind { Silent, AnsweredNoFinal, AnsweredFinal }
		expect({ ...READING_KIND }).toEqual({ silent: 0, noFinal: 1, final: 2 });
	});

	test("the fields are the games set's, in its order, for every kind of report", () => {
		const decisions: Decision[] = [
			{ action: "start", start: 1_792_000_000, readings, why: "" },
			{ action: "score", home: 27, away: 20, readings, why: "" },
			{ action: "void", readings, why: "" },
			{ action: "dispute", readings, why: "" },
		];
		const got = decisions.map((d) => toReport("7", d, PAYOUT, PAYOUT_REFUSED)!);
		for (const r of got) {
			// struct Report { gameId, kind, start, homeScore, awayScore, readings, payout }
			expect(Object.keys(r)).toEqual(["gameId", "kind", "start", "homeScore", "awayScore", "readings", "payout"]);
			// struct Reading { seat, kind, homeScore, awayScore }
			for (const x of r.readings) expect(Object.keys(x)).toEqual(["seat", "kind", "homeScore", "awayScore"]);
		}
		// Each kind fills only its own fields; the rest are zero, as the games set requires.
		expect(got.map((r) => [r.gameId, r.kind, r.start, r.homeScore, r.awayScore, r.payout])).toEqual([
			["7", 1, 1_792_000_000, 0, 0, NO_PAYOUT], // a start pays nothing: the games set refuses any other payout
			["7", 2, 0, 27, 20, PAYOUT],
			["7", 3, 0, 0, 0, PAYOUT],
			["7", 4, 0, 0, 0, NO_PAYOUT], // a dispute record credits nothing
		]);
	});

	test("readings: one per seat asked, in seat order, each its seat, its kind and, when it answered, its points", () => {
		const r = toReport("7", { action: "dispute", readings, why: "" }, PAYOUT, PAYOUT_REFUSED)!;
		expect(r.readings).toEqual([
			{ seat: 1, kind: 2, homeScore: 27, awayScore: 20 },
			{ seat: 2, kind: 1, homeScore: 27, awayScore: 20 }, // answered without a final, with the points it gave
			{ seat: 3, kind: 0, homeScore: 0, awayScore: 0 },
			{ seat: 4, kind: 1, homeScore: 0, awayScore: 0 }, // answered without a final and without points
		]);
		// A seat that answered without a final, with points: the points as it gave them.
		expect(toReportReading({ ...reading(2, "none"), home: 3, away: 1 })).toEqual({ seat: 2, kind: 1, homeScore: 3, awayScore: 1 });
		// A silent seat carries no points, whatever a reader left beside it.
		expect(toReportReading({ ...reading(3, "silent"), home: 9, away: 9 })).toEqual({ seat: 3, kind: 0, homeScore: 0, awayScore: 0 });
		expect(r.readings.map((x) => x.seat)).toEqual([...SEATS4]);
	});

	test("a wait writes nothing; a game id the games set could not have issued is refused", () => {
		expect(toReport("7", { action: "wait", readings, why: "" }, "not an address", PAYOUT_REFUSED)).toBeNull();
		for (const id of ["0", "", "07", "-1", "1e3", "0x10", "1".repeat(79)]) {
			expect({ id, threw: throws(() => toReport(id, { action: "void", readings, why: "" }, PAYOUT, PAYOUT_REFUSED)) }).toEqual({ id, threw: true });
		}
		expect(toReport("1".repeat(78), { action: "void", readings, why: "" }, PAYOUT, PAYOUT_REFUSED)?.gameId).toBe("1".repeat(78));
	});

	test("the payout: every address the games set refuses as a score's payout is refused here, and nothing else", () => {
		const R = PAYOUT_REFUSED;
		const rows: [string, string, string | null][] = [
			["address 0", "0x0000000000000000000000000000000000000000", "the payout is address 0"],
			["the reserved range's first", "0x0000000000000000000000000000000000000001", "the payout is in the reserved range, up to 0xffff"],
			["the native coin's contract on Polygon", "0x0000000000000000000000000000000000001010", "the payout is in the reserved range, up to 0xffff"],
			["the reserved range's last", "0x000000000000000000000000000000000000FFFF", "the payout is in the reserved range, up to 0xffff"],
			["the first address past it", "0x0000000000000000000000000000000000010000", null],
			["the games set", R.gamesSet, "the payout is the games set's own address"],
			["the coin, in capitals", `0x${R.coin.slice(2).toUpperCase()}`, "the payout is the coin's address"],
			["a reporter", R.reporters[0], "the payout is an address approved as a reporter"],
			["another reporter, retired or not", R.reporters[1], "the payout is an address approved as a reporter"],
			["not an address", "0x12", "the payout is not an address"],
			["the payout the tests use", PAYOUT, null],
		];
		for (const [what, payout, why] of rows) expect({ what, got: payoutRefusal(payout, R) }).toEqual({ what, got: why });
		// Refused for every report, a start and a dispute report included, though neither carries it.
		for (const d of [{ action: "start", start: 1_792_000_000, readings, why: "" }, { action: "dispute", readings, why: "" }] as Decision[]) {
			expect({ d: d.action, threw: throws(() => toReport("7", d, R.reporters[0], R)) }).toEqual({ d: d.action, threw: true });
		}
		// The chain's refusals unreadable: nothing is written, for any payout.
		const unreadable = [
			{ ...R, gamesSet: "" },
			{ ...R, coin: "0x0000000000000000000000000000000000000000" },
			{ ...R, reporters: [] },
			{ ...R, reporters: [R.reporters[0], "not an address"] },
		];
		for (const refused of unreadable) {
			expect(payoutRefusal(PAYOUT, refused)).toBe("the games set's own address, its coin's or its reporters can't be read");
			expect(throws(() => toReport("7", { action: "score", home: 1, away: 0, readings, why: "" }, PAYOUT, refused))).toBe(true);
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
