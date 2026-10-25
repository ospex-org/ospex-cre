// The shapes the scoring script reads and returns. Nothing here names a feed: outside
// table.ts a feed is its seat number.

/** A seat in the feed table. Seats 1 to 3 count; seat 4 is the spare. */
export type Seat = 1 | 2 | 3 | 4;

/**
 * One game, as the chain holds it. Every field is read from the games set: its creation
 * (league, teams, which one is home, hints), its start (written once at verification) and its n.
 */
export interface Game {
	/** The short text id the creator gave, e.g. "nfl". */
	readonly league: string;
	/** The home team's text, as created. */
	readonly home: string;
	/** The away team's text, as created. */
	readonly away: string;
	/** The game's start, unix seconds. */
	readonly start: number;
	/** The game's n, in seconds. The window is [start, start + n). */
	readonly n: number;
	/**
	 * The creation hints: a feed's own id for this game, by seat. At seats 1, 2 and 4 a hint only
	 * chooses among records with the game's two teams and a time inside the window; a hinted record
	 * that fails either is never read. Seat 3 is read by its hint and nothing else: its
	 * results carry no team names and no game time, so the hint is the one thing that ties a result
	 * to this game. Verification checks that hint against seat 3's board (the game's two teams, home
	 * and away as created, at the start) while the game is still listed.
	 */
	readonly hints: ReadonlyArray<{ readonly seat: number; readonly id: string }>;
}

/**
 * What one feed said about one game, one of three kinds: silent (it could not answer about this
 * game), answered without a final, and answered with a final.
 */
export interface Reading {
	readonly seat: Seat;
	readonly kind: "silent" | "no_final" | "final";
	/**
	 * The home team's points; null when the feed gave none. At seats 1, 2 and 4 they are matched to
	 * the team by its name, never by the feed's home slot. Seat 3's results carry no names, so its
	 * points are the feed's own home slot, tied to the game by the hint (see readers/seat3.ts).
	 */
	readonly home: number | null;
	/** The away team's points, the same way; null when the feed gave none. */
	readonly away: number | null;
	/** Postponed or cancelled, where the feed records it. Recorded only: it decides nothing. */
	readonly recorded: "postponed" | "canceled" | null;
	/** Why the reading is what it is, in a word or two, for the record and the tests. */
	readonly detail: string;
	/**
	 * The feed's record the reading rests on: its id, and its own game time in unix seconds (null
	 * for seat 3, whose results carry no time).
	 */
	readonly record: { readonly id: string; readonly time: number | null } | null;
	/**
	 * Set on a silent reading whose feed says the game is over all the same: a final without points,
	 * or one the feed's own count shows short of a whole game. Silent, it decides nothing at scoring;
	 * verification, which writes no start for a game already over, reads it.
	 */
	readonly saysFinal?: true;
}

/** One HTTP request a reader asks for. The key sits where the feed table says. */
export interface HttpRequest {
	readonly method: "GET";
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
}

/** What came back. The body is the raw text; readers parse it themselves. */
export interface HttpResponse {
	readonly status: number;
	readonly body: string;
}

/**
 * A reader's run: it yields the requests it needs, one at a time, and returns its reading.
 * The same run is driven by a synchronous transport (the Chainlink workflow), an asynchronous one
 * (a sealed machine's fetch) or saved responses (the tests).
 */
export type ReaderRun = Generator<HttpRequest, Reading, HttpResponse>;

/** What a reader needs to ask about a game. */
export interface Ask {
	readonly game: Game;
	/** The run's own clock, unix seconds: it decides only whether the feed can still answer. */
	readonly now: number;
	/** This seat's key and nothing else. */
	readonly key: string;
	/**
	 * Verification only, before a start is written: the creator's date. Among the game's records in
	 * the window, the one nearest it is the game. Without it, more than one leaves the feed silent
	 * unless a hint chooses (src/pick.ts).
	 */
	readonly near?: number;
}
