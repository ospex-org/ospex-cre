// Never: "The dollar goes to the transaction sender."
//
// The wrapper's half: the payout field of a score or a void is the operator's address from the
// fingerprinted files, handed to the program from the config and put by the program in the report's
// own field; a start and a dispute record carry the zero address. Nothing in the wrapper knows a
// sender: the transaction is the forwarder's, sent by a node that this file never sees, and no field
// of the report comes from anywhere but the program's decision and the config.
//
// The break that turns this red (run.ts, runGame):
//   const written = encodeReport(outcome.report);
//   ->  const written = encodeReport({ ...outcome.report, payout: "0x16Dc5D67D080a5521ef2c79680dBfC2aBf724D30" });

import { describe, expect, test } from "bun:test";
import { NOW } from "../scoring/test/cases";
import { KEY, saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { decodeReport, encodeReport, keysFor } from "./lib";
import { runGame } from "./run";
import { GAMES, ZERO, creationOf, fakeChain, recordingWriter } from "./test-helpers";

const KEYS = keysFor({ 4: KEY });
const OTHER = "0x00000000000000000000000000000000000b2b2b";

function written(game: ReturnType<typeof chainOf>, now: number, payout: string) {
	const writer = recordingWriter();
	const run = runGame({ evm: fakeChain(game, now), games: GAMES, payout, keys: KEYS, send: saved(undefined, now).send, write: writer.write }, creationOf(game));
	return { run, bytes: writer.written };
}

describe("never: the dollar goes to the transaction sender", () => {
	test("a score carries the payout from the config, and only that field moves when the config does", () => {
		const game = chainOf("nba final, read after the game");
		const after = game.start! + game.n + 60;
		const a = written(game, after, PAYOUT);
		const b = written(game, after, OTHER);
		expect(a.run.decision.action).toBe("score");
		expect(decodeReport(a.bytes[0]).payout).toBe(PAYOUT);
		expect(decodeReport(b.bytes[0]).payout).toBe(OTHER);
		expect({ ...decodeReport(a.bytes[0]), payout: null }).toEqual({ ...decodeReport(b.bytes[0]), payout: null });
	});

	test("a start carries the zero address, whatever the config's payout", () => {
		const base = chainOf("nfl not final");
		const unverified = { ...base, status: "unverified" as const, start: null, startReadings: null };
		const a = written(unverified, NOW, PAYOUT);
		expect(a.run.decision.action).toBe("start");
		expect(decodeReport(a.bytes[0]).kind).toBe(1);
		expect(decodeReport(a.bytes[0]).payout).toBe(ZERO);
	});

	test("the payout occupies one word of the report and nothing else in the bytes names an address", () => {
		const game = chainOf("nba final, read after the game");
		const after = game.start! + game.n + 60;
		const a = written(game, after, PAYOUT);
		const r = decodeReport(a.bytes[0]);
		expect(r.payout).toBe(PAYOUT);
		// The same report with the payout zeroed differs from the written bytes in exactly one 32-byte word,
		// and that word is the payout: no other word carries it, and no word carries another address.
		const zeroed = encodeReport({ ...r, payout: ZERO });
		const words = (hex: string) => hex.slice(2).match(/.{64}/g) ?? [];
		const differing = words(a.bytes[0]).map((w, i) => [i, w, words(zeroed)[i]] as const).filter(([, x, y]) => x !== y);
		expect(differing.length).toBe(1);
		expect(differing[0][1]).toBe(PAYOUT.slice(2).toLowerCase().padStart(64, "0"));
		expect(differing[0][2]).toBe("0".repeat(64));
	});
});
