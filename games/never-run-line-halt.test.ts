// Never: "A failed, slow or hanging push changes a report, a stop or a scoring result, or delays it
// past the push's time cap. Delivery failure is a collection gap, never a halt."
//
// main.ts's own two handlers, run against the stand-in SDK (stand-in-sdk.ts), with the push meeting each
// of four endpoints: one that takes it (201), one that refuses it (401), one that cannot be reached, and
// one that hangs until the enclave gives up at the push's cap. In every case the run is the same: the
// same report bytes written, the same line returned or the same error thrown, the same rows on the log.
// The push follows the write and is sent once, with its cap; a push that did not land leaves its rows on
// the log and its line saying so: the gap, read by the run key.
//
// The breaks that turn this red, each applied once and restored:
//   runline.ts, pushOnce: the push's failure let through,
//     return `run-line push: no answer: ${causeOf(e)}`;
//     ->  throw e;
//   with which an unreachable or hanging endpoint makes the handler throw where it returned;
//   runline.ts, pushRequest: the cap dropped,
//     timeout: RUN_LINE_TIMEOUT,
//     ->  (the line deleted)
//   with which the push asks the enclave for no cap of its own.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import { LATE, NOW } from "../scoring/test/cases";
import { saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { decodeReport, type Config } from "./lib";
import type { Row } from "./runline";
import { LOG_INDEX, TX_HASH, creationLog, standIn, tickPayload, type PushSeen, type Run, type World } from "./stand-in-sdk";
import { GAMES, REPORTER, fakeChainOf } from "./test-helpers";

const CONFIG: Config = {
	receiverAddress: REPORTER,
	eventAddress: GAMES,
	chainSelectorName: "polygon-mainnet",
	chainId: 137,
	secretOwner: "0x1111111111111111111111111111111111111111",
	secretNamespace: "halt-test",
	payoutAddress: PAYOUT,
	schedule: "0 */5 * * * *",
	shards: 1,
	runLineUrl: "https://db.example.test/rest/v1/run_lines",
};
const VAULT = { SEAT1_KEY: "s1", SEAT2_KEY: "s2", SEAT3_KEY: "s3", SEAT4_KEY: "SEATKEY", RUN_LINE_KEY: "push-key-stand-in", RUN_LINE_APIKEY: "apikey-stand-in" };

const sdk = await standIn(CONFIG);

type Mode = "accepted" | "refused" | "unreachable" | "hanging";
const MODES: readonly Mode[] = ["accepted", "refused", "unreachable", "hanging"];

/** The database's endpoint, in each mode. A hanging one is the enclave giving up at the request's own cap. */
function endpoint(mode: Mode): World["push"] {
	return (req: PushSeen) => {
		if (mode === "accepted") return { status: 201, body: "" };
		if (mode === "refused") return { status: 401, body: JSON.stringify({ code: "PGRST301", message: "JWT expired" }) };
		if (mode === "unreachable") throw new Error("dial tcp 203.0.113.9:443: connect: connection refused");
		throw new Error(`context deadline exceeded after ${String(req.timeout)}`);
	};
}

const LINE: Readonly<Record<Mode, string>> = {
	accepted: "run-line push: http 201",
	refused: "run-line push: http 401 PGRST301",
	unreachable: "run-line push: no answer: connection refused",
	hanging: "run-line push: no answer: timed out",
};

const SIXERS: ChainGame = { ...chainOf("nba final, read after the game"), id: "1" };
const NFL: ChainGame = { ...chainOf("nfl not final"), id: "1", status: "unverified", start: null, startReadings: null };

function world(games: readonly ChainGame[], now: number, mode: Mode, writeError: string | null = null): World {
	const t = saved(undefined, now);
	return { evm: fakeChainOf(games, now), vault: VAULT, feed: (_seat, req) => t.send(req), push: endpoint(mode), writeError };
}

const rowsOf = (r: Run): Row[] => r.logs.filter((l) => l.startsWith("run-line {")).map((l) => JSON.parse(l.slice("run-line ".length)) as Row);
/** Everything a run did but the push's own line. */
const run = (r: Run) => ({ returned: r.returned, threw: r.threw, writes: r.writes, logs: r.logs.filter((l) => !l.startsWith("run-line push")), sends: r.events.filter((e) => e.startsWith("send")) });

function across(handler: number, payload: unknown, make: (mode: Mode) => World): Record<Mode, Run> {
	return Object.fromEntries(MODES.map((m) => [m, sdk.handle(handler, payload, make(m))])) as Record<Mode, Run>;
}

/** What every mode must show: the run as the accepted push's, the push once, after the write, the gap on the log. */
function holds(runs: Record<Mode, Run>, runKey: string): void {
	const base = run(runs.accepted);
	for (const mode of MODES) {
		const r = runs[mode];
		expect({ mode, ...run(r) }).toEqual({ mode, ...base });
		expect({ mode, pushes: r.pushes.length, last: r.events.at(-1), line: r.logs.at(-1) }).toEqual({ mode, pushes: 1, last: "push", line: LINE[mode] });
		if (r.writes.length > 0) expect({ mode, writeBeforePush: r.events.indexOf("write") < r.events.indexOf("push") }).toEqual({ mode, writeBeforePush: true });
		// The gap: four rows under the run key on the log, whatever the push met.
		expect({ mode, rows: rowsOf(r).map((x) => [x.run_key, x.seat]) }).toEqual({ mode, rows: [1, 2, 3, 4].map((s) => [runKey, s]) });
	}
}

describe("never: a push that fails, hangs or is slow changes the run", () => {
	test("a tick that scores: the same report written, the same line returned and the same rows logged, whatever the push met; the push after the write; the gap on the log", () => {
		const runs = across(1, tickPayload(LATE), (m) => world([SIXERS], LATE, m));
		expect(runs.accepted.writes.length).toBe(1);
		expect(decodeReport(runs.accepted.writes[0].report)).toMatchObject({ gameId: "1", kind: 2, homeScore: 114, awayScore: 106 });
		expect(runs.accepted.threw).toBeNull();
		holds(runs, `osgames2:tick:0:${LATE}`);
		// The handler's own wiring: the reads told by the probe and the program, the sends by the transport,
		// DON time around each (the stand-in's clock moves 5 ms a read).
		expect(rowsOf(runs.accepted).map((x) => [x.seat, x.requests, x.answered, x.silent, x.skipped, x.elapsed_ms])).toEqual([
			[1, 1, 1, 0, 0, [5]],
			[2, 2, 1, 0, 0, [5, 5]],
			[3, 1, 2, 0, 0, [5]],
			[4, 1, 1, 0, 0, [5]],
		]);
	});

	test("a creation run that verifies: the same start written and the same line returned, whatever the push met", () => {
		const runs = across(0, creationLog(NFL), (m) => world([NFL], NOW, m));
		expect(runs.accepted.writes.length).toBe(1);
		expect(decodeReport(runs.accepted.writes[0].report)).toMatchObject({ gameId: "1", kind: 1 });
		holds(runs, `osgames2:creation:${TX_HASH}:${LOG_INDEX}`);
		expect(rowsOf(runs.accepted).map((x) => [x.seat, x.requests, x.answered, x.silent, x.skipped])).toEqual([
			[1, 2, 2, 0, 0],
			[2, 4, 2, 0, 0],
			[3, 2, 2, 0, 0],
			[4, 1, 2, 0, 0],
		]);
	});

	test("a creation run whose write the reporter refuses: the same error thrown, whatever the push met, and the push still follows it", () => {
		const runs = across(0, creationLog(NFL), (m) => world([NFL], NOW, m, "execution reverted"));
		expect([runs.accepted.returned, runs.accepted.threw]).toEqual([null, "writeReport failed: status 2 execution reverted"]);
		holds(runs, `osgames2:creation:${TX_HASH}:${LOG_INDEX}`);
	});

	test("the cap: the push asks the enclave to give up after 5 s, under the platform's 10 s ceiling, and is sent once, never again in the execution", () => {
		for (const mode of MODES) {
			const r = sdk.handle(1, tickPayload(LATE), world([SIXERS], LATE, mode));
			expect({ mode, timeouts: r.pushes.map((p) => p.timeout) }).toEqual({ mode, timeouts: ["5s"] });
			// What the enclave was handed, read as the platform reads a duration: whole seconds, above 0, at most 10.
			const sent = String(r.pushes[0].timeout);
			expect({ mode, form: /^[0-9]+s$/.test(sent), seconds: Number(sent.slice(0, -1)) }).toEqual({ mode, form: true, seconds: 5 });
			expect(Number(sent.slice(0, -1))).toBeLessThanOrEqual(10);
		}
	});
});
