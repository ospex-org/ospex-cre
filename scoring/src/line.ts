// A word on a line is a word. The readers put every feed string they place on a reading through the one
// quoting helper here (`quoted`): JSON, so every string the feed sent stands in double quotes (an
// unrecognized status, the game's row's word beside a refusal, an id that is not the feed's shape, a
// final flag, the older status field a short final carries). A word the reader matched against its own
// list stands as the list's word (`final`, `in progress`). A feed can put anything in a field: a request
// URL with its key, a header's key echoed back. So every line goes through `cleanLine` before it is
// written, and every `why` before it leaves the program (program.ts, outcomeOf; games/run.ts and
// games/tick.ts, where the wrapper's lines are made; games/main.ts, the creation handler's line and the
// error it throws again). It does three things:
//
//   by value  Each quoted word is read as JSON reads it, and one holding a configured secret value
//             becomes "[redacted]". The decoded word is compared, not the raw text, so a key holding
//             `"` or `\`, which the quoted word writes escaped, is found as it is. Then any secret value
//             left anywhere, as given or as JSON writes it, is redacted too.
//   by shape  A quoted word stands verbatim only as a short plain word: 16 characters or fewer of
//             letters, digits, spaces and `/ : . -`, and never a URL. Anything else, however short,
//             becomes `[not a status word]`. The real status words (`in progress`, `NotFinished`,
//             `Not Started`, `postponed`, `cancelled`, `Finished`, `PPD`) are 12 characters or fewer,
//             so the line keeps its diagnostic value for each; the older date-time field seat 1 can
//             fall back to (19 characters) is noise and is marked.
//   unquoted  A run of text outside the quoted words carrying `://`, `?` or `=` becomes the marker
//             too: the premise above holds by construction in the readers, and this holds where it
//             might not.
//
// The key the workflow holds is the query key (seat 4's): it is a value here, redacted in both its forms.
// A key that goes in a header is never the workflow's to hold: the workflow hands in a stand-in, the
// platform fills it on the way out, and the value never enters the workflow, so no line can redact it
// by value (keys.ts). The word rule is its protection: a feed string on a line is a short plain word or
// the marker. A feed string of 16 plain characters or fewer stands whatever it is: a header key that
// short, or part of a longer one a feed chose to echo; that is the residual this rule accepts. One
// function, not one at each reader (test/line.test.ts and test/status.test.ts hold it,
// ../games/line.test.ts at the handlers' own log calls; the breaks are in their headers).

import type { Keys } from "./keys";

/** What a feed string that is not a word becomes on a line. */
export const NOT_A_WORD = "[not a status word]";
/** What a configured secret value becomes on a line. */
export const REDACTED = "[redacted]";
/** The most characters a feed's word may carry and stand on a line verbatim. */
export const WORD_LENGTH = 16;

/** The characters a word is made of: letters, digits, spaces, and / : . - */
const PLAIN = /^[A-Za-z0-9 /:.-]*$/;
/** What a URL or a query carries and no word does. */
const URL_MARKS = /:\/\/|[?=]/;
/** A quoted word, as JSON writes a string; or a run of anything else but spaces and double quotes. */
const TOKEN = /"(?:[^"\\]|\\.)*"|[^\s"]+/g;

/** A feed string may stand on a line verbatim only as a short plain word, and never as a URL. */
export function sayable(word: string): boolean {
	return word.length <= WORD_LENGTH && PLAIN.test(word) && !URL_MARKS.test(word);
}

/**
 * The one quoting helper: a feed's value as a reading carries it, written as JSON, so every string the
 * feed sent stands in double quotes, where `cleanLine` finds it and reads it.
 */
export function quoted(value: unknown): string {
	return String(JSON.stringify(value));
}

/** The configured secret values: every seat's key as handed to the program, empty ones aside. */
export function secretsOf(keys: Keys): string[] {
	return Object.values(keys).filter((k): k is string => typeof k === "string" && k !== "");
}

/** A quoted word as JSON reads it, or null when JSON can't read it as a string. */
function decoded(token: string): string | null {
	try {
		const v: unknown = JSON.parse(token);
		return typeof v === "string" ? v : null;
	} catch {
		return null;
	}
}

/**
 * The line as it may be written. Each quoted word, decoded: one holding a secret is "[redacted]", a short
 * plain word stays, anything else is the marker. Each run outside the quoted words carrying a URL's or a
 * query's marks is the marker. Then each secret value left, as given or as JSON writes it, is redacted.
 * Cleaning a line already cleaned changes nothing.
 */
export function cleanLine(text: string, secrets: readonly string[]): string {
	const held = secrets.filter((s) => s !== "");
	let out = text.replace(TOKEN, (token: string) => {
		if (!token.startsWith('"')) return URL_MARKS.test(token) ? NOT_A_WORD : token;
		const word = decoded(token);
		if (word === null) return NOT_A_WORD;
		// A word that already is the redaction stays one: a `why` is cleaned again where the wrapper's line
		// is made, and a second pass changes nothing.
		if (word === REDACTED || held.some((s) => word.includes(s))) return `"${REDACTED}"`;
		return sayable(word) ? token : NOT_A_WORD;
	});
	for (const s of held) out = out.split(s).join(REDACTED).split(quoted(s).slice(1, -1)).join(REDACTED);
	return out;
}
