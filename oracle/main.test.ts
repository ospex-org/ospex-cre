import { describe, expect, test } from "bun:test";
import {
	parseIsoToUnixSeconds,
	floorToHour,
	packIdentity,
	americanToOddsTick,
	normalizeOdds,
	extractMarketTicks,
	isFinalFlag,
	evmAddressSchema,
	CHAINS,
	resolveChainSelector,
} from "./lib";

describe("parseIsoToUnixSeconds", () => {
	test("matches well-known UTC epochs", () => {
		expect(parseIsoToUnixSeconds("1970-01-01T00:00:00Z")).toBe(0);
		expect(parseIsoToUnixSeconds("2000-01-01T00:00:00Z")).toBe(946684800);
		expect(parseIsoToUnixSeconds("2021-01-01T00:00:00Z")).toBe(1609459200);
	});

	test("treats a missing timezone as UTC (deterministic across nodes)", () => {
		expect(parseIsoToUnixSeconds("2026-09-10T17:00:00")).toBe(
			parseIsoToUnixSeconds("2026-09-10T17:00:00Z"),
		);
	});

	test("applies an explicit +/- offset", () => {
		const utc = parseIsoToUnixSeconds("2026-09-10T17:00:00Z");
		expect(parseIsoToUnixSeconds("2026-09-10T13:00:00-04:00")).toBe(utc);
		expect(parseIsoToUnixSeconds("2026-09-10T18:30:00+01:30")).toBe(utc);
	});

	test("handles fractional seconds and a space separator", () => {
		expect(parseIsoToUnixSeconds("2026-09-10 17:00:00.123Z")).toBe(
			parseIsoToUnixSeconds("2026-09-10T17:00:00Z"),
		);
	});

	test("handles the leap day", () => {
		const feb29 = parseIsoToUnixSeconds("2024-02-29T00:00:00Z");
		const mar01 = parseIsoToUnixSeconds("2024-03-01T00:00:00Z");
		expect(mar01 - feb29).toBe(86400);
	});

	test("throws on garbage", () => {
		expect(() => parseIsoToUnixSeconds("not-a-date")).toThrow();
	});
});

describe("floorToHour", () => {
	test("rounds down to the start of the UTC hour", () => {
		const top = parseIsoToUnixSeconds("2026-09-10T17:00:00Z");
		expect(floorToHour(top)).toBe(top);
		expect(floorToHour(top + 1799)).toBe(top); // +29:59 -> same hour
		expect(floorToHour(top + 3599)).toBe(top); // +59:59 -> same hour
		expect(floorToHour(top + 3600)).toBe(top + 3600);
	});
});

describe("packIdentity", () => {
	test("matches convertContestDataToUint256: league*1e18 + away*1e14 + home*1e10 + eventTime", () => {
		const t = 1789059600;
		const expected =
			2n * 1_000_000_000_000_000_000n +
			100n * 100_000_000_000_000n +
			200n * 10_000_000_000n +
			BigInt(t);
		expect(packIdentity(2, t, 100, 200)).toBe(expected);
	});

	test("two providers describing the same game pack identically", () => {
		expect(packIdentity(3, 1789059600, 58, 12)).toBe(packIdentity(3, 1789059600, 58, 12));
	});

	test("a team mismatch changes the packed identity", () => {
		expect(packIdentity(3, 1789059600, 58, 12)).not.toBe(packIdentity(3, 1789059600, 58, 13));
	});
});

describe("americanToOddsTick", () => {
	test("matches OracleModule.americanToOddsTick (ODDS_SCALE = 100)", () => {
		expect(americanToOddsTick(0)).toBe(0); // missing / pick-em sentinel
		expect(americanToOddsTick(150)).toBe(250); // +150 -> 2.50
		expect(americanToOddsTick(100)).toBe(200); // even money -> 2.00
		expect(americanToOddsTick(-110)).toBe(191); // round-to-nearest, not 190
		expect(americanToOddsTick(-200)).toBe(150); // -200 -> 1.50
		expect(americanToOddsTick(-105)).toBe(195);
		expect(americanToOddsTick(-115)).toBe(187);
		expect(americanToOddsTick(-170)).toBe(159);
		expect(americanToOddsTick(-10000)).toBe(101); // clamp floor
	});
});

describe("normalizeOdds", () => {
	test("clamps to [-10000, 10000] and zeroes falsy/NaN", () => {
		expect(normalizeOdds(0)).toBe(0);
		expect(normalizeOdds(Number.NaN)).toBe(0);
		expect(normalizeOdds(-110)).toBe(-110);
		expect(normalizeOdds(-20000)).toBe(-10000);
		expect(normalizeOdds(20000)).toBe(10000);
	});
});

describe("extractMarketTicks", () => {
	test("full market -> the 8 updateContestMarkets fields", () => {
		const t = extractMarketTicks({
			MoneyLineAway: "150",
			MoneyLineHome: "-170",
			PointSpreadAway: "-1.5",
			PointSpreadAwayLine: "-110",
			PointSpreadHomeLine: "-110",
			TotalNumber: "8.5",
			OverLine: "-105",
			UnderLine: "-115",
		});
		expect(t).toEqual({
			moneylineAwayOdds: 250,
			moneylineHomeOdds: 159,
			spreadLineTicks: -15,
			spreadAwayOdds: 191,
			spreadHomeOdds: 191,
			totalLineTicks: 85,
			overOdds: 195,
			underOdds: 187,
		});
	});

	test("pick 'em substitutes spread odds for the missing moneyline", () => {
		const t = extractMarketTicks({
			MoneyLineAway: "0",
			MoneyLineHome: "0",
			PointSpreadAway: "0.0",
			PointSpreadAwayLine: "-110",
			PointSpreadHomeLine: "-110",
			TotalNumber: "9",
			OverLine: "-110",
			UnderLine: "-110",
		});
		expect(t.moneylineAwayOdds).toBe(191);
		expect(t.moneylineHomeOdds).toBe(191);
		expect(t.spreadLineTicks).toBe(0);
		expect(t.totalLineTicks).toBe(90);
	});

	test("throws when a required odds tick is zero (incomplete market)", () => {
		expect(() =>
			extractMarketTicks({
				MoneyLineAway: "",
				MoneyLineHome: "-170",
				PointSpreadAway: "-1.5",
				PointSpreadAwayLine: "-110",
				PointSpreadHomeLine: "-110",
				TotalNumber: "8.5",
				OverLine: "-105",
				UnderLine: "-115",
			}),
		).toThrow();
	});

	test("throws on a negative total (ContestModule rejects totalLineTicks < 0)", () => {
		expect(() =>
			extractMarketTicks({
				MoneyLineAway: "150",
				MoneyLineHome: "-170",
				PointSpreadAway: "-1.5",
				PointSpreadAwayLine: "-110",
				PointSpreadHomeLine: "-110",
				TotalNumber: "-1",
				OverLine: "-105",
				UnderLine: "-115",
			}),
		).toThrow();
	});
});

describe("isFinalFlag", () => {
	test("accepts boolean true and the string 'true' only", () => {
		expect(isFinalFlag(true)).toBe(true);
		expect(isFinalFlag("true")).toBe(true);
		expect(isFinalFlag("True")).toBe(true);
		expect(isFinalFlag(false)).toBe(false);
		expect(isFinalFlag("false")).toBe(false);
		expect(isFinalFlag(undefined)).toBe(false);
	});
});

describe("evmAddressSchema", () => {
	// Synthetic addresses only — fixtures must not pin the public repo to any real operator wallet.
	test("accepts a valid 20-byte address (any case)", () => {
		const mixedCase = "0xAbCdeF0123456789AbCdeF0123456789aBcDeF01";
		expect(evmAddressSchema.parse(mixedCase)).toBe(mixedCase);
		expect(evmAddressSchema.safeParse("0x1234567890123456789012345678901234567890").success).toBe(true);
	});

	test("rejects the zero address (unfilled placeholder) and malformed input", () => {
		expect(evmAddressSchema.safeParse("0x0000000000000000000000000000000000000000").success).toBe(false);
		expect(evmAddressSchema.safeParse("0x123").success).toBe(false); // too short
		expect(evmAddressSchema.safeParse("abcdef0123456789abcdef0123456789abcdef01").success).toBe(false); // no 0x
		expect(evmAddressSchema.safeParse("").success).toBe(false);
	});
});

describe("resolveChainSelector / CHAINS", () => {
	// Selector + chainId values are pinned against @chainlink/cre-sdk's generated chain-selectors.
	// A wrong mainnet selector would silently route every report to the wrong chain, so guard both.
	test("CHAINS matches the cre-sdk chain-selectors (selector + chainId)", () => {
		expect(CHAINS["polygon-testnet-amoy"]).toEqual({ selector: 16281711391670634445n, chainId: 80002 });
		expect(CHAINS["polygon-mainnet"]).toEqual({ selector: 4051577828743386545n, chainId: 137 });
	});

	test("resolves the target selector when name and chainId agree", () => {
		expect(resolveChainSelector("polygon-testnet-amoy", 80002)).toBe(16281711391670634445n);
		expect(resolveChainSelector("polygon-mainnet", 137)).toBe(4051577828743386545n);
	});

	test("fails closed when chainSelectorName and chainId disagree", () => {
		expect(() => resolveChainSelector("polygon-mainnet", 80002)).toThrow(); // mainnet name + Amoy id
		expect(() => resolveChainSelector("polygon-testnet-amoy", 137)).toThrow(); // Amoy name + mainnet id
	});
});
