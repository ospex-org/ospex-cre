// Never: "A feed key, a keyed URL or a raw feed payload in a row, in the push's payload or in any log on
// either side. The push's own key travels only in the request header and is written nowhere: not in
// rows, runtime.log, the table or any alert. Never the service_role key or any project-wide database
// secret in the workflow's Vault or config."
//
// main.ts's own two handlers against the stand-in SDK (stand-in-sdk.ts), with a canary in every place a
// secret could come from: each seat's key in the vault (the spare's rides in its request's query, the
// one key the workflow holds), the push's two keys in the vault, and every feed answer's headers echoing
// the URL and the keys it received, the spare's quota header among them. The push's key comes in three
// shapes (a signed token, an opaque string, a secret key). So does what the vault holds for the push's
// `apikey`: the publishable key it should be, and a secret key and a signed token, which the vault must
// never hold there but a test can. The push meets an endpoint that takes it, one that refuses it echoing
// both keys, and one whose failure echoes everything it was sent, the keys bare among it.
// No canary reaches a row, the push's body or URL, a header the workflow built, or any line. Each of the
// push's keys leaves in its one header, filled by the enclave (the control: it does travel, there and
// only there), and the vault is asked for each once. The config holds no key: it has no field for one
// and refuses a config that carries one, the publishable key included, and the committed template and
// the secrets file say the same.
//
// What this cannot hold: what the vault holds under the `apikey`'s name. The workflow never sees that
// value, so nothing here checks its shape; the check is made where the value is stored.
//
// The breaks that turn this red, each applied once and restored:
//   runline.ts, quotaOf: a quota header that is not a whole number kept as given,
//     return WHOLE.test(v) ? Number(v) : null;
//     ->  return WHOLE.test(v) ? Number(v) : (v as unknown as number);
//   with which the spare's echoed key lands in its row, on the log and in the push;
//   runline.ts, causeOf: a failed push's words written as they came,
//     return CAUSES.find(([pattern]) => pattern.test(message))?.[1] ?? "other";
//     ->  return message;
//   with which both of the push's keys and the spare's key land on the push's line;
//   lib.ts, configSchema: a field the schema lacks dropped, not refused,
//     .strict()  ->  .strip()
//   with which a config carrying a key, a secret one among them, loads;
//   runline.ts, pushRequest: the role's key's stand-in in the `apikey` header,
//     apikey: `{{.${RUN_LINE_APIKEY_SECRET}}}`,  ->  apikey: `{{.${RUN_LINE_SECRET}}}`,
//   with which the role's key leaves in a second header.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainGame } from "../scoring/src/chain";
import type { HttpRequest, Seat } from "../scoring/src/types";
import { LATE, NOW } from "../scoring/test/cases";
import { KEY, saved } from "../scoring/test/fixtures";
import { PAYOUT, chainOf } from "../scoring/test/rule-helpers";
import { SECRET_IDS, configSchema, type Config } from "./lib";
import { RUN_LINE_APIKEY_SECRET, RUN_LINE_SECRET, type Row } from "./runline";
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
};

/**
 * The push's key in three shapes: a signed token, as the role's key will be; an opaque string; and a
 * secret key, which the vault must never hold but a test can. Each part is a canary of its own.
 */
const PUSH_KEYS = [
	"eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoicnVuX2xpbmVfd3JpdGVyIn0.REVIEW_PUSH_CANARY_TOKEN",
	"REVIEW_PUSH_CANARY_OPAQUE",
	"sb_secret_REVIEW_PUSH_CANARY_SECRET",
] as const;
/**
 * What the vault holds for the push's `apikey`, in three shapes: the project's publishable key, as it
 * should be; and a secret key and a signed token for the database's own role, which the vault must
 * never hold there but a test can. The publishable key is public, and is written nowhere all the same.
 */
const APIKEYS = [
	"sb_publishable_REVIEW_APIKEY_CANARY_PUBLISHABLE",
	"sb_secret_REVIEW_APIKEY_CANARY_SECRET",
	"eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.REVIEW_APIKEY_CANARY_TOKEN",
] as const;
const SEAT_KEYS: Readonly<Record<string, string>> = {
	SEAT1_KEY: "REVIEW_SEAT1_CANARY",
	SEAT2_KEY: "REVIEW_SEAT2_CANARY",
	SEAT3_KEY: "REVIEW_SEAT3_CANARY",
	SEAT4_KEY: "REVIEW_SEAT4_CANARY",
};
const vaultOf = (pushKey: string, apikey: string): Readonly<Record<string, string>> => ({ ...SEAT_KEYS, RUN_LINE_KEY: pushKey, RUN_LINE_APIKEY: apikey });
/** Everything that must never be written: each key, the push's keys' parts, and the feeds' own words and addresses. */
const CANARIES = [
	...Object.values(SEAT_KEYS),
	...PUSH_KEYS,
	...APIKEYS,
	"REVIEW_PUSH_CANARY",
	"REVIEW_APIKEY_CANARY",
	"eyJhbGciOiJIUzI1NiJ9",
	"eyJyb2xlIjoicnVuX2xpbmVfd3JpdGVyIn0",
	"eyJyb2xlIjoic2VydmljZV9yb2xlIn0",
	"REVIEW_BODY_CANARY",
	"apiKey=",
];

const sdk = await standIn(CONFIG);

type Push = "taken" | "refused, echoing the keys" | "failed, echoing everything";
const PUSHES: readonly Push[] = ["taken", "refused, echoing the keys", "failed, echoing everything"];

function endpoint(mode: Push): World["push"] {
	return (req: PushSeen) => {
		if (mode === "taken") return { status: 201, body: "" };
		if (mode === "refused, echoing the keys") {
			return { status: 401, body: JSON.stringify({ code: "PGRST301", message: `bad token ${req.filled.Authorization} beside ${req.filled.apikey}`, hint: SEAT_KEYS.SEAT4_KEY }) };
		}
		const bare = req.filled.Authorization.replace(/^Bearer /, "");
		throw new Error(`upstream refused ${req.filled.Authorization} (key ${bare}) for ${req.url} with ${JSON.stringify(req.filled)}; the spare said apiKey=${SEAT_KEYS.SEAT4_KEY} at https://feed.example.test/x?apiKey=${SEAT_KEYS.SEAT4_KEY}`);
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
		const a = t.send({ ...req, url: req.url.split(SEAT_KEYS.SEAT4_KEY).join(KEY) });
		const headers: Record<string, string[]> = { "x-echo-url": [req.url], "x-echo-keys": [Object.values(req.headers).join(" ")], "x-echo-body": ["REVIEW_BODY_CANARY"] };
		if (seat === 4) headers["X-Requests-Remaining"] = [quota];
		return { ...a, headers };
	};
}

const SIXERS: ChainGame = { ...chainOf("nba final, read after the game"), id: "1" };
const NFL: ChainGame = { ...chainOf("nfl not final"), id: "1", status: "unverified", start: null, startReadings: null };

const rowsOf = (r: Run): Row[] => r.logs.filter((l) => l.startsWith("run-line {")).map((l) => JSON.parse(l.slice("run-line ".length)) as Row);

interface Case {
	readonly what: string;
	readonly pushKey: string;
	readonly apikey: string;
	readonly run: Run;
}

/** The two handlers, each with the quota header as given, each shape of each of the push's two keys and each push. */
function runs(quota: string, keys: readonly string[] = PUSH_KEYS, apikeys: readonly string[] = APIKEYS): Case[] {
	const out: Case[] = [];
	for (const pushKey of keys) {
		for (const apikey of apikeys) {
			const vault = vaultOf(pushKey, apikey);
			const shapes = `key ${pushKey.slice(0, 12)}, apikey ${apikey.slice(0, 14)}`;
			for (const push of PUSHES) {
				out.push({ what: `tick, ${shapes}, push ${push}`, pushKey, apikey, run: sdk.handle(1, tickPayload(LATE), { evm: fakeChainOf([SIXERS], LATE), vault, feed: echoing(LATE, quota), push: endpoint(push), writeError: null }) });
				out.push({ what: `creation, ${shapes}, push ${push}`, pushKey, apikey, run: sdk.handle(0, creationLog(NFL), { evm: fakeChainOf([NFL], NOW), vault, feed: echoing(NOW, quota), push: endpoint(push), writeError: null }) });
			}
		}
	}
	return out;
}

describe("never: a key, a keyed URL or a feed's words in a row, the push or a line", () => {
	test("canaries in every key and every feed answer's headers, a quota header carrying the spare's key, three pushes: no canary in any row, the push's body, URL or built headers, or any line", () => {
		const all = runs(SEAT_KEYS.SEAT4_KEY);
		expect(all.length).toBe(PUSH_KEYS.length * APIKEYS.length * PUSHES.length * 2);
		for (const { what, pushKey, apikey, run } of all) {
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
			// The push's two keys: each a stand-in in its one header as built, and the vault asked for each once.
			expect({ what, apikey: push.headers.apikey, bearer: push.headers.Authorization, named: [...push.secrets].sort(), url: push.url }).toEqual({
				what,
				apikey: "{{.RUN_LINE_APIKEY}}",
				bearer: "Bearer {{.RUN_LINE_KEY}}",
				named: ["RUN_LINE_APIKEY", "RUN_LINE_KEY"],
				url: "https://db.example.test/rest/v1/run_lines?on_conflict=run_key,seat",
			});
			// Each filled by the enclave on the way out, whatever the vault holds, and in no other header.
			expect({ what, bearer: push.filled.Authorization, apikey: push.filled.apikey }).toEqual({ what, bearer: `Bearer ${pushKey}`, apikey });
			const beside = (header: string): string => Object.entries(push.filled).filter(([k]) => k !== header).map(([, v]) => v).join(" ");
			expect({ what, pushKeyElsewhere: beside("Authorization").includes("REVIEW_PUSH_CANARY"), apikeyElsewhere: beside("apikey").includes("REVIEW_APIKEY_CANARY") }).toEqual({
				what,
				pushKeyElsewhere: false,
				apikeyElsewhere: false,
			});
		}
	});

	test("the control: a whole-number quota header is the spare's sample, and the feeds' requests did carry their keys, the header seats as the enclave's stand-ins", () => {
		const { run } = runs("412", [PUSH_KEYS[0]], [APIKEYS[0]])[0];
		expect(rowsOf(run)[3]).toMatchObject({ seat: 4, requests: 1, quota: [412], remaining: 412 });
		const header = run.feeds.filter((f) => f.seat !== 4).flatMap((f) => Object.values(f.headers));
		expect(header.filter((v) => /^\{\{\.SEAT[123]_KEY\}\}$/.test(v)).length).toBeGreaterThan(0);
		expect(header.some((v) => v.includes("REVIEW_SEAT"))).toBe(false);
		expect(run.feeds.filter((f) => f.seat === 4).every((f) => f.url.includes(SEAT_KEYS.SEAT4_KEY))).toBe(true);
	});

	test("the config holds no key: a config that carries one, the publishable key among them, is refused for that field; its route has no query, no user and no remote http", () => {
		const parse = (over: Record<string, unknown>) => configSchema.safeParse({ ...CONFIG, ...over });
		// The control: the config as it stands loads.
		expect(parse({}).success).toBe(true);
		for (const key of [
			"sb_publishable_AbC-12_xyz",
			"sb_publishable_secrets-test-stand-in",
			"sb_secret_AbC-12_xyz0",
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl",
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl",
			"RUN_LINE_PUBLISHABLE_KEY_NOT_SET",
			"",
		]) {
			for (const field of ["runLinePublishableKey", "runLineKey", "apikey"]) {
				const r = parse({ [field]: key });
				const issues = r.success ? [] : r.error.issues.map((i) => [i.code, "keys" in i ? i.keys : null]);
				expect({ field, key, ok: r.success, issues }).toEqual({ field, key, ok: false, issues: [["unrecognized_keys", [field]]] });
			}
		}
		for (const url of ["https://db.example.test/rest/v1/run_lines", "https://abc.db.example.test/rest/v1/run_lines", "http://127.0.0.1:54321/rest/v1/run_lines", "http://localhost:8787/rest/v1/run_lines"]) {
			expect({ url, ok: parse({ runLineUrl: url }).success }).toEqual({ url, ok: true });
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
			expect({ url, ok: parse({ runLineUrl: url }).success }).toEqual({ url, ok: false });
		}
	});

	test("the committed template has the config's fields and no other, and loads once its placeholders are set; the secrets file names the four seats' keys and the push's two", () => {
		const template = JSON.parse(readFileSync(join(import.meta.dir, "config.production.example.json"), "utf8")) as Record<string, unknown>;
		expect(Object.keys(template).sort()).toEqual(Object.keys(CONFIG).sort());
		// As committed, every address and the route a placeholder, it does not load; with them set, it does.
		expect(configSchema.safeParse(template).success).toBe(false);
		const set = { receiverAddress: CONFIG.receiverAddress, eventAddress: CONFIG.eventAddress, secretOwner: CONFIG.secretOwner, payoutAddress: CONFIG.payoutAddress, runLineUrl: CONFIG.runLineUrl };
		expect(configSchema.safeParse({ ...template, ...set }).success).toBe(true);

		const yaml = readFileSync(join(import.meta.dir, "secrets.yaml"), "utf8");
		const names = [...yaml.matchAll(/^  ([A-Z0-9_]+):\s*$/gm)].map((m) => m[1]);
		const vars = [...yaml.matchAll(/^    - ([A-Z0-9_]+)\s*$/gm)].map((m) => m[1]);
		expect(names).toEqual(["SEAT1_KEY", "SEAT2_KEY", "SEAT3_KEY", "SEAT4_KEY", "RUN_LINE_KEY", "RUN_LINE_APIKEY"]);
		// The names the workflow asks the vault for, and no other.
		expect([...names].sort()).toEqual([...Object.values(SECRET_IDS), RUN_LINE_SECRET, RUN_LINE_APIKEY_SECRET].sort());
		// Simulation reads each from the env var of its own name.
		expect(vars).toEqual(names);
	});
});
