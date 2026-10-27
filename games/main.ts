// The v3 games workflow: a thin wrapper on the scoring program (../scoring), which decides every
// start, score, void and dispute record, and this file, which finds the game on the chain, hands the
// program what it reads, and writes the program's report through the games set's Chainlink reporter.
//
// Trigger, built here: the games set's GameCreated event. A new game is verified from it: the program
// reads the feeds near the creator's date and decides the start, and the start report is written.
//
// Not built here, held for the ruling: what fires a run for a game past its start (the score, the
// hour-24 void, the dispute record and its updates, the day-7 result). A run from the chain alone
// walks the games on a cron; a run from the operator's box comes through an HTTP trigger carrying the
// game id; either way the run reads the game from the chain and decides on the feeds alone. Until
// that is decided, nothing here fires for a game past its start, and no file depends on which it is.
//
// Grounded in @chainlink/cre-sdk@1.13.0, the pinned SDK (QuickJS/WASM: no Node builtins).

import {
	cre,
	Runner,
	bytesToHex,
	hexToBase64,
	bigintToProtoBigInt,
	protoBigIntToBigint,
	encodeCallMsg,
	logTriggerConfig,
	prepareReportRequest,
	LATEST_BLOCK_NUMBER,
	TxStatus,
	type EVMLog,
	type Runtime,
} from "@chainlink/cre-sdk";
import type { Address, Hex } from "viem";
import type { HttpRequest, HttpResponse, Seat } from "../scoring/src/types";
import type { Evm } from "./chain";
import {
	GAME_CREATED_TOPIC,
	SECRET_IDS,
	configSchema,
	decodeGameCreated,
	keysFor,
	querySeats,
	resolveChainSelector,
	secretOfHeader,
	type Config,
} from "./lib";
import { runGame, summarize } from "./run";

const ZERO: Address = "0x0000000000000000000000000000000000000000";

// ──────────────────────────── The chain, through the EVM capability ────

function evmOf(runtime: Runtime<Config>, client: InstanceType<typeof cre.capabilities.EVMClient>): Evm {
	return {
		call(to, data) {
			const reply = client.callContract(runtime, { call: encodeCallMsg({ from: ZERO, to, data }), blockNumber: LATEST_BLOCK_NUMBER }).result();
			return bytesToHex(reply.data);
		},
		logs(address, topics, fromBlock, toBlock) {
			const reply = client
				.filterLogs(runtime, {
					filterQuery: {
						addresses: [hexToBase64(address)],
						topics: topics.map((t) => ({ topic: t === null ? [] : [hexToBase64(t)] })),
						fromBlock: bigintToProtoBigInt(fromBlock),
						toBlock: bigintToProtoBigInt(toBlock),
					},
				})
				.result();
			return (reply.logs ?? []).map((l) => ({
				topics: l.topics.map(bytesToHex),
				data: bytesToHex(l.data),
				blockNumber: l.blockNumber ? protoBigIntToBigint(l.blockNumber) : 0n,
			}));
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
 * filled inside the enclave from the vault, so that key never enters the workflow. The response's
 * status and body go back to the reader as they came.
 */
function transportOf(runtime: Runtime<Config>): (req: HttpRequest) => HttpResponse {
	const conf = new cre.capabilities.ConfidentialHTTPClient();
	return (req) => {
		const multiHeaders: Record<string, { values: string[] }> = {};
		const vaultDonSecrets: { key: string; namespace: string; owner: string }[] = [];
		for (const [k, v] of Object.entries(req.headers)) {
			multiHeaders[k] = { values: [v] };
			const secret = secretOfHeader(v);
			if (secret !== null) vaultDonSecrets.push({ key: secret, namespace: runtime.config.secretNamespace, owner: runtime.config.secretOwner });
		}
		const resp = conf.sendRequest(runtime, { vaultDonSecrets, request: { url: req.url, method: req.method, multiHeaders } }).result();
		return { status: resp.statusCode, body: new TextDecoder().decode(resp.body) };
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
			throw new Error(`writeReport failed: status=${reply.txStatus} ${reply.errorMessage ?? ""}`);
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
	const run = runGame(
		{
			evm: evmOf(runtime, client),
			games: runtime.config.eventAddress as Address,
			payout: runtime.config.payoutAddress,
			keys: keysFor(queryKeysOf(runtime)),
			send: transportOf(runtime),
			write: writerOf(runtime, client),
		},
		creation,
	);
	const line = summarize(run);
	runtime.log(line);
	return line;
};

// ──────────────────────────── Wiring ─────────────────────────────────

const initWorkflow = (config: Config) => {
	const client = new cre.capabilities.EVMClient(resolveChainSelector(config.chainSelectorName, config.chainId));
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
	];
};

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema });
	await runner.run(initWorkflow);
}
