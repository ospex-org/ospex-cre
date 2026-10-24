// A workflow's config, written byte for byte the same on every machine.
//
// The workflow id hashes the config's exact bytes, so a checkout's line endings or an editor's
// whitespace would move the fingerprint. The config is therefore never taken from a working tree as
// it stands: it is the committed template, parsed, with the deploy's values set, written back as
// two-space JSON with LF line endings and one trailing newline. Only fields the template already
// has can be set, and only to strings, so a value cannot add a field or change a field's type.

import { createHash } from "node:crypto";

export function configBytes(template: string, values: Readonly<Record<string, string>>): Uint8Array {
	const parsed: unknown = JSON.parse(template);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("the config template is not a JSON object");
	const obj = parsed as Record<string, unknown>;
	for (const [k, v] of Object.entries(values)) {
		if (!Object.prototype.hasOwnProperty.call(obj, k)) throw new Error(`the config template has no field ${k}`);
		if (typeof obj[k] !== "string") throw new Error(`the config field ${k} is not a string`);
		if (typeof v !== "string") throw new Error(`the value for ${k} is not a string`);
		obj[k] = v;
	}
	return new TextEncoder().encode(`${JSON.stringify(obj, null, 2)}\n`);
}

export function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** The fingerprint script's arguments, read. */
export interface Args {
	readonly spec: string;
	readonly set: Readonly<Record<string, string>>;
	readonly owner: string | null;
	readonly json: boolean;
}

/**
 * Reads the fingerprint script's arguments: one spec path, `--set key=value` any number of times,
 * `--owner 0x...` at most once, and `--json`. A flag's value may follow it or be joined to it with
 * "=" (`--set=key=value`, `--owner=0x...`). Anything else is refused rather than skipped: a
 * mistyped flag that was skipped would hash the spec's own values and report them as matching.
 */
export function parseArgs(argv: readonly string[]): Args {
	let spec: string | null = null;
	const set: Record<string, string> = {};
	let owner: string | null = null;
	let json = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("-")) {
			if (spec !== null) throw new Error(`one spec only: got ${spec} and ${a}`);
			spec = a;
			continue;
		}
		const eq = a.indexOf("=");
		const flag = eq < 0 ? a : a.slice(0, eq);
		if (flag === "--json") {
			if (eq >= 0) throw new Error("--json takes no value");
			json = true;
			continue;
		}
		if (flag !== "--set" && flag !== "--owner") throw new Error(`unknown flag ${flag}`);
		let value: string;
		if (eq >= 0) value = a.slice(eq + 1);
		else {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("-")) throw new Error(`${flag} wants a value`);
			value = next;
			i++;
		}
		if (flag === "--owner") {
			if (owner !== null) throw new Error("--owner given twice");
			owner = value;
			continue;
		}
		const at = value.indexOf("=");
		if (at <= 0 || at === value.length - 1) throw new Error(`--set wants key=value, got ${value}`);
		const key = value.slice(0, at);
		if (Object.prototype.hasOwnProperty.call(set, key)) throw new Error(`--set ${key} given twice`);
		set[key] = value.slice(at + 1);
	}
	if (spec === null) throw new Error("no spec given");
	return { spec, set, owner, json };
}

/**
 * The workflow name a target in workflow.yaml gives, or null. A target is a top-level key; its
 * `workflow-name` is looked for only among its own indented lines, up to the next top-level key.
 */
export function workflowName(yaml: string, target: string): string | null {
	const lines = yaml.split(/\r?\n/);
	const at = lines.findIndex((l) => l.trimEnd() === `${target}:`);
	if (at < 0) return null;
	for (const l of lines.slice(at + 1)) {
		if (l.trim() === "" || l.trimStart().startsWith("#")) continue;
		if (!/^\s/.test(l)) return null;
		const m = /^\s+workflow-name:\s*(.*?)\s*$/.exec(l);
		if (m !== null) return m[1].replace(/^"(.*)"$/, "$1");
	}
	return null;
}
