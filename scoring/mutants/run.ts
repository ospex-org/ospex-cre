#!/usr/bin/env bun
// The mutation battery: each one-line edit in manifest.json applied on its own, the suite run against
// it, and the file put back from its saved bytes. It writes into the source files while it runs, so
// run it in a clean clone, and run nothing else in that clone meanwhile.
//
//   bun scoring/mutants/run.ts [--only id,id,...] [--timeout seconds]
//
// Paths are the repository's, from this file's own folder, so it runs from anywhere. A mutant in
// build/ runs build's tests (`bun test build/` at the root); any other runs the scoring suite (`bun
// test` in scoring/). Each suite is run once unedited first, as the baseline, and must pass.
//
// Each mutant is scored:
//   KILLED    the suite failed: a test failed, or the run exited non-zero
//   SURVIVED  every test passed, and as many ran as in the baseline
//   INVALID   the anchor isn't in the file exactly once, the edit changes nothing, the edited file
//             doesn't parse, or the suite ran a different number of tests from the baseline
//   HUNG      the suite ran past the timeout; its whole process tree is killed, and the file put back
// An anchor is matched against the file's own line endings, so the manifest reads the same on a
// checkout with LF or CRLF. Two entries are controls ("control": true), edits to a comment: each must
// survive, or the battery is measuring something other than the tests. An entry with "survives"
// says why it is expected to survive: an edit shown to change nothing the program does.
//
// Output: one JSON line per mutant on stdout, then a summary line; progress on stderr. The suites
// run with no seat key in their environment and HTTP(S) sent to a dead port.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface Mutant {
	readonly id: string;
	readonly file: string;
	readonly from: string;
	readonly to: string;
	readonly control?: boolean;
	readonly survives?: string;
}
type Verdict = "KILLED" | "SURVIVED" | "INVALID" | "HUNG";

const ROOT = resolve(import.meta.dir, "..", "..");
const MANIFEST: readonly Mutant[] = JSON.parse(readFileSync(join(import.meta.dir, "manifest.json"), "utf8"));

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i < 0 ? undefined : process.argv[i + 1];
}
const only = arg("--only")?.split(",");
const timeoutMs = Number(arg("--timeout") ?? "240") * 1000;
const chosen = only === undefined ? MANIFEST : MANIFEST.filter((m) => only.includes(m.id));

const ids = MANIFEST.map((m) => m.id);
const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
if (twice.length > 0) fail(`ids used twice in the manifest: ${[...new Set(twice)].join(", ")}`);

const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^OSPEX_SEAT\d_KEY$/.test(k)) env[k] = v;
for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) env[k] = "http://127.0.0.1:9";
env.NO_COLOR = "1";

interface Suite {
	readonly name: string;
	readonly cwd: string;
	readonly args: readonly string[];
}
const SCORING: Suite = { name: "scoring", cwd: join(ROOT, "scoring"), args: ["test"] };
const BUILD: Suite = { name: "build", cwd: ROOT, args: ["test", "build/"] };
const suiteOf = (m: Mutant): Suite => (m.file.startsWith("build/") ? BUILD : SCORING);

function fail(message: string, code = 3): never {
	console.error(`battery: ${message}`);
	process.exit(code);
}

function sha(b: Uint8Array): string {
	return createHash("sha256").update(b).digest("hex");
}

/** Writes a file whole, through a temporary file renamed over it. */
function put(path: string, bytes: Uint8Array): void {
	const tmp = `${path}.battery.tmp`;
	writeFileSync(tmp, bytes);
	renameSync(tmp, path);
}

function killTree(pid: number): void {
	if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
	else {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

function runSuite(s: Suite): Promise<{ code: number | null; hung: boolean; out: string; secs: number }> {
	const t0 = Date.now();
	return new Promise((done) => {
		const child = spawn(process.execPath, [...s.args], { cwd: s.cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		let hung = false;
		const timer = setTimeout(() => {
			hung = true;
			if (child.pid !== undefined) killTree(child.pid);
		}, timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			done({ code, hung, out, secs: Math.round((Date.now() - t0) / 100) / 10 });
		});
	});
}

/** Bun's summary lines: "N pass", "N fail", "Ran N tests across F files", and each "(fail) name". */
function read(out: string): { pass: number | null; fail: number; ran: number | null; red: string[] } {
	const text = out.replace(/\x1b\[[0-9;]*m/g, "");
	const n = (re: RegExp): number | null => {
		const m = re.exec(text);
		return m === null ? null : Number(m[1]);
	};
	const red = [...text.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?\s*$/gm)].map((m) => m[1]);
	return { pass: n(/^\s*(\d+) pass\s*$/m), fail: n(/^\s*(\d+) fail\s*$/m) ?? 0, ran: n(/^Ran (\d+) tests? across/m), red };
}

// The file being edited, so an interrupt puts it back.
let current: { path: string; bytes: Uint8Array } | null = null;
process.on("SIGINT", () => {
	if (current !== null) put(current.path, current.bytes);
	process.exit(130);
});

const baseline = new Map<string, number>();
for (const s of new Set(chosen.map(suiteOf))) {
	const r = await runSuite(s);
	const got = read(r.out);
	if (r.hung || r.code !== 0 || got.fail !== 0 || got.ran === null || got.pass !== got.ran) {
		fail(`the ${s.name} suite does not pass unedited (exit ${r.code}, ${got.pass} pass, ${got.fail} fail, ${got.ran} ran)`);
	}
	baseline.set(s.name, got.ran);
	console.error(`baseline ${s.name}: ${got.ran} tests pass (${r.secs} s)`);
}

const transpiler = new Bun.Transpiler({ loader: "ts" });
const tally: Record<Verdict, number> = { KILLED: 0, SURVIVED: 0, INVALID: 0, HUNG: 0 };
const results: { id: string; verdict: Verdict; control: boolean; survives: string | null }[] = [];

for (const m of chosen) {
	const path = join(ROOT, m.file);
	const original = new Uint8Array(readFileSync(path));
	const text = new TextDecoder().decode(original);
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const from = m.from.replaceAll("\n", eol);
	const to = m.to.replaceAll("\n", eol);
	const row: Record<string, unknown> = { id: m.id, file: m.file, control: m.control === true };
	if (m.survives !== undefined) row.survives = m.survives;
	let verdict: Verdict;
	const count = text.split(from).length - 1;
	const mutated = count === 1 ? text.replace(from, () => to) : text;
	let parses = true;
	if (count === 1 && mutated !== text) {
		try {
			transpiler.transformSync(mutated);
		} catch (e) {
			parses = false;
			row.why = `does not parse: ${String((e as Error).message ?? e).split("\n")[0]}`;
		}
	}
	if (count !== 1) {
		verdict = "INVALID";
		row.why = `the anchor occurs ${count} times`;
	} else if (mutated === text) {
		verdict = "INVALID";
		row.why = "the edit changes nothing";
	} else if (!parses) {
		verdict = "INVALID";
	} else {
		current = { path, bytes: original };
		let r: Awaited<ReturnType<typeof runSuite>>;
		try {
			put(path, new TextEncoder().encode(mutated));
			r = await runSuite(suiteOf(m));
		} finally {
			put(path, original);
			current = null;
			if (sha(new Uint8Array(readFileSync(path))) !== sha(original)) fail(`could not put ${m.file} back`, 2);
		}
		const got = read(r.out);
		// Every failing test by name, never a cut list: its length is the count a report quotes, beside `fail`.
		Object.assign(row, { exit: r.code, ran: got.ran, pass: got.pass, fail: got.fail, red: got.red, secs: r.secs });
		const base = baseline.get(suiteOf(m).name);
		if (r.hung) verdict = "HUNG";
		else if (r.code !== 0 || got.fail > 0) verdict = "KILLED";
		else if (got.ran !== base) {
			verdict = "INVALID";
			row.why = `the suite ran ${got.ran} tests, the baseline ${base}`;
		} else verdict = "SURVIVED";
	}
	row.verdict = verdict;
	tally[verdict]++;
	results.push({ id: m.id, verdict, control: m.control === true, survives: m.survives ?? null });
	console.log(JSON.stringify(row));
	console.error(`${m.id.padStart(8)} ${verdict.padEnd(9)} ${row.why ?? `${row.fail ?? ""} red`}`);
}

const controls = results.filter((r) => r.control);
const survivors = results.filter((r) => !r.control && r.verdict === "SURVIVED");
console.log(
	JSON.stringify({
		summary: true,
		mutants: results.length,
		...tally,
		controls: Object.fromEntries(controls.map((r) => [r.id, r.verdict])),
		controlsSurvived: controls.every((r) => r.verdict === "SURVIVED"),
		expectedSurvivors: survivors.filter((r) => r.survives !== null).map((r) => r.id),
		unexpectedSurvivors: survivors.filter((r) => r.survives === null).map((r) => r.id),
		expectedButKilled: results.filter((r) => r.survives !== null && r.verdict !== "SURVIVED").map((r) => r.id),
	}),
);
