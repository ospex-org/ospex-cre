// The saved answers are the program's pinned cases, so they must be the exact bytes that came
// back, and the table must stay the only file that names a feed.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SEATS } from "../src/table";
import { INDEX, KEY, ROOT, bytesOf } from "./fixtures";

const SCORING = join(import.meta.dir, "..");
const TABLE = join(SCORING, "src", "table.ts");

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		if (name === "node_modules") continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...walk(p));
		else out.push(p);
	}
	return out;
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every way the table names a feed: its name, its other names, and the distinctive labels of its host. */
function feedTokens(): string[] {
	const generic = new Set(["api", "com", "io", "p", "www", "net", "org"]);
	const tokens = new Set<string>();
	for (const row of SEATS) {
		for (const n of [row.name, ...row.alsoKnownAs]) tokens.add(squash(n));
		for (const label of row.host.split(".")) if (!generic.has(label)) tokens.add(squash(label));
	}
	return [...tokens].filter((t) => t.length >= 6);
}

describe("saved answers", () => {
	test("every indexed answer is on disk with its exact bytes", () => {
		expect(INDEX.length).toBeGreaterThan(0);
		for (const e of INDEX) {
			const bytes = bytesOf(e.file);
			expect({ file: e.file, bytes: bytes.length }).toEqual({ file: e.file, bytes: e.bytes });
			expect({ file: e.file, sha256: createHash("sha256").update(bytes).digest("hex") }).toEqual({
				file: e.file,
				sha256: e.sha256,
			});
		}
	});

	test("every answer on disk is indexed, once", () => {
		const onDisk = walk(ROOT)
			.map((p) => relative(ROOT, p).split(sep).join("/"))
			.filter((p) => p !== "index.json")
			.sort();
		const indexed = INDEX.map((e) => e.file).sort();
		expect(onDisk).toEqual(indexed);
		expect(new Set(indexed).size).toBe(indexed.length);
	});

	test("the index keeps paths, never a host or a key", () => {
		for (const e of INDEX) {
			expect(e.path.startsWith("/")).toBe(true);
			expect(e.path).not.toContain("://");
			for (const row of SEATS) {
				if ("query" in row.key && e.seat === row.seat) {
					const m = new RegExp(`[?&]${row.key.query}=([^&]*)`).exec(e.path);
					expect(m?.[1]).toBe(KEY);
				}
			}
		}
	});
});

describe("feeds are seats", () => {
	const tokens = feedTokens();

	test("the table names every seat's feed", () => {
		const table = squash(readFileSync(TABLE, "utf8"));
		expect(tokens.length).toBeGreaterThanOrEqual(SEATS.length);
		for (const t of tokens) expect({ token: t, inTable: table.includes(t) }).toEqual({ token: t, inTable: true });
	});

	test("no file in the scoring program but the table names a feed or its host", () => {
		const offenders: string[] = [];
		for (const p of walk(SCORING)) {
			if (p === TABLE) continue;
			const text = squash(new TextDecoder().decode(readFileSync(p)));
			for (const t of tokens) if (text.includes(t)) offenders.push(`${relative(SCORING, p)}: ${t.length} chars`);
		}
		expect(offenders).toEqual([]);
	});
});
