// Without a hint that names it, a record is the game only when nothing else in the answer could be
// (src/pick.ts, "only one"): no other record of the two teams inside the window, no record inside it
// with one of the game's teams beside a name the program can't resolve, no record of either kind
// with no game time, and no record the lists can't place inside the window and earlier than it.
// Otherwise the seat is silent; a hint that names the game decides.
//
// Real cases first (cases.ts: the doubleheader, the series, the game listed twice), then each shape
// the rule turns away, built from a real final by changing one thing, with the control beside it that
// still reads. Seats 1, 2 and 4.
//
// The breaks that turn this red (pick.ts, pick):
//   if (chosen.length === 1 && rivals.length === 1) return readingOf(seat, game.league, chosen[0], home);
//   ->  if (chosen.length >= 1) return readingOf(seat, game.league, chosen[0], home);
// and, for a record the lists can't place, `|| (unplaced(r) && earlier(r))` removed from `rivals`.
// Its boundary: `<` made `<=` in `earlier` turns the same-instant control red.

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

	test("the series' real pair: the night game's record unreadable never hands the night game the afternoon's final", () => {
		// White Sox at the Cubs, the night of 18 Aug (00:05 UTC on the 19th, 4-3 Cubs) and the next
		// afternoon (18:20 UTC, 0-3), both inside the night game's window. Derived: the night game's
		// record given a White Sox name the program can't resolve, or no time. Either way the night
		// game's creation reads silent, never the afternoon's 0-3.
		const night = byName("mlb series, the night game without hints").game;
		const ids = { 1: "5059668", 2: "337867" };
		const broken = (seat: 1 | 2, how: "name" | "time"): Derive => (s, _p, body) => {
			if (s !== seat) return body;
			const b = copy(body) as Record<string, Record<string, unknown>[]>;
			for (const g of b[seat === 1 ? "data" : "results"]) {
				if (String(seat === 1 ? g.id : g.gameId) !== ids[seat]) continue;
				if (seat === 1 && how === "name") (g.away_team as Record<string, unknown>).display_name = "Chicago White Soks";
				if (seat === 1 && how === "time") g.date = null;
				if (seat === 2 && how === "name") ((g.teams as Record<string, Record<string, unknown>>).away).team = "Chicago White Soks";
				if (seat === 2 && how === "time") g.schedule = { date: null, tbaTime: false };
			}
			return b;
		};
		for (const seat of [1, 2] as const) {
			expect({ seat, ...read(seat, night, MID) }).toMatchObject({ seat, kind: "silent", detail: "ambiguous" });
			for (const how of ["name", "time"] as const) {
				expect({ seat, how, ...read(seat, night, MID, broken(seat, how)) }).toMatchObject({ seat, how, kind: "silent", detail: "ambiguous" });
			}
			// The control: hinted to the night game's own record, it reads 4-3.
			const hinted = { ...night, hints: [{ seat, id: ids[seat] }] };
			expect({ seat, ...read(seat, hinted, MID) }).toMatchObject({ seat, kind: "final", home: 4, away: 3, id: ids[seat] });
		}
	});

	test("a hint chooses among records that pass both tests: game 2 is inside game 1's window, so a hint naming it is read", () => {
		// At seats 1, 2 and 4 a hint only chooses among records with the game's two teams and a time
		// inside the window, and game 2's record is one of those for game 1's creation. Seat 3 is the
		// one seat read by its hint, and verification checks that hint against seat 3's board.
		const dh1 = byName("mlb doubleheader, game 1 without hints").game;
		const game2Hints = { ...dh1, hints: [{ seat: 1, id: "5060160" }, { seat: 2, id: "338376" }] };
		expect(read(1, game2Hints, MID)).toMatchObject({ kind: "final", home: 6, away: 3, id: "5060160" });
		expect(read(2, game2Hints, MID)).toMatchObject({ kind: "final", home: 6, away: 3, id: "338376" });
	});
});

describe("only one: a record the lists can't place, earlier in the window, keeps a later final from being read", () => {
	// A record the lists can't place has neither side resolved, or one of the game's teams beside a
	// team the feed marks outside the league. Earlier in the window than a record of the game, it may
	// be the game itself, and the later record the two teams' next game: silent, hinted to it or not.
	// At the same instant or later it doesn't stop the read, and neither does one with no time (the
	// saved Morehead State case in cases.ts, beside a game to be announced). A marked team beside a
	// league team that is not in the game is not such a record: it is no record of the game.

	const respellBoth = (seat: 1 | 2 | 4) => (r: Record<string, unknown>) => {
		renameAway(seat)(r);
		if (seat === 1) (r.home_team as Record<string, unknown>).full_name = "L.A. Lakerz";
		if (seat === 2) ((r.teams as Record<string, Record<string, unknown>>).home).team = "L.A. Lakerz";
		if (seat === 4) {
			r.home_team = "L.A. Lakerz";
			r.scores = (r.scores as Record<string, unknown>[]).map((x) => (x.name === "Los Angeles Lakers" ? { ...x, name: "L.A. Lakerz" } : x));
		}
	};
	const LATER_ID = { 1: "99000001", 2: "99000001", 4: "derived-later" };

	test("both names unknown: the Lakers' final respelt, an hour before a later final of the two teams", () => {
		// Seat 1 is asked by the teams' ids and the spare reads the slate, so the respelt record reaches
		// them. Seat 2 is asked by the teams' spellings, and a record the feed files under neither is not in
		// its answer: it holds the later final alone, and reads it. A feed that respells a team respells it
		// in every record, which the next block reads.
		for (const seat of [1, 4] as const) {
			const derive = withLater(seat, respellBoth(seat));
			expect({ seat, ...read(seat, lakers.game, NOW, derive) }).toMatchObject({ seat, kind: "silent", detail: "ambiguous" });
			// Hinted to its own record, which now names neither team: the hint is dropped, and the seat
			// is silent all the same. The spare, asked by its id, holds its id answer (a row it could not
			// resolve) over the slate's ambiguity: the class is the worst of its reads.
			const own = { ...lakers.game, hints: [{ seat, id: LAKERS[seat].id }] };
			expect({ seat, ...read(seat, own, NOW, derive) }).toMatchObject({ seat, kind: "silent", detail: seat === 4 ? "unresolved team names" : "ambiguous" });
			// The control: a hint naming the later final reads it, as a hint that names the game does.
			const later = { ...lakers.game, hints: [{ seat, id: LATER_ID[seat] }] };
			expect({ seat, ...read(seat, later, NOW, derive) }).toMatchObject({ seat, kind: "final", home: 81, away: 79, id: LATER_ID[seat] });
		}
		expect(read(2, lakers.game, NOW, withLater(2, respellBoth(2)))).toMatchObject({ kind: "final", home: 81, away: 79, id: LATER_ID[2] });
	});

	test("both names unknown: the series' night game, before the next afternoon's final", () => {
		// White Sox at the Cubs, the night of 18 Aug (00:05 UTC on the 19th) and the next afternoon
		// (18:20 UTC, 0-3), both inside the night game's window. Derived: the night game's record with
		// both names respelt, or with no names at all. Unhinted, or hinted to that record, the night
		// game's creation reads silent, never the afternoon's 0-3.
		const night = byName("mlb series, the night game without hints").game;
		const ids = { 1: "5059668", 2: "337867" };
		const unnamed = (seat: 1 | 2, how: "respelt" | "no names"): Derive => (s, _p, body) => {
			if (s !== seat) return body;
			const b = copy(body) as Record<string, Record<string, unknown>[]>;
			for (const g of b[seat === 1 ? "data" : "results"]) {
				if (String(seat === 1 ? g.id : g.gameId) !== ids[seat]) continue;
				const teams = g.teams as Record<string, Record<string, unknown>>;
				const sides = (seat === 1 ? [g.home_team, g.away_team] : [teams.home, teams.away]) as Record<string, unknown>[];
				const field = seat === 1 ? "display_name" : "team";
				if (how === "respelt") [sides[0][field], sides[1][field]] = ["Chicago Cubbz", "Chicago White Soks"];
				else for (const side of sides) delete side[field];
			}
			return b;
		};
		// Seat 1, asked by the teams' ids, sees the unnamed record and is silent. Seat 2, asked by the
		// teams' spellings, is not handed a record filed under neither, so its answer holds the afternoon's
		// final alone and reads it; a team the feed respells everywhere is the next block's case.
		for (const how of ["respelt", "no names"] as const) {
			for (const hints of [[], [{ seat: 1, id: ids[1] }]]) {
				const hinted = hints.length > 0;
				expect({ how, hinted, ...read(1, { ...night, hints }, MID, unnamed(1, how)) }).toMatchObject({ how, hinted, kind: "silent", detail: "ambiguous" });
			}
			expect({ how, ...read(2, night, MID, unnamed(2, how)) }).toMatchObject({ how, kind: "final", home: 0, away: 3 });
		}
	});

	// Kentucky's real 20 Mar final (16:15 UTC, 89-84 against Santa Clara), asked for as Kentucky
	// against Georgia. Derived: its away team made the University of Georgia, one or both teams
	// marked outside the league (seat 1's record giving the team no conference id, seat 2's no
	// conference), and beside it a final of Kentucky and Georgia, both listed as league teams, 80-70.
	const kentucky = byName("ncaab final, read with seat 1 answering: Santa Clara at Kentucky").game;
	const vsGeorgia = { ...kentucky, away: "Georgia" };
	const KENTUCKY = { 1: 2798585, 2: 338824 };
	// The University of Georgia as each seat lists it: seat 1's own entry, seat 2's name and conference.
	const GEORGIA = {
		1: { id: 278, conference_id: 24, name: "Bulldogs", full_name: "Georgia Bulldogs", college: "Georgia", abbreviation: "UGA" },
		2: { team: "Georgia", location: "Georgia", mascot: "Bulldogs", abbreviation: "UGA", conference: "SEC" },
	};
	// "santa clara" keeps the record's own away team, a league team that is not in the game.
	type Side = "listed" | "marked" | "respelt" | "santa clara";
	const side = (seat: 1 | 2, how: Side, t: Record<string, unknown>, own: Record<string, unknown>): Record<string, unknown> => {
		if (how === "santa clara") return own;
		if (how === "listed") return t;
		if (how === "respelt") return seat === 1 ? { ...t, full_name: "Kentucky Wildcatz", college: "Kentuckee" } : { ...t, team: "Kentuckee" };
		if (seat === 1) return { ...t, conference_id: null };
		const rest = { ...t };
		delete rest.conference;
		return rest;
	};
	const AT_16 = "2026-03-20T16:15:00.000Z";
	const AT_19 = "2026-03-20T19:15:00.000Z";
	/** Kentucky's record with its teams as `sides` say, at `own`; the final of the two teams at `final`. */
	const withGeorgia = (seat: 1 | 2, sides: readonly [Side, Side], own: string, final: string, finalFirst = false): Derive => (s, _p, body) => {
		if (s !== seat) return body;
		const b = copy(body) as Record<string, Record<string, unknown>[]>;
		const list = b[seat === 1 ? "data" : "results"];
		const record = list.find((g) => (seat === 1 ? g.id : g.gameId) === KENTUCKY[seat]);
		if (record === undefined) return b;
		const later = copy(record);
		if (seat === 1) {
			Object.assign(later, { id: 99_000_001, date: final, visitor_team: GEORGIA[1], home_score: 80, away_score: 70 });
			const away = record.visitor_team as Record<string, unknown>;
			Object.assign(record, { date: own, home_team: side(1, sides[0], record.home_team as Record<string, unknown>, away), visitor_team: side(1, sides[1], GEORGIA[1], away) });
		} else {
			const teams = record.teams as Record<string, Record<string, unknown>>;
			Object.assign(later, { gameId: 99_000_001, schedule: { date: final, tbaTime: false }, teams: { home: teams.home, away: GEORGIA[2] }, scoreboard: { currentPeriod: 2, score: { home: 80, away: 70 } } });
			Object.assign(record, { schedule: { date: own, tbaTime: false }, teams: { home: side(2, sides[0], teams.home, teams.away), away: side(2, sides[1], GEORGIA[2], teams.away) } });
		}
		if (finalFirst) list.unshift(later);
		else list.push(later);
		return b;
	};

	test("a Georgia listed without a conference beside Kentucky, three hours before a final of the two: a second record of the two teams, and the seat is silent", () => {
		const shapes: readonly [string, readonly [Side, Side]][] = [
			["Georgia marked", ["listed", "marked"]],
			["Kentucky marked", ["marked", "listed"]],
			["both marked", ["marked", "marked"]],
			["Kentucky respelt, Georgia marked", ["respelt", "marked"]],
		];
		for (const seat of [1, 2] as const) {
			for (const [what, sides] of shapes) {
				for (const finalFirst of [false, true]) {
					const reading = read(seat, vsGeorgia, MID, withGeorgia(seat, sides, AT_16, AT_19, finalFirst));
					expect({ seat, what, finalFirst, ...reading }).toMatchObject({ seat, what, finalFirst, kind: "silent", detail: "ambiguous" });
				}
			}
			// Hinted to Kentucky's own record, Georgia without a conference: a missing conference is unknown,
			// never a mark, so the hint names a record of the two teams inside the window, and it is read, as
			// a hint is among two records of the two teams.
			const hinted = { ...vsGeorgia, hints: [{ seat, id: String(KENTUCKY[seat]) }] };
			expect({ seat, ...read(seat, hinted, MID, withGeorgia(seat, ["listed", "marked"], AT_16, AT_19)) }).toMatchObject({ seat, kind: "final", home: 89, away: 84 });
		}
	});

	test("the controls: at the same instant as the game's record or later, or beside a team not in the game, the read stands", () => {
		// The real record of West Florida against Southeastern Baptist, two schools outside Division I
		// (seat 1 marks both; seat 2 gives West Florida a conference and a name the lists don't know,
		// and Southeastern Baptist no conference), is at 23:00 on 2 Nov, before Memphis at Iowa State's
		// window. Derived: moved to Iowa State's own instant, 00:00 on 3 Nov, and to 00:30. Iowa State
		// reads at both.
		const iowa = byName("ncaab not final, read with seat 1 answering: Memphis at Iowa State").game;
		const ids = { 1: { other: 10882497, own: "10882536" }, 2: { other: 342404, own: "341752" } };
		const moved = (seat: 1 | 2, iso: string): Derive => (s, _p, body) => {
			if (s !== seat) return body;
			const b = copy(body) as Record<string, Record<string, unknown>[]>;
			for (const g of b[seat === 1 ? "data" : "results"]) {
				if ((seat === 1 ? g.id : g.gameId) !== ids[seat].other) continue;
				if (seat === 1) g.date = iso;
				else g.schedule = { date: iso, tbaTime: false };
			}
			return b;
		};
		for (const seat of [1, 2] as const) {
			for (const iso of ["2026-11-03T00:00:00.000Z", "2026-11-03T00:30:00.000Z"]) {
				expect({ seat, iso, ...read(seat, iowa, MID, moved(seat, iso)) }).toMatchObject({ seat, iso, kind: "no_final", detail: "scheduled", id: ids[seat].own });
			}
			// Kentucky against Georgia without a conference, three hours after the final of the two teams
			// rather than before it: a second record of the two teams inside the window all the same, and
			// the seat is silent.
			const after = withGeorgia(seat, ["listed", "marked"], AT_19, AT_16);
			expect({ seat, ...read(seat, vsGeorgia, MID, after) }).toMatchObject({ seat, kind: "silent", detail: "ambiguous" });
			// Georgia without a conference beside Santa Clara, a league team that is not in the game, three
			// hours before the final, on either side: no record of the game, and the final reads.
			for (const sides of [["marked", "santa clara"], ["santa clara", "marked"]] as const) {
				expect({ seat, sides, ...read(seat, vsGeorgia, MID, withGeorgia(seat, sides, AT_16, AT_19)) }).toMatchObject({ seat, sides, kind: "final", home: 80, away: 70, id: "99000001" });
			}
		}
		// The Lakers' final with a respelt copy an hour after it, at seats 1, 2 and 4: the final reads.
		// Seat 4's answer also lists the two teams' game of 31 Oct, after the window: a record of the
		// two teams outside the window is no record the respelt one can be earlier than.
		for (const seat of [1, 2, 4] as const) {
			const respeltAfter: Derive = (s, _p, body) => {
				if (s !== seat) return body;
				const b = copy(body);
				const list = LAKERS[seat].find(b);
				const own = list.find((r) => idOf(seat, r) === LAKERS[seat].id);
				if (own) {
					const g = laterFinal(seat, own);
					respellBoth(seat)(g);
					list.push(g);
				}
				return b;
			};
			expect({ seat, ...read(seat, lakers.game, NOW, respeltAfter) }).toMatchObject({ seat, kind: "final", home: 127, away: 105, id: LAKERS[seat].id });
		}
	});
});

describe("only one: what can't be the game doesn't stop a reading", () => {
	test("a record whose two names both fail to resolve names neither team", () => {
		// Seat 2's real 2 Nov answer holds Southeastern Baptist College at West Florida, two schools
		// outside Division I. Memphis at Iowa State read with its window moved a second past the
		// record, and a game the answer doesn't hold, are said to be outside the window and absent.
		const iowa = byName("ncaab not final: Memphis at Iowa State").game;
		expect(read(2, { ...iowa, start: iowa.start + 1, n: 3600 }, NOW)).toMatchObject({ kind: "silent", detail: "outside window", id: "341752" });
		expect(read(2, { ...iowa, home: "Duke", away: "North Carolina" }, NOW)).toMatchObject({ kind: "silent", detail: "absent" });
		// That record is at 23:00 on 2 Nov, before both windows. Derived: moved to 00:30 on 3 Nov, inside
		// them and after Iowa State's record. It still names neither team: Iowa State reads, and the
		// game the answer lacks is absent.
		const inside: Derive = (seat, _p, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results: Record<string, unknown>[] };
			for (const g of b.results) if (g.gameId === 342404) g.schedule = { date: "2026-11-03T00:30:00.000Z", tbaTime: false };
			return b;
		};
		expect(read(2, iowa, NOW, inside)).toMatchObject({ kind: "no_final", detail: "scheduled", id: "341752" });
		expect(read(2, { ...iowa, home: "Duke", away: "North Carolina" }, NOW, inside)).toMatchObject({ kind: "silent", detail: "absent" });
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
		// Seat 2 is asked by each team's spelling: the renamed side's own answer comes back empty, and an
		// empty answer is silence, never absence.
		const want = {
			1: { kind: "silent", detail: "absent", id: null },
			2: { kind: "silent", detail: "empty listing", id: null },
			4: { kind: "silent", detail: "outside window", id: "761c15cdefb5a94e34f234e11d6e57ad" },
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

describe("one answer is one moment: a record on two of the pages an answer is drawn from", () => {
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

	test("a game that finished between the two pages' captures reads as the later page has it", () => {
		// Asked for the team over both dates in one request, the feed answers once, with the record as it
		// stands: the later page's copy, whichever way the copies differ.
		expect(read(2, hawaii, MID, tick(live, done))).toMatchObject({ kind: "final", home: 75, away: 70, id: "348655" });
		expect(read(2, hawaii, MID, tick(done, live))).toMatchObject({ kind: "no_final", detail: "in progress", id: "348655" });
	});

	test("the record now under other teams leaves the other team's answer empty, silence; two copies in one answer are silent", () => {
		const other = { ...done, teams: { home: { team: "Hawaii" }, away: { team: "Pacific" } } };
		expect(read(2, hawaii, MID, tick(live, other))).toMatchObject({ kind: "silent", detail: "empty listing" });
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

describe("an empty answer is silence, from a team's own list as from a slate", () => {
	const iowa = byName("ncaab not final: Memphis at Iowa State").game;
	// Le Moyne at Nebraska is on the second page of seat 2's real 2 Nov answer.
	const nebraska = { ...iowa, home: "Nebraska", away: "Le Moyne", start: at("2026-11-03T00:30:00Z"), n: 23 * 3600 };

	test("seat 2, asked for the teams: an answer with none of their games is silence, never absence", () => {
		// The game is on the second page of the real 2 Nov slate; with the first page emptied, the one-game
		// answer drawn from the slate holds none of the teams' games. An empty answer cannot tell a team
		// with no game from a spelling the feed no longer uses or a filter it did not apply: silence.
		const emptyFirst: Derive = (seat, path, body) => {
			if (seat !== 2 || !path.endsWith("date=2026-11-02")) return body;
			return { ...(copy(body) as Record<string, unknown>), results: [], games: 0 };
		};
		expect(read(2, nebraska, NOW, emptyFirst)).toMatchObject({ kind: "silent", detail: "empty listing", id: null });
		// The control: the real two pages read the game.
		expect(read(2, nebraska, NOW)).toMatchObject({ kind: "no_final", detail: "scheduled", id: "342256" });
	});

	test("a date with no games beside the date that has the game: the game still reads", () => {
		// Seat 1's real college football answer for 21 Oct is empty; James Madison at Appalachian State
		// is on the 22nd's.
		expect(read(1, byName("ncaaf final, read the next afternoon").game, MID)).toMatchObject({ kind: "final", home: 34, away: 31 });
	});

	test("college basketball at the spare: its slate is past the size an answer may be, so without the game's id the spare asks nothing and is silent", () => {
		const { reading, asked } = readSaved(4, iowa, NOW);
		expect([reading.kind, reading.detail, asked.length]).toEqual(["silent", "no id, and the slate is past the size", 0]);
	});
});

describe("a conference missing on a college team is unknown, never a mark against it: the row binds by its names", () => {
	// Seat 1's college basketball list has an entry named only "Georgia" (abbreviation GEO), with no
	// school name and no conference: the University of Georgia's namesake. Derived: that entry put in
	// place of Santa Clara in Kentucky's real 20 Mar final, at seats 1 and 2 (seat 2's record giving it
	// no conference). Asked for Kentucky against Georgia, each seat binds the row by its names, and the
	// namesake's final reads as that seat's: one seat's final, which the other seats' finals dispute
	// and no end rests on alone. A missing conference never makes the game absent.
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

	test("the namesake's row, without a conference, binds by its name: one seat's final, never absence", () => {
		for (const seat of [1, 2] as const) {
			expect({ seat, ...read(seat, vsGeorgia, MID, namesake) }).toMatchObject({ seat, kind: "final", home: 89, away: 84 });
		}
		// Kentucky's own game, against the namesake, is not Kentucky against Santa Clara: silence at seat 1
		// (absent), asked by the two teams' ids, and at seat 2, where Santa Clara's own answer comes back empty.
		expect(read(1, kentucky.game, MID, namesake)).toMatchObject({ kind: "silent", detail: "absent" });
		expect(read(2, kentucky.game, MID, namesake)).toMatchObject({ kind: "silent", detail: "empty listing" });
	});

	test("Colorado College, Rhode Island College and Cornell College: a final of theirs never reads for the Division I school", () => {
		// Seat 2's real scheduled records of the three, each against a Division I school, made final
		// 80-60 (derived), and read for the Division I school whose name each begins with. Rhode
		// Island College's record is also moved from 23:30 to 00:30 UTC, and each window is 20 hours,
		// so every date asked is one the saved answers hold. The team lists join no spelling of these
		// colleges to a Division I school, so each record is one of the game's teams beside a name the
		// lists don't know: it could be the game, and the seat is silent, with a conference or without
		// one (a conference missing is unknown, never a mark against the college). The control puts the
		// Division I school itself in the record: the same derived final then reads.
		const rows = [
			{ id: 342338, home: "Northern Colorado", away: "Colorado", school: "Colorado", conference: "Big 12", at: "2026-11-03T02:30:00Z", now: NOW, time: null, asSaved: { kind: "silent", detail: "unresolved team names" } },
			{ id: 342332, home: "Albany", away: "Rhode Island", school: "Rhode Island", conference: "Atlantic 10", at: "2026-11-03T00:30:00Z", now: NOW, time: "2026-11-03T00:30:00.000Z", asSaved: { kind: "silent", detail: "unresolved team names" } },
			{ id: 346614, home: "Northern Iowa", away: "Cornell", school: "Cornell", conference: "Ivy League", at: "2026-11-04T01:00:00Z", now: MID, time: null, asSaved: { kind: "silent", detail: "unresolved team names" } },
		] as const;
		for (const row of rows) {
			const asked = { ...kentucky.game, home: row.home, away: row.away, start: at(row.at), n: 20 * 3600 };
			const derived = (away: "as saved" | "with a conference" | "the school itself"): Derive => (seat, _p, body) => {
				if (seat !== 2) return body;
				const b = copy(body) as { results: Record<string, Record<string, unknown>>[] };
				for (const g of b.results) {
					if ((g.gameId as unknown) !== row.id) continue;
					Object.assign(g, { status: "final", scoreboard: { currentPeriod: 2, score: { home: 80, away: 60 } } });
					if (row.time !== null) g.schedule = { date: row.time, tbaTime: false };
					if (away === "with a conference") g.teams.away = { ...g.teams.away, conference: "Derived" };
					if (away === "the school itself") g.teams.away = { team: row.school, conference: row.conference };
				}
				return b;
			};
			// As saved and with a conference alike, the college is a name the lists don't know beside one of
			// the game's teams: it could be the game, so the seat is silent. None reads the 80-60.
			expect({ row: row.id, ...read(2, asked, row.now, derived("as saved")) }).toMatchObject({ row: row.id, ...row.asSaved });
			expect({ row: row.id, ...read(2, asked, row.now, derived("with a conference")) }).toMatchObject({ row: row.id, kind: "silent", detail: "unresolved team names" });
			expect({ row: row.id, ...read(2, asked, row.now, derived("the school itself")) }).toMatchObject({ row: row.id, kind: "final", home: 80, away: 60, id: String(row.id) });
		}
	});

	test("the control: the name resolves with a conference and without one; professional leagues have no conference either", () => {
		const base = { gameId: 1, status: "scheduled", schedule: { date: "2026-03-20T16:15:00.000Z", tbaTime: false } };
		const withConference = seat2Record("ncaab", { ...base, teams: { home: { team: "Kentucky", conference: "SEC" }, away: { team: "Georgia", conference: "SEC" } } })!;
		const without = seat2Record("ncaab", { ...base, teams: { home: { team: "Kentucky", conference: "SEC" }, away: { team: "Georgia" } } })!;
		expect(resolveFeedTeam("ncaab", withConference.teams[1])).toBe("georgia-bulldogs");
		expect(resolveFeedTeam("ncaab", without.teams[1])).toBe("georgia-bulldogs");
		// Professional leagues have no such mark: a seat 2 team there is read by its name alone.
		const pro = seat2Record("nba", { ...base, teams: { home: { team: "Los Angeles Lakers" }, away: { team: "Golden State Warriors" } } })!;
		expect(pro.teams.map((t) => resolveFeedTeam("nba", t))).toEqual(["los-angeles-lakers", "golden-state-warriors"]);
	});
});

describe("hints and dates that disagree with the answer", () => {
	// The White Sox at the Cubs, the afternoon of 19 Aug (18:20 UTC), 3-0 White Sox: the night
	// game before it (00:05 UTC the same date) is outside its window, the game itself inside.
	const afternoon = byName("mlb series, the next afternoon's game without hints").game;

	test("the game's own date emptied, beside the series' other games: the teams' records are all outside the window, and the seat says so", () => {
		const emptyDay: Derive = (seat, path, body) => {
			if (seat === 1 && path.includes("dates[]=2026-08-19")) return { ...(copy(body) as Record<string, unknown>), data: [] };
			if (seat === 2 && path.includes("date=2026-08-19")) return { ...(copy(body) as Record<string, unknown>), results: [] };
			return body;
		};
		for (const seat of [1, 2] as const) {
			expect({ seat, ...read(seat, afternoon, MID, emptyDay) }).toMatchObject({ seat, kind: "silent", detail: "outside window" });
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
	// but it could be the game, so the seat can't say the game is absent. Seat 1 is asked by the
	// teams' ids and the spare reads the slate, so the respelt record reaches them. Seat 2 is asked by
	// each team's spelling: a record filed under neither spelling is not in its answer, so a feed that
	// respells both teams leaves the game absent there until the lists are regenerated; one team
	// respelt still reaches it through the other team's answer, and reads as a name it can't resolve.
	test("both names unknown, inside the window: silent at seat 1 and the spare; at seat 2 one unknown name is silent, two are absence", () => {
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
		for (const seat of [1, 4] as const) {
			expect({ seat, ...read(seat, lakers.game, NOW, respell) }).toMatchObject({ seat, kind: "silent", detail: "unresolved team names" });
		}
		expect(read(2, lakers.game, NOW, respell)).toMatchObject({ kind: "silent", detail: "absent" });
		// One team respelt: the other team's answer carries the record, respelt on one side.
		const respellHome: Derive = (seat, _p, body) => {
			if (seat !== 2) return body;
			const b = copy(body);
			for (const r of LAKERS[2].find(b)) if (idOf(2, r) === LAKERS[2].id) ((r.teams as Record<string, Record<string, unknown>>).home).team = "L.A. Lakerz";
			return b;
		};
		expect(read(2, lakers.game, NOW, respellHome)).toMatchObject({ kind: "silent", detail: "unresolved team names" });
	});
	test("one name unknown, and no time to place it: silent", () => {
		// Seat 2's real Memphis at Iowa State, the home name respelt (so the record reaches the seat through
		// Memphis's answer) and its time marked to be announced.
		const iowa = byName("ncaab not final: Memphis at Iowa State").game;
		const tba: Derive = (seat, _p, body) => {
			if (seat !== 2) return body;
			const b = copy(body) as { results: Record<string, Record<string, unknown>>[] };
			for (const g of b.results) {
				if ((g.gameId as unknown) !== 341752) continue;
				(g.teams.home as Record<string, unknown>).team = "Iowa St Cyclonez";
				g.schedule = { ...g.schedule, tbaTime: true };
			}
			return b;
		};
		expect(read(2, iowa, NOW, tba)).toMatchObject({ kind: "silent", detail: "no game time" });
	});
});
