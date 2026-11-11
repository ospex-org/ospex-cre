// Never: "The old workflow retired, or an existing game moved, as part of this. Approval admits the new
// reporter for future games beside the old one, both stay eligible for new games and both crons scan
// old games, until the old is retired on its own card."
//
// This workflow's half. It registers under a name of its own, so its registration never replaces the
// live workflow's, and the live workflow's build spec stays as it was, rebuildable at its own commit.
// Its rows name it. Its tick reads the open list whole: a game whose recorded reporters are the old
// reporter alone is probed and read like any other, and the write goes to this workflow's own reporter
// from the config, never to the game's; the games set holds each game to the reporters it was created
// with, so nothing here moves one.
//
// The break that turns this red:
//   workflow.yaml: the live workflow's name,
//     workflow-name: "osgames2"  ->  workflow-name: "osgames"
//   with which registration would replace the live workflow.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainGame } from "../scoring/src/chain";
import { LATE } from "../scoring/test/cases";
import { saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { workflowName } from "../build/config";
import { decodeReport, type Config } from "./lib";
import { WORKFLOW_NAME, type Row } from "./runline";
import { standIn, tickPayload } from "./stand-in-sdk";
import { GAMES, REPORTER, fakeChainOf } from "./test-helpers";

/** The live workflow, registered from main 1058f20: its name and the id its reporter fixes. */
const LIVE = { name: "osgames", id: "0x000411d08fb9976d6e7c8695b591783fbc060b1f1648dd8113271fb618193119" };
/** A reporter approved before this one: the only reporter recorded for the old game. */
const OLD = "0x0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d";

const CONFIG: Config = {
	receiverAddress: REPORTER,
	eventAddress: GAMES,
	chainSelectorName: "polygon-mainnet",
	chainId: 137,
	secretOwner: "0x1111111111111111111111111111111111111111",
	secretNamespace: "old-test",
	payoutAddress: PAYOUT,
	schedule: "0 */5 * * * *",
	shards: 1,
	runLineUrl: "https://db.example.test/rest/v1/run_lines",
};
const sdk = await standIn(CONFIG);

describe("never: the old workflow retired, or a game moved", () => {
	test("this workflow registers under its own name, beside the live one's, and its rows carry that name", () => {
		const yaml = readFileSync(join(import.meta.dir, "workflow.yaml"), "utf8");
		expect(workflowName(yaml, "production-settings")).toBe(WORKFLOW_NAME);
		expect(WORKFLOW_NAME).not.toBe(LIVE.name);
		expect(WORKFLOW_NAME).toBe("osgames2");
	});

	test("the live workflow's build spec is as it was: its name and the id its reporter fixes", () => {
		const spec = JSON.parse(readFileSync(join(import.meta.dir, "..", "build", "v3-osgames.json"), "utf8")) as { name: string; expect: { id: string } };
		expect([spec.name, spec.expect.id]).toEqual([LIVE.name, LIVE.id]);
	});

	test("a game recorded with the old reporter alone is probed and read like any other, and the write goes to this workflow's reporter, never the game's", () => {
		const old: ChainGame = { ...chainOf("nba final, read after the game"), id: "1" };
		const t = saved(undefined, LATE);
		const r = sdk.handle(1, tickPayload(LATE), {
			evm: fakeChainOf([old], LATE, { approved: [REPORTER, OLD], reporters: { "1": [OLD] } }),
			vault: { SEAT1_KEY: "s1", SEAT2_KEY: "s2", SEAT3_KEY: "s3", SEAT4_KEY: "SEATKEY", RUN_LINE_KEY: "k", RUN_LINE_APIKEY: "a" },
			feed: (_seat, req) => t.send(req),
			push: () => ({ status: 201, body: "" }),
			writeError: null,
		});
		expect(r.threw).toBeNull();
		expect(r.events.filter((e) => e === "send 3").length).toBe(1);
		expect(r.writes.map((w) => [w.receiver, decodeReport(w.report).gameId])).toEqual([[REPORTER, "1"]]);
		const rows = r.logs.filter((l) => l.startsWith("run-line {")).map((l) => JSON.parse(l.slice("run-line ".length)) as Row);
		expect(rows.map((x) => x.workflow)).toEqual(["osgames2", "osgames2", "osgames2", "osgames2"]);
	});
});
