// Never: "The program takes which feeds to ask, or how many must agree, from anything outside the
// fingerprint. Only the keys and the payout address come from outside, and neither can touch the
// score."
//
// The wrapper's half: what it hands the program from outside is the keys and the payout address, and
// nothing else. Its config, which the id hashes, is strict and names no seat, no count and no rule; the
// keys it builds name only the table's seats, a header seat's key being the enclave's stand-in and
// never a value the config or the environment could put there.
//
// The break that turns this red (lib.ts, keysFor):
//   for (const row of SEATS) { ... }
//   ->  for (const seat of Object.keys(queryKeys).map(Number) as Seat[]) { out[seat] = queryKeys[seat]; }

import { describe, expect, test } from "bun:test";
import { SEATS } from "../scoring/src/table";
import type { Seat } from "../scoring/src/types";
import { configSchema, keysFor, placeholderFor, querySeats, secretOfHeader } from "./lib";

const VALID = {
	receiverAddress: "0x4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e",
	eventAddress: "0x6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e6a6e",
	chainSelectorName: "polygon-mainnet",
	chainId: 137,
	secretOwner: "0x40047BAFcdEd16C938058b7b67186299a2893561",
	secretNamespace: "main",
	payoutAddress: "0x00000000000000000000000000000000000a1a1a",
};

describe("never: nothing outside the fingerprint chooses the feeds or the counts", () => {
	test("the config is seven deploy values and refuses any other field", () => {
		const ok = configSchema.safeParse(VALID);
		expect(ok.success).toBe(true);
		expect(Object.keys(ok.success ? ok.data : {}).sort()).toEqual(
			["chainId", "chainSelectorName", "eventAddress", "payoutAddress", "receiverAddress", "secretNamespace", "secretOwner"],
		);
		for (const extra of [{ seats: [1, 2] }, { agree: 2 }, { counting: [1, 2, 3] }, { feeds: {} }, { rule: "afterN" }, { schedule: "* * * * *" }]) {
			const r = configSchema.safeParse({ ...VALID, ...extra });
			expect({ extra, refused: !r.success }).toEqual({ extra, refused: true });
		}
	});

	test("the chain is named once: a selector name beside another chain's id is refused", () => {
		expect(configSchema.safeParse({ ...VALID, chainId: 80002 }).success).toBe(false);
		expect(configSchema.safeParse({ ...VALID, chainSelectorName: "polygon-testnet-amoy", chainId: 80002 }).success).toBe(true);
	});

	test("the keys name the table's seats and no other", () => {
		const tableSeats = SEATS.map((r) => r.seat);
		expect(Object.keys(keysFor({})).map(Number).sort()).toEqual(tableSeats.filter((s) => !querySeats().includes(s)).sort());
		expect(Object.keys(keysFor({ 4: "k4" })).map(Number).sort()).toEqual([...tableSeats].sort());
		// A seat the table lacks is not handed in, whatever the argument carries.
		const extra = keysFor({ 4: "k4", 5: "k5", 9: "k9" } as unknown as Partial<Record<Seat, string>>);
		expect(Object.keys(extra).map(Number).sort()).toEqual([...tableSeats].sort());
	});

	test("a header seat's key is the enclave's stand-in, never a value handed in", () => {
		const keys = keysFor({ 1: "a value", 2: "another", 3: "a third", 4: "k4" });
		for (const row of SEATS) {
			if ("header" in row.key) {
				expect(keys[row.seat]).toBe(placeholderFor(row.seat));
				expect(secretOfHeader(keys[row.seat] as string)).toBe(`SEAT${row.seat}_KEY`);
			} else {
				expect(keys[row.seat]).toBe("k4");
			}
		}
		// A plain value in a header is not a stand-in.
		expect(secretOfHeader("SEATKEY")).toBeNull();
		expect(secretOfHeader("{{.seat1}}")).toBeNull();
	});

	test("the query seat is the spare, as the table says, and an empty value hands nothing in", () => {
		expect([...querySeats()]).toEqual([4]);
		expect(4 in keysFor({ 4: "" })).toBe(false);
	});
});
