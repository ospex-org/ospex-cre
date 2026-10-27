// Never: "The dollar goes to an address where it literally can't be withdrawn."
//
// The wrapper's half, in two places. The config refuses a payout the games set would refuse for
// where it lies before any id is computed: the zero address, the reserved range up to 0xffff, the
// reporter and the games set itself, and the template's placeholder. And at the run the wrapper
// hands the program what the games set refuses by what it is: the set's address, its coin, and every
// reporter, present or retired, read from the chain, so the program refuses such a payout before a
// report is sent. The program's own check is its never-line; what is held here is that the wrapper
// gives it the chain's list, and that the list has the retired reporter the approved list no longer shows.
//
// The break that turns this red (chain.ts, readPayoutRefused):
//   if (kind !== 0) reporters.push(payout);
//   ->  the line removed.
// And a second (lib.ts, configSchema): the superRefine on payoutAddress removed.

import { describe, expect, test } from "bun:test";
import { KEY, saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { readPayoutRefused } from "./chain";
import { configSchema, keysFor } from "./lib";
import { runGame } from "./run";
import { COIN, GAMES, REPORTER, RETIRED, creationOf, fakeChain, recordingWriter } from "./test-helpers";

const KEYS = keysFor({ 4: KEY });
const VALID = {
	receiverAddress: REPORTER,
	eventAddress: GAMES,
	chainSelectorName: "polygon-mainnet",
	chainId: 137,
	secretOwner: "0x40047BAFcdEd16C938058b7b67186299a2893561",
	secretNamespace: "main",
	payoutAddress: PAYOUT,
};

describe("never: the dollar goes where it cannot be withdrawn", () => {
	test("the config refuses a payout the games set would refuse for where it lies, and the placeholder", () => {
		const refused = [
			"0x0000000000000000000000000000000000000000",
			"0x0000000000000000000000000000000000000001",
			"0x000000000000000000000000000000000000ffff",
			REPORTER,
			GAMES,
			REPORTER.toLowerCase(),
			"PAYOUT_ADDRESS_NOT_SET",
			"0x12",
			"",
		];
		for (const payoutAddress of refused) {
			expect({ payoutAddress, ok: configSchema.safeParse({ ...VALID, payoutAddress }).success }).toEqual({ payoutAddress, ok: false });
		}
		for (const payoutAddress of ["0x0000000000000000000000000000000000010000", PAYOUT, "0x16Dc5D67D080a5521ef2c79680dBfC2aBf724D30"]) {
			expect({ payoutAddress, ok: configSchema.safeParse({ ...VALID, payoutAddress }).success }).toEqual({ payoutAddress, ok: true });
		}
	});

	test("the run hands the program the set, its coin and its reporters, retired ones included when the payout is one", () => {
		const game = chainOf("nba final, read after the game");
		const chain = fakeChain(game, game.start! + game.n + 60);
		// A payout never approved: the list is the approved list plus the game's own reporters.
		expect(readPayoutRefused(chain, GAMES, [REPORTER], PAYOUT)).toEqual({ gamesSet: GAMES, coin: COIN, reporters: [REPORTER] });
		// A retired reporter, which the approved list no longer shows: the games set still says it was one.
		expect(readPayoutRefused(chain, GAMES, [REPORTER], RETIRED).reporters).toEqual([REPORTER, RETIRED]);
		// A present reporter is listed once.
		expect(readPayoutRefused(chain, GAMES, [REPORTER], REPORTER).reporters).toEqual([REPORTER]);
		// The game's own recorded reporters count too, whatever the approved list says now.
		const another = "0x9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f";
		expect(readPayoutRefused(chain, GAMES, [another], PAYOUT).reporters).toEqual([REPORTER, another]);
	});

	test("a payout the games set refuses by what it is stops the run before anything is written", () => {
		const game = chainOf("nba final, read after the game");
		const after = game.start! + game.n + 60;
		for (const [payout, why] of [
			[RETIRED, "approved as a reporter"],
			[REPORTER, "approved as a reporter"],
			[COIN, "the coin"],
			[GAMES, "the games set"],
		] as const) {
			const writer = recordingWriter();
			const go = () => runGame({ evm: fakeChain(game, after), games: GAMES, payout, keys: KEYS, send: saved(undefined, after).send, write: writer.write }, creationOf(game));
			expect(go).toThrow(why);
			expect(writer.written.length).toBe(0);
		}
		// The control: a payout the games set takes is written.
		const writer = recordingWriter();
		runGame({ evm: fakeChain(game, after), games: GAMES, payout: PAYOUT, keys: KEYS, send: saved(undefined, after).send, write: writer.write }, creationOf(game));
		expect(writer.written.length).toBe(1);
	});
});
