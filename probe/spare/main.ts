// The spare: a cron that logs one line and writes nothing anywhere. It exists to try each lifecycle
// command on the private registry with the pinned CLI (deploy, list, get, hash, pause, activate, delete)
// before the probe itself is deployed, and it is deleted after.

import { cre, Runner, type Runtime, type CronPayload } from "@chainlink/cre-sdk";
import { z } from "zod";

const configSchema = z.object({
	schedule: z.string().min(1),
	tag: z.string().min(1).max(64),
});
type Config = z.infer<typeof configSchema>;

const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
	const firedAt = payload.scheduledExecutionTime?.seconds ?? 0n;
	runtime.log(`spare fired: firedAt=${firedAt} tag=${runtime.config.tag}`);
	return JSON.stringify({ firedAt: firedAt.toString(), tag: runtime.config.tag });
};

const initWorkflow = (config: Config) => {
	const cron = new cre.capabilities.CronCapability();
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)];
};

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema });
	await runner.run(initWorkflow);
}
