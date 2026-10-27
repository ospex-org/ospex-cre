// A synchronous JSON-RPC over curl, and the wrapper's chain interface bound to it. The wrapper's
// reads are synchronous because the CRE runtime is; bun has no synchronous HTTP of its own, so each
// read here is one curl process. Slow enough to notice, fast enough for a rehearsal.

import type { Address, Hex } from "viem";
import type { Evm } from "../chain";
import type { RawLog } from "../lib";

export function rpcSync(url: string, method: string, params: readonly unknown[]): unknown {
	const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
	const r = Bun.spawnSync({
		cmd: ["curl", "-s", "-X", "POST", "-H", "content-type: application/json", "--data-binary", "@-", url],
		stdin: Buffer.from(body, "utf8"),
	});
	if (r.exitCode !== 0) throw new Error(`curl exit ${r.exitCode}: ${r.stderr.toString()}`);
	const parsed = JSON.parse(r.stdout.toString()) as { result?: unknown; error?: unknown };
	if (parsed.error !== undefined) throw new Error(`rpc ${method}: ${JSON.stringify(parsed.error)}`);
	return parsed.result;
}

function hex(n: bigint): Hex {
	return `0x${n.toString(16)}`;
}

/** The wrapper's chain, over a node: counts its reads so a run's cost can be stated. */
export function evmOverRpc(url: string): Evm & { readonly reads: { calls: number; logs: number; headers: number } } {
	const reads = { calls: 0, logs: 0, headers: 0 };
	return {
		reads,
		call(to: Address, data: Hex) {
			reads.calls++;
			return rpcSync(url, "eth_call", [{ to, data }, "latest"]) as Hex;
		},
		logs(address, topics, fromBlock, toBlock) {
			reads.logs++;
			const out = rpcSync(url, "eth_getLogs", [{ address, topics, fromBlock: hex(fromBlock), toBlock: hex(toBlock) }]) as {
				topics: Hex[];
				data: Hex;
				blockNumber: Hex;
			}[];
			return out.map((l): RawLog => ({ topics: l.topics, data: l.data, blockNumber: BigInt(l.blockNumber) }));
		},
		latest() {
			reads.headers++;
			const b = rpcSync(url, "eth_getBlockByNumber", ["latest", false]) as { number: Hex; timestamp: Hex };
			return { number: BigInt(b.number), timestamp: Number(BigInt(b.timestamp)) };
		},
	};
}
