// Never: "A final counts only if the feed's own game time for that record is inside the window,
// so a makeup game never scores the original game."
//
// The window is [start, start + n). Each refusal below is paired with the acceptance one second
// the other side of the edge, and each refusal reads "outside window": the record was in the
// feed's answer and the window turned it away, so the test cannot pass on a record that simply
// wasn't fetched.
//
// The break that turns this red (window.ts, inWindow):
//   return time >= w.from && time < w.to;
//   ->  return time >= w.from && time <= w.to;

import { describe, expect, test } from "bun:test";
import type { Game, Seat } from "../src/types";
import { CASES, NOW } from "./cases";
import { at, copy, readSaved, type Derive } from "./fixtures";

const DAY = 86_400;
const byName = (prefix: string) => CASES.find((c) => c.name.startsWith(prefix))!;

function read(seat: Seat, game: Game, derive?: Derive) {
	const { reading, misses } = readSaved(seat, game, NOW, derive);
	expect(misses).toEqual([]);
	return { kind: reading.kind, home: reading.home, away: reading.away, detail: reading.detail, id: reading.record?.id ?? null };
}

describe("never: a final outside the window counts", () => {
	test("both edges, on a real final, at every seat that has one: start in, start + n out", () => {
		const lakers = byName("nba final");
		for (const seat of [1, 2, 4] as Seat[]) {
			const want = lakers.expect[seat]!;
			// The feed's own time for its record, read once with the game as it was.
			const t = readSaved(seat, lakers.game, NOW).reading.record!.time;
			const at = (start: number, n = DAY) => read(seat, { ...lakers.game, start, n });
			const final = { kind: "final", home: want.home, away: want.away, detail: "final", id: want.id };
			const out = { kind: "no_final", home: null, away: null, detail: "outside window", id: want.id };
			expect({ seat, edge: "start = feed time", ...at(t) }).toEqual({ seat, edge: "start = feed time", ...final });
			expect({ seat, edge: "start one second after", ...at(t + 1) }).toEqual({ seat, edge: "start one second after", ...out });
			expect({ seat, edge: "start + n one second after", ...at(t - DAY + 1) }).toEqual({ seat, edge: "start + n one second after", ...final });
			expect({ seat, edge: "start + n = feed time", ...at(t - DAY) }).toEqual({ seat, edge: "start + n = feed time", ...out });
		}
	});

	test("a real final at exactly start + n does not count; one second later it does", () => {
		// Arizona at Miami, 17:10 UTC on 11 Jun, 2-0. Its window here runs from midnight, so its end
		// falls exactly on the game; the two teams' 10 Jun game is in the same answer, before the start.
		const game = byName("mlb final: Arizona at Miami").game;
		for (const seat of [1, 2] as Seat[]) {
			const start = at("2026-06-11T00:00:00Z");
			const n = game.start - start;
			expect({ seat, ...read(seat, { ...game, start, n }) }).toMatchObject({ seat, kind: "no_final", detail: "outside window" });
			expect({ seat, ...read(seat, { ...game, start, n: n + 1 }) }).toMatchObject({ seat, kind: "final", home: 2, away: 0 });
		}
	});

	test("the window is the game's n: the same real final is in at 24 h and out at 1 h", () => {
		const lakers = byName("nba final");
		for (const seat of [1, 2] as Seat[]) {
			const start = lakers.game.start - 2 * 3600;
			expect({ seat, ...read(seat, { ...lakers.game, start, n: DAY }) }).toMatchObject({ seat, kind: "final" });
			expect({ seat, ...read(seat, { ...lakers.game, start, n: 3600 }) }).toMatchObject({ seat, kind: "no_final", detail: "outside window" });
		}
	});

	test("the day before's real final between the same teams never scores a postponed game", () => {
		// The answer for 11 Jun holds the 10 Jun game, Atlanta at the White Sox, final 2-1, and the
		// 11 Jun game, rained out. The 11 Jun game reads postponed (or cancelled), never 2-1.
		const rainout = byName("mlb postponed");
		expect(read(1, rainout.game)).toEqual({ kind: "no_final", home: 0, away: 0, detail: "postponed", id: "5058800" });
		expect(read(2, rainout.game)).toEqual({ kind: "no_final", home: 0, away: 0, detail: "canceled", id: "336995" });
	});

	test("a makeup never scores the original game, wherever the feed puts it", () => {
		const rainout = byName("mlb postponed").game; // 11 Jun, 23:40 UTC
		// Derived from the real answers: every Atlanta-White Sox record taken out (the 10 Jun final
		// and the 11 Jun rainout), and the real makeup (20 Aug, Atlanta 2-0) put in, as a feed that
		// re-dated the game would list it. The makeup is then the only record of the two teams, so
		// "outside window" can only be the window turning it away.
		const seat1Makeup: Derive = (seat, path, body) => {
			if (seat !== 1) return body;
			const b = copy(body) as { data: Record<string, unknown>[] };
			const original = b.data.find((g) => g.id === 5058800);
			b.data = b.data.filter((g) => g.id !== 5058800 && g.id !== 5058788);
			if (original) b.data.push({ ...original, ...MAKEUP_1 });
			return b;
		};
		const seat2Makeup: Derive = (seat, path, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results: Record<string, unknown>[] };
			const original = b.results.find((g) => g.gameId === 336995);
			b.results = b.results.filter((g) => g.gameId !== 336995 && g.gameId !== 336985);
			if (original) b.results.push({ ...original, ...MAKEUP_2 });
			return b;
		};
		expect(read(1, rainout, seat1Makeup)).toEqual({ kind: "no_final", home: null, away: null, detail: "outside window", id: "8800381" });
		expect(read(2, rainout, seat2Makeup)).toEqual({ kind: "no_final", home: null, away: null, detail: "outside window", id: "340378" });
		// The control: the same derived answer read for the makeup's own game scores it.
		const makeupGame = byName("mlb final: the makeup").game;
		expect(read(1, makeupGame)).toMatchObject({ kind: "final", home: 0, away: 2, id: "8800381" });

		// And as a feed that moved the original record itself, keeping its id: the creation hint
		// names it, it is the game, and outside the window it reads "no final" and nothing else is
		// searched.
		const moved1: Derive = (seat, path, body) => {
			if (seat !== 1 || !path.includes("2026-06-11")) return body;
			const b = copy(body) as { data: Record<string, unknown>[] };
			const g = b.data.find((x) => x.id === 5058800)!;
			Object.assign(g, { date: MAKEUP_1.date, status: "STATUS_FINAL", status_state: "final" });
			(g.home_team_data as Record<string, unknown>).runs = 0;
			(g.away_team_data as Record<string, unknown>).runs = 2;
			return b;
		};
		const hinted = { ...rainout, hints: [{ seat: 1, id: "5058800" }] };
		expect(read(1, hinted, moved1)).toEqual({ kind: "no_final", home: null, away: null, detail: "outside window", id: "5058800" });
	});

	test("seat 3's board records are held to the window too", () => {
		const bears = byName("nfl not final");
		const t = bears.game.start;
		expect(read(3, { ...bears.game, start: t })).toMatchObject({ kind: "no_final", detail: "NotFinished" });
		// On the real answer, a board record outside the window cannot make the game absent: the
		// feed's finished results have no teams or time, and one of them could be the game.
		expect(read(3, { ...bears.game, start: t - DAY })).toMatchObject({ kind: "silent", detail: "results without teams or time" });
		// Derived: the results cut to the games still on the board. Then the window alone decides.
		const boardOnly: Derive = (seat, path, body) => {
			if (seat !== 3 || !path.startsWith("/results/")) return body;
			return (body as Record<string, unknown>[]).filter((r) => r.FinalType === "NotFinished");
		};
		expect(read(3, { ...bears.game, start: t }, boardOnly)).toMatchObject({ kind: "no_final", detail: "NotFinished" });
		expect(read(3, { ...bears.game, start: t - DAY }, boardOnly)).toMatchObject({ kind: "no_final", detail: "outside window" });
		expect(read(3, { ...bears.game, start: t - DAY + 1 }, boardOnly)).toMatchObject({ kind: "no_final", detail: "NotFinished" });
		expect(read(3, { ...bears.game, start: t + 1 }, boardOnly)).toMatchObject({ kind: "no_final", detail: "outside window" });
	});
});

// The real makeup's own fields, from the saved 20 Aug answers (seat 1 id 8800381, seat 2 id 340378).
const MAKEUP_1 = {
	id: 8800381,
	date: "2026-08-20T18:10:00.000Z",
	status: "STATUS_FINAL",
	status_state: "final",
	home_team_name: "Chicago White Sox",
	away_team_name: "Atlanta Braves",
	home_team_data: { runs: 0 },
	away_team_data: { runs: 2 },
};
const MAKEUP_2 = {
	gameId: 340378,
	schedule: { date: "2026-08-20T18:10:00.000Z", tbaTime: false },
	status: "final",
	scoreboard: { score: { home: 0, away: 2 } },
};
