// The program on every saved case, each at its own clock, from the saved answers only, with the game
// as the chain holds it once verified (test/rule-helpers.ts, chainOf). No key and no network.
// Verification isn't probed here: its range reaches a day before each game, and the saved answers
// weren't captured for those dates; its tests derive what they need.
//
//   bun probe.ts            one line per case, then the counts
//   bun probe.ts --json     the same as JSON
//
// Two requests the cases ask for were never captured, so no answer as of the case's clock exists:
// seat 1 for hockey and for college football on 21 Oct, as of 03:32 on 23 Oct. Seat 1's plan refused
// both leagues until that afternoon, and its first answers there were saved at 19:15 and 19:16. They
// are listed below and served as a transport failure, which reads seat 1 silent; the output names
// each one as "not captured". Any other request with no saved answer is a gap in the probe, not an
// answer, so the probe stops with an error rather than read it as silent.

import { scoreGameSync } from "./src/program";
import type { HttpRequest, HttpResponse } from "./src/types";
import { CASES, LATE } from "./test/cases";
import { KEY, saved } from "./test/fixtures";
import { PAYOUT, chainOf } from "./test/rule-helpers";

/** Requests a case asks for that were never captured, by seat, path and the clock they are asked as of. */
export const NOT_CAPTURED: readonly { readonly seat: number; readonly path: string; readonly asOf: number; readonly why: string }[] = [
	{ seat: 1, path: "/nhl/v1/games?dates[]=2026-10-21&per_page=100", asOf: LATE, why: "seat 1's plan refused hockey until 23 Oct, 19:15" },
	{ seat: 1, path: "/ncaaf/v1/games?dates[]=2026-10-21&per_page=100", asOf: LATE, why: "seat 1's plan refused college football until 23 Oct, 19:16" },
];

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };
const iso = (t: number) => new Date(t * 1000).toISOString().replace(":00.000Z", "Z");

export interface Row {
	readonly name: string;
	readonly now: string;
	readonly window: "before" | "inside n" | "after n";
	readonly action: string;
	readonly why: string;
	readonly score: string | null;
	readonly notCaptured: readonly string[];
}

const listed = (miss: string, now: number) => NOT_CAPTURED.find((n) => miss === `seat ${n.seat} ${n.path}` && n.asOf === now);

/** Runs one game at one clock. Throws on a request with no saved answer that isn't listed above. */
function runAt(game: ReturnType<typeof chainOf>, now: number) {
	const t = saved(undefined, now);
	const notCaptured: string[] = [];
	const send = (req: HttpRequest): HttpResponse => {
		try {
			return t.send(req);
		} catch (e) {
			const n = listed(t.misses.at(-1) ?? "", now);
			if (n !== undefined) notCaptured.push(`seat ${n.seat} ${n.path}: not captured (${n.why})`);
			throw e;
		}
	};
	const o = scoreGameSync(game, KEYS, PAYOUT, now, send);
	// A transport failure inside a reader reads that seat silent, so an unlisted miss would be read as
	// silent too: the probe checks the misses itself after the run.
	const unlisted = t.misses.filter((m) => listed(m, now) === undefined);
	if (unlisted.length > 0) throw new Error(`probe: no saved answer for ${unlisted.join(", ")} as of ${iso(now)}`);
	return { o, notCaptured: [...new Set(notCaptured)] };
}

export function probe(): Row[] {
	return CASES.map((c) => {
		const v = runAt(chainOf(c.name), c.now);
		const d = v.o.decision;
		return {
			name: c.name,
			now: iso(c.now),
			window: c.now >= c.game.start + c.game.n ? "after n" : c.now >= c.game.start ? "inside n" : "before",
			action: d.action,
			why: d.why,
			score: d.action === "score" ? `${d.home}-${d.away}` : null,
			notCaptured: v.notCaptured,
		};
	});
}

if (import.meta.main) {
	const rows = probe();
	const actions: Record<string, number> = {};
	for (const r of rows) actions[r.action] = (actions[r.action] ?? 0) + 1;
	const summary = { cases: rows.length, ...actions, notCaptured: rows.flatMap((r) => r.notCaptured).length };
	if (process.argv.includes("--json")) console.log(JSON.stringify({ summary, rows }, null, 1));
	else {
		for (const r of rows) {
			console.log(`${r.name}`);
			console.log(`    at ${r.now} (${r.window}): ${r.action}${r.score ? ` ${r.score}` : ""} | ${r.why}`);
			for (const n of r.notCaptured) console.log(`    ${n}`);
		}
		console.log(JSON.stringify(summary));
	}
}
