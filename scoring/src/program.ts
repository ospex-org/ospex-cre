// One run of the scoring program for one game: read what the game's state calls for, decide by the
// rule, and build the report. Everything it takes from outside is handed in here: the game (read
// from the chain), the run's clock, a transport, each seat's key and the payout address. Which
// seats are asked, which of them count and how many must agree all come from the table and the
// rule, inside the fingerprint.
//
//   unverified   the start's rule (verify.ts): seats 1, 2 and 4 read by team near the creator's
//                date, seat 3's board checked against its hint.
//   verified     from the start: every seat read in the game's window, and the agreement rule
//                (rule.ts) at the run's hour, inside n or after.
//   disputed     from the dispute record's day-7 clock: every seat read fresh, and the day-7 rule.
//   an end       nothing: a scored, voided or released game takes no report.
//
// The run is written once, as a plan that yields one seat's reading at a time, and driven by a
// synchronous transport (the Chainlink workflow's) or an asynchronous one (a sealed machine's
// fetch). A transport that throws makes that seat silent, never the run's decision.

import type { ChainGame, Decision, Report } from "./chain";
import { readerFor, seatsFor } from "./index";
import { keyFor, type Keys } from "./keys";
import { checkBoard, type BoardCheck, type BoardRun } from "./readers/board3";
import { hintOf } from "./readers/seat3";
import { toReport } from "./report";
import { countingFor, decide, decideDay7, silentForGame } from "./rule";
import { MAX_REQUESTS, runAsync, runSync, silent } from "./run";
import { leagueRow } from "./table";
import type { Game, HttpRequest, HttpResponse, Reading, ReaderRun, Seat } from "./types";
import { decideStart } from "./verify";

/** One step of a run: read one seat, or check seat 3's board. */
type Job = { readonly kind: "read"; readonly seat: Seat; readonly run: ReaderRun } | { readonly kind: "board"; readonly run: BoardRun };
type Done = Reading | BoardCheck;
type Plan = Generator<Job, Decision, Done>;

/** What a run decided, and the report it writes: null when it writes nothing. */
export interface Outcome {
	readonly decision: Decision;
	readonly report: Report | null;
}

const ENDED = new Set(["scored", "voided", "released"]);

function nothing(why: string): Decision {
	return { action: "wait", readings: [], why };
}

function wholeSeconds(v: unknown): v is number {
	return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

function* plan(game: ChainGame, keys: Keys, now: number): Plan {
	if (leagueRow(game.league) === null) return nothing("league not offered");
	if (ENDED.has(game.status)) return nothing("the game has ended");
	if (!wholeSeconds(game.date) || !wholeSeconds(game.n) || !wholeSeconds(game.day7) || !wholeSeconds(now)) {
		return nothing("the game's clocks are not readable");
	}

	if (game.status === "unverified") return yield* verifying(game, keys, now);

	const start = game.start;
	if (start === null || !wholeSeconds(start)) return nothing("no start on chain");
	const down = silentForGame(game);

	if (game.status === "verified") {
		if (now < start) return nothing("before the start");
		const readings = yield* readAll(game, start, keys, now, down);
		return decide(readings, countingFor(down), now < start + game.n);
	}

	// Disputed.
	const record = game.dispute;
	if (record === null || !wholeSeconds(record.at)) return nothing("no dispute record on chain");
	if (now < record.at + game.day7) return nothing("before day 7");
	const fresh = yield* readAll(game, start, keys, now, down);
	return decideDay7(fresh, record.readings, seatsFor(game.league));
}

/** Every seat in the table, in seat order, read in the game's window. A seat silent for the game is not asked. */
function* readAll(game: ChainGame, start: number, keys: Keys, now: number, down: Seat | null): Generator<Job, Reading[], Done> {
	const g: Game = { league: game.league, home: game.home, away: game.away, start, n: game.n, hints: game.hints };
	const out: Reading[] = [];
	for (const seat of seatsFor(game.league)) {
		if (seat === down) {
			out.push(silent(seat, "silent for the game"));
			continue;
		}
		const key = keyFor(keys, seat);
		if (key === null) {
			out.push(silent(seat, "no key"));
			continue;
		}
		out.push((yield { kind: "read", seat, run: readerFor(seat)({ game: g, now, key }) }) as Reading);
	}
	return out;
}

/** Verification: seats 1, 2 and 4 read by team within n of the date, nearest it; seat 3's board checked. */
function* verifying(game: ChainGame, keys: Keys, now: number): Plan {
	// The range the games set accepts a start in: [date - n, date + n], both ends in.
	const probe: Game = { league: game.league, home: game.home, away: game.away, start: game.date - game.n, n: 2 * game.n + 1, hints: game.hints };
	const byTeam = function* (seat: Seat): Generator<Job, Reading, Done> {
		const key = keyFor(keys, seat);
		if (key === null) return silent(seat, "no key");
		return (yield { kind: "read", seat, run: readerFor(seat)({ game: probe, now, key, near: game.date }) }) as Reading;
	};
	const r1 = yield* byTeam(1);
	const r2 = yield* byTeam(2);
	let board: BoardCheck;
	const hint = hintOf(game.hints);
	const key3 = keyFor(keys, 3);
	if ("none" in hint) board = { kind: "fails", why: hint.none };
	else if (key3 === null) board = { kind: "silent", why: "no key" };
	else board = (yield { kind: "board", run: checkBoard({ game: probe, now, key: key3 }) }) as BoardCheck;
	const r4 = yield* byTeam(4);
	return decideStart({ date: game.date, n: game.n }, { 1: r1, 2: r2, 3: board, 4: r4 });
}

function boardSync(run: BoardRun, send: (req: HttpRequest) => HttpResponse): BoardCheck {
	let step: IteratorResult<HttpRequest, BoardCheck>;
	try {
		step = run.next(undefined as unknown as HttpResponse);
		for (let asked = 0; !step.done; asked++) {
			if (asked >= MAX_REQUESTS) return { kind: "silent", why: "request bound" };
			step = run.next(send(step.value));
		}
	} catch {
		return { kind: "silent", why: "transport" };
	}
	return step.value;
}

async function boardAsync(run: BoardRun, send: (req: HttpRequest) => Promise<HttpResponse>): Promise<BoardCheck> {
	let step: IteratorResult<HttpRequest, BoardCheck>;
	try {
		step = run.next(undefined as unknown as HttpResponse);
		for (let asked = 0; !step.done; asked++) {
			if (asked >= MAX_REQUESTS) return { kind: "silent", why: "request bound" };
			step = run.next(await send(step.value));
		}
	} catch {
		return { kind: "silent", why: "transport" };
	}
	return step.value;
}

/** Decides one game with a synchronous transport (the Chainlink workflow's), and builds its report. */
export function scoreGameSync(
	game: ChainGame,
	keys: Keys,
	payout: string,
	now: number,
	send: (req: HttpRequest) => HttpResponse,
): Outcome {
	const p = plan(game, keys, now);
	let step = p.next(undefined as unknown as Done);
	while (!step.done) {
		const job = step.value;
		step = p.next(job.kind === "read" ? runSync(job.seat, job.run, send) : boardSync(job.run, send));
	}
	return { decision: step.value, report: toReport(game.id, step.value, payout) };
}

/** Decides one game with an asynchronous transport (a sealed machine's fetch), and builds its report. */
export async function scoreGameAsync(
	game: ChainGame,
	keys: Keys,
	payout: string,
	now: number,
	send: (req: HttpRequest) => Promise<HttpResponse>,
): Promise<Outcome> {
	const p = plan(game, keys, now);
	let step = p.next(undefined as unknown as Done);
	while (!step.done) {
		const job = step.value;
		step = p.next(job.kind === "read" ? await runAsync(job.seat, job.run, send) : await boardAsync(job.run, send));
	}
	return { decision: step.value, report: toReport(game.id, step.value, payout) };
}
