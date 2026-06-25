// Ospex CRE oracle — VERIFY / MARKET-UPDATE / SCORE.
//
// Trigger: EVM log trigger on CreOracleReceiver.CreOracleRequested(uint256 indexed contestId,
//          uint8 indexed requestType, uint64 requestNonce, string rundownId, string sportspageId,
//          string jsonoddsId). The handler dispatches on requestType: 0 = verify, 1 = market-update, 2 = score.
// Work:    confidential-HTTP fetch from the providers, then —
//          • verify (0): 3-of-3 agreement (TheRundown + Sportspage + JsonOdds) on (league, teams,
//            hour-rounded start); report the league id + actual (Rundown) start time.
//          • market (1): single-source JsonOdds odds for the game (sport-filtered to fit the 25KB
//            consensus cap); report the 8 moneyline/spread/total fields.
//          • score (2): 3-of-3 agreement on the final score; report away + home scores.
// Output:  report = abi.encode(uint8 requestType, uint256 chainId, address receiver,
//          uint64 requestNonce, bytes payload); inner payload shapes mirror the CreOracleReceiver
//          handlers (verify/market/score) exactly. chainId + receiver are domain separation;
//          requestNonce is echoed and enforced for market (stale-odds guard).
//
// Ported from ospex-source-files-and-other/src/contestCreation.js (the fuller team legend that
// includes the MLB "Athletics" entry the deployed createContest.js lacks). Date handling is made
// DON-deterministic: instead of `new Date(s).setMinutes(0,0,0)` (which depends on the runtime
// timezone), times are parsed as UTC and the hour-rounding is integer `floor(ts/3600)*3600`.
//
// Grounded in @chainlink/cre-sdk@1.13.0 installed types (no Node builtins; QuickJS/WASM).

import {
	cre,
	Runner,
	bytesToHex,
	prepareReportRequest,
	logTriggerConfig,
	ok,
	json,
	type Runtime,
	type EVMLog,
	TxStatus,
} from "@chainlink/cre-sdk";
import {
	encodeAbiParameters,
	decodeAbiParameters,
	toEventSelector,
	type Hex,
} from "viem";
import { z } from "zod";
import {
	parseIsoToUnixSeconds,
	floorToHour,
	packIdentity,
	extractMarketTicks,
	isFinalFlag,
	EVENT_SIG,
	NONINDEXED_EVENT_ARGS,
	REPORT_ENVELOPE_ABI,
	VERIFY_PAYLOAD_ABI,
	MARKET_PAYLOAD_ABI,
	SCORE_PAYLOAD_ABI,
	evmAddressSchema,
	type RawOdds,
	type MarketTicks,
} from "./lib";

// ──────────────────────────── Config ────────────────────────────

const configSchema = z.object({
	receiverAddress: evmAddressSchema, // CreOracleReceiver (writeReport target)
	eventAddress: evmAddressSchema, // contract emitting CreOracleRequested (the receiver)
	chainSelectorName: z.literal("polygon-testnet-amoy"),
	secretOwner: evmAddressSchema, // vault secret owner (CRE deploy wallet)
	secretNamespace: z.string(),
	workflowVersion: z.number().int().min(0).max(65535),
	chainId: z.number().int().positive(), // EVM chain id of the receiver chain (Amoy 80002; Polygon mainnet 137) — bound into the report for domain separation
});
type Config = z.infer<typeof configSchema>;

// polygon-testnet-amoy — from EVMClient.SUPPORTED_CHAIN_SELECTORS (cre-sdk 1.13.0)
const AMOY_SELECTOR = 16281711391670634445n;

const REQUEST_TYPE_VERIFY = 0;
const REQUEST_TYPE_MARKET = 1;
const REQUEST_TYPE_SCORE = 2;

// The CreOracleRequested event signature + the report-envelope/payload ABI shapes live in ./lib
// (shared with the abi.test.ts regression tests). TOPIC0 is the log-trigger filter topic for the event.
const TOPIC0: Hex = toEventSelector(EVENT_SIG);

// ──────────────────────────── Legends (ported) ──────────────────

type LeagueLegendEntry = { league: string; id: number; jsonoddsLeagueId: number };
const LEAGUE_LEGEND: LeagueLegendEntry[] = [
	{ league: "NCAAF", id: 1, jsonoddsLeagueId: 3 },
	{ league: "NFL", id: 2, jsonoddsLeagueId: 4 },
	{ league: "MLB", id: 3, jsonoddsLeagueId: 0 },
	{ league: "NBA", id: 4, jsonoddsLeagueId: 1 },
	{ league: "NCAAB", id: 5, jsonoddsLeagueId: 2 },
	{ league: "NHL", id: 6, jsonoddsLeagueId: 5 },
	{ league: "MMA", id: 7, jsonoddsLeagueId: 11 },
	{ league: "WNBA", id: 8, jsonoddsLeagueId: 8 },
	{ league: "CFL", id: 9, jsonoddsLeagueId: 24 },
];

type TeamLegendEntry = {
	leagueId: number;
	sportspageTeamName?: string;
	jsonoddsTeamName: string;
	id: number;
};
const TEAM_LEGEND: TeamLegendEntry[] = [
	{ leagueId: 1, sportspageTeamName: "San Jose State", jsonoddsTeamName: "San Jose State", id: 206 },
	{ leagueId: 1, jsonoddsTeamName: "Florida Intl", id: 150 },
	{ leagueId: 1, jsonoddsTeamName: "Miami Florida", id: 174 },
	{ leagueId: 1, jsonoddsTeamName: "Central Florida", id: 225 },
	{ leagueId: 1, sportspageTeamName: "Hawaii", jsonoddsTeamName: "Hawaii", id: 155 },
	{ leagueId: 1, sportspageTeamName: "Louisiana-Lafayette", jsonoddsTeamName: "Louisiana-Lafayette", id: 167 },
	{ leagueId: 1, sportspageTeamName: "Louisiana-Monroe", jsonoddsTeamName: "Louisiana-Monroe", id: 168 },
	{ leagueId: 1, sportspageTeamName: "Mississippi", jsonoddsTeamName: "Mississippi", id: 197 },
	{ leagueId: 1, jsonoddsTeamName: "New Mexico St", id: 186 },
	{ leagueId: 1, jsonoddsTeamName: "North Carolina State", id: 188 },
	{ leagueId: 1, jsonoddsTeamName: "Miami Ohio", id: 175 },
	{ leagueId: 1, jsonoddsTeamName: "Middle Tenn St", id: 178 },
	{ leagueId: 1, jsonoddsTeamName: "Sam Houston", id: 466 },
	{ leagueId: 1, jsonoddsTeamName: "Tex San Antonio", id: 487 },
	{ leagueId: 3, sportspageTeamName: "Athletics", jsonoddsTeamName: "Athletics", id: 58 },
	{ leagueId: 4, sportspageTeamName: "Los Angeles Clippers", jsonoddsTeamName: "Los Angeles Clippers", id: 22 },
	{ leagueId: 4, sportspageTeamName: "Portland Trail Blazers", jsonoddsTeamName: "Portland Trail Blazers", id: 19 },
	{ leagueId: 5, sportspageTeamName: "Connecticut", jsonoddsTeamName: "Connecticut", id: 263 },
	{ leagueId: 5, jsonoddsTeamName: "Depaul", id: 1666 },
	{ leagueId: 5, jsonoddsTeamName: "Miami Florida", id: 293 },
	{ leagueId: 5, jsonoddsTeamName: "Miami Ohio", id: 294 },
	{ leagueId: 5, sportspageTeamName: "Mississippi", jsonoddsTeamName: "Mississippi", id: 316 },
	{ leagueId: 5, jsonoddsTeamName: "North Carolina State", id: 307 },
	{ leagueId: 5, sportspageTeamName: "St. Mary's (CA)", jsonoddsTeamName: "Saint Marys CA", id: 1685 },
];

// ──────────────────────────── Provider response shapes ──────────

interface RundownResp {
	sport_id: number;
	event_date: string;
	score: { event_status: string };
	teams_normalized: { team_id: number; name: string; mascot: string }[];
}
interface SportspageResp {
	results: {
		status: string;
		details: { league: string };
		schedule: { date: string };
		teams: { away: { team: string }; home: { team: string } };
	}[];
}
interface JsonOddsGame {
	ID: string;
	Sport: number;
	MatchTime: string;
	AwayTeam: string;
	HomeTeam: string;
}
// --- score + market shapes ---
interface RundownLeagueResp {
	sport_id: number;
}
interface RundownScoreResp {
	score: { event_status: string; score_away: number; score_home: number };
}
interface SportspageScoreResp {
	results: { status: string; scoreboard: { score: { away: number; home: number } } }[];
}
interface JsonOddsResult {
	Final: boolean | string;
	AwayScore: string | number;
	HomeScore: string | number;
}
interface JsonOddsMarketGame {
	ID: string;
	Odds: RawOdds[];
}

// ──────────────────────────── Team lookup ───────────────────────

function findTeamId(
	leagueId: number,
	name: string,
	field: "sportspageTeamName" | "jsonoddsTeamName",
	fallbackName: string,
	fallbackId: number,
	provider: string,
	side: string,
): number {
	const hit = TEAM_LEGEND.find((t) => t.leagueId === leagueId && t[field] === name);
	if (hit) return hit.id;
	if (name === fallbackName) return fallbackId;
	throw new Error(`${provider} ${side} team name error: "${name}" (league ${leagueId})`);
}

// ──────────────────────────── Confidential fetch ────────────────

function confidentialGet(
	runtime: Runtime<Config>,
	url: string,
	headers: Record<string, string>,
	secretKey: string,
): unknown {
	const conf = new cre.capabilities.ConfidentialHTTPClient();
	const multiHeaders: Record<string, { values: string[] }> = {};
	for (const [k, v] of Object.entries(headers)) multiHeaders[k] = { values: [v] };

	const resp = conf
		.sendRequest(runtime, {
			vaultDonSecrets: [
				{
					key: secretKey,
					namespace: runtime.config.secretNamespace,
					owner: runtime.config.secretOwner,
				},
			],
			request: { url, method: "GET", multiHeaders },
		})
		.result();

	if (!ok(resp)) throw new Error(`HTTP ${resp.statusCode} for ${url}`);
	return json(resp);
}

// ──────────────────────────── Verify facts (3-of-3) ─────────────

type VerifyFacts = { leagueId: number; startTime: number };

function resolveVerifyFacts(runtime: Runtime<Config>, log: DecodedRequest): VerifyFacts {
	const { rundownId, sportspageId, jsonoddsId } = log;

	// --- TheRundown (the authority for the returned league + actual start time) ---
	const rundown = confidentialGet(
		runtime,
		`https://therundown-therundown-v1.p.rapidapi.com/events/${rundownId}?include=scores`,
		{
			"x-rapidapi-host": "therundown-therundown-v1.p.rapidapi.com",
			"x-rapidapi-key": "{{.RAPIDAPI_KEY}}",
		},
		"RAPIDAPI_KEY",
	) as RundownResp;

	if (rundown.score.event_status !== "STATUS_SCHEDULED") {
		throw new Error(`rundown game not scheduled: ${rundown.score.event_status}`);
	}
	const rLeague = rundown.sport_id;
	const rEventRounded = floorToHour(parseIsoToUnixSeconds(rundown.event_date));
	const rStartActual = parseIsoToUnixSeconds(rundown.event_date.trim());
	const rAwayId = rundown.teams_normalized[0].team_id;
	const rHomeId = rundown.teams_normalized[1].team_id;
	const rAwayStr =
		rLeague === 1 || rLeague === 5
			? rundown.teams_normalized[0].name
			: `${rundown.teams_normalized[0].name} ${rundown.teams_normalized[0].mascot}`;
	const rHomeStr =
		rLeague === 1 || rLeague === 5
			? rundown.teams_normalized[1].name
			: `${rundown.teams_normalized[1].name} ${rundown.teams_normalized[1].mascot}`;
	const rundownPacked = packIdentity(rLeague, rEventRounded, rAwayId, rHomeId);

	// --- Sportspage ---
	const sportspage = confidentialGet(
		runtime,
		`https://sportspage-feeds.p.rapidapi.com/gameById?gameId=${sportspageId}`,
		{
			"x-rapidapi-host": "sportspage-feeds.p.rapidapi.com",
			"x-rapidapi-key": "{{.RAPIDAPI_KEY}}",
		},
		"RAPIDAPI_KEY",
	) as SportspageResp;

	const sp = sportspage.results[0];
	if (sp.status !== "scheduled") throw new Error(`sportspage game not scheduled: ${sp.status}`);
	const spLeagueEntry = LEAGUE_LEGEND.find((x) => x.league === sp.details.league.trim());
	if (!spLeagueEntry) throw new Error(`sportspage unknown league: ${sp.details.league}`);
	const spLeague = spLeagueEntry.id;
	const spEventRounded = floorToHour(parseIsoToUnixSeconds(sp.schedule.date));
	const spAwayId = findTeamId(spLeague, sp.teams.away.team.trim(), "sportspageTeamName", rAwayStr, rAwayId, "Sportspage", "away");
	const spHomeId = findTeamId(spLeague, sp.teams.home.team.trim(), "sportspageTeamName", rHomeStr, rHomeId, "Sportspage", "home");
	const sportspagePacked = packIdentity(spLeague, spEventRounded, spAwayId, spHomeId);

	// --- JsonOdds (fetch only this sport's slate, then find by id) ---
	// The full /api/odds?oddType=Game feed (~125KB, all sports) exceeds the DON's ~25KB
	// consensus-observation cap → "response buffer too small". Filtering to the rundown's
	// sport keeps the body small (e.g. MLB ~16KB) so it fits through consensus.
	const joSport = LEAGUE_LEGEND.find((x) => x.id === rLeague)?.league;
	if (!joSport) throw new Error(`no JsonOdds sport path for league ${rLeague}`);
	const jsonoddsAll = confidentialGet(
		runtime,
		`https://jsonodds.com/api/odds/${joSport}?oddType=Game`,
		{ "x-api-key": "{{.JSONODDS_KEY}}" },
		"JSONODDS_KEY",
	) as JsonOddsGame[];

	const jo = jsonoddsAll.find((g) => g.ID === jsonoddsId);
	if (!jo) throw new Error(`jsonodds game not found: ${jsonoddsId}`);
	const joLeagueEntry = LEAGUE_LEGEND.find((x) => x.jsonoddsLeagueId === jo.Sport);
	if (!joLeagueEntry) throw new Error(`jsonodds unknown sport: ${jo.Sport}`);
	const joLeague = joLeagueEntry.id;
	const joEventRounded = floorToHour(parseIsoToUnixSeconds(`${jo.MatchTime.trim()}Z`));
	const joAwayId = findTeamId(joLeague, jo.AwayTeam.trim(), "jsonoddsTeamName", rAwayStr, rAwayId, "JsonOdds", "away");
	const joHomeId = findTeamId(joLeague, jo.HomeTeam.trim(), "jsonoddsTeamName", rHomeStr, rHomeId, "JsonOdds", "home");
	const jsonoddsPacked = packIdentity(joLeague, joEventRounded, joAwayId, joHomeId);

	// --- 3-of-3 agreement gate (same game across all providers) ---
	if (rundownPacked !== sportspagePacked || rundownPacked !== jsonoddsPacked) {
		throw new Error(
			`provider disagreement: rundown=${rundownPacked} sportspage=${sportspagePacked} jsonodds=${jsonoddsPacked}`,
		);
	}

	if (rLeague < 1 || rLeague > 255) throw new Error(`league out of range: ${rLeague}`);
	if (rStartActual <= 0 || rStartActual > 0xffffffff) throw new Error(`startTime out of range: ${rStartActual}`);
	return { leagueId: rLeague, startTime: rStartActual };
}

// ──────────────────────────── Market facts (single-source JsonOdds) ──

function resolveMarketFacts(runtime: Runtime<Config>, log: DecodedRequest): MarketTicks {
	const { rundownId, jsonoddsId } = log;

	// The market path is single-source JsonOdds, but the full /api/odds feed (~125KB) busts the
	// ~25KB consensus-observation cap. We must sport-filter, which needs the league. The lean
	// rundown event (no ?include=scores) is small and deterministically yields sport_id.
	const rundown = confidentialGet(
		runtime,
		`https://therundown-therundown-v1.p.rapidapi.com/events/${rundownId}`,
		{
			"x-rapidapi-host": "therundown-therundown-v1.p.rapidapi.com",
			"x-rapidapi-key": "{{.RAPIDAPI_KEY}}",
		},
		"RAPIDAPI_KEY",
	) as RundownLeagueResp;
	const rLeague = rundown.sport_id;
	const joSport = LEAGUE_LEGEND.find((x) => x.id === rLeague)?.league;
	if (!joSport) throw new Error(`no JsonOdds sport path for league ${rLeague}`);

	const jsonoddsAll = confidentialGet(
		runtime,
		`https://jsonodds.com/api/odds/${joSport}?oddType=Game`,
		{ "x-api-key": "{{.JSONODDS_KEY}}" },
		"JSONODDS_KEY",
	) as JsonOddsMarketGame[];

	const jo = jsonoddsAll.find((g) => g.ID === jsonoddsId);
	if (!jo) throw new Error(`jsonodds game not found: ${jsonoddsId}`);
	if (!jo.Odds || jo.Odds.length === 0) throw new Error(`jsonodds no odds for ${jsonoddsId}`);
	return extractMarketTicks(jo.Odds[0]);
}

// ──────────────────────────── Score facts (3-of-3 final) ────────────

type ScoreFacts = { awayScore: number; homeScore: number };

function resolveScoreFacts(runtime: Runtime<Config>, log: DecodedRequest): ScoreFacts {
	const { rundownId, sportspageId, jsonoddsId } = log;

	// --- TheRundown (authority; STATUS_FINAL + away/home) ---
	const rundown = confidentialGet(
		runtime,
		`https://therundown-therundown-v1.p.rapidapi.com/events/${rundownId}?include=scores`,
		{
			"x-rapidapi-host": "therundown-therundown-v1.p.rapidapi.com",
			"x-rapidapi-key": "{{.RAPIDAPI_KEY}}",
		},
		"RAPIDAPI_KEY",
	) as RundownScoreResp;
	if (rundown.score.event_status !== "STATUS_FINAL") {
		throw new Error(`rundown game not final: ${rundown.score.event_status}`);
	}
	const rAway = Number(rundown.score.score_away);
	const rHome = Number(rundown.score.score_home);
	const rCombined = rAway * 1000 + rHome; // mirrors the legacy away*1000+home agreement key

	// --- Sportspage ---
	const sportspage = confidentialGet(
		runtime,
		`https://sportspage-feeds.p.rapidapi.com/gameById?gameId=${sportspageId}`,
		{
			"x-rapidapi-host": "sportspage-feeds.p.rapidapi.com",
			"x-rapidapi-key": "{{.RAPIDAPI_KEY}}",
		},
		"RAPIDAPI_KEY",
	) as SportspageScoreResp;
	const sp = sportspage.results[0];
	if (!sp || sp.status !== "final") throw new Error(`sportspage game not final: ${sp?.status}`);
	const spCombined = Number(sp.scoreboard.score.away) * 1000 + Number(sp.scoreboard.score.home);

	// --- JsonOdds (per-game results endpoint — small, no 25KB issue) ---
	const jsonoddsResults = confidentialGet(
		runtime,
		`https://jsonodds.com/api/results/${jsonoddsId}`,
		{ "x-api-key": "{{.JSONODDS_KEY}}" },
		"JSONODDS_KEY",
	) as JsonOddsResult[];
	const jr = jsonoddsResults[0];
	if (!jr || !isFinalFlag(jr.Final)) throw new Error("jsonodds game not final");
	const joCombined = Number(jr.AwayScore) * 1000 + Number(jr.HomeScore);

	// --- 3-of-3 agreement gate (same final score across all providers) ---
	if (rCombined !== spCombined || rCombined !== joCombined) {
		throw new Error(
			`score disagreement: rundown=${rCombined} sportspage=${spCombined} jsonodds=${joCombined}`,
		);
	}
	if (
		!Number.isInteger(rAway) ||
		!Number.isInteger(rHome) ||
		rAway < 0 ||
		rHome < 0 ||
		rHome >= 1000 || // the combined key assumes home is < 1000 (true for all real scores)
		rAway > 0xffffffff
	) {
		throw new Error(`score out of range: away=${rAway} home=${rHome}`);
	}
	return { awayScore: rAway, homeScore: rHome };
}

// ──────────────────────────── Handler ───────────────────────────

type DecodedRequest = {
	contestId: bigint;
	requestType: number;
	requestNonce: bigint; // uint64 — echoed back in the report; the receiver enforces it for market
	rundownId: string;
	sportspageId: string;
	jsonoddsId: string;
};

function decodeRequest(log: EVMLog): DecodedRequest {
	const contestId = BigInt(bytesToHex(log.topics[1])); // uint256 (indexed)
	const requestType = Number(BigInt(bytesToHex(log.topics[2]))); // uint8 (indexed)
	const [requestNonce, rundownId, sportspageId, jsonoddsId] = decodeAbiParameters(
		NONINDEXED_EVENT_ARGS,
		bytesToHex(log.data),
	) as [bigint, string, string, string];
	return { contestId, requestType, requestNonce, rundownId, sportspageId, jsonoddsId };
}

// Common tail: wrap the payload in the report envelope, sign it under DON consensus, and write it
// to the receiver. Shared by all three request types so the envelope + writeReport stay identical.
function submitReport(
	runtime: Runtime<Config>,
	req: DecodedRequest,
	requestType: number,
	payload: Hex,
	summary: Record<string, unknown>,
): string {
	// Report envelope — must match CreOracleReceiver.onReport:
	// abi.encode(uint8 requestType, uint256 chainId, address receiver, uint64 requestNonce, bytes payload).
	// chainId + receiver are domain separation; requestNonce is echoed (the receiver enforces it for market).
	const report = encodeAbiParameters(REPORT_ENVELOPE_ABI, [
		requestType,
		BigInt(runtime.config.chainId),
		runtime.config.receiverAddress as Hex,
		req.requestNonce,
		payload,
	]);

	const signed = runtime.report(prepareReportRequest(report)).result();
	const evmClient = new cre.capabilities.EVMClient(AMOY_SELECTOR);
	const reply = evmClient
		.writeReport(runtime, {
			receiver: runtime.config.receiverAddress,
			report: signed,
			gasConfig: { gasLimit: "500000" },
		})
		.result();

	if (reply.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`writeReport failed: status=${reply.txStatus} ${reply.errorMessage ?? ""}`);
	}

	const txHash = reply.txHash ? bytesToHex(reply.txHash) : null;
	runtime.log(`report applied: type=${requestType} contest=${req.contestId} tx=${txHash}`);
	return JSON.stringify({ contestId: req.contestId.toString(), requestType, ...summary, txHash });
}

const onOracleRequest = (runtime: Runtime<Config>, log: EVMLog): string => {
	const req = decodeRequest(log);

	// Confidential fetch happens inside each resolver. Confidential-HTTP is a DON-level capability
	// call (the platform handles distributed execution + key confidentiality); the resulting report
	// is signed under DON consensus by submitReport's runtime.report below.
	//
	// LOCKED ENCODINGS — each payload must match the matching CreOracleReceiver handler.
	// viem maps uintN/intN (N<=48) -> number and uint256 -> bigint.

	if (req.requestType === REQUEST_TYPE_VERIFY) {
		runtime.log(`verify request: contest ${req.contestId} (${req.rundownId}/${req.sportspageId}/${req.jsonoddsId})`);
		const facts = resolveVerifyFacts(runtime, req);
		const payload = encodeAbiParameters(VERIFY_PAYLOAD_ABI, [
			req.contestId,
			facts.leagueId,
			facts.startTime,
			runtime.config.workflowVersion,
		]);
		return submitReport(runtime, req, REQUEST_TYPE_VERIFY, payload, {
			leagueId: facts.leagueId,
			startTime: facts.startTime,
		});
	}

	if (req.requestType === REQUEST_TYPE_MARKET) {
		runtime.log(`market request: contest ${req.contestId} (jsonodds ${req.jsonoddsId})`);
		const m = resolveMarketFacts(runtime, req);
		const payload = encodeAbiParameters(MARKET_PAYLOAD_ABI, [
			req.contestId,
			m.moneylineAwayOdds,
			m.moneylineHomeOdds,
			m.spreadLineTicks,
			m.spreadAwayOdds,
			m.spreadHomeOdds,
			m.totalLineTicks,
			m.overOdds,
			m.underOdds,
			runtime.config.workflowVersion,
		]);
		return submitReport(runtime, req, REQUEST_TYPE_MARKET, payload, { ...m });
	}

	if (req.requestType === REQUEST_TYPE_SCORE) {
		runtime.log(`score request: contest ${req.contestId} (${req.rundownId}/${req.sportspageId}/${req.jsonoddsId})`);
		const s = resolveScoreFacts(runtime, req);
		const payload = encodeAbiParameters(SCORE_PAYLOAD_ABI, [
			req.contestId,
			s.awayScore,
			s.homeScore,
			runtime.config.workflowVersion,
		]);
		return submitReport(runtime, req, REQUEST_TYPE_SCORE, payload, { ...s });
	}

	runtime.log(`ignoring unknown request type ${req.requestType} for contest ${req.contestId}`);
	return JSON.stringify({ skipped: true, requestType: req.requestType });
};

// ──────────────────────────── Wiring ────────────────────────────

const initWorkflow = (config: Config) => {
	const evmClient = new cre.capabilities.EVMClient(AMOY_SELECTOR);
	return [
		cre.handler(
			evmClient.logTrigger(
				logTriggerConfig({
					addresses: [config.eventAddress as Hex],
					topics: [[TOPIC0]],
					confidence: "LATEST",
				}),
			),
			onOracleRequest,
		),
	];
};

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema });
	await runner.run(initWorkflow);
}
