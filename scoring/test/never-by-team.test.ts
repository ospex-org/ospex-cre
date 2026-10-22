// Never: "Feeds are read by team, never by the home or away slot."
//
// Seats 1, 2 and 4. Seat 3 is read by its creation hint (Vince, 10/22): its results carry no team
// names, so its points are the feed's own home and away, bound to the game by the hint, and the
// binding is checked at verification. The last test here pins that, so it can't change unseen.
//
// Three ways a slot could leak in, each tested on the real saved answers:
//   1. the game was created with the teams the other way round from a feed (a neutral site);
//   2. a feed lists the teams the other way round from the game (a derived answer: the real one
//      with the feed's home and away blocks swapped whole);
//   3. a feed's points come as a list, and the list's order is taken for home and away (seat 4
//      lists home first in all 37 of its saved games, so the real bytes alone cannot catch this;
//      the derived answer reverses every list).
//
// The break that turns this red (pick.ts, readingOf):
//   const firstIsHome = resolveFeedTeam(league, r.teams[0]) === homeKey;
//   ->  const firstIsHome = true;

import { describe, expect, test } from "bun:test";
import type { Seat } from "../src/types";
import { CASES, NOW } from "./cases";
import { copy, readSaved, type Derive } from "./fixtures";

const SEATS: Seat[] = [1, 2, 4];

const SLOT_PAIRS: [string, string][] = [
	["home_team", "visitor_team"],
	["home_team", "away_team"],
	["home_team_score", "visitor_team_score"],
	["home_score", "away_score"],
	["home_team_data", "away_team_data"],
	["home_team_name", "away_team_name"],
	["HomeTeam", "AwayTeam"],
	["HomeScore", "AwayScore"],
	["home", "away"],
	["homePeriods", "awayPeriods"],
];

function swapSlots(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(swapSlots);
	if (v === null || typeof v !== "object") return v;
	const o: Record<string, unknown> = {};
	for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = swapSlots(x);
	for (const [a, b] of SLOT_PAIRS) {
		if (a in o && b in o) [o[a], o[b]] = [o[b], o[a]];
	}
	return o;
}

/** Every record in every answer with its home and away blocks swapped whole. */
const otherWayRound: Derive = (_seat, _path, body) => swapSlots(copy(body));

/** Seat 4's answers with every points list reversed. */
const reversedPoints: Derive = (seat, _path, body) => {
	if (seat !== 4 || !Array.isArray(body)) return body;
	return (copy(body) as Record<string, unknown>[]).map((e) =>
		Array.isArray(e.scores) ? { ...e, scores: [...(e.scores as unknown[])].reverse() } : e,
	);
};

function shape(r: ReturnType<typeof readSaved>["reading"]) {
	return { kind: r.kind, home: r.home, away: r.away, recorded: r.recorded, detail: r.detail, id: r.record?.id ?? null };
}

describe("never: read by the home or away slot", () => {
	test("a game created the other way round from the feeds reads each team's own points", () => {
		let finals = 0;
		for (const c of CASES) {
			const turned = { ...c.game, home: c.game.away, away: c.game.home };
			for (const seat of SEATS) {
				const want = c.expect[seat];
				if (want === undefined) continue;
				const { reading, misses } = readSaved(seat, turned, NOW);
				expect(misses).toEqual([]);
				expect({ case: c.name, seat, ...shape(reading) }).toEqual({ case: c.name, seat, ...want, home: want.away, away: want.home });
				if (want.kind === "final" && want.home !== want.away) finals++;
			}
		}
		expect(finals).toBe(20); // every final in the cases, at seats 1, 2 and 4
	});

	test("a feed that lists the teams the other way round still reads right", () => {
		let finals = 0;
		for (const c of CASES) {
			for (const seat of SEATS) {
				const want = c.expect[seat];
				if (want === undefined) continue;
				const { reading, misses } = readSaved(seat, c.game, NOW, otherWayRound);
				expect(misses).toEqual([]);
				expect({ case: c.name, seat, ...shape(reading) }).toEqual({ case: c.name, seat, ...want });
				if (want.kind === "final" && want.home !== want.away) finals++;
			}
		}
		expect(finals).toBe(20); // every final in the cases, at seats 1, 2 and 4
	});

	test("seat 4 pairs points with teams by name, not by place in its list", () => {
		let finals = 0;
		for (const c of CASES) {
			const want = c.expect[4];
			if (want === undefined) continue;
			const { reading, misses } = readSaved(4, c.game, NOW, reversedPoints);
			expect(misses).toEqual([]);
			expect({ case: c.name, ...shape(reading) }).toEqual({ case: c.name, ...want });
			if (want.kind === "final") finals++;
		}
		expect(finals).toBe(5);
	});

	test("a record is the game only when both teams are the game's", () => {
		// The Lakers' real final, asked about as if the Lakers had played someone else that night.
		const lakers = CASES.find((c) => c.name.startsWith("nba final"))!;
		const other = { ...lakers.game, away: "Boston Celtics" };
		for (const seat of [1, 2, 4] as Seat[]) {
			const { reading, misses } = readSaved(seat, other, NOW);
			expect(misses).toEqual([]);
			expect({ seat, kind: reading.kind, detail: reading.detail }).toEqual({ seat, kind: "no_final", detail: "absent" });
		}
	});

	test("seat 3 is read by its hint: its points are the feed's own home and away, whichever way the game was created", () => {
		// Derived from the real by-id answer for Cleveland at Philadelphia (still to play at capture),
		// given a final. The game as created and the same game created the other way round, both
		// under the same seat 3 hint, read the feed's home points as the game's home points.
		const sixers = CASES.find((c) => c.name.startsWith("nba not final"))!;
		const id = sixers.expect[3]!.id!;
		const finished: Derive = (seat, path, body) => {
			if (seat !== 3 || path !== `/results/${id}`) return body;
			return (copy(body) as Record<string, unknown>[]).map((r) => ({ ...r, Final: true, FinalType: "Finished", HomeScore: "112", AwayScore: "104" }));
		};
		const turned = { ...sixers.game, home: sixers.game.away, away: sixers.game.home };
		for (const game of [sixers.game, turned]) {
			const { reading, misses } = readSaved(3, game, NOW, finished);
			expect(misses).toEqual([]);
			expect({ createdHome: game.home, ...shape(reading) }).toEqual({
				createdHome: game.home,
				kind: "final",
				home: 112,
				away: 104,
				recorded: null,
				detail: "final",
				id,
			});
		}
	});

	test("a game whose own team text the program does not know is not read at all", () => {
		const lakers = CASES.find((c) => c.name.startsWith("nba final"))!;
		for (const away of ["Golden State", "Warriors of Golden State", ""]) {
			for (const seat of SEATS) {
				const { reading } = readSaved(seat, { ...lakers.game, away }, NOW);
				expect({ away, seat, kind: reading.kind, detail: reading.detail }).toEqual({ away, seat, kind: "silent", detail: "game teams unknown" });
			}
		}
	});
});
