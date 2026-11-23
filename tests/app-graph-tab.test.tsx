/**
 * Issue 08 slice C: the Graph tab screen. The Skia canvas is replaced by a
 * stand-in that lists the drawn nodes as buttons (tests/setup/graph-canvas.ts;
 * the canvas math has its own tests in graph-scene.test.ts). These tests cover the load, the
 * search, the node sheet, the open of a session at the node's message, and
 * the error states of the screen.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from "expo-router/testing-library";
import path from "node:path";

import { FakeMac, pairedConnection } from "./helpers/fake-mac";
import { snapshot } from "./helpers/graph-snapshot";
import { inTab } from "./helpers/tabs";

const mockKeychain = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
	AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
	WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
	getItemAsync: async (key: string) => mockKeychain.get(key) ?? null,
	setItemAsync: async (key: string, value: string) => void mockKeychain.set(key, value),
	deleteItemAsync: async (key: string) => void mockKeychain.delete(key),
}));
jest.mock("expo-device", () => ({ deviceName: "Test iPhone" }));
jest.mock("@/lib/native-pinned-fetch", () => ({
	nativePinnedFetch: () => {
		const f = globalThis.fetch as typeof fetch;
		return (url: string, init: RequestInit) => f(url, init);
	},
}));
jest.mock("expo-camera", () => ({
	CameraView: () => null,
	useCameraPermissions: () => [{ granted: false }, async () => ({ granted: false })],
}));
const APP = path.resolve(__dirname, "../src/app");
jest.setTimeout(20_000);

type Answer = { status: number; body: unknown } | "network";
const ok = (body: unknown): Answer => ({ status: 200, body });

let mac: FakeMac;
let graph: Answer;
let costs: Answer;
let status: Answer;
let sources: Answer;

beforeEach(() => {
	mockKeychain.clear();
	mockKeychain.set("lh.connection.v1", pairedConnection());
	mac = new FakeMac();
	graph = ok(snapshot());
	costs = ok({ extraction: { runs: 0, usd: 0 }, audit: { runs: 0, usd: 0 }, recent: [] });
	status = ok({ runs: [] });
	sources = ok({ organization: { version: 1, folders: [], placements: {} }, sources: [] });
	const routes: Record<string, () => Answer> = {
		"/api/graph": () => graph,
		"/api/graph/costs": () => costs,
		"/api/graph/status": () => status,
		"/api/graph/sources": () => sources,
	};
	globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
		const route = routes[new URL(url).pathname];
		if (!route || (init?.method ?? "GET") !== "GET") return mac.handle(url, init);
		const answer = route();
		if (answer === "network") throw new TypeError("Network request failed");
		return new Response(JSON.stringify(answer.body), {
			status: answer.status,
			headers: { "content-type": "application/json" },
		});
	}) as unknown as typeof fetch;
});

async function openGraph() {
	await renderRouter(APP, { initialUrl: "/graph" });
	return inTab("graph");
}

it("draws the graph from the Mac and labels the canvas for VoiceOver", async () => {
	const tab = await openGraph();
	const canvas = await tab.findByTestId("graph-canvas");
	expect(canvas.props.accessibilityLabel).toMatch(/^Knowledge graph, 4 nodes\./);
	// The implication node has no button: it is not a proposition.
	expect(tab.getByTestId("canvas-node-n_a")).toBeTruthy();
	expect(tab.queryByTestId("canvas-node-arg_1")).toBeNull();
	expect(tab.queryByTestId("graph-stale")).toBeNull();
});

it("search keeps the matching nodes and shows the count; no match shows the desktop text (state 13)", async () => {
	const tab = await openGraph();
	await tab.findByTestId("graph-canvas");
	await fireEvent.changeText(tab.getByTestId("graph-search"), "alpha");
	expect(tab.getByTestId("graph-search-count")).toHaveTextContent("1 of 4 nodes");
	expect(tab.getByTestId("canvas-node-n_a")).toBeTruthy();
	expect(tab.queryByTestId("canvas-node-n_b")).toBeNull();
	await fireEvent.changeText(tab.getByTestId("graph-search"), "zz-no-match-zz");
	expect(tab.getByTestId("graph-search-empty")).toHaveTextContent("No matching nodes.");
	await fireEvent.changeText(tab.getByTestId("graph-search"), "");
	expect(tab.queryByTestId("graph-search-count")).toBeNull();
	expect(tab.getByTestId("canvas-node-n_d")).toBeTruthy();
});

it("a tap on a node opens its sheet; a session row opens the session at the node's message", async () => {
	const tab = await openGraph();
	await fireEvent.press(await tab.findByTestId("canvas-node-n_a"));
	expect(await screen.findByTestId("node-sheet-name")).toHaveTextContent("Alpha");
	expect(screen.getByTestId("node-sheet")).toHaveTextContent(/Alpha is true\./);
	await fireEvent.press(screen.getByTestId("node-source-chat_a"));
	expect(screen).toHavePathname("/session/chat_a");
	expect(screen).toHaveSearchParams({ id: "chat_a", message: "m1" });
});

it("a node whose message is not known opens the session at its normal position (state 15)", async () => {
	const tab = await openGraph();
	await fireEvent.press(await tab.findByTestId("canvas-node-n_c"));
	await fireEvent.press(await screen.findByTestId("node-source-chat_a"));
	expect(screen).toHavePathname("/session/chat_a");
	expect(screen).toHaveSearchParams({ id: "chat_a" });
});

it("a notes file row is plain text, and a gone session shows unlabeled and opens nothing (state 16)", async () => {
	const tab = await openGraph();
	await fireEvent.press(await tab.findByTestId("canvas-node-n_b"));
	expect(await screen.findByTestId("node-source-src_notes")).toHaveTextContent(
		"notes/linear algebra.md",
	);
	await fireEvent.press(screen.getByTestId("node-sheet-close"));
	await waitFor(() => expect(screen.queryByTestId("node-sheet")).toBeNull());
	await fireEvent.press(tab.getByTestId("canvas-node-n_d"));
	const gone = await screen.findByTestId("node-source-chat_gone");
	expect(gone).toHaveTextContent("unlabeled");
	expect(gone.props.accessibilityRole).toBeUndefined();
	expect(screen).toHavePathname("/graph");
});

it("a node with no session says so (state 14)", async () => {
	const body = snapshot();
	body.nodeSessions.n_c = [];
	graph = ok(body);
	const tab = await openGraph();
	await fireEvent.press(await tab.findByTestId("canvas-node-n_c"));
	expect(await screen.findByTestId("node-sheet-empty")).toHaveTextContent("No sessions recorded.");
});

it("an older Mac refuses the graph (state 2)", async () => {
	graph = { status: 403, body: { error: "Route not allowed for phone access" } };
	const tab = await openGraph();
	expect(await tab.findByTestId("graph-error")).toHaveTextContent(
		"Update LearnHarness on your Mac to see your knowledge.",
	);
	expect(tab.queryByText(/Route not allowed/)).toBeNull();
});

it("a body that is not valid shows a clear message, no raw text, and Try again loads it (state 3)", async () => {
	graph = ok({ nodes: "not a list", secret: "raw server text" });
	const tab = await openGraph();
	expect(await tab.findByTestId("graph-error")).toHaveTextContent(
		"Your knowledge could not be loaded. Pull to try again.",
	);
	expect(tab.queryByText(/raw server text/)).toBeNull();
	graph = ok(snapshot());
	await fireEvent.press(tab.getByTestId("graph-retry"));
	// The tab frame changes from a scroll view to the full-height canvas.
	expect(await (await inTab("graph")).findByTestId("graph-canvas")).toBeTruthy();
});

it("an empty graph asks the learner to start a session (state 4)", async () => {
	const body = snapshot();
	body.nodes = [];
	body.propositions = [];
	body.edges = [];
	body.chains = [];
	body.clusters = [];
	graph = ok(body);
	const tab = await openGraph();
	expect(await tab.findByTestId("graph-empty")).toHaveTextContent(/Knowledge graph/);
	expect(tab.getByTestId("graph-empty")).toHaveTextContent(/Start a session to begin learning\./);
	expect(tab.queryByTestId("graph-canvas")).toBeNull();
});

it("the folders, costs and runs can fail; the graph still shows (states 6 and 11)", async () => {
	sources = { status: 500, body: { error: "x" } };
	costs = "network";
	status = { status: 500, body: { error: "y" } };
	const tab = await openGraph();
	expect(await tab.findByTestId("graph-canvas")).toBeTruthy();
	expect(tab.queryByTestId("graph-error")).toBeNull();
	expect(tab.queryByTestId("graph-cost")).toBeNull();
	expect(tab.queryByTestId(/^run-pill-/)).toBeNull();
});

// ─── Slice F: the pipeline cost number, the cost sheet and the run pills ────

const STAGE_TOKENS = { cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
function goodCosts(runs = 1) {
	return {
		totalDollars: 0.0233,
		unpricedRuns: 0,
		stages: {
			extraction: {
				dollars: 0.0135,
				unpricedRuns: 0,
				runs: 8,
				tokens: { inputTokens: 71193, outputTokens: 80854, ...STAGE_TOKENS },
			},
			audit: {
				dollars: 0.0098,
				unpricedRuns: 0,
				runs: 8,
				tokens: { inputTokens: 111675, outputTokens: 42617, ...STAGE_TOKENS },
			},
		},
		runs: Array.from({ length: runs }, (_, i) => ({
			startedAt: Date.now() - (i + 1) * 12 * 60_000,
			at: "2026-11-23T11:50:00.000Z",
			durationMs: 1000,
			kind: "extraction",
			title: `notes ${i + 1}.md`,
			dollars: 0.0023,
			tokens: { inputTokens: 10, outputTokens: 10, ...STAGE_TOKENS },
			merged: { nodes: 13 },
		})),
	};
}
const RUN = { id: "chat_a", chatId: "chat_a", title: "Eigenvalues", phase: "extracting" };

it("shows the cost number; a tap opens the cost sheet with the desktop rows", async () => {
	costs = ok(goodCosts(2));
	const tab = await openGraph();
	const number = await tab.findByTestId("graph-cost");
	expect(number).toHaveTextContent("$0.02");
	await fireEvent.press(number);
	const sheet = await screen.findByTestId("cost-sheet");
	expect(sheet).toHaveTextContent(/Graph pipeline costs/);
	expect(screen.getByTestId("cost-sheet-total")).toHaveTextContent("$0.02");
	expect(screen.getByTestId("cost-stage-extraction")).toHaveTextContent(
		/Extraction\$0\.01371\.2k in \/ 80\.9k out/,
	);
	expect(screen.getByTestId("cost-stage-audit")).toHaveTextContent(
		/Audit\$0\.010111\.7k in \/ 42\.6k out/,
	);
	const runs = screen.getAllByTestId("cost-run");
	expect(runs).toHaveLength(2);
	expect(runs[0]).toHaveTextContent("12m notes 1.md +13n$0.002");
	await fireEvent.press(screen.getByTestId("cost-sheet-close"));
	await waitFor(() => expect(screen.queryByTestId("cost-sheet")).toBeNull());
});

it("hides the cost number when the Mac has no recent run, as the desktop", async () => {
	costs = ok(goodCosts(0));
	const tab = await openGraph();
	await tab.findByTestId("graph-canvas");
	expect(tab.queryByTestId("graph-cost")).toBeNull();
});

it("shows one pill for each run in progress, and the seconds count up", async () => {
	status = ok({ runs: [{ ...RUN, startedAt: Date.now() - 5000 }] });
	const tab = await openGraph();
	const pill = await tab.findByTestId("run-pill-chat_a");
	expect(pill).toHaveTextContent(/Extracting.*Eigenvalues.*5s/);
	expect(pill.props.accessibilityLabel).toBe("Extracting Eigenvalues, 5s");
	await act(async () => {
		await jest.advanceTimersByTimeAsync(2000);
	});
	expect(tab.getByTestId("run-pill-chat_a")).toHaveTextContent(/7s$/);
});

it("reads the costs and the runs again when the Mac reports activity", async () => {
	costs = ok(goodCosts(1));
	status = ok({ runs: [{ ...RUN, startedAt: Date.now() }] });
	const tab = await openGraph();
	await tab.findByTestId("run-pill-chat_a");
	const next = goodCosts(2);
	next.stages.audit.dollars = 1.5;
	costs = ok(next);
	status = ok({ runs: [] });
	await act(async () => mac.emit("activity-changed", {}));
	await waitFor(() => expect(tab.getByTestId("graph-cost")).toHaveTextContent("$1.51"));
	expect(tab.queryByTestId("run-pill-chat_a")).toBeNull();
});

it("state 11: a failed costs call hides the number, the pills still show", async () => {
	costs = { status: 500, body: { error: "fold crashed: ENOENT /Users/x" } };
	status = ok({ runs: [{ ...RUN, startedAt: Date.now() }] });
	const tab = await openGraph();
	expect(await tab.findByTestId("run-pill-chat_a")).toBeTruthy();
	expect(tab.queryByTestId("graph-cost")).toBeNull();
	expect(tab.queryByText(/ENOENT|fold crashed/)).toBeNull();
	expect(tab.queryByTestId("graph-error")).toBeNull();
});

it("state 11: a failed status call hides the pills, the number still shows", async () => {
	costs = ok(goodCosts(1));
	status = { status: 500, body: { error: "status exploded" } };
	const tab = await openGraph();
	expect(await tab.findByTestId("graph-cost")).toHaveTextContent("$0.02");
	expect(tab.queryByTestId(/^run-pill-/)).toBeNull();
	expect(tab.queryByText(/exploded/)).toBeNull();
});

it("state 11: the open cost sheet closes when a new read has no costs", async () => {
	costs = ok(goodCosts(1));
	const tab = await openGraph();
	await fireEvent.press(await tab.findByTestId("graph-cost"));
	await screen.findByTestId("cost-sheet");
	costs = "network";
	await act(async () => mac.emit("activity-changed", {}));
	await waitFor(() => expect(screen.queryByTestId("cost-sheet")).toBeNull());
	expect(tab.queryByTestId("graph-cost")).toBeNull();
	expect(tab.getByTestId("graph-canvas")).toBeTruthy();
});

it("a failed read after a good one keeps the graph, marked not up to date (state 1)", async () => {
	const tab = await openGraph();
	await tab.findByTestId("graph-canvas");
	graph = "network";
	await act(async () => mac.emit("activity-changed", {}));
	expect(await tab.findByTestId("graph-stale")).toHaveTextContent("Not up to date");
	expect(tab.getByTestId("canvas-node-n_a")).toBeTruthy();
	// The next good read clears the mark.
	graph = ok(snapshot());
	await act(async () => mac.emit("activity-changed", {}));
	await waitFor(() => expect(tab.queryByTestId("graph-stale")).toBeNull());
});
