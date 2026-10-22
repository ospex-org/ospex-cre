// Builds the team lists in src/teams/ from the seats' own team lists and from every team name in
// the saved answers. Run after a capture:
//
//   bun capture/teams.ts
//
// One team per entry in seat 1's list for the league. Every other spelling joins a team when its
// comparison form (see normalise in src/teams.ts) equals one already on that team, or when
// capture/joins.json joins it by hand. A spelling that joins nothing is reported, never guessed;
// so is one that would join two teams. The output is plain data, reviewed like code: it is part
// of the program's fingerprint.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toRecord as seat1Record } from "../src/readers/seat1";
import { toRecord as seat2Record } from "../src/readers/seat2";
import { toRecord as seat4Record } from "../src/readers/seat4";
import { normalise } from "../src/teams";
import type { Seat } from "../src/types";

const ROOT = join(import.meta.dir, "..");
const FIX = join(ROOT, "fixtures");
const OUT = join(ROOT, "src", "teams");

interface Entry {
	seat: Seat;
	path: string;
	status: number;
	file: string;
}

const index: Entry[] = JSON.parse(readFileSync(join(FIX, "index.json"), "utf8"));
const joins: Record<string, Record<string, string>> = JSON.parse(readFileSync(join(import.meta.dir, "joins.json"), "utf8"));
const LEAGUES = ["nfl", "nba", "mlb", "nhl", "ncaaf", "ncaab"] as const;

const body = (e: Entry): unknown => JSON.parse(readFileSync(join(FIX, e.file), "utf8"));
const inLeague = (e: Entry, league: string): boolean => e.file.split("/")[1] === league && e.status === 200;
const isList = (e: Entry): boolean => /\/teams|\/participants/.test(e.path);

interface Team {
	key: string;
	names: Set<string>;
}

const slug = (s: string): string => normalise(s).replace(/ /g, "-");

function seat1Team(league: string, t: Record<string, unknown>): { canonical: string; names: string[] } | null {
	const s = (k: string) => (typeof t[k] === "string" && (t[k] as string).trim() !== "" ? (t[k] as string) : null);
	// The basketball list also carries defunct and overseas teams, with no current conference.
	if (league === "nba" && s("conference") !== "East" && s("conference") !== "West") return null;
	// So does the hockey list; its current teams are the ones with a conference.
	if (league === "nhl" && s("conference_name") === null) return null;
	// The college basketball list runs to every division; Division I teams carry a conference.
	if (league === "ncaab" && typeof t.conference_id !== "number") return null;
	// The college football list carries placeholders ("TBD", "All-Stars") with no school.
	if (league === "ncaaf" && (s("college") === null || s("college") === "TBD")) return null;
	const canonical = league === "mlb" ? s("display_name") : s("full_name");
	if (canonical === null) return null;
	const names = [canonical];
	if (league === "ncaaf" || league === "ncaab") for (const k of ["college", "city"]) if (s(k)) names.push(s(k)!);
	return { canonical, names };
}

/** Every team name a saved game answer carries, by seat: exactly the names each reader passes on. */
function namesInAnswers(league: string): Map<Seat, Set<string>> {
	const out = new Map<Seat, Set<string>>([[1, new Set()], [2, new Set()], [3, new Set()], [4, new Set()]]);
	for (const e of index) {
		if (!inLeague(e, league) || isList(e)) continue;
		const v = body(e) as Record<string, unknown> | unknown[];
		const add = (names: readonly string[]) => names.forEach((n) => out.get(e.seat)!.add(n));
		if (e.seat === 1) {
			for (const g of ((v as Record<string, unknown>).data as Record<string, unknown>[]) ?? []) {
				const r = seat1Record(league, g);
				if (r) r.teams.forEach((t) => add(t.names));
			}
		} else if (e.seat === 2) {
			for (const g of ((v as Record<string, unknown>).results as Record<string, unknown>[]) ?? []) {
				const r = seat2Record(g);
				if (r) r.teams.forEach((t) => add(t.names));
			}
		} else if (e.seat === 3) {
			if (e.path.startsWith("/odds/") && Array.isArray(v))
				for (const g of v as Record<string, unknown>[]) add([g.HomeTeam, g.AwayTeam].filter((n): n is string => typeof n === "string"));
		} else if (e.seat === 4 && Array.isArray(v)) {
			for (const g of v as Record<string, unknown>[]) {
				const r = seat4Record(g);
				if (r) r.teams.forEach((t) => add(t.names));
			}
		}
	}
	return out;
}

/** Every team name a seat's own team list carries. */
function namesInLists(league: string): Map<Seat, Set<string>> {
	const out = new Map<Seat, Set<string>>([[1, new Set()], [2, new Set()], [3, new Set()], [4, new Set()]]);
	for (const e of index) {
		if (!inLeague(e, league) || !isList(e) || e.seat === 1) continue;
		const v = body(e);
		if (e.seat === 2) for (const t of ((v as Record<string, unknown>).results as Record<string, unknown>[]) ?? []) out.get(2)!.add(t.team as string);
		if (e.seat === 4 && Array.isArray(v)) for (const t of v as Record<string, unknown>[]) out.get(4)!.add(t.full_name as string);
	}
	return out;
}

const report: string[] = [];

/**
 * One generation-time rule, for spellings that differ only by how they shorten a word: "St" for
 * "State", "Univ" for "University", or a trailing "University" or "College". The joined spelling
 * is written into the team's names like any other, so the program itself only ever compares
 * exact comparison forms. A variant joins only when it names exactly one team, and every join it
 * makes is listed in the report for review.
 */
function variantJoin(name: string, byNorm: Map<string, Team>, league: string, seat: Seat): Team | undefined {
	const n = normalise(name);
	const variants = new Set([
		n.replace(/\bst\b/g, "state"),
		n.replace(/\buniv\b/g, "university"),
		n.replace(/\b(university|univ|college)\b/g, "").replace(/ +/g, " ").trim(),
		n.replace(/\bst\b/g, "state").replace(/\b(university|univ|college)\b/g, "").replace(/ +/g, " ").trim(),
	]);
	variants.delete(n);
	const found = new Set<Team>();
	for (const v of variants) {
		const t = byNorm.get(v);
		if (t) found.add(t);
	}
	if (found.size !== 1) return undefined;
	const team = [...found][0];
	report.push(`${league}: seat ${seat} "${name}" joined ${team.key} by the shortening rule`);
	return team;
}

for (const league of LEAGUES) {
	const teams: Team[] = [];
	const byNorm = new Map<string, Team>();
	const addName = (team: Team, name: string) => {
		team.names.add(name);
		const n = normalise(name);
		const prior = byNorm.get(n);
		if (prior && prior !== team) report.push(`${league}: "${name}" names two teams (${prior.key}, ${team.key})`);
		else byNorm.set(n, team);
	};
	for (const e of index) {
		if (!inLeague(e, league) || !isList(e) || e.seat !== 1) continue;
		for (const t of ((body(e) as Record<string, unknown>).data as Record<string, unknown>[]) ?? []) {
			const st = seat1Team(league, t);
			if (st === null) continue;
			const team: Team = { key: slug(st.canonical), names: new Set() };
			teams.push(team);
			for (const n of st.names) addName(team, n);
		}
	}
	const hand = joins[league] ?? {};
	for (const [spelling, canonical] of Object.entries(hand)) {
		const team = byNorm.get(normalise(canonical));
		if (!team) report.push(`${league}: join "${spelling}" -> "${canonical}": no such team`);
		else addName(team, spelling);
	}
	const lists = namesInLists(league);
	const answers = namesInAnswers(league);
	for (const seat of [1, 2, 3, 4] as Seat[]) {
		for (const name of new Set([...lists.get(seat)!, ...answers.get(seat)!])) {
			const team = byNorm.get(normalise(name)) ?? variantJoin(name, byNorm, league, seat);
			if (team) team.names.add(name);
			else report.push(`${league}: seat ${seat} "${name}" joins no team${answers.get(seat)!.has(name) ? " (in a saved answer)" : ""}`);
		}
	}
	const lines = teams
		.map((t) => `\t{ key: ${JSON.stringify(t.key)}, names: ${JSON.stringify([...t.names].sort())} },`)
		.join("\n");
	writeFileSync(
		join(OUT, `${league}.ts`),
		`// Generated by capture/teams.ts from the seats' team lists and the saved answers. Edit\n// capture/joins.json and regenerate; do not edit by hand.\n\nimport type { Team } from "../teams";\n\nexport const ${league.toUpperCase()}: readonly Team[] = [\n${lines}\n];\n`,
	);
	console.log(`${league}: ${teams.length} teams`);
}
writeFileSync(join(import.meta.dir, "teams-report.txt"), `${report.join("\n")}\n`);
console.log(`${report.length} lines in capture/teams-report.txt`);
