#!/usr/bin/env bun
// Rebuilds a workflow's fingerprint, its CRE workflow id, from public source, and checks it.
//
//   bun build/fingerprint.ts build/v2-osverify.json
//   bun build/fingerprint.ts <spec.json> --set receiverAddress=0x... [--set k=v ...] [--owner 0x...] [--json]
//
// It writes the config from the committed template (build/config.ts), then runs the CRE CLI's
// read-only `cre workflow hash`, which compiles the workflow from source and hashes it as a deploy
// does. Nothing is registered, signed or sent. The owner is always passed as --public_key: on CLI
// v1.22.0, `hash` ignores the target's workflow-owner-address and falls back to the address of
// CRE_ETH_PRIVATE_KEY, which is how a different id was once read off this same build.
//
// The steps, the pinned tools and what has been checked are in BUILD.md.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { configBytes, sha256 } from "./config";

interface Spec {
	readonly name: string;
	readonly what: string;
	readonly workflow: string;
	readonly target: string;
	readonly owner: string;
	readonly configTemplate: string;
	readonly config: Readonly<Record<string, string>>;
	readonly tools: { readonly cre: string; readonly bun: string };
	readonly expect?: { readonly config?: string; readonly binary?: string; readonly id?: string };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function fail(message: string): never {
	console.error(`fingerprint: ${message}`);
	process.exit(1);
}

const args = process.argv.slice(2);
const specPath = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.match(/^--(set|owner)$/));
if (specPath === undefined) fail("usage: bun build/fingerprint.ts <spec.json> [--set key=value]... [--owner 0x...] [--json]");
const spec = JSON.parse(readFileSync(specPath, "utf8")) as Spec;
const root = resolve(dirname(specPath), "..");

const values: Record<string, string> = { ...spec.config };
let owner = spec.owner;
for (let i = 0; i < args.length; i++) {
	if (args[i] === "--set") {
		const [k, ...v] = (args[++i] ?? "").split("=");
		if (k === "" || v.length === 0) fail(`--set wants key=value, got ${args[i]}`);
		values[k] = v.join("=");
	} else if (args[i] === "--owner") {
		owner = args[++i] ?? "";
	}
}
if (!ADDRESS.test(owner)) fail("the owner is not an address");
// A run with --set or --owner computes a new id; the spec's expected values belong to the spec's own inputs.
const changed = owner !== spec.owner || Object.entries(values).some(([k, v]) => spec.config[k] !== v);
const expect = changed ? {} : (spec.expect ?? {});

// The workflow name the CLI will hash is the target's workflow-name in workflow.yaml.
const workflowDir = join(root, spec.workflow);
const yaml = readFileSync(join(workflowDir, "workflow.yaml"), "utf8").split(/\r?\n/);
const at = yaml.findIndex((l) => l.trim() === `${spec.target}:`);
const nameLine = at < 0 ? undefined : yaml.slice(at + 1).find((l) => /^\s+workflow-name:/.test(l));
const yamlName = nameLine?.split(":")[1]?.trim().replace(/^"|"$/g, "");
if (yamlName !== spec.name) fail(`workflow.yaml names the ${spec.target} workflow ${JSON.stringify(yamlName)}, the spec ${JSON.stringify(spec.name)}`);
if (!existsSync(join(workflowDir, "node_modules"))) fail(`run \`bun install --frozen-lockfile\` in ${spec.workflow}/ first`);

// The config, written fresh.
const config = configBytes(readFileSync(join(root, spec.configTemplate), "utf8"), values);
const configSha = sha256(config);
const outDir = join(root, "build", "out");
mkdirSync(outDir, { recursive: true });
const configPath = join(outDir, `${spec.name}.config.json`);
writeFileSync(configPath, config);

// The tools. A different version is reported, not refused: the id comparison below is the check.
const version = (cmd: string, flag: string): string => {
	const r = spawnSync(cmd, [flag], { encoding: "utf8", shell: process.platform === "win32" });
	return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split(/\r?\n/)[0] ?? "";
};
const creVersion = version("cre", "version");
const bunVersion = version("bun", "--version");
const toolNotes: string[] = [];
if (!creVersion.includes(spec.tools.cre)) toolNotes.push(`cre is "${creVersion}", the spec pins ${spec.tools.cre}`);
if (bunVersion !== spec.tools.bun) toolNotes.push(`bun is ${bunVersion}, the spec pins ${spec.tools.bun}`);

// The CLI's production target reads an RPC URL from the environment; `hash` never calls it.
const env = { ...process.env, ETH_MAINNET_RPC_URL: process.env.ETH_MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com" };
const run = spawnSync(
	"cre",
	["workflow", "hash", `./${spec.workflow}`, "--target", spec.target, "--non-interactive", "--public_key", owner, "--config", configPath],
	{ cwd: root, env, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 16 * 1024 * 1024 },
);
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
const grab = (label: string): string | null => out.match(new RegExp(`${label} hash:\\s+([0-9a-f]{64})`))?.[1] ?? null;
const binary = grab("Binary");
const cliConfig = grab("Config");
const workflow = grab("Workflow");
if (run.status !== 0 || binary === null || cliConfig === null || workflow === null) fail(`cre workflow hash did not finish:\n${out.trim()}`);
if (cliConfig !== configSha) fail(`the CLI hashed a config other than the one written (${cliConfig} vs ${configSha})`);

const id = `0x${workflow}`;
const checks = [
	["config", configSha, expect.config],
	["binary", binary, expect.binary],
	["id", id, expect.id],
] as const;
const mismatched = checks.filter(([, got, want]) => want !== undefined && got !== want);
const result = {
	spec: specPath,
	name: spec.name,
	owner,
	config: values,
	tools: { cre: creVersion, bun: bunVersion },
	hashes: { config: configSha, binary, id },
	matches: Object.fromEntries(checks.map(([k, got, want]) => [k, want === undefined ? "no expectation" : got === want])),
	notes: toolNotes,
};
if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
else {
	console.log(`${spec.name}: ${id}`);
	for (const [k, got, want] of checks) console.log(`  ${k.padEnd(7)} ${got}  ${want === undefined ? "(no expectation)" : got === want ? "matches" : `DIFFERS from ${want}`}`);
	for (const n of toolNotes) console.log(`  note: ${n}`);
}
process.exit(mismatched.length === 0 ? 0 : 1);
