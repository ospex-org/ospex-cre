// A word on a line is a word. The readers keep a feed's own word verbatim on a reading (an unrecognized
// status, the game's row's word beside a refusal, an id that is not the feed's shape, a final flag), each
// in double quotes (JSON.stringify), so a feed's own word for a lesser case shows in the run's line the
// first time it happens. A feed can put anything in that field, a request URL with its key included. So
// every line goes through the one function here before it is written, and every `why` before it leaves
// the program (program.ts, outcomeOf; games/run.ts and games/tick.ts, where the wrapper's lines are made;
// games/main.ts, the creation handler's line): each configured secret value (the seat keys; the board's
// key is seat 3's) is redacted wherever it appears, quoted or not, and each quoted word longer than 32
// characters, or carrying "://", "?" or "=", becomes the marker. A status word is never a URL; the line
// keeps its diagnostic value for every real word and cannot carry a key. One function, not one at each
// reader (test/status.test.ts holds it, with its break in test/never-void.test.ts's header).

import type { Keys } from "./keys";

/** What a quoted feed word that is not a word becomes on a line. */
export const NOT_A_WORD = "[not a status word]";
/** What a configured secret value becomes on a line. */
export const REDACTED = "[redacted]";
/** The most characters a feed's word may stand on a line verbatim. */
export const WORD_LENGTH = 32;

/** A feed's word may stand on a line verbatim only when it is short and not a URL or a query. */
export function sayable(word: string): boolean {
	return word.length <= WORD_LENGTH && !/:\/\/|[?=]/.test(word);
}

/** The configured secret values: every seat's key as handed to the program, empty ones aside. */
export function secretsOf(keys: Keys): string[] {
	return Object.values(keys).filter((k): k is string => typeof k === "string" && k !== "");
}

/** The line as it may be written: the secrets redacted, then each quoted word that is not sayable marked. */
export function cleanLine(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const s of secrets) out = out.split(s).join(REDACTED);
	return out.replace(/"((?:[^"\\]|\\.)*)"/g, (quoted: string, inner: string) => {
		let word: string;
		try {
			word = JSON.parse(quoted) as string;
		} catch {
			word = inner;
		}
		return sayable(word) ? quoted : NOT_A_WORD;
	});
}
