// Never: "A feed key, a keyed URL or a raw feed payload in a row, in the push's payload or in any log on
// either side. The push's own key travels only in the request header and is written nowhere: not in
// rows, runtime.log, the table or any alert. Never the service_role key or any project-wide database
// secret in the workflow's Vault or config."
//
// main.ts's own two handlers against the stand-in SDK (stand-in-sdk.ts), with a canary in every place a
// secret could come from: each seat's key in the vault (the spare's rides in its request's query, the
// one key the workflow holds), the push's key in the vault, and every feed answer's headers echoing the
// URL and the keys it received, the spare's quota header among them. The push meets an endpoint that
// takes it, one that refuses it echoing the key, and one whose failure echoes everything it was sent.
// No canary reaches a row, the push's body or URL, a header the workflow built, or any line. The push's
// key leaves in its one header, filled by the enclave (the control: it does travel, there and only
// there). And the config takes the project's publishable key and nothing else.
//
// The breaks that turn this red, each applied once and restored:
//   runline.ts, quotaOf: a quota header that is not a whole number kept as given,
//     return WHOLE.test(v) ? Number(v) : null;
//     ->  return WHOLE.test(v) ? Number(v) : (v as unknown as number);
//   with which the spare's echoed key lands in its row, on the log and in the push;
//   runline.ts, said: a failed push's words kept as they came,
//     const text = cleanLine(message, secrets).replace(JWT, ...)...;
//     ->  const text = message;
//   with which the push's key and the spare's key land on the push's line;
//   lib.ts, PUBLISHABLE_KEY: any of the project's keys taken,
//     /^sb_publishable_[A-Za-z0-9_-]{8,}$/  ->  /^sb_[A-Za-z0-9_-]{8,}$/
//   with which a secret key is a valid config.

import { describe, expect, test } from "bun:test";
import type { ChainGame } from "../scoring/src/chain";
import type { HttpRequest, Seat } from "../scoring/src/types";
import { LATE, NOW } from "../scoring/test/cases";
import { KEY, saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { configSchema, type Config } from "./lib";
import type { Row } from "./runline";
import { creationLog, standIn, tickPayload, type PushSeen, type Run, type World } from "./stand-in-sdk";
import { GAMES, REPORTER, fakeChainOf } from "./test-helpers";

const CONFIG: Config = {
	receiverAddress: REPORTER,
	eventAddress: GAMES,
	chainSelectorName: "polygon-mainnet",
	chainId: 137,
	secretOwner: "0x1111111111111111111111111111111111111111",
	secretNamespace: "secrets-test",
	payoutAddress: PAYOUT,
	schedule: "0 */5 * * * *",
	shards: 1,
	runLineUrl: "https://db.example.test/rest/v1/run_lines",
	runLinePublishableKey: "sb_publishable_secrets-test-stand-in",
};

/** The push's key as the role's key would look: a signed token, its parts canaries of their own. */
const PUSH_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoicnVuX2xpbmVfd3JpdGVyIn0.REVIEW_PUSH_CANARY";
const VAULT: Readonly<Record<string, string>> = {
	SEAT1_KEY: "REVIEW_SEAT1_CANARY",
	SEAT2_KEY: "REVIEW_SEAT2_CANARY",
	SEAT3_KEY: "REVIEW_SEAT3_CANARY",
	SEAT4_KEY: "REVIEW_SEAT4_CANARY",
	RUN_LINE_KEY: PUSH_KEY,
};
/** Everything that must never be written: each key, the push key's parts, and the feeds' own words and addresses. */
const CANARIES = [...Object.values(VAULT), "REVIEW_PUSH_CANARY", "eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoicnVuX2xpbmVfd3JpdGVyIn0", "REVIEW_BODY_CANARY", "apiKey="];

const sdk = await standIn(CONFIG);

type Push = "taken" | "refused, echoing the key" | "failed, echoing everything";
const PUSHES: readonly Push[] = ["taken", "refused, echoing the key", "failed, echoing everything"];

function endpoint(mode: Push): World["push"] {
	return (req: PushSeen) => {
		if (mode === "taken") return { status: 201, body: "" };
		if (mode === "refused, echoing the key") return { status: 401, body: JSON.stringify({ code: "PGRST301", message: `bad token ${req.filled.Authorization}`, hint: VAULT.SEAT4_KEY }) };
		throw new Error(`upstream refused ${req.filled.Authorization} for ${req.url} with ${JSON.stringify(req.filled)}; the spare said apiKey=${VAULT.SEAT4_KEY} at https://feed.example.test/x?apiKey=${VAULT.SEAT4_KEY}`);
	};
}

/**
 * The saved answers, each carrying headers that echo what the feed received: the URL (the spare's with
 * its key in the query) and every header's filled value, the spare's quota header among them as `quota`
 * gives it. The spare's canary is put back to the saved answers' own key for the lookup only.
 */
function echoing(now: number, quota: string): World["feed"] {
	const t = saved(undefined, now);
	return (seat: Seat, req: HttpRequest) => {
		const a = t.send({ ...req, url: req.url.split(VAULT.SEAT4_KEY).join(KEY) });
		const headers: Record<string, string[]> = { "x-echo-url": [req.url], "x-echo-keys": [Object.values(req.headers).join(" ")], "x-echo-body": ["REVIEW_BODY_CANARY"] };
		if (seat === 4) headers["X-Requests-Remaining"] = [quota];
		return { ...a, headers };
	};
}

const SIXERS: ChainGame = { ...chainOf("nba final, read after the game"), id: "1" };
const NFL: ChainGame = { ...chainOf("nfl not final"), id: "1", status: "unverified", start: null, startReadings: null };

const rowsOf = (r: Run): Row[] => r.logs.filter((l) => l.startsWith("run-line {")).map((l) => JSON.parse(l.slice("run-line ".length)) as Row);

/** The two handlers, each with the quota header as given and each push. */
function runs(quota: string): { what: string; run: Run }[] {
	const out: { what: string; run: Run }[] = [];
	for (const push of PUSHES) {
		out.push({ what: `tick, push ${push}`, run: sdk.handle(1, tickPayload(LATE), { evm: fakeChainOf([SIXERS], LATE), vault: VAULT, feed: echoing(LATE, quota), push: endpoint(push), writeError: null }) });
		out.push({ what: `creation, push ${push}`, run: sdk.handle(0, creationLog(NFL), { evm: fakeChainOf([NFL], NOW), vault: VAULT, feed: echoing(NOW, quota), push: endpoint(push), writeError: null }) });
	}
	return out;
}

describe("never: a key, a keyed URL or a feed's words in a row, the push or a line", () => {
	test("canaries in every key and every feed answer's headers, a quota header carrying the spare's key, three pushes: no canary in any row, the push's body, URL or built headers, or any line", () => {
		for (const { what, run } of runs(VAULT.SEAT4_KEY)) {
			const rows = rowsOf(run);
			expect({ what, rows: rows.length, pushes: run.pushes.length }).toEqual({ what, rows: 4, pushes: 1 });
			const push = run.pushes[0];
			// Where a canary could be written: the rows, the push as the workflow built it, and every line.
			const places: Record<string, string> = {
				rows: JSON.stringify(rows),
				"push body": push.body ?? "",
				"push url": push.url,
				"push headers, as built": JSON.stringify(push.headers),
				lines: run.lines.join("\n"),
			};
			for (const [place, text] of Object.entries(places)) {
				for (const canary of CANARIES) expect({ what, place, canary, written: text.includes(canary) }).toEqual({ what, place, canary, written: false });
			}
			// The spare's quota header carried its key: the row says null.
			expect({ what, quota: rows[3].quota?.every((q) => q === null) && (rows[3].quota?.length ?? 0) > 0, remaining: rows[3].remaining }).toEqual({ what, quota: true, remaining: null });
			// The push's key: a stand-in in its one header as built, filled by the enclave on the way out, in no other header.
			expect({ what, built: push.headers.Authorization, named: push.secrets, url: push.url }).toEqual({
				what,
				built: "Bearer {{.RUN_LINE_KEY}}",
				named: ["RUN_LINE_KEY"],
				url: "https://db.example.test/rest/v1/run_lines?on_conflict=run_key,seat",
			});
			expect({ what, filled: push.filled.Authorization, apikey: push.filled.apikey }).toEqual({ what, filled: `Bearer ${PUSH_KEY}`, apikey: CONFIG.runLinePublishableKey });
			const elsewhere = Object.entries(push.filled).filter(([k]) => k !== "Authorization").map(([, v]) => v).join(" ");
			expect({ what, elsewhere: elsewhere.includes("REVIEW_PUSH_CANARY") }).toEqual({ what, elsewhere: false });
		}
	});

	test("the control: a whole-number quota header is the spare's sample, and the feeds' requests did carry their keys, the header seats as the enclave's stand-ins", () => {
		const { run } = runs("412")[0];
		expect(rowsOf(run)[3]).toMatchObject({ seat: 4, requests: 1, quota: [412], remaining: 412 });
		const header = run.feeds.filter((f) => f.seat !== 4).flatMap((f) => Object.values(f.headers));
		expect(header.filter((v) => /^\{\{\.SEAT[123]_KEY\}\}$/.test(v)).length).toBeGreaterThan(0);
		expect(header.some((v) => v.includes("REVIEW_SEAT"))).toBe(false);
		expect(run.feeds.filter((f) => f.seat === 4).every((f) => f.url.includes(VAULT.SEAT4_KEY))).toBe(true);
	});

	test("the config takes the project's publishable key and nothing else, and a route without a query, a user or a remote http", () => {
		const parse = (over: Partial<Record<keyof Config, unknown>>) => configSchema.safeParse({ ...CONFIG, ...over }).success;
		for (const key of ["sb_publishable_AbC-12_xyz", "sb_publishable_secrets-test-stand-in"]) expect({ key, ok: parse({ runLinePublishableKey: key }) }).toEqual({ key, ok: true });
		for (const key of [
			"sb_secret_AbC-12_xyz0",
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl",
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl",
			"sb_publishable_",
			"sb_publishable_short",
			"sb_publishable_has space",
			"RUN_LINE_PUBLISHABLE_KEY_NOT_SET",
			"",
		]) {
			expect({ key, ok: parse({ runLinePublishableKey: key }) }).toEqual({ key, ok: false });
		}
		for (const url of ["https://db.example.test/rest/v1/run_lines", "https://abc.db.example.test/rest/v1/run_lines", "http://127.0.0.1:54321/rest/v1/run_lines", "http://localhost:8787/rest/v1/run_lines"]) {
			expect({ url, ok: parse({ runLineUrl: url }) }).toEqual({ url, ok: true });
		}
		for (const url of [
			"https://db.example.test/rest/v1/run_lines?apikey=sb_secret_x",
			"https://db.example.test/rest/v1/run_lines#x",
			"https://user:pass@db.example.test/rest/v1/run_lines",
			"http://db.example.test/rest/v1/run_lines",
			"https://db.example.test/rest/v1/run_lines/extra",
			"https://db.example.test/rest/v1/",
			"https://db.example.test:443/rest/v1/run_lines",
			"RUN_LINE_URL_NOT_SET",
		]) {
			expect({ url, ok: parse({ runLineUrl: url }) }).toEqual({ url, ok: false });
		}
	});
});
