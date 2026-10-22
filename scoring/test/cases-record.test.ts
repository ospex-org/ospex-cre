// Every case in cases/, replayed: the program must reach the case's outcome from the case's own
// payloads, ask for exactly those payloads, and find their bytes unchanged. A case names feeds by
// seat only.

import { describe, expect, test } from "bun:test";
import { SEATS } from "../src/table";
import { loadCases, replay } from "./replay";

const cases = loadCases();

describe("the cases record", () => {
	test("there are cases to replay", () => {
		expect(cases.length).toBeGreaterThanOrEqual(5);
	});

	for (const { file, c } of cases) {
		test(`${file}: ${c.what}`, () => {
			expect(c.case).toBe(file.replace(/\.json$/, ""));
			const r = replay(c);
			expect({ changed: r.changed, unlisted: r.unlisted, unasked: r.unasked }).toEqual({ changed: [], unlisted: [], unasked: [] });
			expect(r.outcome).toEqual(c.outcome);
		});
	}

	test("no case names a feed: a feed is its seat", () => {
		const names = SEATS.flatMap((r) => [r.name, ...r.alsoKnownAs, r.host, r.host.split(".").slice(-2, -1)[0]]).map((s) => s.toLowerCase());
		for (const { file, text } of cases) {
			const lower = text.toLowerCase();
			expect({ file, named: names.filter((n) => lower.includes(n)) }).toEqual({ file, named: [] });
		}
	});

	test("the harness fails a case whose payload changed, whose run asks for more, or whose outcome differs", () => {
		const { c } = cases.find((x) => x.file.includes("rainout"))!;
		const changed = replay({ ...c, payloads: c.payloads.map((p, i) => (i === 0 ? { ...p, sha256: "0".repeat(64) } : p)) });
		expect(changed.changed.length).toBe(1);
		expect(changed.unlisted.length).toBe(1);
		const fewer = replay({ ...c, payloads: c.payloads.slice(1) });
		expect(fewer.unlisted).toEqual([`seat ${c.payloads[0].seat} ${c.payloads[0].path}`]);
		const extra = replay({ ...c, payloads: [...c.payloads, { seat: 4, path: "/never/asked", sha256: c.payloads[0].sha256 }] });
		expect(extra.unasked).toEqual(["seat 4 /never/asked"]);
		// The outcome is compared whole, down to one reading's kind: a case that wrote the spare as
		// answered when the run read it silent would not match.
		const report = c.outcome.report!;
		const misread = { ...c.outcome, report: { ...report, readings: report.readings.map((r) => (r[0] === 4 ? ([4, 1, 0, 0] as const) : r)) } };
		expect(replay(c).outcome).toEqual(c.outcome);
		expect(replay(c).outcome).not.toEqual(misread);
	});
});
