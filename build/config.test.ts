// The config writer, checked without the CRE CLI: from the committed template and v2's public
// addresses it writes the exact 310 bytes v2's workflow was registered with, whatever line endings
// the template was checked out with.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configBytes, sha256 } from "./config";

const root = join(import.meta.dir, "..");
const spec = JSON.parse(readFileSync(join(import.meta.dir, "v2-osverify.json"), "utf8"));
const template = readFileSync(join(root, spec.configTemplate), "utf8");

describe("the config writer", () => {
	test("v2's registered config, from the template and three public addresses", () => {
		const bytes = configBytes(template, spec.config);
		expect([bytes.length, sha256(bytes)]).toEqual([310, spec.expect.config]);
	});

	test("the same bytes from a template checked out with CRLF line endings", () => {
		const crlf = template.replace(/\r?\n/g, "\r\n");
		expect(sha256(configBytes(crlf, spec.config))).toBe(spec.expect.config);
	});

	test("a value can set only a string field the template has", () => {
		expect(() => configBytes(template, { unknownField: "x" })).toThrow("no field unknownField");
		expect(() => configBytes(template, { chainId: "1" })).toThrow("not a string");
		// One address changed moves the bytes, and so the fingerprint.
		expect(sha256(configBytes(template, { ...spec.config, receiverAddress: "0x0000000000000000000000000000000000000001" }))).not.toBe(spec.expect.config);
	});
});
