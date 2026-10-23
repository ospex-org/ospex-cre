// The saved answers are the program's pinned cases, so they must be the exact bytes that came
// back, and the table must stay the only file that names a feed.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SEATS } from "../src/table";
import { INDEX, KEY, ROOT, at, bytesOf, saved } from "./fixtures";

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

	test("a test must say which moment it reads: a missing clock is refused, a clock is served", () => {
		expect(() => saved(undefined, undefined as unknown as number)).toThrow("the clock is required");
		expect(() => saved(undefined, "2026-10-22T17:30:00Z" as unknown as number)).toThrow("the clock is required");
		// An unreadable number is still a clock: a test of a program that must refuse one hands the
		// same clock to its transport and expects nothing to be asked.
		expect(() => saved(undefined, Number.NaN)).not.toThrow();
		// The control: with a clock, a saved request is answered.
		const e = INDEX[0];
		const row = SEATS.find((r) => r.seat === e.seat)!;
		const t = saved(undefined, Date.parse(e.capturedAt) / 1000);
		expect(t.send({ url: `https://${row.host}${e.path}`, method: "GET", headers: {} }).status).toBe(e.status);
		expect(t.misses).toEqual([]);
	});

	test("a clock in milliseconds is refused; both infinities are still clocks", () => {
		const ms = Date.parse("2026-10-22T17:00:00Z"); // before the game, in milliseconds
		expect(() => saved(undefined, ms)).toThrow("milliseconds");
		expect(() => saved(undefined, ms / 1000)).not.toThrow();
		expect(() => saved(undefined, Number.POSITIVE_INFINITY)).not.toThrow();
		expect(() => saved(undefined, Number.NEGATIVE_INFINITY)).not.toThrow();
	});

	test("a capture's own second reads that capture, whatever its milliseconds", () => {
		// The night's answer for the Bears' result, saved at 03:31:10.473 UTC, final; the afternoon's,
		// on the same path, not final. A clock of 03:31:10 is that capture's second.
		const path = "/results/edcfd41f-1773-4bc9-a349-aa50931a0278";
		const night = INDEX.find((x) => x.seat === 3 && x.path === path && x.capturedAt.startsWith("2026-10-23"))!;
		expect(night.capturedAt).toBe("2026-10-23T03:31:10.473Z");
		const row = SEATS.find((r) => r.seat === 3)!;
		const read = (clock: number) => {
			const t = saved(undefined, clock);
			return JSON.parse(t.send({ url: `https://${row.host}${path}`, method: "GET", headers: {} }).body).find((r: Record<string, unknown>) => r.OddType === "Game").FinalType;
		};
		expect(read(at("2026-10-23T03:31:10Z"))).toBe("Finished");
		expect(read(at("2026-10-23T03:31:09Z"))).toBe("NotFinished");
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
