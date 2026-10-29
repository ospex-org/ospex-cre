// The forwarder probe: a cron fires, the workflow signs one small report under DON consensus and writes
// it to the probe consumer on Polygon through the production forwarder. The consumer keeps whatever it is
// handed, so the read-back on chain shows what a consumer receives: the metadata (the workflow id, the hash
// of the workflow name, the workflow owner, the report id) and the report bytes.
//
// The report is the cron fire time in unix seconds and the tag from the config. The tag is the one byte the
// update step changes: a redeploy with another tag is a new workflow id, and the next delivery shows both.
//
// Grounded in @chainlink/cre-sdk@1.13.0, the pinned SDK (QuickJS/WASM: no Node builtins).

import { cre, Runner, bytesToHex, prepareReportRequest, TxStatus, type Runtime, type CronPayload } from "@chainlink/cre-sdk";
import { encodeAbiParameters, type Hex } from "viem";
import { z } from "zod";

// The one chain the probe writes to, by the selector the SDK's chain table gives polygon-mainnet, and the EVM
// chain id, kept together so the config cannot name one and mean the other.
const CHAINS = {
	"polygon-mainnet": { selector: 4051577828743386545n, chainId: 137 },
} as const;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const configSchema = z.object({
	consumerAddress: z.string().regex(ADDRESS).refine((a) => BigInt(a) !== 0n, "the consumer address is not filled in"),
	chainSelectorName: z.enum(["polygon-mainnet"]),
	chainId: z.number().int().positive(),
	schedule: z.string().min(1),
	tag: z.string().min(1).max(64),
});
type Config = z.infer<typeof configSchema>;

function selectorFor(config: Config): bigint {
	const chain = CHAINS[config.chainSelectorName];
	if (chain.chainId !== config.chainId) {
		throw new Error(`config mismatch: ${config.chainSelectorName} is chain ${chain.chainId}, the config says ${config.chainId}`);
	}
	return chain.selector;
}

const REPORT_ABI = [{ type: "uint64", name: "firedAt" }, { type: "string", name: "tag" }] as const;

const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
	const firedAt = payload.scheduledExecutionTime?.seconds ?? 0n;
	const report: Hex = encodeAbiParameters(REPORT_ABI, [firedAt, runtime.config.tag]);
	const signed = runtime.report(prepareReportRequest(report)).result();
	const evm = new cre.capabilities.EVMClient(selectorFor(runtime.config));
	const reply = evm
		.writeReport(runtime, {
			receiver: runtime.config.consumerAddress,
			report: signed,
			gasConfig: { gasLimit: "500000" },
		})
		.result();
	if (reply.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: status=${reply.txStatus} ${reply.errorMessage ?? ""}`);
	}
	const txHash = reply.txHash ? bytesToHex(reply.txHash) : null;
	runtime.log(`probe delivered: firedAt=${firedAt} tag=${runtime.config.tag} tx=${txHash}`);
	return JSON.stringify({ firedAt: firedAt.toString(), tag: runtime.config.tag, txHash });
};

const initWorkflow = (config: Config) => {
	selectorFor(config);
	const cron = new cre.capabilities.CronCapability();
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)];
};

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema });
	await runner.run(initWorkflow);
}
