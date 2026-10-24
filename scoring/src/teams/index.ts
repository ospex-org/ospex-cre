// The team lists, by league: every spelling the four seats use for each team, generated from the
// seats' own team lists and the saved answers by capture/teams.ts. Frozen at load, like the feed
// table, and part of the fingerprint.

import type { Team } from "../teams";
import { MLB } from "./mlb";
import { NBA } from "./nba";
import { NCAAB } from "./ncaab";
import { NCAAF } from "./ncaaf";
import { NFL } from "./nfl";
import { NHL } from "./nhl";

function freeze(teams: readonly Team[]): readonly Team[] {
	for (const t of teams) {
		Object.freeze(t.names);
		Object.freeze(t);
	}
	return Object.freeze(teams);
}

export const TEAMS: Readonly<Record<string, readonly Team[]>> = Object.freeze({
	nfl: freeze(NFL),
	nba: freeze(NBA),
	mlb: freeze(MLB),
	nhl: freeze(NHL),
	ncaaf: freeze(NCAAF),
	ncaab: freeze(NCAAB),
});
