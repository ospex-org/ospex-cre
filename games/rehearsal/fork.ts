// The fork delivery: the wrapper's runs, decided by the scoring program on saved feed answers, written
// through the production forwarder's own bytecode on a fork of Polygon, into the games set as the
// deploy script deploys it. The receipt of every delivery is the game's state, never the transaction.
//
// Run with an anvil fork up (see README.md), the contracts compiled, and the rehearsal's workflow id
// computed by build/fingerprint.ts for the predicted addresses:
//   REHEARSAL_WORKFLOW_JSON=<path> bun rehearsal/fork.ts
//
// What it does, in order: configures the forwarder with a rehearsal signer set (its owner impersonated),
// deploys the reporter and the games set at the predicted addresses, creates five games, verifies two
// through the program and three by hand, scores the college game inside n (a retry first), disputes the
// basketball and hockey games and runs their updates and their day-7 results, holds the NFL game at hour
// 24 on its pre-game answers and scores it on the answers read after the game, voids the MLB game after
// n (the saved case, moved 133 days: see "The MLB case, moved"), and delivers the carried cases: a
// refused report, a retry, a stale and an out-of-order report, and destination separation. Every step
// asserts the game's state.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createPublicClient,
	createTestClient,
	createWalletClient,
	decodeEventLog,
	encodeAbiParameters,
	encodeFunctionData,
	http,
	keccak256,
	parseAbi,
	stringToHex,
	type Address,
	type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { scoreGameSync } from "../../scoring/src/program";
import { SEATS } from "../../scoring/src/table";
import type { HttpRequest, HttpResponse, Reading } from "../../scoring/src/types";
import { CASES } from "../../scoring/test/cases";
import { KEY, saved, type Derive } from "../../scoring/test/fixtures";
import { PAYOUT as CASE_PAYOUT, PAYOUT_REFUSED, chainOf } from "../../scoring/test/rule-helpers";
import { gameOfCreation, gameOfState, readIdentity, readOpenGames, readReadings, readReporters } from "../chain";
import { GAME_CREATED, GAME_CREATED_TOPIC, GAME_REPORTED, decodeGameCreated, encodeReport, keysFor, type Creation } from "../lib";
import { runGame, type Run } from "../run";
import { CONTEXT, FORWARDER, FORWARDER_ABI, metadataOf, rawReportOf, signaturesOf } from "./forwarder";
import { gameFromLogs } from "./logs";
import { evmOverRpc } from "./rpc";

// ──────────────────────────── The fork and its accounts ────────────────

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8547";
const HERE = import.meta.dir;
const CONTRACTS_OUT = process.env.CONTRACTS_OUT ?? join(HERE, "..", "..", "..", "ospex-foundry-matched-pairs", "out");
const WORKFLOW_JSON = process.env.REHEARSAL_WORKFLOW_JSON;
if (!WORKFLOW_JSON) throw new Error("REHEARSAL_WORKFLOW_JSON: the fingerprint's --json output for the predicted addresses");
const TRANSCRIPT = process.env.REHEARSAL_TRANSCRIPT ?? join(HERE, "transcript.txt");
/**
 * How a run reads a game past its creation. "state": the workflow's own reads (chain.ts, as the tick's full
 * read takes them), now that the games set stores the game. "events": the event stand-in (logs.ts) the
 * rehearsal used against a games set that stored nothing, kept to compare. A start is read as the creation
 * handler reads it, from its trigger's event, under either.
 */
const READS = process.env.REHEARSAL_READS ?? "state";
if (READS !== "state" && READS !== "events") throw new Error(`REHEARSAL_READS: "state" or "events", not ${READS}`);

/** anvil's default accounts, by index. Test keys, public since hardhat. */
const KEYS: readonly Hex[] = [
	"0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
	"0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
	"0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
	"0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
	"0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
	"0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
	"0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
	"0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
	"0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
	"0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
];
const account = (i: number) => privateKeyToAccount(KEYS[i]);
const DEPLOYER = account(0);
const OWNER = account(1);
const PAYOUT = account(2);
const CREATOR = account(3);
const TRANSMITTER = account(4);
const SIGNERS = [5, 6, 7, 8].map(account);
const SIGNING_KEYS = [KEYS[5], KEYS[6]];

/** Polygon's fixed addresses, as the deploy script holds them. */
const TIMELOCK: Address = "0x8CED8e82cf1488B7365C0726aEeD795b6C07582C";
const USDC: Address = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
/** A holder of the coin at the fork block: the operator's working wallet. */
const HOLDER: Address = "0x16Dc5D67D080a5521ef2c79680dBfC2aBf724D30";

const DON_ID = 7777;
const CONFIG_VERSION = 1;
const NAME = "osgames";
const FEE = 1_000_000n;
const LAUNCH_TERMS = { window: 86_400n, day7Clock: 604_800n, day30Clock: 2_592_000n, fee: FEE };

const pub = createPublicClient({ chain: polygon, transport: http(RPC) });
const wallet = createWalletClient({ chain: polygon, transport: http(RPC) });
const test = createTestClient({ chain: polygon, mode: "anvil", transport: http(RPC) });
const evm = evmOverRpc(RPC);

// ──────────────────────────── The contracts ───────────────────────────

const GAMES_ABI = parseAbi([
	"function createGame(string league, string homeTeam, string awayTeam, uint64 date, (uint8 seat, string id)[] hints, uint256 maxFee) returns (uint256)",
	"function getGameStatus(uint256 gameId) view returns (uint8)",
	"function getGameStart(uint256 gameId) view returns (uint64)",
	"function getGameScores(uint256 gameId) view returns (uint32, uint32)",
	"function getGameDisputedAt(uint256 gameId) view returns (uint64)",
	"function getCredit(address account) view returns (uint256)",
	"function gameCount() view returns (uint256)",
	"function withdraw() returns (uint256)",
	"event FeeCredited(uint256 indexed gameId, address indexed account, uint256 amount)",
]);
const COIN_ABI = parseAbi([
	"function balanceOf(address) view returns (uint256)",
	"function transfer(address to, uint256 amount) returns (bool)",
	"function approve(address spender, uint256 amount) returns (bool)",
]);
const PROBE_ABI = parseAbi(["function count() view returns (uint256)", "function metadataOf(uint256 i) view returns (bytes)"]);
const STATUS = ["none", "unverified", "verified", "disputed", "scored", "voided", "released"];

function artifact(dir: string, name: string): { abi: unknown[]; bytecode: Hex } {
	const a = JSON.parse(readFileSync(join(dir, `${name}.sol`, `${name}.json`), "utf8"));
	return { abi: a.abi, bytecode: a.bytecode.object };
}

// ──────────────────────────── The transcript ──────────────────────────

const lines: string[] = [];
function say(line: string) {
	lines.push(line);
	console.log(line);
}
/** A failed check is recorded and the run goes on, so one run shows every difference; the exit code carries it. */
let checks = 0;
const failed: string[] = [];
function check(cond: boolean, what: string) {
	checks++;
	say(`  ${cond ? "ok " : "FAIL"} ${what}`);
	if (!cond) failed.push(what);
}

// ──────────────────────────── Chain helpers ───────────────────────────

async function clockTo(ts: number, label: string) {
	await test.setNextBlockTimestamp({ timestamp: BigInt(ts) });
	await test.mine({ blocks: 1 });
	const b = await pub.getBlock();
	say(`clock -> ${label}: block ${b.number}, ${new Date(Number(b.timestamp) * 1000).toISOString()}`);
}

async function send(from: Address | ReturnType<typeof account>, to: Address, data: Hex, gas = 1_000_000n) {
	const hash = await wallet.sendTransaction({ account: from as never, to, data, gas, chain: polygon });
	const receipt = await pub.waitForTransactionReceipt({ hash });
	if (receipt.status !== "success") throw new Error(`transaction ${hash} to ${to} ${receipt.status} (gas used ${receipt.gasUsed} of ${gas})`);
	return receipt;
}

async function status(games: Address, id: bigint): Promise<string> {
	return STATUS[Number(await pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getGameStatus", args: [id] }))];
}

async function credit(games: Address, who: Address): Promise<bigint> {
	return pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getCredit", args: [who] });
}

async function coinOf(who: Address): Promise<bigint> {
	return pub.readContract({ address: USDC, abi: COIN_ABI, functionName: "balanceOf", args: [who] });
}

/** A delivery through the forwarder: one signed raw report to one receiver. The receipt is read, never trusted. */
interface Delivery {
	readonly rawReport: Hex;
	readonly executionId: Hex;
	readonly reportId: number;
	readonly txHash: Hex;
	readonly status: "success" | "reverted" | "not sent";
	readonly result: boolean | null;
	readonly gasUsed: bigint;
}

let deliveries = 0;
async function deliver(
	receiver: Address,
	report: Hex | null,
	o: { workflowId: Hex; owner: Address; executionId?: Hex; reportId?: number; gas?: bigint; label: string },
): Promise<Delivery> {
	if (report === null) {
		say(`deliver - (${o.label}): not sent: the program wrote nothing`);
		return { rawReport: "0x", executionId: o.executionId ?? "0x", reportId: o.reportId ?? 0, txHash: "0x", status: "not sent", result: null, gasUsed: 0n };
	}
	const n = ++deliveries;
	const executionId = o.executionId ?? keccak256(stringToHex(`rehearsal-${n}-${o.label}`));
	const reportId = o.reportId ?? n;
	const ts = evm.latest().timestamp;
	const rawReport = rawReportOf(
		{ executionId, timestamp: ts, donId: DON_ID, configVersion: CONFIG_VERSION, workflowId: o.workflowId, name: NAME, owner: o.owner, reportId },
		report,
	);
	const signatures = await signaturesOf(rawReport, SIGNING_KEYS);
	const data = encodeFunctionData({ abi: FORWARDER_ABI, functionName: "report", args: [receiver, rawReport, CONTEXT, signatures] });
	let receipt: Awaited<ReturnType<typeof send>>;
	try {
		receipt = await send(TRANSMITTER, FORWARDER, data, o.gas ?? 1_000_000n);
	} catch (e) {
		say(`deliver ${n} (${o.label}): the forwarder transaction reverted: ${String((e as Error).message).split("\n")[0]}`);
		return { rawReport, executionId, reportId, txHash: "0x" as Hex, status: "reverted", result: null, gasUsed: 0n };
	}
	let result: boolean | null = null;
	for (const l of receipt.logs) {
		if (l.address.toLowerCase() !== FORWARDER.toLowerCase()) continue;
		try {
			const d = decodeEventLog({ abi: FORWARDER_ABI, data: l.data, topics: l.topics, eventName: "ReportProcessed" });
			result = d.args.result;
		} catch {
			/* another forwarder log */
		}
	}
	say(
		`deliver ${n} (${o.label}): to ${receiver}, raw ${(rawReport.length - 2) / 2} bytes, metadata ${metadataOf(rawReport).slice(0, 20)}..., tx ${receipt.status}, ReportProcessed result ${result}, gas ${receipt.gasUsed}`,
	);
	return { rawReport, executionId, reportId, txHash: receipt.transactionHash, status: receipt.status, result, gasUsed: receipt.gasUsed };
}

/** The seat a request goes to, by its host in the feed table. */
function seatOfRequest(req: HttpRequest): number {
	const host = new URL(req.url).host;
	return SEATS.find((r) => r.host === host)?.seat ?? 0;
}

/** A request as the workflow's transport keys it (lib.ts, memoized): what the platform would count once. */
function requestKey(req: HttpRequest): string {
	const headers = Object.entries(req.headers)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
	return `${req.method} ${req.url}\n${headers}\n${req.body ?? ""}`;
}

/**
 * The game a run is handed, and its reporters, as the workflow reads them. At creation: the creation
 * handler's, from its trigger's event (main.ts). Past it: the tick's full read from state (tick.ts), the
 * open list's row, the identity, the readings and the reporters; or the event stand-in, to compare.
 */
function gameFor(games: Address, creation: Creation, at: "creation" | "past"): { game: ReturnType<typeof gameOfCreation>; reporters: readonly Address[]; read: string } {
	if (READS === "events") return { game: gameFromLogs(evm, games, creation), reporters: creation.reporters, read: "the event stand-in" };
	if (at === "creation") return { game: gameOfCreation(creation), reporters: creation.reporters, read: "the creation event" };
	const open = readOpenGames(evm, games);
	const row = open.rows.find((r) => r.gameId === creation.gameId);
	if (row === undefined) throw new Error(`game ${creation.gameId} is not on the open list of ${open.total}`);
	const identity = readIdentity(evm, games, row.gameId);
	const readings = readReadings(evm, games, row.gameId);
	const reporters = readReporters(evm, games, row.gameId);
	return { game: gameOfState(row, identity, readings), reporters, read: "state" };
}

/**
 * The program's run for one game, with the saved answers as of `asOf`; the write is recorded, not sent.
 * `moved`: the answers are the MLB case's, served moved (see "The MLB case, moved"); the requests recorded
 * are the ones the saved answers were asked, each date moved back.
 */
function runOf(
	games: Address,
	creation: Creation,
	asOf: number,
	derive?: Derive,
	at: "creation" | "past" = "past",
	moved = false,
): { run: Run; requests: number; reads: typeof evm.reads; asked: readonly HttpRequest[] } {
	if (moved && derive !== undefined) throw new Error("a moved run takes no other derivation");
	const t = saved(moved ? movedRows : derive, asOf);
	const send = moved ? (req: HttpRequest): HttpResponse => t.send(movedBack(req)) : t.send;
	const before = { ...evm.reads };
	const written: Hex[] = [];
	const held = gameFor(games, creation, at);
	const run = runGame(
		{
			evm,
			games,
			payout: PAYOUT.address,
			keys: keysFor({ 4: KEY }),
			send,
			write: (bytes) => {
				written.push(bytes);
				return null;
			},
		},
		held.game,
		held.reporters,
	);
	const reads = { calls: evm.reads.calls - before.calls, logs: evm.reads.logs - before.logs, headers: evm.reads.headers - before.headers };
	const bySeat = [1, 2, 3, 4].map((s) => t.asked.filter((r) => seatOfRequest(r) === s).length).join("/");
	const distinct = new Set(t.asked.map(requestKey)).size;
	say(
		`run ${creation.league} game ${creation.gameId} at clock ${new Date(run.now * 1000).toISOString()} (answers as of ${new Date(asOf * 1000).toISOString()}${moved ? `, moved ${MOVE_DAYS} days` : ""}; read from ${held.read}): ${run.decision.action}: ${run.decision.why}; ${t.asked.length} requests (seats 1/2/3/4: ${bySeat}; ${distinct} distinct), ${reads.calls} calls + ${reads.logs} log queries + ${reads.headers} headers${t.misses.length ? `; misses: ${t.misses.join(", ")}` : ""}`,
	);
	if (run.written !== null && written[0] !== run.written) throw new Error("the recorded write is not the run's");
	return { run, requests: t.asked.length, reads, asked: t.asked };
}

async function createGame(games: Address, g: { league: string; home: string; away: string; date: number; hints: { seat: number; id: string }[] }): Promise<Creation> {
	const data = encodeFunctionData({ abi: GAMES_ABI, functionName: "createGame", args: [g.league, g.home, g.away, BigInt(g.date), g.hints, FEE] });
	const receipt = await send(CREATOR, games, data);
	const log = receipt.logs.find((l) => l.topics[0] === GAME_CREATED_TOPIC);
	if (!log) throw new Error("no GameCreated");
	const creation = decodeGameCreated({ topics: log.topics as Hex[], data: log.data, blockNumber: receipt.blockNumber });
	say(`created game ${creation.gameId}: ${g.league} ${g.home} v ${g.away}, date ${new Date(g.date * 1000).toISOString()}, block ${receipt.blockNumber}, fee ${FEE}`);
	return creation;
}

/** A start report as verification would have written it, for a game the program waited on with the saved answers. */
function handStart(gameId: bigint, start: number, seat3Listed: boolean): Hex {
	return encodeReport({
		gameId: gameId.toString(),
		kind: 1,
		start,
		homeScore: 0,
		awayScore: 0,
		readings: [
			{ seat: 1, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 2, kind: 1, homeScore: 0, awayScore: 0 },
			{ seat: 3, kind: seat3Listed ? 1 : 0, homeScore: 0, awayScore: 0 },
			{ seat: 4, kind: 1, homeScore: 0, awayScore: 0 },
		],
		payout: "0x0000000000000000000000000000000000000000",
	});
}

// ──────────────────────────── The derivations for the dispute ─────────

const SIXERS = { home: "Philadelphia 76ers", away: "Cleveland Cavaliers", sport: "basketball_nba", league: "NBA" };
const BRUINS = { home: "Boston Bruins", away: "Nashville Predators", sport: "icehockey_nhl", league: "NHL" };
type Teams = typeof SIXERS;

/** Seat 4's final for one game with the two teams' points swapped. */
const seat4Swapped =
	(t: Teams): Derive =>
	(seat, path, body) => {
		if (seat !== 4 || !path.includes(`${t.sport}/scores`)) return body;
		for (const e of body as { home_team: string; away_team: string; scores: { name: string; score: string }[] | null }[]) {
			if (e.home_team === t.home && e.away_team === t.away && Array.isArray(e.scores)) {
				const a = e.scores.find((s) => s.name === t.home)!;
				const b = e.scores.find((s) => s.name === t.away)!;
				[a.score, b.score] = [b.score, a.score];
			}
		}
		return body;
	};

/** Seats 2 and 4 with the points swapped: seat 2's vote changes against the record, seat 4's stands. */
const seats2and4Swapped =
	(t: Teams): Derive =>
	(seat, path, body) => {
		if (seat === 4) return seat4Swapped(t)(seat, path, body);
		if (seat !== 2 || !path.includes(`league=${t.league}`)) return body;
		for (const r of (body as { results: { teams: { home: { team: string } }; scoreboard?: { score?: { home: number; away: number } } }[] }).results) {
			const score = r.scoreboard?.score;
			if (r.teams.home.team === t.home && score !== undefined) [score.home, score.away] = [score.away, score.home];
		}
		return body;
	};

// ──────────────────────────── The MLB case, moved ─────────────────────
//
// The one saved case the program voids after n at this head is a June game: Atlanta at the White Sox,
// 11 Jun 2026, rained out, read at the saved cases' first clock (scoring/test/cases.ts). The games set
// refuses every report to a game from its date plus its day-30 clock (_checkDay30), so on this fork,
// whose clock starts on 22 Oct, the game as dated could not even be verified. Here it is created 133
// days later and its saved answers are served moved by the same 133 days: each date in a request moves
// back to the June date its answer was saved under, and each time in a game's row of the answer moves
// forward. Words, ids, statuses and points are served as saved; a page's own time (when seat 2
// answered, 22 Oct) stays. 133 days is 19 weeks, so the weekday is kept: 11 Jun and 22 Oct 2026 are
// both Thursdays. The moved run is held to the case at its own clock: the same requests once moved
// back, and the same decision and readings, each record's time 133 days later.

const MLB_CASE = "mlb postponed: Atlanta at the White Sox";
const MOVE_DAYS = 133;
const MOVE = MOVE_DAYS * 86_400;
/** A calendar date in a request: four digits, two, two, not inside a longer number. */
const DATE_IN_REQUEST = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
/** A time in a row, in the one form the saved rows carry one: ISO 8601 in UTC, to the second or the millisecond. */
const TIME_IN_ROW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** A request as the program sent it for the moved game, with each date put back on the date its answer was saved under. */
function movedBack(req: HttpRequest): HttpRequest {
	const url = req.url.replace(DATE_IN_REQUEST, (_, y: string, m: string, d: string) =>
		new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) - MOVE * 1000).toISOString().slice(0, 10),
	);
	return { ...req, url };
}

/** Every time in a row moved forward, each in the form it was saved in; anything date-like in another form is refused. */
function timesMoved(v: unknown): unknown {
	if (typeof v === "string") {
		if (TIME_IN_ROW.test(v)) {
			const moved = new Date(Date.parse(v) + MOVE * 1000).toISOString();
			return v.length === 20 ? moved.replace(/\.\d{3}Z$/, "Z") : moved;
		}
		if (/\d{4}-\d{2}-\d{2}/.test(v)) throw new Error(`a date in a row in a form the move does not know: ${v}`);
		return v;
	}
	if (Array.isArray(v)) return v.map(timesMoved);
	if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, timesMoved(x)]));
	return v;
}

/** A saved answer with its games' rows moved: seat 1's `data`, seat 2's `results`, or the rows of an answer that is a list. */
const movedRows: Derive = (_seat, _path, body) => {
	if (Array.isArray(body)) return timesMoved(body);
	const page = body as Record<string, unknown>;
	const key = Array.isArray(page?.data) ? "data" : Array.isArray(page?.results) ? "results" : null;
	return key === null ? body : { ...page, [key]: timesMoved(page[key]) };
};

/** The case at its own clock, as requests.ts runs it: the program on the saved answers as saved, under the wrapper's keys. */
function caseAtItsClock(name: string): { decision: ReturnType<typeof scoreGameSync>["decision"]; asked: readonly HttpRequest[]; now: number; date: number } {
	const c = CASES.find((x) => x.name.startsWith(name));
	if (c === undefined) throw new Error(`no saved case ${name}`);
	const t = saved(undefined, c.now);
	const out = scoreGameSync(chainOf(name, { payoutRefused: PAYOUT_REFUSED }), keysFor({ 4: KEY }), CASE_PAYOUT, c.now, t.send);
	return { decision: out.decision, asked: t.asked, now: c.now, date: c.game.start };
}

/** A reading with its record's time moved back, to set beside the case's. */
function movedBackReading(r: Reading): Reading {
	return r.record === null || r.record.time === null ? r : { ...r, record: { ...r.record, time: r.record.time - MOVE } };
}

// ──────────────────────────── The rehearsal ───────────────────────────

const NOW = 1_792_690_200; // 2026-10-22T17:30:00Z, the saved cases' first clock
const LATE = 1_792_726_320; // 2026-10-23T03:32:00Z
const MID = 1_792_783_800; // 2026-10-23T19:30:00Z

async function main() {
	const w = JSON.parse(readFileSync(WORKFLOW_JSON, "utf8")) as { hashes: { id: Hex }; owner: Address; config: Record<string, string> };
	const workflowId = w.hashes.id;
	const reporterPredicted = w.config.receiverAddress as Address;
	const gamesPredicted = w.config.eventAddress as Address;
	check(w.owner.toLowerCase() === OWNER.address.toLowerCase(), `the build's owner is the rehearsal's owner ${OWNER.address}`);
	check(w.config.payoutAddress.toLowerCase() === PAYOUT.address.toLowerCase(), `the build's payout is the rehearsal's payout ${PAYOUT.address}`);

	const chainId = await pub.getChainId();
	const head = await pub.getBlock();
	say(`fork: chain ${chainId}, block ${head.number}, ${new Date(Number(head.timestamp) * 1000).toISOString()}`);
	check(chainId === 137, "the fork is Polygon");
	const tv = await pub.readContract({ address: FORWARDER, abi: FORWARDER_ABI, functionName: "typeAndVersion" });
	check(tv === "KeystoneForwarder 1.0.0", `the forwarder at ${FORWARDER} is ${tv}`);
	say(`workflow id ${workflowId}, owner ${OWNER.address}, name ${NAME}; reporter predicted ${reporterPredicted}, games ${gamesPredicted}`);

	// 1. The forwarder's rehearsal DON: its owner, impersonated, sets f = 1 over four signers.
	const forwarderOwner = await pub.readContract({ address: FORWARDER, abi: FORWARDER_ABI, functionName: "owner" });
	await test.impersonateAccount({ address: forwarderOwner });
	await test.setBalance({ address: forwarderOwner, value: 10n ** 19n });
	const cfg = await send(
		forwarderOwner,
		FORWARDER,
		encodeFunctionData({ abi: FORWARDER_ABI, functionName: "setConfig", args: [DON_ID, CONFIG_VERSION, 1, SIGNERS.map((s) => s.address)] }),
	);
	await test.stopImpersonatingAccount({ address: forwarderOwner });
	check(cfg.status === "success", `setConfig(don ${DON_ID}, version ${CONFIG_VERSION}, f 1, 4 signers) by the forwarder's owner ${forwarderOwner}`);

	// 2. The coin: from a holder at the fork block to the deployer and the creator.
	await test.impersonateAccount({ address: HOLDER });
	await test.setBalance({ address: HOLDER, value: 10n ** 19n });
	await send(HOLDER, USDC, encodeFunctionData({ abi: COIN_ABI, functionName: "transfer", args: [DEPLOYER.address, 10n * FEE] }));
	await send(HOLDER, USDC, encodeFunctionData({ abi: COIN_ABI, functionName: "transfer", args: [CREATOR.address, 5n * FEE] }));
	await test.stopImpersonatingAccount({ address: HOLDER });
	for (const a of [DEPLOYER, OWNER, PAYOUT, CREATOR, TRANSMITTER]) await test.setBalance({ address: a.address, value: 10n ** 20n });
	say(`coin: deployer ${await coinOf(DEPLOYER.address)}, creator ${await coinOf(CREATOR.address)}, payout ${await coinOf(PAYOUT.address)}`);

	// 3. The deploy, as the script orders it: the coin check at k, the reporter at k + 1, the games set at k + 2.
	const k = await pub.getTransactionCount({ address: DEPLOYER.address });
	await send(DEPLOYER, USDC, encodeFunctionData({ abi: COIN_ABI, functionName: "transfer", args: [OWNER.address, FEE] }));
	const reporterArt = artifact(CONTRACTS_OUT, "OspexChainlinkReporter");
	const gamesArt = artifact(CONTRACTS_OUT, "OspexGames");
	const rHash = await wallet.deployContract({
		account: DEPLOYER,
		chain: polygon,
		abi: reporterArt.abi as never,
		bytecode: reporterArt.bytecode,
		args: [FORWARDER, OWNER.address, workflowId, gamesPredicted],
	});
	const rReceipt = await pub.waitForTransactionReceipt({ hash: rHash });
	const reporter = rReceipt.contractAddress!;
	check(reporter.toLowerCase() === reporterPredicted.toLowerCase(), `the reporter at nonce ${k + 1} is the predicted ${reporterPredicted}`);
	const reporterCode = await pub.getCode({ address: reporter });
	const codehash = keccak256(reporterCode!);
	const gHash = await wallet.deployContract({
		account: DEPLOYER,
		chain: polygon,
		abi: gamesArt.abi as never,
		bytecode: gamesArt.bytecode,
		args: [TIMELOCK, USDC, LAUNCH_TERMS, [reporter], [1], [codehash]],
	});
	const gReceipt = await pub.waitForTransactionReceipt({ hash: gHash });
	const games = gReceipt.contractAddress!;
	check(games.toLowerCase() === gamesPredicted.toLowerCase(), `the games set at nonce ${k + 2} is the predicted ${gamesPredicted}`);
	say(`deployed: reporter ${reporter} (${rReceipt.gasUsed} gas, code hash ${codehash}), games ${games} (${gReceipt.gasUsed} gas)`);

	// A second pair for destination separation (the same id and owner, another games set), and the probe consumer.
	const r2Predicted = (await import("viem")).getContractAddress({ from: DEPLOYER.address, nonce: BigInt(k + 3) });
	const g2Predicted = (await import("viem")).getContractAddress({ from: DEPLOYER.address, nonce: BigInt(k + 4) });
	const r2 = (await pub.waitForTransactionReceipt({
		hash: await wallet.deployContract({ account: DEPLOYER, chain: polygon, abi: reporterArt.abi as never, bytecode: reporterArt.bytecode, args: [FORWARDER, OWNER.address, workflowId, g2Predicted] }),
	})).contractAddress!;
	const g2 = (await pub.waitForTransactionReceipt({
		hash: await wallet.deployContract({ account: DEPLOYER, chain: polygon, abi: gamesArt.abi as never, bytecode: gamesArt.bytecode, args: [TIMELOCK, USDC, LAUNCH_TERMS, [r2], [1], [keccak256((await pub.getCode({ address: r2 }))!)]] }),
	})).contractAddress!;
	check(r2.toLowerCase() === r2Predicted.toLowerCase() && g2.toLowerCase() === g2Predicted.toLowerCase(), `a second reporter ${r2} and games set ${g2}, the same id and owner`);
	const probeArt = artifact(join(HERE, "..", "..", "probe", "consumer", "out"), "ForwarderProbe");
	const probe = (await pub.waitForTransactionReceipt({
		hash: await wallet.deployContract({ account: DEPLOYER, chain: polygon, abi: probeArt.abi as never, bytecode: probeArt.bytecode, args: [FORWARDER] }),
	})).contractAddress!;
	say(`the probe consumer at ${probe}`);

	// 4. Five games, by the creator, each its creation fee. The fifth is the saved MLB case, moved 133 days,
	// with the case's league, teams and hints (none).
	await send(CREATOR, USDC, encodeFunctionData({ abi: COIN_ABI, functionName: "approve", args: [games, 5n * FEE] }));
	const sixers = await createGame(games, { league: "nba", home: SIXERS.home, away: SIXERS.away, date: 1_792_710_000, hints: [{ seat: 3, id: "cc394a49-c3d1-4b8c-bba2-8ebbb8326c09" }] });
	const bears = await createGame(games, { league: "nfl", home: "Chicago Bears", away: "New England Patriots", date: 1_792_714_500, hints: [{ seat: 3, id: "edcfd41f-1773-4bc9-a349-aa50931a0278" }] });
	const appState = await createGame(games, { league: "ncaaf", home: "Appalachian State", away: "James Madison", date: 1_792_710_000, hints: [{ seat: 3, id: "1ecc09e9-a306-4846-9a3c-b8dd63f2bb84" }] });
	const bruins = await createGame(games, { league: "nhl", home: BRUINS.home, away: BRUINS.away, date: 1_792_710_000, hints: [{ seat: 3, id: "2fef41ed-51ca-4693-985f-5eb74b5f4875" }] });
	const mlbCase = CASES.find((x) => x.name.startsWith(MLB_CASE))!.game;
	const mlbDate = mlbCase.start + MOVE;
	const mlb = await createGame(games, { league: mlbCase.league, home: mlbCase.home, away: mlbCase.away, date: mlbDate, hints: [...mlbCase.hints] });
	say(`  the MLB game is the saved case "${MLB_CASE}", dated ${new Date(mlbCase.start * 1000).toISOString()}, moved ${MOVE_DAYS} days`);
	check((await coinOf(games)) === 5n * FEE, "the games set holds the five fees");
	const meta = { workflowId, owner: OWNER.address };

	// 5. Verification through the program, as the creation handler runs it, with the saved answers as of the first clock.
	say("--- the starts ---");
	const v1 = runOf(games, sixers, NOW, undefined, "creation");
	check(v1.run.decision.action === "start" && v1.run.written !== null, `the program writes the 76ers' start (${v1.requests} requests)`);
	const d1 = await deliver(reporter, v1.run.written, { ...meta, label: "76ers start" });
	check(d1.result === true && (await status(games, sixers.gameId)) === "verified", "the 76ers are verified: the start landed");
	check(Number(await pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getGameStart", args: [sixers.gameId] })) === (v1.run.decision as { start: number }).start, "the start on chain is the one the program decided");
	const v2 = runOf(games, bears, NOW, undefined, "creation");
	check(v2.run.decision.action === "start" && v2.run.written !== null, `the program writes the Bears' start (${v2.requests} requests)`);
	const d2 = await deliver(reporter, v2.run.written, { ...meta, label: "Bears start" });
	check(d2.result === true && (await status(games, bears.gameId)) === "verified", "the Bears are verified");
	const v3 = runOf(games, appState, NOW, undefined, "creation");
	check(v3.run.decision.action === "wait", "the program waits on the saved answers for the college game (its start is written by hand below)");
	const startByHand = handStart(appState.gameId, 1_792_710_000, true);
	const d3 = await deliver(reporter, startByHand, { ...meta, label: "college start, by hand" });
	check(d3.result === true && (await status(games, appState.gameId)) === "verified", "the college game is verified by the hand-written start");
	const v4 = runOf(games, bruins, NOW, undefined, "creation");
	check(v4.run.decision.action === "wait", "the program waits on the saved answers for the hockey game too (its start is written by hand)");
	const d4 = await deliver(reporter, handStart(bruins.gameId, 1_792_710_000, true), { ...meta, label: "hockey start, by hand" });
	check(d4.result === true && (await status(games, bruins.gameId)) === "verified", "the hockey game is verified by the hand-written start");
	// The MLB game's saved answers are from after it was rained out, and none lists it as scheduled, which a
	// start needs; its start is written by hand, as chainOf gives the case's (seat 3 silent: no hint).
	const d4b = await deliver(reporter, handStart(mlb.gameId, mlbDate, false), { ...meta, label: "MLB start, by hand" });
	check(d4b.result === true && (await status(games, mlb.gameId)) === "verified", "the MLB game is verified by the hand-written start");

	// 6. The late clock: the 76ers' dispute record.
	await clockTo(LATE, "late, after the night's games");
	say("--- the dispute record ---");
	const r5 = runOf(games, sixers, LATE, seat4Swapped(SIXERS));
	check(r5.run.decision.action === "dispute" && r5.run.written !== null, `the program posts the record: ${r5.run.decision.why}`);
	const d5 = await deliver(reporter, r5.run.written, { ...meta, label: "76ers dispute record" });
	check(d5.result === true && (await status(games, sixers.gameId)) === "disputed", "the 76ers are disputed");
	const disputedAt = Number(await pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getGameDisputedAt", args: [sixers.gameId] }));
	say(`  the record's time ${new Date(disputedAt * 1000).toISOString()}; day 7 at ${new Date((disputedAt + 604_800) * 1000).toISOString()}`);

	// 7. The next afternoon: the college game's score, with a retry first; the 76ers' update.
	await clockTo(MID, "the next afternoon");
	say("--- the score, with a retry ---");
	const r4 = runOf(games, appState, MID);
	check(r4.run.decision.action === "score" && r4.run.written !== null, `the program scores the college game: ${r4.run.decision.why}`);
	const creditBefore = await credit(games, PAYOUT.address);
	// A first attempt the receiver cannot finish: a gas limit the forwarder accepts for routing but the
	// reporter and the games set run out of. Below the forwarder's own floor the transaction reverts
	// instead, so the limit is raised until the forwarder routes and records a failure.
	// The forwarder routes only with 160,000 gas left after its own validation (about 54,000 with two
	// signatures), and hands the receiver what remains after its records; the limit is stepped up from
	// there until the forwarder routes, so the first delivery that is not reverted is the attempt.
	let under: Delivery | null = null;
	for (const gas of [215_000n, 220_000n, 225_000n, 230_000n, 235_000n, 240_000n, 250_000n, 260_000n]) {
		const d = await deliver(reporter, r4.run.written, { ...meta, label: `college score, under-gassed at ${gas}`, gas });
		if (d.status === "reverted") continue;
		under = d;
		break;
	}
	check(under !== null && under.status === "success", "the forwarder routes once its own floor is met");
	let retry: Delivery;
	if (under!.result === false) {
		check((await status(games, appState.gameId)) === "verified" && (await credit(games, PAYOUT.address)) === creditBefore, "a delivery the receiver could not finish: the transaction succeeds, the result is false, nothing is written");
		retry = await deliver(reporter, r4.run.written, { ...meta, label: "college score, the retry", executionId: under!.executionId, reportId: under!.reportId });
		check(retry.result === true && (await status(games, appState.gameId)) === "scored", "the retry of the same transmission lands: the college game is scored");
	} else {
		say("  note: the receiver finished at the first limit the forwarder routed with, so the retry is not shown here");
		retry = under!;
		check((await status(games, appState.gameId)) === "scored", "the college game is scored");
	}
	const scores = await pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getGameScores", args: [appState.gameId] });
	const decided = r4.run.decision as { home: number; away: number };
	check(scores[0] === decided.home && scores[1] === decided.away, `the score on chain is the program's: ${scores[0]}-${scores[1]}`);
	check((await credit(games, PAYOUT.address)) === creditBefore + FEE, "the fee is credited to the payout address");
	const payoutCoinBefore = await coinOf(PAYOUT.address);
	const wd = await send(PAYOUT, games, encodeFunctionData({ abi: GAMES_ABI, functionName: "withdraw", args: [] }));
	check(wd.status === "success" && (await coinOf(PAYOUT.address)) === payoutCoinBefore + FEE && (await credit(games, PAYOUT.address)) === 0n, "a withdrawal pays the payout address the fee");

	say("--- refused, stale and out of order ---");
	const again = await deliver(reporter, r4.run.written, { ...meta, label: "the same score again, a new execution" });
	check(again.result === false && (await status(games, appState.gameId)) === "scored", "the score delivered again is refused: an ended game takes no report");
	const same = await deliver(reporter, r4.run.written, { ...meta, label: "the same score again, the same execution", executionId: under!.executionId, reportId: under!.reportId });
	check(same.status === "reverted", "the same transmission after a success reverts at the forwarder (AlreadyAttempted)");
	const wrongOwner = await deliver(reporter, r5.run.written, { workflowId, owner: PAYOUT.address, label: "a report under another owner" });
	check(wrongOwner.status === "success" && wrongOwner.result === false, "a report under another owner is refused by the reporter; the forwarder records it without reverting");
	const wrongId = await deliver(reporter, r5.run.written, { workflowId: keccak256(stringToHex("another id")), owner: OWNER.address, label: "a report under another id" });
	check(wrongId.result === false, "a report under another workflow id is refused");
	const staleStart = await deliver(reporter, v2.run.written, { ...meta, label: "the Bears' start again" });
	check(staleStart.result === false && (await status(games, bears.gameId)) === "verified", "a second start for a verified game is refused");
	const r6 = runOf(games, sixers, MID, seats2and4Swapped(SIXERS));
	check(r6.run.decision.action === "dispute" && r6.run.written !== null, `the program posts an update: ${r6.run.decision.why}`);
	const d6 = await deliver(reporter, r6.run.written, { ...meta, label: "76ers update" });
	check(d6.result === true && (await status(games, sixers.gameId)) === "disputed", "the update is taken; the game stays disputed");
	const gotAt = Number(await pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getGameDisputedAt", args: [sixers.gameId] }));
	check(gotAt === disputedAt, "the day-7 clock did not move");

	// The hockey game: a record now, an update an hour later, then the first record delivered again after
	// the update. The games set takes it as an update, and an update writes each seat's vote as the report
	// carries it, so the re-delivered record's votes are the votes on record, which the program reads.
	say("--- the hockey game's record, update, and a stale record after it ---");
	const r9 = runOf(games, bruins, MID, seat4Swapped(BRUINS));
	check(r9.run.decision.action === "dispute" && r9.run.written !== null, `the program posts the hockey record: ${r9.run.decision.why}`);
	const d9 = await deliver(reporter, r9.run.written, { ...meta, label: "hockey dispute record" });
	check(d9.result === true && (await status(games, bruins.gameId)) === "disputed", "the hockey game is disputed");
	const bruinsDisputedAt = Number(await pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getGameDisputedAt", args: [bruins.gameId] }));
	const votesOfRecord = JSON.stringify(readReadings(evm, games, bruins.gameId).votes);
	await clockTo(MID + 3_600, "an hour later");
	const r10 = runOf(games, bruins, MID, seats2and4Swapped(BRUINS));
	check(r10.run.decision.action === "dispute" && r10.run.written !== null, `the program posts the hockey update: ${r10.run.decision.why}`);
	const d10 = await deliver(reporter, r10.run.written, { ...meta, label: "hockey update" });
	check(d10.result === true, "the hockey update is taken");
	const votesOfUpdate = JSON.stringify(readReadings(evm, games, bruins.gameId).votes);
	const staleRecord = await deliver(reporter, r9.run.written, { ...meta, label: "the first hockey record again, after the update" });
	check(staleRecord.result === true && (await status(games, bruins.gameId)) === "disputed", "an older dispute report after the update is taken as an update, which writes each seat's vote as it carries it");
	const votesAfter = JSON.stringify(readReadings(evm, games, bruins.gameId).votes);
	check(votesOfUpdate !== votesOfRecord && votesAfter === votesOfRecord, "the votes on record are the first record's again: the update had changed them, and the re-delivered record wrote them back");
	check(Number(await pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getGameDisputedAt", args: [bruins.gameId] })) === bruinsDisputedAt, "the hockey day-7 clock did not move either");

	say("--- destination separation ---");
	const toProbe = await deliver(probe, r4.run.written, { ...meta, label: "the college score to the probe consumer" });
	const probeCount = await pub.readContract({ address: probe, abi: PROBE_ABI, functionName: "count", args: [] });
	check(toProbe.result === true && probeCount === 1n, "another receiver takes the bytes; the games set is untouched by it");
	const toOther = await deliver(r2, r4.run.written, { ...meta, label: "the college score to the second reporter" });
	check(toOther.result === false && (await pub.readContract({ address: g2, abi: GAMES_ABI, functionName: "gameCount", args: [] })) === 0n, "the second reporter's games set refuses a game it does not have");

	// 8. Hour 24 for the Bears. On the pre-game answers every seat lists the game scheduled or not finished, and
	// a row scheduled or in play is an answer, not a void's vote (scoring/src/rule.ts, the header's Void and
	// decide's last two lines), so the program waits and writes nothing. On the answers read after the game,
	// at the same clock, it scores them.
	await clockTo(1_792_714_500 + 86_400 + 1, "the Bears' hour 24");
	say("--- hour 24, and the void after n ---");
	const r7 = runOf(games, bears, NOW);
	check(r7.run.decision.action === "wait" && r7.run.written === null, `on the pre-game answers the program waits for the Bears: no seat says the game will not play: ${r7.run.decision.why}`);
	const c7 = await credit(games, PAYOUT.address);
	const d7 = await deliver(reporter, r7.run.written, { ...meta, label: "the Bears at hour 24" });
	check(d7.status === "not sent" && (await status(games, bears.gameId)) === "verified" && (await credit(games, PAYOUT.address)) === c7, "nothing is written for the Bears: they stay verified and no fee is credited");
	const r7b = runOf(games, bears, LATE);
	check(r7b.run.decision.action === "score" && r7b.run.written !== null, `on the answers read after the game the program scores the Bears: ${r7b.run.decision.why}`);
	const d7b = await deliver(reporter, r7b.run.written, { ...meta, label: "Bears score" });
	const bearsScores = await pub.readContract({ address: games, abi: GAMES_ABI, functionName: "getGameScores", args: [bears.gameId] });
	const bearsDecided = r7b.run.decision as { home: number; away: number };
	check(
		d7b.result === true && (await status(games, bears.gameId)) === "scored" && bearsScores[0] === bearsDecided.home && bearsScores[1] === bearsDecided.away && (await credit(games, PAYOUT.address)) === c7 + FEE,
		`the Bears are scored ${bearsScores[0]}-${bearsScores[1]}, the program's, and the fee credited`,
	);
	const payoutBeforeBears = await coinOf(PAYOUT.address);
	const wdBears = await send(PAYOUT, games, encodeFunctionData({ abi: GAMES_ABI, functionName: "withdraw", args: [] }));
	check(wdBears.status === "success" && (await coinOf(PAYOUT.address)) === payoutBeforeBears + FEE && (await credit(games, PAYOUT.address)) === 0n, "a withdrawal pays the payout address the Bears' fee");

	// The MLB game after n: at start + 66 hours and a second, the first second its seat 4 is past retention as it
	// was when the case was saved (seat4.ts: 66 hours); at hour 24 itself seat 4 is asked, and its answer was
	// never saved. The run is held to the case at its own clock, then delivered.
	await clockTo(mlbDate + 66 * 3_600 + 1, "the MLB game's hour 66");
	const r12 = runOf(games, mlb, NOW, undefined, "past", true);
	const ref = caseAtItsClock(MLB_CASE);
	say(
		`  the case at its own clock ${new Date(ref.now * 1000).toISOString()}, the game dated ${new Date(ref.date * 1000).toISOString()}: ${ref.decision.action}: ${ref.decision.why}; ${ref.asked.length} requests`,
	);
	const askedKeys = (asked: readonly HttpRequest[]) => asked.map(requestKey).sort();
	check(
		r12.asked.length > 0 && JSON.stringify(askedKeys(r12.asked)) === JSON.stringify(askedKeys(ref.asked)),
		`the moved run asks what the case asks at its own clock, each date ${MOVE_DAYS} days back (${r12.asked.length} requests, seats ${[1, 2, 3, 4].map((s) => r12.asked.filter((r) => seatOfRequest(r) === s).length).join("/")})`,
	);
	const movedReadings = r12.run.decision.readings.map(movedBackReading);
	check(
		r12.run.decision.action === ref.decision.action && r12.run.decision.why === ref.decision.why && JSON.stringify(movedReadings) === JSON.stringify(ref.decision.readings),
		`the moved run decides as the case does at its own clock, and its readings are the case's, each record's time ${MOVE_DAYS} days later`,
	);
	check(r12.run.decision.action === "void" && r12.run.written !== null, `the program voids the MLB game after n, at hour 66: ${r12.run.decision.why}`);
	const c12 = await credit(games, PAYOUT.address);
	const d12 = await deliver(reporter, r12.run.written, { ...meta, label: "MLB void" });
	check(d12.result === true && (await status(games, mlb.gameId)) === "voided" && (await credit(games, PAYOUT.address)) === c12 + FEE, "the MLB game is voided and the fee credited");

	// 9. Day 7 for the 76ers: the program asks no seat and decides on the votes on record.
	await clockTo(disputedAt + 604_800 + 1, "the 76ers' day 7");
	say("--- day 7 ---");
	const r8 = runOf(games, sixers, LATE);
	check(r8.run.decision.action === "void" && r8.requests === 0 && r8.run.written !== null, `day 7 asks no seat and decides: ${r8.run.decision.why}`);
	const c8 = await credit(games, PAYOUT.address);
	const d8 = await deliver(reporter, r8.run.written, { ...meta, label: "76ers day-7 void" });
	check(d8.result === true && (await status(games, sixers.gameId)) === "voided" && (await credit(games, PAYOUT.address)) === c8 + FEE, "the 76ers are voided at day 7 and the fee credited");
	const afterEnd = await deliver(reporter, r6.run.written, { ...meta, label: "the update after the end" });
	check(afterEnd.result === false, "an update after the end is refused");

	// 10. Day 7 for the hockey game: the votes on record are the re-delivered first record's, so three agree.
	await clockTo(bruinsDisputedAt + 604_800 + 1, "the hockey game's day 7");
	say("--- day 7, after a stale record ---");
	const r11 = runOf(games, bruins, MID);
	check(r11.run.decision.action === "score" && r11.requests === 0 && r11.run.written !== null, `day 7 reads the stale record as the newest vote: ${r11.run.decision.why}`);
	const c11 = await credit(games, PAYOUT.address);
	const d11 = await deliver(reporter, r11.run.written, { ...meta, label: "hockey day-7 score" });
	check(d11.result === true && (await status(games, bruins.gameId)) === "scored" && (await credit(games, PAYOUT.address)) === c11 + FEE, "the hockey game is scored at day 7 on the votes as they landed");
	say("  finding: a DON-signed dispute report delivered again after a newer one is taken, and the program's day 7 rests on it; without it this game's day 7 would have been a 2-2 void");

	const payoutBefore2 = await coinOf(PAYOUT.address);
	await send(PAYOUT, games, encodeFunctionData({ abi: GAMES_ABI, functionName: "withdraw", args: [] }));
	check((await coinOf(PAYOUT.address)) === payoutBefore2 + 3n * FEE, "the two voids' and the day-7 score's fees are withdrawn");
	check((await coinOf(games)) === 0n, "the games set holds no coin after its five games ended");

	say(`--- done: ${deliveries} deliveries, every receipt the game's state; ${checks} checks, ${failed.length} failed ---`);
	for (const f of failed) say(`  failed: ${f}`);
	writeFileSync(TRANSCRIPT, `${lines.join("\n")}\n`);
	console.log(`transcript: ${TRANSCRIPT}`);
	if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
	say(`--- stopped: ${String((e as Error)?.message ?? e).split("\n")[0]}; ${deliveries} deliveries, ${checks} checks, ${failed.length} failed ---`);
	writeFileSync(TRANSCRIPT, `${lines.join("\n")}\n`);
	console.error(e);
	process.exit(2);
});
