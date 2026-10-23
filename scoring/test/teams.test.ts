// The team lists. A spelling is an alias only when a seat's own list carries it and one reviewed
// identity joins it to one team (capture/teams.ts): the team's own name on seat 1's list, or a hand
// join in capture/joins.json. Nothing shortens a name to make it match. These tests pin that every
// alias names exactly one team, that names which are different schools never meet, and that every
// name in a saved answer either resolves or is one its own seat marks as outside the league's teams.
//
// The break that turns the non-equivalence test red (capture/teams.ts, then regenerate): add back a
// rule that drops "College" from a spelling before matching it, and Colorado College joins the
// Colorado Buffaloes.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveFeedTeam } from "../src/pick";
import { toRecord as seat1 } from "../src/readers/seat1";
import { toRecord as seat2 } from "../src/readers/seat2";
import { toRecord as seat4 } from "../src/readers/seat4";
import { normalise, resolveTeam } from "../src/teams";
import { TEAMS } from "../src/teams/index";
import type { Seat } from "../src/types";
import { INDEX, ROOT } from "./fixtures";

const JOINS = JSON.parse(readFileSync(join(import.meta.dir, "..", "capture", "joins.json"), "utf8")) as {
	groups: { seat: Seat; league: string; why: string; joins: Record<string, string> }[];
	namesakes: { league: string; name: string; team: string; why: string }[];
};

const isList = (path: string): boolean => /\/teams|\/participants/.test(path);
const leagueOf = (file: string): string => file.split("/")[1];
const body = (file: string): unknown => {
	try {
		return JSON.parse(readFileSync(join(ROOT, file), "utf8"));
	} catch {
		return null; // a refusal's plain-text body
	}
};

/** Every spelling each seat's own list carries, by league: team lists, and seat 3's board. */
function ownLists(): Map<string, Map<Seat, Set<string>>> {
	const out = new Map<string, Map<Seat, Set<string>>>();
	for (const e of INDEX) {
		if (e.status !== 200 || !(isList(e.path) || (e.seat === 3 && e.path.startsWith("/odds/")))) continue;
		const league = leagueOf(e.file);
		if (!out.has(league)) out.set(league, new Map([[1, new Set()], [2, new Set()], [3, new Set()], [4, new Set()]]));
		const add = (n: unknown) => typeof n === "string" && n.trim() !== "" && out.get(league)!.get(e.seat)!.add(n);
		const v = body(e.file) as Record<string, unknown> | Record<string, unknown>[];
		if (e.seat === 1) {
			const text = (x: unknown) => typeof x === "string" && x.trim() !== "";
			for (const t of (v as { data: Record<string, unknown>[] }).data) {
				// Seat 1's current teams: the ones its list marks as the league's (see capture/teams.ts).
				const current =
					league === "nba" ? t.conference === "East" || t.conference === "West"
					: league === "nhl" ? text(t.conference_name)
					: league === "ncaab" ? typeof t.conference_id === "number"
					: league === "ncaaf" ? text(t.college) && t.college !== "TBD"
					: true;
				if (current) [league === "mlb" ? t.display_name : t.full_name, league.startsWith("ncaa") ? t.college : null].forEach(add);
			}
		}
		if (e.seat === 2) for (const t of (v as { results: Record<string, unknown>[] }).results) add(t.team);
		if (e.seat === 3) for (const g of v as Record<string, unknown>[]) [g.HomeTeam, g.AwayTeam].forEach(add);
		if (e.seat === 4) for (const t of v as Record<string, unknown>[]) add(t.full_name);
	}
	return out;
}

// What each seat's own list carries that is not one of the league's teams: all-star sides, a
// defunct club, schools outside Division I. Pinned, so a change to a list shows here.
const NOT_A_TEAM: Readonly<Record<string, readonly string[]>> = {
	mlb: ["seat 4 American League", "seat 4 National League"],
	nba: ["seat 4 Golden State Warriors Blue", "seat 4 Golden State Warriors Gold"],
	nhl: ["seat 4 Arizona Coyotes"],
	ncaaf: ["seat 4 Occidental Tigers", "seat 4 Savannah State Tigers", "seat 4 Wisconsin-Whitewater Warhawks"],
	ncaab: [
		"seat 2 West Florida",
		"seat 4 Baldwin Wallace Yellow Jackets", "seat 4 Brescia Bearcats", "seat 4 Cincinnati Clermont", "seat 4 Clinton Bears",
		"seat 4 Defiance College Yellow Jackets", "seat 4 Gallaudet Bison", "seat 4 Georgia Southwestern State Hurricanes",
		"seat 4 Immaculata Mighty Macs", "seat 4 John Jay College Bloodhounds", "seat 4 Johnson And Wales (NC) Wildcats",
		"seat 4 Kansas Christian Falcons", "seat 4 North American Stallions", "seat 4 Pfeiffer Falcons", "seat 4 Regent University Royals",
		"seat 4 Sonoma State Seawolves", "seat 4 Spalding Golden Eagles", "seat 4 Western State Colorado Mountaineers",
	],
};

describe("team lists", () => {
	test("every alias on every seat's own list names exactly one team, or is one of the pinned names that are not the league's", () => {
		const notJoined: Record<string, string[]> = {};
		for (const [league, seats] of ownLists()) {
			// Every team holding each comparison form, read straight from the generated list.
			const holders = new Map<string, string[]>();
			for (const t of TEAMS[league]) for (const x of t.names) holders.set(normalise(x), [...(holders.get(normalise(x)) ?? []), t.key]);
			for (const [seat, names] of seats) {
				for (const n of names) {
					const keys = [...new Set(holders.get(normalise(n)) ?? [])];
					if (keys.length > 1) throw new Error(`${league}: seat ${seat} "${n}" names ${keys.length} teams`);
					if (keys.length === 1) expect({ league, seat, n, key: resolveTeam(league, n) }).toEqual({ league, seat, n, key: keys[0] });
					else (notJoined[league] ??= []).push(`seat ${seat} ${n}`);
				}
			}
		}
		for (const league of Object.keys(notJoined)) notJoined[league].sort();
		expect(notJoined).toEqual(Object.fromEntries(Object.entries(NOT_A_TEAM).map(([l, v]) => [l, [...v].sort()])));
	});

	test("no alias in the lists names two teams, and every alias comes from a seat's own list", () => {
		const lists = ownLists();
		for (const [league, teams] of Object.entries(TEAMS)) {
			const seen = new Map<string, string>();
			const carried = new Set([...lists.get(league)!.values()].flatMap((s) => [...s]).map(normalise));
			// A college school also takes the spellings its own seats' lists give it in the other
			// college league.
			const other = league === "ncaaf" ? "ncaab" : league === "ncaab" ? "ncaaf" : null;
			if (other !== null) for (const s of lists.get(other)!.values()) for (const n of s) carried.add(normalise(n));
			for (const t of teams) {
				for (const n of t.names) {
					const f = normalise(n);
					expect({ league, n, other: seen.get(f) ?? t.key }).toEqual({ league, n, other: t.key });
					seen.set(f, t.key);
					expect({ league, n, onAList: carried.has(f) }).toEqual({ league, n, onAList: true });
				}
			}
		}
	});

	test("different schools never meet: a school, its namesakes, and cities with two teams", () => {
		const is = (league: string, name: string, key: string | null) => expect({ league, name, key: resolveTeam(league, name) }).toEqual({ league, name, key });
		// A small college beside the Division I school whose name it begins with: different schools.
		is("ncaab", "Colorado College", null);
		is("ncaab", "Colorado College Tigers", null);
		is("ncaab", "Colorado", "colorado-buffaloes");
		is("ncaab", "Rhode Island College", null);
		is("ncaab", "Rhode Island", "rhode-island-rams");
		is("ncaab", "Cornell College", null);
		is("ncaab", "Cornell College (IA) Rams", null);
		is("ncaab", "Cornell", "cornell-big-red");
		is("ncaaf", "Colorado College", null);
		// Miami with and without a qualifier: Miami is Florida's on every list that writes it alone.
		for (const league of ["ncaaf", "ncaab"]) {
			is(league, "Miami", "miami-hurricanes");
			is(league, "Miami (FL)", "miami-hurricanes");
			is(league, "Miami Hurricanes", "miami-hurricanes");
			is(league, "Miami (OH)", "miami-oh-redhawks");
			is(league, "Miami (OH) RedHawks", "miami-oh-redhawks");
			is(league, "Miami Ohio", "miami-oh-redhawks");
			is(league, "Miami RedHawks", null); // no list writes it
		}
		is("ncaab", "Miami (OH)-Hamilton Harriers", null); // a branch campus on seat 1's list
		// A city with two teams names neither.
		for (const [league, city] of [["nfl", "New York"], ["nfl", "Los Angeles"], ["nba", "Los Angeles"], ["nba", "LA"], ["nba", "New York"], ["mlb", "New York"], ["mlb", "Chicago"], ["mlb", "Los Angeles"], ["nhl", "New York"], ["ncaab", "Los Angeles"], ["ncaab", "Philadelphia"]] as const) {
			is(league, city, null);
		}
		// Columbia is a school's own name, and the city of two other schools: no reader takes a city
		// as a team's name (status.test.ts reads a record that gives one).
		is("ncaab", "Columbia", "columbia-lions");
		// Two teams of one city, by their full names, stay two.
		is("mlb", "Chicago Cubs", "chicago-cubs");
		is("mlb", "Chicago White Sox", "chicago-white-sox");
		is("nba", "Los Angeles Lakers", "los-angeles-lakers");
		is("nba", "Los Angeles Clippers", "la-clippers");
	});

	test("a shortening no list carries joins nothing, though the school is real", () => {
		// The school's name with State written St, where no seat's list writes it that way.
		const listed = new Set([...ownLists().get("ncaab")!.values()].flatMap((s) => [...s]));
		for (const name of ["Utah St", "Boise St Broncos", "Ohio St"]) {
			expect(listed.has(name)).toBe(false);
			expect({ name, key: resolveTeam("ncaab", name) }).toEqual({ name, key: null });
		}
		// The control: a spelling a list carries, joined by hand, resolves.
		expect(listed.has("Florida St Seminoles")).toBe(true);
		expect(resolveTeam("ncaab", "Florida St Seminoles")).toBe("florida-state-seminoles");
	});

	test("a hand join comes from the seat its group names, and a school's spellings serve both college leagues", () => {
		const lists = ownLists();
		for (const g of JOINS.groups) {
			expect(g.why.length).toBeGreaterThan(40);
			for (const [spelling, team] of Object.entries(g.joins)) {
				expect({ league: g.league, seat: g.seat, spelling, onList: lists.get(g.league)!.get(g.seat)!.has(spelling) }).toEqual({ league: g.league, seat: g.seat, spelling, onList: true });
				expect({ spelling, key: resolveTeam(g.league, spelling) }).toEqual({ spelling, key: resolveTeam(g.league, team) });
			}
		}
		// Seat 4 writes these only in its basketball list; the schools play football too.
		for (const name of ["Florida St Seminoles", "Michigan St Spartans", "Kansas St Wildcats"]) {
			expect({ name, onFootballList: lists.get("ncaaf")!.get(4)!.has(name) }).toEqual({ name, onFootballList: false });
			expect({ name, football: resolveTeam("ncaaf", name) }).toEqual({ name, football: resolveTeam("ncaab", name) });
		}
		expect(resolveTeam("ncaaf", "Florida St Seminoles")).toBe("florida-state-seminoles");
		// The control: a school with no football team on seat 1's list gains nothing there.
		expect(resolveTeam("ncaab", "Boston Univ. Terriers")).toBe("boston-university-terriers");
		expect(resolveTeam("ncaaf", "Boston Univ. Terriers")).toBeNull();
	});

	test("a name a non-school entry also carries stays the school's only by a reviewed exception", () => {
		expect(JOINS.namesakes.map((n) => `${n.league} ${n.name}`)).toEqual(["ncaab Georgia"]);
		expect(resolveTeam("ncaab", "Georgia")).toBe("georgia-bulldogs");
	});

	test("every team name in a saved answer resolves, or its own seat marks it outside the league's teams", () => {
		// Marked outside: a college team its game record gives no conference, or a name its own seat's
		// list carries that is pinned above as not the league's.
		const pinned = new Set(Object.entries(NOT_A_TEAM).flatMap(([l, v]) => v.map((x) => `${l} ${x}`)));
		const unresolved: string[] = [];
		for (const e of INDEX) {
			if (e.status !== 200 || isList(e.path)) continue;
			const league = leagueOf(e.file);
			const v = body(e.file) as Record<string, unknown> | Record<string, unknown>[];
			const check = (names: readonly string[], outside: boolean, where: string) => {
				if (resolveFeedTeam(league, { names, points: null }) !== null) return;
				if (!outside && !(names.length === 1 && pinned.has(`${where} ${names[0]}`))) unresolved.push(`${where} ${names.join(" / ")}`);
			};
			if (e.seat === 1) {
				for (const g of (v as { data: Record<string, unknown>[] }).data) {
					const r = seat1(league, g)!;
					// Seat 1's college game records give each team its conference; none, outside Division I.
					const teams = [g.home_team, g.visitor_team ?? g.away_team] as Record<string, unknown>[];
					r.teams.forEach((t, i) => check(t.names, league.startsWith("ncaa") && teams[i].conference_id === null, `${league} seat 1`));
				}
			}
			if (e.seat === 2) {
				for (const g of (v as { results: Record<string, unknown>[] }).results) {
					const r = seat2(league, g)!;
					const teams = g.teams as Record<string, Record<string, unknown>>;
					// Seat 2's game records give each team its conference; none, outside Division I.
					[teams.home, teams.away].forEach((t, i) => check(r.teams[i].names, league.startsWith("ncaa") && (t.conference ?? null) === null, `${league} seat 2`));
				}
			}
			if (e.seat === 3 && e.path.startsWith("/odds/")) for (const g of v as Record<string, unknown>[]) for (const n of [g.HomeTeam, g.AwayTeam] as string[]) check([n], false, `${league} seat 3`);
			if (e.seat === 4) for (const g of v as Record<string, unknown>[]) seat4(g)!.teams.forEach((t) => check(t.names, false, `${league} seat 4`));
		}
		expect([...new Set(unresolved)].sort()).toEqual([]);
	});

	test("the lists' sizes", () => {
		expect(Object.fromEntries(Object.entries(TEAMS).map(([l, t]) => [l, t.length]))).toEqual({
			nfl: 32,
			nba: 30,
			mlb: 30,
			nhl: 32,
			ncaaf: 505,
			ncaab: 372,
		});
	});

	test("names resolve within their own league only", () => {
		expect(resolveTeam("nfl", "New York Giants")).not.toBeNull();
		expect(resolveTeam("mlb", "New York Giants")).toBeNull();
		expect(resolveTeam("mlb", "San Francisco Giants")).not.toBeNull();
		expect(resolveTeam("nope", "San Francisco Giants")).toBeNull();
		expect(resolveTeam("__proto__", "San Francisco Giants")).toBeNull();
	});

	test("the comparison form drops case, accents and punctuation, and nothing else", () => {
		expect(normalise("St. Mary's (CA)")).toBe("st marys ca");
		expect(normalise("Montréal Canadiens")).toBe("montreal canadiens");
		expect(normalise("Texas A&M")).toBe("texas a and m");
		expect(normalise("  Hawai’i  ")).toBe("hawaii");
		expect(normalise("Miami (OH)")).not.toBe(normalise("Miami"));
		expect(normalise("Mississippi State")).not.toBe(normalise("Mississippi"));
		expect(normalise("Colorado College")).not.toBe(normalise("Colorado"));
	});
});
