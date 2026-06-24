// Pure, deterministic helpers for the Ospex verify workflow. Kept in a separate module so
// they can be unit-tested (bun test) without violating the CRE rule that the workflow ENTRY
// module (main.ts) may only export the parameterless `main`.

/**
 * Parse an ISO-8601 datetime to unix SECONDS, interpreting a missing timezone as UTC.
 * Pure integer arithmetic (days-from-civil) — no `Date`, no runtime-timezone dependence,
 * so every DON node computes the same value.
 */
export function parseIsoToUnixSeconds(input: string): number {
	const s = input.trim();
	const m = s.match(
		/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/,
	);
	if (!m) throw new Error(`unparseable datetime: ${input}`);
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const hour = Number(m[4]);
	const minute = Number(m[5]);
	const second = m[6] ? Number(m[6]) : 0;

	// days from civil (Howard Hinnant), valid across the Gregorian range.
	const y = month <= 2 ? year - 1 : year;
	const era = Math.floor((y >= 0 ? y : y - 399) / 400);
	const yoe = y - era * 400;
	const doy = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	const days = era * 146097 + doe - 719468;

	let ts = days * 86400 + hour * 3600 + minute * 60 + second;

	// apply explicit offset; missing tz ⇒ UTC.
	const tz = m[7];
	if (tz && tz !== "Z") {
		const sign = tz[0] === "-" ? -1 : 1;
		const oh = Number(tz.slice(1, 3));
		const om = Number(tz.slice(tz.length - 2));
		ts -= sign * (oh * 3600 + om * 60);
	}
	return ts;
}

/** Round a unix-seconds timestamp down to the start of its UTC hour. */
export function floorToHour(unixSeconds: number): number {
	return Math.floor(unixSeconds / 3600) * 3600;
}

/**
 * Packed contest identity used ONLY for the cross-provider agreement check (mirrors
 * convertContestDataToUint256 in contestCreation.js): league·1e18 + away·1e14 + home·1e10 + eventTime.
 */
export function packIdentity(league: number, eventTime: number, away: number, home: number): bigint {
	return (
		BigInt(league) * 1_000_000_000_000_000_000n +
		BigInt(away) * 100_000_000_000_000n +
		BigInt(home) * 10_000_000_000n +
		BigInt(eventTime)
	);
}

// ──────────────────────────── Market helpers (ported) ───────────────
//
// The legacy Functions market path (contestMarketsUpdate.js) packed 8 fields into one uint256 that
// OracleModule.extractContestMarketData then unpacked into updateContestMarkets' args. Under CRE we
// compute those FINAL args directly and abi.encode them — no packed-uint256 intermediate. These
// helpers reproduce the exact on-chain semantics: american odds (+10000-offset packing removed) →
// decimal odds tick via OracleModule.americanToOddsTick (ODDS_SCALE = 100); spread/total →
// Math.round(x*10) (the +1000/-1000 offset round-trips to identity).

const ODDS_SCALE = 100;

/** Raw JsonOdds `Odds[0]` shape (fields arrive as strings; coerced defensively below). */
export interface RawOdds {
	MoneyLineAway?: string | number;
	MoneyLineHome?: string | number;
	PointSpreadAway?: string | number; // away spread number, e.g. "-1.5"
	PointSpreadAwayLine?: string | number; // away spread odds (american)
	PointSpreadHomeLine?: string | number;
	TotalNumber?: string | number; // e.g. "8.5"
	OverLine?: string | number;
	UnderLine?: string | number;
}

/** The 8 final values consumed by ContestModule.updateContestMarkets. */
export interface MarketTicks {
	moneylineAwayOdds: number;
	moneylineHomeOdds: number;
	spreadLineTicks: number; // int32: round(spread*10), may be negative
	spreadAwayOdds: number;
	spreadHomeOdds: number;
	totalLineTicks: number; // int32: round(total*10), must be >= 0 on-chain
	overOdds: number;
	underOdds: number;
}

/** Clamp american odds to [-10000, 10000]; falsy/NaN → 0. Mirrors normalizeOdds in the JS source. */
export function normalizeOdds(odds: number): number {
	if (!odds) return 0;
	if (odds < -10000) return -10000;
	if (odds > 10000) return 10000;
	return odds;
}

/**
 * American odds (already normalizeOdds-clamped) → decimal odds tick (×100). Mirrors
 * OracleModule.americanToOddsTick with ODDS_SCALE = 100. american === 0 is the "no odds / missing"
 * sentinel and maps to tick 0 (which ContestModule rejects, so incomplete markets fail on-chain).
 *   +150 → 250 (2.50);  -110 → 191 (1.91);  -200 → 150 (1.50);  +100 → 200 (2.00).
 */
export function americanToOddsTick(american: number): number {
	if (american === 0) return 0;
	if (american > 0) return ODDS_SCALE + american;
	const abs = -american;
	// Solidity integer math: (ODDS_SCALE*100 + abs/2) / abs, all floor division.
	const profit = Math.floor((ODDS_SCALE * 100 + Math.floor(abs / 2)) / abs);
	return ODDS_SCALE + profit;
}

/**
 * Extract the 8 updateContestMarkets fields from a JsonOdds `Odds[0]` object, reproducing
 * convertFullMarketDataToUint256 (incl. the pick'em substitution) + extractContestMarketData.
 * Throws if the resulting market is incomplete in a way ContestModule would reject (any zero odds
 * tick, a non-finite spread/total, or a negative total) — fail here rather than waste a DON tx.
 */
export function extractMarketTicks(odds: RawOdds): MarketTicks {
	let moneylineAway = odds.MoneyLineAway;
	let moneylineHome = odds.MoneyLineHome;
	let spreadNumber: string | number | undefined = odds.PointSpreadAway;
	const spreadAwayLine = odds.PointSpreadAwayLine;
	const spreadHomeLine = odds.PointSpreadHomeLine;
	const totalNumber = odds.TotalNumber;
	const overLine = odds.OverLine;
	const underLine = odds.UnderLine;

	// Pick 'em: no moneyline, spread ~0, but spread odds exist → use spread odds as moneyline.
	const mlAwayEmpty = moneylineAway === "0" || !moneylineAway || moneylineAway === 0;
	const mlHomeEmpty = moneylineHome === "0" || !moneylineHome || moneylineHome === 0;
	if (
		mlAwayEmpty &&
		mlHomeEmpty &&
		(spreadNumber === "0.0" || Math.abs(parseFloat(String(spreadNumber))) < 0.1) &&
		spreadAwayLine &&
		spreadHomeLine
	) {
		moneylineAway = spreadAwayLine;
		moneylineHome = spreadHomeLine;
		spreadNumber = "0.0";
	}

	const ticks: MarketTicks = {
		moneylineAwayOdds: americanToOddsTick(normalizeOdds(parseInt(String(moneylineAway), 10))),
		moneylineHomeOdds: americanToOddsTick(normalizeOdds(parseInt(String(moneylineHome), 10))),
		spreadLineTicks: Math.round(parseFloat(String(spreadNumber)) * 10),
		spreadAwayOdds: americanToOddsTick(normalizeOdds(parseInt(String(spreadAwayLine), 10))),
		spreadHomeOdds: americanToOddsTick(normalizeOdds(parseInt(String(spreadHomeLine), 10))),
		totalLineTicks: Math.round(parseFloat(String(totalNumber)) * 10),
		overOdds: americanToOddsTick(normalizeOdds(parseInt(String(overLine), 10))),
		underOdds: americanToOddsTick(normalizeOdds(parseInt(String(underLine), 10))),
	};

	// Mirror ContestModule.updateContestMarkets validation so we fail in-workflow, not on-chain.
	if (
		ticks.moneylineAwayOdds === 0 ||
		ticks.moneylineHomeOdds === 0 ||
		ticks.spreadAwayOdds === 0 ||
		ticks.spreadHomeOdds === 0 ||
		ticks.overOdds === 0 ||
		ticks.underOdds === 0
	) {
		throw new Error("market: missing/zero odds tick (incomplete market data)");
	}
	if (!Number.isFinite(ticks.spreadLineTicks) || !Number.isFinite(ticks.totalLineTicks)) {
		throw new Error("market: non-finite spread/total number");
	}
	if (ticks.totalLineTicks < 0) {
		throw new Error(`market: negative total ${ticks.totalLineTicks}`);
	}
	return ticks;
}

/**
 * Treat a JsonOdds `Final` flag as final. The source returns a boolean; we also accept the string
 * "true" defensively. (The legacy JS used a bare truthy check, which would wrongly accept the string
 * "false" — this is the corrected, stricter form.)
 */
export function isFinalFlag(v: unknown): boolean {
	return v === true || (typeof v === "string" && v.toLowerCase() === "true");
}
