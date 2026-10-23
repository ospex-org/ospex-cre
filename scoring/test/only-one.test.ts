// Without a hint that names it, a record is the game only when nothing else in the answer could be
// (src/pick.ts, "only one"): no other record of the two teams inside the window, no record inside it
// with one of the game's teams beside a name the program can't resolve, and no record of either
// kind with no game time. Otherwise the seat is silent; a hint that names the game decides.
//
// Real cases first (cases.ts: the doubleheader, the series, the game listed twice), then each shape
// the rule turns away, built from a real final by changing one thing, with the control beside it that
// still reads. Seats 1, 2 and 4.
//
// The break that turns this red (pick.ts, pick):
//   if (chosen.length === 1 && rivals.length === 1) return readingOf(seat, game.league, chosen[0], home);
//   ->  if (chosen.length >= 1) return readingOf(seat, game.league, chosen[0], home);

import { describe, expect, test } from "bun:test";
import type { Game, Seat } from "../src/types";
import { CASES, MID, NOW } from "./cases";
import { at, copy, readSaved, type Derive } from "./fixtures";
import { resolveFeedTeam } from "../src/pick";
import { toRecord as seat2Record } from "../src/readers/seat2";

const byName = (prefix: string) => CASES.find((c) => c.name.startsWith(prefix))!;
const lakers = byName("nba final");

function read(seat: Seat, game: Game, now: number, derive?: Derive) {
	const { reading, misses } = readSaved(seat, game, now, derive);
	expect(misses).toEqual([]);
	return { kind: reading.kind, home: reading.home, away: reading.away, detail: reading.detail, id: reading.record?.id ?? null };
}

// The Lakers' real final at each seat: its id, and how to reach its record in that seat's answer.
const LAKERS: Record<1 | 2 | 4, { id: string; find: (body: unknown) => Record<string, unknown>[] }> = {
	1: { id: "21717859", find: (b) => (b as { data: Record<string, unknown>[] }).data },
	2: { id: "340490", find: (b) => (b as { results: Record<string, unknown>[] }).results },
	4: { id: "6fff70f4bf196dba25060a5775a03b54", find: (b) => b as Record<string, unknown>[] },
};
const idOf = (seat: 1 | 2 | 4, r: Record<string, unknown>): string => String(seat === 2 ? r.gameId : r.id);

/** A derived copy of the Lakers' final, an hour later under a new id, 81-79: a second game of the two teams. */
function laterFinal(seat: 1 | 2 | 4, r: Record<string, unknown>): Record<string, unknown> {
	const g = copy(r);
	if (seat === 1) Object.assign(g, { id: 99_000_001, datetime: "2026-10-22T03:00:00Z", home_team_score: 81, visitor_team_score: 79 });
	if (seat === 2) Object.assign(g, { gameId: 99_000_001, schedule: { date: "2026-10-22T03:00:00.000Z", tbaTime: false }, scoreboard: { currentPeriod: 4, score: { home: 81, away: 79 } } });
	if (seat === 4) {
		const s = g.scores as Record<string, unknown>[];
		Object.assign(g, { id: "derived-later", commence_time: "2026-10-22T03:00:00Z", scores: [{ ...s[0], score: "81" }, { ...s[1], score: "79" }] });
	}
	return g;
}

/** Changes the Lakers' own record, and adds the later final beside it. */
function withLater(seat: 1 | 2 | 4, change: (r: Record<string, unknown>) => void): Derive {
	return (s, _p, body) => {
		if (s !== seat) return body;
		const b = copy(body);
		const list = LAKERS[seat].find(b);
		const own = list.find((r) => idOf(seat, r) === LAKERS[seat].id);
		if (own) {
			list.push(laterFinal(seat, own));
			change(own);
		}
		return b;
	};
}

const eraseTime = (seat: 1 | 2 | 4) => (r: Record<string, unknown>) => {
	if (seat === 1) r.datetime = null;
	if (seat === 2) r.schedule = { date: null, tbaTime: false };
	if (seat === 4) r.commence_time = null;
};
const renameAway = (seat: 1 | 2 | 4) => (r: Record<string, unknown>) => {
	if (seat === 1) (r.visitor_team as Record<string, unknown>).full_name = "Golden St. Warriorz";
	if (seat === 2) ((r.teams as Record<string, Record<string, unknown>>).away).team = "Golden St. Warriorz";
	if (seat === 4) {
		r.away_team = "Golden St. Warriorz";
		r.scores = (r.scores as Record<string, unknown>[]).map((x) => (x.name === "Golden State Warriors" ? { ...x, name: "Golden St. Warriorz" } : x));
	}
};

describe("only one: a record is read only when nothing else could be the game", () => {
	test("an earlier record of the game that can't be read keeps a later final of the two teams from being read", () => {
		for (const seat of [1, 2, 4] as const) {
			for (const [what, change] of [["its time erased", eraseTime(seat)], ["a team name the program can't resolve", renameAway(seat)]] as const) {
				expect({ seat, what, ...read(seat, lakers.game, NOW, withLater(seat, change)) }).toMatchObject({ seat, what, kind: "silent", detail: "ambiguous" });
			}
			// Controls: the later final alone is read; and a hint naming the Lakers' own record reads it.
			const alone: Derive = (s, _p, body) => {
				if (s !== seat) return body;
				const b = copy(body);
				const list = LAKERS[seat].find(b);
				const i = list.findIndex((r) => idOf(seat, r) === LAKERS[seat].id);
				if (i >= 0) list.splice(i, 1, laterFinal(seat, list[i]));
				return b;
			};
			expect({ seat, ...read(seat, lakers.game, NOW, alone) }).toMatchObject({ seat, kind: "final", home: 81, away: 79 });
			const hinted = { ...lakers.game, hints: [{ seat, id: LAKERS[seat].id }] };
			expect({ seat, ...read(seat, hinted, NOW, withLater(seat, () => {})) }).toMatchObject({ seat, kind: "final", home: 127, away: 105, id: LAKERS[seat].id });
		}
	});

	test("two finals of the two teams inside the window, under two ids: silent, whichever is earlier", () => {
		// The real 10 and 11 Jun finals between Arizona and Miami, moved to 1 second and 3 hours after
		// the 11 Jun game's start: the 8-0 from the 10th earlier, the 11th's own 2-0 later.
		const marlins = byName("mlb final: Arizona at Miami");
		const moved: Derive = (seat, _p, body) => {
			if (seat === 1) {
				const b = copy(body) as { data: Record<string, unknown>[] };
				for (const g of b.data) {
					if (g.id === 5058783) g.date = "2026-06-11T17:10:01.000Z";
					if (g.id === 5058793) g.date = "2026-06-11T20:10:00.000Z";
				}
				return b;
			}
			if (seat === 2) {
				const b = copy(body) as { results: Record<string, unknown>[] };
				for (const g of b.results) {
					if (g.gameId === 337007) g.schedule = { date: "2026-06-11T17:10:01.000Z", tbaTime: false };
					if (g.gameId === 337004) g.schedule = { date: "2026-06-11T20:10:00.000Z", tbaTime: false };
				}
				return b;
			}
			return body;
		};
		for (const seat of [1, 2] as const) {
			expect({ seat, ...read(seat, marlins.game, NOW, moved) }).toMatchObject({ seat, kind: "silent", detail: "ambiguous" });
			// The control: at their real times the 10 Jun game is before the window and the 11th reads.
			expect({ seat, ...read(seat, marlins.game, NOW) }).toMatchObject({ seat, kind: "final", home: 2, away: 0 });
		}
	});

	test("the game listed twice a minute apart: silent while either could be it, not the stale one's reading", () => {
		// Seat 2's real Seattle at Hawaii, 341963 at 04:59 and 348655 at 05:00. Derived: the later id
		// final and the earlier still scheduled, the shape a feed's stale copy takes.
		const hawaii = byName("ncaab listed twice at seat 2: Seattle at Hawaii").game;
		const laterFinal: Derive = (seat, _p, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results: Record<string, unknown>[] };
			for (const g of b.results) if (g.gameId === 348655) Object.assign(g, { status: "final", scoreboard: { currentPeriod: 2, score: { home: 80, away: 70 } } });
			return b;
		};
		expect(read(2, hawaii, MID, laterFinal)).toMatchObject({ kind: "silent", detail: "ambiguous" });
		expect(read(2, { ...hawaii, hints: [{ seat: 2, id: "348655" }] }, MID, laterFinal)).toMatchObject({ kind: "final", home: 80, away: 70, id: "348655" });
		expect(read(2, { ...hawaii, hints: [{ seat: 2, id: "341963" }] }, MID, laterFinal)).toMatchObject({ kind: "no_final", detail: "scheduled", id: "341963" });
	});

	test("a hint is the creation's word for which record is the game: hinted to game 2, game 1's creation reads game 2", () => {
		// Verification checks seat 3's hint against its board; no check binds a seat 1, 2 or 4 hint to
		// the start. Pinned here so the reliance is seen.
		const dh1 = byName("mlb doubleheader, game 1 without hints").game;
		const game2Hints = { ...dh1, hints: [{ seat: 1, id: "5060160" }, { seat: 2, id: "338376" }] };
		expect(read(1, game2Hints, MID)).toMatchObject({ kind: "final", home: 6, away: 3, id: "5060160" });
		expect(read(2, game2Hints, MID)).toMatchObject({ kind: "final", home: 6, away: 3, id: "338376" });
	});
});

describe("only one: what can't be the game doesn't stop a reading", () => {
	test("a record whose two names both fail to resolve names neither team", () => {
		// Seat 2's real 2 Nov answer holds Southeastern Baptist College at West Florida, two schools
		// outside Division I. Memphis at Iowa State read with its window moved a second past the
		// record, and a game the answer doesn't hold, are said to be outside the window and absent.
		const iowa = byName("ncaab not final: Memphis at Iowa State").game;
		expect(read(2, { ...iowa, start: iowa.start + 1, n: 3600 }, NOW)).toMatchObject({ kind: "no_final", detail: "outside window", id: "341752" });
		expect(read(2, { ...iowa, home: "Duke", away: "North Carolina" }, NOW)).toMatchObject({ kind: "no_final", detail: "absent" });
		// That record is at 23:00 on 2 Nov, before both windows. Derived: moved to 00:30 on 3 Nov, inside
		// them. It still names neither team: Iowa State reads, and the game the answer lacks is absent.
		const inside: Derive = (seat, _p, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results: Record<string, unknown>[] };
			for (const g of b.results) if (g.gameId === 342404) g.schedule = { date: "2026-11-03T00:30:00.000Z", tbaTime: false };
			return b;
		};
		expect(read(2, iowa, NOW, inside)).toMatchObject({ kind: "no_final", detail: "scheduled", id: "341752" });
		expect(read(2, { ...iowa, home: "Duke", away: "North Carolina" }, NOW, inside)).toMatchObject({ kind: "no_final", detail: "absent" });
		// The control: one of the game's teams beside a name the program can't resolve, inside the
		// window, may be the game.
		const renamed: Derive = (seat, _p, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results: Record<string, Record<string, Record<string, unknown>>>[] };
			for (const g of b.results) if ((g.gameId as unknown) === 341752) g.teams.away.team = "Memphis Tigerz";
			return b;
		};
		expect(read(2, iowa, NOW, renamed)).toMatchObject({ kind: "silent", detail: "unresolved team names" });
	});

	test("a record with one of the game's teams, outside the window, is not the game", () => {
		// The Lakers' real final, renamed so it resolves to one team only, read with a window that
		// starts after it: it can't be the game, so the game is absent. Seat 4's answer also lists the
		// two teams' real game of 31 Oct, outside this window too, so seat 4 names that one.
		const want = {
			1: { kind: "no_final", detail: "absent", id: null },
			2: { kind: "no_final", detail: "absent", id: null },
			4: { kind: "no_final", detail: "outside window", id: "761c15cdefb5a94e34f234e11d6e57ad" },
		};
		for (const seat of [1, 2, 4] as const) {
			const renamed: Derive = (s, _p, body) => {
				if (s !== seat) return body;
				const b = copy(body);
				const own = LAKERS[seat].find(b).find((r) => idOf(seat, r) === LAKERS[seat].id);
				if (own) renameAway(seat)(own);
				return b;
			};
			const later = { ...lakers.game, start: lakers.game.start + 3600, n: 3600 };
			expect({ seat, ...read(seat, later, NOW, renamed) }).toMatchObject({ seat, ...want[seat] });
		}
	});
});

describe("one game under two dates", () => {
	// Seat 2 lists Seattle at Hawaii's 348655 under both 2 Nov and 3 Nov. Derived: the stale copy at
	// 04:59 removed, and 348655's two copies told apart, as a feed's answers are when a score changes
	// between the two requests.
	const hawaii = byName("ncaab listed twice at seat 2: Seattle at Hawaii").game;
	const tick = (first: Record<string, unknown>, second: Record<string, unknown>): Derive => (seat, path, body) => {
		if (seat !== 2) return body;
		const b = copy(body) as { results: Record<string, unknown>[] };
		b.results = b.results.filter((g) => g.gameId !== 341963);
		for (const g of b.results) if (g.gameId === 348655) Object.assign(g, path.includes("date=2026-11-02") ? first : second);
		return b;
	};
	const live = { status: "in progress", scoreboard: { currentPeriod: 2, score: { home: 70, away: 68 } } };
	const done = { status: "final", scoreboard: { currentPeriod: 2, score: { home: 75, away: 70 } } };

	test("a game that finished between the two requests reads the later answer", () => {
		expect(read(2, hawaii, MID, tick(live, done))).toMatchObject({ kind: "final", home: 75, away: 70, id: "348655" });
	});

	test("a final that changes, two copies under other teams, or two copies in one date's answer: silent", () => {
		expect(read(2, hawaii, MID, tick(done, live))).toMatchObject({ kind: "silent", detail: "inconsistent records" });
		const other = { ...done, teams: { home: { team: "Hawaii" }, away: { team: "Pacific" } } };
		expect(read(2, hawaii, MID, tick(live, other))).toMatchObject({ kind: "silent", detail: "inconsistent records" });
		const twiceInOne: Derive = (seat, path, body) => {
			const b = tick(live, live)(seat, path, body) as { results: Record<string, unknown>[] };
			if (seat !== 2 || !path.includes("date=2026-11-03")) return b;
			const g = b.results.find((x) => x.gameId === 348655)!;
			b.results.push({ ...copy(g), ...done });
			return b;
		};
		expect(read(2, hawaii, MID, twiceInOne)).toMatchObject({ kind: "silent", detail: "inconsistent records" });
	});

	test("the control: identical copies are one record", () => {
		expect(read(2, hawaii, MID, tick(live, live))).toMatchObject({ kind: "no_final", detail: "in progress", id: "348655" });
	});
});

describe("an empty answer for a date is not proof the game is absent", () => {
	const iowa = byName("ncaab not final: Memphis at Iowa State").game;
	// Le Moyne at Nebraska is on the second page of seat 2's real 2 Nov answer.
	const nebraska = { ...iowa, home: "Nebraska", away: "Le Moyne", start: at("2026-11-03T00:30:00Z"), n: 23 * 3600 };

	test("a first page that comes back empty leaves the seat silent, not absent", () => {
		const emptyFirst: Derive = (seat, path, body) => {
			if (seat !== 2 || !path.endsWith("date=2026-11-02")) return body;
			return { ...(copy(body) as Record<string, unknown>), results: [], games: 0 };
		};
		expect(read(2, nebraska, NOW, emptyFirst)).toMatchObject({ kind: "silent", detail: "empty listing" });
		// The control: the real two pages read the game.
		expect(read(2, nebraska, NOW)).toMatchObject({ kind: "no_final", detail: "scheduled", id: "342256" });
	});

	test("a date with no games beside the date that has the game: the game still reads", () => {
		// Seat 1's real college football answer for 21 Oct is empty; James Madison at Appalachian State
		// is on the 22nd's.
		expect(read(1, byName("ncaaf final, read the next afternoon").game, MID)).toMatchObject({ kind: "final", home: 34, away: 31 });
	});

	test("seat 4's empty answer before the season: silent", () => {
		expect(read(4, iowa, NOW)).toMatchObject({ kind: "silent", detail: "empty listing" });
	});
});

describe("a team the seat marks outside the league is no team of it", () => {
	// Seat 1's college basketball list has an entry named only "Georgia" (abbreviation GEO), with no
	// school name and no conference: not the University of Georgia, whose name it shares. Derived:
	// that entry put in place of Santa Clara in Kentucky's real 20 Mar final, at seats 1 and 2 (seat
	// 2's record giving it no conference, as it gives teams outside Division I). Asked for Kentucky
	// against Georgia, neither seat reads that final: the record is Kentucky against no league team.
	const kentucky = byName("ncaab final, read with seat 1 answering: Santa Clara at Kentucky");
	const vsGeorgia = { ...kentucky.game, away: "Georgia" };
	const namesake: Derive = (seat, _p, body) => {
		if (seat === 1) {
			const b = copy(body) as { data: Record<string, unknown>[] };
			for (const g of b.data) if (g.id === 2798585) g.visitor_team = { id: 1241, conference_id: null, name: "Georgia", full_name: "Georgia", college: null, abbreviation: "GEO" };
			return b;
		}
		if (seat === 2) {
			const b = copy(body) as { results: Record<string, Record<string, unknown>>[] };
			for (const g of b.results) if ((g.gameId as unknown) === 338824) g.teams.away = { team: "Georgia", location: "Georgia", abbreviation: "GEO" };
			return b;
		}
		return body;
	};

	test("the namesake's game is not the University of Georgia's", () => {
		for (const seat of [1, 2] as const) {
			expect({ seat, ...read(seat, vsGeorgia, MID, namesake) }).toMatchObject({ seat, kind: "no_final", detail: "absent" });
			// Kentucky's own game, against the namesake, is not Kentucky against Santa Clara either.
			expect({ seat, ...read(seat, kentucky.game, MID, namesake) }).toMatchObject({ seat, kind: "no_final", detail: "absent" });
		}
	});

	test("the control: the same name with a conference is the University of Georgia", () => {
		const base = { gameId: 1, status: "scheduled", schedule: { date: "2026-03-20T16:15:00.000Z", tbaTime: false } };
		const withConference = seat2Record("ncaab", { ...base, teams: { home: { team: "Kentucky", conference: "SEC" }, away: { team: "Georgia", conference: "SEC" } } })!;
		const without = seat2Record("ncaab", { ...base, teams: { home: { team: "Kentucky", conference: "SEC" }, away: { team: "Georgia" } } })!;
		expect(resolveFeedTeam("ncaab", withConference.teams[1])).toBe("georgia-bulldogs");
		expect(resolveFeedTeam("ncaab", without.teams[1])).toBeNull();
		// Professional leagues have no such mark: a seat 2 team there is read by its name alone.
		const pro = seat2Record("nba", { ...base, teams: { home: { team: "Los Angeles Lakers" }, away: { team: "Golden State Warriors" } } })!;
		expect(pro.teams.map((t) => resolveFeedTeam("nba", t))).toEqual(["los-angeles-lakers", "golden-state-warriors"]);
	});
});

describe("hints and dates that disagree with the answer", () => {
	// The White Sox at the Cubs, the afternoon of 19 Aug (18:20 UTC), 3-0 White Sox: the night
	// game before it (00:05 UTC the same date) is outside its window, the game itself inside.
	const afternoon = byName("mlb series, the next afternoon's game without hints").game;

	test("an empty answer for the game's own date, beside the series' other games: silent, not outside the window", () => {
		const emptyDay: Derive = (seat, path, body) => {
			if (seat === 1 && path.includes("dates[]=2026-08-19")) return { ...(copy(body) as Record<string, unknown>), data: [] };
			if (seat === 2 && path.includes("date=2026-08-19")) return { ...(copy(body) as Record<string, unknown>), results: [] };
			return body;
		};
		for (const seat of [1, 2] as const) {
			expect({ seat, ...read(seat, afternoon, MID, emptyDay) }).toMatchObject({ seat, kind: "silent", detail: "empty listing" });
			expect({ seat, ...read(seat, afternoon, MID) }).toMatchObject({ seat, kind: "final", home: 0, away: 3 });
		}
	});

	test("a hint naming the night before's game, with this game's final inside the window: silent", () => {
		const hinted = { ...afternoon, hints: [{ seat: 1, id: "5059668" }, { seat: 2, id: "337867" }] };
		for (const seat of [1, 2] as const) expect({ seat, ...read(seat, hinted, MID) }).toMatchObject({ seat, kind: "silent", detail: "ambiguous" });
		// The control: hinted to its own records, it reads.
		const own = { ...afternoon, hints: [{ seat: 1, id: "5059675" }, { seat: 2, id: "337877" }] };
		for (const seat of [1, 2] as const) expect({ seat, ...read(seat, own, MID) }).toMatchObject({ seat, kind: "final", home: 0, away: 3 });
	});

	test("two different hints for one seat, in either order: silent", () => {
		const dh1 = byName("mlb doubleheader, game 1 without hints").game;
		const ids = { 1: ["5060179", "5060160"], 2: ["348506", "338376"] };
		for (const seat of [1, 2] as const) {
			for (const order of [ids[seat], [...ids[seat]].reverse()]) {
				const game = { ...dh1, hints: order.map((id) => ({ seat, id })) };
				expect({ seat, order, ...read(seat, game, MID) }).toMatchObject({ seat, order, kind: "silent", detail: "two hints" });
			}
			// The same id twice is one hint.
			const twice = { ...dh1, hints: [{ seat, id: ids[seat][0] }, { seat, id: ids[seat][0] }] };
			expect({ seat, ...read(seat, twice, MID) }).toMatchObject({ seat, kind: "final", home: 2, away: 10 });
		}
	});
});

describe("a game the seat respells is not absent", () => {
	// The Lakers' real final with both teams' names respelt at each seat, as a feed that changed
	// how it writes names would list it: no name resolves, so the record can't be read as the game,
	// but it could be the game, so the seat can't say the game is absent.
	test("both names unknown, inside the window: silent", () => {
		const respell: Derive = (seat, _p, body) => {
			const b = copy(body);
			if (seat === 4) {
				for (const r of LAKERS[4].find(b)) {
					if (r.id !== LAKERS[4].id) continue;
					r.home_team = "L.A. Lakerz";
					r.away_team = "Golden St. Warriorz";
					r.scores = [{ name: "L.A. Lakerz", score: "127" }, { name: "Golden St. Warriorz", score: "105" }];
				}
				return b;
			}
			for (const r of LAKERS[seat as 1 | 2].find(b)) {
				if (idOf(seat as 1 | 2, r) !== LAKERS[seat as 1 | 2].id) continue;
				renameAway(seat as 1 | 2)(r);
				if (seat === 1) (r.home_team as Record<string, unknown>).full_name = "L.A. Lakerz";
				if (seat === 2) ((r.teams as Record<string, Record<string, unknown>>).home).team = "L.A. Lakerz";
			}
			return b;
		};
		for (const seat of [1, 2, 4] as const) {
			expect({ seat, ...read(seat, lakers.game, NOW, respell) }).toMatchObject({ seat, kind: "silent", detail: "unresolved team names" });
		}
	});
});
