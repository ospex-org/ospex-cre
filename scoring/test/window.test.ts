import { describe, expect, test } from "bun:test";
import { filingDates, inWindow, parseIsoSeconds, windowOf } from "../src/window";

describe("parseIsoSeconds", () => {
	test("agrees with the platform's parser over 2020 to 2035, every 7 h 13 m 11 s, in four zone spellings", () => {
		let checked = 0;
		for (let t = Date.UTC(2020, 0, 1) / 1000; t < Date.UTC(2035, 0, 1) / 1000; t += 7 * 3600 + 13 * 60 + 11) {
			const z = new Date(t * 1000).toISOString(); // 2026-10-22T16:02:16.000Z
			expect(parseIsoSeconds(z)).toBe(t);
			expect(parseIsoSeconds(z.replace(".000Z", "Z"))).toBe(t);
			expect(parseIsoSeconds(z.replace(".000Z", "+00:00"))).toBe(t);
			const shifted = new Date((t - 4 * 3600) * 1000).toISOString().replace(".000Z", "-04:00");
			expect(parseIsoSeconds(shifted)).toBe(t);
			checked++;
		}
		expect(checked).toBeGreaterThan(18000);
	});

	test("refuses a time with no zone, a date with no time, and impossible dates", () => {
		for (const s of [
			"2026-10-22T16:02:16",
			"2026-10-22",
			"2026-02-29T00:00:00Z",
			"2026-13-01T00:00:00Z",
			"2026-04-31T00:00:00Z",
			"2026-10-22T24:00:00Z",
			"",
			"not a time",
		]) {
			expect({ s, v: parseIsoSeconds(s) }).toEqual({ s, v: null });
		}
		expect(parseIsoSeconds(1792684936)).toBeNull();
		expect(parseIsoSeconds(null)).toBeNull();
		expect(parseIsoSeconds("2028-02-29T00:00:00Z")).toBe(Date.UTC(2028, 1, 29) / 1000);
	});
});

describe("the window", () => {
	const game = { league: "nfl", home: "a", away: "b", start: 1_792_000_000, n: 86_400, hints: [] };
	const w = windowOf(game);

	test("is [start, start + n): the start is in, start + n is out", () => {
		expect(inWindow(game.start, w)).toBe(true);
		expect(inWindow(game.start + game.n - 1, w)).toBe(true);
		expect(inWindow(game.start + game.n, w)).toBe(false);
		expect(inWindow(game.start - 1, w)).toBe(false);
	});

	test("takes its length from the game's n and nothing else", () => {
		for (const n of [3600, 86_400, 172_800]) {
			const v = windowOf({ ...game, n });
			expect(v).toEqual({ from: game.start, to: game.start + n });
		}
	});
});

describe("filingDates", () => {
	test("runs from the day before the window's first UTC date through its last", () => {
		// 00:15 UTC on 20 Oct 2026 is 8:15 pm on the 19th in New York.
		expect(filingDates({ from: Date.UTC(2026, 9, 20, 0, 15) / 1000, to: Date.UTC(2026, 9, 21, 0, 15) / 1000 })).toEqual([
			"2026-10-19",
			"2026-10-20",
			"2026-10-21",
		]);
		// A window that ends exactly at midnight does not reach the next date.
		expect(filingDates({ from: Date.UTC(2026, 9, 20) / 1000, to: Date.UTC(2026, 9, 21) / 1000 })).toEqual([
			"2026-10-19",
			"2026-10-20",
		]);
		// Across a month and a year end.
		expect(filingDates({ from: Date.UTC(2026, 11, 31, 23) / 1000, to: Date.UTC(2027, 0, 1, 23) / 1000 })).toEqual([
			"2026-12-30",
			"2026-12-31",
			"2027-01-01",
		]);
	});

	test("every US local date of every instant in the window is among them", () => {
		const zones = [-4, -5, -6, -7, -8, -9, -10]; // Eastern daylight through Hawaii
		for (let from = Date.UTC(2026, 0, 1) / 1000; from < Date.UTC(2027, 0, 1) / 1000; from += 5 * 3600 + 17 * 60) {
			const w = { from, to: from + 86_400 };
			const dates = new Set(filingDates(w));
			for (let t = w.from; t < w.to; t += 3600) {
				expect(dates.has(new Date(t * 1000).toISOString().slice(0, 10))).toBe(true);
				for (const h of zones) expect(dates.has(new Date((t + h * 3600) * 1000).toISOString().slice(0, 10))).toBe(true);
			}
		}
	});
});
