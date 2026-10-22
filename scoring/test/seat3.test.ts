// Seat 3 is read by its creation hint (Vince, 10/22, ruling 1 on the Built report). Why, measured
// on the saved answers, and how its one answer per game is read.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, NOW } from "./cases";
import { INDEX, ROOT, copy, readSaved, type Derive } from "./fixtures";

const sixers = CASES.find((c) => c.name.startsWith("nba not final"))!;
const id = sixers.expect[3]!.id!;

describe("seat 3", () => {
	test("why it is read by hint: its board held no finished game, and its results name no teams and carry no time", () => {
		// The board and the five-day results, saved at 16:02 UTC on 22 Oct, five leagues in season.
		let finished = 0;
		let onBoard = 0;
		for (const league of ["nfl", "nba", "mlb", "nhl", "ncaaf"]) {
			const code = league.toUpperCase();
			const load = (path: string) => {
				const e = INDEX.find((x) => x.seat === 3 && x.path === path)!;
				return JSON.parse(readFileSync(join(ROOT, e.file), "utf8")) as Record<string, unknown>[];
			};
			const board = new Set(load(`/odds/${code}?oddType=Game`).map((g) => g.ID));
			const results = load(`/results/${code}`);
			for (const r of results) {
				// No team name and no time on any result row.
				expect(Object.keys(r).filter((k) => /team|matchtime|start|date|commence/i.test(k))).toEqual([]);
				if (r.OddType === "Game" && r.FinalType === "Finished") {
					finished++;
					if (board.has(r.ID)) onBoard++;
				}
			}
		}
		expect({ finished, onBoard }).toEqual({ finished: 150, onBoard: 0 });
	});

	test("one request, for the hinted id", () => {
		const { asked } = readSaved(3, sixers.game, NOW);
		expect(asked.map((q) => q.url.slice(q.url.indexOf("/", 8)))).toEqual([`/results/${id}`]);
	});

	test("only the game's own row is read: a hint naming a row for part of the game is silent", () => {
		// Derived from the real by-id answer: the row's type changed to a half, as a period row's is.
		const half: Derive = (seat, path, body) =>
			seat === 3 && path === `/results/${id}` ? (copy(body) as Record<string, unknown>[]).map((r) => ({ ...r, OddType: "FirstHalf", Final: true, FinalType: "Finished", HomeScore: "50", AwayScore: "48" })) : body;
		expect(readSaved(3, sixers.game, NOW, half).reading).toMatchObject({ kind: "silent", detail: "hint names a part of the game" });
		// The control: the same derived answer as the game's own row reads its final.
		const game: Derive = (seat, path, body) =>
			seat === 3 && path === `/results/${id}` ? (copy(body) as Record<string, unknown>[]).map((r) => ({ ...r, Final: true, FinalType: "Finished", HomeScore: "50", AwayScore: "48" })) : body;
		expect(readSaved(3, sixers.game, NOW, game).reading).toMatchObject({ kind: "final", home: 50, away: 48 });
		// A period row beside the game's row, under its own id, is not read.
		const beside: Derive = (seat, path, body) => {
			if (seat !== 3 || path !== `/results/${id}`) return body;
			const rows = copy(body) as Record<string, unknown>[];
			return [...rows, { ...rows[0], ID: "11111111-1111-4111-8111-111111111111", OddType: "FirstHalf", Final: true, FinalType: "Finished", HomeScore: "50", AwayScore: "48" }];
		};
		expect(readSaved(3, sixers.game, NOW, beside).reading).toMatchObject({ kind: "no_final", detail: "NotFinished", record: { id } });
	});

	test("the id listed twice in one answer is silent", () => {
		const twice: Derive = (seat, path, body) => (seat === 3 && path === `/results/${id}` ? [...(body as unknown[]), ...(body as unknown[])] : body);
		expect(readSaved(3, sixers.game, NOW, twice).reading).toMatchObject({ kind: "silent", detail: "duplicate result" });
	});
});
