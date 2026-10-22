// The report the program builds is the games set's one shape (B2). The field names, their order
// and the enum numbers below are copied as literals from ospex-contracts-v2,
// src/games/IOspexGames.sol, on PR #37 at 3b23239 (`struct Report`, `struct Reading`, `enum
// ReportKind`, `enum ReadingKind`). A change on this side shows here. A change in B2 shows only
// when these literals are copied again: nothing here reads the other repository.

import { describe, expect, test } from "bun:test";
import { READING_KIND, REPORT_KIND, type Decision } from "../src/chain";
import { toReport, toReportReading } from "../src/report";
import type { Reading } from "../src/types";
import { PAYOUT, SEATS4, reading } from "./rule-helpers";

const readings: Reading[] = [reading(1, "A"), reading(2, "none"), reading(3, "silent"), { ...reading(4, "none"), home: null, away: null }];

describe("the report, in B2's shape", () => {
	test("the enum numbers are B2's", () => {
		// enum ReportKind { None, Start, Score, Void, Dispute }
		expect({ ...REPORT_KIND }).toEqual({ start: 1, score: 2, void: 3, dispute: 4 });
		// enum ReadingKind { Silent, AnsweredNoFinal, AnsweredFinal }
		expect({ ...READING_KIND }).toEqual({ silent: 0, noFinal: 1, final: 2 });
	});

	test("the fields are B2's, in B2's order, for every kind of report", () => {
		const decisions: Decision[] = [
			{ action: "start", start: 1_792_000_000, readings, why: "" },
			{ action: "score", home: 27, away: 20, readings, why: "" },
			{ action: "void", readings, why: "" },
			{ action: "dispute", readings, why: "" },
		];
		const got = decisions.map((d) => toReport("7", d, PAYOUT)!);
		for (const r of got) {
			// struct Report { gameId, kind, start, homeScore, awayScore, readings, payout }
			expect(Object.keys(r)).toEqual(["gameId", "kind", "start", "homeScore", "awayScore", "readings", "payout"]);
			// struct Reading { seat, kind, homeScore, awayScore }
			for (const x of r.readings) expect(Object.keys(x)).toEqual(["seat", "kind", "homeScore", "awayScore"]);
		}
		// Each kind fills only its own fields; the rest are zero, as B2 requires.
		expect(got.map((r) => [r.gameId, r.kind, r.start, r.homeScore, r.awayScore, r.payout])).toEqual([
			["7", 1, 1_792_000_000, 0, 0, PAYOUT],
			["7", 2, 0, 27, 20, PAYOUT],
			["7", 3, 0, 0, 0, PAYOUT],
			["7", 4, 0, 0, 0, PAYOUT],
		]);
	});

	test("readings: one per seat asked, in seat order, each its seat, its kind and, when it answered, its points", () => {
		const r = toReport("7", { action: "dispute", readings, why: "" }, PAYOUT)!;
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
		expect(toReport("7", { action: "wait", readings, why: "" }, "not an address")).toBeNull();
		for (const id of ["0", "", "07", "-1", "1e3", "0x10", "1".repeat(79)]) {
			expect({ id, threw: throws(() => toReport(id, { action: "void", readings, why: "" }, PAYOUT)) }).toEqual({ id, threw: true });
		}
		expect(toReport("1".repeat(78), { action: "void", readings, why: "" }, PAYOUT)?.gameId).toBe("1".repeat(78));
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
