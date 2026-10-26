// Every report the scoring program can send, each once, in one file for the games set's own tests:
// shapes/emitted.json. Each shape is a report the program built by its own decisions, from a game it
// could hold. None is written by hand.
//
//   bun shapes.ts           writes shapes/emitted.json, then prints the counts
//   bun shapes.ts --check   writes nothing, and exits 1 if the file isn't what the program sends now
//   bun shapes.ts --sweep   also runs the sweep of a disputed game, every fresh state beside every
//                           record a seat could hold (393,216 decisions), and checks that each
//                           disputed shape here is one of its shapes
//
// Where the shapes come from, each by the program's own functions:
//   verification   decideStart, then confirmStart (verify.ts), on what the readers can return near the
//                  creator's date, read again as scoring's first run will: a start.
//   no record      decideVerified (rule.ts), inside the window and after it: a score, the hour-24
//                  void, or the first dispute record.
//   disputed       decideDisputed (rule.ts), walked from every first record the runs above post: each
//                  update is written to the record the next run reads, and the clock runs from inside
//                  the window to after it to day 7. So every record a run reads here is one the
//                  program wrote. The sweep pairs each fresh state with every record a seat could hold,
//                  and no run writes some of those: four votes that agree, say, which would have scored
//                  instead. Its shapes from those are not the program's.
//
// The runs read as program.ts reads (readAll): the seat silent for the whole game reads silent, and so
// does every seat on the day-7 run, which asks none. A seat past its own window reads silent as well;
// that only takes answers away, and at the launch terms (n 24 hours, the day-7 clock seven days)
// every seat is still open for a while after the window (seat 4 to 66 hours from the start, seat 3 to
// five days), so it adds no shape. The program's tests pin both (never-day7.test.ts, dispute.test.ts).
//
// The states a seat can read: the sweep's four, and one more.
//   silent   the feed gives no answer about the game
//   none     an answer without a final: the game's own record, still on, at 27-20, final A's points,
//            as a game still on can carry them (the program never compares them)
//   absent   a listing that doesn't give the game: absent from it, or its record outside the window.
//            Seats 1, 2 and 4, which list by team; seat 3 reads its result by the hint. 0-0, since
//            the reader gives no points. A score or a void of a game with no record carries it as
//            read; every other report writes it silent.
//   A, B     the two finals, 27-20 and 20-27: the same points, swapped
// Two finals are the same exactly when both teams' points are, so two values stand for any two
// finals. A report with three or four different finals (only a dispute record, an update or a day-7
// void can carry one: a score has three the same) is not listed.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Decision, Report, ReportReading } from "./src/chain";
import type { BoardCheck } from "./src/readers/board3";
import { toReport } from "./src/report";
import { countingFor, decideDisputed, decideVerified, lastRecorded } from "./src/rule";
import { silent } from "./src/run";
import type { Game, Reading, Seat } from "./src/types";
import { confirmStart, decideStart, type Seen } from "./src/verify";
import { LIVE, PAYOUT, PAYOUT_REFUSED, POINTS, SEATS4, STATES, W, reading, reportReading, type State } from "./test/rule-helpers";

export const FILE = join(import.meta.dir, "shapes", "emitted.json");

/** When the run decided it. "hour 24" is the void of a game with no record, from start + n, as the games set names it. */
export type Clock = "verification" | "inside the window" | "after the window" | "hour 24" | "day 7";
/** The status the report meets on chain. */
export type Status = "unverified" | "verified" | "disputed";
/** What the report is: a dispute report on a game with no record is the first record; on a disputed game, an update. */
export type Made = "start" | "score" | "void" | "dispute record" | "update";
/** One reading as the report carries it: seat, kind (0 silent, 1 answered without a final, 2 final), home, away. */
export type Row = readonly [number, number, number, number];

/** One report shape: what the program sends, when, to which game, and why. */
export interface Shape {
	readonly clock: Clock;
	readonly game: Status;
	readonly decision: Made;
	/** The program's own reason, without the seat numbers an update names. */
	readonly why: string;
	/** The games set's ReportKind: 1 start, 2 score, 3 void, 4 dispute. */
	readonly kind: number;
	/** The report's own points: a score's; 0 on any other kind. */
	readonly home: number;
	readonly away: number;
	/** One per seat, in seat order. */
	readonly readings: readonly Row[];
}

const CLOCKS: readonly Clock[] = ["verification", "inside the window", "after the window", "hour 24", "day 7"];
const STATUSES: readonly Status[] = ["unverified", "verified", "disputed"];
const MADE: readonly Made[] = ["start", "score", "void", "dispute record", "update"];

type Phase = "inside" | "after" | "day7";

/** The reports a set of runs sent, each shape once. */
class Collected {
	readonly shapes = new Map<string, Shape>();
	/** The program's report for each decision met, built once: toReport checks the payout on every call. */
	private readonly reports = new Map<string, Report>();
	decisions = 0;

	/** Notes a run's decision; returns the readings its report carries, which a dispute report writes to the record. */
	add(at: "verification" | Phase, game: Status, d: Decision): ReportReading[] | null {
		this.decisions++;
		if (d.action === "wait") return null;
		const met = `${d.action}|${d.action === "score" ? `${d.home},${d.away}` : d.action === "start" ? d.start : ""}|${d.readings.map((r) => `${r.seat},${r.kind},${r.home},${r.away}`).join(";")}`;
		let report = this.reports.get(met);
		if (report === undefined) {
			const built = toReport("1", d, PAYOUT, PAYOUT_REFUSED);
			if (built === null) return null;
			report = built;
			this.reports.set(met, report);
		}
		const decision: Made = d.action === "dispute" ? (game === "verified" ? "dispute record" : "update") : d.action;
		const clock: Clock =
			at === "verification" ? "verification" : at === "day7" ? "day 7" : at === "inside" ? "inside the window" : decision === "void" ? "hour 24" : "after the window";
		const readings = report.readings.map((r): Row => [r.seat, r.kind, r.homeScore, r.awayScore]);
		const why = d.why.replace(/, at seat .*$/, "");
		const key = keyFor(clock, game, decision, report.kind, report.homeScore, report.awayScore, readings);
		const had = this.shapes.get(key);
		if (had === undefined) this.shapes.set(key, { clock, game, decision, why, kind: report.kind, home: report.homeScore, away: report.awayScore, readings });
		else if (had.why !== why) throw new Error(`one shape, two reasons: ${key}: "${had.why}" and "${why}"`);
		return [...report.readings];
	}

	sorted(): Shape[] {
		return [...this.shapes.values()].sort(order);
	}
}

/** A shape without its reason: what the games set sees, and when. */
function keyFor(clock: Clock, game: Status, decision: Made, kind: number, home: number, away: number, readings: readonly Row[]): string {
	return `${clock}|${game}|${decision}|${kind}|${home}|${away}|${readings.map((r) => r.join(",")).join(";")}`;
}

function keyOf(s: Shape): string {
	return keyFor(s.clock, s.game, s.decision, s.kind, s.home, s.away, s.readings);
}

function order(a: Shape, b: Shape): number {
	const by = [
		CLOCKS.indexOf(a.clock) - CLOCKS.indexOf(b.clock),
		STATUSES.indexOf(a.game) - STATUSES.indexOf(b.game),
		MADE.indexOf(a.decision) - MADE.indexOf(b.decision),
		a.home - b.home,
		a.away - b.away,
	];
	for (const d of by) if (d !== 0) return d;
	for (let i = 0; i < a.readings.length; i++) {
		for (let j = 0; j < 4; j++) {
			const d = a.readings[i][j] - b.readings[i][j];
			if (d !== 0) return d;
		}
	}
	return 0;
}

// ── A game with a start: no record, then disputed ──

type Fresh = State | "absent";

function freshReading(seat: Seat, s: Fresh): Reading {
	if (s === "absent") return { seat, kind: "no_final", home: null, away: null, recorded: null, detail: "absent", record: null };
	return reading(seat, s);
}

/** What a seat can read on a run, as readAll asks it. */
function freshStates(seat: Seat, down: Seat | null, phase: Phase): readonly Fresh[] {
	if (phase === "day7" || seat === down) return ["silent"];
	return seat === 3 ? ["silent", "none", "A", "B"] : ["silent", "none", "absent", "A", "B"];
}

function* runs(down: Seat | null, phase: Phase): Generator<Reading[]> {
	const [s1, s2, s3, s4] = SEATS4.map((s) => freshStates(s, down, phase));
	for (const a of s1) for (const b of s2) for (const c of s3) for (const d of s4) {
		yield [freshReading(1, a), freshReading(2, b), freshReading(3, c), freshReading(4, d)];
	}
}

/** The two games the table makes: seat 3 counting, and seat 3 silent for the whole game with the spare standing in. */
const GAMES: readonly (Seat | null)[] = [null, 3];

function scoring(out: Collected): number {
	let records = 0;
	for (const down of GAMES) {
		const counting = countingFor(down);
		const queued = new Set<string>();
		const queue: { readonly phase: Phase; readonly record: ReportReading[] }[] = [];
		const push = (phase: Phase, record: ReportReading[]): void => {
			const key = `${phase} ${record.map((r) => `${r.seat},${r.kind},${r.homeScore},${r.awayScore}`).join(";")}`;
			if (queued.has(key)) return;
			queued.add(key);
			queue.push({ phase, record });
		};
		for (const phase of ["inside", "after"] as const) {
			for (const fresh of runs(down, phase)) {
				const d = decideVerified(fresh, counting, phase === "inside", SEATS4, W);
				const written = out.add(phase, "verified", d);
				if (d.action === "dispute" && written !== null) push(phase, lastRecorded([written], SEATS4));
			}
		}
		// Each record the program wrote, at each clock it can be read at, until the game ends.
		for (let i = 0; i < queue.length; i++) {
			const { phase, record } = queue[i];
			if (phase === "inside") push("after", record);
			if (phase === "after") push("day7", record);
			for (const fresh of runs(down, phase)) {
				const d = decideDisputed(fresh, record, counting, phase === "inside", phase === "day7", SEATS4, down, W);
				const written = out.add(phase, "disputed", d);
				if (d.action === "dispute" && written !== null) push(phase, lastRecorded([record, written], SEATS4));
			}
		}
		records += queue.length;
	}
	return records;
}

// ── Verification ──

const DATE = 1_790_000_000;
const HOUR = 3_600;
const HINT = "00000000-0000-4000-8000-000000000003";

/** A seat read by team near the date. */
type Near = "silent" | "listed" | "later" | "absent" | "outside" | "final";
const NEAR: readonly Near[] = ["silent", "listed", "later", "absent", "outside", "final"];

function near(seat: Seat, s: Near): Reading {
	const record = (time: number) => ({ id: `r${seat}`, time });
	switch (s) {
		case "silent":
			return silent(seat, "silent");
		case "listed":
			return { seat, kind: "no_final", home: LIVE[0], away: LIVE[1], recorded: null, detail: "in progress", record: record(DATE) };
		case "later":
			return { seat, kind: "no_final", home: LIVE[0], away: LIVE[1], recorded: null, detail: "in progress", record: record(DATE + 2 * HOUR) };
		case "absent":
			return { seat, kind: "no_final", home: null, away: null, recorded: null, detail: "absent", record: null };
		case "outside":
			return { seat, kind: "no_final", home: null, away: null, recorded: null, detail: "outside window", record: record(DATE + 3 * 86_400) };
		case "final":
			return { seat, kind: "final", home: POINTS.A[0], away: POINTS.A[1], recorded: null, detail: "final", record: record(DATE) };
	}
}

type Board = "listed" | "later" | "fails" | "missing" | "silent";
const BOARDS: readonly Board[] = ["listed", "later", "fails", "missing", "silent"];

function board(s: Board): BoardCheck {
	switch (s) {
		case "listed":
			return { kind: "listed", id: HINT, time: DATE };
		case "later":
			return { kind: "listed", id: HINT, time: DATE + 2 * HOUR };
		case "fails":
			return { kind: "fails", why: "other teams" };
		case "missing":
			return { kind: "fails", why: "hint not on the board", missing: true };
		case "silent":
			return { kind: "silent", why: "unreadable" };
	}
}

/** Seat 3's result, read when the board no longer lists the hint. */
type Result = "nothing" | "on" | "final" | "failed";
const RESULTS: readonly Result[] = ["nothing", "on", "final", "failed"];

function result(s: Result): Reading {
	const record = { id: HINT, time: null };
	switch (s) {
		case "nothing":
			return silent(3, "no result for the hint");
		case "on":
			return { seat: 3, kind: "no_final", home: LIVE[0], away: LIVE[1], recorded: null, detail: "in progress", record };
		case "final":
			return { seat: 3, kind: "final", home: POINTS.A[0], away: POINTS.A[1], recorded: null, detail: "final", record };
		case "failed":
			return silent(3, "http 503");
	}
}

function verification(out: Collected): void {
	const hints = [{ seat: 3, id: HINT }];
	for (const a of NEAR) for (const b of NEAR) for (const c of BOARDS) for (const e of NEAR) {
		for (const r of c === "missing" ? RESULTS : [undefined]) {
			const base = { 1: near(1, a), 2: near(2, b), 3: board(c), 4: near(4, e) };
			const seen: Seen = r === undefined ? base : { ...base, result: result(r) };
			const chosen = decideStart({ date: DATE, hints }, seen);
			let d = chosen;
			if (chosen.action === "start") {
				// Read again as scoring's first run will: the same records, inside the window from the
				// start; seat 3 by its result when it counts, and not at all when it doesn't.
				const down = chosen.readings.find((x) => x.seat === 3)?.kind === "silent";
				const again = [seen[1], seen[2], down ? silent(3, "silent for the game") : result("on"), seen[4]];
				const game: Game = { league: "nba", home: "home", away: "away", start: chosen.start, n: 86_400, hints };
				d = confirmStart(chosen, game, again);
			}
			out.add("verification", "unverified", d);
		}
	}
}

// ── The file ──

export interface Emitted {
	readonly shapes: readonly Shape[];
	/** How many shapes, by clock, game and decision. */
	readonly counts: Readonly<Record<string, number>>;
	/** How many decisions the runs made, and how many records (each at each clock) the walk read. */
	readonly runs: { readonly verification: number; readonly scoring: number; readonly records: number };
}

export function emitted(): Emitted {
	const atVerification = new Collected();
	verification(atVerification);
	const atScoring = new Collected();
	const records = scoring(atScoring);
	const all = new Collected();
	for (const c of [atVerification, atScoring]) for (const [k, s] of c.shapes) all.shapes.set(k, s);
	const shapes = all.sorted();
	return { shapes, counts: countsOf(shapes), runs: { verification: atVerification.decisions, scoring: atScoring.decisions, records } };
}

export function countsOf(shapes: readonly Shape[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const s of shapes) {
		const k = `${s.clock}, ${s.game}, ${s.decision}`;
		counts[k] = (counts[k] ?? 0) + 1;
	}
	return { total: shapes.length, ...counts };
}

const ABOUT = [
	"Every report the scoring program can send, each once, built by the program's own decisions (scoring/shapes.ts), never by hand. Rebuild with `bun shapes.ts`; the suite fails while this file differs from what the program sends.",
	"kind: the games set's ReportKind (1 start, 2 score, 3 void, 4 dispute). home, away: the report's own points, a score's, 0 on any other kind.",
	"readings: one per seat in seat order, each [seat, kind, home, away]; kind is the games set's ReadingKind (0 silent, 1 answered without a final, 2 final).",
	"clock: when the run decided it. verification; inside the window, before start + n; after the window, from start + n; hour 24, the void of a game with no record, from start + n; day 7, from the first record plus the day-7 clock.",
	"game: the status the report meets: unverified, verified (no dispute record) or disputed. decision: start, score, void, dispute record (the first) or update (a later one). why: the program's own reason.",
	"Values: final A is 27-20 and final B 20-27. An answer without a final carries 27-20, as a game still on can; a reading the program builds without points (seat 3's board row, a listing that doesn't give the game) carries 0-0. The program never compares an answer's points unless both are finals, so these stand for any others.",
	"Not listed: a report with three or four different finals (only a dispute record, an update or a day-7 void can carry one). Not part of a shape: the game id, the start (a start's is the earliest counting seat's listed time, within a day of the date), and the payout (the zero address on a start and a dispute report). At the launch terms: n 24 hours, the day-7 clock seven days.",
];

export function render(e: Emitted): string {
	const lines = e.shapes.map((s) => `    ${JSON.stringify(s)}`);
	return [
		"{",
		`  "about": ${JSON.stringify(ABOUT, null, 2).replace(/\n/g, "\n  ")},`,
		`  "counts": ${JSON.stringify(e.counts, null, 2).replace(/\n/g, "\n  ")},`,
		`  "shapes": [`,
		lines.join(",\n"),
		"  ]",
		"}",
		"",
	].join("\n");
}

// ── The sweep, for --sweep ──

function sweep(): Collected {
	const out = new Collected();
	const pairs: [State, State][] = [];
	for (const f of STATES) for (const r of STATES) pairs.push([f, r]);
	for (const down of GAMES) {
		const counting = countingFor(down);
		for (const phase of ["inside", "after", "day7"] as const) {
			for (const p1 of pairs) for (const p2 of pairs) for (const p3 of pairs) for (const p4 of pairs) {
				const ps = [p1, p2, p3, p4];
				const fresh = SEATS4.map((s, i) => reading(s, ps[i][0]));
				const recorded = SEATS4.map((s, i) => reportReading(s, ps[i][1]));
				out.add(phase, "disputed", decideDisputed(fresh, recorded, counting, phase === "inside", phase === "day7", SEATS4, down, W));
			}
		}
	}
	return out;
}

if (import.meta.main) {
	const e = emitted();
	const text = render(e);
	if (process.argv.includes("--check")) {
		const on = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
		if (on !== text) {
			console.error(`${FILE} is not what the program sends now: run \`bun shapes.ts\``);
			process.exit(1);
		}
	} else {
		writeFileSync(FILE, text);
	}
	console.log(JSON.stringify({ runs: e.runs, counts: e.counts }, null, 1));
	if (process.argv.includes("--sweep")) {
		const s = sweep();
		const walked = e.shapes.filter((x) => x.game === "disputed");
		const missing = walked.filter((x) => !s.shapes.has(keyOf(x)));
		const walkedKeys = new Set(walked.map(keyOf));
		const sweepOnly = [...s.shapes.values()].filter((x) => !walkedKeys.has(keyOf(x)));
		console.log(
			JSON.stringify(
				{
					sweep: { decisions: s.decisions, shapes: s.shapes.size },
					walked: walked.length,
					walkedNotInSweep: missing.length,
					sweepOnly: sweepOnly.length,
					sweepOnlyByClock: countsOf(sweepOnly),
					examples: sweepOnly.slice(0, 3),
				},
				null,
				1,
			),
		);
		if (missing.length > 0) process.exit(1);
	}
}
