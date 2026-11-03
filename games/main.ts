// The v3 games workflow: a thin wrapper on the scoring program (../scoring), which decides every
// start, score, void and dispute record, and this file, which finds the game on the chain, hands the
// program what it reads, and writes the program's report through the games set's Chainlink reporter.
//
// Two triggers. The games set's GameCreated event: a new game is verified from it, the program reads
// the feeds near the creator's date and decides the start, and the start report is written. And the
// tick, a cron on the DON in shards (each shard a cron of its own, seconds apart, on its own pages of
// the open list): the open list from state, the probe at seat 3 for each game past its start plus the
// league's duration, the full read on a final or a clock (hour 24, day 7, the hour for a disputed
// game), and on the hour's first tick a verification for a game the feeds did not list at its
// creation. Everything a run reads about a game past its creation comes from state; the one log read
// is the creation trigger's own payload.
//
// Each execution keeps a run-line (runline.ts): which seats it asked, how each read ended, each
// request's time and status, and the spare's quota. When it asked any seat, the rows go to the log and
// then, after the run, to the database's table in one push, the execution's reserved fifteenth request.
//
// Grounded in @chainlink/cre-sdk@1.13.0, the pinned SDK (QuickJS/WASM: no Node builtins).

import {
	cre,
	Runner,
	bytesToHex,
	protoBigIntToBigint,
	encodeCallMsg,
	logTriggerConfig,
	prepareReportRequest,
	LATEST_BLOCK_NUMBER,
	TxStatus,
	type CronPayload,
	type EVMLog,
	type Runtime,
} from "@chainlink/cre-sdk";
import type { Address, Hex } from "viem";
import { cleanLine, secretsOf } from "../scoring/src/line";
import { isCut } from "../scoring/src/run";
import type { Seat } from "../scoring/src/types";
import { gameOfCreation, type Evm } from "./chain";
import {
	GAME_CREATED_TOPIC,
	SECRET_IDS,
	configSchema,
	decodeGameCreated,
	keysFor,
	periodOf,
	querySeats,
	resolveChainSelector,
	secretOfHeader,
	shardScheduleOf,
	type Config,
} from "./lib";
import { runGame, summarize } from "./run";
import { creationKey, execution, keyFrom, recorded, tickKey, type Answer, type Delivery, type Execution, type Kind, type Sent } from "./runline";
import { runTick, summarizeTick } from "./tick";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

// ──────────────────────────── The chain, through the EVM capability ────

function evmOf(runtime: Runtime<Config>, client: InstanceType<typeof cre.capabilities.EVMClient>): Evm {
	return {
		call(to, data) {
			const reply = client.callContract(runtime, { call: encodeCallMsg({ from: ZERO, to, data }), blockNumber: LATEST_BLOCK_NUMBER }).result();
			return bytesToHex(reply.data);
		},
		latest() {
			const header = client.headerByNumber(runtime, { blockNumber: LATEST_BLOCK_NUMBER }).result().header;
			if (!header || !header.blockNumber) throw new Error("the chain gave no latest block");
			return { number: protoBigIntToBigint(header.blockNumber), timestamp: Number(header.timestamp) };
		},
	};
}

// ──────────────────────────── The transport, through the enclave ──────

/**
 * One request, one answer, through confidential HTTP: a header whose value is a seat's stand-in is
 * filled inside the enclave from the vault, so that key never enters the workflow, and so is the
 * push's header, by the secret its request names. The response's status, body and headers come back as
 * they came; the readers get the status and the body (runline.ts, observed). A request already made in
 * this run is answered from memory, and the run refuses a request past its count before sending it
 * (runline.ts, execution).
 */
function rawOf(runtime: Runtime<Config>): (req: Sent) => Answer {
	const conf = new cre.capabilities.ConfidentialHTTPClient();
	const secret = (key: string) => ({ key, namespace: runtime.config.secretNamespace, owner: runtime.config.secretOwner });
	return (req) => {
		const multiHeaders: Record<string, { values: string[] }> = {};
		const vaultDonSecrets: { key: string; namespace: string; owner: string }[] = [];
		for (const [k, v] of Object.entries(req.headers)) {
			multiHeaders[k] = { values: [v] };
			const name = secretOfHeader(v);
			if (name !== null) vaultDonSecrets.push(secret(name));
		}
		for (const name of req.secrets ?? []) vaultDonSecrets.push(secret(name));
		const resp = conf
			.sendRequest(runtime, {
				vaultDonSecrets,
				request: {
					url: req.url,
					method: req.method,
					multiHeaders,
					...(req.body === undefined ? {} : { bodyString: req.body }),
					...(req.timeout === undefined ? {} : { timeout: req.timeout }),
				},
			})
			.result();
		const headers: Record<string, string[]> = {};
		for (const [k, v] of Object.entries(resp.multiHeaders ?? {})) headers[k] = [...v.values];
		return { status: resp.statusCode, body: new TextDecoder().decode(resp.body), headers };
	};
}

/** The execution's transports and its record, with DON time for the record's clock. */
function executionOf(runtime: Runtime<Config>): Execution {
	return execution(rawOf(runtime), () => runtime.now().getTime());
}

/** Where the execution's record goes: its key and kind, the route from the config, the log, and the secrets kept off a line. */
function deliveryOf(runtime: Runtime<Config>, runKey: string | null, kind: Kind, secrets: readonly string[]): Delivery {
	return {
		runKey,
		kind,
		route: { url: runtime.config.runLineUrl, publishableKey: runtime.config.runLinePublishableKey },
		log: (line) => runtime.log(line),
		secrets,
	};
}

/** The keys of the seats whose key goes in the query, read from the vault for this run. */
function queryKeysOf(runtime: Runtime<Config>): Partial<Record<Seat, string>> {
	const out: Partial<Record<Seat, string>> = {};
	for (const seat of querySeats()) {
		const secret = runtime.getSecret({ id: SECRET_IDS[seat], namespace: runtime.config.secretNamespace }).result();
		out[seat] = secret.value;
	}
	return out;
}

// ──────────────────────────── The write, through the reporter ─────────

function writerOf(runtime: Runtime<Config>, client: InstanceType<typeof cre.capabilities.EVMClient>): (report: Hex) => string | null {
	return (report) => {
		const signed = runtime.report(prepareReportRequest(report)).result();
		const reply = client
			.writeReport(runtime, { receiver: runtime.config.receiverAddress, report: signed, gasConfig: { gasLimit: "1000000" } })
			.result();
		if (reply.txStatus !== TxStatus.SUCCESS) {
			// No "=" in the wrapper's own words: the line function marks a run carrying one (src/line.ts).
			throw new Error(`writeReport failed: status ${reply.txStatus} ${reply.errorMessage ?? ""}`);
		}
		return reply.txHash ? bytesToHex(reply.txHash) : null;
	};
}

// ──────────────────────────── The creation handler ────────────────────

const onGameCreated = (runtime: Runtime<Config>, log: EVMLog): string => {
	const creation = decodeGameCreated({
		topics: log.topics.map(bytesToHex),
		data: bytesToHex(log.data),
		blockNumber: log.blockNumber ? protoBigIntToBigint(log.blockNumber) : 0n,
	});
	runtime.log(`game created: ${creation.gameId} ${creation.league} at block ${creation.blockNumber}`);
	const client = new cre.capabilities.EVMClient(resolveChainSelector(runtime.config.chainSelectorName, runtime.config.chainId));
	const keys = keysFor(queryKeysOf(runtime));
	const ex = executionOf(runtime);
	const delivery = deliveryOf(runtime, keyFrom(() => creationKey(bytesToHex(log.txHash), log.index)), "creation", secretsOf(keys));
	// The run, then its record: the rows to the log and the one push, which only follows the run's result or its error.
	return recorded(delivery, ex, () => {
		let run;
		try {
			run = runGame(
				{
					evm: evmOf(runtime, client),
					games: runtime.config.eventAddress as Address,
					payout: runtime.config.payoutAddress,
					keys,
					send: ex.feeds,
					write: writerOf(runtime, client),
					observe: ex.record,
				},
				gameOfCreation(creation),
				creation.reporters,
			);
		} catch (e) {
			const message = cleanLine(e instanceof Error ? e.message : String(e), secretsOf(keys));
			// Any other error is thrown again, carrying only its cleaned message: the platform writes a rejected
			// handler's error as the execution's error text, so that text is a line too (a writer's error can
			// carry whatever the platform answered).
			if (!isCut(e)) throw new Error(message);
			// The run's own count of requests used up: the readers raised it, the program decided nothing and
			// nothing was written. The tick verifies the game on the hour's first tick, with the same count.
			const line = `game ${creation.gameId}: verification cut: ${message}`;
			runtime.log(line);
			return line;
		}
		const line = summarize(run, secretsOf(keys));
		runtime.log(line);
		return line;
	});
};

// ──────────────────────────── The tick ────────────────────────────────

const onTick =
	(index: number) =>
	(runtime: Runtime<Config>, payload: CronPayload): string => {
		const scheduled = payload.scheduledExecutionTime?.seconds ?? 0n;
		runtime.log(`tick ${index}/${runtime.config.shards} scheduled at ${scheduled}`);
		const client = new cre.capabilities.EVMClient(resolveChainSelector(runtime.config.chainSelectorName, runtime.config.chainId));
		const keys = keysFor(queryKeysOf(runtime));
		// The execution's feed transport, counted and remembered; the tick counts and remembers again with
		// its own count, which is the one that holds a probe or a full read back.
		const ex = executionOf(runtime);
		const delivery = deliveryOf(runtime, keyFrom(() => tickKey(index, scheduled)), "tick", secretsOf(keys));
		return recorded(delivery, ex, () => {
			const tick = runTick({
				evm: evmOf(runtime, client),
				games: runtime.config.eventAddress as Address,
				payout: runtime.config.payoutAddress,
				keys,
				send: ex.feeds,
				write: writerOf(runtime, client),
				observe: ex.record,
				period: periodOf(runtime.config.schedule),
				shard: { index, count: runtime.config.shards },
			});
			for (const l of tick.lines) runtime.log(l);
			for (const w of tick.waiting) runtime.log(`waiting: ${w}`);
			const line = summarizeTick(tick);
			runtime.log(line);
			return line;
		});
	};

// ──────────────────────────── Wiring ─────────────────────────────────

const initWorkflow = (config: Config) => {
	const client = new cre.capabilities.EVMClient(resolveChainSelector(config.chainSelectorName, config.chainId));
	const cron = new cre.capabilities.CronCapability();
	const ticks = Array.from({ length: config.shards }, (_, index) =>
		cre.handler(cron.trigger({ schedule: shardScheduleOf(config.schedule, index, config.shards) }), onTick(index)),
	);
	return [
		cre.handler(
			client.logTrigger(
				logTriggerConfig({
					addresses: [config.eventAddress as Hex],
					topics: [[GAME_CREATED_TOPIC]],
					confidence: "FINALIZED",
				}),
			),
			onGameCreated,
		),
		...ticks,
	];
};

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema });
	await runner.run(initWorkflow);
}
