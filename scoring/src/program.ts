// One run of the scoring program for one game: read what the game's state calls for, decide by the
// rule, and build the report. Everything it takes from outside is handed in here: the game (read
// from the chain), the run's clock, a transport, each seat's key and the payout address. Which
// seats are asked, which of them count and how many must agree all come from the table and the
// rule, inside the fingerprint. The clock picks inside n or after, so it must be the chain's time
// (see rule.ts); a clock that is not a whole, positive, safe number of seconds decides nothing.
//
// A key decides only whether the run can read at all. A seat whose key is missing, or isn't text a
// request can carry as given (keys.ts), decides nothing, before any request is sent, and so does a
// seat whose feed refuses its key (an answer of 400, 401, 402, 403 or 429), the moment that answer
// comes back. A login problem makes the program say nothing; it never makes a feed silent, so it
// never decides on fewer seats. A seat the run never asks needs no key: seat 3 for a game created
// without a usable seat 3 hint, or once the start report shows it silent for the game; a closed seat
// (rule.ts, OPEN_FOR); and every seat on a disputed game's day-7 run, when every seat is closed.
//
//   unverified   the start's rule (verify.ts): seats 1, 2 and 4 read by team near the creator's
//                date, seat 3's board checked against its hint (and its result read when the board
//                no longer lists the hint), then every seat read again as scoring's first run will.
//   verified     from the start: every open seat read in the game's window, and
//                the agreement rule (rule.ts) at the run's hour, inside n or after.
//   disputed     a record, not a lock: every open seat read on every run, and the
//                game decided on every seat's vote (rule.ts, decideDisputed): a score the moment the
//                votes agree, an update when a vote changes, and from the first record's day-7 clock,
//                day 7, which asks no seat.
//   an end       nothing: a scored, voided or released game takes no report.
//
// The run is written once, as a plan that yields one seat's reading at a time, and driven by a
// synchronous transport (the Chainlink workflow's) or an asynchronous one (a sealed machine's
// fetch). A transport that throws makes that seat silent, never the run's decision.

import { READING_KIND, type ChainGame, type Decision, type Report, type ReportReading } from "./chain";
import { readerFor, seatsFor } from "./index";
import { keyFor, type Keys } from "./keys";
import { checkBoard, type BoardCheck, type BoardRun } from "./readers/board3";
import { hintOf } from "./readers/seat3";
import { toReport } from "./report";
import { OPEN_FOR, answersOf, countingFor, decide, decideDisputed, lastRecorded, silentForGame } from "./rule";
import { MAX_REQUESTS, runAsync, runSync, silent } from "./run";
import { leagueRow } from "./table";
import type { Game, HttpRequest, HttpResponse, Reading, ReaderRun, Seat } from "./types";
import { START_BOUND, confirmStart, decideStart } from "./verify";
import type { Window } from "./window";

/** One step of a run: read one seat, or check seat 3's board. */
type Job = { readonly kind: "read"; readonly seat: Seat; readonly run: ReaderRun } | { readonly kind: "board"; readonly run: BoardRun };
type Done = Reading | BoardCheck;
type Plan = Generator<Job, Decision, Done>;

/** The key of every seat the run may ask, once each is known to be there. */
type Held = Readonly<Partial<Record<Seat, string>>>;

/** What a run decided, and the report it writes: null when it writes nothing. */
export interface Outcome {
	readonly decision: Decision;
	readonly report: Report | null;
}

const ENDED = new Set(["scored", "voided", "released"]);

/**
 * The answers that say a feed refused the key: a malformed request (a key the feed won't parse),
 * unauthorised, payment required (the key's plan), forbidden, and over the key's quota.
 */
const REFUSED: ReadonlySet<number> = new Set([400, 401, 402, 403, 429]);

function nothing(why: string): Decision {
	return { action: "wait", readings: [], why };
}

function wholeSeconds(v: unknown): v is number {
	return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/** Each asked seat's key, or the first seat without one. */
function held(keys: Keys, seats: readonly Seat[]): Held | Seat {
	const out: Partial<Record<Seat, string>> = {};
	for (const seat of seats) {
		const key = keyFor(keys, seat);
		if (key === null) return seat;
		out[seat] = key;
	}
	return out;
}

/** The key for a seat the run asks. A seat asked without one would be a fault here: it is never read silent. */
function keyOf(keys: Held, seat: Seat): string {
	const key = keys[seat];
	if (key === undefined) throw new Error(`seat ${seat} is asked without its key`);
	return key;
}

/**
 * A start report this program could have written: one reading per seat of the table, in seat
 * order, each of the three kinds, with seats 1 and 2 answering (verification writes nothing
 * unless both list the game). Anything else, an empty list included, decides nothing: which seats
 * count rests on it.
 */
function startReportReadable(readings: readonly ReportReading[] | null, seats: readonly Seat[]): boolean {
	if (readings === null || !inSeatOrder(readings, seats)) return false;
	const answers = (seat: Seat) => readings.find((r) => r.seat === seat)?.kind !== READING_KIND.silent;
	return answers(1) && answers(2);
}

/** One reading per seat of the table, in seat order, each of the three kinds: a report this program could have written. */
function inSeatOrder(readings: readonly ReportReading[], seats: readonly Seat[]): boolean {
	if (!Array.isArray(readings) || readings.length !== seats.length) return false;
	const kinds: readonly number[] = Object.values(READING_KIND);
	for (let i = 0; i < seats.length; i++) {
		if (readings[i].seat !== seats[i] || !kinds.includes(readings[i].kind)) return false;
	}
	return true;
}

/**
 * Why the program doesn't ask a seat about a game on this run, or null when it does. It never asks
 * the seat silent for the whole game, and it never asks a closed seat: one whose window from the start
 * has passed (rule.ts, OPEN_FOR) and, for a disputed game, every seat from the day-7 clock
 * (`day7At`). A closed seat keeps its vote, and nothing it says later is read.
 */
function notAsked(seat: Seat, start: number, now: number, down: Seat | null, day7At: number | null): string | null {
	if (seat === down) return "silent for the game";
	if (day7At !== null && now >= day7At) return "closed: day 7";
	const window = OPEN_FOR[seat];
	if (window !== null && now - start > window) return "closed: past its window";
	return null;
}

/** Whether this run may ask a seat, which is all a seat's key is needed for. */
function mayAsk(game: ChainGame, seat: Seat, now: number): boolean {
	if (game.status === "unverified") return seat !== 3 || !("none" in hintOf(game.hints));
	// A run with no start to read from asks nothing: it stops at "no start on chain".
	if (game.start === null || !wholeSeconds(game.start)) return true;
	const record = game.status === "disputed" ? game.dispute : null;
	const day7At = record !== null && wholeSeconds(record.at) ? record.at + game.day7 : null;
	return notAsked(seat, game.start, now, silentForGame(game), day7At) === null;
}

function* plan(game: ChainGame, keys: Keys, now: number): Plan {
	if (leagueRow(game.league) === null) return nothing("league not offered");
	if (ENDED.has(game.status)) return nothing("the game has ended");
	if (!wholeSeconds(game.date) || !wholeSeconds(game.n) || !wholeSeconds(game.day7) || !wholeSeconds(now)) {
		return nothing("the game's clocks are not readable");
	}
	const seats = seatsFor(game.league);
	// A seat this run never asks needs no key: its key can hide nothing, since it is never read.
	const k = held(keys, seats.filter((s) => mayAsk(game, s, now)));
	if (typeof k === "number") return nothing(`seat ${k} has no key`);

	if (game.status === "unverified") return yield* verifying(game, k, now);

	const start = game.start;
	if (start === null || !wholeSeconds(start)) return nothing("no start on chain");
	// Which seats count rests on the start report's readings; without them, nothing is decided.
	if (!startReportReadable(game.startReadings, seats)) return nothing("no start report on chain");
	const down = silentForGame(game);
	const w: Window = { from: start, to: start + game.n };

	if (game.status === "verified") {
		if (now < start) return nothing("before the start");
		const readings = yield* readAll(game, start, k, now, (s) => notAsked(s, start, now, down, null));
		const d = decide(readings, countingFor(down), now < start + game.n);
		// The first record is each seat's first vote: a seat that gave no answer about the game is silent on it.
		return d.action === "dispute" ? { ...d, readings: answersOf(readings, seats, w) } : d;
	}

	// Disputed: a record, not a lock. Every open seat is read on every run until the votes agree, or
	// day 7, when every seat is closed and no seat is asked.
	const record = game.dispute;
	if (record === null || !wholeSeconds(record.at)) return nothing("no dispute record on chain");
	if (record.records.length === 0 || !record.records.every((r) => inSeatOrder(r, seats))) return nothing("no dispute record on chain");
	const day7At = record.at + game.day7;
	const fresh = yield* readAll(game, start, k, now, (s) => notAsked(s, start, now, down, day7At));
	const recorded = lastRecorded(record.records, seats);
	return decideDisputed(fresh, recorded, countingFor(down), now < start + game.n, now >= day7At, seats, down, w);
}

/**
 * Every seat in the table, in seat order, read in the game's window: four readings, always ("the
 * program always asks four feeds"). A seat the run doesn't ask (`skip` says why) reads silent
 * without a request: the seat silent for the game, as the seat 3 reader already is for a game
 * created without a hint, so a final it might give for a hint that failed verification can never
 * count; and a closed seat.
 */
function* readAll(game: ChainGame, start: number, keys: Held, now: number, skip: (seat: Seat) => string | null): Generator<Job, Reading[], Done> {
	const g: Game = { league: game.league, home: game.home, away: game.away, start, n: game.n, hints: game.hints };
	const out: Reading[] = [];
	for (const seat of seatsFor(game.league)) {
		const why = skip(seat);
		if (why !== null) {
			out.push(silent(seat, why));
			continue;
		}
		out.push((yield { kind: "read", seat, run: readerFor(seat)({ game: g, now, key: keyOf(keys, seat) }) }) as Reading);
	}
	return out;
}

/**
 * Verification. Seats 1, 2 and 4 are read by team within a day of the date, nearest it, without
 * their hints: the date names the game, and decideStart holds each seat's hint to that record.
 * Seat 3's board is checked against its hint, the board's horizon being the later of the game's own
 * times at seats 1 and 2 when both list it; a hint the board no longer lists is read by its result before
 * seat 3 stands down, since the board drops a finished game. If that gives a start, every seat is
 * read again as scoring's first run will read it, and confirmStart writes the start only if that
 * read agrees.
 */
function* verifying(game: ChainGame, keys: Held, now: number): Plan {
	// The range the games set accepts a start in: [date - START_BOUND, date + START_BOUND], both ends in.
	const range = { league: game.league, home: game.home, away: game.away, start: game.date - START_BOUND, n: 2 * START_BOUND + 1 };
	const byTeamProbe: Game = { ...range, hints: [] };
	const byTeam = function* (seat: Seat): Generator<Job, Reading, Done> {
		return (yield { kind: "read", seat, run: readerFor(seat)({ game: byTeamProbe, now, key: keyOf(keys, seat), near: game.date }) }) as Reading;
	};
	const r1 = yield* byTeam(1);
	const r2 = yield* byTeam(2);
	// The time the board must reach before a hint missing from it fails: the game's own time at seats 1
	// and 2, the later of the two, when both list it; otherwise the creator's date. Short of the later
	// one, the board may not yet have posted the game, listed beside its later time.
	const t1 = r1.kind === "silent" ? null : (r1.record?.time ?? null);
	const t2 = r2.kind === "silent" ? null : (r2.record?.time ?? null);
	const horizon = t1 !== null && t2 !== null ? Math.max(t1, t2) : game.date;
	let board: BoardCheck;
	const hint = hintOf(game.hints);
	if ("none" in hint) board = { kind: "fails", why: hint.none };
	else board = (yield { kind: "board", run: checkBoard({ game: { ...range, hints: game.hints }, now, key: keyOf(keys, 3), near: horizon }) }) as BoardCheck;
	// The board drops a finished game: before a hint missing from it stands seat 3 down, seat 3's
	// result for the hint says whether the game is already over (verify.ts).
	const result =
		board.kind === "fails" && board.missing === true
			? ((yield { kind: "read", seat: 3, run: readerFor(3)({ game: { ...range, hints: game.hints }, now, key: keyOf(keys, 3) }) }) as Reading)
			: undefined;
	const r4 = yield* byTeam(4);
	const chosen = decideStart({ date: game.date, hints: game.hints }, { 1: r1, 2: r2, 3: board, 4: r4, result });
	if (chosen.action !== "start") return chosen;

	// Read as scoring's first run will: every seat, in the window from the start chosen, with the hints
	// and without the date; seat 3 by its result when it counts, and not at all when it doesn't.
	const g: Game = { league: game.league, home: game.home, away: game.away, start: chosen.start, n: game.n, hints: game.hints };
	const down: Seat | null = chosen.readings.find((r) => r.seat === 3)?.kind === "silent" ? 3 : null;
	const again = yield* readAll(game, chosen.start, keys, now, (s) => notAsked(s, chosen.start, now, down, null));
	return confirmStart(chosen, g, again);
}

/** The transport for one job, noting the first answer that refuses the key. */
function watched<T extends HttpResponse | Promise<HttpResponse>>(send: (req: HttpRequest) => T): { send: (req: HttpRequest) => T; refused: () => number | null } {
	let refused: number | null = null;
	const note = (res: HttpResponse): HttpResponse => {
		if (refused === null && REFUSED.has(res.status)) refused = res.status;
		return res;
	};
	return {
		send: (req) => {
			const res = send(req);
			return (res instanceof Promise ? res.then(note) : note(res)) as T;
		},
		refused: () => refused,
	};
}

function seatOf(job: Job): Seat {
	return job.kind === "read" ? job.seat : 3;
}

function refusedKey(job: Job, status: number): Outcome {
	return { decision: nothing(`seat ${seatOf(job)}'s key was refused: http ${status}`), report: null };
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
		const t = watched(send);
		const done = job.kind === "read" ? runSync(job.seat, job.run, t.send) : boardSync(job.run, t.send);
		const status = t.refused();
		if (status !== null) return refusedKey(job, status);
		step = p.next(done);
	}
	return { decision: step.value, report: toReport(game.id, step.value, payout, game.payoutRefused) };
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
		const t = watched(send);
		const done = job.kind === "read" ? await runAsync(job.seat, job.run, t.send) : await boardAsync(job.run, t.send);
		const status = t.refused();
		if (status !== null) return refusedKey(job, status);
		step = p.next(done);
	}
	return { decision: step.value, report: toReport(game.id, step.value, payout, game.payoutRefused) };
}
