/**
 * Integration (issue 08 slice G): the Graph tab and the session stats from
 * the phone's own code against the REAL fork server, through the HTTPS
 * phone gateway, on a COPY of the fork's golden data.
 *
 *   next dev (temp LH_DATA_DIR with the golden data) ← gateway (HTTPS, pin) ← phone code
 *
 * Each check reads a body two times: once as the phone does (pair(), the
 * Mac fetch, the phone readers and models), and once as the desktop does
 * (a direct request with the desktop header, then the fork's own desktop
 * helpers). The phone values must equal the desktop values.
 *
 * Run: npm run test:integration (needs the fork at ../learnharness with its
 * packages installed). It boots `next dev` in the fork, so stop any other
 * `next dev` of the fork first (`npm run desktop:dev`, a Maestro test Mac).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import { loadKnowledge, chainList, canvasSearch, type Knowledge } from "../../src/lib/knowledge";
import { createMacFetch } from "../../src/lib/mac-fetch";
import { pair, parsePairingPayload, type PinnedFetch } from "../../src/lib/pairing";
import { costNumber, costSheet, runPills } from "../../src/lib/pipeline-cost";
import {
	readModelLimits,
	readStrongModel,
	sessionModelId,
	sessionStats,
} from "../../src/lib/session-stats";
import { listSessions, readSession } from "../../src/lib/sessions";
import { SessionModel, cliContextWindowOf } from "../../src/lib/shared";
import { startForkServer, type DevServer } from "./fork-server";

const FORK = process.env.LH_FORK_DIR
	? path.resolve(process.env.LH_FORK_DIR)
	: path.resolve(import.meta.dirname, "../../../learnharness");

const require = createRequire(import.meta.url);
const { createPhoneAccessStore, createPhoneGateway } = require(
	path.join(FORK, "electron/phone-access.cjs"),
);

const SECRET = "e".repeat(64);
const DESKTOP = { "x-learnharness-desktop": SECRET };
/** The golden teach session (95 messages, one compaction). */
const GOLDEN_TEACH = "chat_mv27rrra_feff23b6";
const GOLDEN_PRACTICE = "chat_mv293wv5_10656952";
/** A fixed time for the run ages, as in tests/knowledge-golden.test.ts. */
const COST_NOW = Date.parse("2026-11-23T12:00:00.000Z");

type Fork = {
	pinned: typeof import("../../../learnharness/tests/helpers/pinned-fetch.ts");
	chainRows: any;
	costFormat: any;
	viewModel: any;
	stats: any;
	usage: any;
	context: any;
	native: any;
};

let fork: Fork;
let dataDir = "";
let server: DevServer;
let gateway: ReturnType<typeof createPhoneGateway>;
let gatewayURL = "";
let nodePinned: ReturnType<Fork["pinned"]["pinnedFetch"]> | null = null;
let macFetch: typeof fetch;
const gatewayLog: string[] = [];

/** A direct request to the fork server, as the desktop window sends it. */
async function desktopGet(route: string): Promise<any> {
	const res = await fetch(`${server.url}${route}`, { headers: DESKTOP });
	assert.equal(res.status, 200, `${route}: ${await res.clone().text()}`);
	return res.json();
}

/** The phone's PinnedFetch contract on top of the fork's Node pinned fetch. */
function phonePinnedFetch(expectedPin: string): PinnedFetch {
	nodePinned = fork.pinned.pinnedFetch(expectedPin);
	const node = nodePinned;
	return async (url, init) => {
		assert.equal(init.pin, expectedPin, "every request carries the pin from the pairing");
		const { pin: _pin, ...rest } = init;
		return node(url, rest);
	};
}

before(async () => {
	const load = (file: string) => import(path.join(FORK, file));
	fork = {
		pinned: await load("tests/helpers/pinned-fetch.ts"),
		chainRows: await load("src/core/chain-rows.ts"),
		costFormat: await load("src/core/graph-cost-format.ts"),
		viewModel: await load("src/core/graph-view-model.ts"),
		stats: await load("src/core/session-stats.ts"),
		usage: await load("src/core/usage-format.ts"),
		context: await load("src/core/context-usage.ts"),
		native: await load("src/core/native-messages.ts"),
	};
	// A COPY of the golden data in a new temp folder, ready before the server
	// starts (the server reads the settings once). Never the real data folder.
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-int-golden-"));
	fs.cpSync(path.join(FORK, "tests/fixtures/golden-data"), dataDir, { recursive: true });
	fs.rmSync(path.join(dataDir, "README.md"), { force: true });
	assert.ok(!dataDir.includes("Application Support"), "never the user's real data folder");
	server = await startForkServer(FORK, {
		env: { LH_DESKTOP_SERVER: "1", LH_DESKTOP_API_SECRET: SECRET, LH_DATA_DIR: dataDir },
		headers: DESKTOP,
	});

	gateway = createPhoneGateway({
		store: createPhoneAccessStore(path.join(server.home, "phone-access.json")),
		target: () => ({ url: server.url, secret: SECRET }),
		tlsDir: path.join(server.home, "phone-access-tls"),
		info: { name: "Test Mac", version: "test" },
		log: (line: string) => gatewayLog.push(line),
	});
	const address: AddressInfo = await gateway.start({ host: "127.0.0.1", port: 0 });
	gatewayURL = `https://127.0.0.1:${address.port}`;

	const { code } = gateway.startPairing();
	const raw = JSON.parse(gateway.pairingPayload(code));
	// The gateway listens on loopback in this test; the QR code lists the Mac's network addresses.
	const payload = parsePairingPayload(JSON.stringify({ ...raw, urls: [gatewayURL] }));
	const connection = await pair(payload, "Test iPhone", phonePinnedFetch(payload.pin));
	const state = {
		status: "connected" as const,
		connection,
		url: gatewayURL,
		checkedAt: new Date().toISOString(),
	};
	macFetch = createMacFetch({ state: () => state }, phonePinnedFetch(payload.pin));
});

after(async () => {
	// LH_INT_DEBUG=1 prints the gateway log and the end of the server log.
	if (process.env.LH_INT_DEBUG) console.error(gatewayLog.join("\n"), server?.log().slice(-3000));
	await nodePinned?.close();
	await gateway?.stop();
	await server?.stop();
	if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe(
	"issue 08 slice G: the Graph tab and the session stats on the golden data",
	{
		concurrency: false,
	},
	() => {
		let knowledge: Knowledge;
		let desktop: { graph: any; sources: any; costs: any; status: any };

		it("the phone's knowledge read gets the same bodies as the desktop", async () => {
			knowledge = await loadKnowledge(macFetch);
			desktop = {
				graph: await desktopGet("/api/graph"),
				sources: await desktopGet("/api/graph/sources"),
				costs: await desktopGet("/api/graph/costs"),
				status: await desktopGet("/api/graph/status"),
			};
			assert.ok(knowledge.snapshot.nodes.length > 300, "the golden graph");
			assert.ok(knowledge.snapshot.chains.length > 150, "the golden chains");
			assert.deepEqual(knowledge.snapshot, desktop.graph);
			assert.notEqual(knowledge.directory, null, "the sources read works");
			assert.notEqual(knowledge.costs, null, "the costs read works");
			assert.deepEqual(knowledge.costs, desktop.costs);
			assert.notEqual(knowledge.runs, null, "the status read works");
		});

		it("the chain rows equal the desktop chain table", () => {
			const sorts = [
				{ col: "name", dir: 1 },
				{ col: "props", dir: -1 },
				{ col: "created", dir: -1 },
			] as const;
			let cases = 0;
			for (const sort of sorts)
				for (const query of ["", "database"]) {
					const rows = fork.chainRows.buildChainRows({
						nodes: desktop.graph.propositions,
						chains: desktop.graph.chains,
						sessions: desktop.graph.sessions,
						fileSources: desktop.graph.fileSources,
						directory: desktop.sources,
						query,
						sort,
					});
					const phone = chainList(knowledge, query, sort);
					assert.deepEqual(
						phone.sources.map((s) => [s.group.key, s.group.chains.map((c) => c.id)]),
						rows.groups.map((g: any) => [g.key, g.chains.map((c: any) => c.id)]),
						`${query} ${JSON.stringify(sort)}`,
					);
					assert.equal(
						phone.header,
						`${rows.chains.length} chains · ${desktop.graph.propositions.length} nodes`,
					);
					cases++;
				}
			assert.equal(cases, 6);
		});

		it("the canvas search equals the desktop search", () => {
			for (const query of ["", "data", "Database"]) {
				const desktopIds = desktop.graph.nodes
					.filter((n: any) => fork.viewModel.isNodeVisible(n, query))
					.map((n: any) => n.id);
				assert.deepEqual([...canvasSearch(knowledge.snapshot, query).visibleIds], desktopIds);
			}
		});

		it("the pipeline cost labels equal the desktop cost panel", () => {
			const f = fork.costFormat;
			const costs = desktop.costs;
			assert.ok(costs.runs.length > 0, "the golden data has runs");
			assert.equal(costNumber(knowledge.costs), f.graphUsageLabel(costs));
			const sheet = costSheet(knowledge.costs!, COST_NOW);
			const unpriced = fork.viewModel.displayCostTotals(costs).unpricedRuns;
			assert.equal(
				`${sheet.total}${sheet.unpriced ? ` ${sheet.unpriced}` : ""}`,
				`${f.graphUsageLabel(costs)}${unpriced > 0 ? ` · ${unpriced} unpriced` : ""}`,
			);
			assert.deepEqual(
				sheet.stages.map(
					(s) => `${s.label} ${s.cost}${s.unpriced ? ` ${s.unpriced}` : ""} · ${s.tokens}`,
				),
				f.graphCostStageRows(costs).map(([label, stage]: [string, unknown]) => {
					const count = f.stageUnpricedCount(stage);
					return `${label} ${f.stageCostLabel(stage)}${count !== null ? ` +${count} unpriced` : ""} · ${f.stageTokensLabel(stage)}`;
				}),
			);
			assert.deepEqual(
				sheet.runs.map((r) => `${r.age} ${r.title}${r.merged ? ` ${r.merged}` : ""} ${r.cost}`),
				costs.runs.map(
					(run: any) =>
						`${f.runTimeAgo(run.startedAt, COST_NOW)} ${run.title}${run.merged ? ` +${run.merged.nodes}n` : ""} ${f.recentRunCostLabel(run)}`,
				),
			);
			// No run is in progress in the golden data: no run pills.
			assert.deepEqual(runPills(knowledge.runs, COST_NOW), []);
		});

		it("the session list has the golden sessions", async () => {
			const ids = (await listSessions(macFetch)).map((c) => c.id);
			assert.ok(ids.includes(GOLDEN_TEACH) && ids.includes(GOLDEN_PRACTICE), ids.join(", "));
		});

		it("the session stats equal the desktop stats bar", async () => {
			const record = await readSession(macFetch, GOLDEN_TEACH);
			const limits = await readModelLimits(macFetch);
			const strong = await readStrongModel(macFetch);
			const model = new SessionModel({
				chatId: GOLDEN_TEACH,
				initialMessages: record.messages,
				fetch: macFetch,
			});
			const state = model.getState();
			const phone = sessionStats({
				turns: record.usage.turns,
				pricing: record.usage.pricing,
				contextTokens: state.contextTokens,
				model: sessionModelId(record.usage.settings, strong),
				limits,
				cliWindow: cliContextWindowOf(state.nativeMessages),
			});

			const body = await desktopGet(`/api/chats/${GOLDEN_TEACH}`);
			const catalog = await desktopGet("/api/models");
			const settings = await desktopGet("/api/settings");
			const m = body.settings?.model ?? settings.settings.models.strong.model;
			const summary = fork.stats.sessionStatsSummary({
				turns: body.turns ?? [],
				pricing: body.pricing,
				contextTokens: fork.context.measuredContextTokens(body.messages),
				model: m ? `${m.provider}:${m.id}` : undefined,
				limits: fork.usage.catalogLimits(catalog),
				cliWindow: fork.native.cliContextWindowOf(body.messages),
			});

			assert.deepEqual([...(limits ?? [])], [...fork.usage.catalogLimits(catalog)]);
			assert.equal(phone.context, summary.context);
			assert.equal(phone.cost, summary.cost);
			assert.equal(phone.costTitle, summary.costTitle);
			assert.equal(phone.unpriced, summary.unpriced);
			assert.equal(
				phone.cacheHitRate,
				summary.cacheHitRate === null ? null : `${(summary.cacheHitRate * 100).toFixed(1)}%`,
			);
			assert.deepEqual(
				phone.turns.map(({ label, steps, cost }) => ({ label, steps, cost })),
				summary.turns,
			);
			// The known golden values (tests/session-stats-golden.test.ts). The
			// golden data has no provider key, so the catalog is empty (state 9).
			assert.equal(phone.context, "36.9k");
			assert.equal(phone.cost, "$0.0141");
			assert.equal(phone.cacheHitRate, "81.9%");
			assert.equal(phone.turns.length, 25);
		});
	},
);
