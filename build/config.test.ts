// The config writer, checked without the CRE CLI: from the committed template and v2's public
// addresses it writes the exact 310 bytes v2's workflow was registered with, whatever line endings
// the template was checked out with. Then the fingerprint script's arguments, and the workflow name
// it reads from workflow.yaml.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configBytes, parseArgs, sha256, workflowName } from "./config";

describe("the fingerprint script's arguments", () => {
	const A = "0x0000000000000000000000000000000000000001";
	const B = "0x0000000000000000000000000000000000000002";
	test("each form of a flag reads the same, the spaced and the joined", () => {
		const rows: [string, string[], ReturnType<typeof parseArgs>][] = [
			["the spec alone", ["s.json"], { spec: "s.json", set: {}, owner: null, json: false }],
			["--set k=v", ["s.json", "--set", `receiverAddress=${A}`], { spec: "s.json", set: { receiverAddress: A }, owner: null, json: false }],
			["--set=k=v", ["s.json", `--set=receiverAddress=${A}`], { spec: "s.json", set: { receiverAddress: A }, owner: null, json: false }],
			["a value holding =", ["s.json", "--set", "k=a=b"], { spec: "s.json", set: { k: "a=b" }, owner: null, json: false }],
			["--owner 0x", ["s.json", "--owner", A], { spec: "s.json", set: {}, owner: A, json: false }],
			["--owner=0x", ["s.json", `--owner=${A}`], { spec: "s.json", set: {}, owner: A, json: false }],
			["flags before the spec", ["--json", "--set", `eventAddress=${B}`, "s.json"], { spec: "s.json", set: { eventAddress: B }, owner: null, json: true }],
			["every field", ["s.json", "--set", `receiverAddress=${A}`, "--set", `eventAddress=${A}`, "--set", `secretOwner=${B}`, "--owner", B, "--json"], { spec: "s.json", set: { receiverAddress: A, eventAddress: A, secretOwner: B }, owner: B, json: true }],
		];
		for (const [what, argv, want] of rows) expect({ what, got: parseArgs(argv) }).toEqual({ what, got: want });
	});

	test("an unknown flag, a second spec, a flag without its value, or a field set twice is refused", () => {
		const rows: [string, string[], string][] = [
			["a mistyped flag", ["s.json", "--sett", `receiverAddress=${A}`], "unknown flag --sett"],
			["a single-dash flag", ["s.json", "-set", `receiverAddress=${A}`], "unknown flag -set"],
			["a flag the script doesn't take", ["s.json", "--target", "staging-settings"], "unknown flag --target"],
			["a second spec", ["s.json", "t.json"], "one spec only: got s.json and t.json"],
			["a value for --set, spaced by mistake", ["s.json", "--set", "receiverAddress", A], "--set wants key=value, got receiverAddress"],
			["--set at the end", ["s.json", "--set"], "--set wants a value"],
			["--owner at the end", ["s.json", "--owner"], "--owner wants a value"],
			["--set before another flag", ["s.json", "--set", "--json"], "--set wants a value"],
			["--set without =", ["s.json", "--set=receiverAddress"], "--set wants key=value, got receiverAddress"],
			["--set with an empty value", ["s.json", "--set", "receiverAddress="], "--set wants key=value, got receiverAddress="],
			["--set with an empty key", ["s.json", "--set", `=${A}`], `--set wants key=value, got =${A}`],
			["a field set twice", ["s.json", "--set", `receiverAddress=${A}`, "--set", `receiverAddress=${B}`], "--set receiverAddress given twice"],
			["--owner twice", ["s.json", "--owner", A, "--owner", B], "--owner given twice"],
			["--json with a value", ["s.json", "--json=1"], "--json takes no value"],
			["no spec", ["--json"], "no spec given"],
		];
		for (const [what, argv, message] of rows) {
			let got = "accepted";
			try {
				parseArgs(argv);
			} catch (e) {
				got = (e as Error).message;
			}
			expect({ what, got }).toEqual({ what, got: message });
		}
	});
});

describe("the workflow name a target gives", () => {
	const yaml = readFileSync(join(import.meta.dir, "..", "oracle", "workflow.yaml"), "utf8");
	test("each target's own name, read from v2's workflow.yaml as checked out, with LF or CRLF", () => {
		for (const text of [yaml.replace(/\r\n/g, "\n"), yaml.replace(/\r?\n/g, "\r\n")]) {
			expect([workflowName(text, "staging-settings"), workflowName(text, "production-settings"), workflowName(text, "no-such-settings")]).toEqual(["osverify", "osverify", null]);
		}
	});

	test("a target without a workflow-name never borrows the next target's", () => {
		const two = ["first-settings:", "  workflow-artifacts:", '    workflow-path: "./main.ts"', "# a comment", "", "second-settings:", "  user-workflow:", '    workflow-name: "other"', ""].join("\n");
		expect([workflowName(two, "first-settings"), workflowName(two, "second-settings")]).toEqual([null, "other"]);
		// An indented key of the same name is not a target.
		expect(workflowName(["outer:", "  first-settings:", "    workflow-name: x"].join("\n"), "first-settings")).toBeNull();
	});
});

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
