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
