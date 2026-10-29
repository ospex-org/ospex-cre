// The replay command (replay.ts) prints each seat's reading of one game from the saved answers.
// It is the stranger's way to see a case read; here it must say what the suite says.

import { describe, expect, test } from "bun:test";
import { replay } from "../replay";
import { CASES } from "./cases";

describe("replay", () => {
	test("a saved case replays to the readings the case expects, seat by seat", () => {
		const c = CASES.find((x) => x.name.startsWith("nba final, read after the game"))!;
		expect(replay(c.game, c.now)).toEqual([
			"Cleveland Cavaliers at Philadelphia 76ers (nba), window 2026-10-22T23:00:00Z + 86400 s, read as of 2026-10-23T03:32:00Z",
			"  seat 1: final 114-106 (home-away), final, record 21717860 at 2026-10-22T23:00:00Z; 1 request",
			"  seat 2: final 114-106 (home-away), final, record 340484 at 2026-10-22T23:00:00Z; 2 requests",
			"  seat 3: final 114-106 (home-away), final, record cc394a49-c3d1-4b8c-bba2-8ebbb8326c09; 1 request",
			"  seat 4: final 114-106 (home-away), final, record 110e33c79c5ec8c0377702aff685f83b at 2026-10-22T23:13:54Z; 1 request",
		]);
	});

	test("a request with no saved answer is listed, and the seat reads silent", () => {
		const c = CASES.find((x) => x.name.startsWith("nba final: Golden State"))!;
		const lines = replay({ ...c.game, start: c.game.start - 30 * 86400 }, c.now);
		expect(lines[1]).toBe("  seat 1: silent, transport; 1 request");
		expect(lines[2]).toBe("    no saved answer: seat 1 /v1/games?dates[]=2026-09-21&dates[]=2026-09-22&dates[]=2026-09-23&team_ids[]=14&team_ids[]=10&per_page=100 (no saved page /v1/games?dates[]=2026-09-21&per_page=100)");
	});
});
