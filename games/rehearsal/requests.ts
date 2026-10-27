// How many feed requests one run of the scoring program makes, per saved case: a verification (the
// game read as unverified, at its creation) and a scoring run (the verified game at the case's clock),
// each by seat. Measured against the per-execution quota of 15 confidential HTTP requests.
//
//   cd games && bun rehearsal/requests.ts

import { scoreGameSync } from "../../scoring/src/program";
import { SEATS } from "../../scoring/src/table";
import type { ChainGame } from "../../scoring/src/chain";
import type { HttpRequest, Seat } from "../../scoring/src/types";
import { CASES } from "../../scoring/test/cases";
import { KEY, saved } from "../../scoring/test/fixtures";
import { PAYOUT, PAYOUT_REFUSED, chainOf } from "../../scoring/test/rule-helpers";

const KEYS = { 1: KEY, 2: KEY, 3: KEY, 4: KEY };

function seatOf(req: HttpRequest): Seat {
	const host = new URL(req.url).host;
	const row = SEATS.find((r) => r.host === host);
	if (!row) throw new Error(`a host outside the table: ${host}`);
	return row.seat;
}

function run(game: ChainGame, now: number) {
	const t = saved(undefined, now);
	const bySeat: Record<Seat, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
	const out = scoreGameSync(game, KEYS, PAYOUT, now, (req) => {
		bySeat[seatOf(req)]++;
		return t.send(req);
	});
	return { total: t.asked.length, bySeat, action: out.decision.action, why: out.decision.why };
}

let maxVerify = 0;
let maxScore = 0;
for (const c of CASES) {
	const verified = chainOf(c.name, { payoutRefused: PAYOUT_REFUSED });
	const unverified: ChainGame = { ...verified, status: "unverified", start: null, startReadings: null, dispute: null };
	const v = run(unverified, c.now);
	const s = run(verified, c.now);
	maxVerify = Math.max(maxVerify, v.total);
	maxScore = Math.max(maxScore, s.total);
	const by = (r: typeof v) => `${r.bySeat[1]}/${r.bySeat[2]}/${r.bySeat[3]}/${r.bySeat[4]}`;
	console.log(`${c.name.slice(0, 48).padEnd(48)} | verify ${String(v.total).padStart(2)} (${by(v)}) ${v.action.padEnd(7)} | score ${String(s.total).padStart(2)} (${by(s)}) ${s.action.padEnd(7)} ${s.why}`);
}
console.log(`\nmost requests: verification ${maxVerify}, scoring ${maxScore}; ${CASES.length} cases`);
