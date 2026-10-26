// Verification on the saved college basketball answers of opening night, 2 to 4 Nov, from the saved
// answers only. No key and no network.
//
//   bun opening-night.ts             the counts
//   bun opening-night.ts --ledger    the counts, then every game and what verification decides
//
// The games: every record seat 2 lists on 2, 3 or 4 Nov with a time, whose two teams both resolve
// in the lists (the Division I games). Each is created at its own time, with no hints, so seat 3 is
// silent for the game and the spare stands in. A game is measured when every request its run makes
// has a saved answer; the rest need 31 Oct or 5 Nov, which were never saved, and are counted apart.
//
// Two answers are stood in, and nothing else:
//   * 1 Nov was never saved. Its requests are answered with 4 Nov's body at the same seat: every range
//     that asks 1 Nov asks 4 Nov too, so this only repeats records already read.
//   * The spare listed no college basketball yet when the answers were saved. Its answer is one record
//     per game, at seat 2's time and names, not started.
// Besides the run, each game is read at seats 1 and 2 by team near its date and in its window from
// that date, as verification and scoring read them.

import { readerFor } from "./src/index";
import { scoreGameSync } from "./src/program";
import { toRecord } from "./src/readers/seat2";
import { runSync } from "./src/run";
import { resolveTeam } from "./src/teams";
import type { Game, HttpRequest } from "./src/types";
import { MID } from "./test/cases";
import { INDEX, KEY, bytesOf, locate, saved } from "./test/fixtures";
import { PAYOUT, PAYOUT_REFUSED } from "./test/rule-helpers";

const DAY = 86_400;
const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const iso = (t: number) => new Date(t * 1000).toISOString().replace(".000", "");

export interface Night {
	readonly listed: number;
	readonly measured: number;
	readonly unsaved: number;
	readonly reads: Readonly<Record<string, number>>;
	readonly verification: Readonly<Record<string, number>>;
	readonly ledger: readonly { readonly id: string; readonly away: string; readonly home: string; readonly time: string; readonly outcome: string }[];
}

export function night(): Night {
	const games = new Map<string, { home: string; away: string; time: number }>();
	for (const e of INDEX) {
		if (e.seat !== 2 || e.status !== 200 || !/^\/games\?league=NCAAB&date=2026-11-0[234]/.test(e.path)) continue;
		for (const g of JSON.parse(new TextDecoder().decode(bytesOf(e.file))).results as Record<string, unknown>[]) {
			const r = toRecord("ncaab", g);
			if (r === null || r.time === null) continue;
			const [home, away] = [r.teams[0].names[0], r.teams[1].names[0]];
			if (home === undefined || away === undefined || resolveTeam("ncaab", home) === null || resolveTeam("ncaab", away) === null) continue;
			games.set(r.id, { home, away, time: r.time });
		}
	}
	const spare = [...games].map(([id, c]) => ({ id: `s4-${id}`, sport_key: "basketball_ncaab", commence_time: iso(c.time), completed: false, home_team: c.home, away_team: c.away, scores: null }));
	const send = (t: ReturnType<typeof saved>) => (q: HttpRequest) => {
		const at = locate(q);
		if (at?.seat === 4 && at.path.includes("basketball_ncaab")) return { status: 200, body: JSON.stringify(spare) };
		return t.send(q.url.includes("2026-11-01") ? { ...q, url: q.url.replace("2026-11-01", "2026-11-04") } : q);
	};
	const reads: Record<string, number> = {};
	const verification: Record<string, number> = {};
	const ledger: Night["ledger"][number][] = [];
	let unsaved = 0;
	for (const [id, c] of games) {
		const one = (seat: 1 | 2, game: Game, near?: number) => {
			const t = saved(undefined, MID);
			return { r: runSync(seat, readerFor(seat)({ game, now: MID, key: KEY, near }), send(t)), misses: t.misses };
		};
		const probe: Game = { league: "ncaab", home: c.home, away: c.away, start: c.time - DAY, n: 2 * DAY + 1, hints: [] };
		const win: Game = { league: "ncaab", home: c.home, away: c.away, start: c.time, n: DAY, hints: [] };
		const parts = [one(1, probe, c.time), one(2, probe, c.time), one(1, win), one(2, win)];
		const t = saved(undefined, MID);
		const o = scoreGameSync(
			{ id: "42", league: "ncaab", home: c.home, away: c.away, date: c.time, hints: [], n: DAY, day7: 7 * DAY, status: "unverified", start: null, startReadings: null, dispute: null, payoutRefused: PAYOUT_REFUSED },
			KEYS,
			PAYOUT,
			MID,
			send(t),
		);
		const outcome = t.misses.length > 0 || parts.some((p) => p.misses.length > 0) ? "not measured: a date never saved" : `${o.decision.action}: ${o.decision.why}`;
		ledger.push({ id, away: c.away, home: c.home, time: iso(c.time), outcome });
		if (outcome.startsWith("not measured")) {
			unsaved++;
			continue;
		}
		const tag = (x: (typeof parts)[number]) => (x.r.kind === "silent" ? x.r.detail : "reads");
		const k = `near the date ${tag(parts[0])}/${tag(parts[1])} | window ${tag(parts[2])}/${tag(parts[3])}`;
		reads[k] = (reads[k] ?? 0) + 1;
		verification[outcome] = (verification[outcome] ?? 0) + 1;
	}
	return { listed: games.size, measured: games.size - unsaved, unsaved, reads, verification, ledger };
}

if (import.meta.main) {
	const n = night();
	const { ledger, ...summary } = n;
	console.log(JSON.stringify(summary, null, 1));
	if (process.argv.includes("--ledger")) for (const g of ledger) console.log(`${g.id}\t${g.time}\t${g.away} at ${g.home}\t${g.outcome}`);
}
