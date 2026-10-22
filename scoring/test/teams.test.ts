// The team lists: every name in every saved answer resolves to one team, and no spelling means
// two teams. A name the lists lack can only make a seat silent (see silent.test.ts), never make it
// say a game is absent, so a gap here costs a reading, not a wrong one.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveFeedTeam } from "../src/pick";
import { toRecord as seat1 } from "../src/readers/seat1";
import { toRecord as seat2 } from "../src/readers/seat2";
import { toRecord as seat4 } from "../src/readers/seat4";
import { normalise, resolveTeam } from "../src/teams";
import { TEAMS } from "../src/teams/index";
import { INDEX, ROOT } from "./fixtures";

/** Every team name a saved game answer carries, as the readers pass it on, by league. */
function savedNames(): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const e of INDEX) {
		if (e.status !== 200 || /\/teams|\/participants/.test(e.path)) continue;
		const league = e.file.split("/")[1];
		if (!out.has(league)) out.set(league, new Set());
		const add = (names: readonly string[]) => names.forEach((n) => out.get(league)!.add(n));
		const v = JSON.parse(readFileSync(join(ROOT, e.file), "utf8"));
		if (e.seat === 1) for (const g of v.data) seat1(league, g)?.teams.forEach((t) => add(t.names));
		if (e.seat === 2) for (const g of v.results) seat2(g)?.teams.forEach((t) => add(t.names));
		if (e.seat === 3 && e.path.startsWith("/odds/")) for (const g of v) add([g.HomeTeam, g.AwayTeam]);
		if (e.seat === 4) for (const g of v) seat4(g)?.teams.forEach((t) => add(t.names));
	}
	return out;
}

// Outside Division I, so not in the college basketball list: a game against one reads silent at
// the seat that lists it. Pinned, so a change to the list shows here.
const NOT_DIVISION_I = [
	"Adams State", "Berry", "Bethesda", "Biola", "Bridgewater", "Cal State-San Marcos", "Cameron",
	"Carnegie Mellon", "Chapman", "Cheyney", "Coast Guard", "Curry College", "Dallas Christian",
	"Eureka", "Fisk", "Fresno Pacific", "George Fox", "Indiana-Kokomo", "Kentucky Christian",
	"La Verne", "LaGrange College", "Lane College", "Lawrence University", "Lewis & Clark",
	"Lincoln (MO)", "Louisiana Christian", "Lyon College", "MIT", "Maryville University",
	"Maryville-Tennesee", "Miami-Middletown", "Mid-America Christian", "Midway", "Milligan",
	"Minnesota-Crookston", "Monmouth (IL)", "Morris College", "Mount Marty", "Mount Olive",
	"New College of Florida", "North American University", "North Texas-Dallas",
	"Notre Dame of Maryland", "Oakwood", "Ottawa (KS)", "Paine", "Paul Quinn", "Pfeiffer",
	"Regent University", "Regis University", "Reinhardt", "Rivier", "SUNY-Old Westbury",
	"Saint Joseph's Long Island", "San Francisco State", "Schreiner", "Southeastern Baptist College",
	"Southwestern Christian University", "St. Francis (IL)", "St. Joseph's (NY)", "St. Vincent",
	"Texas A&M-Kingsville", "Tougaloo", "Virginia University-Lynchburg", "Warren Wilson",
	"West Coast Baptist", "West Florida", "Western Colorado University", "Western New Mexico",
	"Whittier", "Willamette", "William Jessup",
];

describe("team lists", () => {
	test("every team name in a saved answer resolves, but the non-Division I college basketball opponents", () => {
		const unresolved: Record<string, string[]> = {};
		for (const [league, names] of savedNames()) {
			const missing = [...names].filter((n) => resolveFeedTeam(league, { names: [n], points: null }) === null).sort();
			if (missing.length) unresolved[league] = missing;
		}
		expect(Object.keys(unresolved)).toEqual(["ncaab"]);
		expect(unresolved.ncaab).toEqual([...NOT_DIVISION_I].sort());
	});

	test("every spelling resolves to its own team and no other", () => {
		const clashes: string[] = [];
		for (const [league, teams] of Object.entries(TEAMS)) {
			const keys = new Set<string>();
			for (const t of teams) {
				if (keys.has(t.key)) clashes.push(`${league}: key ${t.key} twice`);
				keys.add(t.key);
				for (const n of t.names) if (resolveTeam(league, n) !== t.key) clashes.push(`${league}: ${n}`);
			}
		}
		expect(clashes).toEqual([]);
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
		expect(resolveTeam("ncaab", "Miami (OH)")).not.toBe(resolveTeam("ncaab", "Miami"));
	});
});
