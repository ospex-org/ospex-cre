// Never: "No line carries the query key, raw or escaped, or any feed string that is not a short plain
// word; the header keys the platform fills are never the workflow's to hold and are protected by the
// word rule."
//
// The program's side of it, through the `why` every line is made from (src/program.ts, outcomeOf; the
// wrapper's own log calls are in ../games/line.test.ts). A short plain word is 16 characters or fewer of
// letters, digits, spaces and / : . -, never a URL (src/line.ts). Each case is one game at hour 24, the
// other counting seats affirming, the seat under test answering a row that holds the void, so the run
// waits and its line names the seat and what it said: the word verbatim, the marker, or the redaction.
// The rows are synthetic (test/rows.ts), every field the readers read filled in.
//
// The breaks that turn this red, each applied once and restored:
//   line.ts, cleanLine: the escaped form unredacted, the secret compared with the raw text and not with
//   the decoded word,
//     if (word === REDACTED || held.some((s) => word.includes(s))) return `"${REDACTED}"`;
//     ->  if (word === REDACTED || held.some((s) => token.includes(s))) return `"${REDACTED}"`;
//     for (const s of held) out = out.split(s).join(REDACTED).split(quoted(s).slice(1, -1)).join(REDACTED);
//     ->  for (const s of held) out = out.split(s).join(REDACTED);
//   with which a key holding a double quote or a backslash is no longer redacted on the line;
//   line.ts, cleanLine: an unquoted URL token unmarked,
//     if (!token.startsWith('"')) return URL_MARKS.test(token) ? NOT_A_WORD : token;
//     ->  if (!token.startsWith('"')) return token;
//   readers/seat1.ts, toRecord: the older field's word on the reader's note unquoted,
//     status = state === "unrecognized" ? word : `no status_state; ${quoted(word.trim())}`;
//     ->  status = state === "unrecognized" ? word : `no status_state; ${word.trim()}`;
//   with which a final word past the length rides the line whole.

import { describe, expect, test } from "bun:test";
import { keyFor, type Keys } from "../src/keys";
import { NOT_A_WORD, REDACTED, cleanLine, quoted, secretsOf } from "../src/line";
import { scoreGameSync } from "../src/program";
import type { HttpRequest, HttpResponse, Seat } from "../src/types";
import { locate } from "./fixtures";
import { PAYOUT } from "./rule-helpers";
import { AFTER_N, ROLES, STATUSES, STATUS_FIELD, answerOf, gameFor, json, rowOf, seatOf, type Role } from "./rows";

/** A key per seat, handed to the program as values. */
const KEYS: Keys = { 1: "REVIEW_SEAT1_CANARY", 2: "REVIEW_SEAT2_CANARY", 3: "REVIEW_SEAT3_CANARY", 4: "REVIEW_SEAT4_CANARY" };

/**
 * The run's decision at hour 24. The seat under the role answers the game's final, its rows changed by
 * `change`, under `status`; seat 1 says postponed and seat 2 cancelled; seat 3 says postponed beside seat
 * 1 or 2 under test and has nothing otherwise; the spare has nothing.
 */
function runAt(league: string, role: Role, status: number, change: (rows: any[]) => void, keys: Keys = KEYS) {
	const seat = seatOf(role);
	const g = gameFor(league, role);
	const own: any[] = [rowOf(g, seat, "final")];
	change(own);
	const others: Record<Seat, unknown[]> = { 1: [rowOf(g, 1, "postponed")], 2: [rowOf(g, 2, "canceled")], 3: seat <= 2 ? [rowOf(g, 3, "postponed")] : [], 4: [] };
	const send = (req: HttpRequest): HttpResponse => {
		const at = locate(req);
		if (at === null) throw new Error("a host outside the table");
		return at.seat === seat ? json(answerOf(seat, own), status) : json(answerOf(at.seat, others[at.seat]));
	};
	return scoreGameSync(g, keys, PAYOUT, AFTER_N, send).decision;
}

/** The line for a reading that holds the void, as the rule writes it (src/rule.ts). */
const held = (seat: Seat, status: number, detail: string): string =>
	`after n: seat ${seat} answered but could not be used: ${status >= 300 ? `the game's row in a ${status}; ` : ""}${detail}`;

describe("the line: no line carries the query key, raw or escaped, or any feed string that is not a short plain word", () => {
	test("a header key holding a double quote or a backslash, handed to the program as a value and planted in a feed's field: redacted in both its forms, at each seat and the spare in both roles, under 200, 201, 500 and 503, and as seat 3's result id (144)", () => {
		let cases = 0;
		for (const owner of [1, 2, 3] as const) {
			for (const form of ["quote", "backslash"] as const) {
				const secret = form === "quote" ? `REVIEW_S${owner}_"_KEY` : `REVIEW_S${owner}_\\_KEY`;
				const escaped = JSON.stringify(secret).slice(1, -1);
				const keys: Keys = { ...KEYS, [owner]: secret };
				// A key the program takes: visible ASCII, in a header.
				expect(keyFor(keys, owner)).toBe(secret);
				const check = (what: Record<string, unknown>, d: { action: string; why: string }, detail: string, seat: Seat, status: number) => {
					expect({ ...what, action: d.action, why: d.why }).toEqual({ ...what, action: "wait", why: held(seat, status, detail) });
					expect({ ...what, raw: d.why.includes(secret), escaped: d.why.includes(escaped) }).toEqual({ ...what, raw: false, escaped: false });
					// The wrapper cleans the why again where its line is made: the second pass changes nothing.
					expect({ ...what, again: cleanLine(d.why, secretsOf(keys)) }).toEqual({ ...what, again: d.why });
					cases++;
				};
				for (const role of ROLES) {
					for (const status of STATUSES) {
						const seat = seatOf(role);
						const d = runAt("nba", role, status, (rows) => (rows[0][STATUS_FIELD[seat]] = secret), keys);
						check({ owner, form, role, status }, d, `unrecognized status "${REDACTED}"`, seat, status);
					}
				}
				for (const status of STATUSES) {
					const d = runAt("nba", "seat 3", status, (rows) => (rows[0].ID = secret), keys);
					check({ owner, form, id: true, status }, d, `result without a usable id: "${REDACTED}"`, 3, status);
				}
			}
		}
		expect(cases).toBe(144);
	});

	test("seat 1's older status field on a final short of a whole game: a URL with a key in it (hockey) or a final word past the length (hockey, basketball) is the marker, under 200, 201, 500 and 503 (12); the field's real words stand", () => {
		const URL = "https://feed.example.test/result?apiKey=UNCONFIGURED_FAKE_CANARY";
		const LONG = `Final/${"9".repeat(40)}OT`;
		const legacy = (league: string, word: string | null) => (rows: any[]) => {
			delete rows[0].status_state;
			rows[0].period = 1;
			if (word !== null) rows[0].status = word;
			if (league === "nhl") rows[0].game_state = "OFF";
		};
		let urls = 0;
		let longs = 0;
		for (const [league, word] of [["nhl", URL], ["nhl", LONG], ["nba", LONG]] as const) {
			for (const status of STATUSES) {
				const d = runAt(league, "seat 1", status, legacy(league, word));
				const regulation = league === "nhl" ? 3 : 4;
				expect({ league, word, status, action: d.action, why: d.why }).toEqual({ league, word, status, action: "wait", why: held(1, status, `no status_state; ${NOT_A_WORD}; period 1 of ${regulation}`) });
				for (const part of [word, "apiKey", "UNCONFIGURED_FAKE_CANARY", "9".repeat(17)]) expect({ league, part, carried: d.why.includes(part) }).toEqual({ league, part, carried: false });
				if (word === URL) urls++;
				else longs++;
			}
		}
		expect([urls, longs]).toEqual([4, 8]);
		// The control: the field's own words, quoted and verbatim. Hockey's final is its game_state, with no
		// status field beside it; basketball's is its status, an overtime named.
		expect(runAt("nhl", "seat 1", 503, legacy("nhl", null)).why).toBe(held(1, 503, 'no status_state; "OFF"; period 1 of 3'));
		expect(runAt("nba", "seat 1", 200, legacy("nba", "Final/OT")).why).toBe(held(1, 200, 'no status_state; "Final/OT"; period 1 of 4'));
	});

	test("the real status words stand verbatim on the line: PPD, postponed, in progress, NotFinished, and the rest of the word table", () => {
		// A word the reader does not know, quoted on the line as the feed wrote it.
		for (const word of ["PPD", "Not Started", "cancelled", "Finished"]) {
			expect({ word, why: runAt("nfl", "seat 2", 200, (rows) => (rows[0].status = word)).why }).toEqual({ word, why: held(2, 200, `unrecognized status "${word}"`) });
		}
		// A word the reader knows, beside a row it can't parse: the game's row's word rides the refusal.
		const badRow = (fields: Record<string, unknown>) => (rows: any[]) => {
			Object.assign(rows[0], fields);
			rows.push(null);
		};
		expect(runAt("nfl", "seat 1", 200, badRow({ status_state: "postponed" })).why).toBe(held(1, 200, 'unreadable record; the game\'s row says "postponed"'));
		expect(runAt("nfl", "seat 2", 200, badRow({ status: "in progress" })).why).toBe(held(2, 200, 'unreadable record; the game\'s row says "in progress"'));
		expect(runAt("nfl", "seat 3", 200, badRow({ FinalType: "NotFinished", Final: false })).why).toBe(held(3, 200, 'unreadable record; the hint\'s row says "NotFinished", Final false'));
	});

	test("seat 1's older date-time field before the game, 19 characters all of the plain set, is the marker: past the length", () => {
		const d = runAt("nfl", "seat 1", 200, (rows) => {
			delete rows[0].status_state;
			rows[0].status = "10/22 - 8:15 PM EDT";
		});
		expect(d.why).toBe(held(1, 200, `unrecognized status ${NOT_A_WORD}`));
		expect(d.why.includes("8:15")).toBe(false);
	});

	test("outside the quoted words: a run carrying ://, ? or = is the marker; the rest of the line stays as written", () => {
		const url = "https://feed.example.test/result?apiKey=UNCONFIGURED_FAKE_CANARY";
		expect(cleanLine(`no status_state; ${url}; period 1 of 3`, [])).toBe(`no status_state; ${NOT_A_WORD} period 1 of 3`);
		for (const run of ["a=b", "x?y", "ftp://h", "apiKey=K", "?"]) {
			expect({ run, line: cleanLine(`before ${run} after`, []) }).toEqual({ run, line: `before ${NOT_A_WORD} after` });
		}
		// The control: the program's own words, a short plain word in quotes and a marker already there stay.
		const line = `after n: seat 1 answered but could not be used: the game's row in a 503; unreadable record; the game's row says "FINAL", then ${NOT_A_WORD}`;
		expect(cleanLine(line, [])).toBe(line);
	});

	test("by value: a secret is redacted inside a quoted word as JSON writes it, inside an object, and outside quotes as given", () => {
		const key = 'KEY_WITH_"_AND_\\_IN_IT';
		expect(cleanLine(`unrecognized status ${quoted(key)}`, [key])).toBe(`unrecognized status "${REDACTED}"`);
		expect(cleanLine(`result without a usable id: ${quoted({ bad: key })}`, [key])).toBe(`result without a usable id: {"bad":"${REDACTED}"}`);
		expect(cleanLine(`result without a usable id: ${quoted({ [key]: "bad" })}`, [key])).toBe(`result without a usable id: {"${REDACTED}":"bad"}`);
		expect(cleanLine(`writer failure ${key} at the reporter`, [key])).toBe(`writer failure ${REDACTED} at the reporter`);
		// The control: a plain key, short enough to be a word, is still a secret.
		expect(cleanLine(`unrecognized status ${quoted("SHORTKEY")}`, ["SHORTKEY"])).toBe(`unrecognized status "${REDACTED}"`);
	});

	test("a line already cleaned is cleaned again unchanged, as the wrapper does with every why: the redaction stays the redaction", () => {
		const key = 'KEY_WITH_"_IN_IT';
		const lines = [
			`unrecognized status ${quoted(key)}`,
			`the game's row in a 503; result without a usable id: ${quoted({ id: key })}`,
			`no status_state; ${quoted("https://feed.example.test/r?apiKey=K")}; period 1 of 3`,
			`writer failure ${key} at https://feed.example.test/?key=K`,
			`unreadable record; the game's row says ${quoted("in progress")}`,
		];
		for (const line of lines) {
			const once = cleanLine(line, [key]);
			expect({ line, again: cleanLine(once, [key]) }).toEqual({ line, again: once });
		}
		expect(cleanLine(`unrecognized status "${REDACTED}"`, [])).toBe(`unrecognized status "${REDACTED}"`);
	});
});
