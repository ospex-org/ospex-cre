// Builds the team lists in src/teams/ from the seats' own team lists. Run after a capture:
//
//   bun capture/teams.ts
//
// One team per current entry on seat 1's list for the league. Seat 1's list gives every team an id
// and, in college, the school's name beside the full name, so it is the roll the other seats join.
//
// A spelling becomes a team's alias only when it comes from a seat's own list (the team lists of
// seats 1, 2 and 4, and seat 3's board, its one list of games and teams) and one reviewed identity
// joins it to exactly one team:
//   same name  its comparison form (normalise, src/teams.ts) equals one of the team's own names on
//              seat 1's list: the full name, the school's name in college, the display name in
//              baseball;
//   hand join  capture/joins.json joins it, naming the seat whose list carries it and why the two
//              names are one team.
// Nothing else joins: no shortening, no partial match. A spelling that matches no team, or more than
// one, joins nothing, and teams-report.txt lists it. In college, seat 1's list also carries schools
// outside the league's teams (Division II and III, NAIA), and they play Division I teams; a spelling
// one of them carries names two schools and joins neither. College football and college basketball
// are the same schools: a spelling a seat's list joins to a school in one is that school's in the
// other.
//
// Names in saved game answers are never a source. The suite checks that every one of them resolves
// or is a school the lists do not hold (test/teams.test.ts).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

/** A group of hand joins: one seat, one league, one reason. */
export interface JoinGroup {
	seat: Seat;
	league: string;
	why: string;
	/** The seat's spelling -> the team's own name on seat 1's list. */
	joins: Record<string, string>;
}

/**
 * A name a school outside the league's teams also carries on seat 1's list, kept for one team
 * because the other entry is shown not to be a school.
 */
export interface Namesake {
	league: string;
	name: string;
	team: string;
	why: string;
}

const index: Entry[] = JSON.parse(readFileSync(join(FIX, "index.json"), "utf8"));
const joinsFile: { groups: JoinGroup[]; namesakes: Namesake[] } = JSON.parse(readFileSync(join(import.meta.dir, "joins.json"), "utf8"));
const groups = joinsFile.groups;
const namesakes = joinsFile.namesakes;
const LEAGUES = ["nfl", "nba", "mlb", "nhl", "ncaaf", "ncaab"] as const;
const COLLEGE = new Set<string>(["ncaaf", "ncaab"]);

const body = (e: Entry): unknown => JSON.parse(readFileSync(join(FIX, e.file), "utf8"));
const leagueOf = (e: Entry): string => e.file.split("/")[1];
const isList = (e: Entry): boolean => /\/teams|\/participants/.test(e.path);
const isBoard = (e: Entry): boolean => e.seat === 3 && e.path.startsWith("/odds/");
const slug = (s: string): string => normalise(s).replace(/ /g, "-");
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Seat 1's entry: whether the league holds it as a team, its key, and its own names. */
function seat1Entry(league: string, t: Record<string, unknown>): { current: boolean; key: string | null; names: string[] } {
	const canonical = league === "mlb" ? text(t.display_name) : text(t.full_name);
	const names = [canonical, COLLEGE.has(league) ? text(t.college) : null].filter((n): n is string => n !== null);
	let current = canonical !== null;
	// The basketball list also carries defunct and overseas teams, with no current conference.
	if (league === "nba" && t.conference !== "East" && t.conference !== "West") current = false;
	// So does the hockey list; its current teams are the ones with a conference.
	if (league === "nhl" && text(t.conference_name) === null) current = false;
	// The college basketball list runs to every division; Division I teams carry a conference.
	if (league === "ncaab" && typeof t.conference_id !== "number") current = false;
	// The college football list carries placeholders ("TBD", "All-Stars") with no school.
	if (league === "ncaaf" && (text(t.college) === null || t.college === "TBD")) current = false;
	return { current, key: canonical === null ? null : slug(canonical), names };
}

/** Every spelling each seat's own list carries for a league: team lists, and seat 3's board. */
function listNames(league: string): Map<Seat, Set<string>> {
	const out = new Map<Seat, Set<string>>([[1, new Set()], [2, new Set()], [3, new Set()], [4, new Set()]]);
	for (const e of index) {
		if (leagueOf(e) !== league || e.status !== 200 || !(isList(e) || isBoard(e))) continue;
		const v = body(e);
		const add = (n: unknown) => {
			const s = text(n);
			if (s !== null) out.get(e.seat)!.add(s);
		};
		if (e.seat === 1) {
			for (const t of ((v as Record<string, unknown>).data as Record<string, unknown>[]) ?? []) {
				const s = seat1Entry(league, t);
				if (s.current) s.names.forEach(add);
			}
		}
		if (e.seat === 2) for (const t of ((v as Record<string, unknown>).results as Record<string, unknown>[]) ?? []) add(t.team);
		if (e.seat === 3 && Array.isArray(v)) for (const g of v as Record<string, unknown>[]) [g.HomeTeam, g.AwayTeam].forEach(add);
		if (e.seat === 4 && Array.isArray(v)) for (const t of v as Record<string, unknown>[]) add(t.full_name);
	}
	return out;
}

interface Team {
	key: string;
	names: Set<string>;
}

interface Built {
	teams: Team[];
	/** Comparison forms that name a school seat 1's list holds outside the league's teams. */
	outside: Set<string>;
}

const report: string[] = [];
const refusals: string[] = [];

/** Seat 2's own mascot for each spelling on its list, by league. */
function seat2Mascots(league: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const e of index) {
		if (leagueOf(e) !== league || e.status !== 200 || !isList(e) || e.seat !== 2) continue;
		for (const t of ((body(e) as Record<string, unknown>).results as Record<string, unknown>[]) ?? []) {
			const name = text(t.team);
			const mascot = text(t.mascot);
			if (name !== null && mascot !== null) out.set(name, mascot);
		}
	}
	return out;
}

function build(league: string): Built {
	const teams = new Map<string, Team>();
	const own = new Map<string, Set<string>>(); // comparison form of seat 1's own name -> team keys
	const mascot = new Map<string, string>(); // team key -> its nickname on seat 1's list
	const outside = new Set<string>();
	for (const e of index) {
		if (leagueOf(e) !== league || e.status !== 200 || !isList(e) || e.seat !== 1) continue;
		for (const t of ((body(e) as Record<string, unknown>).data as Record<string, unknown>[]) ?? []) {
			const s = seat1Entry(league, t);
			if (!s.current || s.key === null) {
				// A pro list's other entries are defunct clubs, which play no one. College's are schools
				// that do play.
				if (COLLEGE.has(league)) s.names.forEach((n) => outside.add(normalise(n)));
				continue;
			}
			if (teams.has(s.key)) refusals.push(`${league}: seat 1's list has two current entries for ${s.key}`);
			teams.set(s.key, { key: s.key, names: new Set() });
			const nick = text(t.name);
			if (nick !== null) mascot.set(s.key, nick);
			for (const n of s.names) {
				const f = normalise(n);
				if (!own.has(f)) own.set(f, new Set());
				own.get(f)!.add(s.key);
			}
		}
	}
	for (const ns of namesakes.filter((x) => x.league === league)) {
		const f = normalise(ns.name);
		const keys = own.get(f);
		if (!outside.has(f)) refusals.push(`${league}: namesake "${ns.name}" is not a name outside the league's teams; drop it`);
		else if (keys === undefined || keys.size !== 1 || ![...keys].includes(slug(ns.team))) {
			refusals.push(`${league}: namesake "${ns.name}" is not ${ns.team}'s own name on seat 1's list`);
		} else {
			outside.delete(f);
			report.push(`${league}: "${ns.name}" stays ${slug(ns.team)}'s though an entry outside the league's teams carries it: ${ns.why}`);
		}
	}
	const unique = (f: string): string | null => {
		const keys = own.get(f);
		return keys !== undefined && keys.size === 1 && !outside.has(f) ? [...keys][0] : null;
	};
	const mascots2 = seat2Mascots(league);
	const hand = new Map<string, { key: string; seat: Seat }>(); // "seat|spelling" -> team
	for (const g of groups.filter((x) => x.league === league)) {
		for (const [spelling, target] of Object.entries(g.joins)) {
			const key = unique(normalise(target));
			if (key === null) {
				refusals.push(`${league}: hand join "${spelling}" -> "${target}": "${target}" is not exactly one team's own name`);
				continue;
			}
			// Seat 2's list carries each school's mascot: a hand join must agree with seat 1's.
			const theirs = g.seat === 2 ? mascots2.get(spelling) : undefined;
			const ours = mascot.get(key);
			if (theirs !== undefined && ours !== undefined && normalise(theirs) !== normalise(ours)) {
				refusals.push(`${league}: hand join "${spelling}" -> ${key}: seat 2's mascot ${theirs} is not seat 1's ${ours}`);
				continue;
			}
			hand.set(`${g.seat}|${spelling}`, { key, seat: g.seat });
			report.push(`${league}: seat ${g.seat} "${spelling}" joins ${key} by hand${theirs !== undefined ? ` (mascot ${theirs} on both lists)` : ""}`);
		}
	}
	const lists = listNames(league);
	for (const k of hand.keys()) {
		const [seat, spelling] = [Number(k.split("|")[0]) as Seat, k.slice(k.indexOf("|") + 1)];
		if (!lists.get(seat)!.has(spelling)) refusals.push(`${league}: hand join "${spelling}" is not on seat ${seat}'s own list`);
	}
	for (const seat of [1, 2, 3, 4] as Seat[]) {
		for (const name of [...lists.get(seat)!].sort()) {
			const f = normalise(name);
			const same = unique(f);
			const byHand = hand.get(`${seat}|${name}`)?.key ?? null;
			if (outside.has(f)) {
				report.push(`${league}: seat ${seat} "${name}" joins nothing: a school outside the league's teams carries it too`);
				if (byHand !== null) refusals.push(`${league}: hand join "${name}" names a school outside the league's teams too`);
				continue;
			}
			if (same !== null && byHand !== null) refusals.push(`${league}: hand join "${name}" is already ${same}'s own name; drop it`);
			const key = same ?? byHand;
			if (key === null) {
				report.push(`${league}: seat ${seat} "${name}" joins nothing${(own.get(f)?.size ?? 0) > 1 ? " (it is two teams' name)" : ""}`);
				continue;
			}
			teams.get(key)!.names.add(name);
		}
	}
	return { teams: [...teams.values()], outside };
}

const built = new Map<string, Built>();
for (const league of LEAGUES) built.set(league, build(league));

// One school in both college leagues: each league takes the other's spellings for a school it
// holds under the same key, unless the spelling names another of its teams or a school outside.
const shared: Record<string, number> = {};
for (const [to, from] of [["ncaaf", "ncaab"], ["ncaab", "ncaaf"]] as const) {
	const target = built.get(to)!;
	const taken = new Map<string, string>();
	for (const t of target.teams) for (const n of t.names) taken.set(normalise(n), t.key);
	const byKey = new Map(target.teams.map((t) => [t.key, t]));
	shared[to] = 0;
	for (const t of built.get(from)!.teams) {
		const here = byKey.get(t.key);
		if (here === undefined) continue;
		for (const n of t.names) {
			const f = normalise(n);
			const holder = taken.get(f);
			if (holder === t.key) continue;
			if (holder !== undefined || target.outside.has(f)) {
				report.push(`${to}: "${n}" (${from}) not shared to ${t.key}: ${holder ?? "a school outside the league's teams"} has it`);
				continue;
			}
			here.names.add(n);
			taken.set(f, t.key);
			shared[to]++;
		}
	}
}

for (const league of LEAGUES) {
	const teams = built.get(league)!.teams.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
	const seen = new Map<string, string>();
	for (const t of teams) {
		for (const n of t.names) {
			const prior = seen.get(normalise(n));
			if (prior !== undefined && prior !== t.key) refusals.push(`${league}: "${n}" would name ${prior} and ${t.key}`);
			seen.set(normalise(n), t.key);
		}
	}
	const lines = teams.map((t) => `\t{ key: ${JSON.stringify(t.key)}, names: ${JSON.stringify([...t.names].sort())} },`).join("\n");
	if (refusals.length === 0) {
		writeFileSync(
			join(OUT, `${league}.ts`),
			`// Generated by capture/teams.ts from the seats' own team lists. Edit capture/joins.json and\n// regenerate; do not edit by hand.\n\nimport type { Team } from "../teams";\n\nexport const ${league.toUpperCase()}: readonly Team[] = [\n${lines}\n];\n`,
		);
	}
	console.log(`${league}: ${teams.length} teams${shared[league] ? `, ${shared[league]} spellings shared from the other college league` : ""}`);
}
if (refusals.length > 0) {
	console.log(`REFUSED, nothing written:\n${refusals.join("\n")}`);
	process.exit(1);
}
writeFileSync(join(import.meta.dir, "teams-report.txt"), `${report.join("\n")}\n`);
console.log(`${report.length} lines in capture/teams-report.txt`);
